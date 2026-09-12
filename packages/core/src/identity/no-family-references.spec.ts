import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * FR-018: a `User` answers who someone is, never what they may touch — that
 * relationship belongs entirely to a future Family and Membership context.
 * This is a static, identifier-level scan rather than a substring search:
 * several files here (this one included, and doc comments like
 * `user.aggregate.ts`'s "holds no reference to any family, role, or
 * capability") legitimately *mention* these words while explaining their
 * absence. A naive text search would flag its own explanatory comments;
 * walking the TypeScript AST and checking only identifiers (never comments
 * or string literals) does not.
 */
const FORBIDDEN_WORDS = ['family', 'families', 'role', 'roles', 'capability', 'capabilities'];
const SCANNED_SUBDIRECTORIES = ['domain', 'application'];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function findForbiddenIdentifiers(filePath: string): string[] {
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const lower = node.text.toLowerCase();
      if (FORBIDDEN_WORDS.some((word) => lower.includes(word))) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push(`${filePath}:${String(line + 1)} — identifier "${node.text}"`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

describe('FR-018: identity/{domain,application} names no family, role, or capability', () => {
  it('contains no such identifier in any non-test source file', () => {
    const violations = SCANNED_SUBDIRECTORIES.flatMap((subdirectory) =>
      collectSourceFiles(join(import.meta.dirname, subdirectory)).flatMap(findForbiddenIdentifiers),
    );

    expect(violations).toEqual([]);
  });
});
