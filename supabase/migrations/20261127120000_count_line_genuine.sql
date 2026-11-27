-- =============================================================================
-- 20261127120000_count_line_genuine.sql
-- Genuine / not genuine mark on a counted stock line.
--
-- STATUS: APPLIED LIVE 2026-11-27 (owner approved). Verified: 2 columns, v_genuine in body,
--         anon cannot execute. Live body matched the 20261122100000 copy (md5) before apply.
--
-- WHY
--   A Store Keeper counting a shelf marks whether the part on it is a genuine (original)
--   part. The phone's Stock Count does NOT write inventory_count_lines: a count is stored
--   as physical count EVIDENCE through public.inv_pi_capture(jsonb), which inserts into
--   public.physical_inventory_captures (see tyre_pulse_flutter
--   lib/features/stock_count/data/stock_count_recorder.dart). So the mark belongs on
--   physical_inventory_captures, and inv_pi_capture must read it from the payload.
--
-- WHAT
--   1. physical_inventory_captures += genuine boolean (null = not stated), genuine_note text.
--   2. public.inv_pi_capture(p_payload jsonb) re-created from its ONLY definition
--      (20261122100000_inv_physical_inventory_master.sql, no later migration redefines it),
--      byte-for-byte except: new local v_genuine, and the two columns in the insert.
--      Every existing check (capability, client_uuid replay, session/scope, quantity,
--      location, kind, identification) is unchanged. Grants survive CREATE OR REPLACE.
--   Payload keys: 'genuine' ('true'|'false'|absent) and 'genuine_note' (text|absent).
--   A server WITHOUT this migration ignores both keys (it reads named keys only), so the
--   app sends them unconditionally.
--
-- VERIFY (rolled back)
--   select column_name from information_schema.columns
--    where table_name='physical_inventory_captures' and column_name in ('genuine','genuine_note');  -- 2 rows
--   select pg_get_functiondef('public.inv_pi_capture(jsonb)'::regprocedure) like '%v_genuine%';    -- t
--   select has_function_privilege('anon','public.inv_pi_capture(jsonb)','EXECUTE');               -- f
--
-- ROLLBACK
--   Re-run the inv_pi_capture definition from 20261122100000_inv_physical_inventory_master.sql
--   (lines 663-743), then:
--   alter table public.physical_inventory_captures drop column if exists genuine_note,
--                                                   drop column if exists genuine;
-- =============================================================================

alter table public.physical_inventory_captures
  add column if not exists genuine boolean,
  add column if not exists genuine_note text;

comment on column public.physical_inventory_captures.genuine is
  'Counter''s mark: true = genuine / original part, false = not genuine, null = not stated.';
comment on column public.physical_inventory_captures.genuine_note is
  'Optional note explaining the genuine / not genuine mark.';

create or replace function public.inv_pi_capture(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); s public.physical_inventory_sessions%rowtype;
  v_cu uuid := nullif(p_payload->>'client_uuid', '')::uuid; v_ex public.physical_inventory_captures%rowtype;
  v_kind text := coalesce(nullif(p_payload->>'kind', ''), 'unidentified');
  v_can uuid := nullif(p_payload->>'canonical_id', '')::uuid; v_var uuid := nullif(p_payload->>'variant_id', '')::uuid;
  v_item uuid := nullif(p_payload->>'item_id', '')::uuid; v_loc uuid := nullif(p_payload->>'location_id', '')::uuid;
  v_status text; v_can_status text; v_temp text; v_dups jsonb := '[]'::jsonb; v_id uuid := gen_random_uuid(); v_qty numeric;
  v_flags text[] := '{}';
  -- Genuine / not genuine part (20261127120000). Absent or unreadable = not stated (null).
  v_genuine boolean := case lower(btrim(coalesce(p_payload->>'genuine', ''))) when 'true' then true when 'false' then false else null end;
