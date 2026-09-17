import { err, type DomainError, type Result } from '@fp/kernel';

/**
 * Thrown inside a unit of work to roll it back while still returning a typed
 * domain error. Returning an `err` from inside the transaction would COMMIT
 * whatever was already written; throwing is the only way to ask for a
 * rollback. Calendar has the same construction in its own context (FR-012
 * forbids importing it).
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

/** Unwraps a result inside a unit of work, rolling back on failure. */
export function orRollback<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw new RollbackWithError(result.error);
  return result.value;
}
