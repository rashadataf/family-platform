# Feature Specification: Family and Membership

**Feature Branch**: `008-family-membership`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Implement the Family and Membership bounded context (ARCHITECTURE.md section 5.2) as the platform's tenant root. The Family aggregate is the tenant boundary for the entire system: it owns members, roles, capabilities, guardianship relationships, invitations, and the household profile (postcode, local authority, composition) that downstream contexts will read. Aggregates are Family (root), FamilyMember, and Invitation, exactly as named in the architecture doc. The most important modelling decision, per the architecture doc, is that a FamilyMember is not a User - it is a person the family tracks, who may optionally be linked to a UserId (from the existing Identity and Access context, spec 006) when that person has an account. Children are FamilyMember records with no UserId, no credentials, and no login path at all - this is a privacy requirement, not a shortcut, since a child's personal data must only ever be reachable through a guardian. A family is created by one adult (the owner), who can invite other adults by email (an Invitation that, when accepted by a registered or newly registering user, links a User to a new adult FamilyMember on that family) and can add child or extended-family members directly as FamilyMember records without requiring them to have an account. Roles are coarse (owner, adult, extended, viewer) and map to capability sets (documents:read, documents:write:sensitive, members:manage, billing:manage, etc.) exactly as described in the architecture doc - authorization code must check capabilities, never roles, so that adding a role later never means editing scattered authorization logic. Guardianship is an explicit relationship between an adult FamilyMember and a child FamilyMember, not an inferred one. This context must publish FamilyCreated, MemberAdded, MemberRoleChanged, MemberRemoved, GuardianshipEstablished, and FamilyDeletionRequested domain events per the architecture doc, even though no downstream context yet subscribes to them. It must also expose the FamilyContextPort open host service described in the architecture doc, which resolves (userId, familyId) to { memberId, role, capabilities[] } or null - this is the only way any other bounded context may ever determine a user's standing within a family, and no other context may query family tables directly; this feature should build the port even though no consuming context exists yet, and should verify the boundary is enforceable (nothing outside this context reads its tables). A User must remain unaware of any Family concept per the Identity and Access context's own modelling rule - this feature must not add any family reference onto the User aggregate; the relationship is owned entirely here, from the Family side. Out of scope: every other bounded context in the architecture doc (Calendar, Tasks, Documents, Reminders, Notifications, AI, Billing, Compliance), any UI beyond what is needed to exercise and verify the API, and the eventual promotion of a child FamilyMember to a linked User account (the architecture doc calls this out as a separate, deliberate linkUserToMember command with its own permission model, not part of this feature)."

## Clarifications

### Session 2026-09-13

- Q: Can a family have more than one owner, or exactly one at a time? → A: Exactly one owner at a time. Only the owner may delete the family, transfer ownership, or manage billing. Ownership can be transferred to another adult member but never held jointly.
- Q: What happens when the family's only owner wants to leave, or their account is deleted? → A: Blocked until ownership is transferred — the owner must explicitly transfer ownership to another adult member first. A family can never end up without an owner.
- Q: Which member roles can be granted guardianship of a child? → A: Owner and adult only. Extended and viewer members can never hold a guardianship relationship.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a family and become its owner (Priority: P1)

A person with a registered account creates a family, giving it a name and a household profile, and is immediately recognized as its sole owner.

**Why this priority**: This is the absolute floor. Nothing else in this context — and nothing in any downstream context that reads a family's members, roles or capabilities — can exist until a family exists and someone owns it.

**Independent Test**: Can be fully tested by having a registered user create a family and confirming a Family now exists with that user as its owner, holding the owner capability set, with no other feature required.

**Acceptance Scenarios**:

1. **Given** a person with a registered account and no existing family they own, **When** they create a family with a name, **Then** a Family is created, that person becomes its sole owner member, and a `FamilyCreated` event is published.
2. **Given** a family is being created, **When** a household profile (postcode, local authority, composition) is supplied, **Then** it is stored as an attribute of the Family, readable by whatever later reads Family attributes.
3. **Given** a family creation request with no name, **When** creation is attempted, **Then** it is rejected with a specific, actionable reason.

---

### User Story 2 - Add a child and become their guardian (Priority: P2)

An owner or adult member of an existing family adds a child's basic details directly — with no account, no credentials and no login path — and is established as that child's guardian in the same action.

**Why this priority**: Tracking the people who cannot hold an account of their own, safely, is the platform's core privacy promise and the first thing a real household does once the family itself exists.

