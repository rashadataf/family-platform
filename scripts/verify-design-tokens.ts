import { fileURLToPath } from 'node:url';
import { loadDesignTokens, type DesignTokens } from './lib/design-tokens.js';
import {
  colour,
  elevation,
  layout,
  radius,
  space,
  typography,
} from '../packages/ui/src/tokens/index.js';

/**
 * FR-012: the canvas and the code must not drift.
 *
 * `design/tokens.json` is normative — it sits beside the artboards, and the
 * specification says a value changes there first. This check compares the
 * TypeScript token layer against it and fails on any disagreement, in either
 * direction: a role added to one and not the other, or the same role carrying
 * two different values.
 *
 * The same reasoning as `verify-node-version.ts`: a duplication guarded by a
 * check rather than a comment, because a convention only a comment protects is
 * one that drifts silently. Here the silent failure is two shades of the same
 * grey shipping for a year before anyone notices.
 */

export interface TokenDrift {
  path: string;
  canvas: string;
  code: string;
}

export interface DriftReport {
  ok: boolean;
  compared: number;
  drift: TokenDrift[];
  message: string;
}

function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Compares two flat records, reporting anything present in one side only or differing. */
function diffRecords(
  prefix: string,
  canvasSide: Readonly<Record<string, unknown>>,
  codeSide: Readonly<Record<string, unknown>>,
  drift: TokenDrift[],
): number {
  const keys = new Set([...Object.keys(canvasSide), ...Object.keys(codeSide)]);
  for (const key of keys) {
    const inCanvas = Object.hasOwn(canvasSide, key);
    const inCode = Object.hasOwn(codeSide, key);
    if (!inCanvas || !inCode) {
      drift.push({
        path: `${prefix}.${key}`,
        canvas: inCanvas ? show(canvasSide[key]) : '(absent)',
        code: inCode ? show(codeSide[key]) : '(absent)',
      });
      continue;
    }
    const a = JSON.stringify(canvasSide[key]);
    const b = JSON.stringify(codeSide[key]);
    if (a !== b) drift.push({ path: `${prefix}.${key}`, canvas: a, code: b });
  }
  return keys.size;
}

export function checkDesignTokens(tokens: DesignTokens): DriftReport {
  const drift: TokenDrift[] = [];
  let compared = 0;

  compared += diffRecords('colour', tokens.colour, colour, drift);
  compared += diffRecords('typography', tokens.typography, typography, drift);
  compared += diffRecords('radius', tokens.radius, radius, drift);
  compared += diffRecords('elevation', tokens.elevation, elevation, drift);
  compared += diffRecords('layout', tokens.layout, layout, drift);

  compared += 1;
  if (JSON.stringify(tokens.space) !== JSON.stringify(space)) {
    drift.push({
      path: 'space',
      canvas: JSON.stringify(tokens.space),
      code: JSON.stringify(space),
    });
  }

  if (drift.length > 0) {
    const lines = drift.map(
      (d) => `  ${d.path}\n        canvas: ${d.canvas}\n        code:   ${d.code}`,
    );
    return {
      ok: false,
      compared,
      drift,
      message:
        `${String(drift.length)} token(s) differ between the canvas and the code:\n` +
        `${lines.join('\n')}\n\n` +
        'design/tokens.json is normative. Change the value there and on the ' +
        'artboard first, then bring packages/ui/src/tokens into line.',
    };
  }

  return {
    ok: true,
    compared,
    drift,
    message: `All ${String(compared)} tokens match design/tokens.json.`,
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const report = checkDesignTokens(loadDesignTokens());
  if (!report.ok) {
    console.error(report.message);
    process.exit(1);
  }
  console.log(report.message);
}
