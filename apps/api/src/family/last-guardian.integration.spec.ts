import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, seedMember, withDatabaseCommitted } from '@fp/testing';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin, type AuthenticatedCaller } from './test-support/register-and-login.js';

describe('Never leaving a child with zero guardians (US5, FR-008, SC-006)', () => {
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

  it("refuses to remove a child's only guardian's membership with 409", async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);
    const graceCaller = await registerAndLogin(server, mailer);
    const graceMemberId = await seedAdult(familyId, graceCaller);

    const addChild = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${graceCaller.token}`)
      .send({ kind: 'child', displayName: 'Bo' });
    expect(addChild.status).toBe(201);

    const remove = await request(server)
      .delete(`/v1/families/${familyId}/members/${graceMemberId}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(remove.status).toBe(409);
    expect(remove.body).toEqual({ type: 'family/last_guardian' });
  });

  it("refuses to demote a child's only guardian away from an eligible role with 409", async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);
    const graceCaller = await registerAndLogin(server, mailer);
    const graceMemberId = await seedAdult(familyId, graceCaller);

    const addChild = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${graceCaller.token}`)
      .send({ kind: 'child', displayName: 'Bo' });
    expect(addChild.status).toBe(201);

    const demote = await request(server)
      .patch(`/v1/families/${familyId}/members/${graceMemberId}/role`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'viewer' });

    expect(demote.status).toBe(409);
    expect(demote.body).toEqual({ type: 'family/last_guardian' });
  });

  it('allows removal once a second guardian covers the same child', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);
    const graceCaller = await registerAndLogin(server, mailer);
    const graceMemberId = await seedAdult(familyId, graceCaller);

    const addChild = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${graceCaller.token}`)
      .send({ kind: 'child', displayName: 'Bo' });
    const childId = (addChild.body as { memberId: string }).memberId;

    const roster = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    const ownerMemberId = (roster.body as { id: string; role: string }[]).find(
      (m) => m.role === 'owner',
    )?.id;

    const grant = await request(server)
      .post(`/v1/families/${familyId}/members/${childId}/guardians`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ guardianMemberId: ownerMemberId });
    expect(grant.status).toBe(201);

    const remove = await request(server)
      .delete(`/v1/families/${familyId}/members/${graceMemberId}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(remove.status).toBe(200);
  });
});