**Independent Test**: Can be fully tested by having an existing family's owner add a child member and confirming the record has no linked account, the adding member is now a guardian of it, and a second adult member with no guardianship relationship cannot read the child's details.

**Acceptance Scenarios**:

1. **Given** an existing family and an adult or owner member acting within it, **When** they add a new family member marked as a child, **Then** a `FamilyMember` record is created with no linked user, no credentials and no login path, the adding member is established as that child's guardian, and both a `MemberAdded` event and a `GuardianshipEstablished` event are published.
2. **Given** a child's record with exactly one guardian, **When** a different family member who does not hold a guardianship relationship with that child attempts to view the child's personal details, **Then** access is denied, regardless of that member's role or family membership.
3. **Given** a child family member with one guardian, **When** the owner grants guardianship of that child to a second eligible member, **Then** that member also gains access to the child's record and a `GuardianshipEstablished` event is published for the new relationship.
4. **Given** a child's record, **When** someone with no membership in that family at all attempts to access it, **Then** the response does not disclose that the family or the record exists.

---

### User Story 3 - Invite another adult to join the family (Priority: P3)

The owner invites an adult by email address with a proposed role; the recipient, whether or not they already hold a registered account, accepts the invitation and becomes a linked adult member of the family.

**Why this priority**: Most households are more than one person. Bringing in a second adult is the next highest-value milestone after the family and its first tracked members exist, but the family is already useful without it.

**Independent Test**: Can be fully tested by having the owner send an invitation to an email address, having that email accept it, and confirming a new `FamilyMember` linked to that person's account now exists on the family with the invited role.

**Acceptance Scenarios**:

1. **Given** an existing family, **When** the owner invites an email address with a proposed role, **Then** an `Invitation` is created for that email and family, in a pending state.
2. **Given** a pending invitation and a person who already holds a registered account under that email, **When** they accept it, **Then** a new `FamilyMember` linked to their account is added to the family with the invited role, and a `MemberAdded` event is published.
3. **Given** a pending invitation and a person who does not yet hold an account, **When** they register using the invited email address and then accept the invitation, **Then** the same linking occurs as in Scenario 2.
4. **Given** a pending invitation, **When** the owner revokes it before it is accepted, **Then** it can no longer be accepted.
5. **Given** an invitation past its expiry window, **When** someone attempts to accept it, **Then** acceptance is rejected and a new invitation must be sent.
6. **Given** an email address that already belongs to a member of the family, **When** an invitation is sent to that same email for that family, **Then** the invitation is rejected as redundant.

---

### User Story 4 - Add an extended family member without an account (Priority: P4)

An owner or adult member adds an extended family member's basic details directly, with no invitation and no login path, to represent people who help with the family but don't need their own access — or need only limited, capability-restricted access.

**Why this priority**: A real but lower-frequency need than the household's core members. The family is fully functional for its primary members without it.

**Independent Test**: Can be fully tested by having an existing family's owner add an extended family member directly and confirming the record carries the extended role's capability set with no login path created.

**Acceptance Scenarios**:

1. **Given** an existing family, **When** an owner or adult member adds a new family member marked as "extended", **Then** a `FamilyMember` record is created with the extended role's capability set and no login path.
2. **Given** an extended family member's record with no linked account, **When** the owner attempts to set its role to "owner", **Then** this is rejected, since holding ownership requires an active, linked user.

---

### User Story 5 - Manage roles and remove access (Priority: P5)

The owner changes an existing member's role, transfers ownership, or removes a member entirely, and every downstream capability check reflects the change immediately.

**Why this priority**: A refinement rather than a foundation — a family that has been running for a while needs to adjust who can do what and revoke access when circumstances change, but this is meaningless before Stories 1–4 exist.

**Independent Test**: Can be fully tested by having the owner change a member's role and separately remove a different member, then confirming capability resolution for both members reflects the change immediately.

**Acceptance Scenarios**:

