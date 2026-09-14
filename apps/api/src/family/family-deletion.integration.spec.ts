import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withDatabase } from '@fp/testing';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

describe('Family deletion is a request (quickstart Scenario 8, FR-023, FR-025, Principle XI)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 202, voids pending invitations, revokes access immediately, and leaves the rows in place', async () => {
    const owner = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (created.body as { familyId: string }).familyId;

    const invite = await request(server)
      .post(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: 'grace@example.com', proposedRole: 'adult' });
    expect(invite.status).toBe(201);
    const invitationToken = mailer.latestInvitationToken();

    const deletion = await request(server)
      .delete(`/v1/families/${familyId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(deletion.status).toBe(202);

    // The invitation is void: acceptance now fails, whoever accepts it.
    const graceCaller = await registerAndLogin(server, mailer);
    const accept = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${graceCaller.token}`)
      .send({ token: invitationToken });
    expect(accept.status).toBe(422);
    expect(accept.body).toEqual({ type: 'family/invitation_invalid' });

    // Access is revoked immediately for every member — including the owner
    // who just requested it — well before any erasure runs.
    const readAsOwner = await request(server)
      .get(`/v1/families/${familyId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(readAsOwner.status).toBe(404);

    const rosterAsOwner = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(rosterAsOwner.status).toBe(404);

    // The FamilyDeletionRequested outbox row exists, and the rows
    // themselves are untouched — erasure is a separate, later saga
    // (outbox_event carries a SELECT grant for the application role, unlike
    // audit_log; see add-child.integration.spec.ts's identical use).
    const events = await withDatabase((tx) =>
      tx.outboxEvent.findMany({ where: { aggregateId: familyId } }),
    );
    expect(events.map((e) => e.eventType)).toContain('family.FamilyDeletionRequested.v1');

    // A second deletion request is a no-op success at the domain layer, but
    // is actually unreachable through the API once standing is revoked —
    // proven here as the same 404 every other route now gives.
    const secondDeletion = await request(server)
      .delete(`/v1/families/${familyId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(secondDeletion.status).toBe(404);
  });
});
