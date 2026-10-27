-- AI tyre inspection speed-ups. STATUS: AUTHORED, NOT APPLIED (apply only on the owner's go-ahead).
--
-- 1) photo_content_sha256: SHA-256 of the downloaded photo BYTES (the existing photo_sha256 is a hash of the
--    storage PATH, an idempotency key, and must stay untouched). The worker reuses a completed analysis of
--    identical bytes, same organisation + same prompt_version, with cost 0 and no provider call.
--    Nullable: existing rows stay NULL (never reused) and fill in as photos are re-processed.
-- 2) ai_tyre_worker_lock + ai_tyre_try_acquire_worker_lock(): tiny debounce lock so a burst of enqueues
--    starts one immediate worker. The 5-minute cron (ai_tyre_dispatch_worker) is unchanged.
--
-- Safety: additive only. No existing row is modified. ADD COLUMN without default is metadata-only; the index
-- is partial (only rows with a hash) and small. For a large live table prefer CREATE INDEX CONCURRENTLY
-- from the SQL editor instead (cannot run inside a migration transaction).
-- Verify:  select column_name from information_schema.columns where table_name='ai_tyre_inspection_jobs'
--          and column_name='photo_content_sha256';
-- Rollback: drop function public.ai_tyre_try_acquire_worker_lock(int); drop table public.ai_tyre_worker_lock;
--           drop index if exists public.ai_tyre_jobs_reuse_idx;
--           alter table public.ai_tyre_inspection_jobs drop column photo_content_sha256;

alter table public.ai_tyre_inspection_jobs
  add column if not exists photo_content_sha256 text
  check (photo_content_sha256 is null or photo_content_sha256 ~ '^[a-f0-9]{64}$');

create index if not exists ai_tyre_jobs_reuse_idx
  on public.ai_tyre_inspection_jobs (organisation_id, photo_content_sha256, prompt_version, created_at desc)
  where photo_content_sha256 is not null and status = 'completed';

create table if not exists public.ai_tyre_worker_lock (
  id int primary key check (id = 1),
  locked_until timestamptz not null default 'epoch'
);
insert into public.ai_tyre_worker_lock (id) values (1) on conflict do nothing;
alter table public.ai_tyre_worker_lock enable row level security;   -- no policies: service role / definer only
revoke all on public.ai_tyre_worker_lock from public, anon, authenticated;

create or replace function public.ai_tyre_try_acquire_worker_lock(p_ttl_seconds int default 45)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare got int;
begin
  update public.ai_tyre_worker_lock
     set locked_until = now() + make_interval(secs => greatest(5, least(coalesce(p_ttl_seconds, 45), 300)))
   where id = 1 and locked_until <= now();
  get diagnostics got = row_count;
  return got = 1;
end $$;
-- Grant order matters: revoke PUBLIC first, then anon, then grant only the service role.
revoke all on function public.ai_tyre_try_acquire_worker_lock(int) from public;
revoke all on function public.ai_tyre_try_acquire_worker_lock(int) from anon, authenticated;
grant execute on function public.ai_tyre_try_acquire_worker_lock(int) to service_role;
