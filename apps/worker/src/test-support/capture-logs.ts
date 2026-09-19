/**
 * Test-only: runs `run` and returns every line it wrote to `console.log`,
 * `console.warn` or `console.error`, in order, each argument stringified and
 * space-joined the way the terminal would show it.
 *
 * All three streams, because the severity of a line — and so which stream it
 * uses — is the implementation's choice; the text of the line is what a
 * requirement fixes (`ALERT ...` goes to `warn`, a run summary to `log`).
 * The originals are restored even when `run` throws.
 */
export async function captureLogs(run: () => Promise<unknown>): Promise<readonly string[]> {
  const lines: string[] = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    await run();
  } finally {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
  }
  return lines;
}
