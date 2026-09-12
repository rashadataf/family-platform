import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { identity } from '@fp/core';
import { asUserId } from '@fp/kernel';
import { prisma } from '../src/client.js';
import { PrismaIdentityUnitOfWork } from '../src/repositories/identity/identity-unit-of-work.js';

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
 * This lives here, not in `apps/worker` alongside the retention sweeps,
 * because the migrator image that already runs this script on every staging
 * deploy is the only image the deploy pipeline builds and transfers today —
 * there is no equivalent worker runtime image (T087's note in
 * specs/006-identity-access/tasks.md). Hashing uses `@node-rs/argon2`
 * directly with `packages/platform/src/argon2-password-hasher.ts`'s exact
 * measured parameters, duplicated rather than imported: `packages/platform`
 * is off-limits to `packages/persistence` (`.dependency-cruiser.cjs`'s
 * `platform-has-no-domain`/layer rules run the other direction, but the
 * layer table only grants persistence `core` and `kernel`, not `platform`
 * either), so importing the real adapter class isn't an option here. If T090
 * ever re-measures those parameters, this constant must be updated to match.
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

  const emailAddress = identity.EmailAddress.from(email);
  const passwordHash = await hash(password, ARGON2_PARAMETERS);
  const now = new Date();

  const uow = new PrismaIdentityUnitOfWork(prisma);
  await uow.run(async ({ users }) => {
    const existing = await users.findByEmailAcrossAllStatuses(emailAddress.value);

    const user = identity.User.reconstitute({
      ...(existing?.toProps() ?? {
        id: asUserId(randomUUID()),
        email: emailAddress,
        emailVerifiedAt: now,
        deletionRequestedAt: null,
        createdAt: now,
      }),
      passwordHash,
      status: 'active',
      failedAttemptCount: 0,
      throttledUntil: null,
      updatedAt: now,
    });

    await users.save(user);
  });

  console.log(`seed-founder: ensured active account for ${emailAddress.value}`);
}

try {
  await seedFounderAccount();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
