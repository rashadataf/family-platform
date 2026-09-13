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

---

## R13. `react-native` cannot be imported from a `.spec.ts` file (found during implementation)

**Finding**: The first attempt at a unit test for a primitive's supporting code (`typeStepToTextStyle`,
which converts a `TypeStep` into React Native `Text` style properties) failed before a single
assertion ran. Vitest's transform pipeline (Rolldown) refused to parse `react-native`'s own source:

```
RolldownError: Parse failure: Parse failed with 1 error:
Flow is not supported
  File: .../node_modules/react-native/index.js:1:0
```

`react-native`'s package source is written in Flow, Meta's own type checker, not plain JS or
TypeScript. Metro strips it via `babel-preset-expo`/`metro-react-native-babel-preset` at bundle time;
Vitest has no such transform in its pipeline and was never going to grow one for this feature, per R6's
"no second test runner is introduced". The practical effect is broader than R6's original scope:
**not just component rendering**, but any module reached from a `.spec.ts` file, is untestable the
moment it holds a real (not type-only) `import` from `react-native` — even a single `Platform.select`
call is enough, because the import is not erased.

**Decision**: split every primitive's presentation-adjacent logic at this exact seam. Pure
computation (unit conversion, lookup tables, anything `.spec.ts` needs to reach) lives in its own
module with no `react-native` import at all — `internal/tracking.ts` and `internal/font-weight.ts`,
both unit-tested. The thin composition that actually calls into `react-native` (`Platform.select`,
the final RN-shaped style object) lives in a separate file that imports it and is not unit-tested,
consistent with R6.

**Rationale**: This is a *structural* rule, not a per-file judgement call — a file that imports
`react-native` is untestable here regardless of how simple its logic is, so the split has to happen
before writing the logic, not be noticed afterwards. Every future primitive and pattern with
non-trivial pure logic (a state-precedence rule, a formatting helper) should expect the same split.

**Alternatives considered**:

- Adding a Flow-stripping Babel transform to Vitest's config — solves this one import, but is exactly
  the "second test runner's worth of configuration" R6 declined to take on, for a project that has
  deliberately kept its testing surface narrow.
- Testing `typeStepToTextStyle` itself by mocking `react-native` — adds a mock to maintain for a
  three-line `Platform.select` table, and would not generalise to the next file with real RN logic
  worth testing on its own.

---

## R14. A new workspace package needs a fourth declaration site, not three (found via CI)

**Finding**: `pnpm boundaries` passed locally after every commit through T030, and failed in CI the moment
`apps/mobile` first imported `@fp/ui`. The error was `no-unresolvable` — dependency-cruiser could not find
`@fp/ui` at all on a fresh checkout.

**Root cause**: `.dependency-cruiser.cjs`'s own comment explains why cross-package edges resolve through
source, not `dist/`: "resolving through dist instead would make the gate depend on build state... on a
clean checkout... there would be no dist and so no cross-package edges." The mechanism is
`tsconfig.depcruise.json`, which maps every cross-package bare specifier (`@fp/kernel`, `@fp/core`,
`@fp/persistence`, ...) straight to its source entry point. `@fp/ui` was never added to that map when
`packages/ui` was created (T005) — invisible locally because `packages/ui/dist/` already existed from
running `pnpm --filter @fp/ui build` repeatedly in the same working tree, which dependency-cruiser's
generic `enhancedResolveOptions` resolution found and used as a fallback. A CI runner has no such leftover
`dist/`, so the fallback had nothing to find.

**Decision**: added `@fp/ui` and `@fp/ui/tokens` to `tsconfig.depcruise.json`. Verified by deleting
`packages/ui/dist` locally and re-running `pnpm boundaries` before trusting the fix — the same discipline
R12 and T032 already established: a fix to an environment-dependent check is not verified until proven in
the state that actually breaks (here, no local `dist/` standing in for CI's fresh one).

**The general lesson, for the next new package**: `verify-workspace-packages.ts` catches a missing
Dockerfile `COPY`, compose volume, and `WORKSPACE_GRAPH` entry — three of the four places a new package
must be declared. `tsconfig.depcruise.json` is the fourth, and nothing currently checks it. It is only
needed for a package something else imports by bare specifier under a `boundaries` job that does not
build first — which is every package with a dependent, i.e. every package that is not a leaf app. Adding
it as a fourth check to `verify-workspace-packages.ts` was considered and deferred: detecting "is this
package imported by bare specifier anywhere" is real static analysis, not a text match against three
fixed filenames, and this finding was caught by CI within one push regardless.

---

## R15. `@react-native-async-storage/async-storage`'s default export is untypeable under `NodeNext` (found during implementation)

**Finding**: `import AsyncStorage from '@react-native-async-storage/async-storage'` typechecks in
isolation under `moduleResolution: "node"` and `"bundler"`, but fails under `"NodeNext"` — this
repo's setting (`@fp/config-typescript/base.json`) — with `AsyncStorage.getItem` reported as missing
from a type of `typeof import(".../lib/typescript/index")`. The failure reproduces even importing the
package's single simplest file directly (`.../lib/typescript/AsyncStorage.d.ts`, which is nothing more
than `declare const AsyncStorage: AsyncStorageStatic; export default AsyncStorage;`), which rules out
the multi-file re-export chain as the cause. The package has no `"type": "module"` and no `"exports"`
map, so Node16/NodeNext classifies its `.d.ts` files as CommonJS-format; TypeScript's rules for
resolving `export default` inside a CommonJS-format ambient module under NodeNext do not synthesise a
usable default type the way `esModuleInterop` does under `node`/`bundler` resolution — verified by
toggling only `moduleResolution` across three values on the same import and observing the failure
appear solely under `NodeNext`.