1. **Given** an adult member, **When** the owner changes their role to "viewer", **Then** a `MemberRoleChanged` event is published and resolving that member's standing immediately reflects the viewer capability set.
2. **Given** a member linked to a user account, **When** the owner removes that member from the family, **Then** a `MemberRemoved` event is published and resolving that (user, family) pair afterward returns no standing at all.
3. **Given** the family's sole owner, **When** they attempt to leave the family, remove themselves, or have their role changed away from owner without first transferring ownership to another adult member, **Then** the action is rejected.
4. **Given** the owner transfers ownership to another adult member, **When** the transfer completes, **Then** the previous owner becomes an adult member, the new owner holds the owner capability set, and only one member holds ownership at any time.
5. **Given** a child member with exactly one guardian, **When** someone attempts to remove that guardian's relationship (directly, by removing them as a family member, or by changing their role) without assigning a replacement guardian in the same action, **Then** the action is rejected, because a child's record must never be left with zero guardians.

---

### Edge Cases

- A user attempts to be linked, via invitation, into a family they are already a member of under a different role — rejected as redundant (User Story 3, Scenario 6).
- A user is a linked adult member of more than one family at the same time (e.g. separated parents, blended households) — each membership, role and guardianship set is tracked independently; nothing in this context treats a user as belonging to only one family.
- The same email address is invited to two different families concurrently — permitted; invitations are scoped per family, not globally.
- A family is deleted while it has pending invitations — every pending invitation for that family becomes unacceptable from that point on.
- An invitation is accepted using an email address that differs only by letter case from the one it was sent to — treated as the same address (case-insensitive match), consistent with how account lookups elsewhere on the platform avoid case-sensitivity leaks.
- A member of one family attempts to resolve, query or act on a different family's members, invitations or child records — every such attempt is indistinguishable from the target not existing at all, never a distinguishable "forbidden" response.
- An owner attempts to grant guardianship of a child to a member whose role is "extended" or "viewer" — rejected; only owner and adult members are eligible for guardianship, per the resolved clarification.
- The only guardian of a child is also the family's sole owner, and that owner attempts to transfer ownership — ownership transfer and guardianship are independent relationships; transferring ownership does not by itself remove a guardianship relationship, so this succeeds without affecting the child's guardian.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a person with a registered account to create a Family, given at minimum a name, and MUST establish that person as the Family's sole owner as part of the same action.
- **FR-002**: System MUST allow a Family's household profile (postcode, local authority, composition) to be recorded and updated as attributes of the Family, independent of any individual member record.
- **FR-003**: System MUST allow an owner or adult member to add a new FamilyMember representing a child, and MUST NOT ever create a UserId link, credentials, or any login path for a member added this way.
- **FR-004**: System MUST model guardianship as an explicit relationship between an eligible member and a child member, and MUST NOT infer or grant guardianship as a side effect of general family membership.
- **FR-005**: System MUST automatically establish the adding member as a guardian of a newly added child member, within the same action that creates the child's record, and MUST allow an owner to grant guardianship of an existing child member to additional eligible members afterward.
- **FR-006**: System MUST restrict guardianship eligibility to members whose role is "owner" or "adult"; a member whose role is "extended" or "viewer" MUST NOT be able to hold a guardianship relationship.
- **FR-007**: System MUST deny access to a child member's personal details to any family member who does not hold an active guardianship relationship with that specific child, regardless of that member's role or standing elsewhere in the family.
- **FR-008**: System MUST prevent an action that would leave a child member with zero active guardians — removing a guardianship relationship, removing a guardian's family membership, or changing a guardian's role away from an eligible one — unless a replacement guardian is assigned within the same action.
- **FR-009**: System MUST record every read of a child member's personal details in the audit log, capturing the acting member, the child record, and the outcome, whether access was granted or denied.
- **FR-010**: System MUST allow the owner to invite an adult by email address, specifying a proposed role, creating an Invitation that can subsequently be accepted or revoked.
- **FR-011**: System MUST allow a pending Invitation to be accepted by its target email address regardless of whether that email already corresponds to a registered account at the time the invitation was sent, linking the resulting or existing account to a new adult FamilyMember on acceptance.
- **FR-012**: System MUST expire a pending Invitation after a defined window if unaccepted, and MUST allow the owner to revoke a pending Invitation before it is accepted or expires.
- **FR-013**: System MUST reject an Invitation sent to an email address that already corresponds to a member of the same Family.
- **FR-014**: System MUST allow an owner or adult member to add an extended-family member directly as a FamilyMember, with no invitation and no login path, distinct from the invitation-based flow used for adults joining as full members.
- **FR-015**: System MUST map each of the four roles (owner, adult, extended, viewer) to a fixed, coarse capability set (including at minimum `documents:read`, `documents:write:sensitive`, `members:manage`, `billing:manage`), and MUST expose only capabilities, never role names, to any authorization decision.
- **FR-016**: System MUST allow the owner to change a non-owner member's role, publishing a `MemberRoleChanged` event, with the change reflected immediately in any subsequent resolution of that member's standing.
- **FR-017**: System MUST allow the owner to remove a member — revoking their standing in the family and, if they were linked to a user account, unlinking it — publishing a `MemberRemoved` event, with the removal reflected immediately in any subsequent resolution of that member's standing.
- **FR-018**: System MUST support exactly one owner per Family at any time, MUST allow the current owner to transfer ownership to another adult member (after which the previous owner becomes an adult member), and MUST reject any attempt to leave, remove, or change the role of the sole owner away from "owner" without a transfer completing in the same action.
- **FR-019**: System MUST expose a single query capability (the FamilyContextPort) that resolves a given (userId, familyId) pair to that user's memberId, role and capability set, or to nothing at all if no active membership exists for that pair.
- **FR-020**: System MUST be the only means by which any other part of the platform determines a user's standing within a family; no code outside this context may read family, member, or guardianship data directly.
- **FR-021**: System MUST respond to any request referencing a family, member, invitation, or child record that the requester has no standing in with the platform's standard not-found response, never a response that discloses the target's existence.
- **FR-022**: System MUST NOT add any Family-related reference, field, or dependency to the User aggregate or to any part of the Identity and Access context; this context owns the relationship entirely from the Family side.
- **FR-023**: System MUST publish `FamilyCreated`, `MemberAdded`, `MemberRoleChanged`, `MemberRemoved`, `GuardianshipEstablished`, and `FamilyDeletionRequested` events for every corresponding state change, regardless of whether any other context currently subscribes to them.
- **FR-024**: System MUST allow a single user account to hold a linked FamilyMember record in more than one Family at the same time, with each Family's membership, role, and guardianship relationships tracked entirely independently of the others.
- **FR-025**: System MUST void every pending Invitation belonging to a Family once that Family's `FamilyDeletionRequested` event is published, so none can subsequently be accepted.

