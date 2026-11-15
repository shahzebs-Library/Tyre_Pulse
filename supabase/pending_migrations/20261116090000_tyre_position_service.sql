-- =====================================================================================
-- Tyre position service (SQL mirror of src/lib/tyrePositionService.js)
--
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner review. Tested on the local staging
--         database (tp_position) and under PGlite only. Nothing here ran on production.
--
-- WHAT: pure functions that resolve an inspection SLOT id (R1Ro, F2L, RR) or an ERP
--       position CODE (LHCO, RHF2, RHR1) to ONE canonical wheel on a machine's ACTUAL
--       wheel layout, and say how sure they are:
--         { canonical, slot, status: resolved | ambiguous | unknown | inconsistent, reason }
--       Anything but 'resolved' is neither a match nor a mismatch: pending manual review.
--
-- ORDER: 2 of 3. Follow-up to the applied migration 20261115120000 (production version
--       20261115090615). Apply 20261116085000_tyre_layout_versions_and_position_mappings.sql first,
--       then this file, then 20261116091000_observation_erp_decide_on_position_service.sql.
--
-- WHY:  corrective_actions.source_detail stores the slot id, tyre_records.position stores
--       the ERP code, and the same slot id is a different wheel on a different machine.
--       Comparing the two as text can never match (0 of 19 open actions on 2026-11-15).
--
-- MIRROR: tyre_layout_key / tyre_layout_for / tyre_position_resolve / tyre_position_compare
--       are pinned to the JS by ONE fixture, src/test/fixtures/tyrePositionCases.json
--       (src/test/tyrePositionMirror.test.js and supabase/tests/tyre_position_service.test.mjs).
--       The built-in wheel table below is GENERATED from the JS layouts; the JS test fails
--       if it drifts. CHANGE BOTH SIDES TOGETHER.
--
-- LAYOUT HISTORY: read from vehicle_diagram_config_versions (20261116085000). A record is
--       resolved on the layout version in force on its own date; where that is not recorded
--       (before a backfilled version, or a layout edited on the record's own day) the result
--       is "layout changed since record" (pending), never a guess.
-- ERP SPELLINGS: there is NO built-in reading of the dual-rear spelling (LHRCO, RHRRI) on any
--       layout (owner decision 2026-11-15). It resolves only through a mapping verified and
--       recorded for that layout in tyre_layout_position_mappings, which ships empty.
--       CONCRETE PUMPS: production data (read-only, 2026-11-15) shows the ERP naming the rear
--       wheels of one 5-axle pump three ways at once (numbered R1, rear centre, rear rear) and
--       never a third front axle, so its "R1" is not known to be the drawing's first rear axle.
--       On the pump layouts NO rear ERP code is read without a verified mapping. Front codes are.
--
-- STATUS NOTE: do not apply without the owner's approval (withdrawn 2026-11-15 pending these changes).
--
-- SAFETY: no table is created, no row is written, no existing object is replaced.
--       The pure functions are IMMUTABLE and read nothing. tyre_asset_layout / tyre_type_layout read
--       vehicle_fleet, the layout versions and the verified mappings for an EXPLICIT organisation, so they are
--       not executable by authenticated or anon (only by definer functions that have
--       already checked the caller).
--
-- VERIFY (rolled back):
--   begin;
--   select public.tyre_position_compare(public.tyre_layout_for('TR-MIXER','TM001',null,null,null,null),'R1Ro','RHCO');
--     -- expect match true, canonical RHCO
--   select public.tyre_position_compare(public.tyre_layout_for('TR-MIXER','TM001',null,null,null,null),'R1Ro','RHR1-O');
--     -- expect match null, status ambiguous
--   select public.tyre_position_resolve(public.tyre_layout_for('GENERATOR',null,null,null,null,null),'FL','slot');
--     -- expect status unknown, reason tyreless_equipment
--   select has_function_privilege('anon','public.tyre_asset_layout(uuid,text,text,text,date)','execute'),
--          has_function_privilege('authenticated','public.tyre_asset_layout(uuid,text,text,text,date)','execute');
--     -- expect f, f
--   rollback;
--
-- ROLLBACK (the only place this file names a removal; nothing depends on these functions
-- until 20261116091000 is applied):
--   drop function if exists public.tyre_asset_layout(uuid,text,text,text,date);
--   drop function if exists public.tyre_type_layout(uuid,text,text,integer,date);
--   drop function if exists public.tyre_position_compare(jsonb,text,text);
--   drop function if exists public.tyre_position_resolve(jsonb,text,text);
--   drop function if exists public.tyre_layout_for(text,text,integer,jsonb,date,date);
--   drop function if exists public.tyre_layout_custom_wheels(jsonb);
--   drop function if exists public.tyre_layout_builtin_wheels(text);
--   drop function if exists public.tyre_layout_key(text,text,integer);
--   drop function if exists public.tyre_layout_key_one(text);
--   drop function if exists public.tyre_type_is_tyreless(text);
--   drop function if exists public.tyre_position_canonical_code(text);
--   drop function if exists public.tyre_position_parse(text);
--   drop function if exists public.tyre_position_token(text);
-- =====================================================================================

-- Upper case, no whitespace: the comparison form of any position text.
create or replace function public.tyre_position_token(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g'))
$$;

-- Mirror of tyrePositions.parsePosition. Null when the text is not a position code.
create or replace function public.tyre_position_parse(p text)
returns jsonb language plpgsql immutable parallel safe set search_path = '' as $$
declare
  s text := public.tyre_position_token(p);
  m text[];
begin
  if s = '' then return null; end if;
  m := regexp_match(s, '^(TL|TR|LA|TG|TAG)(\d*)$');
  if m is not null then
    return jsonb_build_object('raw', s, 'side', null, 'axle', m[1],
      'axle_no', case when m[2] <> '' then m[2]::numeric end, 'io', null);
  end if;
  m := regexp_match(s, '^(L|R)H?([FCR])(\d*)-?([IO])?$');
  if m is null then return null; end if;
  return jsonb_build_object('raw', s, 'side', m[1], 'axle', m[2],
    'axle_no', case when m[3] <> '' then m[3]::numeric end, 'io', m[4]);
end $$;

-- Mirror of tyrePositions.canonicalCode.
create or replace function public.tyre_position_canonical_code(p text)
returns text language plpgsql immutable parallel safe set search_path = '' as $$
declare
  j jsonb := public.tyre_position_parse(p);
  no text;
begin
  if j is null then
    return nullif(regexp_replace(coalesce(p, ''), '^\s+|\s+$', '', 'g'), '');
  end if;
  if j->>'side' is null then return j->>'raw'; end if;
  no := coalesce((j->>'axle_no'), '');
  return (j->>'side') || 'H' || (j->>'axle') || no
    || case when j->>'io' is null then ''
            when no <> '' then '-' || (j->>'io') else (j->>'io') end;
end $$;

-- Mirror of vehicleTyreLayout.isTyrelessEquipment.
create or replace function public.tyre_type_is_tyreless(p_vehicle_type text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select coalesce(lower(regexp_replace(coalesce(p_vehicle_type, ''), '^\s+|\s+$', '', 'g'))
    ~ '(generator|genset|chiller|reclaimer|compressor|tower light|light tower|plant|batch|placing boom|placing|stationary|building)', false)
$$;

-- Mirror of vehicleTyreLayout.resolveOne: ONE string to a layout key, null when nothing matched.
create or replace function public.tyre_layout_key_one(p text)
returns text language plpgsql immutable parallel safe set search_path = '' as $$
declare
  v_raw text := regexp_replace(coalesce(p, ''), '^\s+|\s+$', '', 'g');
  s text;
  c text;
  m text[];
  n numeric;
begin
  if v_raw = '' then return null; end if;
  s := lower(v_raw);
  c := regexp_replace(s, '[\s\-_]+', '', 'g');
  case c
    when 'pickup' then return 'Pickup';
    when 'wheelloader' then return 'Wheel loader';
    when 'skidloader' then return 'Skid loader';
    when 'canter' then return 'Canter';
    when 'bus' then return 'Bus';
    when 'tata' then return 'Tata';
    when 'ashokleyland' then return 'Ashok Leyland';
    when 'tanker' then return 'Tanker';
    when 'trailer' then return 'Trailer';
    when 'truck6x4' then return 'Truck 6x4';
    when 'trimixer' then return 'Tri-mixer';
    when 'linepump' then return 'Line pump';
    when 'concretepump' then return 'Concrete pump';
    when 'concretepump4axle' then return 'Concrete pump 4-axle';
    else null;
  end case;
  m := regexp_match(v_raw, '^([A-Za-z]{2,3})\s*\d');
  if m is not null then
    case upper(left(m[1], 2))
      when 'TM' then return 'Tri-mixer';
      when 'MP' then return 'Concrete pump';
      when 'WL' then return 'Wheel loader';
      when 'SL' then return 'Skid loader';
      when 'PL' then return 'Pickup';
      else null;
    end case;
  end if;
  m := regexp_match(c, '(\d+)wheeler');
  if m is not null then
    n := m[1]::numeric;
    if n >= 12 then return 'Tri-mixer'; end if;
    if n >= 8 then return 'Truck 6x4'; end if;
    if n >= 6 then return 'Canter'; end if;
    return 'Pickup';
  end if;
  if s like '%tri%' or s like '%mixer%' or s like '%transit%' then return 'Tri-mixer'; end if;
  if s like '%placing%' or s like '%stationary%' then return 'Pickup'; end if;
  if c like '%linepump%' then return 'Line pump'; end if;
  if c like '%spiderpump%' or s like '%spider%' then return 'Truck 6x4'; end if;
  if s like '%boom%' then return 'Concrete pump'; end if;
  if s like '%concrete%' or s like '%pump%' then return 'Concrete pump'; end if;
  if s like '%skid%' then return 'Skid loader'; end if;
  if s like '%wheel%' or s like '%loader%' or s like '%load%' then return 'Wheel loader'; end if;
  if s like '%canter%' then return 'Canter'; end if;
  if s like '%bus%' or s like '%coaster%' then return 'Bus'; end if;
  if s like '%tata%' then return 'Tata'; end if;
  if s like '%ashok%' or s like '%leyland%' then return 'Ashok Leyland'; end if;
  if s like '%pickup%' or s like '%pick up%' or s like '%pick-up%' then return 'Pickup'; end if;
  if s like '%tanker%' then return 'Tanker'; end if;
  if s like '%trailer%' or c like '%trl%' then return 'Trailer'; end if;
  if s like '%crane%' or s like '%truck%' then return 'Truck 6x4'; end if;
  return null;
end $$;

-- Mirror of resolveLayoutKeyStrict + the per-machine axle build (4 axle concrete pump).
-- Null when neither the type nor the asset number identifies a machine.
create or replace function public.tyre_layout_key(p_vehicle_type text, p_asset_no text, p_axle_count integer)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case
    when k = 'Concrete pump' and p_axle_count = 4 then 'Concrete pump 4-axle'
    else k end
  from (select coalesce(public.tyre_layout_key_one(p_vehicle_type), public.tyre_layout_key_one(p_asset_no)) as k) x
$$;

-- The wheels of a built-in layout. GENERATED from src/lib/vehicleTyreLayout.js LAYOUT_SLOTS
-- and tyrePositions.legacyPositionCode. Do not edit by hand: run
--   UPDATE_POSITION_FIXTURE=1 npx vitest run src/test/tyrePositionMirror.test.js
create or replace function public.tyre_layout_builtin_wheels(p_key text)
returns jsonb language sql immutable parallel safe set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('slot', w.slot, 'code', w.code, 'grp', w.grp,
    'ord', w.ord, 'side', w.side, 'io', w.io) order by w.n), '[]'::jsonb)
  from (values
-- BEGIN GENERATED BUILTIN WHEELS
    ('Pickup', 1, 'FL', 'LHF1', 'F', 1, 'L', null),
    ('Pickup', 2, 'FR', 'RHF1', 'F', 1, 'R', null),
    ('Pickup', 3, 'RL', 'LHR1', 'R', 1, 'L', null),
    ('Pickup', 4, 'RR', 'RHR1', 'R', 1, 'R', null),
    ('Wheel loader', 1, 'FL', 'LHF1', 'F', 1, 'L', null),
    ('Wheel loader', 2, 'FR', 'RHF1', 'F', 1, 'R', null),
    ('Wheel loader', 3, 'RL', 'LHR1', 'R', 1, 'L', null),
    ('Wheel loader', 4, 'RR', 'RHR1', 'R', 1, 'R', null),
    ('Skid loader', 1, 'FL', 'LHF1', 'F', 1, 'L', null),
    ('Skid loader', 2, 'FR', 'RHF1', 'F', 1, 'R', null),
    ('Skid loader', 3, 'RL', 'LHR1', 'R', 1, 'L', null),
    ('Skid loader', 4, 'RR', 'RHR1', 'R', 1, 'R', null),
    ('Canter', 1, 'FL', 'LHF1', 'F', 1, 'L', null),
    ('Canter', 2, 'FR', 'RHF1', 'F', 1, 'R', null),
    ('Canter', 3, 'RLo', 'LHRO', 'R', 1, 'L', 'O'),
    ('Canter', 4, 'RLi', 'LHRI', 'R', 1, 'L', 'I'),
    ('Canter', 5, 'RRi', 'RHRI', 'R', 1, 'R', 'I'),
    ('Canter', 6, 'RRo', 'RHRO', 'R', 1, 'R', 'O'),
    ('Bus', 1, 'FL', 'LHF1', 'F', 1, 'L', null),
    ('Bus', 2, 'FR', 'RHF1', 'F', 1, 'R', null),
    ('Bus', 3, 'RLo', 'LHRO', 'R', 1, 'L', 'O'),
    ('Bus', 4, 'RLi', 'LHRI', 'R', 1, 'L', 'I'),
    ('Bus', 5, 'RRi', 'RHRI', 'R', 1, 'R', 'I'),
    ('Bus', 6, 'RRo', 'RHRO', 'R', 1, 'R', 'O'),
    ('Tata', 1, 'FL', 'LHF1', 'F', 1, 'L', null),
    ('Tata', 2, 'FR', 'RHF1', 'F', 1, 'R', null),
    ('Tata', 3, 'RLo', 'LHRO', 'R', 1, 'L', 'O'),
    ('Tata', 4, 'RLi', 'LHRI', 'R', 1, 'L', 'I'),
    ('Tata', 5, 'RRi', 'RHRI', 'R', 1, 'R', 'I'),
    ('Tata', 6, 'RRo', 'RHRO', 'R', 1, 'R', 'O'),
    ('Ashok Leyland', 1, 'FL', 'LHF1', 'F', 1, 'L', null),
    ('Ashok Leyland', 2, 'FR', 'RHF1', 'F', 1, 'R', null),
    ('Ashok Leyland', 3, 'RLo', 'LHRO', 'R', 1, 'L', 'O'),
    ('Ashok Leyland', 4, 'RLi', 'LHRI', 'R', 1, 'L', 'I'),
    ('Ashok Leyland', 5, 'RRi', 'RHRI', 'R', 1, 'R', 'I'),
    ('Ashok Leyland', 6, 'RRo', 'RHRO', 'R', 1, 'R', 'O'),
    ('Tanker', 1, 'FL', 'LHF1', 'F', 1, 'L', null),
    ('Tanker', 2, 'FR', 'RHF1', 'F', 1, 'R', null),
    ('Tanker', 3, 'RLo', 'LHRO', 'R', 1, 'L', 'O'),
    ('Tanker', 4, 'RLi', 'LHRI', 'R', 1, 'L', 'I'),
    ('Tanker', 5, 'RRi', 'RHRI', 'R', 1, 'R', 'I'),
    ('Tanker', 6, 'RRo', 'RHRO', 'R', 1, 'R', 'O'),
    ('Trailer', 1, 'R1Lo', 'LHR1-O', 'R', 1, 'L', 'O'),
    ('Trailer', 2, 'R1Li', 'LHR1-I', 'R', 1, 'L', 'I'),
    ('Trailer', 3, 'R1Ri', 'RHR1-I', 'R', 1, 'R', 'I'),
    ('Trailer', 4, 'R1Ro', 'RHR1-O', 'R', 1, 'R', 'O'),
    ('Trailer', 5, 'R2Lo', 'LHR2-O', 'R', 2, 'L', 'O'),
    ('Trailer', 6, 'R2Li', 'LHR2-I', 'R', 2, 'L', 'I'),
    ('Trailer', 7, 'R2Ri', 'RHR2-I', 'R', 2, 'R', 'I'),
    ('Trailer', 8, 'R2Ro', 'RHR2-O', 'R', 2, 'R', 'O'),
    ('Truck 6x4', 1, 'FL', 'LHF1', 'F', 1, 'L', null),
    ('Truck 6x4', 2, 'FR', 'RHF1', 'F', 1, 'R', null),
    ('Truck 6x4', 3, 'R1Lo', 'LHR1-O', 'R', 1, 'L', 'O'),
    ('Truck 6x4', 4, 'R1Li', 'LHR1-I', 'R', 1, 'L', 'I'),
    ('Truck 6x4', 5, 'R1Ri', 'RHR1-I', 'R', 1, 'R', 'I'),
    ('Truck 6x4', 6, 'R1Ro', 'RHR1-O', 'R', 1, 'R', 'O'),
    ('Truck 6x4', 7, 'R2Lo', 'LHR2-O', 'R', 2, 'L', 'O'),
    ('Truck 6x4', 8, 'R2Li', 'LHR2-I', 'R', 2, 'L', 'I'),
    ('Truck 6x4', 9, 'R2Ri', 'RHR2-I', 'R', 2, 'R', 'I'),
    ('Truck 6x4', 10, 'R2Ro', 'RHR2-O', 'R', 2, 'R', 'O'),
    ('Tri-mixer', 1, 'F1L', 'LHF1', 'F', 1, 'L', null),
    ('Tri-mixer', 2, 'F1R', 'RHF1', 'F', 1, 'R', null),
    ('Tri-mixer', 3, 'F2L', 'LHF2', 'F', 2, 'L', null),
    ('Tri-mixer', 4, 'F2R', 'RHF2', 'F', 2, 'R', null),
    ('Tri-mixer', 5, 'R1Lo', 'LHCO', 'R', 1, 'L', 'O'),
    ('Tri-mixer', 6, 'R1Li', 'LHCI', 'R', 1, 'L', 'I'),
    ('Tri-mixer', 7, 'R1Ri', 'RHCI', 'R', 1, 'R', 'I'),
    ('Tri-mixer', 8, 'R1Ro', 'RHCO', 'R', 1, 'R', 'O'),
    ('Tri-mixer', 9, 'R2Lo', 'LHRO', 'R', 2, 'L', 'O'),
    ('Tri-mixer', 10, 'R2Li', 'LHRI', 'R', 2, 'L', 'I'),
    ('Tri-mixer', 11, 'R2Ri', 'RHRI', 'R', 2, 'R', 'I'),
    ('Tri-mixer', 12, 'R2Ro', 'RHRO', 'R', 2, 'R', 'O'),
    ('Line pump', 1, 'F1L', 'LHF1', 'F', 1, 'L', null),
    ('Line pump', 2, 'F1R', 'RHF1', 'F', 1, 'R', null),
    ('Line pump', 3, 'F2L', 'LHF2', 'F', 2, 'L', null),
    ('Line pump', 4, 'F2R', 'RHF2', 'F', 2, 'R', null),
    ('Line pump', 5, 'R1Lo', 'LHR1-O', 'R', 1, 'L', 'O'),
    ('Line pump', 6, 'R1Li', 'LHR1-I', 'R', 1, 'L', 'I'),
    ('Line pump', 7, 'R1Ri', 'RHR1-I', 'R', 1, 'R', 'I'),
    ('Line pump', 8, 'R1Ro', 'RHR1-O', 'R', 1, 'R', 'O'),
    ('Line pump', 9, 'R2Lo', 'LHR2-O', 'R', 2, 'L', 'O'),
    ('Line pump', 10, 'R2Li', 'LHR2-I', 'R', 2, 'L', 'I'),
    ('Line pump', 11, 'R2Ri', 'RHR2-I', 'R', 2, 'R', 'I'),
    ('Line pump', 12, 'R2Ro', 'RHR2-O', 'R', 2, 'R', 'O'),
    ('Concrete pump', 1, 'F1L', 'LHF1', 'F', 1, 'L', null),
    ('Concrete pump', 2, 'F1R', 'RHF1', 'F', 1, 'R', null),
    ('Concrete pump', 3, 'F2L', 'LHF2', 'F', 2, 'L', null),
    ('Concrete pump', 4, 'F2R', 'RHF2', 'F', 2, 'R', null),
    ('Concrete pump', 5, 'F3L', 'LHF3', 'F', 3, 'L', null),
    ('Concrete pump', 6, 'F3R', 'RHF3', 'F', 3, 'R', null),
    ('Concrete pump', 7, 'R1Lo', 'LHR1-O', 'R', 1, 'L', 'O'),
    ('Concrete pump', 8, 'R1Li', 'LHR1-I', 'R', 1, 'L', 'I'),
    ('Concrete pump', 9, 'R1Ri', 'RHR1-I', 'R', 1, 'R', 'I'),
    ('Concrete pump', 10, 'R1Ro', 'RHR1-O', 'R', 1, 'R', 'O'),
    ('Concrete pump', 11, 'R2Lo', 'LHR2-O', 'R', 2, 'L', 'O'),
    ('Concrete pump', 12, 'R2Li', 'LHR2-I', 'R', 2, 'L', 'I'),
    ('Concrete pump', 13, 'R2Ri', 'RHR2-I', 'R', 2, 'R', 'I'),
    ('Concrete pump', 14, 'R2Ro', 'RHR2-O', 'R', 2, 'R', 'O'),
    ('Concrete pump 4-axle', 1, 'F1L', 'LHF1', 'F', 1, 'L', null),
    ('Concrete pump 4-axle', 2, 'F1R', 'RHF1', 'F', 1, 'R', null),
    ('Concrete pump 4-axle', 3, 'F2L', 'LHF2', 'F', 2, 'L', null),
    ('Concrete pump 4-axle', 4, 'F2R', 'RHF2', 'F', 2, 'R', null),
    ('Concrete pump 4-axle', 5, 'R1Lo', 'LHR1-O', 'R', 1, 'L', 'O'),
    ('Concrete pump 4-axle', 6, 'R1Li', 'LHR1-I', 'R', 1, 'L', 'I'),
    ('Concrete pump 4-axle', 7, 'R1Ri', 'RHR1-I', 'R', 1, 'R', 'I'),
    ('Concrete pump 4-axle', 8, 'R1Ro', 'RHR1-O', 'R', 1, 'R', 'O'),
    ('Concrete pump 4-axle', 9, 'R2Lo', 'LHR2-O', 'R', 2, 'L', 'O'),
    ('Concrete pump 4-axle', 10, 'R2Li', 'LHR2-I', 'R', 2, 'L', 'I'),
    ('Concrete pump 4-axle', 11, 'R2Ri', 'RHR2-I', 'R', 2, 'R', 'I'),
    ('Concrete pump 4-axle', 12, 'R2Ro', 'RHR2-O', 'R', 2, 'R', 'O')
-- END GENERATED BUILTIN WHEELS
  ) as w(k, n, slot, code, grp, ord, side, io)
  where w.k = p_key
$$;

-- Mirror of vehicleDiagram.normalizeDiagramConfig + positionsFromConfig (wheel list only).
create or replace function public.tyre_layout_custom_wheels(p_config jsonb)
returns jsonb language plpgsql immutable parallel safe set search_path = '' as $$
declare
  v_axles jsonb := case when jsonb_typeof(p_config->'axles') = 'array' then p_config->'axles' else '[]'::jsonb end;
  v_out jsonb := '[]'::jsonb;
  a jsonb;
  i int := 0;
  f int := 0;
  r int := 0;
  g text;
  n int;
  v_dual boolean;
  v_spare numeric := 0;
begin
  if jsonb_array_length(v_axles) < 1 then
    v_axles := '[{"kind":"steer","dual":false},{"kind":"drive","dual":true}]'::jsonb;
  end if;
  for a in select value from jsonb_array_elements(v_axles) with ordinality as t(value, o) where o <= 6 order by o loop
    i := i + 1;
    v_dual := (jsonb_typeof(a) = 'object' and a->'dual' = 'true'::jsonb);
    if jsonb_typeof(a) = 'object' and a->>'kind' = 'steer' then
      f := f + 1; g := 'F'; n := f;
    else
      r := r + 1; g := 'R'; n := r;
    end if;
    if v_dual then
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('slot', g || n || 'Lo', 'code', 'LH' || g || n || '-O', 'grp', g, 'ord', n, 'side', 'L', 'io', 'O'),
        jsonb_build_object('slot', g || n || 'Li', 'code', 'LH' || g || n || '-I', 'grp', g, 'ord', n, 'side', 'L', 'io', 'I'),
        jsonb_build_object('slot', g || n || 'Ri', 'code', 'RH' || g || n || '-I', 'grp', g, 'ord', n, 'side', 'R', 'io', 'I'),
        jsonb_build_object('slot', g || n || 'Ro', 'code', 'RH' || g || n || '-O', 'grp', g, 'ord', n, 'side', 'R', 'io', 'O'));
    else
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('slot', g || n || 'L', 'code', 'LH' || g || n, 'grp', g, 'ord', n, 'side', 'L', 'io', null),
        jsonb_build_object('slot', g || n || 'R', 'code', 'RH' || g || n, 'grp', g, 'ord', n, 'side', 'R', 'io', null));
    end if;
  end loop;
  if jsonb_typeof(p_config->'spare') = 'number' then
    v_spare := least(2, greatest(0, floor((p_config->>'spare')::numeric + 0.5)));
  end if;
  if v_spare >= 1 then
    v_out := v_out || jsonb_build_array(jsonb_build_object('slot', 'SP1', 'code', 'SP1', 'grp', 'S', 'ord', 1, 'side', null, 'io', null));
  end if;
  if v_spare >= 2 then
    v_out := v_out || jsonb_build_array(jsonb_build_object('slot', 'SP2', 'code', 'SP2', 'grp', 'S', 'ord', 2, 'side', null, 'io', null));
  end if;
  return v_out;
