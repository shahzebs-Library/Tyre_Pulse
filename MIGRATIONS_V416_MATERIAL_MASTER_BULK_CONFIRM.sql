-- MIGRATIONS_V416_MATERIAL_MASTER_BULK_CONFIRM.sql
--
-- One-click and multi-confirm for the material master (V367).
--
-- WHY: ~21,000 item codes sit unreviewed (KSA 9,078 / UAE 9,009 / Egypt 3,352),
-- so reviewing them one modal at a time is not a realistic path. This RPC lets a
-- reviewer confirm a whole selection at once. Confirming is money-safe by
-- construction: each item is stamped reviewed with the category it ALREADY carries
-- (the one already classifying its rows), so nothing is re-bucketed. Historical
-- money moves only through the separate `reclassify_from_master` lever, which has
-- its own dry-run preview and undo.
--
-- The single-item `material_master_set` (V367) and this bulk sibling share the same
-- rules: elevated-only, org-scoped, country REQUIRED (the same code means different
-- things in different countries), category validated against the fixed list.
--
-- A malformed item is SKIPPED with its reason rather than failing the whole batch,
-- because confirming hundreds at a time makes partial success the normal case.
--
-- Applied live 2026-07-28 via Supabase MCP (project jhssdmeruxtrlqnwfksc). This file
-- is the record; the function below is byte-for-byte what is live.

create or replace function public.material_master_set_bulk(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org       uuid := coalesce(public.app_current_org(), '00000000-0000-0000-0000-000000000001'::uuid);
  v_uid       uuid := auth.uid();
  v_item      jsonb;
  v_code      text;
  v_ctry      text;
  v_cat       text;
  v_confirmed int := 0;
  v_skipped   int := 0;
  v_errors    jsonb := '[]'::jsonb;
begin
  if not public.app_is_elevated() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Expected an array of items.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_code := upper(btrim(coalesce(v_item->>'item_code', '')));
    v_ctry := nullif(btrim(coalesce(v_item->>'country', '')), '');
    v_cat  := nullif(btrim(coalesce(v_item->>'category', '')), '');

    -- Same rules as material_master_set. A country is required because the same
    -- code means different things in different countries.
    if v_code = '' or v_ctry is null then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_errors) < 25 then
        v_errors := v_errors || jsonb_build_object(
          'item_code', v_code, 'reason', 'missing item code or country');
      end if;
      continue;
    end if;
    if v_cat is not null and v_cat not in
       ('tyre','spare_part','filter','lubricant','fuel','consumable','service','labour',
        'capital','unclassified') then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_errors) < 25 then
        v_errors := v_errors || jsonb_build_object(
          'item_code', v_code, 'reason', 'unknown category ' || v_cat);
      end if;
      continue;
    end if;

    -- Confirm AS THE CURRENT CATEGORY when none is supplied: coalesce keeps the
    -- category already on the row, so "confirm as shown" changes nothing but the
    -- reviewed stamp. A category is only written when the caller sends one.
    insert into public.material_master
      (organisation_id, country, item_code, category, reviewed, reviewed_by, reviewed_at)
    values (v_org, v_ctry, v_code, coalesce(v_cat, 'unclassified'), true, v_uid, now())
    on conflict (organisation_id, country, item_code) do update
       set category    = coalesce(v_cat, public.material_master.category),
           reviewed    = true,
           reviewed_by = v_uid,
           reviewed_at = now();

    v_confirmed := v_confirmed + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'confirmed', v_confirmed,
    'skipped', v_skipped,
    'errors', v_errors);
end $function$;

revoke all on function public.material_master_set_bulk(jsonb) from anon;
grant execute on function public.material_master_set_bulk(jsonb) to authenticated;

-- Rollback:
--   drop function if exists public.material_master_set_bulk(jsonb);
