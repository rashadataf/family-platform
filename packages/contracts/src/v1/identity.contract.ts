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
 * Deliberately just `z.string()` here, with no `.min()`. FR-004's actual
 * minimum-length rule is enforced by `registerUser` in
 * `packages/core/identity`, not at this layer: ts-rest's automatic request
 * validation would reject a too-short password with its own generic 400
 * shape before a handler ever runs, pre-empting the specific
 * `identity/weak_password` problem response contracts/identity-api.md
 * requires. Enforcing it downstream, where the full `Result`/`DomainError`
 * machinery already exists, is what lets the controller return the exact
 * typed error instead of a generic validation failure.
 */
export const passwordSchema = z.string();

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

/** FR-002: does not say which state (existing verified/unverified/pending-erasure) applies. */
export const emailUnavailableSchema = z.object({ type: z.literal('identity/email_unavailable') });

/** FR-004: the one error type that DOES carry a specific, actionable reason. */
export const weakPasswordSchema = z.object({
  type: z.literal('identity/weak_password'),
  reason: z.string(),
});

/** FR-003a: unknown, expired, consumed, or superseded — never distinguished. */
export const verificationInvalidSchema = z.object({
  type: z.literal('identity/verification_invalid'),
});

const c = initContract();

export const identityContract = c.router(
  {
    register: {
      method: 'POST',
      path: '/registrations',
      body: z.object({ email: emailSchema, password: passwordSchema }),
      responses: {
        201: z.object({}),
        409: emailUnavailableSchema,
        422: weakPasswordSchema,
      },
    },
    verifyEmail: {
      method: 'POST',
      path: '/verifications',
      body: z.object({ token: z.string() }),
      responses: {
        200: z.object({}),
        422: verificationInvalidSchema,
      },
    },
    resendVerification: {
      method: 'POST',
      path: '/verifications/resend',
      body: z.object({ email: emailSchema }),
      responses: {
        200: z.object({}),
      },
    },
    // Remaining routes populated story by story — see the file-level comment above.
  },
  { pathPrefix: '/v1/identity' },
);
