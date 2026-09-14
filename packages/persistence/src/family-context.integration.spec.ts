import { randomUUID } from 'node:crypto';
import { asFamilyId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { createFamilyUnitOfWork } from './family-context.js';
import { PrismaClient } from './generated/prisma/index.js';
import { PrismaAuditLogRepository } from './repositories/compliance/audit-log.repository.js';

/**
 * The tests that catch what nothing else can see.
 *
 * Every other test in this feature exercises the application, and the
 * application always goes through `withFamilyContext`. These go around it — to
 * the database, as the roles a deployed system actually uses — because the
 * failure ADR-017 exists to prevent is one where the application behaves
 * perfectly and the isolation underneath it is not there.
 *
 * They need `DATABASE_URL` to be the application role's, which is what
 * `.env.example` and `docker-compose.yml` provide (ADR-017).
 */

const FAMILY_SCOPED_TABLES = ['family', 'family_member', 'invitation', 'guardianship'] as const;

/** A raw client, deliberately outside `withFamilyContext`. That is the whole point. */
function rawClient(): PrismaClient {
  return new PrismaClient();
}

async function seedOneFamily(): Promise<{ familyId: string; memberId: string }> {
  const familyId = randomUUID();
  const memberId = randomUUID();

  await createFamilyUnitOfWork().withFamilyContext(asFamilyId(familyId), async (uow) => {
    const client = rawClient();
    try {
      // Written through a separately-scoped transaction so the rows COMMIT —
      // `withRollback` would undo them before the assertions below can look.
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.family_id', ${uow.familyId}::text, true)`;
        await tx.family.create({ data: { id: familyId, name: 'Isolation Probe' } });
        await tx.familyMember.create({
          data: {
            id: memberId,
            familyId,
            kind: 'adult',
            role: 'owner',
            userId: randomUUID(),
            displayName: 'Probe Owner',
          },
        });
      });
    } finally {
      await client.$disconnect();
    }
  });

  return { familyId, memberId };
}

async function cleanUp(familyId: string): Promise<void> {
  const client = rawClient();
  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
      await tx.familyMember.deleteMany({});
      await tx.family.deleteMany({});
    });
  } finally {
    await client.$disconnect();
  }
}

describe('row-level security (ADR-017)', () => {
  it('returns zero rows from every family-scoped table when no context is set', async () => {
    const { familyId } = await seedOneFamily();
    const client = rawClient();

    try {
      for (const table of FAMILY_SCOPED_TABLES) {
        const rows = await client.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT count(*) AS count FROM "${table}"`,
        );
        const count = rows[0]?.count;
        // Not "the seeded rows are hidden" — nothing at all is visible,
        // including every other family's rows. The policy fails CLOSED:
        // `current_setting('app.family_id', true)` is NULL when unset, and
        // `family_id = NULL` is NULL, which is not TRUE.
        expect(count, `${table} with no app.family_id set`).toBe(0n);
      }
    } finally {
      await client.$disconnect();
      await cleanUp(familyId);
    }
  });

  it('returns only the scoped family inside withFamilyContext', async () => {
    const first = await seedOneFamily();
    const second = await seedOneFamily();
    const client = rawClient();

    try {
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.family_id', ${first.familyId}::text, true)`;
        const members = await tx.familyMember.findMany({});
        expect(members).toHaveLength(1);
        expect(members[0]?.id).toBe(first.memberId);
      });
    } finally {
      await client.$disconnect();
      await cleanUp(first.familyId);
      await cleanUp(second.familyId);
    }
  });

  it('returns nothing when the context names a family the caller has no rows in', async () => {
    const { familyId } = await seedOneFamily();
    const client = rawClient();

    try {
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.family_id', ${randomUUID()}::text, true)`;
        expect(await tx.familyMember.findMany({})).toEqual([]);
      });
    } finally {
      await client.$disconnect();
      await cleanUp(familyId);
    }
  });

  it('does not let app.family_id survive its transaction', async () => {
    // The failure this guards against is invisible to every functional test:
    // drop the `true` from `set_config` and the setting becomes session-scoped,
    // so the next transaction on the same pooled connection inherits the
    // previous request's family. One family silently reading another's rows,
    // with no error anywhere.
    const { familyId } = await seedOneFamily();
    const client = rawClient();

    try {
      await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
        expect(await tx.familyMember.findMany({})).toHaveLength(1);
      });

      // Same client, same pooled connection, new transaction, no context set.
      const leaked = await client.familyMember.findMany({});
      expect(leaked, 'app.family_id leaked past its transaction').toEqual([]);
    } finally {
      await client.$disconnect();
      await cleanUp(familyId);
    }
  });

  it('refuses to write a row belonging to a different family than the context', async () => {
    // The policies carry WITH CHECK as well as USING, so the scope constrains
    // writes and not only reads. Without it a command could insert into
    // another family while reading only its own.
    const { familyId } = await seedOneFamily();
    const client = rawClient();

    try {
      await expect(
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;
          await tx.family.create({ data: { id: randomUUID(), name: 'Someone Else' } });
        }),
      ).rejects.toThrow();
    } finally {
      await client.$disconnect();
      await cleanUp(familyId);
    }
  });

  it('connects as the application role, not the owner and not a superuser', async () => {
    // If this ever fails, every assertion above becomes vacuous: an owner or a
    // superuser is not subject to the policies, so all of them would pass by
    // seeing everything rather than by being filtered.
    const client = rawClient();

    try {
      const [row] = await client.$queryRaw<{ user: string; superuser: string }[]>`
        SELECT current_user AS user, current_setting('is_superuser') AS superuser
      `;
      expect(row?.user).toBe('family_platform_app');
      expect(row?.superuser).toBe('off');
    } finally {
      await client.$disconnect();
    }
  });
});

describe('audit_log grants (ADR-017)', () => {
  it('accepts an insert and refuses every read', async () => {
    // ARCHITECTURE.md §5.12's "append-only, no update or delete grants",
    // expressed as a grant rather than as a convention — so it holds against a
    // raw query, a maintenance script, and a future ORM.
    const client = rawClient();

    try {
      await new PrismaAuditLogRepository(client).append({
        actorUserId: null,
        actorMemberId: null,
        familyId: null,
        subjectType: 'family_member',
        subjectId: randomUUID(),
        action: 'test.probe',
        purpose: 'verifying the append-only grant',
        result: 'granted',
        reason: null,
        correlationId: randomUUID(),
      });

      await expect(client.auditLog.findMany({})).rejects.toThrow(/permission denied/i);
      await expect(client.auditLog.deleteMany({})).rejects.toThrow(/permission denied/i);

      // Prisma's own `create` issues INSERT … RETURNING, which needs SELECT.
      // Asserted so that a future "simplification" of the repository back to
      // `create()` fails here rather than in production.
      await expect(
        client.auditLog.create({
          data: {
            subjectType: 'family_member',
            subjectId: randomUUID(),
            action: 'test.probe',
            purpose: 'RETURNING needs SELECT',
            result: 'granted',
            correlationId: randomUUID(),
          },
        }),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.$disconnect();
    }
  });
});
