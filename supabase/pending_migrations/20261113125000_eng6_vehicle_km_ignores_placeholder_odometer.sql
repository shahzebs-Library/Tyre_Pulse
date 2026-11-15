-- ENG-6b (round 2, defect R2-D1): the vehicle km span must not read the placeholder
-- odometer "1" as a real reading.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15 from the definition of
--         public.fleet_km_by_asset(uuid,text,date,date) on the staging baseline
--         (a schema copy of production). Executed on LOCAL STAGING ONLY
--         (database tp_eng, synthetic data). Nothing here has been run against
--         production. Both anchors occur exactly once.
--
-- WHY. fleet_km_by_asset() builds each vehicle's distance in a period as
-- max(odometer) - min(odometer) over the fitment and removal readings on its
-- tyre rows. It accepts any reading above 0. A tyre fitted at the placeholder
-- odometer 1 (rule T7: the ERP wrote 1 where it had no reading) therefore
-- becomes the minimum, and the "distance" becomes the whole odometer of the
-- vehicle. Found by the round 2 golden fixture: asset GTM01 has real readings
-- from 10,000 to 95,000 km (85,000 km driven) and one placeholder fitment; the
-- function returns 94,999.
--
-- This is the denominator of "Operating / Tyre / Maintenance cost per vehicle
-- km" (get_cost_cpk_overview, _cost_cpk) and of the km intelligence panel.
--
-- MEASURED read only on production, 2026-11-15, window 2025-11-01 to 2026-10-31
-- (aggregates only, same logic as the function):
--            assets   vehicle km now   assets   vehicle km after   placeholder readings in window
--   KSA        353      16,165,110       348      15,411,576        66 on 23 assets
--   UAE        160       8,016,606       151       7,442,153        57 on 27 assets
--   Egypt       18         415,159        17         415,158         5 on  2 assets
-- So today's vehicle km is overstated by 4.7% (KSA) and 7.2% (UAE), and every
-- cost per vehicle km is understated by about the same share. After this draft
-- the KSA and UAE figures rise by roughly 5% and 8% (the matched spend also
-- moves a little because 5 KSA and 9 UAE assets no longer have two real
-- readings and drop out of the measured set; they are counted in coverage).
--
-- WHAT THIS CHANGES. Two comparisons: a reading must be above 1, not above 0.
-- A real odometer of exactly 1 km is not a case that exists for a working
-- vehicle. Factory fitments at 0 were already outside (a 0 minimum would have
-- the same effect) and stay outside.
--
-- RISK TO THE CURRENT COMPANY: low to medium. Cost per vehicle km on Expenses
-- and CPK rises by about 5% (KSA) and 8% (UAE); that is the correction. No
-- stored row changes. Tell users before deploy, together with draft 120000.
--
-- VERIFY (read only, before and after; same query both times):
--   select country, count(*) assets, sum(km_run) km
--     from public.fleet_km_by_asset('<org id>'::uuid, null, '2025-11-01', '2026-10-31') group by 1 order by 1;
--   before: KSA 353 / 16,165,110   UAE 160 / 8,016,606   Egypt 18 / 415,159   (as of 2026-11-15)
--   after : KSA 348 / 15,411,576   UAE 151 / 7,442,153   Egypt 17 / 415,158
--   and no asset may be returned whose minimum reading in the window is 1.
--
-- ROLLBACK: re-run the definition saved in _bak.fn_defs_eng_20261113 where
--   fn = 'fleet_km_by_asset'.
-- ---------------------------------------------------------------------------

create schema if not exists _bak;
create table if not exists _bak.fn_defs_eng_20261113 (
  fn text not null, captured_at timestamptz not null default now(), def text not null);

create or replace function pg_temp.eng_replace_once(p_src text, p_anchor text, p_new text, p_what text)
returns text language plpgsql as $f$
declare n int := (length(p_src) - length(replace(p_src, p_anchor, ''))) / length(p_anchor);
begin
  if n <> 1 then
    raise exception 'ENG guard: anchor for % found % times, expected 1. Live definition has changed; re-author the draft.', p_what, n;
  end if;
  return replace(p_src, p_anchor, p_new);
end $f$;

do $eng$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.fleet_km_by_asset(uuid,text,date,date)'::regprocedure);
  insert into _bak.fn_defs_eng_20261113 (fn, def) values ('fleet_km_by_asset', v_def);

  v_def := pg_temp.eng_replace_once(v_def,
    't.km_at_fitment > 0 and t.fitment_date is not null',
    't.km_at_fitment > 1 and t.fitment_date is not null',
    'fleet_km_by_asset fitment reading');

  v_def := pg_temp.eng_replace_once(v_def,
    't.km_at_removal > 0 and t.removal_date is not null',
    't.km_at_removal > 1 and t.removal_date is not null',
    'fleet_km_by_asset removal reading');

  execute v_def;
end $eng$;
