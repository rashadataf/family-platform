# Feature Specification: Identity and Access

**Feature Branch**: `006-identity-access`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "Implement the Identity and Access bounded context (ARCHITECTURE.md section 5.1) as the platform's first real domain feature: user registration with credentials, credential-based login, session issuance/refresh/rotation, and account deletion. Aggregates are User, Session, and Device, exactly as named in the architecture doc. A User must have no reference to a Family or any family-scoped concept at all - that relationship belongs entirely to the future Family and Membership context (section 5.2), so this feature must not model roles, capabilities, or anything about what a user may see or do, only who they are ('authentication answers who, never what may they touch' per the architecture doc). Publish UserRegistered, UserAuthenticated, and UserDeletionRequested domain events per the architecture doc's contract, even though no other bounded context exists yet to consume them - the publishing side is this context's own responsibility regardless of current subscribers. The architecture doc explicitly calls this context 'the strongest candidate for a managed provider' (Cognito, Auth0, Clerk, WorkOS), since a managed provider can only ever hold UserId, an email, and authentication factors, never family data - this feature must decide, and record as an ADR, whether to build credential storage and session handling in-house or adopt a managed identity provider, with the trade-offs made explicit rather than defaulted into. MFA and device registration are named in the architecture doc's responsibility list; include them only if a reasonable v1 can ship without disproportionate complexity, otherwise scope them out explicitly with a stated reason rather than silently dropping them. Out of scope: the Family and Membership context and everything downstream of it, any notion of roles or capabilities, every other bounded context in the architecture doc, and any UI beyond what is needed to exercise and verify the API."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an account (Priority: P1)

A new user provides an email address and a password to create an account on the platform, so that they can later prove who they are.

**Why this priority**: Nothing else in this feature — or in any future feature that depends on a `UserId` — can exist until an account can be created. This is the absolute floor of the platform.

**Independent Test**: Can be fully tested by submitting a new email and password and confirming an account now exists that can be authenticated against, with no other feature required.

**Acceptance Scenarios**:

1. **Given** no account exists for an email address, **When** a person registers with that email and a valid password, **Then** an account is created and a `UserRegistered` event is published.
2. **Given** an account already exists for an email address, **When** a person tries to register again with that same email, **Then** registration is rejected without revealing whether the collision is due to an existing verified or unverified account.
3. **Given** a person submits a password that does not meet the platform's minimum strength rule, **When** they attempt to register, **Then** registration is rejected with a specific, actionable reason.
4. **Given** a person has just registered, **When** they have not yet verified their email address, **Then** they cannot complete authentication until verification succeeds.

---

### User Story 2 - Authenticate and start a session (Priority: P2)

A returning user proves who they are with their email and password and receives a session, so that subsequent requests know who is acting without re-sending credentials each time.

**Why this priority**: Registration alone delivers no ongoing value — a user must be able to come back and be recognized. This is the second-most load-bearing capability after account creation.

**Independent Test**: Can be fully tested by registering an account (User Story 1), then authenticating with the same credentials and confirming a valid session is issued and can be used to reach an authenticated endpoint.

**Acceptance Scenarios**:

1. **Given** a verified account with known credentials, **When** the person authenticates with the correct email and password, **Then** a session is issued, associated with a device, and a `UserAuthenticated` event is published.
2. **Given** an account exists, **When** the person authenticates with an incorrect password, **Then** authentication is rejected with a generic reason that does not confirm whether the email itself is registered.
3. **Given** repeated failed authentication attempts against the same account in a short window, **When** the threshold is exceeded, **Then** further attempts are throttled, independent of whether the password on a later attempt would have been correct.
4. **Given** an unverified account, **When** the person attempts to authenticate, **Then** authentication is rejected until verification completes.

---

### User Story 3 - Stay signed in without re-entering credentials (Priority: P3)

A signed-in user continues using the platform across multiple visits without repeatedly re-entering their password, while a session that is no longer wanted (a stolen device, a stale login) can be cut off.

**Why this priority**: This is a refinement of User Story 2 — the platform is usable without it (a very short-lived session that always demands fresh credentials would technically work), but no real product ships session-based auth without renewal and revocation. It is independently testable once a session exists.

**Independent Test**: Can be fully tested by authenticating (User Story 2), using the session's renewal path to obtain a fresh session without re-sending credentials, and separately confirming that revoking a session immediately invalidates it.

**Acceptance Scenarios**:

1. **Given** an active, unexpired session, **When** the user's client requests renewal, **Then** a fresh session is issued and the prior one is invalidated (rotation, not reuse).
2. **Given** a session that has already been renewed once, **When** its original (now-superseded) form is presented again, **Then** it is rejected and the fact is treated as a possible theft signal, not a routine error.
3. **Given** a user with active sessions on more than one device, **When** they revoke one specific session (e.g. "log out this device"), **Then** only that session stops working — the others continue.
4. **Given** an active session, **When** it has been idle beyond the platform's absolute session lifetime, **Then** it can no longer be renewed and the user must authenticate again.

