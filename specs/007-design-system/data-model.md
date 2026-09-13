# Phase 1 Data Model: Design System and Mobile Application Shell

**Feature**: 007-design-system | **Date**: 2026-09-12

This feature has no database and no domain aggregates. Its "data" is the token set and the component
model — values and shapes that are checked at compile time rather than persisted. The entities below
are the ones the specification names, expressed as the structures that will exist in code.

---

## Token

The atom of the system. A named value belonging to exactly one scale.

| Field | Description | Validation |
|---|---|---|
| `role` | The name the product uses, e.g. `surface.raised`, `space.4`, `title.sm` | Unique across its category. Must appear in `design/tokens.json` |
| `category` | `colour`, `typography`, `space`, `radius`, `elevation`, `layout` | One of the six. No seventh category without an artboard defining it |
| `value` | The resolved value | For `colour`, two values — one per theme. For the rest, one |

**Rules**

- A colour role without both a light and a dark resolution **must not exist** (FR-002). This is
  structural: the type is a pair, so a single value does not compile.
- Every non-colour category is a closed union of its literal members. `space` is exactly
  `0 | 4 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 64`; a `13` is a type error, not a lint warning
  (FR-009).
- The token module imports nothing (FR-006), enforced by the `token-layer-imports-nothing`
  boundary rule rather than by review.
- One documented exception exists and is carried as such: 14px field horizontal padding, recorded on
  artboard 06 with its reason. Exceptions are values in the token set with a comment, never literals
  at the point of use.

---

## Theme

A complete resolution of every colour role. Exactly two, plus the instruction to follow the device.

| Field | Description |
|---|---|
| `name` | `light` or `dark` |
| `colours` | Every colour role resolved to a single value |

**Rules**

- Resolution happens once, at the root (FR-003). A component receives resolved values and cannot
  discover which theme produced them.
- The **preference** — `system`, `light` or `dark` — is a separate thing from the resolved theme. It
  is the only value this feature persists, on the device (FR-004, FR-005).
- A theme change while the application is running must propagate without a restart and without
  dismissing an open sheet or dialog (spec, US2 acceptance 2 and the edge cases).

---

## Component

A named piece of interface with a fixed anatomy and an enumerated set of states.

| Field | Description |
|---|---|
| `name` | Matches the name used on the canvas, exactly |
| `variants` | The closed set drawn on its artboard, e.g. a button's five |
| `states` | The closed set drawn, e.g. default, pressed, focus, disabled, loading |
| `anatomy` | Heights, paddings and gaps, every one of them a token |

**Rules**

- A variant or state not drawn on the canvas does not exist. Adding one starts on the canvas
  (spec, edge cases).
- Heights are **floors, not fixed values** (research R8). A control grows with its content so that
  FR-018 holds at the largest standard text size; the token says where it starts.
- Every row and card has a loading form at the same anatomy as its loaded form (FR-020), so that
  real data arriving does not move the layout.
- A component receives already-formatted strings for dates, times and money (research R10). No
  component calls a formatter, because a locale in the presentation layer is a UK-shaped primitive
  outside the Reference context.

---

## Pattern

A component whose shape is required by a constitution principle rather than chosen for appearance.
Patterns are the only components permitted to **refuse to render**.

| Pattern | Required evidence | Refuses when | Principle |
|---|---|---|---|
| `Proposal` | source reference, confidence | either is missing | VII |
| `GatedSurface` | who may see it, the access-is-recorded notice | either is missing | VI |
| `Reminder` | rule id, rule version, source reference | any is missing | ARCHITECTURE §5.6 |
| `NotFound` | — | never; it takes no evidence | V |

**Rules**

- `Proposal` exposes no interface that commits its value. There is no `onAutoAccept`, no default
  action, and no prop that turns confirmation off (FR-021). The absence is the point: a shape that
  cannot express the wrong behaviour is stronger than one that merely discourages it.
- `NotFound` is a single component used for both a missing resource and an unreachable one, with
  identical wording and identical actions (FR-024). It takes no prop that could distinguish the two,
  because a prop that could would eventually be passed.
- Refusal is a guard function, pure and testable without rendering (research R6).

---

## Breakpoint

| Field | Description |
|---|---|
| `key` | `sm`, `md`, `lg`, `xl` |
| `range` | The viewport widths it covers |
| `columns` | 4, 8, 12, 12 |
| `margin`, `gutter` | Tokens, not free values |
| `controlHeight` | 48 for touch, 40 for pointer |

**Rules**

- Only the differences artboard 04 permits may vary by breakpoint (FR-004 of that board's scope:
  columns, margins, gutters, control height). Colour, type, radius and elevation are identical
  everywhere — that identity is what makes one component set serve both.

---

## What this feature deliberately does not model

No user, no family, no session, no document. `packages/ui` cannot reach a bounded context and must
not learn what one is (FR-011). A row component knows it renders a title, a meta line and a status
pill; it does not know that the thing is a passport.
