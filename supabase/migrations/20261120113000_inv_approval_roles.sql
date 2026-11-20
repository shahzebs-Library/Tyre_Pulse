-- =============================================================================
-- 20261120113000_inv_approval_roles.sql
-- STATUS: APPLIED to production 2026-11-20 (ledger 20261120113000, owner order; applied text = sha256 b4c44de134753f32 at commit aefb9ee0 before this STATUS edit; see docs/inventory/96_PRODUCTION_RELEASE_RECORD.md). Requires 20261120100000..112000 and the live governed
--         approval engine. Rollback: 20261120113000_inv_approval_roles_ROLLBACK.sql
--
-- Owner decision 1 (2026-11-20): inventory approval stages are routed to authorised
-- ROLES through the existing approval-policy system, with company / country / site
-- scope, value and quantity thresholds and separation of duties keyed on user id.
--
-- 1. ROLE RECORDS. Mapped against the live catalog (custom_roles, profiles.role,
--    module_permissions; read-only 2026-11-20). Inventory Controller and Finance
--    Manager do not exist in production; they are ADDED to custom_roles only (one row
--    per organisation that lacks them). No module_permissions row, no capability and
--    no other role is changed. The rows this file created are recorded in
--    _bak.inv_113000_roles; the rollback removes them only while nobody holds them.
-- 2. inv_approver_roles(entity_type): the ONE list of roles that may approve each
--    inventory stage. Store Keeper is in none of them (Store Keeper prepares
--    receipts, counts and stock requests; it never approves a financial adjustment,
--    a cost reconciliation or an opening balance).
-- 3. approval_private.validate_policy (LIVE, shared with inspection / checklist /
--    work-order policies) is patched IN PLACE: one anchored replacement adds a
--    first CASE branch for entity_type 'inventory_%' that returns the list above.
--    Every other entity type keeps exactly today's role list. Guards, in order:
--    md5 of the live definition (chr(13) stripped) must equal the reviewed
--    fingerprint below, then the anchor must occur exactly once; anything else
--    aborts the whole file. The original is kept in _bak.inv_113000_snapshot and the
--    rollback executes it verbatim.
-- 4. inventory_approval_limits: per company / entity type / approver role (and
--    optionally country, site, currency) the largest value and quantity that role
--    may approve. No row for an entity type = no threshold for that type (today's
--    behaviour). Rows exist but the approver's role has none, or the request is
--    larger = the stage stays pending for a higher-limit approver (escalation).
--    An unknown value (unpriced lines) never passes a value cap.
-- 5. _inv_approval_block_reason (from 108000) is patched IN PLACE (fingerprint +
--    anchor, same rules) so its final "allowed" answer becomes
--    _inv_approval_extra_block: Store Keeper refusal, role list, thresholds - checked
--    only after every existing check (separation of duties, stage approver, capability).
--    Separation of duties stays keyed on user id (108000): a preparer, counter,
--    recounter or proposer is refused whatever roles or capabilities they hold.
-- =============================================================================
begin;

create schema if not exists _bak;
create table if not exists _bak.inv_113000_snapshot (
  obj text primary key,
  def text not null,
  captured_at timestamptz not null default now()
);
revoke all on _bak.inv_113000_snapshot from public;
create table if not exists _bak.inv_113000_roles (
  id uuid primary key,
  organisation_id uuid,
  name text not null
);
revoke all on _bak.inv_113000_roles from public;

do $$ begin
  if to_regprocedure('public._inv_approval_block_reason(uuid)') is null then
    raise exception '113000: apply 20261120100000..112000 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Missing role records (custom_roles only)
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; r record;
begin
  if to_regclass('public.custom_roles') is null then
    raise notice '113000: no custom_roles table; role records not added.';
    return;
  end if;
  for r in select o.id as org, x.name, x.descr
             from public.organisations o
             cross join (values
               ('Inventory Controller', 'Inventory: reviews counts and discrepancies, approves stock adjustments, recounts and opening balances.'),
               ('Finance Manager', 'Inventory: approves cost reconciliations, financial adjustments and opening balance values.')
             ) x(name, descr)
            where not exists (select 1 from public.custom_roles c where c.organisation_id = o.id and c.name = x.name) loop
    insert into public.custom_roles(organisation_id, name, description, active, created_by)
    values (r.org, r.name, r.descr, true, null) returning id into v_id;
    insert into _bak.inv_113000_roles(id, organisation_id, name) values (v_id, r.org, r.name);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Which roles may approve which inventory stage (single source)
