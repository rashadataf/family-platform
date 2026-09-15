import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE.md §5.4 permits this one shared kernel only because it is
 * "small, stable, pure", and FR-013 says what pure means: no I/O, no clock, no
 * randomness, no dependency, no import from any bounded context. Tasks will
 * import this directory verbatim, so a violation here is a violation in two
 * contexts at once.
 *
 * Asserted structurally, from the source, rather than trusted to review:
 *
 * 1. Every import resolves inside this directory or to the kernel's own
 *    primitives (`../result.js`, `../errors.js`) — no package, no Node module.
 * 2. No clock, randomness or I/O global is referenced: `Date.now`, a
 *    zero-argument `new Date()`, `Math.random`, `performance`, `process`,
 *    `fetch`, `crypto`, timers.
 * 3. `packages/kernel/package.json` declares no runtime dependency. Read
 *    directly, because `pnpm ls` would not catch one added and left unused.
 */
const RECURRENCE_ROOT = import.meta.dirname;
const KERNEL_SRC = resolve(RECURRENCE_ROOT, '..');
const ALLOWED_KERNEL_PRIMITIVES = new Set(['result.ts', 'errors.ts', 'branded-id.ts']);
const FORBIDDEN_GLOBALS = new Set([
  'performance',
  'process',
  'fetch',
  'crypto',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'require',
]);

function sourceFiles(): string[] {
  return readdirSync(RECURRENCE_ROOT)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
    .map((entry) => join(RECURRENCE_ROOT, entry));
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
}

describe('@fp/kernel/recurrence is pure (FR-013, SC-010)', () => {
  it('has source files to check', () => {
    expect(sourceFiles().length).toBeGreaterThanOrEqual(4);
  });

  it('imports only its own directory and the kernel’s own primitives', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      parse(file).forEachChild((node) => {
        if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
        const specifier = node.moduleSpecifier;
        if (specifier === undefined || !ts.isStringLiteral(specifier)) return;

        const text = specifier.text;
        if (!text.startsWith('.')) {
          violations.push(`${file}: imports package "${text}"`);
          return;
        }
        const target = resolve(dirname(file), text).replace(/\.js$/, '.ts');
        const insideRecurrence = dirname(target) === RECURRENCE_ROOT;
        const kernelPrimitive =
          dirname(target) === KERNEL_SRC &&
          ALLOWED_KERNEL_PRIMITIVES.has(target.slice(KERNEL_SRC.length + 1));
        if (!insideRecurrence && !kernelPrimitive) violations.push(`${file}: imports "${text}"`);
      });
    }
    expect(violations).toEqual([]);
  });

  it('references no clock, randomness or I/O', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const source = parse(file);
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
          const access = `${node.expression.text}.${node.name.text}`;
          if (access === 'Date.now' || access === 'Math.random')
            violations.push(`${file}: ${access}`);
        }
        if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'Date' &&
          (node.arguments === undefined || node.arguments.length === 0)
        ) {
          violations.push(`${file}: new Date() reads the clock`);
        }
        if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) {
          violations.push(`${file}: references ${node.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });

  it('declares no runtime dependency in packages/kernel/package.json', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(KERNEL_SRC, '..', 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });
});
