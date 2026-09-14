-- SC-006, research.md §6: `guardian-coverage.sweep.ts` checks every family
-- for a child with zero active guardians, in one query — a genuinely
-- cross-family read the application role's row-level security is designed
-- to refuse, run by the SAME NOBYPASSRLS role every other apps/worker
-- connection uses (ADR-017: the worker holds no more privilege than the
-- API does).
--
-- Reuses `app.is_sweep`, the same gate `20260913190000_invitation_sweep_policy`
-- introduced for the invitation-expiry sweep — one flag naming "this
-- connection is a background sweep", not a new one per sweep. SELECT only:
-- this check writes nothing.
CREATE POLICY family_member_sweep_select ON "family_member"
  FOR SELECT
  USING (current_setting('app.is_sweep', true) = 'true');

CREATE POLICY guardianship_sweep_select ON "guardianship"
  FOR SELECT
  USING (current_setting('app.is_sweep', true) = 'true');
