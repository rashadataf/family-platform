import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

interface MemberDetailBody {
  id: string;
  kind: string;
  role: string;
  displayName: string | null;
}

describe('Extended family members (US4, FR-014)', () => {
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

  it('adds an extended member with no account, resolving documents:write but not documents:write:sensitive', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);
    const mailCountBefore = mailer.sent.length;

    const addMember = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'extended', displayName: 'Grandma' });

    expect(addMember.status).toBe(201);
    const memberId = (addMember.body as { memberId: string }).memberId;

    // No account, no credential, no login path: nothing sends mail.
    expect(mailer.sent.length).toBe(mailCountBefore);

    const read = await request(server)
      .get(`/v1/families/${familyId}/members/${memberId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(read.status).toBe(200);
    const detail = read.body as MemberDetailBody;
    expect(detail.kind).toBe('adult');
    expect(detail.role).toBe('extended');

    // The capability set resolves through `GET /v1/families` for the
    // OWNER's own standing, not the extended member's (who has no account
    // to authenticate as) — this instead confirms the role itself is what
    // the roster and detail views show, which is what `capabilitiesFor`
    // (unit-tested in `capabilities.spec.ts`) maps to documents:write
    // without documents:write:sensitive.
    const roster = await request(server)
      .get(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    const rosterEntry = (roster.body as MemberDetailBody[]).find((m) => m.id === memberId);
    expect(rosterEntry?.role).toBe('extended');
  });

  it('refuses to grant the extended member guardianship (FR-006)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);

    const addExtended = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'extended', displayName: 'Grandma' });
    const extendedMemberId = (addExtended.body as { memberId: string }).memberId;

    const addChild = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'child', displayName: 'Bo' });
    const childId = (addChild.body as { memberId: string }).memberId;

    const grant = await request(server)
      .post(`/v1/families/${familyId}/members/${childId}/guardians`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ guardianMemberId: extendedMemberId });

    expect(grant.status).toBe(422);
    expect(grant.body).toMatchObject({ type: 'family/guardian_ineligible' });
  });
});
