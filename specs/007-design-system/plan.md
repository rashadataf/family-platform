# Implementation Plan: Design System and Mobile Application Shell

**Branch**: `007-design-system` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-design-system/spec.md`

## Summary

Build the design canvas in code. A dependency-free token layer and a React Native component library
in `packages/ui`, consumed by a new Expo application in `apps/mobile` that boots to a shell of five
navigation destinations and a development-only component gallery.

The technical approach is settled by [ADR-016](../../adr/ADR-016-mobile-client-and-styling.md):
React Native via Expo, and plain TypeScript token objects with `StyleSheet` rather than a styling
framework. That second decision is what makes this plan's shape unusual — the enforcement that a
styling framework would have provided has to be built, so **three of this feature's requirements
(FR-008, FR-009, FR-012) are delivered by tooling rather than by components**, and that tooling is
scheduled work, not an assumption.

[Phase 0 research](research.md) found two constraints that are decided by the repository rather than
by preference, and one requirement that cannot be met as written:

- pnpm's symlinked `node_modules` **must stay**, because Principle III names strict linking as one of
  its four enforcement layers. The conventional `node-linker=hoisted` fix would delete that layer
  repository-wide. Metro is configured for the workspace instead.
- The API image's **install must be scoped** before the mobile app joins the workspace, or every
  image build downloads React Native. (An earlier draft of this plan proposed changing
  `verify-workspace-packages.ts` instead; reading the Dockerfile showed that premise was false —
  see [research R2](research.md).)
- **FR-028 needs amending.** It requires every component state to be viewable "without running the
  product", which no option permitted by ADR-016 can satisfy.

## Technical Context

**Language/Version**: TypeScript 5.9, strict mode, no per-package relaxation (Principle I). Node 24
for tooling, per `.nvmrc` and `engine-strict=true`.

**Primary Dependencies**: Expo and React Native (ADR-016), Expo Router (research R5). No styling
framework, by decision. No new runtime dependency in `packages/ui` beyond React and React Native
themselves — the token layer imports nothing at all.

**Storage**: None server-side. One device-local value: the theme override, one of `system`, `light`
or `dark`. Not personal data, not associated with a `UserId`, never transmitted (spec, Principle XI
section).

**Testing**: Vitest, in the existing `unit` project. No second test runner (research R6) — what
carries risk here is values and enforcement, all of which is pure TypeScript.

**Target Platform**: iOS and Android through Expo. The token layer additionally must resolve outside
a native runtime (FR-006), so that a future web client consumes identical values.

**Project Type**: A monorepo package plus a mobile application. Two new workspace entries.

**Performance Goals**: None specified for this feature; it renders static sample content. The
relevant target arrives with the first list-heavy screen, and ADR-016 names a low-end Android device
missing a target as a trigger for revisiting the framework.

**Constraints**: Every value from artboards 01–03 and nothing else (FR-001). Touch targets at 44px
minimum (FR-016). Usable at the largest standard OS text size (FR-018) — which, per research R8,
means every drawn height is a **floor rather than a fixed value**. Contrast floors verified
automatically in both themes (FR-010).

**Scale/Scope**: Roughly twenty components across five primitive families and four patterns; two
themes; four breakpoints; five navigation destinations; one gallery.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design. Both passes below.*

| Principle | Applies | How this feature satisfies it |
|---|---|---|
| I — Type safety is a contract | Yes | Strict mode, no `any`. Each scale is a union of its literal members, so an off-scale value is a compile error (research R3). |
| II — Validate at every boundary | Yes, narrowly | One boundary exists: `design/tokens.json`, read by a verification script. It MUST be schema-parsed, not cast — it is data entering from outside the program's memory like any other. |
| III — Boundaries are enforced | Yes | Two new `WORKSPACE_GRAPH` entries; `packages/ui` allowed to reach nothing; a new `token-layer-imports-nothing` rule making FR-006 a boundary violation rather than a convention. Strict pnpm linking preserved (research R1). |
| IV — Persistence through the data-access layer | No | No database. The device-local theme value is client storage, not platform persistence, and reaches no repository. |
| V — Object-level authorization | Indirectly | No authorization happens here. FR-024's single not-found component is the presentation half of the non-disclosure rule. |
| VI — Children sensitive by default | Indirectly | FR-022's gated-surface component is the presentation half. It cannot render without naming who may see the content and stating that access is recorded. |
| VII — AI proposes, the domain decides | Indirectly | FR-021's proposal component refuses to render without a source and a confidence, and exposes no self-accepting path. |
| VIII — Async work through the event system | No | No asynchronous work. |
| IX — API contracts are versioned artefacts | No | This feature talks to nothing. |
| X — Infrastructure is code | No | Not infrastructure. Expo config plugins keep native configuration in the repository, which is the same instinct. |
| XI — Deletion and export are designed | Yes | Answered in the specification: no personal data, stated explicitly rather than skipped. |
| UK-first without being UK-welded | Yes | Research R10: components receive formatted strings. No component calls a date or currency formatter, because that would put a UK-shaped primitive in the presentation layer. |
| Testing weight follows risk | Yes | Research R6: pure logic and enforcement are tested; presentational assembly is not, and the trigger for revisiting is recorded. |
| New external dependencies are decisions | Yes | Expo and React Native are ADR-016. Anything beyond them needs justification in the pull request. |
| Cost is a design constraint | Yes | No paid build service. ADR-013 defers that until real user data exists. |

**Result of the pre-Phase-0 gate**: pass, with one item requiring a deliberate deviation — see
Complexity Tracking.

**Result of the post-Phase-1 gate**: pass. The Phase 1 design introduced no new dependency, no new
boundary edge beyond the two planned entries, and no violation. The `token-layer-imports-nothing`
rule added during design makes FR-006 stronger than the specification requires — it becomes a
boundary failure rather than a code-review observation.

## Project Structure

### Documentation (this feature)

```text
specs/007-design-system/
├── plan.md              # This file
├── research.md          # Phase 0 output — eleven decisions, four forced by the repository
├── data-model.md        # Phase 1 output — the token and component model
├── quickstart.md        # Phase 1 output — how to run and verify this
├── contracts/
│   ├── package-api.md   # What @fp/ui exports, and the rules its consumers must obey
│   └── tokens-json.md   # The schema of design/tokens.json, the canvas-to-code boundary
├── checklists/
│   └── requirements.md  # Written by /speckit-specify
└── tasks.md             # Phase 2 output — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
packages/ui/                          # New. The design system.
├── package.json                      # @fp/ui
├── tsconfig.json  tsconfig.build.json
├── eslint.config.js
└── src/
    ├── tokens/                       # FR-006: this directory imports NOTHING
    │   ├── colour.ts                 #   role -> { light, dark }
    │   ├── typography.ts             #   thirteen steps
    │   ├── space.ts  radius.ts  elevation.ts
    │   ├── layout.ts                 #   breakpoints, columns, margins, gutters
    │   └── index.ts
    ├── theme/                        # FR-003: resolves once, at the root
    │   ├── theme-provider.tsx
    │   ├── use-theme.ts
    │   └── theme-storage.ts          #   FR-005, device-local
    ├── primitives/                   # Artboards 05-08
    │   ├── button/  field/  row/  surface/  navigation/
    ├── patterns/                     # Artboard 09 — the four that may refuse to render
    │   ├── proposal/  gated-surface/  reminder/  not-found/
    └── index.ts

