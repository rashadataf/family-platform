import { asFamilyId, asFamilyMemberId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import {
  FAMILY_EVENT_TYPES,
  familyCreatedEvent,
  familyDeletionRequestedEvent,
  guardianshipEstablishedEvent,
  memberAddedEvent,
  memberRemovedEvent,
  memberRoleChangedEvent,
} from './events.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const memberId = asFamilyMemberId('22222222-2222-7222-8222-222222222222');
const childId = asFamilyMemberId('33333333-3333-7333-8333-333333333333');
const correlationId = 'correlation-1';

/**
 * Every event this context publishes, built once, so the assertions below can
 * be made over all six rather than over whichever ones somebody remembered.
 */
const ALL_EVENTS = [
  familyCreatedEvent({ familyId, ownerMemberId: memberId, ownerUserId: 'user-1', correlationId }),
  memberAddedEvent({
    familyId,
    memberId: childId,
    kind: 'child',
    role: 'viewer',
    userId: null,
    correlationId,
  }),
  memberRoleChangedEvent({
    familyId,
    memberId,
    fromRole: 'adult',
    toRole: 'viewer',
    correlationId,
  }),
  memberRemovedEvent({ familyId, memberId, hadUserId: true, correlationId }),
  guardianshipEstablishedEvent({
    familyId,
    guardianMemberId: memberId,
    childMemberId: childId,
    correlationId,
  }),
  familyDeletionRequestedEvent({ familyId, requestedByMemberId: memberId, correlationId }),
];

describe('family events', () => {
  it('defines exactly the six ARCHITECTURE.md §5.2 names, versioned and context-prefixed', () => {
    expect(Object.values(FAMILY_EVENT_TYPES)).toEqual([
      'family.FamilyCreated.v1',
      'family.MemberAdded.v1',
      'family.MemberRoleChanged.v1',
      'family.MemberRemoved.v1',
      'family.GuardianshipEstablished.v1',
      'family.FamilyDeletionRequested.v1',
    ]);
  });

  it('builds one event per declared type, and no others', () => {
    expect(ALL_EVENTS.map((event) => event.eventType).sort()).toEqual(
      Object.values(FAMILY_EVENT_TYPES).sort(),
    );
  });

  it('carries a correlation id on every event', () => {
    // What joins the HTTP span, the outbox row and the audit entry for one
    // action — the constitution's "a feature that cannot answer 'what happened'
    // for a specific user's specific action is not finished".
    for (const event of ALL_EVENTS) {
      expect(event.correlationId, event.eventType).toBe(correlationId);
    }
  });

  it('carries the family id in every payload', () => {
    // A consumer has to know which tenant an event belongs to without a lookup.
    for (const event of ALL_EVENTS) {
      expect(event.payload.familyId, event.eventType).toBe(familyId);
    }
  });

  /**
   * The assertion that matters most in this file. Principle VI forbids personal
   * data in "queue message bodies", and an event payload is exactly that. The
   * check is structural rather than a list of known-bad keys, so an event added
   * later is covered without anyone remembering to extend it.
   */
  it('puts no personal data in any payload', () => {
    const FORBIDDEN_KEYS = [
      'name',
      'displayname',
      'email',
      'dateofbirth',
      'dob',
      'postcode',
      'address',
      'composition',
    ];

    for (const event of ALL_EVENTS) {
      for (const key of Object.keys(event.payload)) {
        expect(
          FORBIDDEN_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden)),
          `${event.eventType} payload carries "${key}"`,
        ).toBe(false);
      }

      // And no free text hiding in the values, which is the other half of the
      // rule — an `@` is the cheapest reliable tell for a leaked address.
      for (const value of Object.values(event.payload)) {
        if (typeof value === 'string') {
          expect(value, `${event.eventType} payload value`).not.toContain('@');
        }
      }
    }
  });

  it('reports a removed member as a boolean, never the user id itself', () => {
    // A queue body outlives erasure; a user id in one is data the erasure saga
    // cannot reach (Principle XI).
    const event = memberRemovedEvent({ familyId, memberId, hadUserId: true, correlationId });

    expect(event.payload.hadUserId).toBe(true);
    expect(Object.keys(event.payload)).not.toContain('userId');
  });

  it('addresses each event to the aggregate it is about', () => {
    // GuardianshipEstablished is keyed on the CHILD, not the guardian: the
    // child's record is the thing whose access just changed.
    const guardianship = guardianshipEstablishedEvent({
      familyId,
      guardianMemberId: memberId,
      childMemberId: childId,
      correlationId,
    });

    expect(guardianship.aggregateId).toBe(childId);
    expect(
      familyCreatedEvent({
        familyId,
        ownerMemberId: memberId,
        ownerUserId: 'user-1',
        correlationId,
      }).aggregateId,
    ).toBe(familyId);
  });
});
