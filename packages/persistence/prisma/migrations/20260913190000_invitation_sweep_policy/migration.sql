-- FR-012: the expiry sweep (apps/worker/src/sweeps/expire-invitations.sweep.ts)
-- runs as `family_platform_app`, the same NOBYPASSRLS role apps/api uses
-- (ADR-017's own table: apps/worker holds no more privilege than apps/api
-- does) — so without a policy of its own, it could only ever see one
-- family's invitations at a time, the same as any other request.
--
-- Deliberately gated on a session setting nothing else ever sets, for the
-- same reason `invitation_by_token` is: PostgreSQL ORs permissive policies
-- together, so an ungated policy here would ALSO widen what an ordinary
-- family-scoped API request can see. `app.is_sweep` is that gate: unset
-- (and therefore NULL, therefore never `= 'true'`) for every request this
-- platform's own code sends except the sweep script's own connection.
--
-- TWO policies rather than one `FOR ALL`: an UPDATE's WHERE clause reads
-- existing column values, which needs the row to pass a SELECT-or-ALL
-- policy before the UPDATE-specific policy is even consulted. This SELECT
-- policy grants that on `app.is_sweep` alone — broader than the sweep
-- strictly touches, but still gated behind a flag no other connection ever
-- sets, so nothing outside the sweep's own transaction is widened by it.
-- The UPDATE policy below is what actually narrows to overdue pending rows.
CREATE POLICY invitation_sweep_select ON "invitation"
  FOR SELECT
  USING (current_setting('app.is_sweep', true) = 'true');

-- USING narrows which existing rows the sweep may modify. WITH CHECK is
-- deliberately broader — it validates the ROW BEING WRITTEN (now
-- `status = 'expired'`), which would fail this policy's own USING if
-- repeated verbatim, so it checks only the one thing that must still hold:
-- this connection really is the sweep.
CREATE POLICY invitation_sweep_update ON "invitation"
  FOR UPDATE
  USING (
    current_setting('app.is_sweep', true) = 'true'
    AND "status" = 'pending'
    AND "expires_at" <= now()
  )
  WITH CHECK (current_setting('app.is_sweep', true) = 'true');
