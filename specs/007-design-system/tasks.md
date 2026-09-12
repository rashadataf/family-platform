---
description: 'Task list for spec 007 — design system and mobile application shell'
---

# Tasks: Design System and Mobile Application Shell

**Input**: Design documents from `/specs/007-design-system/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Included, but narrowly. [Research R6](research.md) decided what carries risk here — the token
scales, the pattern guards, the contrast maths, the drift check and the lint rule, all of which are
pure TypeScript testable in the existing Vitest `unit` project. **Component rendering tests are
deliberately absent**, and no second test runner is introduced. The trigger for revisiting is
recorded in R6.

**Organization**: Grouped by user story so each is independently deliverable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task serves
- Paths follow the structure in [plan.md](plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make the workspace able to hold two new packages without breaking a gate.

**Order matters here.** `verify-workspace-packages.ts` discovers packages by scanning for
`package.json`, so the moment T005 or T006 lands, `verify-env` fails until that package is declared.
Declare first, create second. T003 must also precede T006, or the first image build after the mobile
app appears starts downloading React Native.

- [X] T001 Declare `packages/ui` in the three places `verify-workspace-packages.ts` requires: a `COPY` line in the deps stage of `apps/api/Dockerfile`, a named `node_modules` volume in `docker-compose.yml`, and `'packages/ui': []` in `WORKSPACE_GRAPH` in `.dependency-cruiser.cjs` (FR-011). **No change to the verification script** — [research R2](research.md) records why its earlier proposed rewrite was based on a false premise
- [X] T002 Add the `token-layer-imports-nothing` rule to `.dependency-cruiser.cjs`, making FR-006 a boundary failure rather than a review observation (see [contracts/package-api.md](contracts/package-api.md))
- [X] T003 Scope the deps-stage `pnpm install --frozen-lockfile` in `apps/api/Dockerfile` to what `@fp/api` and `@fp/worker` need, so the mobile app cannot pull React Native into every image build ([research R2](research.md)). **Must land before T006**, and the `image` gate must be re-run to prove it still builds
- [X] T004 Declare `apps/mobile` in the same three places, with `'apps/mobile': ['packages/ui']` in `WORKSPACE_GRAPH` — deliberately narrow; `packages/contracts` is added when a feature actually calls the API
- [X] T005 [P] Create `packages/ui` — `package.json` as `@fp/ui`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js` — mirroring `packages/kernel`'s manifest shape exactly
- [X] T006 Create the Expo application in `apps/mobile` — `package.json`, `app.config.ts`, `tsconfig.json`, `eslint.config.js`
- [X] T007 Configure Metro for the pnpm workspace in `apps/mobile/metro.config.js` — `watchFolders` at the repository root, `resolver.nodeModulesPaths` for both app and root, symlink resolution left on ([research R1](research.md); `node-linker=hoisted` is **not** an option and the reason is recorded there)
- [X] T008 Confirm the whole gate set is green with both packages still empty: `pnpm typecheck && pnpm lint && pnpm boundaries && pnpm verify:workspace && pnpm format:check`

**Checkpoint**: Two empty packages exist and every gate passes. Nothing renders yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the enforcement that [ADR-016](../../adr/ADR-016-mobile-client-and-styling.md)'s
no-framework decision made this feature's own responsibility. **FR-008, FR-009 and FR-012 are
delivered here, by tooling, not by components** — if this phase slips, three requirements are
specified and unenforced.

**⚠️ CRITICAL**: No user story work begins until this phase completes.