---

### User Story 4 - Delete an account (Priority: P4)

A user who no longer wants an account can request its deletion, so that their credentials and session history are removed from the platform.

**Why this priority**: Legally necessary before any real user's data is held (UK GDPR erasure rights), but it is not part of the platform's core day-to-day value loop the way registration and login are, which is why it is ordered last among this feature's user stories rather than treated as optional.

**Independent Test**: Can be fully tested by registering an account (User Story 1), requesting its deletion, and confirming the account can no longer authenticate and a `UserDeletionRequested` event is published.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they request deletion of their own account, **Then** the request is accepted, a `UserDeletionRequested` event is published, and every session for that account is immediately revoked.
2. **Given** a deletion request has been accepted, **When** anyone subsequently tries to authenticate with that account's former credentials, **Then** authentication fails as though the account never existed.
3. **Given** a deletion request is being processed, **When** the retention window described under Personal Data, Deletion, and Export below has elapsed, **Then** no credential or session data for that account remains.

---

### Edge Cases

- What happens when someone registers, never verifies their email, and never returns? (See retention answer below — unverified registrations are not kept indefinitely.)
- What happens when a password reset is needed? Out of scope for this feature (see Out of Scope) — an account with a forgotten password cannot currently recover access within this feature's boundary.
- What happens when the same person tries to authenticate from two devices at once? Both succeed independently; each gets its own session and its own device association. There is no platform-wide single-session-per-user constraint.
- What happens when a session's device association can't be determined (e.g. an unusual or missing client identifier)? The session is still issued; the device record is created with whatever minimal identifying information is available rather than blocking authentication on it.
- What happens if the same email is used with different letter casing (`User@Example.com` vs `user@example.com`)? They MUST resolve to the same account — email comparison is case-insensitive.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a person to register an account with an email address and a password.
- **FR-002**: The system MUST reject registration against an email address that already has an account, without disclosing whether the existing account is verified, unverified, or deleted-but-within-its-retention-window.
- **FR-003**: The system MUST require a person to verify control of their email address before their account can authenticate.
- **FR-004**: The system MUST enforce a minimum password strength rule at registration and reject weaker passwords with a specific, actionable reason.
- **FR-005**: The system MUST never store a password in a recoverable (plaintext or reversibly-encrypted) form.
- **FR-006**: The system MUST allow a verified account to authenticate with its email and password and, on success, issue a session.
- **FR-007**: The system MUST reject authentication with a generic failure reason that does not reveal whether the rejection was due to an unknown email or an incorrect password.
- **FR-008**: The system MUST throttle repeated failed authentication attempts against a single account within a short time window, independent of whether a later attempt's password would have succeeded.
- **FR-009**: The system MUST associate every issued session with a device record, using whatever minimal client-identifying information is available, without blocking session issuance if that information is incomplete.
- **FR-010**: The system MUST allow an active, unexpired session to be renewed, issuing a new session and invalidating the one it replaced (rotation).
- **FR-011**: The system MUST reject a session credential that has already been superseded by a rotation, and MUST treat that event as a possible compromise rather than an ordinary invalid-session error.
- **FR-012**: The system MUST allow a user to revoke one of their own sessions individually, without affecting their other active sessions.
- **FR-013**: The system MUST enforce an absolute session lifetime after which renewal is no longer possible and fresh authentication is required.
- **FR-014**: The system MUST allow an authenticated user to request deletion of their own account.
- **FR-015**: The system MUST immediately revoke every active session for an account once its deletion has been requested.
- **FR-016**: The system MUST prevent any future authentication attempt against a deleted account's former credentials from succeeding.
- **FR-017**: The system MUST publish a `UserRegistered` event when an account is created, a `UserAuthenticated` event when authentication succeeds, and a `UserDeletionRequested` event when account deletion is requested — regardless of whether any other part of the platform currently subscribes to them.
- **FR-018**: The system MUST NOT record, reference, or expose any family-scoped concept (a family, a role within one, a membership, a capability) anywhere in this context — a `User` answers only who someone is, never what they may do.
- **FR-019**: The system MUST permanently erase an account's credential and session data no later than the retention period stated under Personal Data, Deletion, and Export, once deletion has been requested.
- **FR-020**: The system MUST also erase an unverified, never-completed registration's credential data no later than the retention period stated under Personal Data, Deletion, and Export, with no deletion request required.
- **FR-021**: The system MUST allow a user to export the personal data this context holds about them, as enumerated under Personal Data, Deletion, and Export.
- **FR-022**: The system MUST treat an email address as case-insensitive for the purposes of uniqueness and lookup.

### Key Entities

