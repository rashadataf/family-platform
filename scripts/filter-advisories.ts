import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Turns an osv-scanner JSON report into a merge decision.
 *
 * FR-011/FR-012: the gate blocks on HIGH and CRITICAL advisories, and its
 * output names the package, the advisory and the fixed version. osv-scanner
 * has no severity threshold of its own — it exits non-zero for anything it
 * finds, including LOW — so the threshold lives here rather than in a shell
 * pipeline nobody can test.
 *
 * Lower-severity findings are printed and do not block. They are real, and
 * burying them would be dishonest, but a gate that blocks a merge on a LOW
 * advisory in a transitive development dependency is a gate people learn to
 * route around.
 */

/** CVSS base score at which a finding blocks. 7.0 is the HIGH boundary. */
const BLOCKING_SCORE = 7;
const BLOCKING_LABELS = new Set(['HIGH', 'CRITICAL']);

interface OsvGroup {
  ids?: string[];
  max_severity?: string;
}

interface OsvVulnerability {
  id?: string;
  database_specific?: { severity?: string };
  affected?: { ranges?: { events?: { introduced?: string; fixed?: string }[] }[] }[];
}

interface OsvPackage {
  package?: { name?: string; version?: string; ecosystem?: string };
  groups?: OsvGroup[];
  vulnerabilities?: OsvVulnerability[];
}

export interface OsvReport {
  results?: { packages?: OsvPackage[] }[];
}

export interface Finding {
  id: string;
  package: string;
  version: string;
  severity: string;
  fixedIn: string;
  blocking: boolean;
}

export interface AdvisoryReport {
  ok: boolean;
  findings: Finding[];
  message: string;
}

function fixedVersion(vulnerability: OsvVulnerability): string {
  for (const affected of vulnerability.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed !== undefined) return event.fixed;
      }
    }
  }
  return 'no fix published';
}

/**
 * `groups[].max_severity` is the numeric CVSS score and is preferred; the
 * GitHub label under `database_specific.severity` is the fallback for an
 * advisory that carries no score.
 */
function severityOf(
  vulnerability: OsvVulnerability,
  groups: readonly OsvGroup[],
): { label: string; blocking: boolean } {
  const id = vulnerability.id ?? '';
  const group = groups.find((candidate) => (candidate.ids ?? []).includes(id));
  const score = Number.parseFloat(group?.max_severity ?? '');

  if (Number.isFinite(score)) {
    return { label: `CVSS ${score.toFixed(1)}`, blocking: score >= BLOCKING_SCORE };
  }

  const label = (vulnerability.database_specific?.severity ?? 'UNKNOWN').toUpperCase();
  return { label, blocking: BLOCKING_LABELS.has(label) };
}

export function filterAdvisories(report: OsvReport): AdvisoryReport {
  const findings: Finding[] = [];

  for (const result of report.results ?? []) {
    for (const entry of result.packages ?? []) {
      const groups = entry.groups ?? [];
      for (const vulnerability of entry.vulnerabilities ?? []) {
        const { label, blocking } = severityOf(vulnerability, groups);
        findings.push({
          id: vulnerability.id ?? '(unidentified)',
          package: entry.package?.name ?? '(unknown package)',
          version: entry.package?.version ?? '?',
          severity: label,
          fixedIn: fixedVersion(vulnerability),
          blocking,
        });
      }
    }
  }

  const blocking = findings.filter((finding) => finding.blocking);
  const describe = (finding: Finding) =>
    `  ${finding.package}@${finding.version}  ${finding.id}  ${finding.severity}  fixed in: ${finding.fixedIn}`;

  if (blocking.length > 0) {
    const rest = findings.filter((finding) => !finding.blocking);
    const tail =
      rest.length > 0
        ? `\n\nBelow the threshold, not blocking:\n${rest.map(describe).join('\n')}`
        : '';
    return {
      ok: false,
      findings,
      message: `${String(blocking.length)} blocking advisory(ies) (HIGH or CRITICAL):\n${blocking.map(describe).join('\n')}\n\nFix by upgrading, or by a pnpm \`overrides\` entry in pnpm-workspace.yaml. An osv-scanner.toml suppression is the last resort and MUST carry an expiry.${tail}`,
    };
  }

  if (findings.length > 0) {
    return {
      ok: true,
      findings,
      message: `No HIGH or CRITICAL advisories. ${String(findings.length)} below the threshold:\n${findings.map(describe).join('\n')}`,
    };
  }

  return { ok: true, findings, message: 'No known advisories in the dependency graph.' };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const path = process.argv[2];
  if (path === undefined) {
    console.error('usage: filter-advisories.ts <osv-scanner-json-report>');
    process.exit(1);
  }
  const result = filterAdvisories(JSON.parse(readFileSync(path, 'utf-8')) as OsvReport);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}
