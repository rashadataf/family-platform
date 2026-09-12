# Feature Specification: Design System and Mobile Application Shell

**Feature Branch**: `007-design-system`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Design system package and Expo application shell. A platform-agnostic token layer and component library in packages/ui, consumed by a new apps/mobile Expo application. Implements the foundations (colour roles resolved per light and dark theme, typography scale, spacing scale, corner radius, elevation, layout grid and breakpoints), the primitives (buttons, fields, rows, surfaces, navigation), and the four mandatory interaction patterns — AI proposal confirmation, guardian-gated sensitive records, reminder provenance, and cross-family not-found. Every value and component is specified by the design canvas committed at design/ (artboards 01-09); this feature builds that canvas in code and establishes the mobile app shell that consumes it. No product features, no API calls, no bounded-context logic."

## Specified By

This feature is unusual in that its requirements are already drawn. The design canvas committed
at [`design/`](../../design/) is the normative source for every value and every component state
named below. Artboards are referenced by number throughout:

| Artboard | Owns |
|---|---|
| 01 Colour | Every colour role, its light and dark resolution, and the contrast floors |
| 02 Typography | The thirteen type steps, their faces, sizes, line heights and weights |
| 03 Space, shape, hit area | The spacing scale, radius scale, elevation levels, icon sizes, the 44px floor |
| 04 Layout and platform | Breakpoints, column counts, margins, gutters, and what may differ per platform |
| 05 Buttons | Five variants, five states, three heights, and their anatomy |
| 06 Fields | Field states, the label rule, the search exception, error copy |
| 07 Rows and surfaces | The four row types, avatars, empty, loading and transient states |
| 08 Navigation | Tab bar, headers, segmented control, sheet, dialog |
| 09 Patterns | The four interaction patterns that carry constitution principles |

Where this specification and the canvas disagree, the canvas is wrong and must be corrected —
a value is changed on the canvas first, then in code, never the other way round.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a screen without inventing a value (Priority: P1)

Someone building any screen in this product reaches for a named role — `surface.raised`,
`space.4`, `title.sm` — and never types a colour, a pixel measurement, a radius or a font size.
The value they receive is the value drawn on the canvas.

**Why this priority**: Everything else in this feature is a consequence of this one. If a screen
can still write `#FFFFFF`, the design system is advisory, and an advisory design system decays to
nothing within three features. This is also the floor for the application existing at all — the
shell has to render something, and that something has to come from somewhere.

**Independent Test**: Rebuild the Today screen (artboard 11) using only this package, and assert
that the screen's own source contains no literal colour, spacing, radius or type value.

**Acceptance Scenarios**:

1. **Given** the package, **When** a screen is built using only its exported tokens and components, **Then** the rendered result matches its artboard in every value.
2. **Given** a screen that writes a colour, size, spacing or radius literally, **When** the codebase is checked, **Then** the check fails and names the file, the line and the offending value.
3. **Given** a token's value is changed in one place, **When** the application is rebuilt, **Then** every screen using that role reflects the change with no other edit anywhere.
4. **Given** a value that is not on a documented scale, **When** a component attempts to use it, **Then** the check fails rather than silently accepting it.

---

### User Story 2 - Both themes, with no per-screen work (Priority: P2)

A family member sets their phone to dark mode. Every screen in the product is correct, because no
screen knows which theme it is in — each one asks for a role and the role resolves itself.

**Why this priority**: This is the entire justification for spending the effort on semantic role
names rather than colour names. If dark mode turns out to need per-screen work, the roles bought
nothing and a rename across the whole codebase is coming. Proving it early is the point.

**Independent Test**: Render every screen in both themes and assert that no feature code branches
on the active theme.

**Acceptance Scenarios**:

1. **Given** the operating system is set to dark, **When** the application opens, **Then** every surface, text, border and status colour resolves to its dark value from artboard 01.
2. **Given** the operating system theme changes while the application is open, **When** the change occurs, **Then** the interface follows it without a restart and without losing what the person was doing.
3. **Given** any colour pairing documented on artboard 01, **When** its contrast is measured in either theme, **Then** it meets the floor stated there — 4.5:1 for body text, 3:1 for disabled labels.
4. **Given** any component's source, **When** it is inspected, **Then** it contains no condition on the active theme.
5. **Given** a person has explicitly chosen a theme rather than following the system, **When** they close and reopen the application, **Then** their choice is still in effect.

---

### User Story 3 - The four patterns are components, not conventions (Priority: P3)

