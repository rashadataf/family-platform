# Specification Quality Checklist: Calendar

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-14
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Constitution Alignment

- [x] Principle V (object-level authorization): FR-027, FR-028 route every standing decision through the Family context's published port and make cross-family access indistinguishable from non-existence; SC-004 measures it
- [x] Principle VI (children sensitive by default): FR-016 restricts events involving a child to that child's guardians and evaluates guardianship at read time; FR-017 requires audit of every permitted and denied read; SC-007 and SC-011 measure both
- [x] Principle XI (deletion and export designed, not retrofitted): all five answers present, including an honest statement of what member deletion cannot scrub
- [x] UK-first without being UK-welded: FR-013 keeps holiday data behind a caller-supplied interface and FR-014 keeps it from influencing expansion at all; FR-003 stores IANA identifiers; no UK-shaped primitive is stored
- [x] Architecture §5.3 conformance: aggregates named as the architecture document names them; occurrences materialised rather than expanded at query time (FR-007, FR-010); all four required events published (FR-030)
- [x] No change required to another bounded context: FR-032 consumes the calendar capabilities spec 008 already issues, so no ADR is triggered

## Notes

All checklist items pass. Three questions were raised during specification rather than
defaulted silently, because each changed what gets built rather than how, and all three were
resolved with the user on 2026-09-14 (recorded in the spec's Clarifications section):

1. **Child-participant visibility → guardians only.** An event involving a child is reachable
   only by that child's guardians (FR-016), the strict reading of Principle VI. The cost —
   extended and viewer members cannot see a child's commitments — was accepted deliberately,
   and the remedy for a household that wants otherwise is to grant guardianship.
2. **Per-occurrence exceptions → cancel-only.** A single occurrence can be skipped but not
   independently moved (FR-022), which keeps the rebuild rule in FR-020 to preserving an
   exception list rather than reconciling full overrides.
3. **Public-holiday semantics → data only, no rule effect.** Holidays never influence
   expansion (FR-014), keeping the recurrence vocabulary conformant to RFC 5545 and deferring
   working-day semantics to the first context that actually needs them.

Everything else was resolved with a documented default recorded in the Assumptions section.

**Known gap for the planning phase, verified against the code rather than assumed.** FR-016
cannot be satisfied through the Family context's published port as it stands. That port
(`resolveFamilyContext`) returns exactly `{ memberId, role, capabilities }` and carries no
guardianship information, while FR-027 forbids Calendar from reading family, member or
guardianship data by any other means. Filtering a range query by "children this reader is a
guardian of" therefore has no legal data path today.

This is a design question `/speckit-plan` must resolve before implementation, and the options
differ in how much they touch spec 008:

- Extend the published port additively — for example resolving the set of children the member
  guards alongside their capabilities — which keeps one open host service and one round trip.
- Publish a second, narrow guardianship-resolution port from the Family context.

Either way the change belongs to the Family context and must be made there, not worked around
in Calendar. It is additive to an existing published port rather than a boundary move, so on
the constitution's "When an ADR is required" test it most likely does not need an ADR — but
that call should be made explicitly during planning rather than by default, since it changes a
published cross-context interface.