**Decision**: import the module namespace (`import * as AsyncStorageModule from '...'`), import
`AsyncStorageStatic` as a type separately (unaffected — naming a type is not subject to the same
default-value resolution path), and assert `AsyncStorageModule.default as unknown as
AsyncStorageStatic` once, at the single point `theme-storage.ts` touches this package. The runtime
value is correct regardless of what TypeScript infers for it — Metro's own bundling of the identical
import proves that on every build — so this bridges a verified tool limitation rather than working
around an assumption.

**Rationale**: This is the one `as unknown as` cast in the codebase, and it is deliberately scoped to
exactly the boundary where a third-party package's type declarations are incompatible with this
project's module resolution setting — a different situation from casting away an invariant this
project's own code is responsible for keeping (Principle II), which is what the codebase otherwise
never does.

**Alternatives considered**:

- Changing `moduleResolution` in `@fp/config-typescript/base.json` — fixes this one import at the cost
  of changing module resolution semantics for every package in the workspace, for a problem that is
  local to one dependency.
- `import AsyncStorage = require(...)` — the standard TypeScript escape for exactly this class of CJS
  interop problem, but it is a CommonJS-only construct and `packages/ui` is an ESM package
  (`"type": "module"`); TypeScript refuses it there.
- Reporting the bug upstream and waiting — correct long-term, but blocks T034 today for a fix outside
  this repo's control.

---

## R16. Metro never resolved this app's own `.js`-suffixed relative imports (found during implementation)

**Finding**: Every check this feature runs before treating a task as done — `typecheck`, `lint`,
`build`, `boundaries`, `format:check`, `vitest` — passed on `apps/mobile` throughout Phases 3 through
5. None of them ever bundle the app: `tsc` resolves `./placeholder-icon.js` to `placeholder-icon.tsx`
by design (that is what `moduleResolution: "NodeNext"` means), and nothing else in the gate set
touches Metro's resolver at all. Running `npx expo export --platform ios` for T038 — the first time
anything in this feature actually bundled the app rather than statically analysing its source — failed
immediately: `Unable to resolve module ../../components/placeholder-icon.js`, on a call site
(`(tabs)/_layout.tsx`) that had existed, unbundled and unnoticed, since T031.

Metro has no built-in understanding of the TypeScript NodeNext convention of writing a relative
import's extension as `.js` when the real file on disk is `.ts`/`.tsx` — it takes the extension
literally, the same way it correctly does for a package's real, already-compiled `dist/*.js`. Every
relative import in this app's own source uses that convention (it is `packages/ui`'s convention too,
carried over for consistency), so this was not a one-file problem: it was the app never having been
bundled successfully at all, at any point in this feature's implementation.

**Decision**: added a `resolver.resolveRequest` override to `apps/mobile/metro.config.js` that strips
a trailing `.js` from a *relative* import specifier (`moduleName.startsWith('.')`) before handing it
back to Metro's own resolver, which then finds `.tsx`/`.ts` through its normal extension search. A bare
specifier (`@fp/ui`, `react-native`, an npm package) is untouched, and so is a package's real compiled
`.js` output reached through one — the rewrite only ever fires on this app's own relative,
not-yet-built source. Verified by re-running the same `expo export` for both `ios` and `android`
after the change; both now bundle.

**Rationale**: The alternative — dropping `.js` from these two import sites — would have fixed today's
two call sites and left the same trap for the next relative import anyone writes in `apps/mobile`,
silently reintroducing an unbundleable app that every other gate would still call clean. The resolver
fix is the one change that makes the convention this repo already committed to (`.js`-suffixed
relative imports, matching `packages/ui`) actually work under Metro, rather than working only under
`tsc`.

**The general lesson**: none of this feature's required checks model Metro's module resolution, and
nothing before T038 exercised it. `expo export --platform ios` (or `android`) for a quick bundle-only
check is worth running once after any change to `apps/mobile`'s import graph or `metro.config.js`
itself — it is fast, needs no simulator, and is the only check in this feature's gate set that would
have caught this.