apps/mobile/                          # New. The shell.
├── app.config.ts  metro.config.js    # metro.config.js carries the pnpm workspace resolution (R1)
├── package.json  tsconfig.json  eslint.config.js
└── src/
    ├── app/                          # Expo Router routes: the five destinations
    └── gallery/                      # FR-028, development builds only

design/
└── tokens.json                       # New. Machine-readable canvas values (R4)

packages/config-eslint/
└── rules/no-literal-design-values.js # New. FR-008 and FR-009 (R3)

scripts/
├── verify-design-tokens.ts           # New. FR-012 — code against canvas
├── verify-contrast.ts                # New. FR-010 — both themes, every documented pair
└── verify-workspace-packages.ts      # MODIFIED. See Complexity Tracking.

.dependency-cruiser.cjs               # MODIFIED. Two WORKSPACE_GRAPH entries, one new rule.
```

**Structure Decision**: Two new workspace entries, following the existing convention exactly —
`packages/ui` mirrors `packages/kernel`'s manifest shape (private, ESM, `dist` output, the three
standard scripts), and `apps/mobile` sits beside `apps/api` and `apps/worker`. The split between
`tokens/`, `theme/`, `primitives/` and `patterns/` is not cosmetic: `tokens/` is the only directory
subject to the import ban, and `patterns/` is the only one whose components may refuse to render.

`design/tokens.json` lives with the canvas rather than in the package, because the specification
makes the canvas normative and the check reads from canvas to code, not the other way round.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Scoping the deps-stage `pnpm install` in `apps/api/Dockerfile` | Once `apps/mobile` is a workspace member, an unscoped `--frozen-lockfile` install pulls React Native and Expo into every API image build — hundreds of megabytes on a gate that already runs over two minutes, for code the image never executes | Exempting the mobile app from `verify-workspace-packages.ts` was the original proposal and does not work: pnpm validates the lockfile against the workspace it discovers, so the manifest must be present whatever a check requires. Leaving the install unscoped was rejected as waste that grows |
| Three requirements (FR-008, FR-009, FR-012) delivered by bespoke tooling rather than by a library | ADR-016 chose no styling framework, and named this as its cost. Shopify Restyle would have made FR-009 a compile error for free | Rejected in ADR-016, not here: Restyle is React Native only, which defeats FR-006's portability requirement. ADR-016 names it as the fallback if this tooling proves inadequate, and that trigger stands |

## Amendment required before implementation

**FR-028 cannot be satisfied as written.** It requires every component state to be viewable "without
running the product". Under ADR-016 every component is React Native, so every way of viewing one
runs a React Native application — on-device Storybook included. The only way to meet the literal
wording is to render components on the web, which is the dependency ADR-016 declined.

The requirement should read: viewable **without navigating product flows**, which a development-only
gallery route delivers. This is recorded here rather than silently reinterpreted, because a
requirement that cannot be met either gets ignored or forces a rejected decision in through the back
door. The specification is amended accordingly in the same change as this plan.
