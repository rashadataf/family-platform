import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, seedChild, seedMember, withDatabaseCommitted } from '@fp/testing';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin, type AuthenticatedCaller } from './test-support/register-and-login.js';

interface MemberSummaryBody {
  id: string;
  kind: string;
  role: string;
  displayName: string | null;
  dateOfBirth?: string | null;
}

describe('the child boundary (US2, FR-006, FR-007) — "the test this whole feature exists for"', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  async function createFamily(token: string): Promise<string> {
    const response = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    return (response.body as { familyId: string }).familyId;
  }

  async function seedRole(
    familyId: string,
    role: 'adult' | 'viewer',
    caller: AuthenticatedCaller,
  ): Promise<string> {
    let memberId = '';
    await withDatabaseCommitted(async (tx) => {
      const user = await tx.user.findFirstOrThrow({ where: { email: caller.email } });
      await scopeTo(tx, familyId);
      const seeded = await seedMember(tx, {
        familyId,
        role,
        userId: user.id,
        displayName: role === 'adult' ? 'Grace' : 'Vic',
      });
      memberId = seeded.memberId;
    });
    return memberId;
  }

  it('denies an owner who is not a guardian, and allows an adult guardian (direction 1)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);

    // An eligible adult, not the owner, added directly (no invitation flow
    // exists yet — that is US3). Only she becomes the child's guardian.
    const graceCaller = await registerAndLogin(server, mailer);
    const graceMemberId = await seedRole(familyId, 'adult', graceCaller);

    const addChild = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${graceCaller.token}`)
      .send({ kind: 'child', displayName: 'Bo', dateOfBirth: '2019-04-02' });
    expect(addChild.status).toBe(201);
    const childId = (addChild.body as { memberId: string }).memberId;

    // The owner holds every capability there is, INCLUDING members:read, and
    // is still denied — guardianship is not a capability.
    const ownerRead = await request(server)
      .get(`/v1/families/${familyId}/members/${childId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRead.status).toBe(403);
    expect(ownerRead.body).toEqual({ type: 'family/guardianship_required' });

    // The actual guardian, an ordinary adult with no special capability
    // beyond members:read, reads it fine.
    const graceRead = await request(server)
      .get(`/v1/families/${familyId}/members/${childId}`)
      .set('Authorization', `Bearer ${graceCaller.token}`);
    expect(graceRead.status).toBe(200);
    expect((graceRead.body as MemberSummaryBody).dateOfBirth).toBe('2019-04-02');
    expect(graceMemberId).not.toBe(childId);
  });

  /**
   * Direction 2. `POST .../guardians` correctly refuses to grant a NEW
   * guardianship to a `viewer` (FR-006, asserted separately below), so an
   * already-active "viewer who is a guardian" is reachable only by direct
   * seeding — which is exactly the state FR-008 describes as legitimate: a
   * guardian's role changing away from eligible does not itself end an
   * existing guardianship, only the (not-yet-built, US5) action that would
   * change it. Reachable here without that action existing yet.
   */
  it('allows a viewer who already holds an active guardianship (direction 2)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);

    const vicCaller = await registerAndLogin(server, mailer);
    const vicMemberId = await seedRole(familyId, 'viewer', vicCaller);

    let childId = '';
    await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, familyId);
      const seeded = await seedChild(tx, {
        familyId,
        guardianMemberId: vicMemberId,
        displayName: 'Bo',
        dateOfBirth: new Date('2019-04-02'),
      });
      childId = seeded.childMemberId;
    });

    const ownerRead = await request(server)
      .get(`/v1/families/${familyId}/members/${childId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRead.status).toBe(403);

    const vicRead = await request(server)
      .get(`/v1/families/${familyId}/members/${childId}`)
      .set('Authorization', `Bearer ${vicCaller.token}`);
    expect(vicRead.status).toBe(200);
    expect((vicRead.body as MemberSummaryBody).dateOfBirth).toBe('2019-04-02');
  });

  it('refuses to grant a NEW guardianship to a viewer (FR-006)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);

    const addChild = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'child', displayName: 'Bo' });
    const childId = (addChild.body as { memberId: string }).memberId;

    const vicCaller = await registerAndLogin(server, mailer);
    const vicMemberId = await seedRole(familyId, 'viewer', vicCaller);

    const grant = await request(server)
      .post(`/v1/families/${familyId}/members/${childId}/guardians`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ guardianMemberId: vicMemberId });

    expect(grant.status).toBe(422);
    expect(grant.body).toMatchObject({ type: 'family/guardian_ineligible' });
  });

  it('omits dateOfBirth (the key itself, not the value) from the roster for a child the caller does not guard', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);

    const graceCaller = await registerAndLogin(server, mailer);
    await seedRole(familyId, 'adult', graceCaller);

    const addChild = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${graceCaller.token}`)
      .send({ kind: 'child', displayName: 'Bo', dateOfBirth: '2019-04-02' });
    const childId = (addChild.body as { memberId: string }).memberId;

    const ownerRoster = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    const ownerRow = (ownerRoster.body as MemberSummaryBody[]).find((m) => m.id === childId);
    expect(ownerRow).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(ownerRow, 'dateOfBirth')).toBe(false);

    const graceRoster = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${graceCaller.token}`);
    const graceRow = (graceRoster.body as MemberSummaryBody[]).find((m) => m.id === childId);
    expect(graceRow?.dateOfBirth).toBe('2019-04-02');
  });
});
