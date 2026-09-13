import {
  err,
  ok,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
  type UserId,
} from '@fp/kernel';
import type { MemberKind, MemberRole } from './capabilities.js';

export interface FamilyMemberProps {
  id: FamilyMemberId;
  familyId: FamilyId;
  kind: MemberKind;
  role: MemberRole;
  userId: UserId | null;
  displayName: string | null;
  dateOfBirth: Date | null;
  createdAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
}

/**
 * A person the family tracks — **not** a `User`. The most important modelling
 * decision in the system (ARCHITECTURE.md §5.2).
 *
 * `kind` and `role` are separate discriminants and mean different things:
 * `kind` decides whether this record is a protected child record, `role`
 * decides the capability set. A child is not a fifth role, because a role
 * answers "what may this person do" and a child has no login path through
 * which to do anything — §9 words it as a member "marked as" a child.
 *
 * Every invariant below is ALSO a CHECK constraint in the migration. That is
 * not belt-and-braces: the domain cannot see a raw query, and FR-003 ("no
 * UserId, no credentials, no login path") is a privacy requirement rather than
 * an implementation detail.
 */
export class FamilyMember {
  private constructor(private props: FamilyMemberProps) {}

  /** The owner, created in the same action as the family itself (FR-001). */
  static createOwner(params: {
    id: FamilyMemberId;
    familyId: FamilyId;
    userId: UserId;
    displayName: string;
    now: Date;
  }): Result<FamilyMember, DomainError> {
    const displayName = params.displayName.trim();
    if (displayName === '') {
      return err({ kind: 'NameRequired', reason: 'A member needs a name to be recognised by.' });
    }

    return ok(
      new FamilyMember({
        id: params.id,
        familyId: params.familyId,
        kind: 'adult',
        role: 'owner',
        userId: params.userId,
        displayName,
        dateOfBirth: null,
        createdAt: params.now,
        updatedAt: params.now,
        removedAt: null,
      }),
    );
  }

  /**
   * A child (FR-003) or an extended member (FR-014) — someone added directly,
   * with no invitation and no account.
   *
   * There is no `userId` parameter, and that is the enforcement. A caller
   * cannot accidentally link an account to a child here, because there is
   * nothing to pass.
   */
  static createUnlinked(params: {
    id: FamilyMemberId;
    familyId: FamilyId;
    kind: MemberKind;
    displayName: string;
    dateOfBirth?: Date | null;
    now: Date;
  }): Result<FamilyMember, DomainError> {
    const displayName = params.displayName.trim();
    if (displayName === '') {
      return err({ kind: 'NameRequired', reason: 'A member needs a name to be recognised by.' });
    }

    return ok(
      new FamilyMember({
        id: params.id,
        familyId: params.familyId,
        kind: params.kind,
        // A child's role is never resolved — resolution needs a linked user,
        // and a child has none. `viewer` is held because the column is total
        // and least privilege is the right value to carry if a future
        // `linkUserToMember` ever promotes the record.
        role: params.kind === 'child' ? 'viewer' : 'extended',
        userId: null,
        displayName,
        dateOfBirth: params.dateOfBirth ?? null,
        createdAt: params.now,
        updatedAt: params.now,
        removedAt: null,
      }),
    );
  }

  /** An adult joining by invitation: the only path that links an account (FR-011). */
  static createFromInvitation(params: {
    id: FamilyMemberId;
    familyId: FamilyId;
    userId: UserId;
    role: MemberRole;
    displayName: string;
    now: Date;
  }): Result<FamilyMember, DomainError> {
    if (params.role === 'owner') {
      return err({
        kind: 'OwnerIneligible',
        reason: 'Ownership is transferred to an existing member, never granted by invitation.',
      });
    }

    const displayName = params.displayName.trim();
    if (displayName === '') {
      return err({ kind: 'NameRequired', reason: 'A member needs a name to be recognised by.' });
    }

    return ok(
      new FamilyMember({
        id: params.id,
        familyId: params.familyId,
        kind: 'adult',
        role: params.role,
        userId: params.userId,
        displayName,
        dateOfBirth: null,
        createdAt: params.now,
        updatedAt: params.now,
        removedAt: null,
      }),
    );
  }

  static reconstitute(props: FamilyMemberProps): FamilyMember {
    return new FamilyMember(props);
  }

  get id(): FamilyMemberId {
    return this.props.id;
  }

  get familyId(): FamilyId {
    return this.props.familyId;
  }

  get kind(): MemberKind {
    return this.props.kind;
  }

  get role(): MemberRole {
    return this.props.role;
  }

  get userId(): UserId | null {
    return this.props.userId;
  }

  get displayName(): string | null {
    return this.props.displayName;
  }

  get dateOfBirth(): Date | null {
    return this.props.dateOfBirth;
  }

  get removedAt(): Date | null {
    return this.props.removedAt;
  }

  get isChild(): boolean {
    return this.props.kind === 'child';
  }

  get isActive(): boolean {
    return this.props.removedAt === null;
  }

  /**
   * FR-016. Refuses the two transitions that would break a database
   * constraint, so the caller gets a typed domain error rather than a
   * constraint violation surfacing as a 500.
   */
  changeRole(role: MemberRole, now: Date): Result<FamilyMember, DomainError> {
    if (this.props.kind === 'child') {
      return err({
        kind: 'GuardianIneligible',
        reason: 'A child holds no capabilities, so there is no role to change.',
      });
    }
    if (role === 'owner') {
      return err({
        kind: 'OwnerRequired',
        reason: 'Ownership moves by transfer, so that a family never briefly has two owners.',
      });
    }
    if (this.props.role === 'owner') {
      return err({ kind: 'OwnerRequired' });
    }

    this.props = { ...this.props, role, updatedAt: now };
    return ok(this);
  }

  /**
   * FR-017 and Principle XI. A tombstone, not a delete: the personal fields go
   * and the row stays, so authorship references held by contexts that do not
   * exist yet have something to point at. `removedAt` is what makes the
   * `family_member_live_has_name` CHECK tolerate the null name.
   */
  remove(now: Date): void {
    this.props = {
      ...this.props,
      displayName: null,
      dateOfBirth: null,
      userId: null,
      removedAt: now,
      updatedAt: now,
    };
  }
}
