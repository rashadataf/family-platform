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

interface AccountExportBody {
  email: string;
  registeredAt: string;
  verified: boolean;
  sessions: { deviceLabel: string; issuedAt: string; revokedAt: string | null }[];
}

describe('GET /v1/identity/account/export', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns only the caller's own data, never a password hash or a token (FR-021)", async () => {
    const email = `curie-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    await request(server).post('/v1/identity/registrations').send({ email, password });
    const verificationToken = mailer.latestVerificationToken();
    await request(server).post('/v1/identity/verifications').send({ token: verificationToken });
    const login = await request(server)
      .post('/v1/identity/sessions')
      .send({ email, password, deviceLabel: "Curie's laptop" });
    const session = login.body as SessionCredentialBody;

    // A second account exists in the same database so the export can prove
    // it never leaks the other user's data.
    const otherEmail = `franklin-${randomUUID()}@example.com`;
    await request(server)
      .post('/v1/identity/registrations')
      .send({ email: otherEmail, password: 'another long enough password' });

    const response = await request(server)
      .get('/v1/identity/account/export')
      .set('Authorization', `Bearer ${session.token}`);

    expect(response.status).toBe(200);
    const body = response.body as AccountExportBody;
    expect(body.email).toBe(email);
    expect(body.verified).toBe(true);
    expect(typeof body.registeredAt).toBe('string');
    expect(body.sessions).toEqual([
      expect.objectContaining({ deviceLabel: "Curie's laptop", revokedAt: null }),
    ]);

    const serialized = JSON.stringify(body);
    expect(serialized.toLowerCase()).not.toContain('password');
    expect(serialized).not.toContain(session.token);
    expect(serialized).not.toContain(otherEmail);
  });

  it('rejects a request with no session credential (FR-023)', async () => {
    const response = await request(server).get('/v1/identity/account/export');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ type: 'identity/session_invalid' });
  });
});
