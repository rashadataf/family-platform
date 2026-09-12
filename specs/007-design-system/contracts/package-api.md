# Contract: what `@fp/ui` exports

**Feature**: 007-design-system | **Date**: 2026-09-12

This package has no wire protocol. Its contract is its public TypeScript surface and the rules a
consumer must obey, both of which are enforced at compile time or by a gate rather than by review.

## The export surface

```text
@fp/ui
├── tokens          colour, typography, space, radius, elevation, layout
├── ThemeProvider   resolves once, at the root
├── useTheme        resolved values only — never the theme's name
├── primitives      Button, Field, rows, surfaces, navigation
└── patterns        Proposal, GatedSurface, Reminder, NotFound
```

## Rules this contract imposes on consumers

1. **Values come from tokens or they do not exist.** A literal colour, spacing, radius, font size,
   line height or elevation outside the token module fails lint with the file, line and value named
   (FR-008).
2. **A value off its scale is a compile error**, not a lint warning. Each scale is a union of its
   literal members (FR-009).
3. **`useTheme` returns resolved values and never the active theme's name.** A consumer cannot
   branch on light versus dark, because the hook gives it nothing to branch on (FR-003).
4. **Patterns may refuse.** Constructing one without its required evidence is a type error where the
   type system can see it, and a thrown guard where it cannot (FR-021 to FR-023).
5. **Formatted strings in, always.** Components take `"12 June 2027"`, not a `Date` (research R10).
6. **`@fp/ui` imports no bounded context, contract, API client or persistence** (FR-011), enforced by
   `.dependency-cruiser.cjs` rather than by review.
7. **`@fp/ui/tokens` imports nothing at all** (FR-006), enforced by a dedicated boundary rule so that
   the portability claim is structural rather than aspirational.

## Boundary graph additions

```js
// .dependency-cruiser.cjs — WORKSPACE_GRAPH
'packages/ui': [],            // reaches nothing. Not the kernel, not contracts.
'apps/mobile': ['packages/ui'],
```

`apps/mobile` is deliberately narrow. It gains `packages/contracts` when a feature actually calls the
API — not now, because `allowed` is default-deny and widening it early spends the guarantee for
nothing.

A new named rule accompanies them:

```js
{
  name: 'token-layer-imports-nothing',
  comment:
    'packages/ui/src/tokens is the portability promise in FR-006: a future web client consumes ' +
    'these exact values. An import here — even of the kernel — makes that promise conditional.',
  severity: 'error',
  from: { path: '^packages/ui/src/tokens/' },
  to: { pathNot: '^packages/ui/src/tokens/' },
}
```

## Verification commands

| Requirement | Command | Fails when |
|---|---|---|
| FR-008, FR-009 | `pnpm lint` | A literal or off-scale design value appears outside the token module |
| FR-010 | `pnpm verify:contrast` | Any documented pairing misses its floor in either theme |
| FR-012 | `pnpm verify:design-tokens` | The token module and `design/tokens.json` disagree |
| FR-006, FR-011 | `pnpm boundaries` | The token layer imports anything, or `@fp/ui` reaches a context |
| FR-002 | `pnpm typecheck` | A colour role is declared with only one theme's value |
