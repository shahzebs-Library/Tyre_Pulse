-- =============================================================================
-- 94_prepared/nhc_stock_country_correction.sql
-- STATUS: PREPARED, NOT APPLIED. Owner approval required.
-- When: BEFORE inventory file 1 (20261120100000), as its own owner-approved step, then
--       re-take the stock_records baseline (94 section 6). Running it after the release
--       also works (only `country` changes; quantity columns are untouched), but before
--       is cleaner: every opening batch is per country, so a NULL-country row is in no
--       batch and is never counted (rehearsal gate 9 finding).
--
-- Row (production, read-only 2026-11-20):
--   stock_records 5a55a635-69f6-4070-8fb1-8f7d81c8bea8, org 00000000-...-0001,
--   site NHC, region 'KSA', country NULL, description '315/80R22.5 Double coin',
--   stock_qty 35, unit_cost NULL, currency NULL, min 5, critical 3, status OK,
--   updated 2026-08-08 15:28:34 by the platform admin (mobile "Initial stock entry").
-- Ownership evidence (all point to KSA, none to another country):
--   * the row's own region column = 'KSA';
--   * sites: exactly one 'NHC' row, country KSA, region CENTRAL, same organisation
--     (site_aliases NHC-ST -> NHC);
--   * vehicle_fleet: 224 assets at NHC, all KSA;
--   * stock_records: the other 17 NHC rows are all KSA; the other 315/80R22.5 rows
--     of this company are KSA (QIDDIYA-LOWER PLATEAU, RIY-MET);
--   * ledger: 3 movements (Initial +35, adjustment -1, adjustment +1), site NHC, same
--     author; ledger sum 35 = stock_qty (no drift);
--   * audit_log_v2: insert by the platform admin account with country null - the
--     mobile entry form simply did not stamp a country.
-- Correction: country NULL -> 'KSA'. Nothing else (currency stays NULL; the release
-- derives SAR from the country; cost stays unknown -> a legacy cost reconciliation).
-- Live triggers on stock_records: trg_audit_row (audits the change),
-- trg_stock_status_derive (recomputes status from qty/levels: stays OK),
-- trg_normalize_site (UPDATE OF site only: not fired).
-- =============================================================================
begin;

create schema if not exists _bak;
create table if not exists _bak.nhc_stock_country_20261120 as
  select * from public.stock_records where false;
revoke all on _bak.nhc_stock_country_20261120 from public;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.stock_records
   where id = '5a55a635-69f6-4070-8fb1-8f7d81c8bea8'
     and organisation_id = '00000000-0000-0000-0000-000000000001'
     and country is null and upper(btrim(site)) = 'NHC' and region = 'KSA'
     and stock_qty = 35 and unit_cost is null
     and description = '315/80R22.5 Double coin';
  if v_n <> 1 then
    raise exception 'NHC row differs from the reviewed values (found % matching rows); refusing.', v_n;
  end if;
  if (select count(*) from public.sites where upper(btrim(name)) = 'NHC') <> 1
     or (select country from public.sites where upper(btrim(name)) = 'NHC') <> 'KSA' then
    raise exception 'Site NHC is no longer a single KSA site; refusing.';
  end if;
end $$;

insert into _bak.nhc_stock_country_20261120
select * from public.stock_records where id = '5a55a635-69f6-4070-8fb1-8f7d81c8bea8';

update public.stock_records set country = 'KSA'
 where id = '5a55a635-69f6-4070-8fb1-8f7d81c8bea8' and country is null;

do $$ begin
  if (select count(*) from public.stock_records where country is null) <> 0 then
    raise exception 'A NULL-country stock row remains.'; end if;
  if (select stock_qty from public.stock_records where id = '5a55a635-69f6-4070-8fb1-8f7d81c8bea8') <> 35 then
    raise exception 'Quantity changed - abort.'; end if;
end $$;
commit;

-- VERIFY:
-- select id, site, country, stock_qty, stock_status from public.stock_records
--  where id = '5a55a635-69f6-4070-8fb1-8f7d81c8bea8';            -- NHC, KSA, 35, OK
-- select count(*), sum(stock_qty) from public.stock_records;   -- 43, 345 (unchanged)
-- select count(*) from public.stock_records where country is null;   -- 0

-- ROLLBACK (restores the exact prior country):
-- begin;
-- update public.stock_records s set country = b.country
--   from _bak.nhc_stock_country_20261120 b where s.id = b.id;   -- country -> NULL
-- commit;
