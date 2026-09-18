import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * FR-012, FR-030, SC-010: Tasks may read the Family context through its two
 * published ports and nothing else — and Calendar not at all.
 *
 * The Calendar half is what makes this feature's thesis checkable. Tasks was
 * built second, over a kernel and a set of ports Calendar paid for, and the
 * measure of whether those were built as reusable parts rather than
 * Calendar-shaped code is that Tasks reaches for none of Calendar's own
 * internals — not its visibility helper, not its rollback class, not its
 * aggregate. Each of those exists in Tasks too, deliberately re-derived
 * (research.md §1), and a later "let us just share this" would be caught here.
 *
 * `no-cross-context-internals` cannot say either half. It admits everything
 * under another context's `application/ports/`, and that directory also holds
 * Family's repository interfaces — `guardianship.repository.ts` among them. A
 * Tasks file importing one would pass the boundary rule and quietly make Tasks
 * a second owner of guardianship.
 *
 * Mirrors `core/calendar/reads-family-only-through-published-ports.spec.ts` in
 * construction: the TypeScript AST, so a doc comment mentioning a repository is
 * not a finding. Test doubles (`*.spec.ts`) are exempt — a handler test may use
 * Family's visibility fake, which is not a production edge.
 */
const TASKS_ROOT = import.meta.dirname;
const CORE_SRC = resolve(TASKS_ROOT, '..');
const FAMILY_ROOT = join(CORE_SRC, 'family');
const CALENDAR_ROOT = join(CORE_SRC, 'calendar');
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

/** Every relative import in Tasks, resolved to the file it names. */
function resolvedImports(): { file: string; target: string }[] {
  return collectSourceFiles(TASKS_ROOT).flatMap((file) =>
    moduleSpecifiers(file)
      .filter((specifier) => specifier.startsWith('.'))
      .map((specifier) => ({
        file,
        target: resolve(dirname(file), specifier).replace(/\.js$/, '.ts'),
      })),
  );
}

describe('FR-012, FR-030: Tasks reads Family only through its published ports', () => {
  it('imports nothing from core/family but family-context.port.js and member-visibility.port.js', () => {
    const violations = resolvedImports()
      .filter(({ target }) => target.startsWith(FAMILY_ROOT + '/'))
      .filter(({ target }) => !PUBLISHED_PORTS.has(relative(FAMILY_ROOT, target)))
      .map(
        ({ file, target }) =>
          `${relative(TASKS_ROOT, file)} → core/family/${relative(FAMILY_ROOT, target)}`,
      );

    expect(violations).toEqual([]);
  });

  it('does reach Family through the visibility port — so the check above is not vacuous', () => {
    const reachesVisibilityPort = collectSourceFiles(TASKS_ROOT).some((file) =>
      moduleSpecifiers(file).some((specifier) => specifier.endsWith('member-visibility.port.js')),
    );
    expect(reachesVisibilityPort).toBe(true);
  });

  /** SC-010: Tasks depends on Calendar not at all. */
  it('imports nothing whatsoever from core/calendar', () => {
    const violations = resolvedImports()
      .filter(({ target }) => target.startsWith(CALENDAR_ROOT + '/'))
      .map(
        ({ file, target }) =>
          `${relative(TASKS_ROOT, file)} → core/calendar/${relative(CALENDAR_ROOT, target)}`,
      );

    expect(violations).toEqual([]);
  });

  it('names no calendar module even by package specifier', () => {
    const violations = collectSourceFiles(TASKS_ROOT).flatMap((file) =>
      moduleSpecifiers(file)
        .filter((specifier) => /calendar/i.test(specifier))
        .map((specifier) => `${relative(TASKS_ROOT, file)} → ${specifier}`),
    );
    expect(violations).toEqual([]);
  });

  it('imports no @fp/core barrel, which would expose every other context at once', () => {
    const barrelImports = collectSourceFiles(TASKS_ROOT).flatMap((file) =>
      moduleSpecifiers(file)
        .filter(
          (specifier) =>
            specifier === '@fp/core' ||
            specifier.endsWith('/family/index.js') ||
            specifier.endsWith('/calendar/index.js'),
        )
        .map((specifier) => `${relative(TASKS_ROOT, file)} → ${specifier}`),
    );
    expect(barrelImports).toEqual([]);
  });

  /**
   * The kernel is the one thing Tasks is SUPPOSED to share with Calendar, so
   * this asserts the dependency runs through it rather than around it.
   */
  it('consumes the shared recurrence kernel, not a copy of it', () => {
    const usesKernelRecurrence = collectSourceFiles(TASKS_ROOT).some((file) =>
      moduleSpecifiers(file).includes('@fp/kernel/recurrence'),
    );
    expect(usesKernelRecurrence).toBe(true);
  });
});
