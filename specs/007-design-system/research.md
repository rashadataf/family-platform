# Phase 0 Research: Design System and Mobile Application Shell

**Feature**: 007-design-system | **Date**: 2026-09-12

Eleven questions had to be answered before this feature could be planned. Four of them are decided
by constraints already in the repository rather than by preference, and those are the interesting
ones — they are recorded first.

---

## R1. Expo and Metro inside a pnpm symlinked workspace

**Decision**: Keep pnpm's default symlinked `node_modules`. Configure Metro for the workspace
explicitly — `watchFolders` covering the repository root, `resolver.nodeModulesPaths` listing both
the app's and the root's `node_modules`, and symlink resolution left enabled.

**Rationale**: The conventional fix for "Metro cannot resolve in a pnpm monorepo" is
`node-linker=hoisted` in `.npmrc`. **That option is not available here.** Constitution Principle III
lists, as one of its four enforcement layers, "the absence of the relevant dependencies from a
package's `package.json` under the strict linking established by [ADR-001](../../adr/ADR-001-monorepo-tooling.md)".
Hoisting makes every transitive dependency reachable from every package, which silently deletes
that enforcement layer for the entire repository — not just for the mobile app. Trading a
repository-wide architectural guarantee for a bundler convenience is not a trade worth making, and
it would be an undocumented amendment to an accepted ADR.

**Alternatives considered**:

- `node-linker=hoisted` — rejected, see above. If Metro configuration proves genuinely unworkable,
  the correct response is an ADR amending ADR-001, not a quiet line in `.npmrc`.
- `node-linker=isolated` with a `public-hoist-pattern` for React Native only — narrower, but still
  weakens the same guarantee for the hoisted packages, and adds a second resolution model to reason
  about.
- Keeping the mobile app outside the workspace — rejected: it would lose `packages/contracts`,
  which is the entire argument of ADR-016.

**Verify at implementation**: Metro's symlink support has been stable for several releases, but the
exact configuration shape changes between Expo SDK versions. Confirm against the SDK actually
installed rather than against this note.

---

## R2. Declaring the new packages — and the real problem, which is somewhere else

**Decision**: Declare both new packages in all three places the existing check requires. **No change
to `scripts/verify-workspace-packages.ts`.** Separately, scope the API image's install so the mobile
app cannot drag React Native into it — a Dockerfile change, not a check change.

**Rationale — this section was wrong and is corrected.** The original version argued that adding
client packages to `apps/api/Dockerfile` would make the API runtime image carry client manifests, and
proposed rewriting the verification script to derive an exempt set. Reading the Dockerfile before
implementing showed the premise was false:

- `runtime` derives from `base`, **not** from `deps`, and copies only `/app/deploy` out of `build`.
  Manifests copied into the deps stage never reach the shipped image, so the `image` gate — which
  inspects the runtime image — is entirely unaffected. Declaring a package costs two lines.
- The compose volumes point the same way. The repository is bind-mounted at `/app`, so every
  workspace package needs a named volume at its `node_modules` or the container's install is shadowed
  by, and written into, the host tree. A package without one pollutes the host checkout.

So the check is right and the plan was wrong. Exempting anything would have solved a problem that
does not exist.

**The real problem is `apps/mobile`, and it is about the install, not the declaration.** The deps
stage runs `pnpm install --frozen-lockfile` across the whole workspace. Once the mobile app is a
workspace member, every API image build resolves and downloads React Native and the Expo toolchain —
hundreds of megabytes, on a gate that already takes over two minutes, for code the image will never
run. Exempting it from the declaration check would not help: pnpm validates the lockfile against the
workspace it discovers, so the manifest must be present regardless of what any check requires.

**Decision for `apps/mobile`**: declare it like every other package, and scope the deps-stage install
with pnpm's filter so only what `@fp/api` and `@fp/worker` need is resolved. This touches the `image`
gate's install semantics, so it is its own task, sequenced *before* the mobile app exists rather than
alongside it.

**Alternatives considered**:

- Rewriting the verification script to derive an exempt set — the original plan. Rejected: it solves
  nothing and leaves the actual cost untouched.
- Accepting a slower image build — rejected. It is waste on every pull request, and it grows with the
  client's dependency tree.
- Moving the mobile app outside the workspace — rejected: it would lose `packages/contracts`, which is
  the whole argument of ADR-016.

## R3. The token layer's enforcement mechanism

**Decision**: Two layers. Each scale is a TypeScript union of its literal members, so a value off
the scale is a **type error** anywhere a prop is typed against it. A custom ESLint rule catches what
types cannot: a literal colour, size, spacing or radius written directly into a style object.

**Rationale**: FR-008 and FR-009 require automated failure, and [ADR-016](../../adr/ADR-016-mobile-client-and-styling.md)
chose plain token objects over a styling framework knowing this was the cost. Union types do most of
the work for free and give the error at the point of use. The rule covers the rest.

**Alternatives considered**:

- Shopify Restyle, whose theme-constrained props make this a compile error with no custom rule —
  rejected in ADR-016 for being React Native only, and named there as the fallback if this approach
  proves inadequate. This research does not reopen that decision, but it does confirm the cost is
  real: the rule is genuine work, not a formality.
- A `grep`-based check in `scripts/` like the existing `verify-*` family — simpler to write, and
  rejected because it cannot distinguish a hex in a style object from a hex in a comment, a test
  fixture or a token definition. An ESLint rule sees the syntax tree and can scope itself precisely.

**Placement**: the rule belongs in `packages/config-eslint`, because every package's
`eslint.config.js` already extends that package, and lint runs at `--max-warnings 0` repo-wide.

---

## R4. Keeping the canvas and the code in agreement

**Decision**: Introduce `design/tokens.json` as the machine-readable form of the values the canvas
draws. The TypeScript token module is checked against it by `scripts/verify-design-tokens.ts`, and a
divergence fails the build.

**Rationale**: FR-012 requires drift between the canvas and the code to be detectable. The artboards
are HTML — parsing values back out of rendered markup is brittle and would break the first time a
board is edited in the canvas editor. A small JSON file beside the artboards, carrying the same
values, is both the thing the check reads and the thing a future generator writes.

This also fixes a gap not visible from the spec: **the scripts that generated the current artboards
are not in the repository.** They were session scaffolding. The committed `.dc.html` files are
therefore hand-maintained from here — which is the intended workflow for a canvas that is edited
visually — but it means nothing in the repository can currently reproduce them. `tokens.json` gives
the values a home that does not depend on a generator existing.

**Alternatives considered**:

- Parsing the artboard HTML directly — rejected as brittle, per above.
- Generating the artboards from `tokens.json` — attractive, and out of scope here. It would mean
  rebuilding the generators as a committed tool, which is a feature of its own.
- Making the TypeScript module the source and the canvas the copy — rejected because it inverts what
  the specification says is normative, and because a designer working in the canvas cannot edit
  TypeScript.

**Validation**: `tokens.json` is data entering the system from outside a program's own memory, so
Principle II applies: it MUST be parsed by a schema before use, not cast.

---

## R5. Navigation

**Decision**: Expo Router.

**Rationale**: It is first-party, it is built on React Navigation so nothing is lost, and its
file-based routes give deep linking by default. Deep linking is not speculative here — spec 006
already issues email verification links that must open the application at a specific screen, and
that is the next feature after this one that touches the client.

**Alternatives considered**: React Navigation directly — more explicit and more configuration, with
deep linking assembled by hand. Rejected as more work for the same outcome. Per `adr/README.md`'s
own rules this is a library choice confined to one module and does not need an ADR.

---

## R6. Testing strategy

**Decision**: Test what carries risk with Vitest in the existing `unit` project — the token module,
scale membership, the contrast computation, the drift check and the ESLint rule. Do **not** add a
second test runner for component rendering in this feature.

