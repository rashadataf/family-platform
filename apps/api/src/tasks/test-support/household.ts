import type { Server } from 'node:http';
import request from 'supertest';
import {
  registerAndLogin,
  type AuthenticatedCaller,
} from '../../family/test-support/register-and-login.js';
import type { FakeMailer } from '../../identity/test-support/fake-mailer.js';

export interface HouseholdMember extends AuthenticatedCaller {
  readonly memberId: string;
}

/**
 * The household spec 010's quickstart assumes (quickstart.md Prerequisites),
 * built for real through Identity's and Family's own routes wherever a route
 * exists, so every Tasks test starts from a family the platform itself
 * produced:
 *
 * | Who | Standing |
 * |---|---|
 * | ada | owner, guardian of charlie (she added him) |
 * | grace | adult, NOT a guardian of charlie |
 * | alan | extended — holds tasks:write, guards nobody |
 * | viv | viewer — tasks:read only |
 * | charlie | child, no account |
 * | outsider | owner of a DIFFERENT family, no standing in this one |
 *
 * The outsider has a family of their own rather than no family at all, because
 * the cross-family assertions (T025, T095) are about a caller who is a
 * legitimate member somewhere — the case where a bug would return data, not the
 * case the session guard already stops.
 *
 * Linked members join by spec 008's own invitation flow rather than by seeded
 * rows: this file is not a spec, so it may not reach the database harness
 * (`harness-is-test-only`), and a member the platform itself admitted is the
 * more honest fixture anyway.
 */
export interface Household {
  readonly familyId: string;
  readonly ada: HouseholdMember;
  readonly grace: HouseholdMember;
  readonly alan: HouseholdMember;
  readonly viv: HouseholdMember;
  readonly charlieId: string;
  readonly outsider: AuthenticatedCaller;
  readonly outsiderFamilyId: string;
  /** A real member id belonging to the OTHER family — the foreign-assignee probe. */
  readonly outsiderMemberId: string;
}

async function linkMember(
  server: Server,
  mailer: FakeMailer,
  familyId: string,
  owner: AuthenticatedCaller,
  role: 'adult' | 'extended' | 'viewer',
): Promise<HouseholdMember> {
  const caller = await registerAndLogin(server, mailer);
  const invited = await request(server)
    .post(`/v1/families/${familyId}/invitations`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ email: caller.email, proposedRole: role });
  if (invited.status !== 201) {
    throw new Error(`invitation fixture failed: ${String(invited.status)}`);
  }
  const accepted = await request(server)
    .post('/v1/invitations/accept')
    .set('Authorization', `Bearer ${caller.token}`)
    .send({ token: mailer.latestInvitationToken() });
  if (accepted.status !== 200) {
    throw new Error(`acceptance fixture failed: ${String(accepted.status)}`);
  }
  return { ...caller, memberId: (accepted.body as { memberId: string }).memberId };
}

async function createFamily(
  server: Server,
  caller: AuthenticatedCaller,
  name: string,
  ownerDisplayName: string,
): Promise<{ familyId: string; ownerMemberId: string }> {
  const created = await request(server)
    .post('/v1/families')
    .set('Authorization', `Bearer ${caller.token}`)
    .send({ name, ownerDisplayName });
  if (created.status !== 201) {
    throw new Error(`family fixture failed: ${String(created.status)}`);
  }
  return created.body as { familyId: string; ownerMemberId: string };
}

export async function buildHousehold(server: Server, mailer: FakeMailer): Promise<Household> {
  const adaCaller = await registerAndLogin(server, mailer);
  const { familyId, ownerMemberId } = await createFamily(server, adaCaller, 'Lovelace', 'Ada');

  const addChild = await request(server)
    .post(`/v1/families/${familyId}/members`)
    .set('Authorization', `Bearer ${adaCaller.token}`)
    .send({ kind: 'child', displayName: 'Charlie', dateOfBirth: '2022-05-01' });
  if (addChild.status !== 201) {
    throw new Error(`child fixture failed: ${String(addChild.status)}`);
  }
  const charlieId = (addChild.body as { memberId: string }).memberId;

  const outsider = await registerAndLogin(server, mailer);
  const outsiderFamily = await createFamily(server, outsider, 'Hopper', 'Outsider');

  return {
    familyId,
    ada: { ...adaCaller, memberId: ownerMemberId },
    grace: await linkMember(server, mailer, familyId, adaCaller, 'adult'),
    alan: await linkMember(server, mailer, familyId, adaCaller, 'extended'),
    viv: await linkMember(server, mailer, familyId, adaCaller, 'viewer'),
    charlieId,
    outsider,
    outsiderFamilyId: outsiderFamily.familyId,
    outsiderMemberId: outsiderFamily.ownerMemberId,
  };
}

/**
 * Narrows a nullable value a test has just asserted is present.
 *
 * The lint rules forbid both `as T` and `!` here, and rightly: a cast that is
 * wrong fails somewhere confusing later. This fails immediately, where the
 * assumption was made.
 */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

