import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from './test-support/bootstrap-test-app.js';
import type { FakeMailer } from './test-support/fake-mailer.js';

interface LoginResponseBody {
  sessionId: string;
  token: string;
  issuedAt: string;
  absoluteExpiresAt: string;
}

interface SessionSummaryBody {
  sessionId: string;
  deviceLabel: string;
  issuedAt: string;
  rotatedAt: string | null;
  absoluteExpiresAt: string;
  isCurrent: boolean;
}

describe('POST /v1/identity/sessions', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndVerify(email: string, password: string): Promise<void> {
    await request(server).post('/v1/identity/registrations').send({ email, password });
    const token = mailer.latestVerificationToken();
    await request(server).post('/v1/identity/verifications').send({ token });
  }

  it('issues a session for correct credentials (FR-006)', async () => {
    const email = `ada-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    await registerAndVerify(email, password);

    const response = await request(server)
      .post('/v1/identity/sessions')
      .send({ email, password, deviceLabel: "Ada's laptop" });

    expect(response.status).toBe(201);
    const body = response.body as LoginResponseBody;
    expect(typeof body.sessionId).toBe('string');
    expect(typeof body.token).toBe('string');
  });

  it('rejects an unknown email and a wrong password identically (FR-007, SC-003)', async () => {
    const email = `grace-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    await registerAndVerify(email, password);

    const wrongPassword = await request(server)
      .post('/v1/identity/sessions')
      .send({ email, password: 'not the right password' });
    const unknownEmail = await request(server)
      .post('/v1/identity/sessions')
      .send({ email: `unknown-${randomUUID()}@example.com`, password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual({ type: 'identity/invalid_credentials' });
    expect(unknownEmail.body).toEqual({ type: 'identity/invalid_credentials' });
  });

  it('throttles after repeated failures, even once a later attempt is correct (FR-008)', async () => {
    const email = `hopper-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    await registerAndVerify(email, password);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/v1/identity/sessions')
        .send({ email, password: 'wrong password attempt' });
    }

    const response = await request(server).post('/v1/identity/sessions').send({ email, password });

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ type: 'identity/throttled' });
  });

  it('rejects an unverified account (FR-003, FR-006)', async () => {
    const email = `turing-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    await request(server).post('/v1/identity/registrations').send({ email, password });

    const response = await request(server).post('/v1/identity/sessions').send({ email, password });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ type: 'identity/not_verified' });
  });
});

describe('GET /v1/identity/sessions', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerVerifyAndLogin(
    email: string,
    password: string,
  ): Promise<LoginResponseBody> {
    await request(server).post('/v1/identity/registrations').send({ email, password });
    const verificationToken = mailer.latestVerificationToken();
    await request(server).post('/v1/identity/verifications').send({ token: verificationToken });
    const login = await request(server).post('/v1/identity/sessions').send({ email, password });
    return login.body as LoginResponseBody;
  }

  it("returns only the caller's own sessions, flagging the current one (authorization matrix)", async () => {
    const passwordA = 'correct horse battery staple';
    const sessionA = await registerVerifyAndLogin(`amelia-${randomUUID()}@example.com`, passwordA);
    const passwordB = 'another long enough password';
    const sessionB = await registerVerifyAndLogin(`beatrix-${randomUUID()}@example.com`, passwordB);

    const responseA = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${sessionA.token}`);

    expect(responseA.status).toBe(200);
    const sessionsA = (responseA.body as { sessions: SessionSummaryBody[] }).sessions;
    expect(sessionsA).toHaveLength(1);
    expect(sessionsA[0]?.sessionId).toBe(sessionA.sessionId);
    expect(sessionsA[0]?.isCurrent).toBe(true);
    expect(sessionsA.map((session) => session.sessionId)).not.toContain(sessionB.sessionId);
  });

  it('rejects a request with no session credential (FR-023)', async () => {
    const response = await request(server).get('/v1/identity/sessions');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ type: 'identity/session_invalid' });
  });

  it('rejects an unknown bearer token (FR-023)', async () => {
    const response = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ type: 'identity/session_invalid' });
  });
});
