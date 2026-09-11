import { initContract } from '@ts-rest/core';
import { z } from 'zod';

/**
 * The Identity and Access wire boundary (ADR-006, contracts/identity-api.md).
 * This package imports nothing from `domain/` or `application/` — the wire
 * language and the domain language are allowed to differ, and per
 * `contracts-are-standalone` in `.dependency-cruiser.cjs`, the domain must
 * not reach the wire by accident.
 *
 * Routes are added to `identityContract` incrementally, one user story at a
 * time (tasks T041, T056, T070, T083), rather than all at once here.
 */

/**
 * Trimmed and lowercased at the boundary (FR-022), so case-insensitivity is a
 * property of the contract rather than a thing every handler remembers.
 */
export const emailSchema = z.string().trim().toLowerCase().email();

/**
 * NIST SP 800-63B favours length over composition rules (no forced mix of
 * symbols/numbers/casing), so the one rule enforced is a minimum length —
 * long enough to resist offline guessing, short enough not to push people
 * toward predictable padding.
 */
const MIN_PASSWORD_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters long.`,
  );

/**
 * Machine-readable problem shape shared by every error response
 * (contracts/identity-api.md's error table). `type` is the field client code
 * switches on; specific routes extend this with their own extra fields
 * (e.g. `identity/weak_password`'s `reason`).
 */
export const problemSchema = z.object({
  type: z.string(),
  detail: z.string().optional(),
});

const c = initContract();

export const identityContract = c.router(
  {
    // Populated story by story — see the file-level comment above.
  },
  { pathPrefix: '/v1/identity' },
);
