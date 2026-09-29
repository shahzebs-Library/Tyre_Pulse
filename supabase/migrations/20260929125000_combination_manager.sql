-- Combination Manager (owner mockup 19, top-right panel).
-- Extends public.asset_combinations (V141) with the fields the mockup shows:
-- a combination number, combination type, axle configuration, tyre
-- configuration (steer / drive / trailer tyre counts), maximum load in tonnes,
-- and an "under_review" status. All additive and nullable; the table held 0
-- rows when this was written, so no backfill is needed.
--
-- Write access is tightened to the standard pattern: insert/update for
-- is_approved_and_unlocked(), delete for app_is_elevated(). Org and country
-- RESTRICTIVE policies are unchanged. anon has no grant.
--
-- Rollback:
--   alter table public.asset_combinations
--     drop column if exists combination_no, drop column if exists combination_type,
--     drop column if exists axle_config, drop column if exists tyre_config,
--     drop column if exists max_load_tonnes;
--   (then restore the V141 status check and auth.uid() policies)

alter table public.asset_combinations
  add column if not exists combination_no   text,
  add column if not exists combination_type text,
  add column if not exists axle_config      text,
  add column if not exists tyre_config      jsonb not null default '{}'::jsonb,
  add column if not exists max_load_tonnes  numeric(8,2);

alter table public.asset_combinations drop constraint if exists asset_combinations_status_check;
alter table public.asset_combinations
  add constraint asset_combinations_status_check
  check (status = any (array['active'::text, 'inactive'::text, 'under_review'::text]));

alter table public.asset_combinations drop constraint if exists asset_combinations_max_load_check;
alter table public.asset_combinations
  add constraint asset_combinations_max_load_check
  check (max_load_tonnes is null or (max_load_tonnes > 0 and max_load_tonnes <= 1000));

alter table public.asset_combinations drop constraint if exists asset_combinations_tyre_config_check;
alter table public.asset_combinations
  add constraint asset_combinations_tyre_config_check
  check (jsonb_typeof(tyre_config) = 'object');

create unique index if not exists asset_combinations_org_no_uidx
  on public.asset_combinations (organisation_id, upper(btrim(combination_no)))
  where combination_no is not null and btrim(combination_no) <> '';

drop policy if exists asset_combinations_insert on public.asset_combinations;
drop policy if exists asset_combinations_update on public.asset_combinations;
drop policy if exists asset_combinations_delete on public.asset_combinations;

create policy asset_combinations_insert on public.asset_combinations
  for insert to authenticated with check ((select public.is_approved_and_unlocked()));
create policy asset_combinations_update on public.asset_combinations
  for update to authenticated
  using ((select public.is_approved_and_unlocked()))
  with check ((select public.is_approved_and_unlocked()));
create policy asset_combinations_delete on public.asset_combinations
  for delete to authenticated using ((select public.app_is_elevated()));

revoke all on public.asset_combinations from anon;