end $$;

-- Mirror of tyrePositionService.resolveLayout (without a supplied history: none is stored).
--   p_custom_config  the ACTIVE admin layout for this exact vehicle type, or null
--   p_custom_changed the day that layout was last changed, or null
--   p_as_of          the day of the record being read, or null
create or replace function public.tyre_layout_for(
  p_vehicle_type text, p_asset_no text, p_axle_count integer,
  p_custom_config jsonb, p_custom_changed date, p_as_of date)
returns jsonb language plpgsql immutable parallel safe set search_path = '' as $$
declare
  v_vt text := regexp_replace(coalesce(p_vehicle_type, ''), '^\s+|\s+$', '', 'g');
  v_asset text := regexp_replace(coalesce(p_asset_no, ''), '^\s+|\s+$', '', 'g');
  v_key text;
  v_wheels jsonb;
begin
  if p_custom_config is not null and jsonb_typeof(p_custom_config) = 'object' and v_vt <> '' then
    v_wheels := public.tyre_layout_custom_wheels(p_custom_config);
    if jsonb_array_length(v_wheels) > 0 then
      return jsonb_build_object('status', 'resolved', 'reason', 'custom_layout',
        'key', 'custom:' || upper(regexp_replace(v_vt, '\s+', ' ', 'g')), 'source', 'custom', 'basis', 'current',
        'changed_after_record', coalesce(p_as_of is not null and p_custom_changed is not null and p_custom_changed > p_as_of, false),
        'wheels', v_wheels);
    end if;
  end if;
  if v_vt = '' and v_asset = '' then
    return jsonb_build_object('status', 'unknown', 'reason', 'no_vehicle_type', 'key', null, 'wheels', '[]'::jsonb);
  end if;
  if public.tyre_type_is_tyreless(v_vt) then
    return jsonb_build_object('status', 'unknown', 'reason', 'tyreless_equipment', 'key', null, 'wheels', '[]'::jsonb);
  end if;
  v_key := public.tyre_layout_key(v_vt, v_asset, p_axle_count);
  if v_key is null then
    return jsonb_build_object('status', 'unknown', 'reason', 'unknown_vehicle_type', 'key', null, 'wheels', '[]'::jsonb);
  end if;
  v_wheels := public.tyre_layout_builtin_wheels(v_key);
  if jsonb_array_length(v_wheels) = 0 then
    return jsonb_build_object('status', 'unknown', 'reason', 'unknown_vehicle_type', 'key', null, 'wheels', '[]'::jsonb);
  end if;
  return jsonb_build_object('status', 'resolved', 'reason', 'builtin_layout', 'key', v_key,
    'source', 'builtin', 'basis', 'current', 'changed_after_record', false, 'wheels', v_wheels);
