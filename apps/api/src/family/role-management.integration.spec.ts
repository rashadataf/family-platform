import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, seedMember, withDatabaseCommitted } from '@fp/testing';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin, type AuthenticatedCaller } from './test-support/register-and-login.js';

describe('Role management (US5, FR-016, FR-018)', () => {
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

  it('demoting to viewer is visible in the very next request (FR-016, SC-005)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);
    const graceCaller = await registerAndLogin(server, mailer);
    const graceMemberId = await seedAdult(familyId, graceCaller);

    const before = await request(server)
      .get(`/v1/families`)
      .set('Authorization', `Bearer ${graceCaller.token}`);
    expect((before.body as { role: string }[])[0]?.role).toBe('adult');

    const demote = await request(server)
      .patch(`/v1/families/${familyId}/members/${graceMemberId}/role`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'viewer' });
    expect(demote.status).toBe(200);

    const after = await request(server)
      .get(`/v1/families`)
      .set('Authorization', `Bearer ${graceCaller.token}`);
    expect((after.body as { role: string }[])[0]?.role).toBe('viewer');
  });

  it("refuses to change the sole owner's role (FR-018)", async () => {
    const owner = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (created.body as { familyId: string }).familyId;
    const ownerMemberId = (created.body as { ownerMemberId: string }).ownerMemberId;

    const attempt = await request(server)
      .patch(`/v1/families/${familyId}/members/${ownerMemberId}/role`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'viewer' });

    expect(attempt.status).toBe(409);
    expect(attempt.body).toEqual({ type: 'family/owner_required' });
  });

  it('refuses to remove the sole owner (FR-018)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (created.body as { familyId: string }).familyId;
    const ownerMemberId = (created.body as { ownerMemberId: string }).ownerMemberId;

    const attempt = await request(server)
      .delete(`/v1/families/${familyId}/members/${ownerMemberId}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(attempt.status).toBe(409);
    expect(attempt.body).toEqual({ type: 'family/owner_required' });
  });

  it('removes an ordinary member, tombstoning the row (no login path afterward)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);
    const graceCaller = await registerAndLogin(server, mailer);
    const graceMemberId = await seedAdult(familyId, graceCaller);

    const remove = await request(server)
      .delete(`/v1/families/${familyId}/members/${graceMemberId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(remove.status).toBe(200);

    const roster = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    const rosterIds = (roster.body as { id: string }[]).map((m) => m.id);
    expect(rosterIds).not.toContain(graceMemberId);

    // The removed member's own session no longer resolves standing in this family.
    const staleListing = await request(server)
      .get('/v1/families')
      .set('Authorization', `Bearer ${graceCaller.token}`);
    const staleMemberships = staleListing.body as { familyId: string }[];
    expect(staleMemberships.some((m) => m.familyId === familyId)).toBe(false);
  });
});
