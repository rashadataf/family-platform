import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runForeground } from './lib/exec.js';

/**
 * Runs the boundary gate, printing the rule inventory first.
 *
 * US1 acceptance scenario 1 requires a passing run to report *which rules were
 * evaluated*, and that is not decoration. `dependency-cruiser` reports "no
 * dependency violations found" just as cheerfully against a configuration
 * whose rules have been emptied as against one enforcing all of them. A green
 * check that does not say what it checked is the vacuous-gate problem this
 * repository has already had to fix once.
 *
 * The inventory is printed by this wrapper; the verdict still comes from
 * `depcruise` itself, whose exit code is passed through unchanged.
 */

const CONFIG = '.dependency-cruiser.cjs';

interface NamedRule {
  name?: string;
}

interface CruiserConfig {
  allowed?: unknown[];
  allowedSeverity?: string;
  forbidden?: NamedRule[];
}

function loadConfig(): CruiserConfig {
  // A runtime require, deliberately: this is a CommonJS config file being read
  // as data, not a module this one depends on.
  const require = createRequire(import.meta.url);
  return require(`../${CONFIG}`) as CruiserConfig;
}

export function describeRules(config: CruiserConfig): string {
  const allowedCount = config.allowed?.length ?? 0;
  const forbidden = (config.forbidden ?? [])
    .map((rule) => rule.name)
    .filter((name): name is string => name !== undefined);

  if (allowedCount === 0) {
    return `${CONFIG} has no \`allowed\` entries, so every dependency would pass. That is fail-open, which FR-006 forbids.`;
  }
  if (config.allowedSeverity !== 'error') {
    return `${CONFIG} sets allowedSeverity to ${String(config.allowedSeverity)}. An unlisted dependency must fail the build, not warn.`;
  }

  return [
    `Boundary rules in ${CONFIG}:`,
    `  ${String(allowedCount)} allowed-edge entries, default-deny (allowedSeverity: error)`,
    `  ${String(forbidden.length)} named rules: ${forbidden.join(', ')}`,
  ].join('\n');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const summary = describeRules(loadConfig());
  console.log(summary);

  // A misconfiguration that would make the gate pass everything must fail the
  // gate, not be reported as a passing run with an unusual message.
  if (summary.startsWith(CONFIG)) {
    process.exit(1);
  }

  process.exit(
    await runForeground('depcruise', ['--config', CONFIG, '--output-type', 'err-long', '.']),
  );
}
