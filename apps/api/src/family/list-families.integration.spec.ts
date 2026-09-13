import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

interface FamilyMembershipBody {
  familyId: string;
  name: string;
  role: string;
  capabilities: string[];
}

describe('GET /v1/families', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  async function createFamily(token: string, name: string): Promise<string> {
    const response = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, ownerDisplayName: 'Ada' });
    return (response.body as { familyId: string }).familyId;
  }

  it("returns only the caller's own memberships, with capabilities present and role not load-bearing (FR-024)", async () => {
    const { token } = await registerAndLogin(server, mailer);
    const familyA = await createFamily(token, 'Lovelace');
    const familyB = await createFamily(token, 'Byron');

    const response = await request(server)
      .get('/v1/families')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const memberships = response.body as FamilyMembershipBody[];
    const ids = memberships.map((membership) => membership.familyId);
    expect(ids).toContain(familyA);
    expect(ids).toContain(familyB);
    // The client is given capabilities, not a role to branch on (FR-015).
    for (const membership of memberships) {
      expect(membership.role).toBe('owner');
      expect(membership.capabilities).toContain('billing:manage');
      expect(membership.capabilities).toContain('family:delete');
    }
  });

  it("does not include another user's family (FR-024)", async () => {
    const owner = await registerAndLogin(server, mailer);
    await createFamily(owner.token, 'Lovelace');

    const stranger = await registerAndLogin(server, mailer);
    const strangerFamily = await createFamily(stranger.token, 'Turing');

    const response = await request(server)
      .get('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`);

    expect(response.status).toBe(200);
    const ids = (response.body as FamilyMembershipBody[]).map((membership) => membership.familyId);
    expect(ids).not.toContain(strangerFamily);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(server).get('/v1/families');
    expect(response.status).toBe(401);
  });
});
