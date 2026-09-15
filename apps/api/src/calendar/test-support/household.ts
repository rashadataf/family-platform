import type { Server } from 'node:http';
import request from 'supertest';
import type { FakeMailer } from '../../identity/test-support/fake-mailer.js';
import {
  registerAndLogin,
  type AuthenticatedCaller,
} from '../../family/test-support/register-and-login.js';

export interface HouseholdMember extends AuthenticatedCaller {
  readonly memberId: string;
}

/**
 * The household spec 009's quickstart assumes (quickstart.md Prerequisites),
 * built for real through Identity's and Family's own routes wherever a route
 * exists, so every calendar test starts from a family the platform itself
 * produced:
 *
 * | Who | Standing |
 * |---|---|
 * | ada | owner, guardian of charlie (she added him) |
 * | grace | adult, NOT a guardian of charlie |
 * | alan | extended — holds calendar:write, guards nobody |
 * | vera | viewer — calendar:read only |
 * | charlie | child, no account |
 * | outsider | an account with no standing in this family |
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
  readonly vera: HouseholdMember;
  readonly charlieId: string;
  readonly outsider: AuthenticatedCaller;
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

export async function buildHousehold(server: Server, mailer: FakeMailer): Promise<Household> {
  const adaCaller = await registerAndLogin(server, mailer);
  const created = await request(server)
    .post('/v1/families')
    .set('Authorization', `Bearer ${adaCaller.token}`)
    .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
  const { familyId, ownerMemberId } = created.body as { familyId: string; ownerMemberId: string };

  const addChild = await request(server)
    .post(`/v1/families/${familyId}/members`)
    .set('Authorization', `Bearer ${adaCaller.token}`)
    .send({ kind: 'child', displayName: 'Charlie', dateOfBirth: '2022-05-01' });
  const charlieId = (addChild.body as { memberId: string }).memberId;

  return {
    familyId,
    ada: { ...adaCaller, memberId: ownerMemberId },
    grace: await linkMember(server, mailer, familyId, adaCaller, 'adult'),
    alan: await linkMember(server, mailer, familyId, adaCaller, 'extended'),
    vera: await linkMember(server, mailer, familyId, adaCaller, 'viewer'),
    charlieId,
    outsider: await registerAndLogin(server, mailer),
  };
}

/** A one-off timed event body; override anything. */
export function timedEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'timed',
    title: 'Dentist',
    startsAt: '2026-09-20T09:00:00Z',
    endsAt: '2026-09-20T09:30:00Z',
    timeZone: 'Europe/London',
    ...overrides,
  };
}

export async function createEvent(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await request(server)
    .post(`/v1/families/${familyId}/events`)
    .set('Authorization', `Bearer ${caller.token}`)
    .send(body);
  if (response.status !== 201) {
    throw new Error(
      `createEvent fixture failed: ${String(response.status)} ${JSON.stringify(response.body)}`,
    );
  }
  return (response.body as { eventId: string }).eventId;
}

export interface OccurrenceBody {
  occurrenceId: string;
  eventId: string;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  kind: 'timed' | 'all_day';
  startDate: string | null;
  endDate: string | null;
  title: string;
  status: 'confirmed' | 'cancelled';
  participants: string[];
}

export async function listOccurrences(
  server: Server,
  familyId: string,
  caller: AuthenticatedCaller,
  from: string,
  to: string,
): Promise<{ status: number; body: OccurrenceBody[] }> {
  const response = await request(server)
    .get(`/v1/families/${familyId}/occurrences`)
    .query({ from, to })
    .set('Authorization', `Bearer ${caller.token}`);
  return { status: response.status, body: response.body as OccurrenceBody[] };
}
