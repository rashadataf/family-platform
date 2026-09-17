import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * FR-015: authorization code checks capabilities, never roles, so that
 * adding a role later never means editing scattered `if (role === '…')`
 * logic — `CapabilityGuard` and `RequiresCapability` exist specifically so
 * no handler ever needs to. This is a static, AST-level check rather than a
 * grep, for the same reason `no-family-references.spec.ts` gives: this file
 * and several doc comments (`capability.guard.ts`'s own worked example)
 * legitimately *mention* role names while explaining why they don't belong
 * here — a substring search would flag its own explanation.
 *
 * What counts as the forbidden pattern: a `===`/`!==`/`==`/`!=` comparison,
 * or a `switch` on a discriminant, where one side names something *called*
 * "role" (an identifier or a property access ending in `role`, case
 * insensitive — `member.role`, `req.familyContext.role`, a local `role`
 * variable) and the other side is one of the four role string literals.
 * Reading or displaying a role (`role: member.role` in a response body) is
 * fine and common in this codebase; branching a decision on its value is
 * the thing FR-015 forbids. A comparison against an unrelated field that
 * happens to share a string value with a role (`body.kind === 'extended'`,
 * translating the wire `AddMemberRequest.kind` discriminant) is not this
 * pattern either — the check only fires when the compared name itself says
 * "role".
 */
const ROLE_LITERALS = new Set(['owner', 'adult', 'extended', 'viewer']);

/**
 * `apps/api/src` in full — so a new context's controller is covered the moment
 * it exists, with no glob to remember to widen — plus `packages/core/tasks`,
 * added by spec 010 (T094): Tasks decides visibility in its own application
 * layer rather than in a guard, so a role comparison that crept in there would
 * never have been seen by an apps/api-only scan.
 *
 * `packages/core/family` is deliberately NOT scanned. FR-015 is about
 * AUTHORIZATION code checking capabilities instead of roles; Family's own
 * domain is where roles are defined and their invariants enforced — "a family
 * has exactly one owner", ownership transfer, and `capabilities.ts`'s
 * role-to-capability table itself. Those comparisons are the subject matter,
 * not a violation of it, and a scan that flagged them would be asking Family
 * to stop modelling the thing every other context then consumes.
 */
const SCANNED_ROOTS = [
  join(import.meta.dirname, '..'),
  resolve(import.meta.dirname, '../../../../packages/core/src/tasks'),
];

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

/** The name a comparison would be "about", for a bare identifier or a `a.b.role`-shaped access. */
function namedByExpression(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function roleLiteralIn(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node) && ROLE_LITERALS.has(node.text)) return node.text;
  return null;
}

function findViolations(filePath: string): string[] {
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];

  function report(node: ts.Node, literal: string): void {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    violations.push(
      `${filePath}:${String(line + 1)} — comparison against role literal '${literal}'`,
    );
  }

  function isRoleComparison(a: ts.Expression, b: ts.Expression): string | null {
    const literal = roleLiteralIn(a) ?? roleLiteralIn(b);
    if (literal === null) return null;
    const namedSide = roleLiteralIn(a) !== null ? b : a;
    const name = namedByExpression(namedSide);
    return name !== null && /role/i.test(name) ? literal : null;
  }

  function visit(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      const literal = isRoleComparison(node.left, node.right);
      if (literal !== null) report(node, literal);
    }

    if (ts.isSwitchStatement(node)) {
      const discriminantName = namedByExpression(node.expression);
      if (discriminantName !== null && /role/i.test(discriminantName)) {
        for (const clause of node.caseBlock.clauses) {
          if (ts.isCaseClause(clause)) {
            const literal = roleLiteralIn(clause.expression);
            if (literal !== null) report(clause, literal);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

describe('FR-015: no decision branches on a role literal', () => {
  function scanned(): string[] {
    return SCANNED_ROOTS.flatMap(collectSourceFiles);
  }

  it('contains no role-literal comparison or switch case in any non-test source file', () => {
    const violations = scanned().flatMap(findViolations);

    expect(violations).toEqual([]);
  });

  /**
   * The scan is only worth anything if it reaches the code it claims to. A
   * refactor that moved a directory would otherwise leave this test passing
   * over nothing.
   */
  it('actually reaches the Tasks context, in both the API and the core layers', () => {
    const files = scanned();
    expect(files.some((file) => file.includes(join('apps', 'api', 'src', 'tasks')))).toBe(true);
    expect(files.some((file) => file.includes(join('core', 'src', 'tasks')))).toBe(true);
    // The API's other contexts come along with the apps/api root.
    expect(files.some((file) => file.includes(join('apps', 'api', 'src', 'calendar')))).toBe(true);
    expect(files.some((file) => file.includes(join('apps', 'api', 'src', 'family')))).toBe(true);
  });
});
