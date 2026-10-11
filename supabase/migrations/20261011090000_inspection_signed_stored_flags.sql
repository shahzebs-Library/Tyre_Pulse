-- 20261011090000 inspection_signed_stored_flags
-- STATUS: APPLIED LIVE 2026-10-11 (Supabase MCP) and verified.
--
-- WHY: the inspection register (the slowest read on the database, 255 calls at
-- 272 ms mean, ~7,200 buffers a call) selected the computed columns
-- has_inspector_signature(inspections) / has_approver_signature(inspections).
-- Both took the WHOLE ROW and carried SET search_path, which blocks inlining, so
-- Postgres detoasted every signature image (4.5 MB over 1,788 rows) and sorted
-- the full row on disk (external merge, 6.9 MB) for every 1,000-row page.
--
-- FIX: two STORED generated booleans. The register now reads them directly
-- (has_inspector_signature:inspector_signed alias in src/lib/api/inspections.js),
-- and the old computed columns read the stored flag so a stale browser bundle
-- also stops detoasting.
--
-- MEASURED (KSA Manager, under RLS, 1,000-row page): 7,432 buffers + disk sort
-- 135 ms  ->  506 buffers, in-memory sort. Equivalence: 0 mismatches on 1,788
-- rows for both flags.
--
-- WHY PLAIN COLUMNS, NOT GENERATED: generated first, and a rolled-back test
-- proved it broke editing: trg_lock_inspection_content and
-- z_approval_document_guard diff to_jsonb(OLD) vs to_jsonb(NEW), and a stored
-- generated column is not yet computed in a BEFORE trigger, so every update of
-- a locked inspection was refused ("locked and cannot be edited"). The flags
-- are now plain columns stamped by zz_stamp_inspection_signed_flags, which sorts
-- AFTER both diff triggers, so they see the flags unchanged. Verified: a no-op
-- update on a locked row succeeds; the flag follows the signature (null->false,
-- set->true); 0 mismatches on 1,788 rows.
--
-- ROLLBACK: drop trigger zz_stamp_inspection_signed_flags on public.inspections;
-- drop function public.stamp_inspection_signed_flags(); restore the two
-- has_*_signature functions to select nullif(btrim(r.<col>), '') is not null;
-- revert the alias in src/lib/api/inspections.js; then drop the two columns.

-- Created as generated (cheap backfill that fires no row trigger), then
-- converted to plain columns.
alter table public.inspections
  add column if not exists inspector_signed boolean generated always as (nullif(btrim(inspector_signature),'') is not null) stored,
  add column if not exists approver_signed  boolean generated always as (nullif(btrim(approver_signature),'')  is not null) stored;
alter table public.inspections alter column inspector_signed drop expression;
alter table public.inspections alter column approver_signed  drop expression;
alter table public.inspections alter column inspector_signed set default false;
alter table public.inspections alter column approver_signed  set default false;

create or replace function public.stamp_inspection_signed_flags() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.inspector_signed := nullif(btrim(new.inspector_signature), '') is not null;
  new.approver_signed  := nullif(btrim(new.approver_signature), '')  is not null;
  return new;
end $$;
revoke all on function public.stamp_inspection_signed_flags() from public, anon, authenticated;

create trigger zz_stamp_inspection_signed_flags
  before insert or update on public.inspections
  for each row execute function public.stamp_inspection_signed_flags();

create or replace function public.has_inspector_signature(r public.inspections) returns boolean
  language sql stable set search_path = '' as $$ select r.inspector_signed $$;
create or replace function public.has_approver_signature(r public.inspections) returns boolean
  language sql stable set search_path = '' as $$ select r.approver_signed $$;

analyze public.inspections;
