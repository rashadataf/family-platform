import type { FamilyId, FamilyMemberId } from '@fp/kernel';

/**
 * Which of a family's members a viewer may see the records of (spec 009
 * research.md §1). The second published port of this context, alongside
 * `FamilyContextPort` — and like it, the entirety of what another context may
 * import on this subject.
 *
 * ## Why a separate port, not a field on `FamilyContext`
 *
 * `FamilyContextPort.resolve` runs on every family-scoped request in the
 * platform, budgeted as a single indexed lookup. Guardianship resolution would
 * join that cost permanently, on every request of every context, to serve the
 * few read paths that need it. And `FamilyContext` is a stable statement of
 * standing, while this is a list that moves whenever a guardianship is granted
 * or ended — two values with different freshness should not share an object a
 * consumer might cache.
 *
 * ## Why it returns what MAY be seen, not what may not
 *
 * It fails closed. An empty "restricted" list is both the normal answer for a
 * guardian and what a broken implementation returns, and a consumer cannot
 * tell them apart — so that shape's failure mode is showing a child's
 * appointments to the whole household. An empty visible set hides everything
 * instead: loud, and wrong in the safe direction.
 *
 * It also means a consumer never learns who is a child. "Does this record
 * involve anyone outside my visible set?" needs no notion of kind or age.
 *
 * ## Evaluated per call
 *
 * Nothing behind this port caches across calls. FR-016 requires guardianship
 * at the time of the read, so revoking one must change the very next answer.
 */
export interface MemberVisibility {
  /** Every adult member (including removed ones, whose tombstones still appear on old records), plus the children the viewer actively guards. */
  readonly visibleMemberIds: readonly FamilyMemberId[];
  /**
   * The subset of `visibleMemberIds` that are children the viewer guards.
   * Present so that a permitted read of a child's participation can be audited
   * (Principle VI) — it names only children the viewer is already entitled to
   * see, so it discloses nothing the visible set did not.
   */
  readonly guardedChildIds: readonly FamilyMemberId[];
}

export interface MemberVisibilityPort {
  resolveVisibleMemberIds(
    viewerMemberId: FamilyMemberId,
    familyId: FamilyId,
  ): Promise<MemberVisibility>;
}
