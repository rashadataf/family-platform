import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asSessionId } from '@fp/kernel';
import { createSessionRepository } from '@fp/persistence';
import { bootstrapTestApp } from './test-support/bootstrap-test-app.js';
import type { FakeMailer } from './test-support/fake-mailer.js';

interface SessionCredentialBody {
  sessionId: string;
  token: string;
}

describe('replay detection on POST /v1/identity/sessions/current/renewal', () => {
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

  it('rejects a superseded credential and revokes the whole session lineage (FR-011)', async () => {
    const original = await registerVerifyAndLogin(
      `hopper-${randomUUID()}@example.com`,
      'correct horse battery staple',
    );

    const renewal = await request(server)
      .post('/v1/identity/sessions/current/renewal')
      .set('Authorization', `Bearer ${original.token}`)
      .send({});
    const renewed = renewal.body as SessionCredentialBody;

    // Present the now-superseded original credential again.
    const replay = await request(server)
      .post('/v1/identity/sessions/current/renewal')
      .set('Authorization', `Bearer ${original.token}`)
      .send({});

    expect(replay.status).toBe(401);
    // No distinct type is disclosed — identical to any other invalid session
    // (contracts/identity-api.md's stated reasoning).
    expect(replay.body).toEqual({ type: 'identity/session_invalid' });

    const sessionRepository = createSessionRepository();
    const stored = await sessionRepository.findById(asSessionId(original.sessionId));
    expect(stored?.revokedReason).toBe('replay_detected');

    // The whole lineage is dead, including the credential issued by the
    // rotation the replay was detected during.
    const withLatestToken = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${renewed.token}`);
    expect(withLatestToken.status).toBe(401);
  });

  it('detects a superseded credential on an ordinary authenticated route too, not only renewal (FR-011, quickstart Scenario 3)', async () => {
    const original = await registerVerifyAndLogin(
      `lovelace-${randomUUID()}@example.com`,
      'correct horse battery staple',
    );

    const renewal = await request(server)
      .post('/v1/identity/sessions/current/renewal')
      .set('Authorization', `Bearer ${original.token}`)
      .send({});
    const renewed = renewal.body as SessionCredentialBody;

    // Present the now-superseded credential to an ORDINARY route, not renewal.
    const replay = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${original.token}`);

    expect(replay.status).toBe(401);
    expect(replay.body).toEqual({ type: 'identity/session_invalid' });

    const sessionRepository = createSessionRepository();
    const stored = await sessionRepository.findById(asSessionId(original.sessionId));
    expect(stored?.revokedReason).toBe('replay_detected');

    // The credential issued by that same rotation is also dead — the whole
    // lineage, not just the replayed token.
    const withLatestToken = await request(server)
      .get('/v1/identity/sessions')
      .set('Authorization', `Bearer ${renewed.token}`);
    expect(withLatestToken.status).toBe(401);
  });
});
