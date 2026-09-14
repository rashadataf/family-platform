import { asFamilyId, asFamilyMemberId, asUserId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import { emptyFamilyState, fakeFamilyUnitOfWork } from '../family-unit-of-work.fake.js';
import { createFamily } from './create-family.command.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const ownerMemberId = asFamilyMemberId('22222222-2222-7222-8222-222222222222');
const ownerUserId = asUserId('33333333-3333-7333-8333-333333333333');
const clock = { now: () => new Date('2026-09-13T10:00:00Z') };

describe('createFamily', () => {
  it('writes the family, its owner, and both events inside one withFamilyContext transaction (US1, FR-001)', async () => {
    const state = emptyFamilyState();

    const result = await createFamily(
      {
        familyId,
        ownerMemberId,
        ownerUserId,
        ownerDisplayName: 'Ada',
        name: 'Lovelace',
        correlationId: 'correlation-1',
      },
      { unitOfWork: fakeFamilyUnitOfWork(state), clock },
    );

    expect(result.ok).toBe(true);
    // Everything landed through the one `withFamilyContext` call scoped to the
    // family being created — the doc comment on `createFamily` calls this out
    // as the floor half of SC-007 ("exactly one owner at every point in
    // time"): a family and its owner either commit together or not at all.
    expect(state.scopedTo).toEqual([familyId]);
    expect(state.savedFamilies).toHaveLength(1);
    expect(state.savedMembers).toHaveLength(1);
    expect(state.savedMembers[0]?.role).toBe('owner');

    const eventTypes = state.events.map((event) => event.eventType);
    expect(eventTypes).toContain('family.FamilyCreated.v1');
    expect(eventTypes).toContain('family.MemberAdded.v1');
  });

  it('validates both aggregates before opening a transaction, so a rejected name never scopes one', async () => {
    const state = emptyFamilyState();

    const result = await createFamily(
      {
        familyId,
        ownerMemberId,
        ownerUserId,
        ownerDisplayName: 'Ada',
        name: '   ',
        correlationId: 'correlation-1',
      },
      { unitOfWork: fakeFamilyUnitOfWork(state), clock },
    );

    expect(result.ok).toBe(false);
    expect(state.scopedTo).toEqual([]);
    expect(state.events).toEqual([]);
  });
});