end $$;

-- Mirror of tyrePositionService.resolveWheel.
--   p_kind 'slot' (from an inspection), 'erp' (from tyre records), anything else = 'any'.
create or replace function public.tyre_position_resolve(p_layout jsonb, p_token text, p_kind text)
returns jsonb language plpgsql immutable parallel safe set search_path = '' as $$
declare
  v_text text := regexp_replace(coalesce(p_token, ''), '^\s+|\s+$', '', 'g');
  u text := public.tyre_position_token(p_token);
  v_kind text := case when p_kind in ('slot', 'erp') then p_kind else 'any' end;
  v_wheels jsonb := coalesce(p_layout->'wheels', '[]'::jsonb);
  v_slot jsonb;      -- reading as a slot id (null = not a slot of this layout)
  v_code jsonb;      -- reading as a position code (null = not a code)
  v_parsed jsonb;
  v_target text;
  v_group text;
  v_axles int;
  v_n int;
  v_hit jsonb;
  v_slot_shaped boolean;
  v_spare text[];
  v_layout_numbered boolean;
begin
  if p_layout is null or coalesce(p_layout->>'status', '') <> 'resolved' then
    return jsonb_build_object('canonical', null, 'slot', null, 'status', 'unknown',
      'reason', coalesce(p_layout->>'reason', 'no_layout'));
  end if;
  if v_text = '' or u = 'UNKNOWNPOSITION' then
    return jsonb_build_object('canonical', null, 'slot', null, 'status', 'unknown', 'reason', 'missing_position');
  end if;
  if coalesce((p_layout->>'changed_after_record')::boolean, false) then
    return jsonb_build_object('canonical', null, 'slot', null, 'status', 'ambiguous', 'reason', 'layout_changed_since_record');
  end if;

  -- ---- as a slot id
  select w into v_hit from jsonb_array_elements(v_wheels) w
    where public.tyre_position_token(w->>'slot') = u limit 1;
  v_spare := regexp_match(u, '^(SP|SPARE)(\d?)$');
  if v_hit is not null then
    v_slot := jsonb_build_object('canonical', v_hit->>'code', 'slot', v_hit->>'slot', 'status', 'resolved', 'reason', 'slot');
  elsif v_spare is not null then
    select count(*) into v_n from jsonb_array_elements(v_wheels) w where w->>'grp' = 'S';
    if v_n = 0 or v_spare[2] <> '' then
      v_slot := jsonb_build_object('canonical', null, 'slot', null, 'status', 'unknown', 'reason', 'spare_not_on_layout');
    elsif v_n = 1 then
      select w into v_hit from jsonb_array_elements(v_wheels) w where w->>'grp' = 'S' limit 1;
      v_slot := jsonb_build_object('canonical', v_hit->>'code', 'slot', v_hit->>'slot', 'status', 'resolved', 'reason', 'slot');
    else
      v_slot := jsonb_build_object('canonical', null, 'slot', null, 'status', 'ambiguous', 'reason', 'spare_not_specified');
    end if;
  end if;

  -- ---- as a position code
  -- 1. A mapping VERIFIED for this layout (tyre_layout_position_mappings) wins.
  select w into v_hit from jsonb_array_elements(coalesce(p_layout->'mappings', '[]'::jsonb)) m
    join jsonb_array_elements(v_wheels) w on w->>'slot' = m->>'slot'
    where m->>'code' = u limit 1;
  if v_hit is not null then
    v_code := jsonb_build_object('canonical', v_hit->>'code', 'slot', v_hit->>'slot', 'status', 'resolved', 'reason', 'verified_mapping');
  elsif u ~ '^(L|R)HR([CR])([IO])$'
     -- Concrete pumps: the ERP names the rear wheels of one machine three ways at once (numbered
     -- R1, rear centre, rear rear), so no rear ERP code is read on a pump layout until a mapping
     -- is verified for it, not even one spelled exactly like a wheel of the layout.
     or (v_kind = 'erp' and p_layout->>'key' in ('Concrete pump', 'Concrete pump 4-axle') and u ~ '^(L|R)H?[RC]') then
    -- 2. The ERP's dual-rear spelling (LHRCO "rear centre", RHRRI "rear rear"). Which axle that
    --    is has not been verified for any layout: no built-in reading, pending until mapped.
    v_code := jsonb_build_object('canonical', null, 'slot', null, 'status', 'ambiguous', 'reason', 'erp_spelling_not_verified');
  else
  v_parsed := public.tyre_position_parse(v_text);
  if v_parsed is not null then
    if v_parsed->>'side' is null then
      v_code := jsonb_build_object('canonical', null, 'slot', null, 'status', 'unknown', 'reason', 'axle_group_not_on_layout');
    else
      v_target := public.tyre_position_token(public.tyre_position_canonical_code(v_text));
      select count(*) into v_n from jsonb_array_elements(v_wheels) w where w->>'code' = v_target;
      if v_n = 1 then
        select w into v_hit from jsonb_array_elements(v_wheels) w where w->>'code' = v_target limit 1;
        v_code := jsonb_build_object('canonical', v_hit->>'code', 'slot', v_hit->>'slot', 'status', 'resolved', 'reason', 'code');
      else
        v_group := case when v_parsed->>'axle' = 'F' then 'F' else 'R' end;
        select count(distinct w->>'ord') into v_axles from jsonb_array_elements(v_wheels) w where w->>'grp' = v_group;
        if v_parsed->>'axle' = 'C' then
          v_code := jsonb_build_object('canonical', null, 'slot', null,
            'status', case when v_axles >= 2 then 'ambiguous' else 'unknown' end,
            'reason', case when v_axles >= 2 then 'numbering_scheme_differs' else 'position_not_on_layout' end);
        else
          select count(*) into v_n from jsonb_array_elements(v_wheels) w
            where w->>'grp' = v_group and w->>'side' = v_parsed->>'side'
              and (v_parsed->>'axle_no' is null or (w->>'ord')::numeric = (v_parsed->>'axle_no')::numeric);
          if v_n = 0 then
            v_code := jsonb_build_object('canonical', null, 'slot', null, 'status', 'unknown', 'reason', 'position_not_on_layout');
          else
            select count(*) into v_n from jsonb_array_elements(v_wheels) w
              where w->>'grp' = v_group and w->>'side' = v_parsed->>'side'
                and (v_parsed->>'axle_no' is null or (w->>'ord')::numeric = (v_parsed->>'axle_no')::numeric)
                and (v_parsed->>'io' is null or w->>'io' = v_parsed->>'io');
            if v_n = 0 then
              v_code := jsonb_build_object('canonical', null, 'slot', null, 'status', 'inconsistent', 'reason', 'dual_code_on_single_wheel');
            elsif v_n > 1 then
              v_code := jsonb_build_object('canonical', null, 'slot', null, 'status', 'ambiguous',
                'reason', case when v_parsed->>'axle_no' is null and v_axles > 1 then 'axle_not_specified' else 'inner_outer_not_specified' end);
            else
              select w into v_hit from jsonb_array_elements(v_wheels) w
                where w->>'grp' = v_group and w->>'side' = v_parsed->>'side'
                  and (v_parsed->>'axle_no' is null or (w->>'ord')::numeric = (v_parsed->>'axle_no')::numeric)
                  and (v_parsed->>'io' is null or w->>'io' = v_parsed->>'io') limit 1;
              v_layout_numbered := (public.tyre_position_parse(v_hit->>'code')->>'axle_no') is not null;
              if v_axles > 1 and v_layout_numbered is distinct from (v_parsed->>'axle_no' is not null) then
                v_code := jsonb_build_object('canonical', null, 'slot', null, 'status', 'ambiguous', 'reason', 'numbering_scheme_differs');
              else
                v_code := jsonb_build_object('canonical', v_hit->>'code', 'slot', v_hit->>'slot', 'status', 'resolved', 'reason', 'structure');
              end if;
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;
  end if;

  -- ---- combine
  if v_slot->>'status' = 'resolved' and v_code->>'status' = 'resolved' and v_slot->>'slot' <> v_code->>'slot' then
    if v_kind = 'slot' then return v_slot; end if;
    if v_kind = 'erp' then return v_code; end if;
    return jsonb_build_object('canonical', null, 'slot', null, 'status', 'inconsistent', 'reason', 'slot_and_code_disagree');
  end if;
  if v_kind = 'erp' then
    if v_code->>'status' = 'resolved' then return v_code; end if;
    if v_slot->>'status' = 'resolved' then return v_slot || jsonb_build_object('reason', 'slot_id_in_code_field'); end if;
    return coalesce(v_code, v_slot,
      jsonb_build_object('canonical', null, 'slot', null, 'status', 'unknown', 'reason', 'unreadable_position'));
  end if;
  if v_slot->>'status' = 'resolved' then return v_slot; end if;
  if v_code->>'status' = 'resolved' then
    return case when v_kind = 'slot' then v_code || jsonb_build_object('reason', 'code_in_slot_field') else v_code end;
  end if;
  v_slot_shaped := u ~ '^(F|R)(\d?)(L|R)(O|I)?$' or u ~ '^(SP|SPARE)(\d?)$';
  if v_slot is null and v_slot_shaped and (v_parsed is null or v_kind = 'slot') then
    return jsonb_build_object('canonical', null, 'slot', null, 'status', 'inconsistent', 'reason', 'slot_not_on_layout');
  end if;
  return coalesce(v_slot, v_code,
    jsonb_build_object('canonical', null, 'slot', null, 'status', 'unknown', 'reason', 'unreadable_position'));
