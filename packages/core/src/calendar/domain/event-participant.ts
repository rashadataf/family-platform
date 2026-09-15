import type { FamilyMemberId } from '@fp/kernel';

/**
 * The link between an event and a family member it concerns (FR-015).
 *
 * A member id and a timestamp — deliberately nothing else. No `kind`, no
 * `dateOfBirth`, no `guardianId`, no display name: Calendar does not know who
 * is a child, and does not need to, because FR-016 is answered by asking the
 * Family context which members a reader may see (research.md §1). A cached
 * classification here would go stale the day a child's record changed, and
 * would be exactly the data an erasure saga fails to reach.
 *
 * `event-participant.spec.ts` pins this shape so a later change cannot widen
 * it without a test failing first.
 */
export interface EventParticipant {
  readonly memberId: FamilyMemberId;
  readonly addedAt: Date;
}
