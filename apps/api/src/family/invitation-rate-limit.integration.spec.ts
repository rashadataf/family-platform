import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

describe('POST /v1/families/:familyId/invitations — rate limit (T068)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('throttles after 10 invitations to the same family within the window', async () => {
    const owner = await registerAndLogin(server, mailer);
    const createFamily = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (createFamily.body as { familyId: string }).familyId;

    for (let i = 0; i < 10; i += 1) {
      const response = await request(server)
        .post(`/v1/families/${familyId}/invitations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ email: `invitee-${String(i)}@example.com`, proposedRole: 'adult' });
      expect(response.status).toBe(201);
    }

    const eleventh = await request(server)
      .post(`/v1/families/${familyId}/invitations`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: 'invitee-11@example.com', proposedRole: 'adult' });

    expect(eleventh.status).toBe(429);
  });
});
