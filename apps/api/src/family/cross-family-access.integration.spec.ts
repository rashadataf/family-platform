import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { familyContract } from '@fp/contracts';
import { bootstrapTestApp } from '../identity/test-support/bootstrap-test-app.js';
import type { FakeMailer } from '../identity/test-support/fake-mailer.js';
import { registerAndLogin } from './test-support/register-and-login.js';

interface RouteUnderTest {
  readonly key: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
}

/**
 * The full family-scoped table from contracts/family-api.md — every route
 * that carries a `:familyId` and therefore must run `FamilyMembershipGuard`.
 * Hand-copied here (rather than only derived from the contract, below) so a
 * route silently dropped from the contract — or added to it without ever
 * reaching this list — fails the comparison instead of vanishing quietly.
 */
const expectedFamilyScopedRoutes: readonly RouteUnderTest[] = [
  { key: 'getFamily', method: 'GET', path: '/v1/families/:familyId' },
  { key: 'updateFamily', method: 'PATCH', path: '/v1/families/:familyId' },
  { key: 'requestFamilyDeletion', method: 'DELETE', path: '/v1/families/:familyId' },
  { key: 'listMembers', method: 'GET', path: '/v1/families/:familyId/members' },
  { key: 'addMember', method: 'POST', path: '/v1/families/:familyId/members' },
  { key: 'readMember', method: 'GET', path: '/v1/families/:familyId/members/:memberId' },
  {
    key: 'changeMemberRole',
    method: 'PATCH',
    path: '/v1/families/:familyId/members/:memberId/role',
  },
  { key: 'removeMember', method: 'DELETE', path: '/v1/families/:familyId/members/:memberId' },
  {
    key: 'transferOwnership',
    method: 'POST',
    path: '/v1/families/:familyId/ownership-transfer',
  },
  { key: 'listInvitations', method: 'GET', path: '/v1/families/:familyId/invitations' },
  { key: 'createInvitation', method: 'POST', path: '/v1/families/:familyId/invitations' },
  {
    key: 'revokeInvitation',
    method: 'DELETE',
    path: '/v1/families/:familyId/invitations/:invitationId',
  },
  {
    key: 'grantGuardianship',
    method: 'POST',
    path: '/v1/families/:familyId/members/:memberId/guardians',
  },
  {
    key: 'endGuardianship',
    method: 'DELETE',
    path: '/v1/families/:familyId/members/:memberId/guardians/:guardianMemberId',
  },
];

function byKeyThenMethod(a: RouteUnderTest, b: RouteUnderTest): number {
  return a.key === b.key ? a.method.localeCompare(b.method) : a.key.localeCompare(b.key);
}

/** Substitutes every `:param` in a contract path with a fresh identifier — `:familyId` with the family under test, everything else with a random id the guard never gets far enough to look up. */
function buildPath(template: string, familyId: string): string {
  return template.replace(/:([a-zA-Z]+)/g, (_match, name: string) =>
    name === 'familyId' ? familyId : crypto.randomUUID(),
  );
}

/**
 * SC-004 / FR-021: no family-scoped route may ever tell a caller outside the
 * family whether it exists. `FamilyMembershipGuard` runs ahead of every
 * handler and every ts-rest body/param validation (guards execute before
 * pipes in Nest's request lifecycle), so a stranger's malformed or empty
 * body never reaches validation — the 404 comes from the guard alone,
 * regardless of what the request otherwise carries.
 */
describe('SC-004: every family-scoped route 404s identically for a non-member', () => {
  let app: INestApplication;
  let server: Server;
  let mailer: FakeMailer;
  let familyId: string;
  let strangerToken: string;

  beforeAll(async () => {
    ({ app, server, mailer } = await bootstrapTestApp());

    const owner = await registerAndLogin(server, mailer);
    const created = await request(server)
      .post('/v1/families')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Lovelace', ownerDisplayName: 'Ada' });
    familyId = (created.body as { familyId: string }).familyId;

    const stranger = await registerAndLogin(server, mailer);
    strangerToken = stranger.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("the route list above matches the contract's own family-scoped routes", () => {
    const actual = Object.entries(familyContract)
      .map(([key, route]) => ({ key, method: route.method, path: route.path }))
      .filter((route) => route.path.includes(':familyId'))
      .sort(byKeyThenMethod);

    expect(actual).toEqual([...expectedFamilyScopedRoutes].sort(byKeyThenMethod));
  });

  it.each(expectedFamilyScopedRoutes)(
    '$method $path returns 404 family/not_found, identical for a non-member and a genuinely missing family',
    async ({ method, path }) => {
      const verb = method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';

      const nonMember = await request(server)
        [verb](buildPath(path, familyId))
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({});
      expect(nonMember.status).toBe(404);
      expect(nonMember.body).toEqual({ type: 'family/not_found' });

      const missingFamily = await request(server)
        [verb](buildPath(path, crypto.randomUUID()))
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({});
      expect(missingFamily.status).toBe(404);
      expect(missingFamily.body).toEqual(nonMember.body);
    },
  );
});
