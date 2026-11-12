-- Nightly snapshot retention 30 -> 14 days (PERF-9)
-- STATUS: NOT APPLIED. Needs the owner's yes: the next nightly run would remove 16 nights of snapshots.
--
-- MEASURED 2026-11-12: backups.snapshot_tables 456 MB (30 snapshots, 300 rows), _bak schema
--   137 tables / 177 MB, cron.job_run_details 104 MB, ksa_country_upload_template_staging 159 MB,
--   database 2,646 MB. None of this is read by an application query, so it costs disk, not speed:
--   no measured query gets faster by removing it. It is recorded here only so the decision is one
--   statement away.
-- NOT COVERED HERE (each is a removal of stored data and needs its own decision): the _bak
--   rollback copies, _bak.cron_run_details_20261011 (79 MB), the staging landing table.
--
-- ROLLBACK: the same block with 14 and 30 swapped (snapshots already purged do not come back).

do $$ declare d text; a text := 'perform backups._purge(30);'; n int; begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'cron_run_backup' and p.pronamespace = 'public'::regnamespace;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'anchor mismatch %', n; end if;
  execute replace(d, a, 'perform backups._purge(14);');
end $$;
