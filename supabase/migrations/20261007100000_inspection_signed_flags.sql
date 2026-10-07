-- 20261007100000_inspection_signed_flags
--
-- WHY
--   The Inspections register gains a "Sign-off" filter (Not signed by inspector /
--   Not approved yet / Approved, no approver signature). The register list
--   deliberately does NOT download the signature images (they were 54% of its
--   payload), so it needs a yes/no per row instead. PostgREST computed columns:
--   a function taking the table row is selectable like a column
--   (select=...,has_inspector_signature).
--
-- PRE-FLIGHT
--   Additive only: two new functions, no table change, no data change.
--   SECURITY INVOKER, so RLS on inspections still decides which rows exist.
--   No anon grant (anon reaches no base table since V281 anyway).
--   Old clients never select these names, so they are unaffected.
--
-- ROLLBACK
--   drop function public.has_inspector_signature(public.inspections);
--   drop function public.has_approver_signature(public.inspections);
--   (and remove the two names from LIST_COLS in src/lib/api/inspections.js first)

create or replace function public.has_inspector_signature(r public.inspections)
returns boolean language sql stable set search_path = ''
as $$ select nullif(btrim(r.inspector_signature), '') is not null $$;

create or replace function public.has_approver_signature(r public.inspections)
returns boolean language sql stable set search_path = ''
as $$ select nullif(btrim(r.approver_signature), '') is not null $$;

revoke all on function public.has_inspector_signature(public.inspections) from public;
revoke all on function public.has_approver_signature(public.inspections) from public;
revoke all on function public.has_inspector_signature(public.inspections) from anon;
revoke all on function public.has_approver_signature(public.inspections) from anon;
grant execute on function public.has_inspector_signature(public.inspections) to authenticated, service_role;
grant execute on function public.has_approver_signature(public.inspections) to authenticated, service_role;
