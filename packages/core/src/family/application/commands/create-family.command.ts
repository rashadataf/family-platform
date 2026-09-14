import {
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
  type UserId,
} from '@fp/kernel';
import { Family } from '../../domain/family.aggregate.js';
import { FamilyMember } from '../../domain/family-member.aggregate.js';
import { familyCreatedEvent, memberAddedEvent } from '../../domain/events.js';
import { HouseholdProfile, type HouseholdComposition } from '../../domain/household-profile.vo.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface CreateFamilyInput {
  familyId: FamilyId;
  ownerMemberId: FamilyMemberId;
  ownerUserId: UserId;
  ownerDisplayName: string;
  name: string;
  postcode?: string | null;
  localAuthorityCode?: string | null;
  composition?: HouseholdComposition | null;
  correlationId: string;
}

export interface CreateFamilyDeps {
  unitOfWork: FamilyUnitOfWorkPort;
  clock: Clock;
}

/**
 * FR-001. The family, its sole owner, and both events, in one transaction.
 *
 * ## The chicken and egg, and why it is not one
 *
 * Every other command runs inside a family context resolved from the caller's
 * standing. This one cannot: the family does not exist yet, so there is no
 * standing to resolve.
 *
 * It still runs inside `withFamilyContext`, scoped to the id being created.
 * The row-level security policies carry `WITH CHECK` as well as `USING`, so
 * the inserts are validated against `app.family_id` the same way every other
 * write is — a bug here that wrote a different family's id would be refused by
 * the database rather than by review. The scope is asserted before it is
 * populated, which is the opposite order from usual and works because the
 * caller chose the id.
 *
 * ## Why owner and family are one action
 *
 * SC-007 says every family has exactly one owner *at every point in time*, and
 * a family that briefly exists without one would falsify that. The
 * `family_one_owner` partial unique index enforces the ceiling; committing
 * both rows together is what enforces the floor.
 */
export async function createFamily(
  input: CreateFamilyInput,
  deps: CreateFamilyDeps,
): Promise<Result<{ familyId: FamilyId; ownerMemberId: FamilyMemberId }, DomainError>> {
  const now = deps.clock.now();

  const family = Family.create({
    id: input.familyId,
    name: input.name,
    profile: HouseholdProfile.from({
      postcode: input.postcode,
      localAuthorityCode: input.localAuthorityCode,
      composition: input.composition,
    }),
    now,
  });
  if (!family.ok) return err(family.error);
  const familyAggregate = family.value;

  const owner = FamilyMember.createOwner({
    id: input.ownerMemberId,
    familyId: input.familyId,
    userId: input.ownerUserId,
    displayName: input.ownerDisplayName,
    now,
  });
  if (!owner.ok) return err(owner.error);
  // Bound outside the closure: TypeScript's narrowing from `isErr` does not
  // survive into a callback, and Principle I bans the `!` that would paper
  // over that.
  const ownerAggregate = owner.value;

  // Both aggregates are valid before anything is written, so a rejected name
  // never opens a transaction.
  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    await uow.families.save(familyAggregate);
    await uow.members.save(ownerAggregate);

    await uow.outbox.append(
      familyCreatedEvent({
        familyId: input.familyId,
        ownerMemberId: input.ownerMemberId,
        ownerUserId: input.ownerUserId,
        correlationId: input.correlationId,
      }),
    );
    // The owner is a member, so MemberAdded fires too. A consumer counting
    // members from events must not have to special-case the first one.
    await uow.outbox.append(
      memberAddedEvent({
        familyId: input.familyId,
        memberId: input.ownerMemberId,
        kind: 'adult',
        role: 'owner',
        userId: input.ownerUserId,
        correlationId: input.correlationId,
      }),
    );

    return ok({ familyId: input.familyId, ownerMemberId: input.ownerMemberId });
  });
}
