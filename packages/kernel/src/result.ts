/**
 * A typed outcome, so a domain or application function's failure modes are
 * part of its signature rather than a thrown exception the caller has to
 * already know about (Principle I: type safety is a contract).
 */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

/** Transforms the success value, leaving an error untouched. */
export function mapResult<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Chains a fallible step onto a prior result, short-circuiting on error. */
export function andThen<T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/**
 * Unwraps a success value or throws. Reserved for call sites that have
 * already proven the result is `ok` (e.g. right after constructing it) —
 * never for handling a genuinely fallible outcome, which must branch on
 * `result.ok` instead.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`Called unwrap() on an error result: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
