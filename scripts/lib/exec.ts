import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command with output inherited to the terminal AND captured, so
 * callers can pattern-match stderr for known failure signatures (e.g. a
 * port already allocated) while the developer still sees live output.
 */
export function run(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Runs a command without streaming its output live — for checks whose
 * success case would otherwise print unwanted noise (e.g. `docker info`'s
 * full system dump) on every successful run. Output is still captured so a
 * caller can report it on failure.
 */
export function runQuiet(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Spawns a long-running, foregrounded process (e.g. the API dev server),
 * forwarding SIGINT/SIGTERM so Ctrl+C in the orchestrator stops it cleanly.
 * Resolves with the child's exit code when it exits on its own.
 */
export function runForeground(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });

    const forward = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);

    child.on('error', reject);
    child.on('close', (code) => {
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
      resolve(code ?? 1);
    });
  });
}
