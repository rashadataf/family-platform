# ADR-016: Mobile client — React Native via Expo, with a dependency-free styling layer

- **Status:** Proposed
- **Date:** 2026-09-12
- **Deciders:** Principal Engineer

## Context

Spec 007 (Design System and Mobile Application Shell) is the first feature that builds a client.
It cannot be planned without answering two questions that have never been recorded.

The first is already assumed everywhere and decided nowhere. [`ARCHITECTURE.md` §4 and §8](../ARCHITECTURE.md)
name an Expo and React Native client; [ADR-014](ADR-014-containerized-development.md) carves it out
of the Docker-only development guarantee by name; the README repeats that carve-out. But `adr/`
holds no record of the choice, the alternatives, or the cost — unlike monorepo tooling, the ORM,
the event system, the API style, authentication, hosting and even repository visibility, each of
which has one. A new application and a new user-interface framework is a larger and less reversible
commitment than several of those. This ADR closes that gap rather than letting an assumption
harden into a decision nobody made.

The second question has never been raised at all: how components in `packages/ui` express style.
That is not a detail confined to one module — it determines whether the design system's values can
ever be shared with a web client, and whether spec 007's enforcement requirements are achievable.

Constraints that bear on both decisions:

1. **One developer.** The constitution's "cost is a design constraint" and "prefer boring,
   predictable infrastructure" are load-bearing here, not decoration.
2. **The contract is TypeScript.** [ADR-006](ADR-006-api-style-and-type-safety.md) makes
   `packages/contracts` the API boundary — Zod schemas bound with ts-rest, consumed by both the
   server and the client.
3. **Every quality gate is a TypeScript tool.** Typecheck, ESLint at zero warnings,
   `dependency-cruiser` boundary validation and cycle detection. A client outside TypeScript sits
   outside all of them.
4. **Spec 007 FR-006** requires the token layer to be plain data with no dependency on a native
   runtime, a styling framework or a rendering library, so a future web target can consume
   identical values.
5. **Spec 007 FR-008 and FR-009** require a literal or off-scale design value to fail an automated
   check.
6. **The product needs real device capability**: a camera to scan a passport or a school letter for
   the Document Vault, secure storage for the rotating session credentials spec 006 issues, and
   push delivery — [`ARCHITECTURE.md` §3](../ARCHITECTURE.md) already names "APNs / FCM via Expo".
7. **[ADR-013](ADR-013-staged-hosting-model.md) defers spend** until real user data exists, so
   paid build infrastructure is not yet justified.

## Decision

Two decisions, recorded together because the second is only meaningful given the first.

**1. The mobile client is React Native, delivered through Expo.** The managed workflow with config
plugins and development builds. The bare workflow is an exit, not a starting point.

**2. `packages/ui` expresses style with plain TypeScript token objects and React Native's own
`StyleSheet`.** No styling framework, no CSS-in-JS runtime, no Tailwind dialect. The token layer is
a module of literal values that imports nothing. Enforcement of FR-008 and FR-009 is union types
where a value is typed against a scale, plus a lint rule for what types cannot reach.

## Why React Native, and specifically why not Flutter

### The deciding argument: the contract is TypeScript

ADR-006's central promise is one schema with two consumers and no drift. A breaking API change is a
compile error in the client before anything runs. For one person maintaining both sides of that
boundary, this is the most valuable property the repository has.

A Flutter or native client cannot consume `packages/contracts`. It would need bindings generated
from the OpenAPI emission — a second type system, a generation step, and a window in which the two
disagree. That downgrades ADR-006 from "one schema, two consumers" to "one schema, one consumer,
and a generated approximation for the other". Everything else below is secondary to this.

The same argument applies to the gates. Principle I's strict-mode guarantee, Principle III's
boundary validation, and the zero-warning lint threshold are all TypeScript tooling. A Dart or
Swift client would need a parallel set of gates built and maintained from nothing.