begin
  if not public._inv_pi_can_capture() then
    raise exception 'Recording a physical inventory capture needs stock:count, stock:receive or an elevated role.' using errcode = '42501';
  end if;
  if v_cu is null then raise exception 'client_uuid is required.' using errcode = '22023'; end if;
  -- The capture is keyed by client_uuid: a replay returns the stored row even when the
  -- retried payload differs (e.g. a new device timestamp), before the request store
  -- could refuse it as a different request. The FIRST payload is the evidence.
  select * into v_ex from public.physical_inventory_captures where organisation_id = v_org and client_uuid = v_cu;
  if found then
    return jsonb_build_object('id', v_ex.id, 'temp_ref', v_ex.temp_ref, 'identification_status', v_ex.identification_status,
      'item_id', v_ex.item_id, 'review_flags', to_jsonb(v_ex.review_flags), 'duplicate', true);
  end if;
  r := public._inv_req_begin('inv_pi_capture', p_payload, true); if r is not null then return r; end if;
  select * into s from public.physical_inventory_sessions where id = (p_payload->>'session_id')::uuid;
  if not found or s.organisation_id is distinct from v_org then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if s.status <> 'open' then raise exception 'This physical inventory session is %.', s.status using errcode = '22023'; end if;
  if not public._inv_scope_ok(s.country, s.site) then raise exception 'Store outside your scope.' using errcode = '42501'; end if;
  begin v_qty := (p_payload->>'quantity')::numeric; exception when others then v_qty := null; end;
  if v_qty is null or v_qty < 0 then raise exception 'Quantity must be zero or more.' using errcode = '22023'; end if;
  if v_loc is not null and not exists (select 1 from public.inventory_locations where id = v_loc and organisation_id = v_org
       and site = s.site and lower(country) = lower(s.country) and active) then
    raise exception 'Location not found in this store.' using errcode = 'P0002';
  end if;
  if v_kind not in ('identified','proposed_new','unidentified') then
    raise exception 'kind must be identified, proposed_new or unidentified.' using errcode = '22023';
  end if;
  if v_kind = 'identified' then
    if v_var is not null then
      select canonical_id into v_can from public.material_variants where id = v_var and organisation_id = v_org and status in ('proposed','active');
      if v_can is null then raise exception 'Variant not found in your company.' using errcode = 'P0002'; end if;
    elsif v_can is null and v_item is not null then
      select canonical_id, variant_id into v_can, v_var from public.material_canonical_items where item_id = v_item and organisation_id = v_org;
    end if;
    if v_item is not null and not exists (select 1 from public.material_master where id = v_item and organisation_id = v_org
         and lower(coalesce(country, '')) = lower(s.country)) then
      raise exception 'ERP item not found for this country.' using errcode = 'P0002';
    end if;
    if v_can is null and v_item is null then
      raise exception 'An identified capture needs a material, variant or ERP item.' using errcode = '22023';
    end if;
    if v_can is not null then
      select status into v_can_status from public.material_canonical where id = v_can and organisation_id = v_org;
      if v_can_status is null then raise exception 'Material not found in your company.' using errcode = 'P0002'; end if;
      if v_can_status not in ('proposed','active') then raise exception 'This material is %; pick the replacement.', v_can_status using errcode = '22023'; end if;
      v_item := coalesce(v_item, public._inv_pi_country_item(v_org, s.country, v_can, v_var));
      if v_item is null and public._inv_pi_country_item_candidates(v_org, s.country, v_can, v_var) > 1 then
        v_flags := array['ambiguous_erp_sku'];
      end if;
    end if;
    v_status := case when v_can is null or v_can_status = 'active' then 'identified' else 'pending_review' end;
  else
    v_status := 'pending_review';
    v_can := null; v_var := null; v_item := null;
    v_dups := public._inv_pi_dup_candidates(v_org, coalesce(p_payload->'refs', '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object('scanned_code', p_payload->>'scanned_code')), p_payload->'refs'->>'description');
  end if;
  if v_status <> 'identified' then
    v_temp := 'UNK-' || to_char(now(), 'YYMMDD') || '-' || upper(left(replace(v_id::text, '-', ''), 8));
  end if;
  insert into public.physical_inventory_captures(id, organisation_id, session_id, country, site, location_id, location_hint,
    capture_kind, temp_ref, canonical_id, variant_id, item_id, scanned_code, scanned_code_type, entered_refs, quantity, uom,
    condition, ownership, remarks, duplicate_candidates, review_flags, identification_status, captured_at, device_id, client_uuid,
    genuine, genuine_note)
  values (v_id, v_org, s.id, s.country, s.site, coalesce(v_loc, s.location_id), nullif(btrim(p_payload->>'location_hint'), ''),
    v_kind, v_temp, v_can, v_var, v_item, nullif(btrim(p_payload->>'scanned_code'), ''), nullif(p_payload->>'scanned_code_type', ''),
    coalesce(p_payload->'refs', '{}'::jsonb), v_qty, nullif(p_payload->>'uom', ''),
    coalesce(nullif(p_payload->>'condition', ''), 'unknown'), coalesce(nullif(p_payload->>'ownership', ''), 'owned'),
    nullif(btrim(p_payload->>'remarks'), ''), v_dups, v_flags, v_status,
    least(coalesce(nullif(p_payload->>'captured_at', '')::timestamptz, now()), now()), nullif(p_payload->>'device_id', ''), v_cu,
    v_genuine, nullif(btrim(p_payload->>'genuine_note'), ''));
  return public._inv_req_end('inv_pi_capture', p_payload, jsonb_build_object('id', v_id, 'temp_ref', v_temp,
    'identification_status', v_status, 'item_id', v_item, 'review_flags', to_jsonb(v_flags), 'duplicates', v_dups, 'duplicate', false));
end $fn$;