- [X] T009 Create `design/tokens.json` carrying every value from artboards 01–04 plus the `contrastPairs` list, per [contracts/tokens-json.md](contracts/tokens-json.md)
- [X] T010 [P] Define the `tokens.json` schema and parse it — **parsed, never cast**, because it is data entering from outside the program's memory (Principle II) — in `scripts/lib/design-tokens-schema.ts`
- [X] T011 Implement `scripts/verify-design-tokens.ts` comparing the TypeScript token module against `design/tokens.json` and failing on any divergence (FR-012)
- [X] T012 [P] Implement `scripts/verify-contrast.ts` computing the WCAG ratio for every `contrastPairs` entry in both themes, printing the count checked (FR-010)
- [X] T013 [P] Unit test the contrast computation against known-good ratios in `scripts/verify-contrast.spec.ts`
- [X] T014 Implement the `no-literal-design-values` ESLint rule in `packages/config-eslint/rules/no-literal-design-values.js`, scoped to exempt the token module itself (FR-008, FR-009)
- [X] T015 [P] Unit test the rule — a literal hex, an off-scale spacing, a hex in a comment that must NOT trigger — in `packages/config-eslint/rules/no-literal-design-values.spec.ts`
- [X] T016 Wire `verify:contrast` and `verify:design-tokens` into the root `package.json` `verify` script and into the existing `verify-env` CI job, rather than adding a twelfth required check (which would mean amending spec 002's required-checks contract and branch protection)

**Checkpoint**: The enforcement exists and has been unit-tested. It has not yet been seen to fail on real code — that is T032.

---

## Phase 3: User Story 1 — Build a screen without inventing a value (Priority: P1) 🎯 MVP

**Goal**: A token layer, the primitives, and a Today screen assembled from nothing else.

**Independent Test**: Rebuild Today (artboard 11) from `@fp/ui` alone and confirm the screen's source
contains no literal design value. **Note the honest dependency**: Today's reminders section uses the
Reminder *pattern*, which belongs to US3 — this phase delivers Today's schedule and tasks sections,
and T044 completes the screen.

- [X] T017 [P] [US1] Colour tokens, every role carrying both a light and a dark value so a one-theme role does not compile (FR-002), in `packages/ui/src/tokens/colour.ts`
- [X] T018 [P] [US1] The thirteen typography steps in `packages/ui/src/tokens/typography.ts`
- [X] T019 [P] [US1] Space, radius and elevation as closed unions of their literal members, so an off-scale value is a type error (FR-009), in `packages/ui/src/tokens/space.ts`, `radius.ts`, `elevation.ts`
- [X] T020 [P] [US1] Breakpoints, columns, margins, gutters and control heights in `packages/ui/src/tokens/layout.ts`
- [X] T021 [US1] Barrel the token module in `packages/ui/src/tokens/index.ts`, importing nothing outside the directory (FR-006; T004 now enforces this)
- [X] T022 [P] [US1] Unit test that every scale matches `design/tokens.json` member for member, in `packages/ui/src/tokens/tokens.spec.ts`
- [X] T023 [US1] `ThemeProvider` resolving one palette at the root — light only in this phase — in `packages/ui/src/theme/theme-provider.tsx` (FR-003)
- [X] T024 [US1] `useTheme` returning resolved values and **no theme name**, so a consumer has nothing to branch on (FR-003), in `packages/ui/src/theme/use-theme.ts`
- [X] T025 [P] [US1] Button — five variants, five states, three heights, width unchanged between states (FR-014), heights as floors per [research R8](research.md) — in `packages/ui/src/primitives/button/`
- [X] T026 [P] [US1] Field — every state from artboard 06, persistent visible label, search as the one documented exception (FR-015) — in `packages/ui/src/primitives/field/`
- [X] T027 [P] [US1] The four row types with their loading forms at matching anatomy (FR-020) in `packages/ui/src/primitives/row/`
- [X] T028 [P] [US1] Surfaces — card, status pill, avatar with the id-derived colour, empty state, toast — in `packages/ui/src/primitives/surface/`
- [X] T029 [P] [US1] Navigation — tab bar, headers, segmented control, sheet, dialog — in `packages/ui/src/primitives/navigation/`
- [X] T030 [US1] The five Expo Router destinations in the order artboard 08 fixes (FR-026) in `apps/mobile/src/app/`
- [X] T031 [US1] Today assembled from `@fp/ui` only, from static sample content, in `apps/mobile/src/app/index.tsx` (SC-001, FR-027 — no network call)
- [X] T032 [US1] **Prove the enforcement fires**: write `padding: 13` and a literal hex into a screen, confirm `pnpm lint` and `pnpm typecheck` fail naming file, line and value, then revert. A check never seen to fail has not been verified

**Checkpoint**: The app boots to Today in light mode, and a literal value cannot reach `main`.

---

## Phase 4: User Story 2 — Both themes, no per-screen work (Priority: P2)

**Goal**: Dark mode with no screen aware of it.

**Independent Test**: Switch the device theme while the app is open; every surface follows, an open sheet stays open, and no screen contains a conditional on the theme.

- [ ] T033 [US2] Resolve the palette from the OS colour scheme, following it by default (FR-004), in `packages/ui/src/theme/theme-provider.tsx`
- [ ] T034 [US2] Device-local preference storage for `system` / `light` / `dark`, surviving a restart (FR-005), in `packages/ui/src/theme/theme-storage.ts`
- [ ] T035 [US2] The override control in `apps/mobile/src/app/`
- [ ] T036 [US2] Live switching with no restart, preserving an open sheet or dialog — the edge case a naive implementation drops
- [ ] T037 [P] [US2] Unit test preference resolution: system follows the OS, an override wins, an absent stored value falls back to system, in `packages/ui/src/theme/theme.spec.ts`
- [ ] T038 [US2] Run `pnpm verify:contrast` and confirm every documented pairing passes in both themes (FR-010, SC-002)

**Checkpoint**: Both themes correct, zero screens changed to achieve it (SC-004).

---

## Phase 5: User Story 3 — The four patterns refuse (Priority: P3)

**Goal**: Four constitution principles enforced by component shape rather than by memory.

**Independent Test**: Construct each pattern with its required evidence missing and confirm each refuses. This is the phase worth reviewing most carefully.

- [ ] T039 [P] [US3] `Proposal` — refuses without a source reference and a confidence, renders visually distinct from a confirmed value, labelled as not saved, and **exposes no prop that commits the value** (FR-021, Principle VII) — in `packages/ui/src/patterns/proposal/`
- [ ] T040 [P] [US3] `GatedSurface` — refuses without naming who may see the content and without the access-is-recorded notice (FR-022, Principle VI) — in `packages/ui/src/patterns/gated-surface/`
- [ ] T041 [P] [US3] `Reminder` — refuses without rule id, rule version and source reference, and displays all three (FR-023, ARCHITECTURE §5.6) — in `packages/ui/src/patterns/reminder/`
- [ ] T042 [P] [US3] `NotFound` — one component for missing and unreachable alike, taking **no prop that could distinguish them**, because a prop that could would eventually be passed (FR-024, Principle V) — in `packages/ui/src/patterns/not-found/`
- [ ] T043 [P] [US3] Guard unit tests for all four, asserting refusal on each missing field, in `packages/ui/src/patterns/patterns.spec.ts`
- [ ] T044 [US3] Add Today's reminders section using `Reminder`, completing the screen US1 left partial, in `apps/mobile/src/app/index.tsx`
- [ ] T045 [US3] Assert by inspection that `Proposal`'s exported props contain no auto-accept, no default action and no confirmation-disabling flag (quickstart scenario 3, step 2)

**Checkpoint**: A feature cannot ship a proposal that looks like a fact.

---

## Phase 6: User Story 4 — One component set, phone and wide screen (Priority: P4)

**Goal**: Breakpoint behaviour, and proof that the token layer is genuinely portable.

**Independent Test**: Render at each breakpoint and compare against artboard 04; import the tokens from plain Node.

- [ ] T046 [US4] Breakpoint-aware layout container applying the columns, margins and gutters artboard 04 fixes, in `packages/ui/src/primitives/`
- [ ] T047 [US4] Control heights by input type — 48 touch, 40 pointer — with nothing else varying by breakpoint
- [ ] T048 [P] [US4] `scripts/verify-token-portability.ts`: import `@fp/ui/tokens` from plain Node with no React and no React Native, proving FR-006 at runtime as well as in the import graph
- [ ] T049 [US4] Verify margins, columns and gutters against artboard 04 at each breakpoint on a phone and a tablet simulator

**Checkpoint**: FR-006's portability claim is tested, not asserted.

---

## Phase 7: User Story 5 — A contributor can find the value (Priority: P5)

**Goal**: Every drawn state visible without walking product flows.

**Independent Test**: Open the gallery beside the canvas and walk both, board by board.

- [ ] T050 [US5] Gallery route, development builds only, in `apps/mobile/src/gallery/`
- [ ] T051 [US5] Register every state drawn on artboards 05–09, labelled with the names the canvas uses (FR-028 as amended, SC-003)
- [ ] T052 [US5] Cross-check the gallery against the canvas board by board and record any state drawn but not built

**Checkpoint**: The canvas and the code can be compared by a person in a minute (SC-007).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T053 Text-scaling pass at the largest standard OS text size across every screen — no clipping, no overlap, controls grown past their token height (FR-018). [Research R8](research.md) predicts this is the most likely first-implementation failure
- [ ] T054 [P] Accessible name on every icon-only control (FR-017)
- [ ] T055 [P] Honour the OS reduced-motion setting wherever a transition exists (FR-019)
- [ ] T056 [P] Note on artboard 05 that control heights are **floors, not fixed values**, in `design/Buttons.dc.html`, and re-seed the canvas — the boards currently read as though the heights are exact
- [ ] T057 [P] Update `ARCHITECTURE.md` §8 repository structure to include `design/`, `packages/ui` and `apps/mobile`, which it does not currently mention
- [ ] T058 [P] Update `README.md` so the mobile app's host-native prerequisites sit alongside the Docker-only guarantee, which applies to backend work only
- [ ] T059 Run the full [quickstart.md](quickstart.md) validation on both iOS and Android (SC-008)
- [ ] T060 Confirm every enforcement check has been seen to fail on a deliberate violation — contrast, drift, literal value, off-scale value, token-layer import

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies. T001 must precede T005 and T006 or `verify-env` goes red.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.**
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on US1 — it changes how the provider built in T023 resolves.
- **US3 (Phase 5)**: depends on Foundational only. Can run in parallel with US2. T044 touches the same file as T031, so it follows US1.
- **US4 (Phase 6)**: depends on US1.
- **US5 (Phase 7)**: depends on whichever stories have shipped; the gallery grows as components land.
- **Polish (Phase 8)**: depends on all shipped stories.

### The one cross-story dependency worth naming

Today is completed by two stories: US1 builds its schedule and tasks sections, US3 adds its
reminders section. This is a genuine coupling rather than a tidy fiction — the screen the
specification names as US1's independent test contains a component that belongs to US3. US1 remains
independently testable with two of its three sections.

### Parallel opportunities

- T002 edits the same file as T001's third declaration site, so those two are sequential. T005 can run alongside either.
- T010, T012, T013 and T015 are four separate files in Phase 2.
- **T017–T020 are the largest parallel block**: four token files, no interdependency.
- T025–T029: five primitive families, five directories.
- T039–T043: four patterns and their tests.
- Most of Phase 8.

---

## Parallel Example: User Story 1 token layer

```bash
# Four token files, no interdependency — the widest parallel block in the feature:
Task: "Colour tokens with both theme resolutions in packages/ui/src/tokens/colour.ts"
Task: "Thirteen typography steps in packages/ui/src/tokens/typography.ts"
Task: "Space, radius, elevation as closed unions in packages/ui/src/tokens/{space,radius,elevation}.ts"
Task: "Breakpoints and layout in packages/ui/src/tokens/layout.ts"

# Then the five primitive families, once the barrel (T021) and theme (T023, T024) exist:
Task: "Button in packages/ui/src/primitives/button/"
Task: "Field in packages/ui/src/primitives/field/"
Task: "Rows in packages/ui/src/primitives/row/"
Task: "Surfaces in packages/ui/src/primitives/surface/"
Task: "Navigation in packages/ui/src/primitives/navigation/"
```

---

## Implementation Strategy

### MVP: Phases 1–3

Setup, Foundational, US1. That delivers a booting application, a token layer with both themes
defined, the primitives, and — the part that matters most — enforcement that has been *seen to fail*.
A design system whose rules are advisory decays within three features; T032 is what stops that.

**Stop and validate at T032** before starting US2.

### Incremental delivery

1. Phases 1–2 → the workspace holds the packages and the enforcement exists.
2. US1 → Today renders in light, no literal value can reach `main`. **MVP.**
3. US3 → the four patterns refuse; Today completes. *Prefer this before US2* — it carries the
   constitution obligations, while US2 carries a user preference.
4. US2 → dark mode, proving the role names earned their cost.
5. US4 → breakpoints and the portability proof.
6. US5 → the gallery.
7. Phase 8 → text scaling first; it is the most likely real failure.

### Note on sequencing US2 versus US3

The specification prioritises US2 above US3, and that ordering is right for *user* value — dark mode
is visible to a family, pattern guards are not. For *risk*, the order inverts: US3 enforces four
constitution principles and US2 enforces a preference. Both are listed above in specification order;
delivering US3 first is a defensible departure and is recommended if only one of the two fits before
a checkpoint.

---

## Notes

- `[P]` means a different file with no incomplete dependency.
- Commit after each task or logical group.
- Every task above traces to a requirement, a research decision, or a gate. A task that traces to
  none of those does not belong here.
- The three tasks most likely to be underestimated: T014 (the ESLint rule), T053 (text scaling) and
  T003 (scoping the image install). None is hard; each is fiddlier than it reads.
