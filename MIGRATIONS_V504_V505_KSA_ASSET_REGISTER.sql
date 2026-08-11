-- MIGRATIONS_V504_V505_KSA_ASSET_REGISTER.sql
-- STATUS: APPLIED LIVE 2026-08-11, verified.
--
-- Source: the owner's Asset_Report082026_UPDATED.xlsx, sheet "ALL IN ONE ASSETS",
-- 618 KSA assets, sent as "the final updated" register.
--
-- ============================================================================
-- WHAT THE SHEET ADDS - and it is a large, clean gain
-- ============================================================================
-- Of its 618 assets, 611 already existed in vehicle_fleet and 7 did not.
-- On those 611 the register was EMPTY on three fields and the sheet fills them:
--   model year        0 of 611 -> 592
--   chassis number    0 of 611 -> 388
--   engine number     0 of 611 -> 507
--   make             585       -> 602   (17 blanks filled)
--   plate            386       -> 391   (5 blanks filled)
-- Every clause requires the live value to be BLANK, so this migration cannot
-- overwrite anything that was already recorded. Plus the 7 new assets
-- (HD021-023, PB014/016/017, SL027).
--
-- ============================================================================
-- "FINAL UPDATED" DOES NOT MEAN "DELETE THE REST" - measured, and it matters
-- ============================================================================
-- The live KSA register holds 1,023 assets; the sheet lists 618. Reading it as a
-- replacement would retire 412 assets. That reading is measurably wrong:
--   * 152 of the 412 had a job card in the LAST 90 DAYS
--   * 188 within the last year, 96 carry tyre records
--   * NOT ONE of the 412 has never had a job card
--   * 177 are transit mixers, 119 of them worked on within 90 days
--     (TM502: 112 job cards, 23 tyres. TM355: 133 job cards, 17 tyres.)
-- They are in service. NOTHING is deactivated by this migration. The 412 are a
-- question for the owner, not an instruction to act on.
--
-- ============================================================================
-- TWO FIELDS HELD BACK ON PURPOSE
-- ============================================================================
-- SITE (379 assets would move). The sheet's site names are a DIFFERENT
-- vocabulary from the one the app reports on. DIRIYAH-1 (84 assets),
-- QIDDIYAH-LP (37), DIRIYAH-2 (35) and QIDDIYAH-UP (27) are not registered sites
-- and hold zero assets today, while the app uses DIRIYAH-G1/G2 and
-- QIDDIYA-UP/LP. Writing them raw would create parallel sites and split every
-- per-site cost and tyre report in two. V247 recorded that these gates and
-- plateaus are DELIBERATELY distinct sites, so collapsing them is a naming
-- decision only the owner can make. AMALA, METRO and REDSEA already have aliases
-- in site_aliases and would resolve correctly; the rest do not. Adding an alias
-- row per confirmed pair is the fix, and the existing normalize_site trigger
-- then applies it to every future write.
--
-- PLATE (22 assets). The sheet and the register disagree on a plate that is
-- already recorded. One of the two is wrong and the sheet does not say which.
--
-- ROLLBACK: _bak.vehicle_fleet_asset_register_v505 holds every touched row's
-- prior values; the 7 inserts carry fleet_number 'ASSET-REGISTER-2026-08'.
-- ============================================================================

-- V504: the landing table. The register is loaded here first so it can be
-- compared against vehicle_fleet before anything is changed.
create table if not exists public.ksa_asset_master_upload (
  id            bigserial primary key,
  asset_no      text not null,
  vehicle_type  text,
  model_year    text,
  plate_no      text,
  brand         text,
  chassis_no    text,
  site          text,
  status        text,
  capacity      text,
  engine_no     text,
  uploaded_at   timestamptz not null default now()
);

create unique index if not exists ux_ksa_asset_master_upload_asset
  on public.ksa_asset_master_upload (asset_no);

alter table public.ksa_asset_master_upload enable row level security;

drop policy if exists ksa_asset_upload_read on public.ksa_asset_master_upload;
create policy ksa_asset_upload_read on public.ksa_asset_master_upload
  for select to public using (public.app_is_elevated());

drop policy if exists ksa_asset_upload_write on public.ksa_asset_master_upload;
create policy ksa_asset_upload_write on public.ksa_asset_master_upload
  for all to public using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

comment on table public.ksa_asset_master_upload is
  'Owner-supplied KSA asset register (Aug 2026). A landing table, not the master: vehicle_fleet stays authoritative and is updated from here only after the differences are measured.';

-- V505: apply the fills and the new assets. Body as applied live - see the
-- header for what is deliberately excluded.
create schema if not exists _bak;

create table if not exists _bak.vehicle_fleet_asset_register_v505 as
select v.id, v.asset_no, v.vehicle_type, v.make, v.model_year, v.registration_no,
       v.chassis_no, v.serial_no, v.site, v.status, now() as snapped_at
from public.vehicle_fleet v
where v.country='KSA'
  and exists (select 1 from public.ksa_asset_master_upload u where u.asset_no=upper(btrim(v.asset_no)));

update public.vehicle_fleet v
set model_year = case when v.model_year is null and u.model_year ~ '^\d{4}$'
                      then u.model_year::int else v.model_year end,
    chassis_no = case when coalesce(btrim(v.chassis_no),'') = '' then u.chassis_no else v.chassis_no end,
    serial_no  = case when coalesce(btrim(v.serial_no),'')  = '' then u.engine_no  else v.serial_no  end,
    make       = case when coalesce(btrim(v.make),'')       = '' then u.brand      else v.make       end,
    registration_no = case when coalesce(btrim(v.registration_no),'') = '' then u.plate_no else v.registration_no end,
    vehicle_type = case when coalesce(btrim(v.vehicle_type),'') = '' then u.vehicle_type else v.vehicle_type end
from public.ksa_asset_master_upload u
where v.country='KSA' and upper(btrim(v.asset_no)) = u.asset_no;

insert into public.vehicle_fleet
  (organisation_id, country, asset_no, vehicle_type, make, model_year, chassis_no,
   serial_no, registration_no, site, status, fleet_number)
select
  '00000000-0000-0000-0000-000000000001'::uuid, 'KSA', u.asset_no, u.vehicle_type,
  u.brand,
  case when u.model_year ~ '^\d{4}$' then u.model_year::int end,
  u.chassis_no, u.engine_no, u.plate_no, u.site,
  case when upper(coalesce(u.status,'')) like 'RUNING%' then 'Active' else 'Inactive' end,
  'ASSET-REGISTER-2026-08'
from public.ksa_asset_master_upload u
where not exists (
  select 1 from public.vehicle_fleet v where v.country='KSA' and upper(btrim(v.asset_no)) = u.asset_no);
