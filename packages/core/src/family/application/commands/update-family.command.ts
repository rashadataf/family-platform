import { err, ok, type Clock, type DomainError, type FamilyId, type Result } from '@fp/kernel';
import type { Family } from '../../domain/family.aggregate.js';
import { HouseholdProfile, type HouseholdComposition } from '../../domain/household-profile.vo.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface UpdateFamilyInput {
  familyId: FamilyId;
  name?: string;
  postcode?: string | null;
  localAuthorityCode?: string | null;
  composition?: HouseholdComposition | null;
}

/**
 * FR-002: the household profile is an attribute of the family, updatable
 * without touching any member record.
 *
 * No event. None of the six in ARCHITECTURE.md §5.2 covers a profile edit, and
 * inventing a seventh to fill the gap would be adding to a published catalogue
 * for the convenience of a feature with no subscriber.
 */
export async function updateFamily(
  input: UpdateFamilyInput,
  deps: { unitOfWork: FamilyUnitOfWorkPort; clock: Clock },
): Promise<Result<Family, DomainError>> {
  const now = deps.clock.now();

  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const aggregate = await uow.families.findCurrent();
    if (aggregate === null) return err({ kind: 'NotFound' });

    if (input.name !== undefined) {
      const renamed = aggregate.rename(input.name, now);
      if (!renamed.ok) return err(renamed.error);
    }

    // A PATCH touches only the fields it names: `undefined` keeps whatever the
    // family already had, `null` clears it. Rebuilding the whole profile from
    // just this input (the earlier version of this command did) would wipe
    // out a postcode nobody asked to change just because the caller only
    // meant to rename the family.
    const touchesProfile =
      input.postcode !== undefined ||
      input.localAuthorityCode !== undefined ||
      input.composition !== undefined;
    if (touchesProfile) {
      aggregate.updateProfile(
        HouseholdProfile.from({
          postcode: input.postcode !== undefined ? input.postcode : aggregate.profile.postcode,
          localAuthorityCode:
            input.localAuthorityCode !== undefined
              ? input.localAuthorityCode
              : aggregate.profile.localAuthorityCode,
          composition:
            input.composition !== undefined ? input.composition : aggregate.profile.composition,
        }),
        now,
      );
    }

    await uow.families.save(aggregate);
    return ok(aggregate);
  });
}
