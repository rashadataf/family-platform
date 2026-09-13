import { randomUUID } from 'node:crypto';
import { Controller, Inject, Logger, NotFoundException, Req, UseGuards } from '@nestjs/common';
import type { AppRoute, ServerInferResponses } from '@ts-rest/core';
import { TsRestHandler, tsRestHandler, type TsRestRequestShape } from '@ts-rest/nest';
import { familyContract } from '@fp/contracts';
import { family } from '@fp/core';
import { asFamilyId, asFamilyMemberId, type Clock, type IdempotencyPort } from '@fp/kernel';
import { hashIdempotentRequest, readIdempotencyKey } from '../common/idempotency.js';
import type { RequestWithIdentityContext } from '../identity/session.guard.js';
import { SessionGuard } from '../identity/session.guard.js';
import { CapabilityGuard, RequiresCapability } from './capability.guard.js';
import { FamilyMembershipGuard } from './family-membership.guard.js';
import {
  FAMILY_CLOCK,
  FAMILY_DIRECTORY,
  FAMILY_UNIT_OF_WORK,
  IDEMPOTENCY_STORE,
} from './family.tokens.js';

/** `createFamily`'s own `@Req()` needs one header `RequestWithIdentityContext` doesn't declare. */
interface RequestWithIdempotencyKey extends RequestWithIdentityContext {
  headers: RequestWithIdentityContext['headers'] & { 'idempotency-key'?: string };
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
}