---

## T052. Gallery-to-canvas cross-check

Walked artboards 05–09 against the gallery built for T050/T051, section by section:

- **Buttons (05)**: every variant × size × disabled × loading state built; full-width and icon-only
  built. **Not separately reachable as a static state**: `pressed` and `focus` — both are handled
  internally by `Pressable`'s own touch/focus events, not exposed as props, so there is no prop that
  could render them at rest. They are reachable in the gallery the same way they are anywhere else in
  the app: press and hold, or tab-focus, a real rendered button. This is a property of how the
  component is built, not a gap in what the gallery registers.
- **Fields (06)**: default, helper text, error, disabled, left icon, and the search hidden-label
  exception all built. "Other controls" (a multiline notes field, toggle/checkbox) was already
  descoped when `Field` was built (field.tsx's own header comment) — not one of this spec's five
  primitive families, so correctly absent from both the component set and the gallery.
- **Surfaces (07)**: all four row types plus their skeletons, every `StatusPill` status, `EmptyState`,
  `Toast`, and the avatar size scale were built directly. The avatar **stack** (−10px overlap, 2px
  ring, "+N" overflow counter after three) was initially missed — a composition of `Avatar` instances
  the gallery had not assembled, not a missing component. Added: three overlapping avatars plus a
  fourth showing `initials="+2"` (a plain string, not validated to be a real name's initials), overlap
  at `-space[2]` (−8) rather than the canvas's off-scale −10 (FR-009) — the same correction this
  board's other off-scale values already received.
- **Navigation (08)**: `Header` (compact, compact-with-back-and-action, large), both `SegmentedControl`
  arities, `TabBar`, `Sheet`, and `Dialog` all built and reachable (the modals via an in-gallery
  trigger button, consistent with them being real `Modal`-backed components rather than static
  mockups).
- **Patterns (09)**: all four built directly, `Reminder` across all four tones.

No further gaps found. The one addition (avatar stack) is committed alongside the gallery itself
rather than as a follow-up, since T052 exists precisely to catch this before calling the phase done.

---

## R17. `pnpm boundaries` cannot catch an npm-package import into the token layer (found doing T060)

**Finding**: T060 asks for every enforcement check named in the contract to be seen fail on a real
violation. Injecting `import { Platform } from 'react-native';` at the top of
`packages/ui/src/tokens/colour.ts` and running `pnpm boundaries` reported **no violations** — the
exact case `contracts/package-api.md`'s verification table names `pnpm boundaries` as covering
("FR-006, FR-011 | `pnpm boundaries` | The token layer imports anything, or `@fp/ui` reaches a
context"). Injecting `import { ok } from '@fp/kernel';` in the same spot, by contrast, was caught
immediately and precisely by the `token-layer-imports-nothing` rule.

The difference is `.dependency-cruiser.cjs`'s `options.exclude.path`, which matches
`node_modules` and removes anything resolving there from the graph entirely, before any named rule
runs — a repository-wide setting (`options.doNotFollow` and `options.exclude` are global, not
per-rule), justified by keeping the graph to source the project actually owns rather than every
package's own internals. `@fp/kernel` resolves to a workspace member's source file, so it is in the
graph and `token-layer-imports-nothing`'s `to: { pathNot: '^packages/ui/src/tokens/' }` matches it
normally. `react-native` resolves inside `node_modules`, so it is excluded before that `to` clause
ever sees it — the rule cannot forbid an edge that was never added to the graph.

**Decision**: correct `contracts/package-api.md`'s claim rather than change the exclusion. The two
enforcement commands split FR-006 exactly along this line, and the contract now says so:
`pnpm boundaries` proves the token layer imports no *workspace* package (another local file,
`@fp/kernel`, a context); `pnpm verify:token-portability` (T048, added in Phase 6) proves it imports
no *npm* package either, including `react` and `react-native`, by actually running the built output
in an environment where neither can resolve. Together they are FR-006's full portability claim;
apart, each covers a different half, and the table naming only the first for both halves was true for
one and false for the other.

**Alternatives considered**:

- Removing `node_modules` from `options.exclude` (or adding a per-directory override) — would let
  `token-layer-imports-nothing` see npm imports too, but `doNotFollow`/`exclude` are global config,
  not scoped to a rule's `from`, so this would re-include node_modules in the graph for **every**
  rule, not just this one — cruising every dependency's own internals, for a repository whose
  `boundaries` job already runs on every push. `verify-token-portability.ts` already closes this exact
  gap at a fraction of the cost, at the one place it matters.
- Leaving the contract's wording as-is — rejected: T060 exists precisely so a check that reads as
  covering something it does not gets corrected before the phase is called done, not discovered later
  by someone trusting the table.
