import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { compliance, family } from '@fp/core';
import { asFamilyId, type FamilyId } from '@fp/kernel';
import type { RequestWithIdentityContext } from '../identity/session.guard.js';
import { AUDIT_LOG, FAMILY_UNIT_OF_WORK } from './family.tokens.js';

/**
 * What the guard attaches for the handler and `CapabilityGuard` to read.
 * Structural rather than importing Express's `Request`, for the same reason
 * `SessionGuard` gives: one header in, one field out.
 */
export interface RequestWithFamilyContext extends RequestWithIdentityContext {
  params?: Record<string, string>;
  familyContext?: family.FamilyContext & { familyId: FamilyId };
  correlationId?: string;
}

/**
 * ARCHITECTURE.md §9 layer 2, and the reason every family-scoped route in
 * `contracts/family-api.md` is listed in a separate table from the routes that
 * are not: a route carrying a `:familyId` that does not pass this guard is a
 * defect, not a shortcut.
 *
 * **404, never 403.** A 403 confirms the family exists, which is an
 * enumeration oracle — Principle V says so directly, and FR-021 makes it a
 * requirement of this feature. The audit log records the real reason, which is
 * the whole point of auditing a denial: the caller is told nothing, and we
 * still know.
 */
@Injectable()
export class FamilyMembershipGuard implements CanActivate {
  private readonly logger = new Logger(FamilyMembershipGuard.name);

  constructor(
    @Inject(FAMILY_UNIT_OF_WORK) private readonly unitOfWork: family.FamilyUnitOfWorkPort,
    @Inject(AUDIT_LOG) private readonly auditLog: compliance.AuditLogPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithFamilyContext>();
    const correlationId = request.correlationId ?? randomUUID();
    request.correlationId = correlationId;

    const identity = request.identityContext;
    if (identity === undefined) {
      // Unreachable in a correctly wired module: SessionGuard runs first. If
      // it ever happens, the family guard must not be the thing that decides
      // an unauthenticated request is fine.
      throw new NotFoundException({ type: 'family/not_found' });
    }

    const rawFamilyId = request.params?.familyId;
    if (rawFamilyId === undefined || rawFamilyId === '') {
      throw new NotFoundException({ type: 'family/not_found' });
    }
    const familyId = asFamilyId(rawFamilyId);

    // `family_context_resolve_duration` (contracts/family-api.md's
    // observability signals) — this platform has no metrics pipeline yet
    // (identity's own tasks.md T059 note records the same accepted gap), so
    // a structured log line carrying the duration is what this signal means
    // until one exists.
    const startedAt = performance.now();
    const resolved = await family.resolveFamilyContext(
      { userId: identity.userId, familyId },
      { unitOfWork: this.unitOfWork },
    );
    const durationMs = performance.now() - startedAt;
    this.logger.log(
      `family_context_resolve_duration_ms=${durationMs.toFixed(1)} [correlationId=${correlationId}]`,
    );

    if (resolved === null) {
      await this.auditLog.append({
        actorUserId: identity.userId,
        // Null precisely because there is no membership — the absence is the
        // finding, not missing data.
        actorMemberId: null,
        familyId,
        subjectType: 'family',
        subjectId: familyId,
        action: 'access.denied',
        purpose: 'family-scoped request',
        result: 'denied',
        // The real reason, which the caller is deliberately not told. It
        // collapses four cases on the wire (FR-021) and only one of them is a
        // security signal, so the distinction has to live somewhere.
        reason: 'no active standing in the family, or the family does not exist',
        correlationId,
      });

      this.logger.warn(
        `Family access denied for user ${identity.userId} on family ${familyId} [correlationId=${correlationId}]`,
      );
      throw new NotFoundException({ type: 'family/not_found' });
    }

    request.familyContext = { ...resolved, familyId };
    return true;
  }
}
