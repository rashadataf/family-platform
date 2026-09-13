import { EmailAddress, type UserId } from '@fp/kernel';
import type { IdentityUnitOfWorkPort } from '../ports/identity-unit-of-work.port.js';

/**
 * The one cross-context read Family's invitation flow needs (FR-013: does
 * this email already belong to a member of the family?). Identity has no
 * concept of "family", so this stays a plain email → `UserId` lookup and
 * nothing more — the composition root (apps/api) is what combines this with
 * a family-scoped membership check; neither context imports the other.
 *
 * `null` covers both "no account" and "an account exists but is not this
 * feature's concern" (unverified, deletion-requested, …) — an invitation
 * only cares whether SOME account already answers to this email.
 */
export async function resolveUserIdByEmail(
  input: { email: string },
  deps: { unitOfWork: IdentityUnitOfWorkPort },
): Promise<UserId | null> {
  return deps.unitOfWork.run(async (uow) => {
    const user = await uow.users.findByEmailAcrossAllStatuses(EmailAddress.from(input.email).value);
    return user?.id ?? null;
  });
}