**Rationale**: The constitution says testing weight follows risk. The risk in this feature is
concentrated in values and enforcement, all of which is pure TypeScript that the existing runner
already handles with no new configuration. Presentational components assembled from those values
carry much less: a component that renders the wrong padding is caught by the type system or by
looking at the gallery, not by a snapshot.

Adding Jest and `jest-expo` alongside Vitest would give two runners, two configurations and two
sets of conventions, for assertions of low value. The four pattern components in FR-021 to FR-024 do
have real behaviour — they refuse to render without their evidence — but that refusal is a guard
function, which is pure and testable in Vitest without rendering anything.

**Alternatives considered**:

- `jest-expo` plus React Native Testing Library — the conventional choice, rejected for now on the
  grounds above. **Revisit when** a component acquires behaviour that cannot be extracted into a
  pure function, or when planned [ADR-012](../../adr/README.md) settles end-to-end testing and a
  runner is being chosen anyway.
- Vitest with a React Native environment shim — rejected: it is possible and it is fragile, and a
  fragile test setup is worse than an honest gap.

---

## R7. Theme resolution and persistence

**Decision**: Resolve once at the root and pass the resolved palette down through context. Follow
the OS by default; persist an explicit override on the device.

**Rationale**: FR-003 forbids a component reading the active theme to choose a value, which rules
out per-component lookups. FR-004 and FR-005 require the override to exist and to survive a restart.
The stored value is one of three strings and is not personal data, as the specification's
Principle XI section states.

**Alternatives considered**: resolving per component — rejected by FR-003. Not persisting the
override — rejected by FR-005.

---

## R8. Text scaling

**Decision**: Treat every height on the canvas as a **minimum**, not a fixed value, and verify the
shell at the largest standard OS text size before this feature is called done.

**Rationale**: This is the most likely way the design as drawn will break, and it is worth stating
before implementation rather than discovering it in review. The canvas specifies fixed control
heights (48px, 56px) and fixed row anatomies; at the largest standard text setting, text inside a
fixed 48px control will clip. FR-018 requires it not to.

The resolution is that a control height is a floor: the container grows with its content, and the
token defines where it starts. This is a genuine reinterpretation of the artboards, and it should be
noted on artboard 05 rather than left implicit.

**Alternatives considered**: capping text scaling inside the app — rejected. It overrides an
accessibility setting the person deliberately chose, which is the opposite of honouring it.

---

## R9. The component gallery, and a requirement that cannot be met as written

**Decision**: A development-only gallery route inside `apps/mobile`. **FR-028 needs amending**: it
says every state must be viewable "without running the product", which cannot be satisfied by any
option available under ADR-016.

**Rationale**: ADR-016 makes components React Native only. Every way of viewing them therefore runs
a React Native application — on-device Storybook included. The requirement as written could only be
met by rendering components on the web, which is exactly what ADR-016 declined to do.

The defensible version of the requirement is that a contributor can see every state **without
navigating product flows**, which a gallery route delivers. The specification should be amended to
say that, because a requirement that cannot be satisfied is worse than no requirement — it either
gets quietly ignored or it forces a decision through the back door that an ADR already made at the
front.

**Alternatives considered**:

- Storybook for React Native — heavier, a second toolchain, and still runs an application. No
  advantage over a gallery route at this size.
- Storybook on `react-native-web` — would satisfy the literal wording, at the cost of adopting the
  web-rendering dependency ADR-016 rejected. Deciding a rejected ADR question by way of a tooling
  choice is precisely the failure mode to avoid.

---

## R10. Locale formatting stays out of the components

**Decision**: Components receive already-formatted strings for dates, times and money. No component
calls a date or currency formatter.

**Rationale**: The constitution's UK-first constraint says no context outside Reference may store a
UK-shaped primitive. The canvas draws UK formats — `12 / 09 / 2026`, `£84.50` — and the naive
implementation bakes `en-GB` into a row component. That is a UK-shaped primitive in the presentation
layer and it is exactly what the constraint exists to prevent. Formatting belongs to the caller,
which will eventually get it from Reference and Locale.

---

## R11. Version compatibility, to be confirmed at implementation

