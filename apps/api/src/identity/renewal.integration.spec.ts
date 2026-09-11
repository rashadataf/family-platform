import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { identity } from '@fp/core';
import { asSessionId } from '@fp/kernel';
import { createSessionRepository } from '@fp/persistence';
import { bootstrapTestApp } from './test-support/bootstrap-test-app.js';
import type { FakeMailer } from './test-support/fake-mailer.js';

interface SessionCredentialBody {
  sessionId: string;
  token: string;
  issuedAt: string;
  absoluteExpiresAt: string;
}

describe('POST /v1/identity/sessions/current/renewal', () => {
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
  ): Promise<SessionCredentialBody> {
    await request(server).post('/v1/identity/registrations').send({ email, password });
    const verificationToken = mailer.latestVerificationToken();
    await request(server).post('/v1/identity/verifications').send({ token: verificationToken });
    const login = await request(server).post('/v1/identity/sessions').send({ email, password });
    return login.body as SessionCredentialBody;
  }

  it('issues a fresh credential and invalidates the prior one (FR-010)', async () => {
    const session = await registerVerifyAndLogin(
      `lovelace-${randomUUID()}@example.com`,
      'correct horse battery staple',
    );

    const renewal = await request(server)
      .post('/v1/identity/sessions/current/renewal')
      .set('Authorization', `Bearer ${session.token}`)
      .send({});

    expect(renewal.status).toBe(201);
    const renewed = renewal.body as SessionCredentialBody;
    expect(renewed.sessionId).toBe(session.sessionId);
    expect(renewed.token).not.toBe(session.token);

    // The new credential works for an authenticated call.
    const withNewToken = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${renewed.token}`);
    expect(withNewToken.status).toBe(200);

    // The prior credential no longer does.
    const withOldToken = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${session.token}`);
    expect(withOldToken.status).toBe(401);
  });

  it('rejects renewal with no credential (FR-023)', async () => {
    const response = await request(server).post('/v1/identity/sessions/current/renewal').send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ type: 'identity/session_invalid' });
  });

  it('cannot be renewed once past its absolute lifetime (FR-013)', async () => {
    const session = await registerVerifyAndLogin(
      `babbage-${randomUUID()}@example.com`,
      'correct horse battery staple',
    );

    const sessionRepository = createSessionRepository();
    const stored = await sessionRepository.findById(asSessionId(session.sessionId));
    if (!stored) {
      throw new Error('Session not found immediately after login.');
    }
    const expired = identity.Session.reconstitute({
      ...stored.toProps(),
      absoluteExpiresAt: new Date(Date.now() - 1000),
    });
    await sessionRepository.save(expired);

    const response = await request(server)
      .post('/v1/identity/sessions/current/renewal')
      .set('Authorization', `Bearer ${session.token}`)
      .send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ type: 'identity/session_invalid' });
  });
});
