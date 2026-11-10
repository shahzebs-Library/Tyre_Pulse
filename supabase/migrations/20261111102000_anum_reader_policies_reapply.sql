-- 20261111102000_anum_reader_policies_reapply
-- anum_integration is the owner's read-only reporting bot (owner, 2026-11-11: "I add it for my
-- bot to do reading"). It pins one registered reader user to GET-only on the tables listed in
-- anum_integration.reader_tables, inside its own organisation, via RESTRICTIVE policies
-- (anum_reader_*) on every RLS table plus pgrst.db_pre_request = anum_integration.pre_request.
-- The policies are generated once by apply_reader_policies(), so every table created AFTER
-- that run had none: 33 tables were uncovered on 2026-11-11 (password_reset_requests,
-- workforce_employees, ai_tyre_inspection_jobs, ...). pre_request still blocked them over REST,
-- but realtime and any non-REST path read RLS alone. Re-running restores full coverage
-- (verified: 0 uncovered, 480 covered). Non-reader users are unaffected (is_reader() is false).
-- RULE: any migration that CREATES a table must end with this same guarded call.
-- Optional integration: a database built from this repository does not have it, so skip there.
do $$
begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;