**Decision**: Pin the Expo SDK and React Native versions at implementation time against what is
current then, and confirm Node 24 support before assuming it.

**Rationale**: This repository pins Node 24 (`.nvmrc`) and sets `engine-strict=true`, so a toolchain
that does not support Node 24 fails at install rather than at run time. Expo's supported Node range
moves with its SDK releases. This note deliberately records no version numbers: any written here
would be stale by the time the work starts, and a stale version in a planning document is worse than
an explicit instruction to check.

**Confirmed at implementation (T006)**: SDK 57 was current. `react-native@0.86.3` requires Node
`^22.13.0 || ^24.3.0 || >= 26.0.0` in its own `engines` field — `.nvmrc`'s Node 24 clears that floor,
so no toolchain amendment was needed. Versions pinned to the published `expo-template-default@sdk-57`
set rather than to each package's own `latest` tag, because that is the combination Expo actually
tests together: `expo ~57.0.22`, `expo-router ~57.0.21`, `react 19.2.3`, `react-native 0.86.3`,
`react-native-screens ~4.26.0`, `react-native-safe-area-context ~5.7.0`,
`react-native-gesture-handler ~2.32.0`.

`pnpm install` reported peer warnings, not errors, and the install succeeded (exit 0):
`expo-router`'s web code path (`vaul`, `@radix-ui/*`) wants `react-dom`, and
`expo-modules-core` wants a `react-native-worklets` range older than what resolved. Both are
consistent with this feature's scope — no web target, no animation library — and are warnings
pnpm does not fail closed on. They are not silently accepted: if a later spec adds
`react-native-web` or `react-native-reanimated`, re-run `pnpm install` and expect the warning list
to change shape, not just grow.

Trimmed from the template on purpose, because none of it serves this spec: `@expo/ui`,
`expo-splash-screen`, `expo-symbols`, `expo-system-ui`, `expo-device`, `expo-image`, `expo-font`,
`expo-glass-effect`, `expo-web-browser`, `react-native-web`, `react-dom`, `react-native-reanimated`,
`react-native-worklets`. Any of these is one `pnpm add` away from a future spec that needs it.

---

## R12. The palette did not pass its own contrast rule (found during implementation)

**Finding**: The first run of `verify:contrast` reported **seven failures** against the palette drawn
on artboard 01 — a palette that had been chosen by eye and looked fine.

| Pairing | Was | Floor |
|---|---|---|
| `text.tertiary` on canvas / raised, light | 3.63 / 3.88 | 4.5 |
| `text.tertiary` on canvas / raised, dark | 4.44 / 4.00 | 4.5 |
| `text.onAction` on `action.primary`, light | 4.49 | 4.5 |
| `action.disabledFg` on `action.disabledBg`, light | 2.10 | 3.0 |
| `action.disabledFg` on `action.disabledBg`, dark | 2.56 | 3.0 |

**Resolution**: Five values were adjusted along their own hue, targeting a small margin above each
floor rather than the floor exactly, so that rounding cannot put a shipped pairing back under it. The
canvas was corrected first and the token layer follows it, which is the order the specification
requires.

| Token | Was | Now |
|---|---|---|
| `text.tertiary` light | `#8A8073` | `#786F64` |
| `text.tertiary` dark | `#857C6E` | `#908779` |
| `action.primary` light | `#B4603A` | `#B15E39` |
| `action.disabledFg` light | `#A9A093` | `#8D8170` |
| `action.disabledFg` dark | `#6B6355` | `#797060` |

**Why this is worth recording.** Artboard 01 already carried the sentence "a pairing outside this
table has not been checked and is not approved", and the table itself was wrong. The check earned its
cost on its first run, before a single component existed — which is the argument for building
enforcement in the foundational phase rather than treating it as polish.

`text.onAction` at 4.49 is the one worth pausing on. It is indistinguishable from 4.50 to any human
eye, and it failed. Rounding a value down to "basically fine" is exactly the judgement a design
system exists to remove, so it was fixed like the others.
