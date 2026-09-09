import { prisma } from '../src/client.js';

/**
 * Fixture-only (FR-010/FR-011). Seeds exactly one row into `ScaffoldProbe` —
 * the only table that exists today (spec 001's scaffolding). Proves the
 * seeding mechanism end to end against today's schema; a later feature that
 * adds real domain schema adds its own fixture content to this same script
 * (data-model.md's "growth path"), not a rebuilt seeding pipeline.
 *
 * `upsert` on a fixed id, not `create`, so this is safe to run on every
 * ordinary staging deploy (infrastructure/src/deploy.ts) without
 * accumulating a new row each time — FR-012 requires previously seeded or
 * founder-generated data to survive a repeat deploy, and an idempotent seed
 * is what makes "always run it" a safe choice instead of needing to track
 * whether this is the database's first deploy.
 */
const FIXTURE_SCAFFOLD_PROBE_ID = '00000000-0000-4000-8000-000000000001';

async function main(): Promise<void> {
  await prisma.scaffoldProbe.upsert({
    where: { id: FIXTURE_SCAFFOLD_PROBE_ID },
    create: { id: FIXTURE_SCAFFOLD_PROBE_ID },
    update: {},
  });
  console.log('Seeded fixture data.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
