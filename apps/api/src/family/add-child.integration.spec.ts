import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

describe('POST /v1/families/:familyId/members — adding a child (US2, FR-003, FR-005)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  async function createFamily(token: string): Promise<string> {
    const response = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    return (response.body as { familyId: string }).familyId;
  }

  it('creates a child with no account, makes the adder a guardian, and writes both outbox rows for the same aggregate', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);
    const mailCountBefore = mailer.sent.length;

    const response = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'child', displayName: 'Bo', dateOfBirth: '2019-04-02' });

    expect(response.status).toBe(201);
    const { memberId } = response.body as { memberId: string };
    expect(typeof memberId).toBe('string');

    // No login path: nothing here ever sends mail, because a child gets no
    // account and therefore no verification email (FR-003).
    expect(mailer.sent.length).toBe(mailCountBefore);

    // Confirmed by reading it back rather than a roster field: the roster
    // never shows userId either way, but this is the fact FR-003 requires.
    const roster = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    const childRow = (roster.body as { id: string; kind: string }[]).find((m) => m.id === memberId);
    expect(childRow?.kind).toBe('child');

    // Both `MemberAdded` and `GuardianshipEstablished` address the child as
    // their aggregate — reading them back proves both landed, and the
    // command's own unit test (`add-member.command.spec.ts`) is what proves
    // they land inside the SAME transaction, which nothing at this layer can
    // observe directly.
    const events = await withDatabase((tx) =>
      tx.outboxEvent.findMany({ where: { aggregateId: memberId }, orderBy: { eventType: 'asc' } }),
    );
    expect(events.map((event) => event.eventType).sort()).toEqual([
      'family.GuardianshipEstablished.v1',
      'family.MemberAdded.v1',
    ]);
  });

  it('rejects a missing display name with 422 family/name_required', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);

    const response = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'child', displayName: '' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ type: 'family/name_required' });
  });
});
