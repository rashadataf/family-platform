import { randomUUID } from 'node:crypto';
import { asFamilyId, asTaskId } from '@fp/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from './generated/prisma/index.js';
import { createTasksUnitOfWork } from './tasks-context.js';

/**
 * Spec 010 T010–T011: ADR-017's assertions, repeated for Tasks' two tables.
 * Every other Tasks test goes through `withTasksFamilyContext`; these go around
 * it, to the database, as the two roles a deployed system actually uses —
 * because the failure they exist for is one where the application behaves
 * perfectly and the isolation underneath is missing.
 *
 * The series invariants (`UNIQUE (predecessor_id)`, one head per series) are
 * `series-invariants.integration.spec.ts`'s, not this file's; here the subject
 * is isolation and the row shapes the schema itself guarantees.
 */

const TASK_TABLES = ['task', 'task_assignment'] as const;

function appClient(): PrismaClient {
  return new PrismaClient();
}

/**
 * The OWNER role. It owns these tables, so without `FORCE ROW LEVEL SECURITY`
 * every policy would exempt it — which is exactly the path a psql session, a
 * seed script or a migration takes.
 */
function ownerClient(): PrismaClient {
  const url = process.env.TEST_DATABASE_OWNER_URL;
  if (url === undefined || url === '') {
    throw new Error('TEST_DATABASE_OWNER_URL is not set — run via `pnpm test:integration`.');
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

interface SeededTasks {
  familyId: string;
  memberId: string;
  taskId: string;
}

async function seedFamilyWithTask(): Promise<SeededTasks> {
  const familyId = randomUUID();
  const memberId = randomUUID();
  const taskId = randomUUID();
  const client = appClient();

  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      await tx.family.create({ data: { id: familyId, name: 'Isolation Probe' } });
      await tx.familyMember.create({
        data: {
          id: memberId,
          familyId,
          kind: 'adult',
          role: 'owner',
          userId: randomUUID(),
          displayName: 'Probe',
        },
      });
      await tx.task.create({
        data: {
          id: taskId,
          familyId,
          title: 'Probe task',
          dueKind: 'date',
          dueDate: new Date('2026-09-20T00:00:00Z'),
          timeZone: 'Europe/London',
          dueAt: new Date('2026-09-20T23:00:00Z'),
        },
      });
      await tx.taskAssignment.create({ data: { taskId, familyId, memberId } });
    });
  } finally {
    await client.$disconnect();
  }
  return { familyId, memberId, taskId };
}

async function eraseFamily(familyId: string): Promise<void> {
  const client = appClient();
  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      await tx.family.deleteMany({});
    });
  } finally {
    await client.$disconnect();
  }
}

