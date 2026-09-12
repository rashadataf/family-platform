import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { prisma } from '../src/client.js';

/**
 * Fixture-only (FR-010/FR-011 in spec 001), plus one deliberate exception:
 * an already-verified founder account for staging's own "founder
 * dogfooding" purpose (docs/staging-environment.md), not required by any
 * spec 006 quickstart scenario. `FOUNDER_EMAIL`/`FOUNDER_PASSWORD` arrive as
 * plain env vars, threaded through by `infrastructure/src/deploy.ts` from
 * Pulumi secret config the same way `POSTGRES_PASSWORD` already is; both
 * unset (true for every environment except a deploy configured with them)
 * skips this entirely, so an ordinary local `prisma db seed` stays a no-op.
 *
 * Writes through the raw Prisma client rather than `@fp/core`'s `User`
 * aggregate or `@fp/persistence`'s own `PrismaIdentityUnitOfWork` — confirmed
 * the hard way (a real staging deploy failure, ERR_MODULE_NOT_FOUND on
 * `@fp/core/dist/index.js`): the `migrator` Docker image (apps/api/Dockerfile)
 * only ever builds `@fp/persistence`'s own source into this stage, exactly
 * as that Dockerfile's own comment on why this file imports `client.ts`
 * directly already explains for the persistence side of the same
 * constraint. No other workspace package's `dist/` exists inside that image,
 * so importing `@fp/core` or `@fp/kernel` resolves fine in every local
 * check (`pnpm build`/`typecheck`/`lint`/`boundaries`, and even a seed run
 * against a local Postgres from the host shell, where every package is
 * already built) and then fails only inside the real container — which is
 * why this was missed before merging. `@node-rs/argon2` is a plain npm
 * dependency, not a workspace package, so it doesn't have this problem.
 *
 * Email normalisation is duplicated from `EmailAddress.from()`
 * (packages/core/src/identity/domain/email-address.vo.ts, FR-022) rather
 * than imported, for the same reason.
 */
const ARGON2_PARAMETERS = {
  algorithm: 2, // Algorithm.Argon2id
  memoryCost: 47104,
  timeCost: 1,
  parallelism: 1,
};

async function seedFounderAccount(): Promise<void> {
  const email = process.env.FOUNDER_EMAIL;
  const password = process.env.FOUNDER_PASSWORD;

  if (!email || !password) {
    console.log('seed-founder: FOUNDER_EMAIL/FOUNDER_PASSWORD not set, skipping.');
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await hash(password, ARGON2_PARAMETERS);
  const now = new Date();

  await prisma.user.upsert({
    where: { email: normalizedEmail },
    create: {
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash,
      status: 'active',
      emailVerifiedAt: now,
    },
    update: {
      passwordHash,
      status: 'active',
      emailVerifiedAt: now,
      deletionRequestedAt: null,
      failedAttemptCount: 0,
      throttledUntil: null,
    },
  });

  console.log(`seed-founder: ensured active account for ${normalizedEmail}`);
}

try {
  await seedFounderAccount();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