### Key Entities

- **Family**: The tenant root. Holds a name, a household profile (postcode, local authority, composition), a reference to its current sole owner, and creation/deletion-request timestamps. Everything else in this context, and every downstream context, scopes its data to a Family.
- **FamilyMember**: A person the family tracks — distinct from a User. Holds a role (owner, adult, extended, viewer), an optional link to a UserId, and personal details appropriate to that person (e.g. name, date of birth for a child). A member with no linked UserId has no login path at all.
- **Invitation**: An offer for a specific email address to join a specific Family with a proposed role. Holds a status (pending, accepted, revoked, expired) and an expiry timestamp. Scoped to one Family; the same email may hold separate invitations to different Families.
- **GuardianshipRelationship**: An explicit link between an eligible member (owner or adult) and a child member, established or later assigned independently of other membership changes, and required — at least one per child — for that child's record to remain accessible to anyone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A newly registered person can create a family and add its first member (of any kind) in under 2 minutes.
- **SC-002**: 100% of attempts to view a child's personal details by a family member without an active guardianship relationship with that child are denied.
- **SC-003**: An invited adult, whether or not they held a prior account, can go from receiving an invitation to holding an active, capability-bearing membership in under 5 minutes with no manual intervention.
- **SC-004**: 100% of cross-family access attempts — a member of one family querying another family's members, invitations, or records — receive a response indistinguishable from the target not existing.
- **SC-005**: A role change, ownership transfer, or removal made by an owner is reflected in the next standing resolution for that member with no observable delay.
- **SC-006**: At every point in time, zero child records exist with fewer than one active guardian.
- **SC-007**: At every point in time, every family has exactly one owner.

## Personal Data, Deletion, and Export *(mandatory — Constitution Principle XI)*

1. **What personal data this feature stores, and why**:
   - **Family name** — how the household identifies itself; the label every downstream context
     shows above a shared calendar or document list.
   - **Household profile: postcode, local authority identifier, composition** — the postcode and
     local authority are what will let later contexts surface the right school term dates, council
     services and local activities without asking again; composition is a structured description of
     the household (counts by member kind) kept consistent with actual membership, not free text.
   - **Family member display name** — the name the family uses for that person. Without it a
     member record is an identifier no human can act on.
   - **Family member date of birth** — recorded for child members. It is what makes a person a
     child for the purposes of the guardianship rules in this feature, and what later contexts read
     for school year and age-appropriate scheduling. Not collected for adult members.
   - **Invitation email address** — the only way to reach a person who is not yet a member. Held
     only while the invitation is live, then removed (point 5).
   - **Guardianship relationships** — who may reach a child's record. This is the access control
     itself, not metadata about it.
   - Nothing else. No address beyond a postcode, no phone number, no school, no medical
     information: those belong to features that do not exist yet, and Principle VI forbids
     collecting a field before a specified feature requires it.

