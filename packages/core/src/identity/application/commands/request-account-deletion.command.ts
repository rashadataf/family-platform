import { err, ok, type Clock, type DomainError, type Result, type UserId } from '@fp/kernel';
import { userDeletionRequestedEvent } from '../../domain/events.js';
import type { IdentityUnitOfWorkPort } from '../ports/identity-unit-of-work.port.js';

export interface RequestAccountDeletionInput {
  userId: UserId;
  correlationId: string;
}

export interface RequestAccountDeletionDeps {
  unitOfWork: IdentityUnitOfWorkPort;
  clock: Clock;
}

/**
 * FR-014/FR-015: marks the account for deletion and immediately revokes
 * every session it has, active or not — a repeat revoke on an already-dead
 * session is a harmless no-op, and this is simpler and just as correct as
 * first filtering to only the still-usable ones. All in one transaction, so
 * a session can never be observed to outlive the deletion request that
 * killed it.
 */
export async function requestAccountDeletion(
  input: RequestAccountDeletionInput,
  deps: RequestAccountDeletionDeps,
): Promise<Result<void, DomainError>> {
  return deps.unitOfWork.run(async (uow): Promise<Result<void, DomainError>> => {
    const user = await uow.users.findById(input.userId);
    if (!user) {
      return err({ kind: 'NotFound' });
    }

    const now = deps.clock.now();
    const requestResult = user.requestDeletion(now);
    if (!requestResult.ok) {
      return requestResult;
    }
    await uow.users.save(user);

    const sessions = await uow.sessions.listByUserId(user.id);
    for (const session of sessions) {
      session.revoke('account_deleted', now);
      await uow.sessions.save(session);
    }

    await uow.outbox.append(
      userDeletionRequestedEvent({ userId: user.id, correlationId: input.correlationId }),
    );

    return ok(undefined);
  });
}
