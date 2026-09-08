import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * FR-025: every third-party GitHub Action is referenced by immutable commit
 * SHA, with the human-readable version in a trailing comment.
 *
 * A tag is mutable. `actions/checkout@v4` is a pointer that whoever controls
 * that repository can repoint at any time, which is a supply-chain path into a
 * pipeline holding write access to this one. A commit SHA cannot be repointed.
 *
 * The trailing comment is not decoration and is checked too: a bare
 * 40-character hash is unreviewable, and Dependabot's `github-actions`
 * ecosystem (.github/dependabot.yml) maintains both halves together.
 *
 * This exists as a committed check rather than as a grep in a document
 * because a gate that only runs when someone remembers to run it is not a
 * gate — the same reasoning that put `format` into CI (see .github/workflows/ci.yml).
 */

const githubDirUrl = new URL('../.github/', import.meta.url);

/** `uses: owner/repo@ref` or `uses: ./local/path`, with an optional comment. */
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(\S+)\s*(#.*)?$/;

/** A pinned reference: exactly 40 lowercase hex characters. */
const COMMIT_SHA = /@[0-9a-f]{40}$/;

/** The version comment that makes the hash reviewable, e.g. `# v4.4.0`. */
const VERSION_COMMENT = /^#\s*v?\d/;

export interface PinProblem {
  file: string;
  line: number;
  reference: string;
  reason: string;
}

export interface PinReport {
  ok: boolean;
  checked: number;
  problems: PinProblem[];
  message: string;
}

export interface WorkflowFile {
  path: string;
  content: string;
}

/**
 * A reference starting with `./` or `../` is a local action living in this
 * repository. It is resolved from the commit the job already checked out, so
 * there is no external pointer to pin — pinning it is not possible and not
 * needed. Excluding these is the correction to the naive
 * `grep -rn "uses:" .github/ | grep -v "@[0-9a-f]\{40\}"`, which reports every
 * local composite-action reference as a violation.
 */
function isLocal(reference: string): boolean {
  return reference.startsWith('./') || reference.startsWith('../');
}

export function findPinProblems(files: readonly WorkflowFile[]): PinReport {
  const problems: PinProblem[] = [];
  let checked = 0;

  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = USES_LINE.exec(lines[i] ?? '');
      const reference = match?.[1];
      if (reference === undefined || isLocal(reference)) continue;

      checked++;
      const where = { file: file.path, line: i + 1, reference };

      if (!COMMIT_SHA.test(reference)) {
        problems.push({
          ...where,
          reason:
            'referenced by a mutable tag or branch. Pin it to a full 40-character commit SHA (FR-025).',
        });
        continue;
      }

      const comment = match?.[2];
      if (comment === undefined || !VERSION_COMMENT.test(comment)) {
        problems.push({
          ...where,
          reason:
            'pinned, but with no trailing version comment. A bare hash is unreviewable — add e.g. `# v4.4.0` (FR-025).',
        });
      }
    }
  }

  if (problems.length > 0) {
    const detail = problems
      .map((p) => `  ${p.file}:${String(p.line)}  ${p.reference}\n    ${p.reason}`)
      .join('\n');
    return {
      ok: false,
      checked,
      problems,
      message: `${String(problems.length)} of ${String(checked)} third-party action reference(s) are not safely pinned:\n${detail}`,
    };
  }

  return {
    ok: true,
    checked,
    problems,
    message: `All ${String(checked)} third-party action references are pinned to a commit SHA with a version comment.`,
  };
}

/** Every `.yml`/`.yaml` under `.github/`, recursively. */
function collectWorkflowFiles(dir: URL, prefix: string): WorkflowFile[] {
  const found: WorkflowFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(
        ...collectWorkflowFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`),
      );
    } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
      found.push({
        path: `${prefix}${entry.name}`,
        content: readFileSync(new URL(entry.name, dir), 'utf-8'),
      });
    }
  }
  return found;
}

export function checkActionPins(): PinReport {
  return findPinProblems(collectWorkflowFiles(githubDirUrl, '.github/'));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const result = checkActionPins();
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}
