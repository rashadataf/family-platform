import { err, type DomainError, type Result } from '@fp/kernel';

/**
 * Thrown inside a unit of work to roll it back while still returning a typed
 * domain error to the caller.
 *
 * A command that has already written an event row and then finds a
 * participant invalid must not commit the half it wrote — and returning an
 * `err` from inside the transaction would commit it. Throwing is the only way
 * to ask for a rollback; this class is how the error survives the throw.
 */
export class RollbackWithError extends Error {
  constructor(readonly domainError: DomainError) {
    super(`rolled back: ${domainError.kind}`);
    this.name = 'RollbackWithError';
  }
}

export async function catchRollback<T>(
  work: () => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RollbackWithError) return err(error.domainError);
    throw error;
  }
}
