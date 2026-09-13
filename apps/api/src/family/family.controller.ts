import { randomUUID } from 'node:crypto';
import { Controller, Inject, Logger, NotFoundException, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AppRoute, ServerInferResponses } from '@ts-rest/core';
import { TsRestHandler, tsRestHandler, type TsRestRequestShape } from '@ts-rest/nest';
import { familyContract } from '@fp/contracts';
import { family, identity } from '@fp/core';
import {
  asFamilyId,
  asFamilyMemberId,
  asGuardianshipId,
  asInvitationId,
  type Clock,
  type IdempotencyPort,
  type MailerPort,
  type TokenGeneratorPort,
} from '@fp/kernel';
import { hashIdempotentRequest, readIdempotencyKey } from '../common/idempotency.js';
import { IDENTITY_UNIT_OF_WORK, MAILER, TOKEN_GENERATOR } from '../identity/identity.tokens.js';
import type { RequestWithIdentityContext } from '../identity/session.guard.js';
import { SessionGuard } from '../identity/session.guard.js';
import { CapabilityGuard, RequiresCapability } from './capability.guard.js';
import { FamilyMembershipGuard, type RequestWithFamilyContext } from './family-membership.guard.js';
import { PerFamilyThrottlerGuard } from './per-family-throttler.guard.js';
import {
  FAMILY_CLOCK,
  FAMILY_DIRECTORY,
  FAMILY_INVITATION_TOKEN_LOOKUP,
  FAMILY_UNIT_OF_WORK,
  IDEMPOTENCY_STORE,
} from './family.tokens.js';

/** A handler's own `@Req()` needs one header neither base request type declares. */
interface RequestWithIdempotencyKey extends RequestWithIdentityContext {
  headers: RequestWithIdentityContext['headers'] & { 'idempotency-key'?: string };
}

interface RequestWithFamilyContextAndIdempotencyKey extends RequestWithFamilyContext {
  headers: RequestWithFamilyContext['headers'] & { 'idempotency-key'?: string };
}

/** `@db.Date` columns round-trip as `Date`; the wire only ever sees the date part. */
function toIsoDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

/**
 * See `identity.controller.ts`'s identical comment: `tsRestHandler`'s own
 * return type isn't exported by `@ts-rest/nest`, so it is spelled out here.
 */
type RouteHandler<T extends AppRoute> = (
  args: TsRestRequestShape<T>,
) => Promise<ServerInferResponses<T>>;

function toFamilyBody(aggregate: family.Family): {
  id: string;
  name: string;
  postcode: string | null;
  localAuthorityCode: string | null;
  composition: { adults: number; children: number } | null;
} {
  return {
    id: aggregate.id,
    name: aggregate.name,
    postcode: aggregate.profile.postcode,
    localAuthorityCode: aggregate.profile.localAuthorityCode,
    composition: aggregate.profile.composition,
  };
}

/**
 * Only `getFamily` and `updateFamily` carry a `:familyId` and run
 * `FamilyMembershipGuard`/`CapabilityGuard` (ARCHITECTURE.md §9 layers 2-3,
 * T044). `createFamily` and `listFamilies` do not name a family in the path —
 * the former makes one, the latter spans every family the caller belongs to
 * (FR-024) — so neither guard applies to them.
 */
@Controller()
export class FamilyController {
  private readonly logger = new Logger(FamilyController.name);

  constructor(
    @Inject(FAMILY_CLOCK) private readonly clock: Clock,
    @Inject(FAMILY_UNIT_OF_WORK) private readonly unitOfWork: family.FamilyUnitOfWorkPort,
    @Inject(FAMILY_DIRECTORY) private readonly directory: family.FamilyDirectoryPort,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyPort,
    @Inject(FAMILY_INVITATION_TOKEN_LOOKUP)
    private readonly invitationTokenLookup: family.InvitationTokenLookupPort,
    @Inject(IDENTITY_UNIT_OF_WORK)
    private readonly identityUnitOfWork: identity.IdentityUnitOfWorkPort,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(TOKEN_GENERATOR) private readonly tokenGenerator: TokenGeneratorPort,
  ) {}

