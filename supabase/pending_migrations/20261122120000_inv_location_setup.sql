-- =============================================================================
-- 20261122120000_inv_location_setup.sql
-- STATUS: AUTHORED, NOT APPLIED. Pending owner approval. Rollback:
--   supabase/pending_migrations/20261122120000_inv_location_setup_ROLLBACK.sql
--
-- Warehouse and bin setup (owner requirement 6). One new client RPC:
--   inv_location_bulk_create(p_payload jsonb)
-- creates a whole rack / shelf / bin layout under one EXISTING store in one
-- transaction, after the web screen has shown the person a preview.
--
-- Rules (re-checked here, never trusted from the client):
--   * Same writer gate as inv_location_upsert: approved + unlocked AND
--     app_is_elevated() (Admin / Manager / Director). No new capability key.
--   * Country + site must be inside the caller's scope (_inv_scope_ok).
--   * The site must be a registered, active row of `sites` for the caller's
--     company in that country. A store is never created here.
--   * An optional parent must be this company's, same country and site, active.
--   * Only warehouse / zone / rack / shelf / bin; 1..500 nodes; codes are
--     letters, digits, dot, dash, underscore (normalised upper by the guard).
--   * A node whose code already exists at the store is REUSED (reported as
--     existing, nothing changed) so children can be added to an existing rack.
--     The same code twice in one payload is refused.
--   * parent_ref must name an EARLIER node of the same payload.
--   * dry_run = true returns the plan (new / existing per node) and writes nothing.
--   * Idempotent on idempotency_key via _inv_req_begin / _inv_req_end.
--
-- No table change, no data change. inventory_locations keeps its existing
-- trigger (inv_location_guard) which still enforces same-site parents, no loops.
--
-- VERIFY (rolled back, as a real Manager):
--   select public.inv_location_bulk_create('{"dry_run":true,"country":"KSA","site":"<store>",
--     "nodes":[{"ref":"a","code":"A","location_type":"rack"}]}'::jsonb);   -- {"dry_run":true,...}
--   select has_function_privilege('anon','public.inv_location_bulk_create(jsonb)','EXECUTE');  -- f
-- =============================================================================
begin;

create or replace function public.inv_location_bulk_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_org uuid := public.app_current_org();
  v_dry boolean := coalesce((p_payload->>'dry_run')::boolean, false);
  v_country text := nullif(btrim(coalesce(p_payload->>'country', '')), '');
  v_site text := upper(btrim(coalesce(p_payload->>'site', '')));
  v_parent uuid := nullif(p_payload->>'parent_id', '')::uuid;
  v_nodes jsonb := p_payload->'nodes';
  v_p public.inventory_locations%rowtype;
  v_map jsonb := '{}'::jsonb;
  v_codes text[] := '{}';
  v_out jsonb := '[]'::jsonb;
  v_created int := 0; v_existing int := 0;
  n jsonb; v_ref text; v_pref text; v_code text; v_type text; v_id uuid; v_ex uuid; v_par uuid;
  r jsonb;
begin
  if not v_dry then
    r := public._inv_req_begin('inv_location_bulk_create', p_payload); if r is not null then return r; end if;
  elsif not public.is_approved_and_unlocked() or v_org is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if not public.is_approved_and_unlocked() or not public.app_is_elevated() then
    raise exception 'Only an Admin, Manager or Director may manage locations.' using errcode = '42501';
  end if;
  if v_country is null or v_site = '' then
    raise exception 'Choose the store (country and site).' using errcode = '22023';
  end if;
  if not public._inv_scope_ok(v_country, v_site) then
    raise exception 'Location is outside your country or site scope.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sites s where s.organisation_id = v_org and s.active is true
      and lower(s.country) = lower(v_country) and upper(btrim(s.name)) = v_site) then
    raise exception 'Choose a registered store. Stores are not created here.' using errcode = 'P0002';
  end if;
  if v_parent is not null then
    select * into v_p from public.inventory_locations where id = v_parent and organisation_id = v_org;
    if not found or upper(btrim(v_p.site)) <> v_site or lower(v_p.country) <> lower(v_country) then
      raise exception 'Parent location not found in this store.' using errcode = 'P0002';
    end if;
    if v_p.active is not true then
      raise exception 'The parent location is inactive.' using errcode = '22023';
    end if;
  end if;
  if jsonb_typeof(v_nodes) is distinct from 'array' or jsonb_array_length(v_nodes) = 0 then
    raise exception 'Add at least one location.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_nodes) > 500 then
    raise exception 'At most 500 locations can be created at once.' using errcode = '22023';
  end if;

  for n in select value from jsonb_array_elements(v_nodes) loop
    v_ref := nullif(btrim(coalesce(n->>'ref', '')), '');
    v_pref := nullif(btrim(coalesce(n->>'parent_ref', '')), '');
    v_code := upper(btrim(coalesce(n->>'code', '')));
    v_type := n->>'location_type';
    if v_ref is null or v_map ? v_ref then
      raise exception 'Each location needs a unique reference.' using errcode = '22023';
    end if;
    if v_type is null or v_type not in ('warehouse','zone','rack','shelf','bin') then
      raise exception 'Only warehouse, zone, rack, shelf or bin can be created here.' using errcode = '22023';
    end if;
    if v_code !~ '^[A-Z0-9][A-Z0-9._-]{0,59}$' then
      raise exception 'Location code % is not valid.', v_code using errcode = '22023';
    end if;
    if v_code = any (v_codes) then
      raise exception 'Location code % appears twice.', v_code using errcode = '23505';
    end if;
    v_codes := v_codes || v_code;
    if v_pref is not null and not (v_map ? v_pref) then
      raise exception 'A location must come after its parent.' using errcode = '22023';
    end if;
    v_par := case when v_pref is not null then nullif(v_map->>v_pref, '')::uuid else v_parent end;

    select id into v_ex from public.inventory_locations
     where organisation_id = v_org and upper(btrim(site)) = v_site and upper(btrim(code)) = v_code;
    if v_ex is not null then
      v_existing := v_existing + 1; v_id := v_ex;
    elsif v_dry then
      v_id := null; v_created := v_created + 1;
    else
      insert into public.inventory_locations(organisation_id, country, site, parent_id, location_type, code, name, active)
      values (v_org, v_country, v_site, v_par, v_type, v_code,
              nullif(left(btrim(coalesce(n->>'name', '')), 120), ''), true)
      returning id into v_id;
      v_created := v_created + 1;
    end if;
    -- a dry-run new node has no id yet: keep the ref resolvable with ''
    v_map := v_map || jsonb_build_object(v_ref, coalesce(v_id::text, ''));
    v_out := v_out || jsonb_build_object('ref', v_ref, 'code', v_code, 'id', v_id,
      'status', case when v_ex is not null then 'existing' else 'new' end);
  end loop;

  r := jsonb_build_object('dry_run', v_dry, 'created', v_created, 'existing', v_existing, 'nodes', v_out);
  if v_dry then return r; end if;
  return public._inv_req_end('inv_location_bulk_create', p_payload, r);
end $fn$;

revoke all on function public.inv_location_bulk_create(jsonb) from public, anon;
grant execute on function public.inv_location_bulk_create(jsonb) to authenticated, service_role;
comment on function public.inv_location_bulk_create(jsonb) is
  'Bulk rack/shelf/bin creation under an existing store, preview (dry_run) then create. Admin/Manager/Director. 20261122120000.';

commit;
