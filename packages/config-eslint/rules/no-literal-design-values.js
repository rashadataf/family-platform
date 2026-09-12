// @ts-check
import { readFileSync } from 'node:fs';

/**
 * Spec 007 FR-008 and FR-009: a literal colour, spacing, radius, font size or
 * line height outside the token layer fails the build, naming the file, the
 * line and the value.
 *
 * This rule exists because of a decision, not an oversight. ADR-016 chose plain
 * token objects over a styling framework, and named this as the cost: Shopify
 * Restyle would have made an off-scale value a compile error for free. Union
 * types in the token layer cover most of it — a `Space` prop cannot take 13 —
 * but nothing stops someone writing `padding: 13` straight into a style object,
 * and that is what this catches.
 *
 * The scales are read from `design/tokens.json`, the same normative file
 * `verify-design-tokens.ts` compares against, so the rule cannot drift from the
 * canvas independently.
 */

const TOKENS_URL = new URL('../../../design/tokens.json', import.meta.url);

/** @type {{ space: number[], radius: Record<string, number>, typography: Record<string, { size: number, lineHeight: number }> }} */
const tokens = JSON.parse(readFileSync(TOKENS_URL, 'utf-8'));

const SPACE = new Set(tokens.space);
const RADIUS = new Set(Object.values(tokens.radius));
const FONT_SIZE = new Set(Object.values(tokens.typography).map((s) => s.size));
const LINE_HEIGHT = new Set(Object.values(tokens.typography).map((s) => s.lineHeight));

const SPACING_PROP = /^(padding|margin|gap|rowGap|columnGap)/;
const RADIUS_PROP = /Radius$/;
const COLOUR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;

const sorted = (set) => [...set].sort((a, b) => a - b).join(', ');

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Design values come from @fp/ui tokens. A literal colour, spacing, radius or type value outside the token layer is a defect (spec 007 FR-008, FR-009).',
    },
    schema: [],
    messages: {
      literalColour:
        'Literal colour {{value}}. Colours are roles, not values — use a colour token so the value resolves per theme (FR-008). A raw hex is invisible to dark mode.',
      offScaleSpacing:
        '{{prop}}: {{value}} is not on the spacing scale ({{scale}}). Spec 007 FR-009: a value between steps is not a taste question, it is off the scale.',
      offScaleRadius: '{{prop}}: {{value}} is not on the radius scale ({{scale}}).',
      offScaleFontSize:
        'fontSize: {{value}} is not a step in the type scale ({{scale}}). Use a typography token.',
      offScaleLineHeight: 'lineHeight: {{value}} is not a step in the type scale ({{scale}}).',
    },
  },

  create(context) {
    /** Reports a string that looks like a colour, wherever it appears. */
    function checkColourString(node) {
      if (typeof node.value !== 'string' || !COLOUR_VALUE.test(node.value)) return;
      context.report({ node, messageId: 'literalColour', data: { value: node.value } });
    }

    return {
      Literal: checkColourString,

      Property(node) {
        const key = node.key;
        const name =
          key.type === 'Identifier' ? key.name : typeof key.value === 'string' ? key.value : '';
        if (name === '') return;

        const value = node.value;
        // Only bare numeric literals here. Colour strings are already caught by
        // the `Literal` visitor above, wherever they appear — checking them
        // again on the property would report the same value twice. A computed
        // value or an identifier is presumed to have come from a token, which
        // the type system checks.
        if (value.type !== 'Literal' || typeof value.value !== 'number') return;
        const n = value.value;

        if (SPACING_PROP.test(name) && !SPACE.has(n)) {
          context.report({
            node: value,
            messageId: 'offScaleSpacing',
            data: { prop: name, value: String(n), scale: sorted(SPACE) },
          });
        } else if (RADIUS_PROP.test(name) && !RADIUS.has(n)) {
          context.report({
            node: value,
            messageId: 'offScaleRadius',
            data: { prop: name, value: String(n), scale: sorted(RADIUS) },
          });
        } else if (name === 'fontSize' && !FONT_SIZE.has(n)) {
          context.report({
            node: value,
            messageId: 'offScaleFontSize',
            data: { value: String(n), scale: sorted(FONT_SIZE) },
          });
        } else if (name === 'lineHeight' && !LINE_HEIGHT.has(n)) {
          context.report({
            node: value,
            messageId: 'offScaleLineHeight',
            data: { value: String(n), scale: sorted(LINE_HEIGHT) },
          });
        }
      },
    };
  },
};

export default rule;
