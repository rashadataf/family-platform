import { Client } from 'pg';

export interface RawAuditRow {
  readonly actorMemberId: string | null;
  readonly familyId: string | null;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly action: string;
  readonly purpose: string;
  readonly result: 'granted' | 'denied';
  readonly reason: string | null;
}

/**
 * Reads `audit_log` rows for verification, using the OWNER connection —
 * never the application role's. That is the entire point of ADR-017's
 * INSERT-only grant on this table (`family-context.integration.spec.ts`
 * proves the application role's `SELECT` fails), so a test that needs to
 * read a row back has no path through the connection the application itself
 * uses.
 *
 * A raw `pg` client rather than a second `PrismaClient`: `packages/persistence`
 * owns the only one (ADR-003, Principle IV), and that rule protects a
 * production data-access path, not a test's one-off verification query
 * against a role no application code ever authenticates as.
 */
export async function readAuditLogRows(
  ownerUrl: string,
  subjectId: string,
): Promise<RawAuditRow[]> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const result = await client.query<{
      actor_member_id: string | null;
      family_id: string | null;
      subject_type: string;
      subject_id: string;
      action: string;
      purpose: string;
      result: 'granted' | 'denied';
      reason: string | null;
    }>(
      `SELECT actor_member_id, family_id, subject_type, subject_id, action, purpose, result, reason
       FROM audit_log
       WHERE subject_id = $1
       ORDER BY occurred_at ASC`,
      [subjectId],
    );

    return result.rows.map((row) => ({
      actorMemberId: row.actor_member_id,
      familyId: row.family_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      action: row.action,
      purpose: row.purpose,
      result: row.result,
      reason: row.reason,
    }));
  } finally {
    await client.end();
  }
}
