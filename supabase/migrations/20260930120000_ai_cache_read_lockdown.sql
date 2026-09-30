-- ============================================================================
-- 20260930120000_ai_cache_read_lockdown
-- STATUS: APPLIED LIVE 2026-09-30 + verified (Driver reads 0 cache rows; service role 39).
--
-- FINDING (audit 2026-09-30, AUD-02, HIGH): public.ai_response_cache has a
-- PERMISSIVE SELECT policy `ai_response_cache_read_authenticated USING (true)`,
-- NO organisation_id column and NO restrictive policy. The table holds the full
-- text of every AI question (query_text) and answer (response) produced by the
-- chat-ai edge function (39 rows, 886-10,058 bytes each, 2026-07-08..2026-08-26).
--
-- EVIDENCE (rolled back, impersonated):
--   * KSA-only Driver 69ed2a92-...: select count(*) from ai_response_cache -> 39;
--     rows whose response mentions UAE|Egypt|AED|EGP -> 3 (cross-country).
--   * Manager of the OTHER tenant ("Tyre Pulse Demo Fleet", org a50e2d87-...,
--     user c2f9a806-...): select count(*) -> 39 (CROSS-TENANT read).
--   * INSERT / UPDATE by that user: 42501 / 0 rows (writes already refused).
-- The chat-ai edge function reads/writes this table with the SERVICE ROLE only
-- (supabase/functions/chat-ai/index.ts lines 202, 288) and scopes the cache
-- key by user id. No client in src/, mobile/ or tyre_pulse_flutter/lib reads it
-- (grep 2026-09-30: only chat-ai references ai_response_cache).
--
-- Same shape on public.document_chunks (`document_chunks_read_authenticated
-- USING (true)`, no organisation_id). 0 rows today, no client reader - closed
-- now so the first ingested document cannot leak across tenants.
--
-- FIX: drop the two blanket read policies and remove the unused client DML
-- grants. RLS stays ON with the existing admin_only_delete_guard, so an
-- authenticated caller now sees 0 rows (deny-by-default). service_role
-- bypasses RLS, so chat-ai caching is unaffected.
--
-- PRE-FLIGHT (database-migration-safety):
--   data loss: none (no DML). rename/removal: none. CHECK: none. locks: policy
--   DDL takes a brief ACCESS EXCLUSIVE on two tiny tables (39 / 0 rows).
--   triggers: none fire. old mobile builds: none read these tables.
-- ============================================================================

begin;

drop policy if exists ai_response_cache_read_authenticated on public.ai_response_cache;
drop policy if exists document_chunks_read_authenticated  on public.document_chunks;

revoke insert, update, delete, truncate, references, trigger
  on public.ai_response_cache from authenticated, anon;
revoke insert, update, delete, truncate, references, trigger
  on public.document_chunks from authenticated, anon;

comment on table public.ai_response_cache is
  'AI completion cache. Service-role only (chat-ai edge function). No client '
  'policy on purpose: rows carry no organisation_id and contain tenant data '
  '(audit 2026-09-30, AUD-02).';

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (run after apply; each block rolls back):
--
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','c2f9a806-1d9c-4c3a-9a38-0bd7fefb087e','role','authenticated')::text, true);
--   set local role authenticated;
--   select count(*) from public.ai_response_cache;   -- expect 0 (was 39)
--   select count(*) from public.document_chunks;     -- expect 0
-- rollback;
--
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','69ed2a92-0e66-4d5a-a118-9354eb1fb1f4','role','authenticated')::text, true);
--   set local role authenticated;
--   select count(*) from public.ai_response_cache;   -- expect 0 (was 39)
-- rollback;
--
-- select count(*) from public.ai_response_cache;     -- as service/MCP: still 39
-- Functional: send one Smart Analytics question twice as an Admin; the second
-- call must return {cached:true} (proves the service-role path still works).
--
-- ROLLBACK:
-- create policy ai_response_cache_read_authenticated on public.ai_response_cache
--   for select to authenticated using (true);
-- create policy document_chunks_read_authenticated on public.document_chunks
--   for select to authenticated using (true);
-- grant insert, update, delete, references on public.ai_response_cache to authenticated;
-- grant insert, update, delete, references on public.document_chunks  to authenticated;
-- ----------------------------------------------------------------------------
