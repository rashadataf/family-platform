-- ---------------------------------------------------------------------------
-- Two lookups in this feature genuinely cannot be scoped to a family, and both
-- get a narrow policy of their own rather than an exemption from ADR-017.
--
-- The alternative in each case would have been to run the query as a role that
-- bypasses row-level security, which is how a defence-in-depth story quietly
-- becomes a single point of failure: one bypass path, used by two callers
-- today and by whoever finds it convenient tomorrow.
--
-- PostgreSQL OR's multiple permissive policies together, so each of these
-- WIDENS visibility by exactly the rows its own condition describes and
-- changes nothing else. The family-scoped policies from
-- 20260913152610_family_and_membership still apply on their own terms.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. "Which families am I in?" (`GET /v1/families`, FR-024)
--
-- A user may be a member of several families, so this question spans the
-- tenant boundary by definition and there is no single `app.family_id` that
-- could answer it. What bounds it instead is the user: a caller may see THEIR
-- OWN member rows, and nothing else, in any family.
--
-- `app.user_id` is set from the authenticated session — never from a path
-- parameter, a body, or anything else the caller supplies — so this cannot be
-- turned into a way to read someone else's memberships.
-- ---------------------------------------------------------------------------
CREATE POLICY family_member_self ON "family_member"
  FOR SELECT
  USING ("user_id" = current_setting('app.user_id', true));

-- The family rows behind those memberships: name and profile, for the list.
-- The subquery is itself subject to `family_member`'s policies, so it can only
-- match rows the policy above already permits — the visibility rule is stated
-- once and this reuses it rather than restating it.
CREATE POLICY family_of_member ON "family"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "family_member" m
      WHERE m."family_id" = "family"."id"
        AND m."user_id" = current_setting('app.user_id', true)
        AND m."removed_at" IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Accepting an invitation (`POST /v1/invitations/accept`, FR-011)
--
-- The accepting user is, by definition, not yet a member, so they cannot pass
-- the membership guard for that family and no `app.family_id` can be derived
-- from their standing. The token is the evidence, and it is the only evidence
-- there is.
--
-- So the scope key here is the token hash: a caller may see exactly the one
-- invitation whose hash they already hold. Enumeration is impossible for the
-- same reason guessing the token is — the visibility condition IS the secret.
--
-- SELECT only. Accepting an invitation writes a member row, and that write
-- happens in a second, family-scoped transaction once the invitation has told
-- us which family it belongs to.
-- ---------------------------------------------------------------------------
CREATE POLICY invitation_by_token ON "invitation"
  FOR SELECT
  USING ("token_hash" = decode(current_setting('app.invitation_token_hash', true), 'hex'));
