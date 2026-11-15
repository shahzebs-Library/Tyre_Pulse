-- STEP 0 (only if the reader-policy drift preflight returns more than 0 tables).
-- Steps 2 (20261115140000) and 6 (20261115142000) end with anum_integration.apply_reader_policies(),
-- which rewrites the anum_reader_* policies of EVERY RLS table in public, not only the new ones.
-- When the live policies already match reader_tables this is a no-op. When they drift, run this
-- step first, as its own change, so steps 2 and 6 stay exactly reversible. It snapshots the four
-- anum_reader_* policies of every table, then normalises them. It affects only the read-only
-- reporting bot role (anum_integration readers); app users are unaffected (the expression is
-- "not is_reader() ..." which is true for every non-bot user).
-- Contains the word "drop" (inside apply_reader_policies only): the MCP confirm prompt appears.
begin;
create schema if not exists _bak;
create table if not exists _bak.rb519_reader_policies_snapshot as
  select now() as saved_at, schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies where policyname like 'anum_reader_%';
revoke all on _bak.rb519_reader_policies_snapshot from public, anon, authenticated;
select anum_integration.apply_reader_policies();
commit;