  /**
   * ADR-006, Principle IX. `POST /v1/families` is the route that genuinely
   * needs this: unlike registration, nothing about creating a family is
   * naturally deduplicated — a client retrying a flaky request would
   * otherwise get a second family and a second ownership.
   *
   * Caches only the 201: a 422 creates nothing, so replaying it buys nothing
   * a fresh validation wouldn't already give for free. A key reused with a
   * genuinely different body (a client bug, not a retry) replays the
   * original response anyway rather than either erroring with a type this
   * contract doesn't declare or silently creating the second family the
   * whole mechanism exists to prevent — logged so it is visible without being
   * load-bearing on the wire.
   */
  @UseGuards(SessionGuard)
  @TsRestHandler(familyContract.createFamily)
  createFamily(
    @Req() req: RequestWithIdempotencyKey,
  ): RouteHandler<typeof familyContract.createFamily> {
    return tsRestHandler(familyContract.createFamily, async ({ body }) => {
      if (!req.identityContext) {
        throw new Error('SessionGuard did not populate identityContext.');
      }
      const userId = req.identityContext.userId;
      const idempotencyKey = readIdempotencyKey(req.headers);
      const requestHash = idempotencyKey ? hashIdempotentRequest('createFamily', body) : null;

      if (idempotencyKey !== null && requestHash !== null) {
        const existing = await this.idempotencyStore.findByKey(userId, idempotencyKey);
        if (existing !== null) {
          if (existing.requestHash !== requestHash) {
            this.logger.warn(`Idempotency-Key ${idempotencyKey} reused with a different request`);
          }
          return {
            status: existing.responseStatus,
            body: existing.responseBody,
          } as ServerInferResponses<typeof familyContract.createFamily>;
        }
      }

      const correlationId = randomUUID();

      const result = await family.createFamily(
        {
          familyId: asFamilyId(randomUUID()),
          ownerMemberId: asFamilyMemberId(randomUUID()),
          ownerUserId: userId,
          ownerDisplayName: body.ownerDisplayName,
          name: body.name,
          postcode: body.postcode,
          localAuthorityCode: body.localAuthorityCode,
          composition: body.composition,
          correlationId,
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        this.logger.log(
          `Family creation rejected: ${result.error.kind} [correlationId=${correlationId}]`,
        );
        const reason =
          result.error.kind === 'NameRequired' ? result.error.reason : 'Unexpected error.';
        return { status: 422 as const, body: { type: 'family/name_required' as const, reason } };
      }

      this.logger.log(`Created family ${result.value.familyId} [correlationId=${correlationId}]`);
      const response = {
        status: 201 as const,
        body: { familyId: result.value.familyId, ownerMemberId: result.value.ownerMemberId },
      };

      if (idempotencyKey !== null && requestHash !== null) {
        await this.idempotencyStore.save({
          userId,
          key: idempotencyKey,
          requestHash,
          responseStatus: response.status,
          responseBody: response.body,
        });
      }

      return response;
    });
  }

  @UseGuards(SessionGuard)
  @TsRestHandler(familyContract.listFamilies)
  listFamilies(
    @Req() req: RequestWithIdentityContext,
  ): RouteHandler<typeof familyContract.listFamilies> {
    return tsRestHandler(familyContract.listFamilies, async () => {
      if (!req.identityContext) {
        throw new Error('SessionGuard did not populate identityContext.');
      }

      const memberships = await family.listFamilies(
        { userId: req.identityContext.userId },
        { directory: this.directory },
      );

      return {
        status: 200 as const,
        body: memberships.map((membership) => ({
          familyId: membership.familyId,
          name: membership.name,
          role: membership.role,
          capabilities: [...membership.capabilities],
        })),
      };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('family:read')
  @TsRestHandler(familyContract.getFamily)
  getFamily(): RouteHandler<typeof familyContract.getFamily> {
    return tsRestHandler(familyContract.getFamily, async ({ params }) => {
      const aggregate = await family.getFamily(
        { familyId: asFamilyId(params.familyId) },
        { unitOfWork: this.unitOfWork },
      );

      if (aggregate === null) {
        // Unreachable when the module is wired correctly: FamilyMembershipGuard
        // has already proven this exact family readable to this exact caller,
        // inside the same row-level-security scope this lookup uses again.
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return { status: 200 as const, body: toFamilyBody(aggregate) };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('family:manage')
  @TsRestHandler(familyContract.updateFamily)
  updateFamily(): RouteHandler<typeof familyContract.updateFamily> {
    return tsRestHandler(familyContract.updateFamily, async ({ params, body }) => {
      const result = await family.updateFamily(
        {
          familyId: asFamilyId(params.familyId),
          name: body.name,
          postcode: body.postcode,
          localAuthorityCode: body.localAuthorityCode,
          composition: body.composition,
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        if (result.error.kind === 'NameRequired') {
          return {
            status: 422 as const,
            body: { type: 'family/name_required' as const, reason: result.error.reason },
          };
        }
        // `NotFound` here would mean this command's own scoped lookup
        // disagreed with the guard that already ran ahead of it — a defect
        // this request should never actually reach, not a case a client
        // needs a distinct response for.
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return { status: 200 as const, body: toFamilyBody(result.value) };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('members:read')
  @TsRestHandler(familyContract.listMembers)
  listMembers(
    @Req() req: RequestWithFamilyContext,
  ): RouteHandler<typeof familyContract.listMembers> {
    return tsRestHandler(familyContract.listMembers, async ({ params }) => {
      if (!req.familyContext) {
        throw new Error('FamilyMembershipGuard did not populate familyContext.');
      }

      const members = await family.listMembers(
        { familyId: asFamilyId(params.familyId), callerMemberId: req.familyContext.memberId },
        { unitOfWork: this.unitOfWork },
      );

      return {
        status: 200 as const,
        body: members.map((member) => ({
          id: member.id,
          kind: member.kind,
          role: member.role,
          displayName: member.displayName,
          // Spread, not a `?? null`: an absent key must stay absent on the
          // wire (contracts/family-api.md), and `dateOfBirth === undefined`
          // is exactly the guardianship gate that decided that.
          ...(member.dateOfBirth !== undefined
            ? { dateOfBirth: toIsoDate(member.dateOfBirth) }
            : {}),
        })),
      };
    });
  }

  /**
   * FR-003, FR-005, FR-014. Honours `Idempotency-Key` the same way
   * `createFamily` does (ADR-006), scoped by family as well as by caller —
   * two different families' add-member calls from the same user must never
   * collide on a key the client happened to reuse across both.
   */
  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('members:add')
  @TsRestHandler(familyContract.addMember)
  addMember(
    @Req() req: RequestWithFamilyContextAndIdempotencyKey,
  ): RouteHandler<typeof familyContract.addMember> {
    return tsRestHandler(familyContract.addMember, async ({ params, body }) => {
      if (!req.familyContext || !req.identityContext) {
        throw new Error('Guards did not populate familyContext/identityContext.');
      }
      const userId = req.identityContext.userId;
      const familyId = asFamilyId(params.familyId);
      const idempotencyKey = readIdempotencyKey(req.headers);
      const scopedKey = idempotencyKey !== null ? `${familyId}:${idempotencyKey}` : null;
      const requestHash = scopedKey !== null ? hashIdempotentRequest('addMember', body) : null;

      if (scopedKey !== null && requestHash !== null) {
        const existing = await this.idempotencyStore.findByKey(userId, scopedKey);
        if (existing !== null) {
          if (existing.requestHash !== requestHash) {
            this.logger.warn(`Idempotency-Key ${scopedKey} reused with a different request`);
          }
          return {
            status: existing.responseStatus,
            body: existing.responseBody,
          } as ServerInferResponses<typeof familyContract.addMember>;
        }
      }

      const correlationId = randomUUID();
      const result = await family.addMember(
        {
          familyId,
          memberId: asFamilyMemberId(randomUUID()),
          addedByMemberId: req.familyContext.memberId,
          // Wire 'extended' is domain kind 'adult' + role 'extended' — see
          // `AddMemberInput.kind`'s own comment.
          kind: body.kind === 'extended' ? 'adult' : 'child',
          displayName: body.displayName,
          dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
          guardianshipId: asGuardianshipId(randomUUID()),
          correlationId,
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        this.logger.log(
          `Add member rejected: ${result.error.kind} [correlationId=${correlationId}]`,
        );
        if (result.error.kind === 'NameRequired') {
          return {
            status: 422 as const,
            body: { type: 'family/name_required' as const, reason: result.error.reason },
          };
        }
        if (result.error.kind === 'GuardianIneligible') {
          return {
            status: 422 as const,
            body: { type: 'family/guardian_ineligible' as const, reason: result.error.reason },
          };
        }
        throw new NotFoundException({ type: 'family/not_found' });
      }

      const response = { status: 201 as const, body: { memberId: result.value.memberId } };

      if (scopedKey !== null && requestHash !== null) {
        await this.idempotencyStore.save({
          userId,
          key: scopedKey,
          requestHash,
          responseStatus: response.status,
          responseBody: response.body,
        });
      }

      return response;
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('members:read')
  @TsRestHandler(familyContract.readMember)
  readMember(@Req() req: RequestWithFamilyContext): RouteHandler<typeof familyContract.readMember> {
    return tsRestHandler(familyContract.readMember, async ({ params }) => {
      if (!req.familyContext) {
        throw new Error('FamilyMembershipGuard did not populate familyContext.');
      }
      const correlationId = req.correlationId ?? randomUUID();

      const result = await family.readMember(
        {
          familyId: asFamilyId(params.familyId),
          memberId: asFamilyMemberId(params.memberId),
          callerMemberId: req.familyContext.memberId,
          callerUserId: req.identityContext?.userId ?? null,
          correlationId,
        },
        { unitOfWork: this.unitOfWork },
      );

      if (!result.ok) {
        // FR-007: 403, not 404 — the roster already told the caller this
        // child exists, so pretending otherwise would be a lie that buys
        // nothing (contracts/family-api.md).
        if (result.error.kind === 'GuardianshipRequired') {
          return { status: 403 as const, body: { type: 'family/guardianship_required' as const } };
        }
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return {
        status: 200 as const,
        body: {
          id: result.value.id,
          kind: result.value.kind,
          role: result.value.role,
          displayName: result.value.displayName,
          dateOfBirth: toIsoDate(result.value.dateOfBirth),
        },
      };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('guardianship:manage')
  @TsRestHandler(familyContract.grantGuardianship)
  grantGuardianship(): RouteHandler<typeof familyContract.grantGuardianship> {
    return tsRestHandler(familyContract.grantGuardianship, async ({ params, body }) => {
      const correlationId = randomUUID();

      const result = await family.grantGuardianship(
        {
          familyId: asFamilyId(params.familyId),
          childMemberId: asFamilyMemberId(params.memberId),
          guardianMemberId: asFamilyMemberId(body.guardianMemberId),
          guardianshipId: asGuardianshipId(randomUUID()),
          correlationId,
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        if (result.error.kind === 'GuardianIneligible') {
          return {
            status: 422 as const,
            body: { type: 'family/guardian_ineligible' as const, reason: result.error.reason },
          };
        }
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return { status: 201 as const, body: { guardianshipId: result.value.guardianshipId } };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('guardianship:manage')
  @TsRestHandler(familyContract.endGuardianship)
  endGuardianship(): RouteHandler<typeof familyContract.endGuardianship> {
    return tsRestHandler(familyContract.endGuardianship, async ({ params }) => {
      const result = await family.endGuardianship(
        {
          familyId: asFamilyId(params.familyId),
          childMemberId: asFamilyMemberId(params.memberId),
          guardianMemberId: asFamilyMemberId(params.guardianMemberId),
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        if (result.error.kind === 'LastGuardian') {
          return { status: 409 as const, body: { type: 'family/last_guardian' as const } };
        }
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return { status: 200 as const, body: {} };
    });
  }

  /**
   * FR-011, FR-013. Honours `Idempotency-Key` the same way `addMember` does,
   * scoped by family (contracts/family-api.md lists this among the routes
   * that must).
   *
   * Rate-limited per family, not per source or account (contracts/family-
   * api.md's rate-limiting table): 10 invitations per family per hour, the
   * strictest limit in this feature, since sending one means an email
   * leaves the platform.
   */
  @UseGuards(SessionGuard, PerFamilyThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @RequiresCapability('members:manage')
  @TsRestHandler(familyContract.createInvitation)
  createInvitation(
    @Req() req: RequestWithFamilyContextAndIdempotencyKey,
  ): RouteHandler<typeof familyContract.createInvitation> {
    return tsRestHandler(familyContract.createInvitation, async ({ params, body }) => {
      if (!req.familyContext || !req.identityContext) {
        throw new Error('Guards did not populate familyContext/identityContext.');
      }
      const userId = req.identityContext.userId;
      const familyId = asFamilyId(params.familyId);
      const idempotencyKey = readIdempotencyKey(req.headers);
      const scopedKey = idempotencyKey !== null ? `${familyId}:${idempotencyKey}` : null;
      const requestHash =
        scopedKey !== null ? hashIdempotentRequest('createInvitation', body) : null;

      if (scopedKey !== null && requestHash !== null) {
        const existing = await this.idempotencyStore.findByKey(userId, scopedKey);
        if (existing !== null) {
          if (existing.requestHash !== requestHash) {
            this.logger.warn(`Idempotency-Key ${scopedKey} reused with a different request`);
          }
          return {
            status: existing.responseStatus,
            body: existing.responseBody,
          } as ServerInferResponses<typeof familyContract.createInvitation>;
        }
      }

      // The one cross-context read this flow needs (FR-013) — resolved here,
      // in the composition root, never inside `packages/core/family` itself.
      const existingUserId = await identity.resolveUserIdByEmail(
        { email: body.email },
        { unitOfWork: this.identityUnitOfWork },
      );

      const correlationId = randomUUID();
      const result = await family.createInvitation(
        {
          familyId,
          invitationId: asInvitationId(randomUUID()),
          invitedByMemberId: req.familyContext.memberId,
          email: body.email,
          proposedRole: body.proposedRole,
          existingUserId,
          correlationId,
        },
        {
          unitOfWork: this.unitOfWork,
          tokenGenerator: this.tokenGenerator,
          mailer: this.mailer,
          clock: this.clock,
        },
      );

      if (!result.ok) {
        this.logger.log(
          `Invitation creation rejected: ${result.error.kind} [correlationId=${correlationId}]`,
        );
        if (result.error.kind === 'AlreadyMember') {
          return { status: 409 as const, body: { type: 'family/already_member' as const } };
        }
        throw new NotFoundException({ type: 'family/not_found' });
      }

      const response = {
        status: 201 as const,
        body: { invitationId: result.value.invitationId },
      };

      if (scopedKey !== null && requestHash !== null) {
        await this.idempotencyStore.save({
          userId,
          key: scopedKey,
          requestHash,
          responseStatus: response.status,
          responseBody: response.body,
        });
      }

      return response;
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('members:manage')
  @TsRestHandler(familyContract.listInvitations)
  listInvitations(): RouteHandler<typeof familyContract.listInvitations> {
    return tsRestHandler(familyContract.listInvitations, async ({ params }) => {
      const invitations = await family.listInvitations(
        { familyId: asFamilyId(params.familyId) },
        { unitOfWork: this.unitOfWork },
      );

      return {
        status: 200 as const,
        body: invitations.map((invitation) => ({
          id: invitation.id,
          email: invitation.email,
          proposedRole: invitation.proposedRole,
          status: invitation.status,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
        })),
      };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('members:manage')
  @TsRestHandler(familyContract.revokeInvitation)
  revokeInvitation(): RouteHandler<typeof familyContract.revokeInvitation> {
    return tsRestHandler(familyContract.revokeInvitation, async ({ params }) => {
      const result = await family.revokeInvitation(
        {
          familyId: asFamilyId(params.familyId),
          invitationId: asInvitationId(params.invitationId),
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        if (result.error.kind === 'InvitationInvalid') {
          return { status: 422 as const, body: { type: 'family/invitation_invalid' as const } };
        }
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return { status: 200 as const, body: {} };
    });
  }

  /**
   * Authenticated but deliberately NOT family-scoped: the caller has no
   * standing in the family yet — that is the whole point (US3,
   * contracts/family-api.md's "Authenticated, no family context" table).
   * `SessionGuard` alone, never `FamilyMembershipGuard`/`CapabilityGuard`.
   */
  @UseGuards(SessionGuard)
  @TsRestHandler(familyContract.acceptInvitation)
  acceptInvitation(
    @Req() req: RequestWithIdentityContext,
  ): RouteHandler<typeof familyContract.acceptInvitation> {
    return tsRestHandler(familyContract.acceptInvitation, async ({ body }) => {
      if (!req.identityContext) {
        throw new Error('SessionGuard did not populate identityContext.');
      }
      const callerUserId = req.identityContext.userId;
      const callerEmail = await identity.resolveEmailByUserId(
        { userId: callerUserId },
        { unitOfWork: this.identityUnitOfWork },
      );
      if (callerEmail === null) {
        // Unreachable when the module is wired correctly: SessionGuard has
        // already proven this session belongs to a real account.
        throw new Error('Authenticated session has no resolvable account email.');
      }

      const correlationId = randomUUID();
      const result = await family.acceptInvitation(
        {
          token: body.token,
          callerUserId,
          callerEmail,
          newMemberId: asFamilyMemberId(randomUUID()),
          correlationId,
        },
        {
          tokenLookup: this.invitationTokenLookup,
          tokenGenerator: this.tokenGenerator,
          unitOfWork: this.unitOfWork,
          clock: this.clock,
        },
      );

      if (!result.ok) {
        this.logger.log(
          `Invitation acceptance rejected: ${result.error.kind} [correlationId=${correlationId}]`,
        );
        if (result.error.kind === 'InvitationEmailMismatch') {
          return {
            status: 403 as const,
            body: { type: 'family/invitation_email_mismatch' as const },
          };
        }
        return { status: 422 as const, body: { type: 'family/invitation_invalid' as const } };
      }

      return {
        status: 200 as const,
        body: { familyId: result.value.familyId, memberId: result.value.memberId },
      };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('members:manage')
  @TsRestHandler(familyContract.changeMemberRole)
  changeMemberRole(): RouteHandler<typeof familyContract.changeMemberRole> {
    return tsRestHandler(familyContract.changeMemberRole, async ({ params, body }) => {
      const correlationId = randomUUID();
      const result = await family.changeMemberRole(
        {
          familyId: asFamilyId(params.familyId),
          memberId: asFamilyMemberId(params.memberId),
          newRole: body.role,
          correlationId,
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        this.logger.log(
          `Role change rejected: ${result.error.kind} [correlationId=${correlationId}]`,
        );
        if (result.error.kind === 'LastGuardian') {
          return { status: 409 as const, body: { type: 'family/last_guardian' as const } };
        }
        if (result.error.kind === 'OwnerRequired') {
          return { status: 409 as const, body: { type: 'family/owner_required' as const } };
        }
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return { status: 200 as const, body: {} };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('members:manage')
  @TsRestHandler(familyContract.removeMember)
  removeMember(): RouteHandler<typeof familyContract.removeMember> {
    return tsRestHandler(familyContract.removeMember, async ({ params }) => {
      const correlationId = randomUUID();
      const result = await family.removeMember(
        {
          familyId: asFamilyId(params.familyId),
          memberId: asFamilyMemberId(params.memberId),
          correlationId,
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        this.logger.log(
          `Member removal rejected: ${result.error.kind} [correlationId=${correlationId}]`,
        );
        if (result.error.kind === 'LastGuardian') {
          return { status: 409 as const, body: { type: 'family/last_guardian' as const } };
        }
        if (result.error.kind === 'OwnerRequired') {
          return { status: 409 as const, body: { type: 'family/owner_required' as const } };
        }
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return { status: 200 as const, body: {} };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('members:manage')
  @TsRestHandler(familyContract.transferOwnership)
  transferOwnership(): RouteHandler<typeof familyContract.transferOwnership> {
    return tsRestHandler(familyContract.transferOwnership, async ({ params, body }) => {
      const correlationId = randomUUID();
      const result = await family.transferOwnership(
        {
          familyId: asFamilyId(params.familyId),
          toMemberId: asFamilyMemberId(body.toMemberId),
          correlationId,
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        this.logger.log(
          `Ownership transfer rejected: ${result.error.kind} [correlationId=${correlationId}]`,
        );
        if (result.error.kind === 'OwnerIneligible') {
          return {
            status: 422 as const,
            body: { type: 'family/owner_ineligible' as const, reason: result.error.reason },
          };
        }
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return { status: 200 as const, body: {} };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('family:delete')
  @TsRestHandler(familyContract.requestFamilyDeletion)
  requestFamilyDeletion(
    @Req() req: RequestWithFamilyContext,
  ): RouteHandler<typeof familyContract.requestFamilyDeletion> {
    return tsRestHandler(familyContract.requestFamilyDeletion, async ({ params }) => {
      if (!req.familyContext) {
        throw new Error('FamilyMembershipGuard did not populate familyContext.');
      }
      const result = await family.requestFamilyDeletion(
        {
          familyId: asFamilyId(params.familyId),
          requestedByMemberId: req.familyContext.memberId,
          correlationId: randomUUID(),
        },
        { unitOfWork: this.unitOfWork, clock: this.clock },
      );

      if (!result.ok) {
        throw new NotFoundException({ type: 'family/not_found' });
      }

      return { status: 202 as const, body: {} };
    });
  }
}
