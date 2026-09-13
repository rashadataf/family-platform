import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import type { FakeMailer } from '../../identity/test-support/fake-mailer.js';

export interface AuthenticatedCaller {
  readonly email: string;
  readonly token: string;
}

/**
 * Family routes need an authenticated caller but have nothing of their own to
 * say about how one is produced — that is entirely Identity's flow (spec
 * 006). Shared here rather than copied per spec file, the way
 * `apps/api/src/identity/*.integration.spec.ts` each redeclare it inline: the
 * family suites have no reason to keep re-deriving identity's own mechanics.
 */
export async function registerAndLogin(
  server: Server,
  mailer: FakeMailer,
): Promise<AuthenticatedCaller> {
  const email = `${randomUUID()}@example.com`;
  const password = 'correct horse battery staple';

  await request(server).post('/v1/identity/registrations').send({ email, password });
  const verificationToken = mailer.latestVerificationToken();
  await request(server).post('/v1/identity/verifications').send({ token: verificationToken });
  const login = await request(server).post('/v1/identity/sessions').send({ email, password });

  return { email, token: (login.body as { token: string }).token };
}
