-- MIGRATIONS_V506_V508_MASTER_LIST_SITES_AND_HISTORY.sql
-- STATUS: APPLIED LIVE 2026-08-11, verified.
--
-- The owner's three rulings on the Aug-2026 KSA asset register, applied.
--
-- ============================================================================
-- 1. "ST2 MEANS ITS SPARE PARTS STORE LOCATION" - this closes a standing question
-- ============================================================================
-- DIRIYAH-ST2 was left untouched by the fleet-wide -ST retirement because it ends
-- ST2 rather than ST and might have been a real "Station 2". It is not a station.
-- The -ST names are SPARE PARTS STORES. That single fact explains a split nobody
-- could account for: 922 expense lines sit on DIRIYAH-ST2 and 4,412 on DIRIYAH,
-- while every asset and job card sits on DIRIYAH-G1/G2. Parts are ISSUED from the
-- store; the machine works at the gate.
--
-- CONSEQUENCE FOR REPORTING, and it is the important one: an expense row's `site`
-- is the ISSUING STORE, not where the machine was working. Per-site operating cost
-- must therefore be read through the ASSET's site (expense -> job card -> asset ->
-- site), never off the expense row's own site column. Reading it the other way is
-- why per-gate cost has never worked.
--
-- ============================================================================
-- 2. "TAKE SITES [FROM] THIS MASTER LIST SO IT WONT BE LIKE 3 TYPES SAME THING"
-- ============================================================================
-- Aliases first, so the master list's spellings resolve onto the names that already
-- carry the data instead of becoming a third variant, then the sites applied.
-- 142 assets moved; 0 landed on an unregistered site; no DIRIYAH-1 or QIDDIYAH-*
-- spelling was created.
--
-- Two corrections came out of checking which spelling actually holds the data
-- before picking a canonical: "G O A" was about to become an empty duplicate of the
-- existing GULF OF AQABA (4 assets), and LAHEQ ISLAND is the same island as LAHEQ
-- (477 expense lines).
--
-- ONE GUARD, the only place the sheet is not taken at face value: never replace a
-- specific site with its own less-specific parent. The sheet writes plain "KSP" for
-- 27 assets while the register distinguishes terminals - KSP-T1 holds 54 assets and
-- 7,177 expense lines, KSP-TP holds 50 and 1,319. Writing "KSP" over "KSP-T1" would
-- discard the terminal the cost is booked against, unrecoverably. A move BETWEEN
-- terminals still applies; only the collapse to the bare parent is skipped.
--
-- ============================================================================
-- 3. "THOSE NOT IN SHEET ... USED AS AN HISTORICAL PURPOSE"
-- ============================================================================
-- The master list defines the CURRENT fleet; the other 412 become history. KSA is
-- now 615 active / 415 historical.
--
-- HISTORY MEANS THE RECORDS STAY. Not one job card, tyre record or expense line was
-- touched - 1,388 tyre records and 14,469 job cards remain attached to those assets
-- and still total into historical cost, exactly as the owner asked ("we will keep
-- that cost here"). Only the asset's own status changed.
--
-- STATUS IS 'Inactive', NOT 'Transferred' OR 'Retired'. The owner said "some maybe
-- sold or some maybe transferred" - they do not know which, and nor do we.
-- 'Inactive' states the one thing that IS known: not in the current KSA fleet.
-- 'Transferred' would assert a movement nobody recorded.
--
-- ROLLBACK: _bak.vehicle_fleet_site_v507 (prior site) and
-- _bak.vehicle_fleet_retired_v508 (prior status and remark).
-- ============================================================================

-- V506 / V506b: aliases so the master list's names resolve onto existing canonicals.
insert into public.site_aliases (alias, canonical) values
  ('DIRIYAH-1', 'DIRIYAH-G1'),
  ('DIRIYAH-2', 'DIRIYAH-G2'),
  ('QIDDIYAH-LP', 'QIDDIYA-LOWER PLATEAU'),
  ('QIDDIYAH-UP', 'QIDDIYA-UPPER PLATEAU'),
  ('QIDDIYA-UP',  'QIDDIYA-UPPER PLATEAU'),
  ('DIRIYAH-ST2', 'DIRIYAH'),            -- a store serves its site
  ('RUMAH PLANT', 'RUMAH'),
  ('RUMAH - YARD', 'RUMAH'),
  ('RUMAH CRUSHER', 'RUMAH'),
  ('RUMAH REPAIR REQUIRED', 'RUMAH'),
  ('RIMAH - PLANT', 'RUMAH'),
  ('MALHAM CAMP', 'MALHAM'),
  ('MALHAM YARD', 'MALHAM'),
  ('LAHAQ', 'LAHEQ'),
  ('G O A', 'GULF OF AQABA'),
  ('LAHEQ ISLAND', 'LAHEQ')
on conflict (alias) do update set canonical = excluded.canonical;

-- Sites the master list names that the register did not know. organisation_id must
-- be explicit - its default app_current_org() is NULL outside a user session, and a
-- null-org site is invisible to everyone.
insert into public.sites (organisation_id, country, name, region)
select '00000000-0000-0000-0000-000000000001'::uuid, 'KSA', n, 'CENTRAL'
from (values ('ESA'), ('OSUS'), ('H- OFFICE'),
             ('HARAM BURJ'), ('HARAM ELSHAFA'), ('HARAM KARAN')) v(n)
where not exists (
  select 1 from public.sites s where s.country='KSA' and upper(btrim(s.name)) = upper(n));

-- V507: apply the master list's site, resolved through the aliases.
create schema if not exists _bak;

create table if not exists _bak.vehicle_fleet_site_v507 as
select v.id, v.asset_no, v.site as old_site, now() as snapped_at
from public.vehicle_fleet v
where v.country='KSA'
  and exists (select 1 from public.ksa_asset_master_upload u where u.asset_no=upper(btrim(v.asset_no)));

update public.vehicle_fleet v
set site = r.resolved
from (
  select u.asset_no, coalesce(a.canonical, upper(btrim(u.site))) as resolved
  from public.ksa_asset_master_upload u
  left join public.site_aliases a on a.alias = upper(btrim(u.site))
  where u.site is not null
) r
where v.country='KSA'
  and upper(btrim(v.asset_no)) = r.asset_no
  and r.resolved is distinct from upper(btrim(v.site))
  and not (upper(btrim(v.site)) like r.resolved || '-%'
           or upper(btrim(v.site)) like r.resolved || '_%');

-- V508: everything the master list does not carry becomes history.
create table if not exists _bak.vehicle_fleet_retired_v508 as
select v.id, v.asset_no, v.status as old_status, v.asset_remarks as old_remarks, now() as snapped_at
from public.vehicle_fleet v
where v.country='KSA'
  and not exists (select 1 from public.ksa_asset_master_upload u where u.asset_no = upper(btrim(v.asset_no)));

update public.vehicle_fleet v
set status = 'Inactive',
    asset_remarks = left(
      coalesce(nullif(btrim(v.asset_remarks),'') || ' | ', '') ||
      'Not in the Aug-2026 KSA asset register; kept for history. Cost and tyre records retained.',
      500)
where v.country='KSA'
  and not exists (select 1 from public.ksa_asset_master_upload u where u.asset_no = upper(btrim(v.asset_no)))
  and coalesce(v.status,'') <> 'Inactive';