Someone building the document vault reaches for the proposal component. It will not render without
a source and a confidence, and it offers no way to accept itself. Someone building a child's record
reaches for the gated surface, and the gate and the audit notice come with it.

**Why this priority**: Four constitution principles — VI, VII, and V twice — have no enforcement
in the interface unless their shape is a component that cannot be assembled wrongly. A rule written
in a document is not enforcement; it is a hope about what a tired person will remember on a Friday.

**Independent Test**: Attempt to render each of the four pattern components with its required
evidence missing, and assert each one refuses.

**Acceptance Scenarios**:

1. **Given** a proposal with no source citation or no confidence, **When** it is rendered, **Then** rendering fails rather than displaying an unattributed proposal.
2. **Given** a valid proposal, **When** it is displayed, **Then** it is visually distinct from a confirmed value, is labelled as not saved, and shows where it came from.
3. **Given** the proposal component, **When** its interface is inspected, **Then** it exposes no path that commits the value without an explicit human action.
4. **Given** a guardian-gated surface, **When** it is rendered, **Then** the gate is visible, the people who may see it are named, and the notice that reads are logged is present.
5. **Given** a reminder with no rule identifier, rule version or source reference, **When** it is rendered, **Then** rendering fails.
6. **Given** a resource the viewer is not entitled to reach, **When** the not-found state renders, **Then** it is the same component, the same wording and the same actions a genuinely missing resource produces.

---

### User Story 4 - One component set, phone and wide screen (Priority: P4)

The same components lay themselves out correctly on a 390px phone and on a 1440px window. Nothing
forks; only the container changes.

**Why this priority**: Real, and cheap to hold now, but not blocking — there is no web application
yet. The requirement at this stage is that nothing in the package precludes one, because the cost
of discovering otherwise later is a rewrite of every component.

**Independent Test**: Render the shell at each documented breakpoint and compare against artboard 04.

**Acceptance Scenarios**:

1. **Given** a viewport at each breakpoint on artboard 04, **When** a screen renders, **Then** its margins, column count, gutters and control heights match what that board specifies.
2. **Given** the token layer, **When** it is imported outside a native runtime, **Then** it resolves to plain values without requiring one.
3. **Given** a shared component, **When** its source is inspected, **Then** it contains no branch on platform for anything other than the differences artboard 04 explicitly permits.

---

### User Story 5 - A contributor can find the specified value (Priority: P5)

Someone joining the project can see every component and every state it can be in, without running
the product and without asking anyone.

**Why this priority**: This is the reason the canvas was drawn before any code. It is last because
the product functions without it, and first to be missed the moment a second person arrives.

**Independent Test**: Open the component gallery and confirm every state drawn on artboards 05–09
is reachable there.

**Acceptance Scenarios**:

1. **Given** the gallery, **When** a contributor looks for a component, **Then** every state drawn for it on the canvas is present and labelled with the same name the canvas uses.
2. **Given** a value in code and the same value on the canvas, **When** the two differ, **Then** the difference is detectable without reading both by eye.

---

### Edge Cases

- **A value is changed on the canvas but not in code, or the reverse.** The two must not drift silently. The canvas is the source of truth, so the failure mode that matters is code disagreeing with it, and that must be detectable rather than discovered months later by a person noticing two shades of the same grey.
- **A screen genuinely needs a value that is not on a scale.** The answer is not a one-off literal. Either the scale gains a documented step on the canvas, or the design changes to use an existing step. Artboard 06 already records one such exception (14px field padding) and the mechanism is the same: it is written down, with its reason, or it does not exist.
- **The person has set their operating system text size to the maximum.** Every screen must remain usable — no clipped labels, no overlapping rows, no button whose text is cut off. This is the accessibility case most likely to break a layout built from fixed heights, and the canvas is drawn entirely in fixed heights.
- **The person has asked the operating system to reduce motion.** Any transition the system introduces must honour that.
- **The theme changes while a sheet or dialog is open.** The interface must follow without dismissing what the person was doing.
- **A feature needs a component that does not exist yet.** It is added to the canvas first, as its own artboard states, and then built — not improvised inside the feature and retrofitted later.
- **A component is rendered before its data arrives.** Every row and card type has a loading form on artboard 07; a component with no loading state will produce a layout jump the moment real data replaces it.

## Requirements *(mandatory)*

### Functional Requirements

#### The token layer

