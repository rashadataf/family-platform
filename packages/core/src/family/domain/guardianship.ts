import {
  err,
  ok,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type GuardianshipId,
  type Result,
} from '@fp/kernel';
import { isEligibleGuardian, type MemberKind, type MemberRole } from './capabilities.js';

export interface GuardianshipProps {
  id: GuardianshipId;
  familyId: FamilyId;
  guardianMemberId: FamilyMemberId;
  childMemberId: FamilyMemberId;
  establishedAt: Date;
  endedAt: Date | null;
}

/**
 * FR-004: an explicit relationship between an eligible member and a child
 * member — never inferred from general family membership, and never a side
 * effect of anything but the two actions that create one (adding a child,
 * FR-005; granting guardianship of an existing child, also FR-005).
 */
export class Guardianship {
  private constructor(private props: GuardianshipProps) {}

  /**
   * FR-006: eligibility is checked here, at the moment a relationship is
   * created — not re-checked on every read. A guardian later demoted to a
   * role that would no longer qualify keeps an existing guardianship (FR-008
   * only blocks the demotion itself unless a replacement is assigned); this
   * constructor is the one gate on NEW relationships.
   */
  static establish(params: {
    id: GuardianshipId;
    familyId: FamilyId;
    guardianMemberId: FamilyMemberId;
    guardianKind: MemberKind;
    guardianRole: MemberRole;
    childMemberId: FamilyMemberId;
    childKind: MemberKind;
    now: Date;
  }): Result<Guardianship, DomainError> {
    if (params.childKind !== 'child') {
      return err({
        kind: 'GuardianIneligible',
        reason: 'Guardianship only applies to a member marked as a child.',
      });
    }
    if (!isEligibleGuardian(params.guardianKind, params.guardianRole)) {
      return err({
        kind: 'GuardianIneligible',
        reason: 'Only an adult member holding the owner or adult role may be a guardian (FR-006).',
      });
    }

    return ok(
      new Guardianship({
        id: params.id,
        familyId: params.familyId,
        guardianMemberId: params.guardianMemberId,
        childMemberId: params.childMemberId,
        establishedAt: params.now,
        endedAt: null,
      }),
    );
  }

  static reconstitute(props: GuardianshipProps): Guardianship {
    return new Guardianship(props);
  }

  get id(): GuardianshipId {
    return this.props.id;
  }

  get familyId(): FamilyId {
    return this.props.familyId;
  }

  get guardianMemberId(): FamilyMemberId {
    return this.props.guardianMemberId;
  }

  get childMemberId(): FamilyMemberId {
    return this.props.childMemberId;
  }

  get establishedAt(): Date {
    return this.props.establishedAt;
  }

  get endedAt(): Date | null {
    return this.props.endedAt;
  }

  get isActive(): boolean {
    return this.props.endedAt === null;
  }

  end(now: Date): void {
    this.props = { ...this.props, endedAt: now };
  }
}

/**
 * FR-008, shared by the three mutating paths that could leave a child with
 * zero active guardians: ending a guardianship, removing a guardian's family
 * membership, and changing a guardian's role away from an eligible one.
 *
 * Takes the count that would hold AFTER the action applies — including any
 * replacement guardian assigned in the same action, excluding the one being
 * removed or demoted — so all three callers share one judgment rather than
 * three copies of "less than one is not allowed."
 */
export function assertGuardianCoverage(
  activeGuardianCountAfterAction: number,
): Result<void, DomainError> {
  if (activeGuardianCountAfterAction < 1) {
    return err({ kind: 'LastGuardian' });
  }
  return ok(undefined);
}
