import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * FR-022, ARCHITECTURE.md §5.1: the relationship between a `User` and a
 * family is owned entirely from the Family side — a `User` answers who
 * someone is, never what family they belong to or what they may touch
 * there. This context adding `FamilyMember`, `Guardianship` and
 * `Invitation` — and T005 relocating `EmailAddress` out of
 * `identity/domain` and into `@fp/kernel` along the way — is exactly the
 * kind of change that could tempt a reference onto `User` without anyone
 * deciding to add one, so this mirrors identity's own
 * `no-family-references.spec.ts` from here, the side introducing the
 * temptation, rather than trusting that file alone to keep catching it.
 *
 * A static, identifier-level scan rather than a substring search, for the
 * same reason the original gives: several files legitimately *mention*
 * these words in doc comments while explaining their absence. Walking the
 * TypeScript AST and checking only identifiers (never comments or string
 * literals) does not flag those.
 */
const FORBIDDEN_WORDS = ['family', 'families', 'role', 'roles', 'capability', 'capabilities'];
const SCANNED_SUBDIRECTORIES = ['domain', 'application'];
const IDENTITY_ROOT = join(import.meta.dirname, '..', 'identity');

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

describe('FR-022: core/identity still names no family, role, or capability, from family’s own side', () => {
  it('contains no such identifier in any non-test source file', () => {
    const violations = SCANNED_SUBDIRECTORIES.flatMap((subdirectory) =>
      collectSourceFiles(join(IDENTITY_ROOT, subdirectory)).flatMap(findForbiddenIdentifiers),
    );

    expect(violations).toEqual([]);
  });
});
