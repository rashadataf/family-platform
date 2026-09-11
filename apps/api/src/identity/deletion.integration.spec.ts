import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from './test-support/bootstrap-test-app.js';
import type { FakeMailer } from './test-support/fake-mailer.js';

interface SessionCredentialBody {
  sessionId: string;
  token: string;
}

describe('DELETE /v1/identity/account', () => {
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

  async function login(email: string, password: string): Promise<SessionCredentialBody> {
    const response = await request(server).post('/v1/identity/sessions').send({ email, password });
    return response.body as SessionCredentialBody;
  }

  it('revokes every active session immediately, with no grace window (FR-015, FR-023, SC-007)', async () => {
    const email = `ada-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    await registerAndVerify(email, password);
    const sessionA = await login(email, password);
    const sessionB = await login(email, password);

    const deleteResponse = await request(server)
      .delete('/v1/identity/account')
      .set('Authorization', `Bearer ${sessionA.token}`);
    expect(deleteResponse.status).toBe(200);

    // Back to back, no waiting out a token's own lifetime — both sessions
    // die on their very next use, including the one that made the request.
    const withA = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${sessionA.token}`);
    expect(withA.status).toBe(401);

    const withB = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${sessionB.token}`);
    expect(withB.status).toBe(401);
  });

  it('blocks re-registration with the same email until erasure completes (FR-002, clarification 4)', async () => {
    const email = `hopper-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    await registerAndVerify(email, password);
    const session = await login(email, password);

    await request(server)
      .delete('/v1/identity/account')
      .set('Authorization', `Bearer ${session.token}`);

    const response = await request(server)
      .post('/v1/identity/registrations')
      .send({ email, password: 'a different long password value' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ type: 'identity/email_unavailable' });
  });

  it('rejects a request with no session credential (FR-023)', async () => {
    const response = await request(server).delete('/v1/identity/account');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ type: 'identity/session_invalid' });
  });
});
