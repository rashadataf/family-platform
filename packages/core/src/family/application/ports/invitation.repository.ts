import type { InvitationId } from '@fp/kernel';
import type { Invitation } from '../../domain/invitation.aggregate.js';

/**
 * Scoped by construction (ARCHITECTURE.md §9 layer 4) — no method here takes
 * a family id. Acceptance is the one flow that cannot start from here; it
 * resolves the invitation through `InvitationTokenLookupPort` first, and only
 * reaches this repository once `withFamilyContext` has been opened for the
 * family the token named.
 */
export interface InvitationRepository {
  save(invitation: Invitation): Promise<void>;
  findById(invitationId: InvitationId): Promise<Invitation | null>;

  /** The family's own invitations, for `GET .../invitations` (most recent first). */
  listAll(): Promise<readonly Invitation[]>;

  /** FR-013: an existing PENDING invitation to this email in the scoped family, if any. */
  findPendingByEmail(email: string): Promise<Invitation | null>;
}
