import { fileURLToPath } from 'node:url';
import { contrastRatio } from './lib/contrast.js';
import { isOpaque, loadDesignTokens, type DesignTokens } from './lib/design-tokens.js';

/**
 * FR-010: every colour pairing artboard 01 documents clears its floor, in both
 * themes, verified on every change.
 *
 * The list of pairings lives in `design/tokens.json` rather than here, which is
 * what makes artboard 01's sentence — "a pairing outside this table has not been
 * checked and is not approved" — true rather than aspirational. Putting a new
 * colour combination on a screen means adding it there, and the count printed
 * below is how a missing one gets noticed.
 *
 * This check found seven real failures the first time it ran, against a palette
 * that had been drawn by eye and looked fine.
 */

export interface ContrastFailure {
  theme: 'light' | 'dark';
  foreground: string;
  background: string;
  measured: number;
  floor: number;
}

export interface ContrastReport {
  ok: boolean;
  checked: number;
  failures: ContrastFailure[];
  message: string;
}

const THEMES = ['light', 'dark'] as const;

export function checkContrast(tokens: DesignTokens): ContrastReport {
  const failures: ContrastFailure[] = [];
  let checked = 0;

  for (const pair of tokens.contrastPairs) {
    const fg = tokens.colour[pair.foreground];
    const bg = tokens.colour[pair.background];

    if (fg === undefined || bg === undefined) {
      const missing = fg === undefined ? pair.foreground : pair.background;
      throw new Error(
        `contrastPairs names a colour role that does not exist: ${missing}. ` +
          'A pairing referencing a role no longer in the token set is a pairing ' +
          'nobody is checking.',
      );
    }

    for (const theme of THEMES) {
      const fgValue = fg[theme];
      const bgValue = bg[theme];
      // The scrim is translucent by design: its effective contrast depends on
      // whatever is behind it, so it is not a documented pairing.
      if (!isOpaque(fgValue) || !isOpaque(bgValue)) continue;

      checked += 1;
      const measured = contrastRatio(fgValue, bgValue);
      if (measured < pair.floor) {
        failures.push({
          theme,
          foreground: pair.foreground,
          background: pair.background,
          measured,
          floor: pair.floor,
        });
      }
    }
  }

  if (failures.length > 0) {
    const lines = failures.map(
      (f) =>
        `  ${f.theme.padEnd(5)} ${f.foreground} on ${f.background}\n` +
        `        ${f.measured.toFixed(2)}:1, needs ${f.floor.toFixed(1)}:1`,
    );
    return {
      ok: false,
      checked,
      failures,
      message:
        `${String(failures.length)} colour pairing(s) below their contrast floor:\n` +
        `${lines.join('\n')}\n\n` +
        'Fix the value in design/tokens.json and on the canvas, not the floor.',
    };
  }

  return {
    ok: true,
    checked,
    failures,
    message: `All ${String(checked)} colour pairings clear their contrast floor (both themes).`,
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const report = checkContrast(loadDesignTokens());
  if (!report.ok) {
    console.error(report.message);
    process.exit(1);
  }
  console.log(report.message);
}
