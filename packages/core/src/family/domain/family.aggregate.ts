import { err, ok, type DomainError, type FamilyId, type Result } from '@fp/kernel';
import { HouseholdProfile } from './household-profile.vo.js';

/** FR-001. Long enough for a real household name, short enough to render in a list. */
const NAME_MAX_LENGTH = 120;

export interface FamilyProps {
  id: FamilyId;
  name: string;
  profile: HouseholdProfile;
  createdAt: Date;
  updatedAt: Date;
  deletionRequestedAt: Date | null;
}

/**
 * The tenant root (ARCHITECTURE.md §5.2). Everything the platform will ever
 * hold is scoped to one of these.
 *
 * It holds no reference to its owner. Exactly-one-owner (SC-007) is a property
 * of the member set, guaranteed by the `family_one_owner` partial unique index
 * — an `ownerMemberId` field here would be a second source of truth for a fact
 * the database already enforces, and the two would eventually disagree.
 */
export class Family {
  private constructor(private props: FamilyProps) {}

  static create(params: {
    id: FamilyId;
    name: string;
    profile?: HouseholdProfile;
    now: Date;
  }): Result<Family, DomainError> {
    const name = params.name.trim();

    if (name === '') {
      return err({
        kind: 'NameRequired',
        // US1 Scenario 3 asks for "a specific, actionable reason", so the
        // message says what to do rather than what went wrong.
        reason: 'A family needs a name. It is what everyone in it will see at the top of the app.',
      });
    }
    if (name.length > NAME_MAX_LENGTH) {
      return err({
        kind: 'NameRequired',
        reason: `A family name can be at most ${String(NAME_MAX_LENGTH)} characters; this one is ${String(name.length)}.`,
      });
    }

    return ok(
      new Family({
        id: params.id,
        name,
        profile: params.profile ?? HouseholdProfile.empty,
        createdAt: params.now,
        updatedAt: params.now,
        deletionRequestedAt: null,
      }),
    );
  }

  /** Rebuilds from persisted state. No invariant re-checking — persistence already enforced it. */
  static reconstitute(props: FamilyProps): Family {
    return new Family(props);
  }

  get id(): FamilyId {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get profile(): HouseholdProfile {
    return this.props.profile;
  }

  get deletionRequestedAt(): Date | null {
    return this.props.deletionRequestedAt;
  }

  /** FR-002: the profile is an attribute of the family, editable without touching any member. */
  rename(name: string, now: Date): Result<Family, DomainError> {
    const created = Family.create({ id: this.props.id, name, now });
    if (!created.ok) return created;

    this.props = { ...this.props, name: created.value.name, updatedAt: now };
    return ok(this);
  }

  updateProfile(profile: HouseholdProfile, now: Date): void {
    this.props = { ...this.props, profile, updatedAt: now };
  }
}