-- ---------------------------------------------------------------------------
create or replace function public.inv_approver_roles(p_entity_type text)
returns text[] language sql immutable set search_path = public as $$
  select case regexp_replace(lower(btrim(coalesce(p_entity_type, ''))), '^inventory_', '')
    when 'stock_adjustment' then array['Admin','Director','Manager','Inventory Controller','Finance Manager',
      'PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager']
    when 'recount_assignment' then array['Admin','Director','Manager','Inventory Controller',
      'PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager']
    when 'opening_balance_batch' then array['Admin','Director','Manager','Inventory Controller','Finance Manager']
    when 'cost_reconciliation' then array['Admin','Director','Manager','Finance Manager']
    when 'tyre_conflict_correction' then array['PMV Manager']
    else array[]::text[] end
$$;
revoke all on function public.inv_approver_roles(text) from public, anon;
grant execute on function public.inv_approver_roles(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. validate_policy: inventory branch (fingerprinted in-place patch)
-- ---------------------------------------------------------------------------
do $$
declare
  c_sig    constant text := 'approval_private.validate_policy(approval_policies)';
  -- Live production fingerprint 2026-11-20 (PostgreSQL 17.6), chr(13) stripped.
  c_md5    constant text := 'b76c1c97d59bc5b384041b5f8b67c867';
  c_anchor constant text := $a$u.role=ANY(CASE WHEN p.entity_type='inspection' THEN$a$;
  c_repl   constant text := $b$u.role=ANY(CASE WHEN p.entity_type LIKE 'inventory\_%' THEN public.inv_approver_roles(p.entity_type) WHEN p.entity_type='inspection' THEN$b$;
  v_def text; v_n int;
begin
  if to_regprocedure(c_sig) is null then
    raise notice '113000: % not installed; nothing to widen.', c_sig;
    return;
  end if;
  v_def := pg_get_functiondef(to_regprocedure(c_sig));
  if position('inv_approver_roles' in v_def) > 0 then
    raise notice '113000: % already routes inventory roles; left as is.', c_sig;
    return;
  end if;
  if md5(replace(v_def, chr(13), '')) <> c_md5 then
    raise exception '113000: % differs from the reviewed definition (md5 % expected %); refusing to patch.',
      c_sig, md5(replace(v_def, chr(13), '')), c_md5;
  end if;
  v_n := (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor);
  if v_n <> 1 then
    raise exception '113000: anchor found % times in %; refusing to patch.', v_n, c_sig;
  end if;
  insert into _bak.inv_113000_snapshot(obj, def) values (c_sig, v_def) on conflict (obj) do nothing;
  execute replace(v_def, c_anchor, c_repl);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Thresholds
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_approval_limits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  entity_type text not null check (entity_type in ('stock_adjustment','recount_assignment','opening_balance_batch',
    'cost_reconciliation','tyre_conflict_correction')),
  approver_role text not null check (btrim(approver_role) <> ''),
  country text, site text,
  currency text,
  max_value numeric check (max_value is null or max_value >= 0),
  max_qty numeric check (max_qty is null or max_qty >= 0),
  active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now()
);
create unique index if not exists inventory_approval_limits_uq on public.inventory_approval_limits
  (organisation_id, entity_type, lower(btrim(approver_role)), coalesce(upper(btrim(country)), ''), coalesce(upper(btrim(site)), ''));
select public._inv_secure_table('inventory_approval_limits', true, true);

-- Size of a request: {qty, value, value_unknown_qty, currency}. Read-only.
create or replace function public._inv_approval_magnitude(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare r public.inventory_approval_requests%rowtype; adj public.inventory_adjustments%rowtype;
  rec public.inventory_cost_reconciliations%rowtype; v_qty numeric; v_val numeric; v_unk numeric; v_cur text;
begin
  select * into r from public.inventory_approval_requests where id = p_request;
  if not found then return null; end if;
  if r.entity_type = 'stock_adjustment' then
    select * into adj from public.inventory_adjustments where id = r.entity_id;
    select abs(adj.qty_change),
           case when adj.value_impact is not null then abs(adj.value_impact)
                when coalesce(adj.unit_cost, s.avg_unit_cost) is not null then abs(adj.qty_change) * coalesce(adj.unit_cost, s.avg_unit_cost) end,
           upper(coalesce(adj.currency, s.currency, public.currency_for_country(s.country)))
      into v_qty, v_val, v_cur
      from (select 1) one left join public.stock_records s on s.id = adj.stock_id;
    v_unk := case when v_val is null then v_qty else 0 end;
  elsif r.entity_type = 'opening_balance_batch' then
    select coalesce(sum(l.qty), 0), coalesce(sum(l.qty * l.unit_cost) filter (where l.unit_cost is not null), 0),
           coalesce(sum(l.qty) filter (where l.unit_cost is null), 0),
           upper(min(coalesce(l.currency, b.currency_hint)))
      into v_qty, v_val, v_unk, v_cur
      from public.opening_balance_lines l
      cross join lateral (select public.currency_for_country(r.country) as currency_hint) b
     where l.batch_id = r.entity_id and l.mapping_status <> 'excluded';
  elsif r.entity_type = 'cost_reconciliation' then
    select * into rec from public.inventory_cost_reconciliations where id = r.entity_id;
    v_qty := rec.unvalued_qty;
    v_cur := upper(coalesce(rec.currency, public.currency_for_country(rec.country)));
    if rec.kind = 'issue_allocation' or nullif(r.proposal->>'unit_cost', '') is null then
      v_val := null; v_unk := v_qty;
    else
      v_val := rec.unvalued_qty * (r.proposal->>'unit_cost')::numeric; v_unk := 0;
    end if;
  else
    v_qty := case when r.entity_type = 'tyre_conflict_correction' then 1 else 0 end; v_val := 0; v_unk := 0;
  end if;
  return jsonb_build_object('qty', v_qty, 'value', v_val, 'value_unknown_qty', coalesce(v_unk, 0), 'currency', v_cur);
end $fn$;
revoke all on function public._inv_approval_magnitude(uuid) from public, anon, authenticated;

-- Extra stage gate: NULL = allowed. Called by _inv_approval_block_reason AFTER its
-- separation-of-duties checks, so those reasons keep priority.
create or replace function public._inv_approval_extra_block(p_request uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare r public.inventory_approval_requests%rowtype; v_raw text := coalesce(public.get_my_role(), '');
  v_role text; l public.inventory_approval_limits%rowtype; m jsonb;
begin
  select * into r from public.inventory_approval_requests where id = p_request;
  if not found then return 'not_found'; end if;
  v_role := lower(regexp_replace(btrim(v_raw), '\s+', '_', 'g'));
  if v_role = 'store_keeper' and r.entity_type in ('stock_adjustment','opening_balance_batch','cost_reconciliation') then
    return 'store_keeper_cannot_approve: a Store Keeper prepares stock records but never approves adjustments, cost reconciliations or opening balances';
  end if;
  if not exists (select 1 from unnest(public.inv_approver_roles(r.entity_type)) x
                  where lower(regexp_replace(btrim(x), '\s+', '_', 'g')) = v_role) then
    return 'role_not_authorised: ' || coalesce(nullif(v_raw, ''), 'no role') || ' may not approve ' || replace(r.entity_type, '_', ' ');
  end if;
  if exists (select 1 from public.inventory_approval_limits x where x.organisation_id = r.organisation_id
              and x.entity_type = r.entity_type and x.active) then
    select * into l from public.inventory_approval_limits x
     where x.organisation_id = r.organisation_id and x.entity_type = r.entity_type and x.active
       and lower(regexp_replace(btrim(x.approver_role), '\s+', '_', 'g')) = v_role
       and (x.country is null or upper(btrim(x.country)) = upper(btrim(coalesce(r.country, ''))))
       and (x.site is null or upper(btrim(x.site)) = upper(btrim(coalesce(r.site, ''))))
     order by (x.site is not null) desc, (x.country is not null) desc, x.created_at
     limit 1;
    if not found then
      return 'above_threshold: no approval limit is set for your role on ' || replace(r.entity_type, '_', ' ') || '; escalate to a role with a limit';
    end if;
    m := public._inv_approval_magnitude(r.id);
    if l.max_qty is not null and coalesce((m->>'qty')::numeric, 0) > l.max_qty then
      return format('above_threshold: quantity %s exceeds your limit %s; escalate', m->>'qty', l.max_qty);
    end if;
    if l.max_value is not null then
      if (m->>'value') is null or coalesce((m->>'value_unknown_qty')::numeric, 0) > 0 then
        return 'above_threshold: the value is not known (unpriced units); it needs an approver without a value limit';
      end if;
      if l.currency is not null and upper(btrim(l.currency)) is distinct from upper(coalesce(m->>'currency', '')) then
        return format('above_threshold: your limit is in %s, this request is in %s; escalate', upper(l.currency), coalesce(m->>'currency', 'an unknown currency'));
      end if;
      if (m->>'value')::numeric > l.max_value then
        return format('above_threshold: value %s exceeds your limit %s; escalate', round((m->>'value')::numeric, 2), l.max_value);
      end if;
    end if;
  end if;
  return null;
end $fn$;
revoke all on function public._inv_approval_extra_block(uuid) from public, anon, authenticated;

-- Admin RPC: set or retire one limit (idempotent payload contract).
create or replace function public.inv_approval_limit_upsert(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v jsonb; v_type text := regexp_replace(lower(btrim(coalesce(p_payload->>'entity_type', ''))), '^inventory_', '');
  v_role text := btrim(coalesce(p_payload->>'approver_role', '')); v_id uuid;
begin
  v := public._inv_req_begin('inv_approval_limit_upsert', p_payload);
  if v is not null then return v; end if;
  if not public.is_approved_and_unlocked() or not (public.is_super_admin() or public.get_my_role() = 'Admin') then
    raise exception 'Only an administrator sets approval limits.' using errcode = '42501';
  end if;
  if not (v_role = any (public.inv_approver_roles(v_type))) then
    raise exception 'Role % cannot approve % stages.', v_role, v_type using errcode = '22023';
  end if;
  if not public._inv_scope_ok(nullif(p_payload->>'country', ''), nullif(p_payload->>'site', '')) then
    raise exception 'This limit is outside your country or site scope.' using errcode = '42501';
  end if;
  insert into public.inventory_approval_limits(organisation_id, entity_type, approver_role, country, site, currency,
    max_value, max_qty, active, created_by, updated_by)
  values (public.app_current_org(), v_type, v_role, nullif(btrim(p_payload->>'country'), ''), nullif(btrim(p_payload->>'site'), ''),
    nullif(upper(btrim(p_payload->>'currency')), ''), nullif(p_payload->>'max_value', '')::numeric,
    nullif(p_payload->>'max_qty', '')::numeric, coalesce((p_payload->>'active')::boolean, true), auth.uid(), auth.uid())
  on conflict (organisation_id, entity_type, lower(btrim(approver_role)), coalesce(upper(btrim(country)), ''), coalesce(upper(btrim(site)), ''))
  do update set currency = excluded.currency, max_value = excluded.max_value, max_qty = excluded.max_qty,
    active = excluded.active, updated_by = auth.uid(), updated_at = now()
  returning id into v_id;
  return public._inv_req_end('inv_approval_limit_upsert', p_payload, jsonb_build_object('id', v_id));
end $fn$;
revoke all on function public.inv_approval_limit_upsert(jsonb) from public, anon;
grant execute on function public.inv_approval_limit_upsert(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. _inv_approval_block_reason: call the extra gate (fingerprinted in-place patch)
-- ---------------------------------------------------------------------------
do $$
declare
  c_sig    constant text := 'public._inv_approval_block_reason(uuid)';
  -- PGlite output of 20261120108000 (created in this release), chr(13) stripped.
  c_md5    constant text := '4fc264147f712e94517067a291b6a87b';
  -- the function's final `return null;` (every earlier exit returns a reason): the extra
  -- gate runs only once separation of duties, stage approver and capability have passed.
  c_anchor constant text := E'\n  return null;\nend';
  c_repl   constant text := E'\n  return public._inv_approval_extra_block(r.id);\nend';
  v_def text; v_n int;
begin
  v_def := pg_get_functiondef(to_regprocedure(c_sig));
  if position('_inv_approval_extra_block' in v_def) > 0 then
    raise notice '113000: % already calls the extra gate; left as is.', c_sig;
    return;
  end if;
  if md5(replace(v_def, chr(13), '')) <> c_md5 then
    raise exception '113000: % differs from the reviewed definition (md5 % expected %); refusing to patch.',
      c_sig, md5(replace(v_def, chr(13), '')), c_md5;
  end if;
  v_n := (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor);
  if v_n <> 1 then
    raise exception '113000: anchor found % times in %; refusing to patch.', v_n, c_sig;
  end if;
  insert into _bak.inv_113000_snapshot(obj, def) values (c_sig, v_def) on conflict (obj) do nothing;
  execute replace(v_def, c_anchor, c_repl);
end $$;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
