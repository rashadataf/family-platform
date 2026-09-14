import type { UserId } from '@fp/kernel';
import type { IdentityUnitOfWorkPort } from '../ports/identity-unit-of-work.port.js';

/**
 * The reverse of `resolveUserIdByEmail`, needed by the same caller: Family's
 * invitation acceptance verifies the AUTHENTICATED account's email against
 * the invitation's (FR-011), and `identityContext` (set by `SessionGuard`)
 * carries only a `UserId` — the session credential proves who is calling,
 * not what their email is.
 */
export async function resolveEmailByUserId(
  input: { userId: UserId },
  deps: { unitOfWork: IdentityUnitOfWorkPort },
): Promise<string | null> {
  return deps.unitOfWork.run(async (uow) => {
    const user = await uow.users.findById(input.userId);
    return user?.email.value ?? null;
  });
}
