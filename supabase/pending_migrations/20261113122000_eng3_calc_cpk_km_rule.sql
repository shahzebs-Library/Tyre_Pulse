-- ENG-3: calc_cpk() uses the single tyre km rule (placeholder meter, class cap).
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definition of
--         public.calc_cpk(numeric,numeric,numeric) (SELECT only). The anchor
--         occurs exactly once on the live text.
--
-- WHY. calc_cpk(cost, km_fit, km_rem) divided by km_rem - km_fit whenever
-- km_rem > km_fit. A tyre fitted at the placeholder odometer "1" therefore got
-- the whole machine odometer as its life and a CPK far too low, and no cap
-- applied. It feeds view v_tyre_master and get_country_kpi. JS already refuses
-- these rows (src/lib/tyreLifetime.js fitmentCpk over src/lib/tyreKm.js).
--
-- MEASURED read-only on 2026-11-12, rows that receive a row CPK, before -> after:
--   KSA 1,829 -> 1,688 (89 of the lost rows are placeholder fitments, the rest over the cap)
--   UAE   140 ->   113 (16 placeholder)
--   Egypt  52 ->    41
-- Rows that lose a CPK show N/A. No row gains a different non-null value except
-- factory-zero fitments (km_fit = 0), which keep km_rem as before.
--
-- NOTE. calc_cpk has no vehicle type argument, so the general 100,000 km cap
-- applies here; the tighter class caps apply where the type is known
-- (get_tyre_lifetime_cpk, fitmentCpk).
--
-- RISK TO THE CURRENT COMPANY: low. Fewer rows carry a CPK on the tyre master
-- view and the country KPI average moves up slightly (the removed values were
-- the implausibly cheap ones). No stored row changes.
--
-- VERIFY:
--   select public.calc_cpk(1500, 1, 250000);      -- null (placeholder)
--   select public.calc_cpk(1500, 40000, 62000);   -- 0.0682
--   select public.calc_cpk(1500, 0, 30000);       -- 0.0500 (factory fitment)
--   select public.calc_cpk(1500, 10000, 200000);  -- null (over the cap)
--
-- ROLLBACK: re-run the definition saved in _bak.fn_defs_eng_20261113 where
--   fn = 'calc_cpk'.
-- ---------------------------------------------------------------------------

create schema if not exists _bak;
create table if not exists _bak.fn_defs_eng_20261113 (
  fn text not null, captured_at timestamptz not null default now(), def text not null);

-- Replace an anchor that must occur exactly once. Anything else aborts the script.
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
  v_def := pg_get_functiondef('public.calc_cpk(numeric,numeric,numeric)'::regprocedure);
  insert into _bak.fn_defs_eng_20261113 (fn, def) values ('calc_cpk', v_def);

  v_def := pg_temp.eng_replace_once(v_def,
    'then round(cost::numeric / (km_rem - km_fit), 4)',
    'and public.tyre_km_life(km_fit, km_rem, null, null) > 0
    then round(cost::numeric / public.tyre_km_life(km_fit, km_rem, null, null), 4)',
    'calc_cpk divisor');

  execute v_def;
end $eng$;
