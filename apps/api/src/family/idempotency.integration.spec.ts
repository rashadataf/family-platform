import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

/**
 * ADR-006, Principle IX, contracts/family-api.md's Idempotency section: a
 * mobile client retries aggressively, and a duplicated family, member or
 * invitation is a defect the user cannot clean up themselves. Each of these
 * replays the exact same request twice — same `Idempotency-Key`, same body —
 * and asserts the second response is byte-identical to the first *and* that
 * nothing was created a second time.
 */
describe('Idempotency-Key is honoured on every route that creates durable state', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /v1/families: replaying the same key returns the same family, not a second one', async () => {
    const { token } = await registerAndLogin(server, mailer);
    const key = randomUUID();
    const body = { name: 'Lovelace', ownerDisplayName: 'Ada' };

    const first = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);

    const list = await request(server).get('/v1/families').set('Authorization', `Bearer ${token}`);
    expect((list.body as unknown[]).length).toBe(1);
  });

  it('POST /v1/families/:familyId/members: replaying the same key does not add a second child', async () => {
    const { token } = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (created.body as { familyId: string }).familyId;

    const key = randomUUID();
    const body = { kind: 'child' as const, displayName: 'Bo', dateOfBirth: '2019-04-02' };

    const first = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);

    const members = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${token}`);
    // Owner + the one child — never two children from the replay.
    expect((members.body as unknown[]).length).toBe(2);
  });

  it('POST /v1/families/:familyId/invitations: replaying the same key sends only one email', async () => {
    const { token } = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (created.body as { familyId: string }).familyId;

    const key = randomUUID();
    const body = { email: `${randomUUID()}@example.com`, proposedRole: 'adult' as const };

    const sentBefore = mailer.sent.length;

    const first = await request(server)
      .post(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(server)
      .post(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);

    // Only the first call reached `family.createInvitation` (and therefore
    // the mailer) — the replay short-circuited on the cached response.
    expect(mailer.sent.length - sentBefore).toBe(1);

    const invitations = await request(server)
      .get(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${token}`);
    expect((invitations.body as unknown[]).length).toBe(1);
  });

  it('POST /v1/invitations/accept: idempotent by construction — no Idempotency-Key needed (US3 Scenario 4)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (created.body as { familyId: string }).familyId;

    const invitee = await registerAndLogin(server, mailer);
    await request(server)
      .post(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: invitee.email, proposedRole: 'adult' });
    const invitationToken = mailer.latestInvitationToken();

    const first = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({ token: invitationToken });
    expect(first.status).toBe(200);

    const second = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({ token: invitationToken });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const members = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    // Owner + the one accepted invitee — never two rows from the replay.
    expect((members.body as unknown[]).length).toBe(2);
  });
});
