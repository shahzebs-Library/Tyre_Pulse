-- ENG-4: a road vehicle is measured in km even when its name contains a plant word.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definition of
--         public.cpk_unit_for_asset_type(text) (SELECT only). The anchor occurs
--         exactly once on the live text.
--
-- WHY. The unit rule is a keyword list: any type containing water, concrete,
-- loader, pump ... is costed per engine hour. "WATER TANKER", "CONCRETE MIXER
-- TRUCK" and "LOW LOADER TRAILER" are road vehicles and belong on the km side.
-- JS mirror (already changed): src/lib/costIntelligence.js isRoadVehicleType.
--
-- MEASURED read-only on 2026-11-12: applied to every distinct vehicle type in
-- the live fleet and tyre records, this changes the unit of NO existing type
-- in KSA, UAE or Egypt. It only matters for type names a new company brings.
--
-- RULE. Road words (tanker, trailer, truck, lorry, van, bus, pickup, pick up,
-- car, suv, mixer, prime mover, tractor head) win, unless the name also holds
-- an hour-metered machine word (pump, generator, genset, compressor,
-- excavator, forklift, dozer, grader). Whole words only.
--
-- RISK TO THE CURRENT COMPANY: none measured (no live type changes side).
--
-- VERIFY:
--   select public.cpk_unit_for_asset_type('WATER TANKER');          -- km
--   select public.cpk_unit_for_asset_type('CONCRETE MIXER TRUCK');  -- km
--   select public.cpk_unit_for_asset_type('LOW LOADER TRAILER');    -- km
--   select public.cpk_unit_for_asset_type('CONCRETE PUMP TRUCK');   -- engine_hours
--   select public.cpk_unit_for_asset_type('WHEEL LOADER');          -- engine_hours
--   select public.cpk_unit_for_asset_type('TR-MIXER');              -- km (unchanged)
--   -- and no live type may change:
--   -- compare old and new over select distinct vehicle_type from vehicle_fleet.
--
-- ROLLBACK: re-run the definition saved in _bak.fn_defs_eng_20261113 where
--   fn = 'cpk_unit_for_asset_type'.
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
  v_def := pg_get_functiondef('public.cpk_unit_for_asset_type(text)'::regprocedure);
  if position('tractor head' in v_def) > 0 then
    raise exception 'ENG guard: cpk_unit_for_asset_type already carries the road vehicle rule. Nothing to do.';
  end if;
  insert into _bak.fn_defs_eng_20261113 (fn, def) values ('cpk_unit_for_asset_type', v_def);

  v_def := pg_temp.eng_replace_once(v_def,
    'when lower(coalesce(p_type,'''')) similar to',
    'when lower(coalesce(p_type,'''')) ~ ''\m(tanker|trailer|truck|lorry|van|bus|pickup|pick up|pick-up|car|suv|mixer|prime mover|tractor head)\M''
     and lower(coalesce(p_type,'''')) !~ ''\m(pump|pumps|generator|genset|gen set|compressor|excavator|forklift|dozer|grader)\M''
      then ''km''
    when lower(coalesce(p_type,'''')) similar to',
    'cpk_unit_for_asset_type road override');

  execute v_def;
end $eng$;