end $$;

-- Mirror of tyrePositionService.comparePositions (without the recorded-type check, which
-- needs a second layout: see observation_erp_evaluate in 20261116091000).
-- match: true / false / null. Null means PENDING MANUAL REVIEW, never "no".
create or replace function public.tyre_position_compare(p_layout jsonb, p_slot_token text, p_erp_token text)
returns jsonb language plpgsql immutable parallel safe set search_path = '' as $$
declare
  a jsonb := public.tyre_position_resolve(p_layout, p_slot_token, 'slot');
  b jsonb := public.tyre_position_resolve(p_layout, p_erp_token, 'erp');
  v_same boolean;
begin
  if a->>'status' <> 'resolved' then
    return jsonb_build_object('match', null, 'status', a->>'status', 'reason', a->>'reason', 'canonical', null,
      'observation', a, 'erp', b, 'layout_key', p_layout->>'key');
  end if;
  if b->>'status' <> 'resolved' then
    return jsonb_build_object('match', null, 'status', b->>'status', 'reason', b->>'reason', 'canonical', null,
      'observation', a, 'erp', b, 'layout_key', p_layout->>'key');
  end if;
  v_same := (a->>'slot') = (b->>'slot');
  return jsonb_build_object('match', v_same, 'status', 'resolved',
    'reason', case when v_same then 'same_wheel' else 'different_wheel' end,
    'canonical', case when v_same then a->>'canonical' end,
    'observation', a, 'erp', b, 'layout_key', p_layout->>'key');
