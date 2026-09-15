import { asFamilyMemberId } from '@fp/kernel';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EventParticipant } from './event-participant.js';

/**
 * data-model.md's design point, enforced as a test rather than left as prose:
 * a participant is a member id and a timestamp, and Calendar knows nothing
 * else about the person — in particular not whether they are a child
 * (research.md §1). A field added here later fails this first.
 */
describe('EventParticipant (FR-015, research.md §1)', () => {
  it('has exactly two fields: a member id and when they were added', () => {
    expectTypeOf<keyof EventParticipant>().toEqualTypeOf<'memberId' | 'addedAt'>();

    const participant: EventParticipant = {
      memberId: asFamilyMemberId('22222222-2222-7222-8222-222222222222'),
      addedAt: new Date('2026-09-15T10:00:00Z'),
    };
    expect(Object.keys(participant).sort()).toEqual(['addedAt', 'memberId']);
  });

  it('carries no kind, date of birth, guardian or name', () => {
    type Keys = keyof EventParticipant;
    expectTypeOf<
      Extract<Keys, 'kind' | 'dateOfBirth' | 'guardianId' | 'displayName' | 'userId'>
    >().toEqualTypeOf<never>();
  });
});
