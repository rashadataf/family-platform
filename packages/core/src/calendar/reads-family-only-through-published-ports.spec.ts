import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * FR-027, research.md §1: Calendar may read the Family context through its
 * two published ports and nothing else.
 *
 * `no-cross-context-internals` cannot say this. It admits everything under
 * another context's `application/ports/`, and that directory also holds
 * Family's repository interfaces — `guardianship.repository.ts` among them. A
 * Calendar file importing one would pass the boundary rule and quietly make
 * Calendar a second owner of guardianship. The two files cannot be told apart
 * by path pattern while they share a directory, so this test tells them apart
 * by name.
 *
 * Mirrors `family-owns-the-relationship.spec.ts` in construction: the
 * TypeScript AST, so a doc comment mentioning a repository is not a finding.
 * Test doubles (`*.spec.ts`) are exempt — a handler test may use Family's
 * visibility fake, which is not a production edge.
 */
const CALENDAR_ROOT = import.meta.dirname;
const FAMILY_ROOT = resolve(CALENDAR_ROOT, '..', 'family');
const PUBLISHED_PORTS = new Set([
  'application/ports/family-context.port.ts',
  'application/ports/member-visibility.port.ts',
]);

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return collectSourceFiles(fullPath);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [fullPath] : [];
  });
}

function moduleSpecifiers(filePath: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

describe('FR-027: Calendar reads Family only through its published ports', () => {
  it('imports nothing from core/family but family-context.port.js and member-visibility.port.js', () => {
    const violations = collectSourceFiles(CALENDAR_ROOT).flatMap((file) =>
      moduleSpecifiers(file)
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) => resolve(dirname(file), specifier).replace(/\.js$/, '.ts'))
        .filter((target) => target.startsWith(FAMILY_ROOT + '/'))
        .filter((target) => !PUBLISHED_PORTS.has(relative(FAMILY_ROOT, target)))
        .map(
          (target) =>
            `${relative(CALENDAR_ROOT, file)} → core/family/${relative(FAMILY_ROOT, target)}`,
        ),
    );

    expect(violations).toEqual([]);
  });

  it('does reach Family through the visibility port — so the check above is not vacuous', () => {
    const reachesVisibilityPort = collectSourceFiles(CALENDAR_ROOT).some((file) =>
      moduleSpecifiers(file).some((specifier) => specifier.endsWith('member-visibility.port.js')),
    );
    expect(reachesVisibilityPort).toBe(true);
  });

  it('imports no @fp/core barrel, which would expose every Family internal at once', () => {
    const barrelImports = collectSourceFiles(CALENDAR_ROOT).flatMap((file) =>
      moduleSpecifiers(file)
        .filter((specifier) => specifier === '@fp/core' || specifier.endsWith('/family/index.js'))
        .map((specifier) => `${relative(CALENDAR_ROOT, file)} → ${specifier}`),
    );
    expect(barrelImports).toEqual([]);
  });
});
