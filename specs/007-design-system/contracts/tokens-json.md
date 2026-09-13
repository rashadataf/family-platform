# Contract: `design/tokens.json`

**Feature**: 007-design-system | **Date**: 2026-09-12

The boundary between the canvas and the code. The canvas is normative, so this file carries the
values the artboards draw, and `scripts/verify-design-tokens.ts` fails the build when the TypeScript
token module disagrees with it (FR-012).

It exists because parsing values back out of rendered artboard HTML is brittle and would break the
first time a board is edited in the canvas editor — and because, as [research R4](../research.md)
records, the scripts that generated the current artboards are not in the repository, so nothing else
gives those values a durable machine-readable home.

## Shape

```jsonc
{
  "version": 1,
  "colour": {
    "surface.canvas":  { "light": "#FAF7F2", "dark": "#17150F" },
    "text.primary":    { "light": "#1F1B16", "dark": "#F2EDE4" }
    // ... every role on artboard 01, each with both themes
  },
  "typography": {
    "title.sm": { "family": "sans", "size": 17, "lineHeight": 23, "weight": 600, "tracking": "0" }
    // ... thirteen steps, artboard 02
  },
  "space":     [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64],
  "radius":    { "xs": 4, "sm": 8, "md": 12, "lg": 16, "xl": 24, "full": 999 },
  "elevation": { "0": "none", "1": "0 1px 2px rgba(31,27,22,.06)" /* ... */ },
  "layout": {
    "sm": { "range": [0, 599],   "columns": 4,  "margin": 24, "gutter": 16, "controlHeight": 48 }
    // ... md, lg, xl, artboard 04
  },
  "contrastPairs": [
    { "foreground": "text.primary", "background": "surface.canvas", "floor": 4.5 }
    // every pairing artboard 01 documents; the input to verify:contrast
  ]
}
```

## Rules

- **This file is parsed, never cast.** It is data entering from outside the program's own memory, so
  Principle II applies exactly as it would to an HTTP response. A schema parse failure fails the
  check; it does not fall back to a default.
- **Every colour role carries both themes.** A role with one is a schema violation, matching the
  structural rule in the token module (FR-002).
- **`contrastPairs` is the input to FR-010**, not a duplicate of it. Adding a colour pairing to the
  product means adding it here, which is what makes "a pairing outside this table has not been
  checked and is not approved" — the sentence already on artboard 01 — true rather than aspirational.
- **`version` exists so the check can refuse a file it does not understand** rather than
  misinterpreting one.

## What it is not

Not a build input. The TypeScript token module is written by hand and *checked* against this file;
it is not generated from it. Generating it would be reasonable and is deliberately out of scope —
that would mean rebuilding the artboard generators as a committed tool, which is a feature of its
own, noted in research R4.
