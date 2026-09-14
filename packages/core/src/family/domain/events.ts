import type { FamilyId, FamilyMemberId, OutboxEventToAppend } from '@fp/kernel';
import type { MemberKind, MemberRole } from './capabilities.js';

/**
 * The six events ARCHITECTURE.md §5.2 requires this context to publish.
 *
 * All six are published even though nothing subscribes to them yet — FR-023
 * says so in as many words. They go into the outbox in the same transaction as
 * the state change that caused them (ADR-005 Layer 2); the relay to SQS is
 * Layer 3 and is still deferred, because this feature creates no consumer and
 * the constitution forbids provisioning a component before the trigger that
 * justifies it.
 *
 * PAYLOADS CARRY IDENTIFIERS ONLY. Never a name, never a date of birth, never
 * an email address. Principle VI and Principle VIII both forbid it, and an
 * invitation event is the easy place to get that wrong — which is why
 * `MemberAdded` carries a `memberId` and not the address that led to it.
 */
export const FAMILY_EVENT_TYPES = {
  FamilyCreated: 'family.FamilyCreated.v1',
  MemberAdded: 'family.MemberAdded.v1',
  MemberRoleChanged: 'family.MemberRoleChanged.v1',
  MemberRemoved: 'family.MemberRemoved.v1',
  GuardianshipEstablished: 'family.GuardianshipEstablished.v1',
  FamilyDeletionRequested: 'family.FamilyDeletionRequested.v1',
} as const;

export function familyCreatedEvent(params: {
  familyId: FamilyId;
  ownerMemberId: FamilyMemberId;
  ownerUserId: string;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: FAMILY_EVENT_TYPES.FamilyCreated,
    aggregateType: 'Family',
    aggregateId: params.familyId,
    payload: {
      familyId: params.familyId,
      ownerMemberId: params.ownerMemberId,
      ownerUserId: params.ownerUserId,
    },
    correlationId: params.correlationId,
  };
}

export function memberAddedEvent(params: {
  familyId: FamilyId;
  memberId: FamilyMemberId;
  kind: MemberKind;
  role: MemberRole;
  userId: string | null;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: FAMILY_EVENT_TYPES.MemberAdded,
    aggregateType: 'FamilyMember',
    aggregateId: params.memberId,
    payload: {
      familyId: params.familyId,
      memberId: params.memberId,
      kind: params.kind,
      role: params.role,
      userId: params.userId,
    },
    correlationId: params.correlationId,
  };
}

export function memberRoleChangedEvent(params: {
  familyId: FamilyId;
  memberId: FamilyMemberId;
  fromRole: MemberRole;
  toRole: MemberRole;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: FAMILY_EVENT_TYPES.MemberRoleChanged,
    aggregateType: 'FamilyMember',
    aggregateId: params.memberId,
    payload: {
      familyId: params.familyId,
      memberId: params.memberId,
      fromRole: params.fromRole,
      toRole: params.toRole,
    },
    correlationId: params.correlationId,
  };
}

export function memberRemovedEvent(params: {
  familyId: FamilyId;
  memberId: FamilyMemberId;
  hadUserId: boolean;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: FAMILY_EVENT_TYPES.MemberRemoved,
    aggregateType: 'FamilyMember',
    aggregateId: params.memberId,
    payload: {
      familyId: params.familyId,
      memberId: params.memberId,
      // A boolean, not the id. A consumer that needs the user id can ask
      // through a port while the tombstone exists; putting it in a queue body
      // that outlives erasure is precisely the "data the erasure saga cannot
      // reach" Principle XI forbids.
      hadUserId: params.hadUserId,
    },
    correlationId: params.correlationId,
  };
}

export function guardianshipEstablishedEvent(params: {
  familyId: FamilyId;
  guardianMemberId: FamilyMemberId;
  childMemberId: FamilyMemberId;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: FAMILY_EVENT_TYPES.GuardianshipEstablished,
    aggregateType: 'FamilyMember',
    aggregateId: params.childMemberId,
    payload: {
      familyId: params.familyId,
      guardianMemberId: params.guardianMemberId,
      childMemberId: params.childMemberId,
    },
    correlationId: params.correlationId,
  };
}

export function familyDeletionRequestedEvent(params: {
  familyId: FamilyId;
  requestedByMemberId: FamilyMemberId;
  correlationId: string;
}): OutboxEventToAppend {
  return {
    eventType: FAMILY_EVENT_TYPES.FamilyDeletionRequested,
    aggregateType: 'Family',
    aggregateId: params.familyId,
    payload: {
      familyId: params.familyId,
      requestedByMemberId: params.requestedByMemberId,
    },
    correlationId: params.correlationId,
  };
}