- **User**: The account of record for a person who can sign in. Holds an email address, a securely-hashed credential, verification status, and nothing about any family, role, or capability. Identified by a `UserId` that other, future bounded contexts may reference, but this context holds no reference back to them.
- **Session**: A single authenticated period of access issued to a `User` after successful authentication. Tracks its own validity window, its renewal lineage (so a superseded session can be told apart from a live one), and which `Device` it was issued to. Independently revocable.
- **Device**: A record representing a client the user has authenticated from, identified by whatever minimal client-supplied information is available at session issuance. Exists to let a user recognize and individually manage ("log out this device") the sessions associated with it — it is not a fingerprinting or tracking mechanism.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can complete registration (submit credentials through to a created, pending-verification account) in under 2 minutes.
- **SC-002**: A returning, verified user can authenticate and reach an authenticated state in under 10 seconds under normal conditions.
- **SC-003**: 100% of authentication failures return a response that does not allow an external observer to distinguish "unknown email" from "wrong password."
- **SC-004**: A user who requests account deletion has their credential and session data fully and irrecoverably removed within the stated retention period, with zero exceptions observed in testing.
- **SC-005**: Zero plaintext or reversible passwords are ever observed in storage, logs, error messages, or exported data, across the full test suite.
- **SC-006**: A session that has been rotated cannot be successfully reused, in 100% of tested replay attempts.

## Personal Data, Deletion, and Export *(mandatory — Constitution Principle XI)*

1. **What personal data this feature stores, and why**:
   - **Email address** — the account identifier and the only channel available to reach the user for verification and security-relevant notices (e.g. confirming a deletion request).
   - **Password credential, stored only as a salted hash** — required to authenticate the account; the plaintext is never retained.
   - **Session records** (issued-at, expiry, rotation lineage, revocation status) — required to support renewal, individual revocation, and replay detection.
   - **Device records** (a client-supplied label/identifier, not device fingerprinting) — required so a user can recognize and manage which of their sessions belongs to which device.
   - No other personal data (name, date of birth, address, or anything family-related) is collected by this context. That data belongs entirely to the future Family and Membership context, per this context's explicit exclusion of any family-scoped concept.

2. **What happens when this feature's own "account" is deleted**: All of that `User`'s credential, session, and device records are permanently erased no later than the retention period in point 5. A `UserDeletionRequested` event is published so that any future context holding a reference to this `UserId` (there are none yet) can react on its own terms.

3. **What happens when a whole family is erased**: Not yet applicable — no Family and Membership context exists yet for a family to be erased from. This is stated here, rather than silently skipped, because Constitution Principle XI requires every feature to answer it: once Family and Membership ships, it will be responsible for triggering this context's own account-deletion path for every member's linked `UserId` as part of a family erasure, via the same `UserDeletionRequested` mechanism this feature already publishes. No work is deferred silently — the seam this context exposes for that future integration is exactly the deletion capability specified above.

4. **How this data appears in a user's data export**: An exported record includes the account's email address, registration date, verification status, and session history metadata (device label and issued/revoked timestamps only). It never includes the password hash or any live or historical session/refresh credential value, since either would itself be a usable bearer credential rather than a record of one.

5. **Retention period after which data is removed even without a request**: An unverified registration that never completes email verification is erased no later than 30 days after registration. A revoked or naturally expired session's record is erased no later than 90 days after it stops being valid, independent of whether the account itself remains active. An account's own data, once deletion is requested, is fully erased no later than 30 days after the request (User Story 4 / SC-004).

## Out of Scope

- The Family and Membership bounded context, and everything downstream of it in the architecture (Calendar, Tasks, Document Vault, Reminders, Notifications, AI Assistant, and the rest).
- Any notion of roles, capabilities, or authorization beyond authentication — this context answers "who," never "what may they touch."
- Password reset / forgotten-password recovery. An account whose password is forgotten cannot currently regain access through this feature; this is a deliberate, named gap for a fast-follow, not an oversight.
- Multi-factor authentication. Named in the architecture doc's responsibility list, but deferred: it adds a delivery channel (SMS/authenticator/email OTP) and a recovery-factor story that would meaningfully expand this feature's scope without a concrete driver yet, since no downstream context exists to consume elevated assurance today.
- Any UI beyond what is needed to exercise and verify the API described here (this platform's mobile app, per its own ADRs, is a separate future concern).
- The specific technical mechanism (in-house credential storage vs. a managed identity provider) by which these requirements are met — that is an architectural decision for the planning phase, to be recorded as its own ADR with trade-offs made explicit, not a product-scope decision for this specification.

## Assumptions

- Registration requires only an email address and a password; no other profile information (name, phone number) is collected at this layer, since anything beyond authentication belongs to a future context.
- Email verification is required before an account's first successful authentication, consistent with standard practice for consumer platforms.
- A user may hold multiple concurrent sessions across multiple devices; there is no platform-wide single-session restriction.
- Standard consumer-security defaults apply where not otherwise specified: industry-typical password strength rules, industry-typical session and refresh lifetimes, and industry-typical failed-attempt throttling — exact values are a planning-phase detail, not a product decision this specification needs to pin down.
- This feature ships with no other bounded context yet depending on it; its published events currently have no real subscriber, which is expected and does not reduce the obligation to publish them per the architecture doc's contract.