- **FR-001**: The system MUST expose every value defined on artboards 01, 02 and 03 as a named role, and MUST expose no value that those artboards do not define.
- **FR-002**: Every colour role MUST carry both a light and a dark resolution. A role with only one resolution MUST NOT exist.
- **FR-003**: Theme resolution MUST occur once, at the root of the application. No component may read the active theme in order to choose a value.
- **FR-004**: The system MUST follow the operating system's theme by default, and MUST allow a person to override it explicitly with system, light or dark.
- **FR-005**: An explicit theme override MUST survive the application being closed and reopened.
- **FR-006**: The token layer MUST be plain data with no dependency on a native runtime, a styling framework, or any rendering library, so that a future web target can consume the identical values.
- **FR-007**: Changing any single token's value MUST be a change to one location.

#### Enforcement

- **FR-008**: A literal colour, spacing, radius, font size, line height or elevation value appearing anywhere outside the token layer MUST fail an automated check that names the file, the line and the value.
- **FR-009**: A value that is not a member of its documented scale MUST fail the same check, including inside the component library.
- **FR-010**: The documented contrast floors on artboard 01 MUST be verified automatically for every documented pairing in both themes, and a failure MUST block merge.
- **FR-011**: The package MUST NOT depend on any bounded context, wire contract, API client, or data-access code, and this MUST be enforced by the boundary gate rather than by review.
- **FR-012**: A divergence between a value on the canvas and the same value in the token layer MUST be detectable by an automated check.

#### Components

- **FR-013**: Every component drawn on artboards 05 through 08 MUST exist, and every state drawn for it MUST be reachable.
- **FR-014**: A button MUST NOT change its width between its states, so that a control cannot move under a thumb already travelling toward it.
- **FR-015**: A field MUST have a persistent visible label. The only permitted exception is search, which MUST still carry an accessible name.
- **FR-016**: Every interactive control MUST present a touch target of at least 44px on its shortest axis, regardless of the size it is drawn at.
- **FR-017**: An icon-only control MUST carry an accessible name describing its action.
- **FR-018**: Every component MUST remain usable at the operating system's largest standard text size, with no clipped, truncated or overlapping text.
- **FR-019**: Every component MUST honour the operating system's reduced-motion setting.
- **FR-020**: Every row and card component MUST provide the loading form drawn on artboard 07, at the same anatomy as its loaded form.

#### The four patterns

- **FR-021**: The proposal component MUST require a source reference and a confidence value, MUST render as visually distinct from a confirmed value, MUST label itself as not saved, and MUST expose no interface that commits the value without an explicit human action.
- **FR-022**: The guardian-gated surface component MUST render the gate visibly, MUST name who may see the content, and MUST state that access is recorded.
- **FR-023**: The reminder component MUST require a rule identifier, a rule version and a source reference, and MUST display them.
- **FR-024**: The not-found component MUST be a single component used for both a missing resource and an unreachable one, with identical wording and identical actions, so that the interface cannot disclose that a resource exists.

#### The application shell

- **FR-025**: The mobile application MUST boot to a rendered screen assembled entirely from this package.
- **FR-026**: The shell MUST provide the five navigation destinations drawn on artboard 08, in that order.
- **FR-027**: The shell MUST NOT contain any bounded-context logic, any network call, or any product behaviour beyond navigating between destinations.
- **FR-028**: A component gallery MUST make every state drawn on artboards 05 through 09 viewable without running the product, labelled with the names the canvas uses.

### Key Entities

- **Token**: A named value with a role name, a category (colour, type, space, radius, elevation), and one resolution per theme where the category is theme-dependent. Tokens are the only source of values in the product.
- **Theme**: A complete resolution of every colour role. Exactly two exist — light and dark — plus the instruction to follow the operating system.
- **Component**: A named, reusable piece of interface with a fixed anatomy and an enumerated set of states, each of which is drawn on the canvas before it is built.
- **Pattern**: A component whose shape is required by a constitution principle rather than chosen for appearance, and which refuses to render without the evidence that principle demands.
- **Breakpoint**: A named viewport range with its own column count, margin and gutter, and its own control height for touch or pointer input.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A screen drawn on the canvas can be rebuilt using only this package, and the resulting screen source contains zero literal design values — verified by an automated check that fails on the first literal.
- **SC-002**: 100% of the colour pairings documented on artboard 01 meet their stated contrast floor in both themes, verified automatically on every change.
- **SC-003**: 100% of the component states drawn on artboards 05 through 09 are reachable in the gallery.
- **SC-004**: Switching the entire product between light and dark requires changes to zero screens.
- **SC-005**: A person using the largest standard operating-system text size can read every label and reach every action on every screen the shell renders, with no clipped or overlapping text.
- **SC-006**: Every interactive control measures at least 44px on its shortest axis.
- **SC-007**: A contributor who has never seen the codebase can find the specified value for any element on any screen in under one minute, using the canvas alone.
- **SC-008**: The application boots to a rendered screen on both iOS and Android.
- **SC-009**: Changing one token value and rebuilding changes every screen that uses that role, with no other file edited.

