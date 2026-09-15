import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { compliance, family } from '@fp/core';
import { AUDIT_LOG } from './family.tokens.js';
import { problemNamespaceOf } from './problem-namespace.js';
import type { RequestWithFamilyContext } from './family-membership.guard.js';

export const REQUIRED_CAPABILITY = 'family:requiredCapability';

/**
 * Declares what a route needs. The argument is a `Capability`, not a role, and
 * the type is what enforces FR-015 at the call site: there is no way to write
 * `@RequiresCapability('owner')` because `'owner'` is not a capability.
 */
export const RequiresCapability = (capability: family.Capability) =>
  SetMetadata(REQUIRED_CAPABILITY, capability);

/**
 * ARCHITECTURE.md §9 layer 3. Runs after `FamilyMembershipGuard`, so by the
 * time it executes the caller is known to be a member of this family.
 *
 * **403 here, unlike layer 2's 404, and the difference is deliberate.** The
 * caller is a member: they already know the family exists, so withholding that
 * buys nothing. What a 404 would cost is clarity — a member who genuinely
 * lacks a capability deserves to be told so rather than left thinking the
 * resource vanished. The non-disclosure rule exists to stop enumeration
 * ACROSS families, and layer 2 has already enforced it unconditionally.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  private readonly logger = new Logger(CapabilityGuard.name);

  constructor(
    // Explicit `@Inject(Reflector)`, not the bare-type inference NestJS
    // normally allows for a concrete class: this codebase's dev server runs
    // under `tsx` (esbuild), which does not reliably emit the
    // `design:paramtypes` metadata that bare-type injection depends on —
    // confirmed by a real boot failure under `docker compose up`, invisible
    // to `vitest`'s own transform. Every other injectable here already uses
    // an explicit token for exactly this reason; this was the one exception.
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUDIT_LOG) private readonly auditLog: compliance.AuditLogPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<family.Capability | undefined>(
      REQUIRED_CAPABILITY,
      [context.getHandler(), context.getClass()],
    );
    // A route that declares nothing needs nothing beyond membership. That is a
    // deliberate default rather than an oversight: `GET /v1/families/:id`
    // requires `family:read`, which every role holds, so making the decorator
    // mandatory would add ceremony without adding a decision.
    if (required === undefined) return true;

    const namespace = problemNamespaceOf(this.reflector, context);
    const request = context.switchToHttp().getRequest<RequestWithFamilyContext>();
    const familyContext = request.familyContext;
    if (familyContext === undefined) {
      // Unreachable when the module is wired correctly, and a hard failure
      // rather than a silent allow: a capability check with nothing to check
      // against must never read as a pass.
      throw new ForbiddenException({ type: `${namespace}/capability_required` });
    }

    if (familyContext.capabilities.includes(required)) return true;

    const correlationId = request.correlationId ?? randomUUID();
    await this.auditLog.append({
      actorUserId: request.identityContext?.userId ?? null,
      actorMemberId: familyContext.memberId,
      familyId: familyContext.familyId,
      subjectType: 'family',
      subjectId: familyContext.familyId,
      action: 'access.denied',
      purpose: `capability ${required}`,
      result: 'denied',
      reason: `member holds ${String(familyContext.capabilities.length)} capabilities, not including ${required}`,
      correlationId,
    });

    this.logger.warn(
      `Capability ${required} denied for member ${familyContext.memberId} [correlationId=${correlationId}]`,
    );
    // Names the capability, never the caller's role — a client that branches
    // on the response branches on capabilities too (FR-015).
    throw new ForbiddenException({
      type: `${namespace}/capability_required`,
      capability: required,
    });
  }
}
