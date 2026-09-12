import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from './test-support/bootstrap-test-app.js';
import type { FakeMailer } from './test-support/fake-mailer.js';

describe('POST /v1/identity/registrations', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an account and sends a verification email (User Story 1)', async () => {
    const email = `ada-${randomUUID()}@example.com`;

    const response = await request(server)
      .post('/v1/identity/registrations')
      .send({ email, password: 'correct horse battery staple' });

    expect(response.status).toBe(201);
    expect(mailer.sent.at(-1)?.to).toBe(email);
  });

  it('rejects a duplicate email without revealing which state applies (FR-002)', async () => {
    const email = `grace-${randomUUID()}@example.com`;
    await request(server)
      .post('/v1/identity/registrations')
      .send({ email, password: 'correct horse battery staple' });

    const response = await request(server)
      .post('/v1/identity/registrations')
      .send({ email, password: 'a different long password value' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ type: 'identity/email_unavailable' });
  });

  it('rejects a weak password with a specific, actionable reason (FR-004)', async () => {
    const email = `weak-${randomUUID()}@example.com`;

    const response = await request(server)
      .post('/v1/identity/registrations')
      .send({ email, password: 'short' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ type: 'identity/weak_password' });
    expect(typeof (response.body as { reason?: unknown }).reason).toBe('string');
  });

  it('treats the same email under different casing as the same account (FR-022)', async () => {
    const email = `case-${randomUUID()}@example.com`;
    await request(server)
      .post('/v1/identity/registrations')
      .send({ email, password: 'correct horse battery staple' });

    const response = await request(server)
      .post('/v1/identity/registrations')
      .send({ email: email.toUpperCase(), password: 'another long enough password' });

    expect(response.status).toBe(409);
  });
});
