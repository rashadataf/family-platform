import { loadEnv } from './load-env.js';

/**
 * Boot-time configuration preflight, run before the watcher starts.
 *
 * This mirrors what scripts/dev.ts already does for the host-based path, and
 * exists for the same reason: `tsx watch` deliberately survives a crashed
 * child process and waits for a file change rather than propagating its exit
 * code. Without this check, a container with invalid configuration would sit
 * there "Up" with the error buried in its logs, instead of exiting — the
 * failure spec.md's edge cases require to be immediate and legible.
 *
 * loadEnv() prints the specific offending variable and exits non-zero itself.
 */
loadEnv();
console.log('Environment configuration is valid.');
