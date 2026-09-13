import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeTo, seedMember, withDatabaseCommitted } from '@fp/testing';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

interface FamilyBody {
  id: string;
  name: string;
  postcode: string | null;
  localAuthorityCode: string | null;
  composition: { adults: number; children: number } | null;
}

describe('GET & PATCH /v1/families/:familyId', () => {
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

  it('succeeds for a member (the owner)', async () => {
    const { token } = await registerAndLogin(server, mailer);
    const familyId = await createFamily(token);

    const response = await request(server)
      .get(`/v1/families/${familyId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect((response.body as FamilyBody).name).toBe('Lovelace');
  });

  it('returns 404 for a member of another family (FR-021)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);

    const stranger = await registerAndLogin(server, mailer);

    const response = await request(server)
      .get(`/v1/families/${familyId}`)
      .set('Authorization', `Bearer ${stranger.token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ type: 'family/not_found' });
  });

  it('lets the owner update the name and household profile (FR-002)', async () => {
    const { token } = await registerAndLogin(server, mailer);
    const familyId = await createFamily(token);

    const response = await request(server)
      .patch(`/v1/families/${familyId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Byron', postcode: 'sw1a 1aa' });

    expect(response.status).toBe(200);
    const body = response.body as FamilyBody;
    expect(body.name).toBe('Byron');
    expect(body.postcode).toBe('SW1A 1AA');
  });

  it('requires family:manage — a viewer can read but not update (FR-015)', async () => {
    const owner = await registerAndLogin(server, mailer);
    const familyId = await createFamily(owner.token);

    const viewer = await registerAndLogin(server, mailer);
    await withDatabaseCommitted(async (tx) => {
      const user = await tx.user.findFirstOrThrow({ where: { email: viewer.email } });
      await scopeTo(tx, familyId);
      await seedMember(tx, { familyId, role: 'viewer', userId: user.id, displayName: 'Grace' });
    });

    const read = await request(server)
      .get(`/v1/families/${familyId}`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(read.status).toBe(200);

    const update = await request(server)
      .patch(`/v1/families/${familyId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ name: 'Should not apply' });

    expect(update.status).toBe(403);
    expect(update.body).toMatchObject({
      type: 'family/capability_required',
      capability: 'family:manage',
    });
  });

  it('rejects a rename to an empty name with 422 family/name_required', async () => {
    const { token } = await registerAndLogin(server, mailer);
    const familyId = await createFamily(token);

    const response = await request(server)
      .patch(`/v1/families/${familyId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ type: 'family/name_required' });
  });
});
