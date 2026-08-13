-- =============================================================================
-- V491c-f - The 2026-08-12 KSA asset master applied to the fleet register
-- STATUS: APPLIED LIVE on project jhssdmeruxtrlqnwfksc (2026-08-13), verified.
--
-- V491c  one landing table, not one per upload
-- V491d  key the landing table per FILE so two copies of the sheet can coexist
-- V491e  three site spellings the register already has under another name
-- V491f  apply the sheet: capacity, engine number, operational status, sites
--
-- WHAT THE SHEET ACTUALLY ADDED - measured before anything was written.
--   Its 618 asset codes are the SAME 618 the owner sent on 2026-08-11, and
--   every one already exists in vehicle_fleet. So there was nothing to create:
--   sheet-only assets 0, fleet rows the sheet does not list 412 (the historical
--   ones V508 already marked Inactive).
--   What IS new is operational: 173 site moves, 75 status changes, and two
--   columns the register has never carried - capacity and engine number.
--
-- WHAT WAS DELIBERATELY NOT WRITTEN
--   Identity. V505 already filled model year, chassis and plate from the
--   previous copy of this sheet, and this copy AGREES with the register on
--   every plate and every model year (0 conflicts on both). Only genuinely
--   blank fields are filled, so nothing a person has since corrected can be
--   overwritten by a re-upload.
--
--   CENTRAL REGION (49 assets) and 'METRO / QIDDIYAH UP' (33 assets) are NOT
--   written as sites. The first is a region; the second names two sites in one
--   cell, and which one an asset is at is a fact the sheet does not state.
--   Writing either would put 82 machines somewhere that does not exist.
--
-- RESULT, verified after applying:
--   capacity     0 -> 543      engine number 0 -> 513
--   ops_status   0 -> 618      make filled 7      sites moved 49
--   KSA fleet unchanged at 1,030
--
-- ROLLBACK: _bak.fleet_master_v491f holds every touched column, per row.
--   update public.vehicle_fleet f set site=b.site, make=b.make,
--          model_year=b.model_year, capacity=b.capacity, engine_no=b.engine_no,
--          ops_status=b.ops_status, ops_status_note=b.ops_status_note,
--          ops_status_at=b.ops_status_at
--     from _bak.fleet_master_v491f b where b.id = f.id;
-- =============================================================================

-- ---------------------------------------------------------------- V491c ----
-- V491b created `ksa_master_2026_08`, which is column-for-column the same thing
-- as the `ksa_asset_master_upload` table V505 already built for the previous
-- copy of this sheet. Two landing tables for one file means the next
-- reconciliation has to be told which to read, and eventually reads the stale
-- one. Dropped (it never received a row); the canonical table gains the only
-- thing it lacked - a way to tell one upload from the next.
drop table if exists public.ksa_master_2026_08;

alter table public.ksa_asset_master_upload
  add column if not exists source_file text;

update public.ksa_asset_master_upload
   set source_file = 'Asset_Report082026_UPDATED.xlsx'
 where source_file is null;

create index if not exists ksa_asset_master_upload_file_idx
  on public.ksa_asset_master_upload (source_file, asset_no);

-- ---------------------------------------------------------------- V491d ----
-- The key was the asset code alone, so the table could hold exactly ONE copy of
-- the sheet - and the owner sends it repeatedly. The second copy is precisely
-- what shows what changed, so the key becomes (file, asset). An asset still
-- cannot appear twice inside one file, which is the mistake worth catching.
alter table public.ksa_asset_master_upload
  drop constraint if exists ux_ksa_asset_master_upload_asset;
drop index if exists public.ux_ksa_asset_master_upload_asset;

create unique index if not exists ux_ksa_asset_master_upload_file_asset
  on public.ksa_asset_master_upload (coalesce(source_file, ''), asset_no);

-- ---------------------------------------------------------------- V491e ----
insert into public.site_aliases (alias, canonical)
values
  ('QIDDIYA L',  'QIDDIYA-LOWER PLATEAU'),
  ('QIDDIYAH L', 'QIDDIYA-LOWER PLATEAU'),
  ('KSP TP',     'KSP-TP')
on conflict (alias) do nothing;

-- ---------------------------------------------------------------- V491f ----
create schema if not exists _bak;

drop table if exists _bak.fleet_master_v491f;
create table _bak.fleet_master_v491f as
select id, asset_no, site, make, model_year, capacity, engine_no,
       ops_status, ops_status_note, ops_status_at
from public.vehicle_fleet where country = 'KSA';

with m as (
  select upper(btrim(asset_no)) a,
         nullif(regexp_replace(coalesce(model_year,''),'\D','','g'),'')::int my,
         nullif(upper(btrim(brand)),'') brand,
         nullif(btrim(capacity),'')     cap,
         nullif(btrim(engine_no),'')    eng,
         nullif(btrim(status),'')       raw_status
  from public.ksa_asset_master_upload
  where source_file = 'ASSETS_LIST__UPDATED_1282026.xlsx'
)
update public.vehicle_fleet f
   set model_year = coalesce(f.model_year, m.my),
       make       = coalesce(nullif(btrim(f.make),''), m.brand),
       capacity   = coalesce(nullif(btrim(f.capacity),''), m.cap),
       engine_no  = coalesce(nullif(btrim(f.engine_no),''), m.eng),
       ops_status = case
         when m.raw_status ilike 'RUNING%' or m.raw_status ilike 'RUNNING%' then 'running'
         when m.raw_status ilike 'BREAKDOWN%'                                then 'breakdown'
         when m.raw_status ilike 'IDLE%'                                     then 'idle'
         when m.raw_status ilike 'Plan For Scrap%'                           then 'planned_scrap'
         when m.raw_status ilike 'IN PROCESS For Reallocation%'
           or m.raw_status ilike 'Plan To Move%'                             then 'reallocation'
         -- 'RUMAH - YARD' in the status column is a SITE that slipped a column
         -- in the source sheet. It is recorded as other rather than invented
         -- into a status nobody wrote.
         when m.raw_status is null                                           then null
         else 'other'
       end,
       ops_status_note = m.raw_status,
       ops_status_at   = now()
  from m
 where upper(btrim(f.asset_no)) = m.a and f.country = 'KSA';

-- Site moves. THE GUARD THAT MATTERS (the V507 lesson): a specific site is
-- never replaced by its own less-specific parent. The sheet writes plain KSP
-- for assets the register knows are at KSP-T1 or KSP-TP; taking it literally
-- would discard the terminal every riyal of cost is booked against.
with m as (
  select upper(btrim(asset_no)) a,
         upper(regexp_replace(btrim(site),'\s+',' ','g')) raw
  from public.ksa_asset_master_upload
  where source_file = 'ASSETS_LIST__UPDATED_1282026.xlsx' and site is not null
), r as (
  select a,
         regexp_replace(
           coalesce((select sa.canonical from public.site_aliases sa where sa.alias = m.raw), m.raw),
           '[_-]ST$', '') as resolved
  from m
)
update public.vehicle_fleet f
   set site = r.resolved
  from r
 where upper(btrim(f.asset_no)) = r.a
   and f.country = 'KSA'
   and exists (select 1 from public.sites s
                where s.country in ('KSA','Saudi Arabia')
                  and upper(btrim(s.name)) = r.resolved)
   and upper(btrim(coalesce(f.site,''))) <> r.resolved
   and not (upper(btrim(coalesce(f.site,''))) like r.resolved || '-%'
         or upper(btrim(coalesce(f.site,''))) like r.resolved || '_%');
