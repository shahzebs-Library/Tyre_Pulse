-- AI tyre inspection: publish ai_tyre_inspection_jobs to supabase_realtime so the
-- inspection screen can show live "AI analysing 5 of 13" without refresh.
-- STATUS: AUTHORED, NOT APPLIED.
--
-- Justification (PROJECT_MEMORY: publishing ADDS WAL decode load):
--  * Not currently published (no earlier migration adds it).
--  * Low volume: one row per tyre photo, ~13 per inspection, a few updates each
--    (pending -> processing -> completed). Table is small and not a hot table.
--  * Clients subscribe with filter inspection_id=eq.<id>, only while one inspection
--    is open; RLS (ai_tyre_jobs_org_read) applies per subscriber.
--  * The client also polls every 5s ONLY while jobs are pending, so if this is not
--    applied (or decode load is a concern) the feature still works.
-- Re-measure the decoder (pg_stat_statements 'wal->>') after applying.
-- Rollback: alter publication supabase_realtime drop table public.ai_tyre_inspection_jobs;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public'
                       and tablename = 'ai_tyre_inspection_jobs') then
    alter publication supabase_realtime add table public.ai_tyre_inspection_jobs;
  end if;
end $$;
