import { randomUUID } from 'node:crypto';
import type { INestApplication, LoggerService } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from './test-support/bootstrap-test-app.js';
import type { FakeMailer } from './test-support/fake-mailer.js';

interface SessionCredentialBody {
  sessionId: string;
  token: string;
}

/** Captures every message passed to Nest's `Logger`, across every level. */
class CapturingLogger implements LoggerService {
  readonly messages: string[] = [];

  private capture(message: unknown): void {
    this.messages.push(String(message));
  }

  log(message: unknown): void {
    this.capture(message);
  }

  error(message: unknown): void {
    this.capture(message);
  }

  warn(message: unknown): void {
    this.capture(message);
  }

  debug(message: unknown): void {
    this.capture(message);
  }

  verbose(message: unknown): void {
    this.capture(message);
  }
}

/**
 * SC-005: exercises the full identity flow — registration through account
 * deletion — with a logger that captures every message the controller ever
 * passes to `Logger`, then asserts none of them contain the raw password or
 * a live credential. `app.useLogger()` is the officially supported
 * interception point, guaranteed to see every call regardless of how
 * console/stdout is wired in a given test runner.
 */
describe('SC-005: no plaintext password or live credential ever appears in a log line', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let logger: CapturingLogger;

  beforeAll(async () => {
    logger = new CapturingLogger();
    ({ app, server, mailer } = await bootstrapTestApp(logger));
  });

  afterAll(async () => {
    await app.close();
  });

  it('never logs the raw password, verification token, or a live session token', async () => {
    const email = `ada-${randomUUID()}@example.com`;
    const password = 'a very secret password value that must never appear in a log line';

    await request(server).post('/v1/identity/registrations').send({ email, password });
    const verificationToken = mailer.latestVerificationToken();
    await request(server).post('/v1/identity/verifications').send({ token: verificationToken });

    const login = await request(server)
      .post('/v1/identity/sessions')
      .send({ email, password, deviceLabel: 'Test device' });
    const { token, sessionId } = login.body as SessionCredentialBody;

    await request(server).get('/v1/identity/sessions').set('Authorization', `Bearer ${token}`);

    const renewal = await request(server)
      .post('/v1/identity/sessions/current/renewal')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    const renewed = renewal.body as SessionCredentialBody;

    await request(server)
      .get('/v1/identity/account/export')
      .set('Authorization', `Bearer ${renewed.token}`);
    await request(server)
      .delete('/v1/identity/account')
      .set('Authorization', `Bearer ${renewed.token}`);

    const combinedLog = logger.messages.join('\n');
    expect(combinedLog).not.toContain(password);
    expect(combinedLog).not.toContain(verificationToken);
    expect(combinedLog).not.toContain(token);
    expect(combinedLog).not.toContain(renewed.token);
    // Sanity check that this actually captured something meaningful — a
    // suite that captured nothing would pass for the wrong reason.
    expect(logger.messages.length).toBeGreaterThan(0);
    expect(combinedLog).toContain(sessionId);
  });
});
