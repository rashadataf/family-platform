-- Principle XI, ARCHITECTURE.md §5.12: `eraseForMember(memberId)` takes only
-- a member id, with no `:familyId` to scope a transaction to before the
-- lookup that discovers one — the same shape of problem
-- `20260913190000_invitation_sweep_policy` already solved for the expiry
-- sweep, solved the same way here.
--
-- `app.is_erasure` is a gate nothing else ever sets, so this widens nothing
-- for an ordinary family-scoped request: SELECT only, and only enough to
-- read `family_id` off the one row being erased — the write that follows
-- goes through the ordinary `family_member_isolation` policy once
-- `app.family_id` is set to that discovered value.
CREATE POLICY family_member_erasure_select ON "family_member"
  FOR SELECT
  USING (current_setting('app.is_erasure', true) = 'true');