end $$;

-- The layout for one vehicle type in one organisation ON A GIVEN DAY: the admin designed
-- layout version in force on p_as_of (vehicle_diagram_config_versions) when there is one, else
-- the built-in layout; plus the verified position mappings recorded for that layout.
--   p_as_of null            the open (current) version
--   version covers the day  that version (an old record is never re-read on a later edit)
--   layout edited that day  flagged changed_after_record (pending), not guessed
--   before a 'backfill'     flagged changed_after_record: what was in force is not recorded
--   before a 'recorded' one the admin layout did not exist yet: built-in layout
-- Explicit organisation: NOT callable by app roles.
create or replace function public.tyre_type_layout(
  p_org uuid, p_vehicle_type text, p_asset_no text, p_axle_count integer, p_as_of date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_type text := nullif(btrim(coalesce(p_vehicle_type, '')), '');
  v_key text;
  v public.vehicle_diagram_config_versions%rowtype;
  v_config jsonb;
  v_changed date;
  v_layout jsonb;
  v_mappings jsonb;
begin
  if v_type is not null then
    v_key := upper(regexp_replace(v_type, '\s+', ' ', 'g'));
    if p_as_of is null then
      select * into v from public.vehicle_diagram_config_versions c
        where c.organisation_id = p_org and c.valid_to is null
          and upper(regexp_replace(btrim(c.vehicle_type), '\s+', ' ', 'g')) = v_key
        order by c.valid_from desc limit 1;
      if v.id is not null and v.active then v_config := v.config; end if;
    else
      select * into v from public.vehicle_diagram_config_versions c
        where c.organisation_id = p_org
          and upper(regexp_replace(btrim(c.vehicle_type), '\s+', ' ', 'g')) = v_key
          and c.valid_from::date <= p_as_of and (c.valid_to is null or c.valid_to::date > p_as_of)
        order by c.valid_from desc limit 1;
      if v.id is not null then
        if v.active then
          v_config := v.config;
          if exists (select 1 from public.vehicle_diagram_config_versions c
                     where c.organisation_id = p_org
                       and upper(regexp_replace(btrim(c.vehicle_type), '\s+', ' ', 'g')) = v_key
                       and c.valid_to::date = p_as_of) then
            v_changed := p_as_of + 1;   -- edited on the record's own day: not trusted
          end if;
        end if;
      else
        select * into v from public.vehicle_diagram_config_versions c
          where c.organisation_id = p_org
            and upper(regexp_replace(btrim(c.vehicle_type), '\s+', ' ', 'g')) = v_key
          order by c.valid_from asc limit 1;
        if v.id is not null and v.basis = 'backfill' and v.active then
          v_config := v.config;
          v_changed := v.valid_from::date;   -- later than p_as_of by construction
        end if;
      end if;
    end if;
  end if;
  v_layout := public.tyre_layout_for(v_type, p_asset_no, p_axle_count, v_config, v_changed, p_as_of);
  if v_layout->>'status' = 'resolved' then
    select jsonb_agg(jsonb_build_object('code', public.tyre_position_token(m.erp_code), 'slot', m.slot))
      into v_mappings
      from public.tyre_layout_position_mappings m
      where m.organisation_id = p_org and m.active and m.layout_key = v_layout->>'key';
    if v_mappings is not null then
      v_layout := v_layout || jsonb_build_object('mappings', v_mappings);
    end if;
  end if;
  return v_layout;
end $$;

-- The layout of one machine in one organisation and country, from the fleet register and
-- the admin designed layouts. p_vehicle_type, when given, is used only if the register has
-- no type for the asset. The result also carries the register's vehicle_type and axle_count.
-- Explicit organisation: NOT callable by app roles.
create or replace function public.tyre_asset_layout(
  p_org uuid, p_country text, p_asset_no text, p_vehicle_type text, p_as_of date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_type text;
  v_axles integer;
  v_n int;
begin
  select count(*) into v_n from public.vehicle_fleet f
    where f.organisation_id = p_org
      and upper(btrim(f.asset_no)) = upper(btrim(coalesce(p_asset_no, '')))
      and (p_country is null or upper(btrim(coalesce(f.country, ''))) = upper(btrim(p_country)));
  if v_n > 1 then
    -- The same code is registered more than once in this scope: which machine is unknown.
    return jsonb_build_object('status', 'unknown', 'reason', 'asset_not_unique', 'key', null, 'wheels', '[]'::jsonb);
  end if;
  select nullif(btrim(coalesce(f.vehicle_type, '')), ''), f.axle_count::integer into v_type, v_axles
    from public.vehicle_fleet f
    where f.organisation_id = p_org
      and upper(btrim(f.asset_no)) = upper(btrim(coalesce(p_asset_no, '')))
      and (p_country is null or upper(btrim(coalesce(f.country, ''))) = upper(btrim(p_country)));
  v_type := coalesce(v_type, nullif(btrim(coalesce(p_vehicle_type, '')), ''));
  return public.tyre_type_layout(p_org, v_type, p_asset_no, v_axles, p_as_of)
    || jsonb_build_object('vehicle_type', v_type, 'axle_count', v_axles);
end $$;

revoke all on function public.tyre_position_token(text) from public, anon;
revoke all on function public.tyre_position_parse(text) from public, anon;
revoke all on function public.tyre_position_canonical_code(text) from public, anon;
revoke all on function public.tyre_type_is_tyreless(text) from public, anon;
revoke all on function public.tyre_layout_key_one(text) from public, anon;
revoke all on function public.tyre_layout_key(text, text, integer) from public, anon;
revoke all on function public.tyre_layout_builtin_wheels(text) from public, anon;
revoke all on function public.tyre_layout_custom_wheels(jsonb) from public, anon;
revoke all on function public.tyre_layout_for(text, text, integer, jsonb, date, date) from public, anon;
revoke all on function public.tyre_position_resolve(jsonb, text, text) from public, anon;
revoke all on function public.tyre_position_compare(jsonb, text, text) from public, anon;
grant execute on function public.tyre_position_token(text) to authenticated, service_role;
grant execute on function public.tyre_position_parse(text) to authenticated, service_role;
grant execute on function public.tyre_position_canonical_code(text) to authenticated, service_role;
grant execute on function public.tyre_type_is_tyreless(text) to authenticated, service_role;
grant execute on function public.tyre_layout_key_one(text) to authenticated, service_role;
grant execute on function public.tyre_layout_key(text, text, integer) to authenticated, service_role;
grant execute on function public.tyre_layout_builtin_wheels(text) to authenticated, service_role;
grant execute on function public.tyre_layout_custom_wheels(jsonb) to authenticated, service_role;
grant execute on function public.tyre_layout_for(text, text, integer, jsonb, date, date) to authenticated, service_role;
grant execute on function public.tyre_position_resolve(jsonb, text, text) to authenticated, service_role;
grant execute on function public.tyre_position_compare(jsonb, text, text) to authenticated, service_role;

-- Reads two tables for a caller supplied organisation: definer functions only.
revoke all on function public.tyre_asset_layout(uuid, text, text, text, date) from public, anon, authenticated;
revoke all on function public.tyre_type_layout(uuid, text, text, integer, date) from public, anon, authenticated;
grant execute on function public.tyre_asset_layout(uuid, text, text, text, date) to service_role;
grant execute on function public.tyre_type_layout(uuid, text, text, integer, date) to service_role;
