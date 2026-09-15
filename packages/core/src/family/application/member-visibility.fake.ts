import type { FamilyId, FamilyMemberId } from '@fp/kernel';
import type { MemberVisibility, MemberVisibilityPort } from './ports/member-visibility.port.js';

/**
 * An in-memory `MemberVisibilityPort` for unit tests of the handlers that
 * consume it, mirroring `family-unit-of-work.fake.ts`: a plain map from viewer
 * to what they may see.
 *
 * It models the port's CONTRACT, not its implementation. Whether the real
 * adapter returns the right members for real guardianship rows is proven
 * against a database, in `member-visibility.integration.spec.ts`, and nowhere
 * else — a fake that computed guardianship would let a test prove a rule only
 * the fake enforces.
 *
 * A viewer absent from the map sees nobody, which is the port's own fail-closed
 * behaviour rather than a convenience default.
 */
export function fakeMemberVisibility(
  byViewer: ReadonlyMap<FamilyMemberId, MemberVisibility>,
): MemberVisibilityPort & { readonly calls: { viewer: FamilyMemberId; familyId: FamilyId }[] } {
  const calls: { viewer: FamilyMemberId; familyId: FamilyId }[] = [];
  return {
    calls,
    resolveVisibleMemberIds: (viewerMemberId: FamilyMemberId, familyId: FamilyId) => {
      calls.push({ viewer: viewerMemberId, familyId });
      return Promise.resolve(
        byViewer.get(viewerMemberId) ?? { visibleMemberIds: [], guardedChildIds: [] },
      );
    },
  };
}