/** The wire shape of a task, as the contract declares it. */
export interface TaskBody {
  taskId: string;
  version: number;
  title: string;
  notes: string | null;
  priority: 'low' | 'normal' | 'high';
  category: string | null;
  status: 'open' | 'completed' | 'cancelled';
  due: { kind: 'date' | 'date_time'; date: string; time?: string; timeZone: string } | null;
  dueAt: string | null;
  isOverdue: boolean;
  recurrenceRule: string | null;
  seriesId: string | null;
  isSeriesHead: boolean;
  predecessorId: string | null;
  assigneeIds: string[];
  createdByMemberId: string | null;
  completedAt: string | null;
  completedByMemberId: string | null;
  cancelledAt: string | null;
  cancelledByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPageBody {
  items: TaskBody[];
  nextCursor: string | null;
}

/** A plain undated task body; override anything. */
export function taskRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: 'Take the bins out', ...overrides };
}

/** A due date on the wire, always with its zone (the contract makes it required). */
export function dateDue(date: string, timeZone = 'Europe/London') {
  return { kind: 'date' as const, date, timeZone };
}

export function dateTimeDue(date: string, time: string, timeZone = 'Europe/London') {
  return { kind: 'date_time' as const, date, time, timeZone };
}

export async function createTask(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  body: Record<string, unknown> = taskRequest(),
): Promise<TaskBody> {
  const response = await request(server)
    .post(`/v1/families/${familyId}/tasks`)
    .set('Authorization', `Bearer ${caller.token}`)
    .send(body);
  if (response.status !== 201) {
    throw new Error(
      `createTask fixture failed: ${String(response.status)} ${JSON.stringify(response.body)}`,
    );
  }
  return response.body as TaskBody;
}

export async function listOpenTasks(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  query: Record<string, string | number> = {},
): Promise<{ status: number; body: TaskPageBody }> {
  const response = await request(server)
    .get(`/v1/families/${familyId}/tasks`)
    .query(query)
    .set('Authorization', `Bearer ${caller.token}`);
  return { status: response.status, body: response.body as TaskPageBody };
}

export async function listTaskHistory(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  query: Record<string, string | number>,
): Promise<{ status: number; body: TaskPageBody }> {
  const response = await request(server)
    .get(`/v1/families/${familyId}/tasks/history`)
    .query(query)
    .set('Authorization', `Bearer ${caller.token}`);
  return { status: response.status, body: response.body as TaskPageBody };
}

export async function getTask(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  taskId: string,
): Promise<{ status: number; body: TaskBody & { type?: string } }> {
  const response = await request(server)
    .get(`/v1/families/${familyId}/tasks/${taskId}`)
    .set('Authorization', `Bearer ${caller.token}`);
  return { status: response.status, body: response.body as TaskBody & { type?: string } };
}

export function assign(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  taskId: string,
  memberId: string,
) {
  return request(server)
    .put(`/v1/families/${familyId}/tasks/${taskId}/assignees/${memberId}`)
    .set('Authorization', `Bearer ${caller.token}`);
}

export function unassign(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  taskId: string,
  memberId: string,
) {
  return request(server)
    .delete(`/v1/families/${familyId}/tasks/${taskId}/assignees/${memberId}`)
    .set('Authorization', `Bearer ${caller.token}`);
}

/** Spec 008's guardianship routes, which Tasks consumes but never reimplements. */
export function grantGuardianship(
  server: Server,
  familyId: string,
  owner: AuthenticatedCaller,
  childMemberId: string,
  guardianMemberId: string,
) {
  return request(server)
    .post(`/v1/families/${familyId}/members/${childMemberId}/guardians`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ guardianMemberId });
}

export function endGuardianship(
  server: Server,
  familyId: string,
  owner: AuthenticatedCaller,
  childMemberId: string,
  guardianMemberId: string,
) {
  return request(server)
    .delete(`/v1/families/${familyId}/members/${childMemberId}/guardians/${guardianMemberId}`)
    .set('Authorization', `Bearer ${owner.token}`);
}

/** Adds a child to the family, guarded by whoever adds them. */
export async function addChild(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  displayName: string,
): Promise<string> {
  const response = await request(server)
    .post(`/v1/families/${familyId}/members`)
    .set('Authorization', `Bearer ${caller.token}`)
    .send({ kind: 'child', displayName });
  if (response.status !== 201) {
    throw new Error(`addChild fixture failed: ${String(response.status)}`);
  }
  return (response.body as { memberId: string }).memberId;
}

export function patchTask(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  taskId: string,
  body: Record<string, unknown>,
) {
  return request(server)
    .patch(`/v1/families/${familyId}/tasks/${taskId}`)
    .set('Authorization', `Bearer ${caller.token}`)
    .send(body);
}

function transition(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  taskId: string,
  action: 'complete' | 'reopen' | 'cancel',
  body: Record<string, unknown>,
) {
  return request(server)
    .post(`/v1/families/${familyId}/tasks/${taskId}/${action}`)
    .set('Authorization', `Bearer ${caller.token}`)
    .send(body);
}

export function completeTask(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  taskId: string,
  expectedVersion: number,
) {
  return transition(server, familyId, caller, taskId, 'complete', { expectedVersion });
}

export function reopenTask(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  taskId: string,
  expectedVersion: number,
) {
  return transition(server, familyId, caller, taskId, 'reopen', { expectedVersion });
}

export function cancelTask(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  taskId: string,
  expectedVersion: number,
  scope: 'instance' | 'series' = 'instance',
) {
  return transition(server, familyId, caller, taskId, 'cancel', { expectedVersion, scope });
}

/** The body a close route returns: the task, and the successor if one was spawned. */
export interface CloseBody {
  task: TaskBody;
  successor: TaskBody | null;
}
