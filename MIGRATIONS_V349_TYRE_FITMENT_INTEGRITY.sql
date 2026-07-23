-- V349 — Tyre-fitment integrity (audit P0 #3.1)
-- Closes the "duplicate active fitment / serial reuse / unauthorised replacement" gap.
--
-- Three parts, all additive and reversible:
--   1. tyre_status_is_active(text)   immutable predicate matching the app's active family.
--   2. guard_tyre_active_fitment()   BEFORE trigger: no two active tyres at one asset+position
--                                    for INTERACTIVE writes (auth.uid() present). Service-role /
--                                    import writes are NOT blocked (imports self-dedup and residual
--                                    conflicts are surfaced in Data Reconciliation) so bulk loads
--                                    never break — mirrors the V290/V313 grandfather philosophy.
--   3. tyre_move(jsonb)              transactional, capability-checked, position-locking swap RPC
--                                    that TyreBay now calls instead of a bare position update, so a
--                                    "Move / Swap" onto an occupied slot atomically exchanges the two
--                                    tyres instead of silently creating a duplicate.
--   4. apply_tyre_change(jsonb)      hardened: capability gate + validate the removed record actually
--                                    is the active tyre at the requested asset/position + reject a
--                                    null-removed fitment onto an already-occupied slot.
--
-- NOTE: the hard partial-unique INDEX (one active per asset+position, one active per serial) is a
-- deliberate follow-up gated on cleaning the 66 pre-existing violations (1 asset+position, 65 serial)
-- through the Data Reconciliation review surface — a unique index cannot be created while they exist,
-- and those rows must not be silently mutated.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. active-status predicate (immutable so it can be used in trigger + future index)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tyre_status_is_active(p_status text)
returns boolean
language sql immutable
as $$
  select p_status is not null and btrim(p_status) <> ''
     and lower(p_status) not like '%remov%'
     and lower(p_status) not like '%scrap%'
     and lower(p_status) not like '%written%'
     and lower(p_status) not like '%dispos%';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. guard trigger — interactive writes only
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_tyre_active_fitment()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare v_asset text; v_pos text; v_cnt int;
begin
  -- Bulk / service-role writes (no JWT) are grandfathered: imports self-dedup and any
  -- residual conflict is reviewed in Data Reconciliation, so a data load is never aborted.
  if auth.uid() is null then return new; end if;
  if not public.tyre_status_is_active(new.status) then return new; end if;

  v_asset := nullif(upper(btrim(coalesce(new.asset_no, new.asset_number))), '');
  v_pos   := nullif(upper(btrim(coalesce(new.tyre_position, new.position))), '');
  -- unassigned / spare-style slots are not position-constrained
  if v_asset is null or v_pos is null or v_pos = '0' then return new; end if;

  select count(*) into v_cnt
  from public.tyre_records t
  where t.id <> new.id
    and t.organisation_id is not distinct from new.organisation_id
    and coalesce(t.country, '') = coalesce(new.country, '')
    and nullif(upper(btrim(coalesce(t.asset_no, t.asset_number))), '') = v_asset
    and nullif(upper(btrim(coalesce(t.tyre_position, t.position))), '') = v_pos
    and public.tyre_status_is_active(t.status);

  if v_cnt > 0 then
    raise exception 'Position % on asset % already has an active tyre. Remove or move it first.', v_pos, v_asset
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_tyre_active_fitment on public.tyre_records;
create trigger trg_guard_tyre_active_fitment
  before insert or update of status, asset_no, asset_number, position, tyre_position, organisation_id, country
  on public.tyre_records
  for each row execute function public.guard_tyre_active_fitment();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. transactional move / swap RPC
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tyre_move(p jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.app_current_org();
  v_id  uuid := nullif(p->>'tyre_id','')::uuid;
  v_to_asset text := nullif(upper(btrim(p->>'to_asset_no')), '');
  v_to_pos   text := nullif(upper(btrim(p->>'to_position')), '');
  v_km numeric := nullif(p->>'km','')::numeric;
  v_src public.tyre_records%rowtype;
  v_dest_id uuid;
  v_from_asset text; v_from_pos text;
begin
  if public.app_cap_revoked('tyre_records','edit') then
    raise exception 'Not authorised to move tyres.' using errcode = '42501'; end if;
  if not public.is_approved_and_unlocked() then
    raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_id is null then raise exception 'tyre_id is required.' using errcode = '22004'; end if;

  select * into v_src from public.tyre_records where id = v_id for update;
  if not found then raise exception 'Tyre % not found.', v_id using errcode = 'P0002'; end if;
  if v_src.organisation_id is not null and v_src.organisation_id is distinct from v_org then
    raise exception 'Cross-organisation move denied.' using errcode = '42501'; end if;

  v_from_asset := nullif(upper(btrim(coalesce(v_src.asset_no, v_src.asset_number))), '');
  v_from_pos   := nullif(upper(btrim(coalesce(v_src.tyre_position, v_src.position))), '');
  v_to_asset   := coalesce(v_to_asset, v_from_asset);
  if v_to_pos is null then raise exception 'to_position is required.' using errcode = '22004'; end if;

  -- lock any active tyre already occupying the destination slot
  select id into v_dest_id
  from public.tyre_records
  where id <> v_id
    and organisation_id is not distinct from v_src.organisation_id
    and coalesce(country,'') = coalesce(v_src.country,'')
    and nullif(upper(btrim(coalesce(asset_no, asset_number))), '') = v_to_asset
    and nullif(upper(btrim(coalesce(tyre_position, position))), '') = v_to_pos
    and public.tyre_status_is_active(status)
  for update
  limit 1;

  -- step 1: park the source off its slot so the swap never transiently collides
  update public.tyre_records set position = null, tyre_position = null where id = v_id;

  -- step 2: displaced tyre (if any) takes the source's old slot / asset
  if v_dest_id is not null then
    update public.tyre_records
       set position = v_from_pos, tyre_position = v_from_pos,
           asset_no = case when v_to_asset is distinct from v_from_asset then v_from_asset else asset_no end,
           status = 'Active', removal_date = null, km_at_removal = null
     where id = v_dest_id;
  end if;

  -- step 3: place the source at the destination
  update public.tyre_records
     set position = v_to_pos, tyre_position = v_to_pos, asset_no = v_to_asset,
         km_at_fitment = coalesce(v_km, km_at_fitment),
         status = 'Active', removal_date = null, km_at_removal = null
   where id = v_id;

  perform public.record_audit_event('tyre_move', 'tyre_records', v_id::text,
    jsonb_build_object('asset_no', v_from_asset, 'position', v_from_pos),
    jsonb_build_object('asset_no', v_to_asset, 'position', v_to_pos, 'swapped_with', v_dest_id));

  return jsonb_build_object('moved', v_id, 'swapped_with', v_dest_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. harden apply_tyre_change (dormant RPC but audit-flagged): capability + validation
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_tyre_change(p jsonb)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.app_current_org();
  v_removed_id uuid; v_removed public.tyre_records%rowtype; v_new_id uuid;
  v_asset    text := nullif(btrim(p->>'asset_no'), '');
  v_position text := nullif(btrim(p->>'position'), '');
  v_site     text := nullif(btrim(p->>'site'), '');
  v_reason   text := nullif(btrim(p->>'removal_reason'), '');
  v_rem_date date := coalesce((p->>'removal_date')::date, current_date);
  v_issue_date date := coalesce((p->>'issue_date')::date, (p->>'fitment_date')::date, current_date);
  v_occupied uuid;
begin
  if public.app_cap_revoked('tyre_records','edit') then
    raise exception 'Not authorised to change tyres.' using errcode = '42501'; end if;
  if not public.is_approved_and_unlocked() then
    raise exception 'Not authorised.' using errcode = '42501'; end if;
  if v_asset is null then raise exception 'asset_no is required.' using errcode = '22004'; end if;
  if v_position is null then raise exception 'position is required.' using errcode = '22004'; end if;
  v_removed_id := nullif(p->>'removed_record_id','')::uuid;

  if v_removed_id is not null then
    select * into v_removed from public.tyre_records where id = v_removed_id for update;
    if not found then raise exception 'Removed tyre record % not found.', v_removed_id using errcode = 'P0002'; end if;
    if v_removed.organisation_id is not null and v_removed.organisation_id is distinct from v_org then
      raise exception 'Cross-organisation tyre change denied.' using errcode = '42501'; end if;
    -- the removed record must actually be the active tyre at this asset+position
    if not public.tyre_status_is_active(v_removed.status) then
      raise exception 'Tyre % is not currently active.', v_removed_id using errcode = '23514'; end if;
    if nullif(upper(btrim(coalesce(v_removed.asset_no, v_removed.asset_number))),'') is distinct from upper(v_asset) then
      raise exception 'Removed tyre is on a different asset.' using errcode = '23514'; end if;
    if nullif(upper(btrim(coalesce(v_removed.tyre_position, v_removed.position))),'') is distinct from upper(v_position) then
      raise exception 'Removed tyre is at a different position.' using errcode = '23514'; end if;

    update public.tyre_records
      set km_at_removal = coalesce((p->>'km_at_removal')::numeric, km_at_removal),
          removal_date  = v_rem_date,
          removal_reason = coalesce(v_reason, removal_reason),
          status = 'Removed'
      where id = v_removed_id;
  else
    -- no record being removed: refuse to fit onto an already-occupied active slot
    select id into v_occupied
    from public.tyre_records
    where organisation_id is not distinct from v_org
      and nullif(upper(btrim(coalesce(asset_no, asset_number))),'') = upper(v_asset)
      and nullif(upper(btrim(coalesce(tyre_position, position))),'') = upper(v_position)
      and public.tyre_status_is_active(status)
    for update limit 1;
    if v_occupied is not null then
      raise exception 'Position % on asset % already has an active tyre; specify removed_record_id.', v_position, v_asset
        using errcode = '23505'; end if;
  end if;

  insert into public.tyre_records
    (asset_no, serial_no, brand, site, country, cost_per_tyre, qty,
     position, tyre_position, km_at_fitment, removal_reason,
     issue_date, status, risk_level, category, uploaded_by, organisation_id)
  values
    (v_asset, nullif(btrim(p->>'serial_no'),''), nullif(btrim(p->>'brand'),''), v_site,
     nullif(btrim(p->>'country'),''), (p->>'cost_per_tyre')::numeric, coalesce((p->>'qty')::int,1),
     v_position, v_position, (p->>'km_at_fitment')::numeric, v_reason,
     v_issue_date,
     coalesce(nullif(btrim(p->>'status'),''),'Active'),
     coalesce(nullif(btrim(p->>'risk_level'),''),'Low'),
     coalesce(nullif(btrim(p->>'category'),''),'Tyre Change'),
     v_uid, v_org)
  returning id into v_new_id;

  perform public.record_audit_event('tyre_change','tyre_records', v_new_id::text,
    case when v_removed_id is null then null else jsonb_build_object(
      'removed_record_id', v_removed_id, 'asset_no', v_removed.asset_no,
      'serial_no', v_removed.serial_no, 'position', v_removed.position,
      'km_at_removal', coalesce((p->>'km_at_removal')::numeric, v_removed.km_at_removal),
      'removal_reason', v_reason, 'status', 'Removed') end,
    jsonb_build_object('fitment_record_id', v_new_id, 'asset_no', v_asset,
      'serial_no', nullif(btrim(p->>'serial_no'),''), 'brand', nullif(btrim(p->>'brand'),''),
      'position', v_position, 'site', v_site, 'cost_per_tyre', (p->>'cost_per_tyre')::numeric,
      'km_at_fitment', (p->>'km_at_fitment')::numeric, 'fitment_date', v_issue_date));
  return v_new_id;
end;
$function$;

revoke all on function public.tyre_move(jsonb) from public;
grant execute on function public.tyre_move(jsonb) to authenticated;