async function countAll(
  client: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  table: string,
) {
  const rows = await client.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) AS count FROM "${table}"`,
  );
  return rows[0]?.count;
}

describe('row-level security on Tasks tables (ADR-017, spec 010)', () => {
  let first: SeededTasks;
  let second: SeededTasks;

  beforeAll(async () => {
    first = await seedFamilyWithTask();
    second = await seedFamilyWithTask();
  });

  afterAll(async () => {
    await eraseFamily(first.familyId);
    await eraseFamily(second.familyId);
  });

  it('returns zero rows from both tables to the application role with no context — while rows plainly exist', async () => {
    const client = appClient();
    try {
      for (const table of TASK_TABLES) {
        expect(await countAll(client, table), `${table} with no app.family_id`).toBe(0n);
      }
      // "Plainly exist": the same tables, scoped, are not empty.
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
        for (const table of TASK_TABLES) {
          expect(await countAll(tx, table), `${table} scoped`).toBe(1n);
        }
      });
    } finally {
      await client.$disconnect();
    }
  });

  it('returns zero rows to the OWNER role with no context — FORCE is doing something', async () => {
    const client = ownerClient();
    try {
      const [who] = await client.$queryRaw<{ user: string }[]>`SELECT current_user AS user`;
      expect(who?.user).toBe('family_platform_owner');

      for (const table of TASK_TABLES) {
        expect(await countAll(client, table), `${table} as owner, no context`).toBe(0n);
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('shows only the scoped family inside withTasksFamilyContext', async () => {
    const found = await createTasksUnitOfWork().withTasksFamilyContext(
      asFamilyId(first.familyId),
      async (uow) => ({
        own: await uow.tasks.findById(asTaskId(first.taskId)),
        other: await uow.tasks.findById(asTaskId(second.taskId)),
      }),
    );
    expect(found.own?.id).toBe(first.taskId);
    expect(found.other).toBeNull();
  });

  it('shows only the scoped family’s assignments inside withTasksFamilyContext', async () => {
    const assignments = await createTasksUnitOfWork().withTasksFamilyContext(
      asFamilyId(first.familyId),
      async (uow) => ({
        own: await uow.assignments.listForTask(asTaskId(first.taskId)),
        other: await uow.assignments.listForTask(asTaskId(second.taskId)),
      }),
    );
    expect(assignments.own.map((a) => a.memberId)).toEqual([first.memberId]);
    expect(assignments.other).toEqual([]);
  });

  it('refuses to write an assignment into a family other than the context', async () => {
    const client = appClient();
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
          await tx.taskAssignment.create({
            data: {
              taskId: second.taskId,
              familyId: second.familyId,
              memberId: second.memberId,
            },
          });
        }),
      ).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  });

  it('refuses an assignment whose family_id disagrees with its task’s (the composite FK)', async () => {
    const client = appClient();
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
          await tx.taskAssignment.create({
            data: {
              taskId: second.taskId,
              familyId: first.familyId,
              memberId: first.memberId,
            },
          });
        }),
      ).rejects.toThrow();
    } finally {
      await client.$disconnect();
    }
  });

  it('does not let app.family_id survive its transaction on the same pooled connection (T011)', async () => {
    const client = appClient();
    try {
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
        expect(await countAll(tx, 'task')).toBe(1n);
      });

      // Same client, same pool, a new statement with no context set.
      for (const table of TASK_TABLES) {
        expect(await countAll(client, table), `${table} leaked past its transaction`).toBe(0n);
      }
    } finally {
      await client.$disconnect();
    }
  });

  it('refuses a due time without a zone at the database, not only in the domain (task_due_shape)', async () => {
    const client = appClient();
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
          await tx.task.create({
            data: {
              familyId: first.familyId,
              title: 'Mixed due shape',
              dueKind: 'date_time',
              dueDate: new Date('2026-09-20T00:00:00Z'),
              dueLocalTime: new Date(Date.UTC(1970, 0, 1, 18, 30)),
              timeZone: null,
              dueAt: new Date('2026-09-20T17:30:00Z'),
            },
          });
        }),
      ).rejects.toThrow(/task_due_shape/);
    } finally {
      await client.$disconnect();
    }
  });

  it('refuses a completed task that also carries a cancellation time (task_status_shape)', async () => {
    const client = appClient();
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
          await tx.task.create({
            data: {
              familyId: first.familyId,
              title: 'Both closures',
              status: 'completed',
              completedAt: new Date('2026-09-20T12:00:00Z'),
              cancelledAt: new Date('2026-09-20T12:00:00Z'),
              closedAt: new Date('2026-09-20T12:00:00Z'),
            },
          });
        }),
      ).rejects.toThrow(/task_status_shape/);
    } finally {
      await client.$disconnect();
    }
  });

  it('refuses a recurrence rule on a task with no due date (task_recurrence_shape)', async () => {
    const client = appClient();
    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
          await tx.task.create({
            data: {
              familyId: first.familyId,
              title: 'Undated chore',
              dueKind: 'none',
              recurrenceRule: 'FREQ=WEEKLY',
              recurrenceAnchor: new Date('2026-09-20T00:00:00Z'),
              seriesId: randomUUID(),
              isSeriesHead: true,
            },
          });
        }),
      ).rejects.toThrow(/task_recurrence_shape/);
    } finally {
      await client.$disconnect();
    }
  });
});
