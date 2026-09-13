import type { FamilyId, UserId } from '@fp/kernel';
import { capabilitiesFor } from '../../domain/capabilities.js';
import type { FamilyContext } from '../ports/family-context.port.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

/**
 * The implementation behind `FamilyContextPort` — layer 2 of ARCHITECTURE.md
 * §9, and the first thing that runs on every family-scoped request.
 *
 * ## Why this is scoped, when it looks like it cannot be
 *
 * There is an apparent ordering problem: `app.family_id` may only be set for a
 * family the caller has been authorized against, and resolving standing *is*
 * the authorization. The resolution is that the caller has already named the
 * family — it is in the path — so the transaction can be scoped to the
 * REQUESTED family and the query then asks a much narrower question: "is this
 * user a member of *this* family?"
 *
 * The row-level security policies therefore apply to this lookup like any
 * other, which is better than the unscoped read spec 008's research.md §3
 * anticipated. A caller naming a family they have nothing to do with gets a
 * transaction scoped to it and no rows back, because they have no member row
 * in it. Nothing can be enumerated: both identifiers come from the caller and
 * only the row matching both is ever returned.
 *
 * ## Why `null` covers four different things
 *
 * No membership, a removed membership, a family pending deletion, and a family
 * that does not exist all return `null`, and the caller cannot tell them apart
 * (FR-021). The audit log records which it was.
 */
export async function resolveFamilyContext(
  input: { userId: UserId; familyId: FamilyId },
  deps: { unitOfWork: FamilyUnitOfWorkPort },
): Promise<FamilyContext | null> {
  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const family = await uow.families.findCurrent();
    // A family whose deletion has been requested revokes every member's access
    // immediately (FR-023). Erasure follows later, on the saga's own grace
    // period, but standing ends the moment the request is made.
    if (family === null) return null;
    if (family.deletionRequestedAt !== null) return null;

    const standing = await uow.members.findStandingByUserId(input.userId);
    if (standing === null) return null;

    return {
      memberId: standing.memberId,
      role: standing.role,
      capabilities: capabilitiesFor(standing.role),
    };
  });
}
