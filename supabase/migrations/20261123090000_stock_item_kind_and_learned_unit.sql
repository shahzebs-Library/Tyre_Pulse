-- Stock "Add stock": correct item matching and remember units.
--
-- 1. stock_item_kind read part numbers with a slash (9617234210/0034305981)
--    as tyre sizes, so 345 catalogue items and 369 ERP descriptions that are
--    NOT tyres (brake boosters, flywheels, window regulators, brake/relay
--    valves, clutch repair kits) were offered as tyre stock. A size now needs
--    clear edges (no digit or slash around it), and named non-tyre assemblies
--    are excluded. Checked against every catalogue and ERP description: no
--    item naming a tyre/tire or a real tyre size changes. Only used by
--    stock_item_suggestions and stock_entry_resolve.
--    Mirror in src/lib/stockQuickEntry.js stockKind(); change both together.
-- 2. Units are almost never recorded at source (material_master 4 of 22,166,
--    ERP lines 0 of 219,918). stock_entry_resolve now also returns
--    learned_unit: the unit already used in stock for the same item code in
--    this organisation and country, so a second count of the same item does
--    not ask again. The browser then falls back to a rule with a stated reason.

create or replace function public.stock_item_kind(p_name text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
 SELECT CASE
 WHEN p_name ~* '\m(filter|lubricant|coolant|engine oil|hydraulic oil|labour|labor|service|fitting charge)\M' THEN NULL
 WHEN p_name ~* '\m(brake|clutch|exhaust|intake|relay|butterfly|solenoid|governor|dryer|drier|injector|radiator|gear|pump|hydraulic|steering|suspension|cylinder|piston|compressor|unloader|check valve|safety valve|tipping|tipper)\M' THEN NULL
 WHEN p_name ~* '\m(valve|tube|flap|patch|repair kit|nut|stud|glue|cement|gauge|lever|inflator|balancing weight|bead sealer|tyre paste|tire paste|tyre soap|tire soap)\M' AND
  (p_name ~* '\m(tyre|tire|wheel|rim|tubeless)\M' OR p_name ~* '(?<![0-9/])[0-9]{3}[[:space:]]*/[[:space:]]*[0-9]{2}[[:space:]]*r?[[:space:]]*[0-9]{2}(\.[0-9])?(?![0-9])|(?<![0-9.])[0-9]{2}\.[0-9]{1,2}[[:space:]]*[-r][[:space:]]*[0-9]{2}(?![0-9])|(?<![0-9])[0-9]{4}[[:space:]]*r[[:space:]]*[0-9]{2}(?![0-9])') THEN 'accessory'
 WHEN p_name ~* '\m(rim|wheel disc)\M' THEN 'rim'
 WHEN p_name ~* '\m(tyre|tire)\M|(?<![0-9/])[0-9]{3}[[:space:]]*/[[:space:]]*[0-9]{2}[[:space:]]*r?[[:space:]]*[0-9]{2}(\.[0-9])?(?![0-9])|(?<![0-9.])[0-9]{2}\.[0-9]{1,2}[[:space:]]*[-r][[:space:]]*[0-9]{2}(?![0-9])|(?<![0-9])[0-9]{4}[[:space:]]*r[[:space:]]*[0-9]{2}(?![0-9])' THEN 'tyre'
 ELSE NULL END;
$function$;

do $x$
declare d text; anchor text := ' RETURN d || jsonb_build_object(''key'',';
begin
  d := pg_get_functiondef('public.stock_entry_resolve(text,text,text,text)'::regprocedure);
  if position(anchor in d) = 0 then
    raise exception 'stock_entry_resolve: anchor not found, nothing changed';
  end if;
  if position('learned_unit' in d) > 0 then
    return; -- already applied
  end if;
  d := replace(d, anchor,
    ' IF nullif(btrim(d->>''code''),'''') IS NOT NULL THEN' || chr(10) ||
    '  d := d || jsonb_build_object(''learned_unit'', (SELECT s.uom FROM stock_records s' || chr(10) ||
    '   WHERE s.organisation_id = v_org AND s.country = p_country AND nullif(btrim(s.uom),'''') IS NOT NULL' || chr(10) ||
    '     AND upper(btrim(s.custom_data->''stock_item''->>''code'')) = upper(btrim(d->>''code''))' || chr(10) ||
    '   ORDER BY s.updated_at DESC NULLS LAST LIMIT 1));' || chr(10) ||
    ' END IF;' || chr(10) || anchor);
  execute d;
end $x$;
