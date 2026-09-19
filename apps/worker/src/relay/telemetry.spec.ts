import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RELAY_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * The two developer CLIs in this directory print what the developer asked for,
 * at their own terminal: `relay:seed` echoes the payload they just typed, and
 * `relay:peek` exists to show a queue's messages. Neither is the relay's own
 * record of a publish or delivery attempt, which is what FR-018 governs; they
 * are never started by the worker. Named here, with the reason, so that
 * exempting a file is a visible decision — and so that every OTHER file that
 * ever appears in this directory is checked without anyone remembering to add it.
 */
const DEVELOPER_TOOLS = new Set(['seed-cli.ts', 'peek-cli.ts']);

/** Identifiers that carry an event's contents (`contracts/relay-interfaces.md` §3, `MessageToPublish`). */
const CONTENT_IDENTIFIERS = new Set(['payload', 'body']);

const CONSOLE_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug']);

/**
 * Every `console.*(...)` call in `source` that mentions an identifier carrying
 * event contents anywhere in its arguments — `event.payload`, `message.body`,
 * a shorthand `{ payload }`, inside a template literal or out of it.
 */
function logCallsExposingContents(source: string, fileName = 'sample.ts'): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const offenders: string[] = [];

  const mentionsContents = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && CONTENT_IDENTIFIERS.has(node.text)) ||
    ts.forEachChild(node, mentionsContents) === true;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console' &&
      CONSOLE_METHODS.has(node.expression.name.text) &&
      node.arguments.some(mentionsContents)
    ) {
      offenders.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return offenders;
}

/**
 * FR-018, SC-009, Principle VI: logs must not become a second, less-controlled
 * copy of event content. The runtime half of this — real ticks, a real payload,
 * every line captured — is in `outbox-relay.sweep.integration.spec.ts`; this is
 * the half that reads the code, so a log statement on a path no test happens to
 * take (or in a file added later) is caught as well.
 */
describe('the relay never logs event contents (FR-018, SC-009)', () => {
  describe('the checker itself', () => {
    it.each([
      ['a template literal reading event.payload', 'console.log(`sent ${event.payload}`)'],
      ['a message body passed as an argument', 'console.error("failed", message.body)'],
      ['a shorthand property', 'console.warn({ eventId, payload })'],
      ['a serialised body', 'console.log(JSON.stringify({ body }))'],
    ])('flags %s', (_description, source) => {
      expect(logCallsExposingContents(source)).toHaveLength(1);
    });

    it.each([
      ['identifiers and counts', 'console.log(`run claimed=${claimed} event=${event.id}`)'],
      ['an error name only', 'console.error("failed", error instanceof Error ? error.name : "x")'],
      ['a word in a string, not an identifier', 'console.log("no payload logged")'],
      ['contents used outside any log call', 'const b = JSON.stringify(event.payload); send(b);'],
    ])('does not flag %s', (_description, source) => {
      expect(logCallsExposingContents(source)).toEqual([]);
    });
  });

  it('finds no log statement in the relay that mentions a payload or a message body', () => {
    const sources = readdirSync(RELAY_DIR).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !DEVELOPER_TOOLS.has(name),
    );
    // Guards the guard: an empty list would pass this test for the wrong reason.
    expect(sources).toContain('outbox-relay.sweep.ts');

    const offenders = sources.flatMap((name) =>
      logCallsExposingContents(readFileSync(new URL(name, import.meta.url), 'utf8'), name).map(
        (call) => `${name}: ${call}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
