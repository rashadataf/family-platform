import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * FR-014: the Node.js version has exactly one authoritative source, and a
 * check fails when the image disagrees with it.
 *
 * `.nvmrc` governs the host and CI (via actions/setup-node). Compose cannot
 * read `.nvmrc`, so the Dockerfile necessarily repeats the version. ADR-014
 * requires that duplication be guarded by a check rather than a comment,
 * because a convention only a comment protects is one that drifts silently —
 * and the symptom is a behavioural difference between the two development
 * paths, which is expensive to trace back to its cause.
 */

const nvmrcUrl = new URL('../.nvmrc', import.meta.url);
const dockerfileUrl = new URL('../apps/api/Dockerfile', import.meta.url);

/** `ARG NODE_VERSION=24`, at the start of a line, before any FROM uses it. */
const ARG_NODE_VERSION = /^ARG\s+NODE_VERSION=(\S+)/m;

export interface VersionComparison {
  ok: boolean;
  message: string;
}

/** Extracts the major from `24`, `24.1.0`, `v24`, or `lts/iron`-free forms. */
function majorOf(raw: string): string | undefined {
  return /^v?(\d+)/.exec(raw.trim())?.[1];
}

export function compareNodeVersions(nvmrc: string, dockerfile: string): VersionComparison {
  const nvmrcMajor = majorOf(nvmrc);
  if (nvmrcMajor === undefined) {
    return {
      ok: false,
      message: `.nvmrc does not contain a recognisable Node version (found: ${JSON.stringify(nvmrc.trim())}).`,
    };
  }

  const argMatch = ARG_NODE_VERSION.exec(dockerfile);
  if (argMatch?.[1] === undefined) {
    return {
      ok: false,
      message:
        'apps/api/Dockerfile has no `ARG NODE_VERSION=...` line. It is required so the image version can be checked against .nvmrc (FR-014).',
    };
  }

  const dockerMajor = majorOf(argMatch[1]);
  if (dockerMajor === undefined) {
    return {
      ok: false,
      message: `apps/api/Dockerfile's ARG NODE_VERSION is not a recognisable Node version (found: ${JSON.stringify(argMatch[1])}).`,
    };
  }

  if (nvmrcMajor !== dockerMajor) {
    return {
      ok: false,
      message: `Node version drift: .nvmrc says ${nvmrcMajor}, apps/api/Dockerfile's ARG NODE_VERSION says ${dockerMajor}. The host, CI and the container image must agree (FR-014).`,
    };
  }

  return { ok: true, message: `Node ${nvmrcMajor}: .nvmrc and apps/api/Dockerfile agree.` };
}

export function checkNodeVersion(): VersionComparison {
  return compareNodeVersions(readFileSync(nvmrcUrl, 'utf-8'), readFileSync(dockerfileUrl, 'utf-8'));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const result = checkNodeVersion();
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}
