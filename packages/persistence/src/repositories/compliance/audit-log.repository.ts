import type { compliance } from '@fp/core';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { TransactionClient } from '../../testing.js';

/**
 * The one implementation of `AuditLogPort`.
 *
 * It takes either the base client or a transaction client, and that choice is
 * the whole design:
 *
 * - A **granted** read of a child's record is audited inside the same
 *   transaction as the read, so the record and the thing it records commit or
 *   roll back together (Principle VI).
 * - A **denial** has no transaction — nothing was written, that is what makes
 *   it a denial — so it is a single insert on the failure path.
 *
 * `audit_log` is not family-scoped and carries no row-level security policy.
 * A denial is frequently recorded when `app.family_id` is unset or names a
 * different family, which is exactly the row a policy would discard and
 * exactly the row that matters (ADR-017).
 */
export class PrismaAuditLogRepository implements compliance.AuditLogPort {
  constructor(private readonly client: PrismaClient | TransactionClient) {}

  /**
   * A raw INSERT rather than `client.auditLog.create()`, and the reason is the
   * grant rather than performance.
   *
   * Prisma's `create` issues `INSERT … RETURNING`, and `RETURNING` requires
   * SELECT on the columns it returns. The application role holds INSERT and
   * nothing else on this table (ADR-017), so `create` fails with "permission
   * denied for table audit_log" — the grant doing exactly its job. Reading
   * back a row we just wrote is worth nothing here anyway: nothing in the
   * request path ever reads the audit log.
   *
   * Parameterised throughout. `$executeRaw` with a tagged template binds every
   * interpolation, so none of these values is concatenated into SQL.
   */
  async append(entry: compliance.AuditEntry): Promise<void> {
    await this.client.$executeRaw`
      INSERT INTO "audit_log" (
        "id", "actor_user_id", "actor_member_id", "family_id",
        "subject_type", "subject_id", "action", "purpose", "result",
        "reason", "correlation_id"
      ) VALUES (
        gen_random_uuid(),
        ${entry.actorUserId}, ${entry.actorMemberId}, ${entry.familyId},
        ${entry.subjectType}, ${entry.subjectId}, ${entry.action},
        ${entry.purpose}, ${entry.result}::"audit_result",
        ${entry.reason}, ${entry.correlationId}
      )
    `;
  }
}
