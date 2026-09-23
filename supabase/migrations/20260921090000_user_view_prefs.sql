-- ============================================================================
-- user_view_prefs — personal saved views for the operator-grade registers
--
-- STATUS: AUTHORED, NOT APPLIED. Needs the owner's explicit yes before it runs
--         against production, per the standing rule in PROJECT_MEMORY.md.
--
-- WHY. Level 2 of the enterprise UI programme gives every register column
-- pin / resize / show-hide, a sort and filter set, and a density. Those are
-- per-PERSON preferences: a tyre engineer and a finance controller want
-- different columns on the same page. Storing them client-side only would lose
-- them on every new device and every cache clear, which is precisely when an
-- operator is least willing to rebuild a layout by hand.
--
-- SHAPE. One row per (user, module, view name). The arrangement itself lives in
-- a single `view` jsonb that mirrors the pure engine in src/lib/registerViews.js —
-- the engine is the source of truth for the RULES, this table only persists the
-- blob. Deliberately NOT one column per preference: the engine already
-- reconciles an old blob against the current column catalog (appending newly
-- shipped columns, dropping retired ones), so a schema migration is not needed
-- every time a register gains a column.
--
-- SCOPE OF THIS MIGRATION. Personal views only. Role-level default views and
-- org-wide shared layouts are Level 3 and are deliberately NOT modelled here —
-- adding a half-enforced `shared_role` column now would invite writes that no
-- policy actually governs.
-- ============================================================================

create table if not exists public.user_view_prefs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  organisation_id  uuid default public.app_current_org(),
  module_key       text not null,
  name             text not null default '',
  is_default       boolean not null default false,
  view             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint user_view_prefs_module_key_chk check (btrim(module_key) <> ''),
  constraint user_view_prefs_name_len_chk   check (char_length(name) <= 60)
);

-- One view name per person per module. '' is the unnamed "current arrangement",
-- which is what an operator gets for free without ever naming anything.
create unique index if not exists user_view_prefs_user_module_name_uidx
  on public.user_view_prefs (user_id, module_key, name);

-- The hot read is "my views for this page".
create index if not exists user_view_prefs_user_module_idx
  on public.user_view_prefs (user_id, module_key);

-- Exactly one default per person per module; a partial index enforces it
-- without forbidding many non-default views.
create unique index if not exists user_view_prefs_one_default_uidx
  on public.user_view_prefs (user_id, module_key)
  where is_default;

alter table public.user_view_prefs enable row level security;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- A saved view is PERSONAL. There is no admin read policy on purpose: what
-- columns a colleague arranged is not something an administrator needs, and a
-- view's `filters` blob can carry the terms that person was searching for.
drop policy if exists user_view_prefs_own on public.user_view_prefs;
create policy user_view_prefs_own
  on public.user_view_prefs
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Org isolation as a RESTRICTIVE policy, matching every other table here, so a
-- row can never be read or written across the tenant boundary even if the
-- permissive policy above is ever widened.
drop policy if exists user_view_prefs_org_isolation on public.user_view_prefs;
create policy user_view_prefs_org_isolation
  on public.user_view_prefs
  as restrictive
  for all
  to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

-- Zero-argument helpers wrapped in (select ...) so they evaluate ONCE per query
-- as an InitPlan rather than per row — the V234/V236 lesson.

revoke all on public.user_view_prefs from anon;
grant select, insert, update, delete on public.user_view_prefs to authenticated;

-- keep updated_at honest
create or replace function public.touch_user_view_prefs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_user_view_prefs on public.user_view_prefs;
create trigger trg_touch_user_view_prefs
  before update on public.user_view_prefs
  for each row execute function public.touch_user_view_prefs();

-- ── VERIFY (run in a transaction, then ROLLBACK) ────────────────────────────
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<a real user uuid>"}';
--   insert into public.user_view_prefs (module_key, name, view)
--     values ('work_orders', '', '{"columns":["asset","site"]}'::jsonb) returning id;
--   -- expect exactly 1 row, and 0 rows visible to a DIFFERENT user:
--   select count(*) from public.user_view_prefs;
--   -- expect a unique violation on the second default:
--   -- insert ... (module_key, is_default) values ('work_orders', true);
--   -- insert ... (module_key, is_default) values ('work_orders', true);  -- 23505
-- rollback;
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop trigger if exists trg_touch_user_view_prefs on public.user_view_prefs;
-- drop function if exists public.touch_user_view_prefs();
-- drop table if exists public.user_view_prefs;