## Personal Data, Deletion, and Export *(mandatory — Constitution Principle XI)*

1. **What personal data this feature stores, and why**: None. The only value this feature persists
   is the person's theme preference — one of system, light or dark — stored on the device. It is not
   associated with a `UserId`, is not transmitted anywhere, and is not personal data; it is recorded
   only because someone who overrides their operating system's theme expects that choice to survive
   closing the application. This feature stores no name, no email, no family-scoped value, and per
   Principle III it may not: it has no dependency on any bounded context through which such a value
   could reach it.

2. **What happens when this feature's data is deleted with an account**: Nothing, because nothing is
   keyed to an account. The theme preference is removed when the application is removed from the
   device or its storage is cleared, and it survives account deletion for the same reason it survives
   signing out — it belongs to the device, not to a person.

3. **What happens when a whole family is erased**: Not applicable. This feature holds no
   family-scoped data and cannot: it has no path to any context that owns any.

4. **How this data appears in a user's data export**: It does not, because there is no server-side
   record of it to export. This is stated rather than skipped because Principle XI requires every
   feature to answer it, and because "we store nothing" is a claim that should be made explicitly
   and then be checkable, rather than assumed.

5. **Retention period after which data is removed even without a request**: The device-local theme
   preference persists until the application is uninstalled or its storage cleared. There is no
   server-side retention, because there is no server-side record.

## Dependencies

- **An ADR recording the mobile framework choice does not yet exist.** `ARCHITECTURE.md` §4 and §8
  name Expo and React Native, and this specification assumes them, but `adr/` holds no record of
  that decision, its alternatives or its trade-offs — unlike every other foundational technology in
  this repository, each of which has one. A new application and a new user-interface framework is a
  larger commitment than several decisions that did get an ADR. **This should be recorded as an ADR
  and merged before implementation begins**, alongside the styling approach the package will use,
  which is an equally consequential and equally unrecorded choice.
- Two new workspace entries — a `ui` package and a `mobile` application — must be declared to the
  workspace and given boundary rules. The boundary gate fails closed, so a package matching no rule
  is an error, not an omission.
- The design canvas at `design/` must remain in the repository and in sync, since it is the
  normative reference this specification defers to throughout.

## Out of Scope

- Any product feature. No calendar, no tasks, no documents, no family, no reminders. The shell
  navigates between empty destinations rendered from sample content.
- Any network call, wire contract or API client. This feature talks to nothing.
- Any bounded-context logic. The patterns in FR-021 to FR-024 are presentational shapes that enforce
  the *display* obligations of their principles; the domain obligations remain with the contexts
  that own them.
- The web application. This feature must not preclude one (FR-006) but does not build one.
- Localisation and translation. Copy is British English, and the Reference and Locale context that
  would generalise this does not exist yet.
- Iconography beyond the set drawn on artboard 03.
- A motion or animation system beyond honouring reduced motion.
- Application store distribution, signing, and over-the-air update strategy.
- Screens for any specification other than the ones already drawn. Artboards 10 through 15 are
  reference material for later features, not deliverables of this one.

## Assumptions

- The mobile client is Expo and React Native, per `ARCHITECTURE.md` §4 and §8, pending the ADR
  named under Dependencies.
- Components target mobile in this feature; only the token layer is required to be platform-neutral
  now. Making the components themselves render on the web is a later decision with its own cost.
- The canvas at `design/` is the source of truth for values, and a change is made there first. The
  artboard sources are tracked in the repository for exactly this reason; the seeded canvas page is
  not, because it is regenerated output.
- Sample content on the canvas — the household, the names, the document identifiers, the dates — is
  illustrative and is not production copy. Product copy is written per feature.
- "Largest standard text size" means the largest setting reachable without the operating system's
  accessibility-specific extra-large range, which is a separate and larger piece of work.
- There is no backend for this feature to reach, and none is needed: every screen it renders is
  built from static sample content.
- The component gallery is a development-time surface, not something shipped to families.
