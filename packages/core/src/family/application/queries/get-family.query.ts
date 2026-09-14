import type { FamilyId } from '@fp/kernel';
import type { Family } from '../../domain/family.aggregate.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

/**
 * `GET /v1/families/:familyId`. `FamilyMembershipGuard` has already resolved
 * the caller's standing in this family by the time this runs, so all this
 * does is read the row the guard just proved the caller may see — scoped the
 * same way, inside its own `withFamilyContext`, rather than trusting the
 * guard's transaction to still be open.
 */
export async function getFamily(
  input: { familyId: FamilyId },
  deps: { unitOfWork: FamilyUnitOfWorkPort },
): Promise<Family | null> {
  return deps.unitOfWork.withFamilyContext(input.familyId, (uow) => uow.families.findCurrent());
}
