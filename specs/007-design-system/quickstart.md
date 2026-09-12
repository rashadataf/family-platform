# Quickstart: Design System and Mobile Application Shell

**Feature**: 007-design-system | **Date**: 2026-09-12

How to run this feature and prove it does what the specification says. Each scenario below maps to
requirements and can be run independently.

## Prerequisites

**This is the one part of the repository where "Docker is the only prerequisite" does not hold.**
[ADR-014](../../adr/ADR-014-containerized-development.md) says so explicitly and the README repeats
it: the mobile application needs host-native simulators.

- Node 24 (`.nvmrc`) and pnpm. `engine-strict=true` means a wrong Node version fails at install.
- Xcode with an iOS simulator, or Android Studio with an emulator, or a physical device with Expo Go
  for the JavaScript-only paths.
- `pnpm install` at the repository root.

The checks under "Verify without a device" need none of this and run anywhere the rest of the
repository runs.

## Verify without a device

These four commands prove most of the specification and need no simulator. Run them first — if any
fails, running the app will not tell you anything the check has not already said more precisely.

```sh
pnpm typecheck              # FR-002, FR-009: a one-theme colour role or an off-scale value
pnpm lint                   # FR-008, FR-009: a literal design value outside the token module
pnpm boundaries             # FR-006, FR-011: the token layer importing anything at all
pnpm verify:contrast        # FR-010: every documented pairing, both themes
pnpm verify:design-tokens   # FR-012: the token module against design/tokens.json
pnpm test --project unit    # the guard functions, the scales, the contrast maths
```

**Expected**: all pass. `verify:contrast` prints the number of pairings checked, which should equal
the length of `contrastPairs` in `design/tokens.json` — a pairing that exists in the product but not
in that list is unchecked, and the count is how you notice.

## Scenario 1 — A screen built from nothing but tokens

*Covers US1, FR-001, FR-007.*

```sh
pnpm --filter @fp/mobile start        # then press i or a
```

1. The application boots to Today (FR-025, FR-026).
2. Compare it against artboard 11 on the canvas. Every value should match, because both came from
   the same place.
3. Now break it on purpose: write `padding: 13` into a screen and run `pnpm lint`. It must fail,
   naming the file, the line and the value. Write `backgroundColor: '#FFFFFF'` and it must fail
   again. **A check that has never been seen to fail has not been verified.**
4. Change one token's value in `packages/ui/src/tokens/colour.ts`, reload, and confirm every screen
   using that role moved together (SC-009).

## Scenario 2 — Both themes, no per-screen work

*Covers US2, FR-003, FR-004, FR-005.*

1. Boot the app with the device in light mode. Switch the device to dark **while the app is open**.
2. **Expected**: the interface follows without a restart, and an open sheet or dialog stays open —
   the edge case that catches a naive implementation.
3. Set an explicit override in the app, force-quit, reopen. The override survives (FR-005).
4. Set it back to "system" and confirm it follows the device again.
5. Search the screens for a conditional on the theme name. There should be none, and `useTheme`
   should give you nothing to write one with (FR-003).

## Scenario 3 — The patterns refuse

*Covers US3, FR-021 to FR-024. This is the scenario worth running most carefully.*

Each of these is a unit test as well as a manual check, because the refusal is a pure guard:

1. Construct a `Proposal` with no source. **Expected**: it refuses. Not a warning, not a fallback.
2. Read `Proposal`'s props. **Expected**: nothing that commits the value — no auto-accept, no default
   action, no flag that turns confirmation off. The absence is the requirement.
3. Construct a `GatedSurface` without naming who may see the content. **Expected**: refuses.
4. Construct a `Reminder` without a rule version. **Expected**: refuses.
5. Render `NotFound` for a resource that exists but is unreachable, and for one that genuinely does
   not exist. **Expected**: identical wording, identical actions, and no prop that could distinguish
   them (FR-024).

## Scenario 4 — Breakpoints

*Covers US4, FR-006.*

1. Run the app on a phone and on a tablet simulator.
2. **Expected**: margins, columns, gutters and control heights match artboard 04 at each width.
3. Import `@fp/ui/tokens` from a plain Node script — no React, no React Native. **Expected**: it
   resolves and prints values. This is FR-006's portability claim, and it is either true or it is
   not; `pnpm boundaries` proves the import graph, this proves the runtime.

## Scenario 5 — Text scaling

*Covers FR-018, and the failure mode research R8 predicts.*

1. Set the device to its largest standard text size.
2. Walk every screen the shell renders.
3. **Expected**: no clipped labels, no overlapping rows, no truncated button text. Controls have
   grown taller than the token that names their height, because those heights are floors rather than
   fixed values.

This is the scenario most likely to fail on a first implementation. The canvas is drawn entirely in
fixed heights and reads as though they are exact.

## Scenario 6 — The gallery

*Covers US5, FR-028.*

```sh
pnpm --filter @fp/mobile start    # navigate to the gallery route in a development build
```

**Expected**: every state drawn on artboards 05 through 09 is present and labelled with the name the
canvas uses. Open the canvas beside it and walk both.

Note the amended wording: the gallery makes states viewable **without navigating product flows**, not
"without running the product" — see the amendment note in [plan.md](plan.md) and
[research R9](research.md).

## Definition of done

- Every command under "Verify without a device" passes, and each enforcement check has been seen to
  fail on a deliberate violation.
- All six scenarios behave as described, on both iOS and Android (SC-008).
- Every state on artboards 05–09 appears in the gallery (SC-003).
- No screen contains a literal design value (SC-001) and none branches on the theme (SC-004).
