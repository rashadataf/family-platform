import type { Invitation } from '../../domain/invitation.aggregate.js';

/**
 * The second and last unscoped read in this feature (alongside standing
 * resolution's own reasoning in `resolve-family-context.query.ts`) —
 * `data-model.md`'s `Invitation` section explains why acceptance cannot be
 * family-scoped: the accepting caller is, by definition, not yet a member,
 * so no `app.family_id` can be derived from their standing. The token is the
 * evidence; the `invitation_by_token` row-level security policy is keyed on
 * its hash rather than on anything the caller could otherwise name.
 *
 * A narrow factory outside `withFamilyContext`, exported the same way
 * `resolve-family-context.query.ts`'s own unscoped read is — never as a
 * general-purpose repository method.
 */
export interface InvitationTokenLookupPort {
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
}