### Supporting arguments

- **`@fp/kernel` runs unchanged on the device.** The recurrence value object, `Money`, branded
  identifiers and `Result` are pure TypeScript with no I/O — which is precisely why they port.
  Timezone-correct RRULE expansion against Europe/London is not logic worth writing twice.
- **A contributor already needs TypeScript** for every other part of this repository.
- **One release process, one dependency graph, one set of CI jobs.**

### Why Expo rather than bare React Native

Every device capability this product needs is a first-party, versioned Expo module: camera and
document scanning, secure credential storage, notifications through APNs and FCM, file system,
image picker, and local authentication for a later biometric unlock. Expo's real value is that
those choices are made and version-matched as a set, which is worth more to one maintainer than to
a team that can afford to curate them individually.

Config plugins keep native configuration as reviewable code in the repository, which is the same
instinct as Principle X even though this is not infrastructure.

The historical objection — "you have to eject to use a native module" — has not been true since
development builds. A custom native module is a config plugin and a development build, not an exit.

## Alternatives considered

### Flutter — rejected, and the contract is the reason

A genuinely strong framework with better default performance and a more consistent rendering story
across platforms. Rejected because it cannot consume `packages/contracts`, which is the single
largest type-safety asset here, and because it introduces a second language into a repository whose
every quality gate is TypeScript. One person maintaining a Dart client against a TypeScript server
pays a translation cost on every API change, permanently.

### Native iOS and Android — rejected

The best achievable result per platform and the worst achievable cost structure: two codebases, two
release processes, two implementations of every screen, for one developer. Every objection to
Flutter applies, twice.

### Bare React Native without Expo — rejected as a start, retained as the exit

Identical language and identical contract benefit. Rejected because each capability listed above
becomes a separately chosen, separately maintained community package on its own upgrade cadence,
which is the specific cost Expo removes. It remains the exit if Expo's constraints ever bind, and
that migration is well-trodden and one-directional by choice, not by force.

### A responsive web application or PWA only — rejected on the product's own requirements

By far the cheapest option, and it would reuse the most. Rejected because the Document Vault
expects a phone camera pointed at a passport, and because reminders are only useful as push
notifications. "Tell a family about an expiry before it costs them something" is the reason this
product exists, and iOS PWA push remains the weakest link in exactly that loop.

### Capacitor or Ionic — rejected

Keeps TypeScript and wraps a web view. Better native access than a PWA, but a web view for the
list-heavy, gesture-heavy screens a family touches daily is a compromise at the centre of the
product rather than at its edge, and the native module story is no simpler than Expo's.

## Why no styling framework

FR-006 requires the token layer to depend on nothing, so that a future web client consumes the same
values rather than a copy. Most styling frameworks want the tokens to live inside *their*
configuration, which is the one place FR-006 forbids.

### NativeWind — rejected

Tailwind's vocabulary on React Native, with the strongest web-parity story of any option. Rejected
on two grounds. Tokens would live in a Tailwind configuration file, which is a styling framework's
configuration — exactly what FR-006 rules out. And arbitrary-value syntax such as `p-[13px]` turns
FR-009's "off the scale must fail" into a string-parsing problem rather than a type error, which is
a weaker guarantee than the one being replaced.

### Tamagui — rejected on cost, not on capability

The most capable option on paper: themes, variants, a compiler, and real web output. Rejected
because it is a large API surface and a build-time compiler to learn, debug and keep upgraded,
adopted by one person for a design system of roughly twenty components. The constitution's "a
component MUST NOT be provisioned before the trigger that justifies it" applies directly. The
trigger would be a real web target sharing components; it does not exist.

### Shopify Restyle — rejected, and the closest call

