import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readAuditLogRows,
  resolvedTestDatabaseOwnerUrl,
  scopeTo,
  seedMember,
  withDatabaseCommitted,
} from '@fp/testing';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

describe('auditing a child record read (US2, FR-009, Principle VI)', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes exactly one row for a granted read and exactly one for a denied read, both naming actor, subject, purpose and result', async () => {
    const owner = await registerAndLogin(server, mailer);
    const createFamily = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    const familyId = (createFamily.body as { familyId: string; ownerMemberId: string }).familyId;
    const ownerMemberId = (createFamily.body as { ownerMemberId: string }).ownerMemberId;

    const graceCaller = await registerAndLogin(server, mailer);
    let graceMemberId = '';
    await withDatabaseCommitted(async (tx) => {
      const user = await tx.user.findFirstOrThrow({ where: { email: graceCaller.email } });
      await scopeTo(tx, familyId);
      const seeded = await seedMember(tx, { familyId, role: 'adult', userId: user.id });
      graceMemberId = seeded.memberId;
    });

    const addChild = await request(server)
      .post(`/v1/families/${familyId}/members`)
      .set('Authorization', `Bearer ${graceCaller.token}`)
      .send({ kind: 'child', displayName: 'Bo', dateOfBirth: '2019-04-02' });
    const childId = (addChild.body as { memberId: string }).memberId;

    // Denied: the owner is not this child's guardian.
    const denied = await request(server)
      .get(`/v1/families/${familyId}/members/${childId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(denied.status).toBe(403);

    // Granted: the actual guardian.
    const granted = await request(server)
      .get(`/v1/families/${familyId}/members/${childId}`)
      .set('Authorization', `Bearer ${graceCaller.token}`);
    expect(granted.status).toBe(200);

    const rows = await readAuditLogRows(resolvedTestDatabaseOwnerUrl(), childId);
    expect(rows).toHaveLength(2);

    const deniedRow = rows.find((row) => row.result === 'denied');
    expect(deniedRow).toMatchObject({
      actorMemberId: ownerMemberId,
      familyId,
      subjectType: 'family_member',
      subjectId: childId,
      action: 'child_record.read',
      purpose: 'member detail view',
      result: 'denied',
    });
    expect(deniedRow?.reason).not.toBeNull();

    const grantedRow = rows.find((row) => row.result === 'granted');
    expect(grantedRow).toMatchObject({
      actorMemberId: graceMemberId,
      familyId,
      subjectType: 'family_member',
      subjectId: childId,
      action: 'child_record.read',
      purpose: 'member detail view',
      result: 'granted',
    });
  });
});