2. **What happens when a family member's account is deleted**: their membership ends and a
   `MemberRemoved` event is published. Their member record is retained as a tombstone with the
   display name and date of birth removed, so that authorship references held by later contexts do
   not dangle, and their guardianship relationships are deleted. Removal is refused outright if it
   would leave a child with no guardian (FR-008) or the family with no owner (FR-018) — the account
   holder must transfer or reassign first. The family's own data survives; a member leaving is not
   a family being erased, and the two are never conflated.

3. **What happens when a whole family is erased**: the family, every member record, every
   invitation and every guardianship under it are permanently removed. Erasure begins with
   `FamilyDeletionRequested`, which immediately revokes every member's access and voids every
   pending invitation (FR-025); the removal itself follows the platform's standard grace period and
   erasure handling. Each linked member's own account is untouched by this — deleting a family does
   not delete the people in it, and the reverse is equally true.

4. **How this data appears in a user's data export**: an export contains the families that person
   is a member of, with the family name, their own role and capabilities, and when they joined;
   their own display name and date of birth; the guardianship relationships they hold; and the
   invitations they sent or accepted, with status and timestamps. It does **not** contain another
   member's date of birth, any detail of a child they are not a guardian of, or any invitation
   token — the guardianship rule that governs reading applies identically to exporting.

5. **Retention period after which data is removed even without a deletion request**: a member's
   record is retained for as long as the family is active — it is the family's own record of its
   own people, and there is no interval after which a household should stop knowing who is in it.
   An invitation that is accepted or revoked has its email address removed 90 days later, and the
   record itself is deleted at the same point. An invitation that is neither accepted nor revoked
   expires 14 days after it is sent and is deleted 90 days after that. Records of who accessed a
   child's details are retained on the platform's separate audit retention schedule, because
   erasing the record of an access would defeat the control that produced it.

## Out of Scope

- **Every other bounded context**: Calendar, Tasks, Document Vault, Reminders, Notifications, AI
  Assistant, Billing and Entitlements, Audit and Compliance beyond the audit trail this feature's
  own obligations require, and Reference and Locale. Capabilities naming those contexts
  (`documents:read`, and so on) are issued by this feature because FR-015 requires the full
  capability set to exist; nothing consumes them yet.
- **Any user interface** beyond what is needed to exercise and verify the API.
- **Promoting a child member to a linked account.** A teenager gaining their own login is a
  deliberate, separately specified command with its own permission model, not a consequence of
  anything here.
- **Password reset, account recovery and anything else owned by Identity and Access** (spec 006).
- **Validating a postcode or local authority identifier against real reference data.** Stored as
  supplied; validation belongs to the deferred Reference and Locale context.
- **The erasure orchestration itself.** This feature exposes the erasure operations a family and a
  member require and publishes the deletion-requested event; the saga that calls them across every
  context belongs to Audit and Compliance.

## Assumptions

- A user account may hold a linked FamilyMember record in more than one Family simultaneously (for example, separated parents each running their own household); this context does not treat family membership as exclusive.
- Household profile fields (postcode, local authority, composition) are recorded as simple attributes for this feature; validating them against a real UK address or postcode reference lookup belongs to the deferred Reference and Locale context and is out of scope here.
- "Composition" is a description of the household (e.g. counts or categories of members) rather than a separately authored free-text field, kept consistent with the family's actual membership.
- Deleting a family follows the same request-then-erasure pattern used by account deletion in the Identity and Access context (spec 006): `FamilyDeletionRequested` is published immediately, and the platform's standard retention and erasure handling (Principle XI) applies afterward; this feature is responsible for publishing the event and voiding pending invitations, not for re-specifying the full erasure timeline.
- No numeric cap on the number of members a family may have is imposed by this feature.
- An invitation's proposed role may be any role an owner could otherwise assign directly (adult, extended, or viewer) — this feature does not restrict invitations to the adult role alone, even though User Story 3 describes the most common case.
