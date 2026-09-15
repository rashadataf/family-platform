import { randomUUID } from 'node:crypto';
import { asFamilyId, asFamilyMemberId } from '@fp/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma/index.js';
import { PrismaMemberVisibility } from './member-visibility.js';

/**
 * Spec 009 T041: `MemberVisibilityPort`'s real behaviour against real
 * guardianship rows. Handler tests use a fake; this is where the rule itself
 * is proven.
 */
describe('PrismaMemberVisibility (research.md §1, FR-016)', () => {
  const familyId = randomUUID();
  const otherFamilyId = randomUUID();
  const owner = randomUUID();
  const adult = randomUUID();
  const guardedChild = randomUUID();
  const unguardedChild = randomUUID();
  const guardianshipId = randomUUID();
  const outsider = randomUUID();
  const client = new PrismaClient();
  const port = new PrismaMemberVisibility();

  async function scoped<T>(
    family: string,
    work: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  ) {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.family_id', ${family}::text, true)`;
      return work(tx);
    });
  }

  beforeAll(async () => {
    await scoped(familyId, async (tx) => {
      await tx.family.create({ data: { id: familyId, name: 'Visibility' } });
      await tx.familyMember.createMany({
        data: [
          {
            id: owner,
            familyId,
            kind: 'adult',
            role: 'owner',
            userId: randomUUID(),
            displayName: 'Ada',
          },
          {
            id: adult,
            familyId,
            kind: 'adult',
            role: 'adult',
            userId: randomUUID(),
            displayName: 'Grace',
          },
          { id: guardedChild, familyId, kind: 'child', role: 'viewer', displayName: 'Charlie' },
          { id: unguardedChild, familyId, kind: 'child', role: 'viewer', displayName: 'Dana' },
        ],
      });
      await tx.guardianship.create({
        data: {
          id: guardianshipId,
          familyId,
          guardianMemberId: owner,
          childMemberId: guardedChild,
        },
      });
      await tx.guardianship.create({
        data: { familyId, guardianMemberId: adult, childMemberId: unguardedChild },
      });
    });
    await scoped(otherFamilyId, async (tx) => {
      await tx.family.create({ data: { id: otherFamilyId, name: 'Elsewhere' } });
      await tx.familyMember.create({
        data: {
          id: outsider,
          familyId: otherFamilyId,
          kind: 'adult',
          role: 'owner',
          userId: randomUUID(),
          displayName: 'Ed',
        },
      });
    });
  });

  afterAll(async () => {
    await scoped(familyId, (tx) => tx.family.deleteMany({}));
    await scoped(otherFamilyId, (tx) => tx.family.deleteMany({}));
    await client.$disconnect();
  });

  it('returns every adult plus the children the viewer guards, and excludes a child they do not', async () => {
    const result = await port.resolveVisibleMemberIds(
      asFamilyMemberId(owner),
      asFamilyId(familyId),
    );

    expect([...result.visibleMemberIds].sort()).toEqual([owner, adult, guardedChild].sort());
    expect(result.visibleMemberIds).not.toContain(unguardedChild);
    expect(result.guardedChildIds).toEqual([guardedChild]);
  });

  it('never returns a member of another family', async () => {
    const result = await port.resolveVisibleMemberIds(
      asFamilyMemberId(owner),
      asFamilyId(familyId),
    );
    expect(result.visibleMemberIds).not.toContain(outsider);
  });

  it('reflects an ended guardianship on the very next call, with nothing cached', async () => {
    const before = await port.resolveVisibleMemberIds(
      asFamilyMemberId(owner),
      asFamilyId(familyId),
    );
    expect(before.visibleMemberIds).toContain(guardedChild);

    await scoped(familyId, (tx) =>
      tx.guardianship.update({ where: { id: guardianshipId }, data: { endedAt: new Date() } }),
    );

    const after = await port.resolveVisibleMemberIds(asFamilyMemberId(owner), asFamilyId(familyId));
    expect(after.visibleMemberIds).not.toContain(guardedChild);
    expect(after.guardedChildIds).toEqual([]);
  });

  it('fails closed for a family the viewer names but has no rows in: adults of nowhere, children of no one', async () => {
    const result = await port.resolveVisibleMemberIds(
      asFamilyMemberId(owner),
      asFamilyId(randomUUID()),
    );
    expect(result).toEqual({ visibleMemberIds: [], guardedChildIds: [] });
  });
});
