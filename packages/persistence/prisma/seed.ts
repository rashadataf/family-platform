import { prisma } from '../src/client.js';

/**
 * Fixture-only (FR-010/FR-011 in spec 001). No fixture content yet: spec 006
 * (Identity and Access) is Stage 0's first real domain schema and holds
 * synthetic data only by ADR-013, with no seeded account required by any
 * quickstart scenario. This script stays in place, rather than being
 * deleted, so `prisma db seed` — invoked on every staging deploy
 * (infrastructure/src/deploy.ts) — keeps succeeding; a future feature that
 * needs seeded fixture rows adds them here.
 */
try {
  console.log('No fixtures to seed for the current schema.');
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
