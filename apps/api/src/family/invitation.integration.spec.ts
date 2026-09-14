import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin, type AuthenticatedCaller } from './test-support/register-and-login.js';

interface AcceptResponseBody {
  familyId: string;
  memberId: string;
}

/**
 * One shared owner and family across every test below, rather than the
 * usual per-test `registerAndLogin` + `createFamily` pair: `POST
 * /v1/identity/registrations` carries its own strict per-source rate limit
 * (contracts/identity-api.md — 10 per 60s, deliberately tight because
 * registration is this platform's automated-account-creation surface), and
 * this file's scenarios need enough distinct accounts that registering an
 * owner AND a counterpart for each of nine cases would exceed it well
 * within the window a real test run takes. Sharing the family is safe:
 * every scenario below uses its own randomly-generated email, so nothing
 * one test does to the shared family is visible to another's assertions.
 */
describe('Invitations (US3, FR-011, FR-013)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let owner: AuthenticatedCaller;
  let familyId: string;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
    owner = await registerAndLogin(server, mailer);
    const createFamily = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    familyId = (createFamily.body as { familyId: string }).familyId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function invite(
    email: string,
    proposedRole: 'adult' | 'extended' | 'viewer' = 'adult',
  ): Promise<string> {
    const response = await request(server)
      .post(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email, proposedRole });
    expect(response.status).toBe(201);
    return (response.body as { invitationId: string }).invitationId;
  }

  async function registerVerifyAndLogin(
    email: string,
    password: string,
  ): Promise<AuthenticatedCaller> {
    await request(server).post('/v1/identity/registrations').send({ email, password });
    const verificationToken = mailer.latestVerificationToken();
    await request(server).post('/v1/identity/verifications').send({ token: verificationToken });
    const login = await request(server).post('/v1/identity/sessions').send({ email, password });
    return { email, token: (login.body as { token: string }).token };
  }

  it('invites an uppercase address, accepts as the account registered lowercase, and links the member (US3 Scenario 1)', async () => {
    const password = 'correct horse battery staple';
    const email = `grace-${randomUUID()}@example.com`;
    const grace = await registerVerifyAndLogin(email, password);

    await invite(email.toUpperCase(), 'adult');
    const invitationToken = mailer.latestInvitationToken();

    const accept = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${grace.token}`)
      .send({ token: invitationToken });

    expect(accept.status).toBe(200);
    const body = accept.body as AcceptResponseBody;
    expect(body.familyId).toBe(familyId);

    const listing = await request(server)
      .get('/v1/families')
      .set('Authorization', `Bearer ${grace.token}`);
    const membership = (listing.body as { familyId: string; role: string }[]).find(
      (m) => m.familyId === familyId,
    );
    expect(membership?.role).toBe('adult');
  });

  it('invites an address with no account yet, then works once one exists (US3 Scenario 3)', async () => {
    const email = `noaccount-${randomUUID()}@example.com`;
    await invite(email, 'viewer');
    const invitationToken = mailer.latestInvitationToken();

    const password = 'correct horse battery staple';
    const newcomer = await registerVerifyAndLogin(email, password);

    const accept = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${newcomer.token}`)
      .send({ token: invitationToken });

    expect(accept.status).toBe(200);
    expect((accept.body as AcceptResponseBody).familyId).toBe(familyId);
  });

  it('returns the same membership on a second acceptance rather than a duplicate', async () => {
    const email = `repeat-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    const caller = await registerVerifyAndLogin(email, password);
    await invite(email);
    const invitationToken = mailer.latestInvitationToken();

    const first = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${caller.token}`)
      .send({ token: invitationToken });
    const second = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${caller.token}`)
      .send({ token: invitationToken });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('rejects another account presenting the token with 403, creating nothing', async () => {
    const invitedEmail = `invited-${randomUUID()}@example.com`;
    await invite(invitedEmail);
    const invitationToken = mailer.latestInvitationToken();

    const stranger = await registerAndLogin(server, mailer);
    const response = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ token: invitationToken });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ type: 'family/invitation_email_mismatch' });

    const strangerFamilies = await request(server)
      .get('/v1/families')
      .set('Authorization', `Bearer ${stranger.token}`);
    const strangerMemberships = strangerFamilies.body as { familyId: string }[];
    expect(strangerMemberships.some((m) => m.familyId === familyId)).toBe(false);
  });

  it('rejects a redundant invitation to an email already a member of this family with 409', async () => {
    const email = `redundant-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    const caller = await registerVerifyAndLogin(email, password);
    await invite(email);
    const invitationToken = mailer.latestInvitationToken();
    await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${caller.token}`)
      .send({ token: invitationToken });

    const secondInvite = await request(server)
      .post(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email, proposedRole: 'adult' });

    expect(secondInvite.status).toBe(409);
    expect(secondInvite.body).toEqual({ type: 'family/already_member' });
  });

  it('rejects a pending duplicate invitation to the same email with 409', async () => {
    const email = `pending-dup-${randomUUID()}@example.com`;

    await invite(email);
    const secondInvite = await request(server)
      .post(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email, proposedRole: 'adult' });

    expect(secondInvite.status).toBe(409);
    expect(secondInvite.body).toEqual({ type: 'family/already_member' });
  });

  it('rejects a revoked token with 422 family/invitation_invalid', async () => {
    const email = `revoked-${randomUUID()}@example.com`;
    const password = 'correct horse battery staple';
    const caller = await registerVerifyAndLogin(email, password);
    const invitationId = await invite(email);
    const invitationToken = mailer.latestInvitationToken();

    const revoke = await request(server)
      .delete(`/v1/families/${familyId}/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(revoke.status).toBe(200);

    const accept = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${caller.token}`)
      .send({ token: invitationToken });

    expect(accept.status).toBe(422);
    expect(accept.body).toEqual({ type: 'family/invitation_invalid' });
  });

  it('rejects an unknown token with 422 family/invitation_invalid', async () => {
    const response = await request(server)
      .post('/v1/invitations/accept')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ token: 'not-a-real-token' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ type: 'family/invitation_invalid' });
  });

  it("lists and lets the owner revoke the family's own invitations (requires members:manage)", async () => {
    const email = `listed-${randomUUID()}@example.com`;
    const invitationId = await invite(email, 'extended');

    const listing = await request(server)
      .get(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(listing.status).toBe(200);
    const invitations = listing.body as { id: string; email: string; status: string }[];
    const found = invitations.find((invitation) => invitation.id === invitationId);
    expect(found).toMatchObject({ email, status: 'pending' });
  });
});
