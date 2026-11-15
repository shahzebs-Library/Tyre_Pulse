-- ENG-2: the expected tyre life baseline uses the single tyre km rule.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definition of
--         public.get_tyre_running_life(text,integer,integer,text,boolean), read
--         with pg_get_functiondef (SELECT only). Each anchor was counted on the
--         live text on 2026-11-12 and occurs exactly once.
--
-- ROUND 2 (2026-11-15): EXECUTED ON LOCAL STAGING ONLY (PostgreSQL 16, production
--         schema, synthetic companies; database tp_eng), in order with drafts
--         120000 to 125000. Proven by supabase/tests/staging/eng_round2_staging.mjs
--         and src/test/engGoldenSqlParity.test.js. Still NOT applied to production.
--
-- WHY. The "measured" expected life of an active tyre is the average life of
-- the tyres already taken off (same size, same vehicle type when 3 or more).
-- That average read the stored total_km column directly, filtered only to
-- 1,000 to 400,000. total_km on a tyre fitted at the placeholder odometer "1"
-- is the MACHINE odometer, and nothing applied the class cap (mixer 80,000,
-- pump 56,000, loader 15,000, other 100,000). Every other life figure already
-- goes through public.tyre_km_life(). This one did not, so tyres were told to
-- expect a life the fleet never achieved and were flagged due too late.
-- Also: a tyre fitted at odometer 0 (factory fitment, a real reading per the
-- owner) was given no km run at all because the test was km_at_fitment > 1.
--
-- MEASURED read-only on 2026-11-12 (replica of the baseline, before -> after):
--   baseline mean removed-tyre life   KSA 42,631 -> 37,085 km (rows 5,215 -> 4,444)
--                                     UAE 42,147 -> 30,647 km (rows   681 ->   552)
--                                     Egypt 68,532 -> 34,580 km (rows   70 ->    53)
--   avg expected life, measured basis KSA 54,167 -> 31,280 km (197 active tyres)
--                                     UAE 22,267 -> 19,504 km (108)
--                                     Egypt 69,486 -> 38,968 km (411)
--   tyres flagged due                 KSA 358 -> 399, UAE 150 -> 153, Egypt 0 -> 0
--   active tyres with a km run        KSA 2,142 -> 2,176 (34 factory-zero fitments)
-- Tyres on a MANUAL life target are not affected (KSA 2,348, UAE 1,262).
--
-- WHAT THIS CHANGES. Three expressions inside get_tyre_running_life:
--  1. removed.total_km  = tyre_km_life(fit, rem, total, vehicle type)
--  2. removed filter    = that value >= 1000 (the cap replaces the 400,000 limit)
--  3. km_run            = also counted when km_at_fitment = 0
-- Output shape is unchanged. JS mirror: src/lib/tyreKm.js (already the rule);
-- src/test/tyreRunningLifeBands.test.js pins the due bands, unchanged here.
--
-- RISK TO THE CURRENT COMPANY: medium, and intended. Expected life falls for
-- tyres on the measured basis, so more tyres read due or overdue (KSA +41,
-- UAE +3) on Running and Remaining, Inspections due chips and the tyre life
-- report. No stored row changes. Tell the tyre team before applying.
--
-- VERIFY (signed-in Manager, read only):
--   select (j->>'total')::int, jsonb_array_length(j->'rows')
--     from (select public.get_tyre_running_life('KSA', null, 0, null, true) j) x;   -- expect about 399 due
--   select avg((r->>'expected_life_km')::numeric)
--     from jsonb_array_elements(public.get_tyre_running_life('KSA')->'rows') r
--    where r->>'life_basis' like 'measured%';                                      -- expect about 31,280
--   No row may show expected_life_km above its class cap on a measured basis.
--
-- ROLLBACK: re-run the definition saved by this script in
--   _bak.fn_defs_eng_20261113 where fn = 'get_tyre_running_life'.
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
declare
  v_def text;
  v_life text := 'public.tyre_km_life(t.km_at_fitment, t.km_at_removal, t.total_km, coalesce(nullif(btrim(t.vehicle_type), ''''), f.vehicle_type))';
begin
  v_def := pg_get_functiondef('public.get_tyre_running_life(text,integer,integer,text,boolean)'::regprocedure);
  insert into _bak.fn_defs_eng_20261113 (fn, def) values ('get_tyre_running_life', v_def);

  v_def := pg_temp.eng_replace_once(v_def,
    'select t.country, t.size, t.total_km,',
    'select t.country, t.size, ' || v_life || ' as total_km,',
    'running life removed.total_km');

  v_def := pg_temp.eng_replace_once(v_def,
    'and t.total_km between 1000 and 400000',
    'and ' || v_life || ' >= 1000',
    'running life removed filter');

  v_def := pg_temp.eng_replace_once(v_def,
    'case when a.km_at_fitment is not null and a.km_at_fitment > 1',
    'case when a.km_at_fitment is not null and (a.km_at_fitment > 1 or a.km_at_fitment = 0)',
    'running life km_run factory zero');

  execute v_def;
end $eng$;
