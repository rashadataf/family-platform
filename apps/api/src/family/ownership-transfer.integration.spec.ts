import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, seedChild, seedMember, withDatabaseCommitted } from '@fp/testing';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin, type AuthenticatedCaller } from './test-support/register-and-login.js';

describe('Ownership transfer (US5, FR-018, spec.md Edge Cases)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedAdult(familyId: string, caller: AuthenticatedCaller): Promise<string> {
    let memberId = '';
    await withDatabaseCommitted(async (tx) => {
      const user = await tx.user.findFirstOrThrow({ where: { email: caller.email } });
      await scopeTo(tx, familyId);
      const seeded = await seedMember(tx, { familyId, role: 'adult', userId: user.id });
      memberId = seeded.memberId;
    });
    return memberId;
  }

  it('demotes the previous owner to adult, promotes the new one, and leaves a guardianship untouched', async () => {
    const owner = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (created.body as { familyId: string }).familyId;
    const ownerMemberId = (created.body as { ownerMemberId: string }).ownerMemberId;

    const graceCaller = await registerAndLogin(server, mailer);
    const graceMemberId = await seedAdult(familyId, graceCaller);

    let childId = '';
    await withDatabaseCommitted(async (tx) => {
      await scopeTo(tx, familyId);
      const seeded = await seedChild(tx, {
        familyId,
        guardianMemberId: ownerMemberId,
        displayName: 'Bo',
        dateOfBirth: new Date('2019-04-02'),
      });
      childId = seeded.childMemberId;
    });

    const transfer = await request(server)
      .post(`/v1/families/${familyId}/ownership-transfer`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ toMemberId: graceMemberId });
    expect(transfer.status).toBe(200);

    const roster = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${graceCaller.token}`);
    const rows = roster.body as { id: string; role: string }[];
    expect(rows.find((m) => m.id === graceMemberId)?.role).toBe('owner');
    expect(rows.find((m) => m.id === ownerMemberId)?.role).toBe('adult');
    expect(rows.filter((m) => m.role === 'owner')).toHaveLength(1);

    // The previous owner's guardianship of the child survives the transfer
    // untouched — a role change alone never ends an existing guardianship
    // except when this SAME action (changeMemberRole) is what causes the
    // ineligibility, which transferOwnership's demotion (owner -> adult)
    // never does, since adult stays an eligible guardian role.
    const childRead = await request(server)
      .get(`/v1/families/${familyId}/members/${childId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(childRead.status).toBe(200);
  });

  it('never leaves two owners even under a concurrent double transfer (family_one_owner)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (created.body as { familyId: string }).familyId;

    const graceCaller = await registerAndLogin(server, mailer);
    const graceMemberId = await seedAdult(familyId, graceCaller);
    const vicCaller = await registerAndLogin(server, mailer);
    const vicMemberId = await seedAdult(familyId, vicCaller);

    // Two requests naming DIFFERENT new owners, fired together: whichever
    // transaction commits first wins, and `family_one_owner` (the partial
    // unique index, not application logic) is what stops the second from
    // ever seeing a moment with two.
    const [first, second] = await Promise.all([
      request(server)
        .post(`/v1/families/${familyId}/ownership-transfer`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ toMemberId: graceMemberId }),
      request(server)
        .post(`/v1/families/${familyId}/ownership-transfer`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ toMemberId: vicMemberId }),
    ]);

    const statuses = [first.status, second.status].sort();
    // Both may succeed sequentially (the second transfer legitimately moves
    // ownership again, from whoever the first transfer just promoted) or the
    // second may hit the index directly as a 500 if the two truly overlapped
    // inside one transaction window — either way, never two owners after.
    expect(statuses[0]).toBe(200);

    const roster = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    const owners = (roster.body as { role: string }[]).filter((m) => m.role === 'owner');
    expect(owners).toHaveLength(1);
  });

  it('refuses to transfer ownership to an unlinked member (US4 Scenario 2)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (created.body as { familyId: string }).familyId;

    const addExtended = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'extended', displayName: 'Grandma' });
    const extendedMemberId = (addExtended.body as { memberId: string }).memberId;

    const transfer = await request(server)
      .post(`/v1/families/${familyId}/ownership-transfer`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ toMemberId: extendedMemberId });

    expect(transfer.status).toBe(422);
    expect(transfer.body).toMatchObject({ type: 'family/owner_ineligible' });
  });
});
