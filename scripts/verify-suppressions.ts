import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * FR-013: every vulnerability suppression carries an expiry.
 *
 * The project constitution's governance section says an exception without an
 * expiry MUST NOT be granted. osv-scanner does not enforce that — `ignoreUntil`
 * on an `[[IgnoredVulns]]` entry and `effectiveUntil` on a `[[PackageOverrides]]`
 * entry are both optional, and an entry without one silences its finding
 * permanently. That is precisely the graveyard the rule exists to prevent, so
 * the rule is enforced here instead of being written down and hoped for.
 *
 * A date already in the past is fine and is deliberately not an error:
 * osv-scanner stops honouring the entry, the finding fails the build again,
 * and the question gets asked a second time. That is the mechanism working.
 */

const configUrl = new URL('../osv-scanner.toml', import.meta.url);

/** A TOML array-of-tables header, e.g. `[[IgnoredVulns]]`. */
const TABLE_HEADER = /^\s*\[\[\s*([A-Za-z]+)\s*\]\]\s*$/;
/** Any other table header ends the block. */
const OTHER_HEADER = /^\s*\[[^[]/;

const EXPIRY_KEY = {
  IgnoredVulns: 'ignoreUntil',
  PackageOverrides: 'effectiveUntil',
} as const;

type SuppressionTable = keyof typeof EXPIRY_KEY;

function isSuppressionTable(name: string): name is SuppressionTable {
  return Object.hasOwn(EXPIRY_KEY, name);
}

export interface SuppressionReport {
  ok: boolean;
  entries: number;
  message: string;
}

export function checkSuppressionText(toml: string): SuppressionReport {
  const lines = toml.split('\n');
  const problems: string[] = [];
  let entries = 0;

  let table: SuppressionTable | undefined;
  let startLine = 0;
  let identifier = '(unnamed)';
  let hasExpiry = false;

  const closeBlock = () => {
    if (table === undefined) return;
    entries++;
    if (!hasExpiry) {
      problems.push(
        `  osv-scanner.toml:${String(startLine)}  [[${table}]] ${identifier}\n` +
          `    has no \`${EXPIRY_KEY[table]}\`. A suppression without an expiry is permanent, and the constitution forbids granting one (FR-013).`,
      );
    }
    table = undefined;
  };

  lines.forEach((line, index) => {
    // A comment is documentation, not configuration. The example block at the
    // top of osv-scanner.toml must not read as a real entry.
    if (/^\s*#/.test(line)) return;

    const header = TABLE_HEADER.exec(line);
    if (header) {
      closeBlock();
      const name = header[1] ?? '';
      if (isSuppressionTable(name)) {
        table = name;
        startLine = index + 1;
        identifier = '(unnamed)';
        hasExpiry = false;
      }
      return;
    }

    if (OTHER_HEADER.test(line)) {
      closeBlock();
      return;
    }

    if (table === undefined) return;
    if (new RegExp(`^\\s*${EXPIRY_KEY[table]}\\s*=`).test(line)) hasExpiry = true;
    const id = /^\s*(?:id|name)\s*=\s*["']([^"']+)["']/.exec(line);
    if (id?.[1] !== undefined) identifier = id[1];
  });
  closeBlock();

  if (problems.length > 0) {
    return {
      ok: false,
      entries,
      message: `${String(problems.length)} of ${String(entries)} suppression(s) have no expiry:\n${problems.join('\n')}`,
    };
  }

  return {
    ok: true,
    entries,
    message:
      entries === 0
        ? 'osv-scanner.toml holds no suppressions.'
        : `All ${String(entries)} suppression(s) in osv-scanner.toml carry an expiry.`,
  };
}

export function checkSuppressions(): SuppressionReport {
  return checkSuppressionText(readFileSync(configUrl, 'utf-8'));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const result = checkSuppressions();
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}
