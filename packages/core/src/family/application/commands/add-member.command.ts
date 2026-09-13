import {
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type GuardianshipId,
  type Result,
} from '@fp/kernel';
import type { MemberKind } from '../../domain/capabilities.js';
import { FamilyMember } from '../../domain/family-member.aggregate.js';
import { Guardianship } from '../../domain/guardianship.js';
import { guardianshipEstablishedEvent, memberAddedEvent } from '../../domain/events.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface AddMemberInput {
  familyId: FamilyId;
  memberId: FamilyMemberId;
  addedByMemberId: FamilyMemberId;
  /**
   * `FamilyMember.createUnlinked`'s own vocabulary, not the wire's: the wire's
   * `'extended'` means "an unlinked adult with role `extended`", which is
   * this `kind: 'adult'` — the controller is what translates between the two,
   * the same boundary that translates every other wire shape into a domain
   * one.
   */
  kind: MemberKind;
  displayName: string;
  dateOfBirth?: Date | null;
  /** Only used when `kind === 'child'`; harmless and unused otherwise. */
  guardianshipId: GuardianshipId;
  correlationId: string;
}

/**
 * FR-003, FR-005: a child or an extended member, added directly with no
 * invitation and no account. `kind: 'adult'` is not representable here — the
 * wire type omits it (contracts/family-api.md), and `FamilyMember.createUnlinked`
 * never accepts a `userId` to begin with.
 *
 * For a child, this is also the one action FR-005 requires: the adder becomes
 * a guardian in the SAME transaction the child record is created in, never as
 * a follow-up call. `Guardianship.establish` runs before any write — the
 * adder's own `kind`/`role` decide eligibility (FR-006), and reading their row
 * is the only I/O that happens before that decision, so a rejected
 * eligibility check leaves nothing written rather than needing a rollback.
 */
export async function addMember(
  input: AddMemberInput,
  deps: { unitOfWork: FamilyUnitOfWorkPort; clock: Clock },
): Promise<Result<{ memberId: FamilyMemberId }, DomainError>> {
  const now = deps.clock.now();

  const created = FamilyMember.createUnlinked({
    id: input.memberId,
    familyId: input.familyId,
    kind: input.kind,
    displayName: input.displayName,
    dateOfBirth: input.dateOfBirth,
    now,
  });
  if (!created.ok) return err(created.error);
  const memberAggregate = created.value;

  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const adder = await uow.members.findById(input.addedByMemberId);
    if (adder === null) return err({ kind: 'NotFound' });

    let guardianship: Guardianship | null = null;
    if (input.kind === 'child') {
      const established = Guardianship.establish({
        id: input.guardianshipId,
        familyId: input.familyId,
        guardianMemberId: adder.id,
        guardianKind: adder.kind,
        guardianRole: adder.role,
        childMemberId: input.memberId,
        childKind: memberAggregate.kind,
        now,
      });
      if (!established.ok) return err(established.error);
      guardianship = established.value;
    }

    await uow.members.save(memberAggregate);
    await uow.outbox.append(
      memberAddedEvent({
        familyId: input.familyId,
        memberId: input.memberId,
        kind: memberAggregate.kind,
        role: memberAggregate.role,
        userId: null,
        correlationId: input.correlationId,
      }),
    );

    if (guardianship !== null) {
      await uow.guardianships.save(guardianship);
      await uow.outbox.append(
        guardianshipEstablishedEvent({
          familyId: input.familyId,
          guardianMemberId: guardianship.guardianMemberId,
          childMemberId: input.memberId,
          correlationId: input.correlationId,
        }),
      );
    }

    return ok({ memberId: input.memberId });
  });
}
