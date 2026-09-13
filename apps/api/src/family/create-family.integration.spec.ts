import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

describe('POST /v1/families', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates exactly one owner member linked to the caller (US1, FR-001)', async () => {
    const { token } = await registerAndLogin(server, mailer);

    const response = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });

    expect(response.status).toBe(201);
    const body = response.body as { familyId: string; ownerMemberId: string };
    expect(typeof body.familyId).toBe('string');
    expect(typeof body.ownerMemberId).toBe('string');

    const listing = await request(server)
      .get('/v1/families')
      .set('Authorization', `Bearer ${token}`);
    expect(listing.status).toBe(200);
    const memberships = listing.body as { familyId: string; role: string }[];
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.familyId).toBe(body.familyId);
    expect(memberships[0]?.role).toBe('owner');
  });

  it('rejects a missing name with 422 family/name_required (US1 Scenario 3)', async () => {
    const { token } = await registerAndLogin(server, mailer);

    const response = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', ownerDisplayName: 'Ada' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ type: 'family/name_required' });
    expect(typeof (response.body as { reason?: unknown }).reason).toBe('string');
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(server)
      .post('/v1/families')
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });

    expect(response.status).toBe(401);
  });

  it('replays the original response for a repeated Idempotency-Key, creating only one family (ADR-006)', async () => {
    const { token } = await registerAndLogin(server, mailer);
    const idempotencyKey = randomUUID();

    const first = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const second = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    const listing = await request(server)
      .get('/v1/families')
      .set('Authorization', `Bearer ${token}`);
    expect((listing.body as unknown[]).length).toBe(1);
  });
});