Theme-constrained props make an off-scale value a *compile error*, which satisfies FR-009 more
elegantly than any lint rule will. That is a real advantage and it is worth stating plainly rather
than burying. Rejected because it is React Native only, so components built on it cannot later
render on the web without a rewrite — the outcome FR-006 exists to prevent — and because its
maintenance cadence has slowed. **If the lint rule this ADR chooses proves inadequate, Restyle is
the first thing to reconsider.**

### styled-components or Emotion — rejected

A runtime style system and a template-literal dialect, for no benefit this design system needs. The
canvas specifies fixed anatomies with enumerated states, not dynamic composition.

### What the chosen approach costs

Plain objects and `StyleSheet` are dependency-free and legible to anyone who knows React Native.
Each scale becomes a union type, so a value off the scale is a type error wherever a prop is typed
against it. What a union cannot catch — a literal hex written straight into a style object — needs
a lint rule. **Writing and maintaining that rule is the honest price of this decision**, and it is
work this repository is already shaped for: it has custom verification scripts and a zero-warning
lint threshold to hang it on.

## Scope: what this ADR does not decide

- **Mobile state, offline behaviour and cache strategy** — planned ADR-009.
- **Mobile end-to-end testing, Maestro versus Detox** — planned ADR-012.
- **Over-the-air updates and remote configuration** — planned ADR-010.
- **The navigation library.** Confined to `apps/mobile`, and therefore a library choice a pull
  request description covers adequately under this directory's own rules. Decided in spec 007's
  plan.

## Consequences

### Positive

- One language across server, worker, infrastructure and client. Every existing quality gate
  already covers the client the day it is created.
- ADR-006's guarantee reaches the device: a breaking API change is a compile error, not a runtime
  surprise in a user's hands.
- `@fp/kernel`'s pure logic runs unchanged on the client, so recurrence and money behave the same
  on both sides by construction rather than by discipline.
- The device capability the product actually depends on is first-party and version-matched.
- The token layer stays portable because it depends on nothing, keeping FR-006 true by default
  rather than by vigilance.
- No styling framework to upgrade, debug, or explain to a future contributor.

### Negative

- **Expo SDK upgrades are a recurring, unavoidable cost** — roughly three releases a year, each
  with a migration, and skipping them compounds the next one.
- **Store builds will eventually need paid cloud builds or a maintained local toolchain.** ADR-013's
  discipline says defer it; deferring is not the same as it being free.
- **The Docker-only development promise does not reach the client.** ADR-014 already says so; the
  practical effect is that a contributor needs Xcode or Android Studio, and the README's single
  prerequisite applies to backend work only.
- **The performance ceiling is below native**, and a list-heavy family calendar is exactly where
  that shows. Virtualisation mitigates it; nothing eliminates it.
- **A lint rule is weaker enforcement than a type system.** Restyle would have given compile-time
  enforcement for free. This decision trades that for portability and one fewer dependency, and the
  rule has to be built before FR-008 is actually enforced rather than merely specified.
- **Plain `StyleSheet` is the most verbose option considered.** Variants and states are explicit
  objects rather than composed strings, and the component library will be longer because of it.
- **Web portability is asserted, not proven.** FR-006 keeps the tokens portable; "the components
  will port" stays untested until somebody tries.

### Revisit this decision when

- **A web application becomes a requirement rather than an ambition.** At that point component-level
  portability stops being hypothetical, and Tamagui or a react-native-web adoption deserves a fresh
  comparison against what has actually been built.
- **The lint rule proves inadequate.** If literal or off-scale values keep reaching `main` despite
  it, the compile-time enforcement Restyle offers becomes worth its portability cost.
- **A required native capability has no Expo module and no workable config plugin.** That is the
  trigger for the bare workflow, not for leaving React Native.
- **The team stops being one person.** Several rejections above are decided by solo-maintainer
  economics; two or three engineers change the arithmetic on native clients and on heavier
  frameworks.
- **A calendar or list screen misses its performance target on a low-end Android device** after
  virtualisation and profiling. That is the honest trigger for reconsidering the framework, and it
  should be measured rather than felt.
