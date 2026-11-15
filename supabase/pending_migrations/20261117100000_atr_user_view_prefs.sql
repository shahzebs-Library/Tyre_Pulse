-- ============================================================================
-- ATR-1  user_view_prefs: personal saved table views
--
-- STATUS: AUTHORED, NOT APPLIED. Needs the owner's explicit approval.
--
-- WHY. Every register (work orders, tyres, fleet ...) asks for the signed-in
-- person's saved column layout. Production has no such table
-- (to_regclass('public.user_view_prefs') is null, 2026-11-15), so nobody can
-- save a view and every page load logged a 404. The client now stops asking
-- after the first "no such table" answer; this draft provides the table.
--
-- This supersedes supabase/migrations/20260921090000_user_view_prefs.sql (never
-- applied). Same shape. Differences: no destructive statements, the trigger
-- function is not callable by PUBLIC or anon, the organisation column is NOT
-- NULL, and the reader policies are applied as every new table requires.
--
-- SCOPE. One row per (user, module, view name). A view is personal: only its
-- owner reads or writes it, and only inside their own company. There is no
-- admin read on purpose (a view's filters can hold what a person searched for).
--
-- NO historical record is touched. New table only.
--
-- VERIFY (run in a transaction, then ROLLBACK). Tested on local staging
-- (database tp_atrisk, synthetic companies): see ATRISK-FIXES_ROUND2.md.
--   begin;
--     select set_config('request.jwt.claims', '{"sub":"<user A uuid>","role":"authenticated"}', true);
--     set local role authenticated;
--     insert into public.user_view_prefs (module_key, name, view)
--       values ('work_orders', '', '{"columns":["asset","site"]}'::jsonb);          -- 1 row
--     insert into public.user_view_prefs (module_key, name, is_default) values ('work_orders', 'A', true);
--     insert into public.user_view_prefs (module_key, name, is_default) values ('work_orders', 'B', true); -- 23505
--   rollback;
--   -- as a DIFFERENT user (same or another company): select count(*) = 0
--   -- as anon: permission denied
--
-- ROLLBACK (only if the table must be removed; it holds layouts only):
--   drop table public.user_view_prefs;            -- also removes its policies and trigger
--   drop function public.touch_user_view_prefs();
-- ============================================================================

create table if not exists public.user_view_prefs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  organisation_id  uuid not null default public.app_current_org(),
  module_key       text not null,
  name             text not null default '',
  is_default       boolean not null default false,
  view             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint user_view_prefs_module_key_chk check (btrim(module_key) <> ''),
  constraint user_view_prefs_name_len_chk   check (char_length(name) <= 60)
);

-- One view name per person per module ('' is the unnamed current arrangement).
-- The client upserts on exactly these three columns.
create unique index if not exists user_view_prefs_user_module_name_uidx
  on public.user_view_prefs (user_id, module_key, name);

-- Exactly one default per person per module.
create unique index if not exists user_view_prefs_one_default_uidx
  on public.user_view_prefs (user_id, module_key)
  where is_default;

alter table public.user_view_prefs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'user_view_prefs' and policyname = 'user_view_prefs_own') then
    create policy user_view_prefs_own
      on public.user_view_prefs
      for all
      to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;

  -- Company wall as a RESTRICTIVE policy, like every other table. No super
  -- admin bypass: a saved layout is personal and nobody else needs it.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'user_view_prefs' and policyname = 'user_view_prefs_org_isolation') then
    create policy user_view_prefs_org_isolation
      on public.user_view_prefs
      as restrictive
      for all
      to authenticated
      using (organisation_id = (select public.app_current_org()))
      with check (organisation_id = (select public.app_current_org()));
  end if;
end $$;

revoke all on public.user_view_prefs from public;
revoke all on public.user_view_prefs from anon;
grant select, insert, update, delete on public.user_view_prefs to authenticated;

-- keep updated_at honest. INVOKER: it only edits the row being written.
create or replace function public.touch_user_view_prefs()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.touch_user_view_prefs() from public;
revoke execute on function public.touch_user_view_prefs() from anon;

create or replace trigger trg_touch_user_view_prefs
  before update on public.user_view_prefs
  for each row execute function public.touch_user_view_prefs();

-- Required for every new table: the read-only reporting role's policies.
select anum_integration.apply_reader_policies();
