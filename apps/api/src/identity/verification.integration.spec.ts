import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from './test-support/bootstrap-test-app.js';
import type { FakeMailer } from './test-support/fake-mailer.js';

describe('POST /v1/identity/verifications and .../resend', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(email: string) {
    await request(server)
      .post('/v1/identity/registrations')
      .send({ email, password: 'correct horse battery staple' });
    return mailer.latestVerificationToken();
  }

  it('verifies with the token sent at registration', async () => {
    const email = `ada-${randomUUID()}@example.com`;
    const token = await register(email);

    const response = await request(server).post('/v1/identity/verifications').send({ token });

    expect(response.status).toBe(200);
  });

  it('rejects an unknown token without distinguishing why (FR-003a)', async () => {
    const response = await request(server)
      .post('/v1/identity/verifications')
      .send({ token: 'not-a-real-token' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ type: 'identity/verification_invalid' });
  });

  it('rejects the same token used twice', async () => {
    const email = `grace-${randomUUID()}@example.com`;
    const token = await register(email);
    await request(server).post('/v1/identity/verifications').send({ token });

    const response = await request(server).post('/v1/identity/verifications').send({ token });

    expect(response.status).toBe(422);
  });

  it('a resend invalidates the previously issued link (FR-003a)', async () => {
    const email = `hopper-${randomUUID()}@example.com`;
    const firstToken = await register(email);

    const resendResponse = await request(server)
      .post('/v1/identity/verifications/resend')
      .send({ email });
    expect(resendResponse.status).toBe(200);
    const secondToken = mailer.latestVerificationToken();

    const oldLinkAttempt = await request(server)
      .post('/v1/identity/verifications')
      .send({ token: firstToken });
    expect(oldLinkAttempt.status).toBe(422);

    const newLinkAttempt = await request(server)
      .post('/v1/identity/verifications')
      .send({ token: secondToken });
    expect(newLinkAttempt.status).toBe(200);
  });

  it('always reports success for resend, even against an unknown email (non-disclosure)', async () => {
    const response = await request(server)
      .post('/v1/identity/verifications/resend')
      .send({ email: `unknown-${randomUUID()}@example.com` });

    expect(response.status).toBe(200);
  });
});
