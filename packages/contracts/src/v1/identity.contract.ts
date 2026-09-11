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

/** FR-007, SC-003: unknown email and wrong password are deliberately indistinguishable. */
export const invalidCredentialsSchema = z.object({
  type: z.literal('identity/invalid_credentials'),
});

/** FR-003: correct credentials, but the account has not completed email verification yet. */
export const notVerifiedSchema = z.object({
  type: z.literal('identity/not_verified'),
});

/** FR-008: returned even when the password on this very attempt would have been correct. */
export const throttledSchema = z.object({
  type: z.literal('identity/throttled'),
  retryAfterSeconds: z.number(),
});

/**
 * A route-level limit exceeded (contracts/identity-api.md's rate-limiting
 * table) — distinct from `identity/throttled` above, which is FR-008's
 * per-account domain lock rather than a per-route request-rate limit.
 */
export const rateLimitedSchema = z.object({ type: z.literal('identity/rate_limited') });

/**
 * FR-023: one type for unknown, revoked, expired, superseded, or
 * deleted-account credentials, on purpose — see contracts/identity-api.md's
 * "why replay returns identity/session_invalid rather than its own type."
 */
export const sessionInvalidSchema = z.object({
  type: z.literal('identity/session_invalid'),
});

/** What `GET /v1/identity/sessions` renders per session — never a token or its hash. */
export const sessionSummarySchema = z.object({
  sessionId: z.string(),
  deviceLabel: z.string(),
  issuedAt: z.string(),
  rotatedAt: z.string().nullable(),
  absoluteExpiresAt: z.string(),
  isCurrent: z.boolean(),
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
    login: {
      method: 'POST',
      path: '/sessions',
      body: z.object({
        email: emailSchema,
        password: passwordSchema,
        // FR-009: best-effort and optional — issuance proceeds without it.
        deviceLabel: z.string().trim().min(1).optional(),
      }),
      responses: {
        201: z.object({
          sessionId: z.string(),
          token: z.string(),
          issuedAt: z.string(),
          absoluteExpiresAt: z.string(),
        }),
        401: invalidCredentialsSchema,
        403: notVerifiedSchema,
        // FR-008's per-account lock and the per-route rate limit are both
        // reachable here and are deliberately distinct types (see each
        // schema's comment) — a client-side consumer discriminates on `type`.
        429: z.discriminatedUnion('type', [throttledSchema, rateLimitedSchema]),
      },
    },
    // Credential travels as `Authorization: Bearer <token>` (contracts/identity-api.md);
    // not modelled as a contract `headers` schema so a missing/invalid header can return
    // the specific `identity/session_invalid` type instead of ts-rest's generic 400 — the
    // same reasoning as `passwordSchema`'s comment above.
    listSessions: {
      method: 'GET',
      path: '/sessions',
      responses: {
        200: z.object({ sessions: z.array(sessionSummarySchema) }),
        401: sessionInvalidSchema,
      },
    },
    // Remaining routes populated story by story — see the file-level comment above.
  },
  { pathPrefix: '/v1/identity' },
);
