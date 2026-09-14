import type { INestApplication, LoggerService } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

/** Captures every message passed to Nest's `Logger`, across every level — the same interception point spec 006's own SC-005 test uses. */
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
 * Principle VI, mirroring spec 006's `no-secrets-in-logs.integration.spec.ts`.
 * Exercises US1-US5's routes with real personal data (a household postcode,
 * a child's name and date of birth, an owner's email) and asserts none of
 * it appears in any log line this app's own `Logger` ever received, or in
 * any outbox event payload — the two places `events.ts`'s own doc comment
 * and this controller's logging both promise never to carry it.
 */
describe('Principle VI: no personal data in a log line or an outbox payload', () => {
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

  it('never logs a display name, date of birth, postcode, or email — and never puts one in an outbox payload', async () => {
    const owner = await registerAndLogin(server, mailer);
    const postcode = 'SW1A 1AA';
    const childDisplayName = 'Bo the Uniquely Named Child';
    const childDateOfBirth = '2019-04-02';

    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada Distinctively Named Owner', postcode });
    const familyId = (created.body as { familyId: string }).familyId;

    const addChild = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'child', displayName: childDisplayName, dateOfBirth: childDateOfBirth });
    const childId = (addChild.body as { memberId: string }).memberId;

    // A denied read (nobody guards this child from the owner's own
    // perspective would be wrong — the owner DID add the child, so this is
    // actually granted; the point of this call is just to exercise the
    // audited read path, not to test FR-007 again).
    await request(server)
      .get(`/v1/families/${familyId}/members/${childId}`)
      .set('Authorization', `Bearer ${owner.token}`);

    await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);

    const combinedLog = logger.messages.join('\n');
    expect(combinedLog).not.toContain(childDisplayName);
    expect(combinedLog).not.toContain(childDateOfBirth);
    expect(combinedLog).not.toContain(postcode);
    expect(combinedLog).not.toContain(owner.email);
    // Sanity check that this actually captured something meaningful.
    expect(logger.messages.length).toBeGreaterThan(0);

    const events = await withDatabase((tx) =>
      tx.outboxEvent.findMany({
        where: { OR: [{ aggregateId: familyId }, { aggregateId: childId }] },
      }),
    );
    expect(events.length).toBeGreaterThan(0);
    const combinedPayloads = JSON.stringify(events.map((event) => event.payload));
    expect(combinedPayloads).not.toContain(childDisplayName);
    expect(combinedPayloads).not.toContain(childDateOfBirth);
    expect(combinedPayloads).not.toContain(postcode);
    expect(combinedPayloads).not.toContain(owner.email);
  });
});
