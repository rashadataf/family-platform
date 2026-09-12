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

describe('DELETE /v1/identity/sessions/:sessionId', () => {
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

  it("revokes one session by its stable id without affecting the caller's other sessions, even after rotation (clarification 2)", async () => {
    const email = `turing-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    await registerAndVerify(email, password);
    const sessionA = await login(email, password);
    const sessionB = await login(email, password);

    // Rotate A's credential before revoking it, to prove the stable id still
    // resolves the same session after rotation.
    const renewal = await request(server)
      .post('/v1/identity/sessions/current/renewal')
      .set('Authorization', `Bearer ${sessionA.token}`)
      .send({});
    const rotatedTokenA = (renewal.body as SessionCredentialBody).token;

    const revokeResponse = await request(server)
      .delete(`/v1/identity/sessions/${sessionA.sessionId}`)
      .set('Authorization', `Bearer ${sessionB.token}`);
    expect(revokeResponse.status).toBe(200);

    const withRevokedSession = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${rotatedTokenA}`);
    expect(withRevokedSession.status).toBe(401);

    const withOtherSession = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${sessionB.token}`);
    expect(withOtherSession.status).toBe(200);
  });

  it("returns 404, not 403, when revoking another user's session id (authorization matrix)", async () => {
    const passwordA = 'correct horse battery staple';
    const emailA = `amelia-${randomUUID()}@example.com`;
    await registerAndVerify(emailA, passwordA);
    const sessionA = await login(emailA, passwordA);

    const emailB = `beatrix-${randomUUID()}@example.com`;
    const passwordB = 'another long enough password';
    await registerAndVerify(emailB, passwordB);
    const sessionB = await login(emailB, passwordB);

    const response = await request(server)
      .delete(`/v1/identity/sessions/${sessionA.sessionId}`)
      .set('Authorization', `Bearer ${sessionB.token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ type: 'identity/not_found' });
  });

  it('rejects revoking a well-formed but unknown session id (authorization matrix)', async () => {
    const email = `curie-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    await registerAndVerify(email, password);
    const session = await login(email, password);

    const response = await request(server)
      .delete('/v1/identity/sessions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${session.token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ type: 'identity/not_found' });
  });
});
