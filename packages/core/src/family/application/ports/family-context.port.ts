import type { FamilyId, FamilyMemberId, UserId } from '@fp/kernel';
import type { Capability, MemberRole } from '../../domain/capabilities.js';

/**
 * THE open host service (ARCHITECTURE.md §5.2, FR-019, FR-020).
 *
 * This file is the entirety of what any other bounded context may import from
 * `core/family`. Calendar, Tasks, Documents, Reminders and the AI subsystem
 * will each depend on this interface and on nothing else here — §7.1 permits
 * exactly that and forbids reaching for a repository, a Prisma model or a
 * domain type. `no-cross-context-internals` in `.dependency-cruiser.cjs`
 * enforces it, and it is in force now, before there is a consumer to catch.
 *
 * `FamilyContext` is therefore this context's **published language**. It is a
 * plain DTO by design: no `FamilyMember`, no aggregate, nothing whose shape
 * this context might want to change without warning everyone downstream.
 */
export interface FamilyContext {
  readonly memberId: FamilyMemberId;
  /**
   * Present because a member's own role is worth showing them. It is NOT for
   * branching on: FR-015 requires authorization to check capabilities, so that
   * adding a role later never means editing scattered authorization logic.
   */
  readonly role: MemberRole;
  readonly capabilities: readonly Capability[];
}

export interface FamilyContextPort {
  /**
   * Resolves a user's standing in one family, or nothing at all.
   *
   * `null` covers four different situations — no membership, a removed
   * membership, a family pending deletion, and a family that does not exist —
   * and collapsing them is deliberate. FR-021 requires a caller with no
   * standing to be unable to tell "not yours" from "not there", because a
   * distinguishable response is an enumeration oracle. The audit log records
   * which of the four it really was.
   */
  resolve(userId: UserId, familyId: FamilyId): Promise<FamilyContext | null>;
}
