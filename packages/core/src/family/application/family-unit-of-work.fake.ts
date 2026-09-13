import type { FamilyId, FamilyMemberId, OutboxEventToAppend } from '@fp/kernel';
import type { AuditEntry } from '../../compliance/domain/audit-entry.js';
import type { Family } from '../domain/family.aggregate.js';
import type { FamilyMember } from '../domain/family-member.aggregate.js';
import type { MemberStanding } from './ports/family-member.repository.js';
import type { FamilyUnitOfWork, FamilyUnitOfWorkPort } from './ports/family-unit-of-work.port.js';

/**
 * An in-memory `FamilyUnitOfWork` for unit tests of command and query
 * handlers.
 *
 * It exists so that adding a method to a repository port does not mean editing
 * a hand-rolled double in every spec that ever touched one — the compiler
 * points at this file instead of at a dozen. Handler tests then assert
 * behaviour rather than restating plumbing.
 *
 * What it deliberately does NOT model is the row-level security that makes the
 * real thing safe. Nothing here is filtered by family, because faking the
 * filtering would let a test prove isolation that only the fake provides.
 * Isolation is asserted against a real database, in
 * `family-context.integration.spec.ts`, and nowhere else.
 */
export interface FakeFamilyState {
  family: Family | null;
  standing: MemberStanding | null;
  members: FamilyMember[];
  savedFamilies: Family[];
  savedMembers: FamilyMember[];
  events: OutboxEventToAppend[];
  auditEntries: AuditEntry[];
  scopedTo: FamilyId[];
}

export function emptyFamilyState(overrides: Partial<FakeFamilyState> = {}): FakeFamilyState {
  return {
    family: null,
    standing: null,
    members: [],
    savedFamilies: [],
    savedMembers: [],
    events: [],
    auditEntries: [],
    scopedTo: [],
    ...overrides,
  };
}

export function fakeFamilyUnitOfWork(state: FakeFamilyState): FamilyUnitOfWorkPort {
  return {
    withFamilyContext: <T>(familyId: FamilyId, work: (uow: FamilyUnitOfWork) => Promise<T>) => {
      state.scopedTo.push(familyId);

      const uow: FamilyUnitOfWork = {
        familyId,
        families: {
          save: (aggregate: Family) => {
            state.savedFamilies.push(aggregate);
            return Promise.resolve();
          },
          findCurrent: () => Promise.resolve(state.family),
        },
        members: {
          save: (member: FamilyMember) => {
            state.savedMembers.push(member);
            return Promise.resolve();
          },
          listActive: () => Promise.resolve(state.members.filter((m) => m.isActive)),
          findById: (memberId: FamilyMemberId) =>
            Promise.resolve(state.members.find((m) => m.id === memberId) ?? null),
          // The fake models no per-user lookup: a handler test that needs a
          // different standing sets a different `state.standing`.
          findStandingByUserId: () => Promise.resolve(state.standing),
        },
        outbox: {
          append: (event: OutboxEventToAppend) => {
            state.events.push(event);
            return Promise.resolve();
          },
        },
        audit: {
          append: (entry: AuditEntry) => {
            state.auditEntries.push(entry);
            return Promise.resolve();
          },
        },
      };

      return work(uow);
    },
  };
}
