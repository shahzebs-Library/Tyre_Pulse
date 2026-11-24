-- =============================================================================
-- 20261124132000_wms_oem_material_link_reconcile.sql
--
-- STATUS: NOT APPLIED. Authored 2026-11-24. Apply only on the owner's yes, in one
-- transaction, then run the VERIFY block at the end. Proven on the live database
-- (project jhssdmeruxtrlqnwfksc) inside a transaction that was rolled back; nothing
-- persisted. Proof result is recorded under "ROLLED-BACK PROOF" below.
--
-- LIVE FACTS (read 2026-11-24, before this migration)
--   * stock_records with item_id NULL: 43. 28 carry a code in custom_data.stock_item
--     and every one has exactly one KSA material_master row with that code; 8 are real
--     tyres with no code ("315/80R22.5 Double coin" etc.); 7 are demo-org lines.
--     None has a location_id.
--   * stock_records with an item_id but no catalogue link: 7 lines, 3 distinct ERP
--     items (DEMO-Q-001, DEMO-Q-002, DEMO-X-001), all in the demo organisation, and
--     no company SKU exists for them. Cause: demo data. Nothing to link.
--   * material_master with no catalogue link: UAE 9,321, KSA 7,047, Egypt 3,398.
--     UAE: 726 items share an item code with a company SKU; only 533 of those also
--     carry the same description (a code means a different item per country, WP1).
--     Normalised OEM token in the ERP description equal to a catalogue OEM alias:
--     UAE 170 items (176 pairs), Egypt 29 items (30 pairs). Egypt has 0 code matches.
--   * material_canonical_items: 3,508 links, 0 items linked twice, 0 company SKUs linked
--     twice in one country, 0 links whose country differs from the item's country.
--   * oem_part_references: 0 rows.
--
-- WHAT IT DOES
--   A. _inv_compat_propose (anchored patch, nothing retyped):
--      - an OEM link must be in the item's own country: a payload country that differs
--        from material_master.country is refused (22023); a blank country is filled
--        with the item's country (it was stored NULL, which every country can read);
--      - the caller must have write scope on the item's country (42501). Before this, a
--        KSA-only user could propose a link on a UAE item.
--   B. _inv_compat_decide (anchored patch):
--      - approve / reject only a record that is still 'proposed'; retire only an
--        'approved' one (PT409). Before this, an approved link could be re-approved by
--        someone else, overwriting approved_by, and a rejected one could be approved;
--      - the decider must have write scope on the link's country (42501).
--      Self-approval was already refused (proposer = auth.uid() -> 42501) and the
--      approver is already stamped from auth.uid(). Unchanged.
--   C. material_link_proposals + inv_material_link_propose / inv_material_link_decide.
--      Two-person reconciliation of master data, proposals only:
--        kind 'erp_to_catalogue' : material_master item -> material_canonical
--                                  (writes material_canonical_items on approval);
--        kind 'stock_to_item'    : stock_records line with no item -> material_master
--                                  item (sets stock_records.item_id on approval).
--      Basis is one of 'exact_code', 'normalized_oem', 'confirmed_suggestion' and is
--      re-checked by the server (an exact_code proposal must really share the code, a
--      normalized_oem proposal must share a normalised OEM number with a catalogue OEM
--      alias). Nothing fuzzy is ever applied. The proposer cannot decide, the decider
--      needs _inv_pi_can_master() (stock:engineering_approve or an elevated role) and
--      scope on the country (and site, for a stock line), decided_by is auth.uid().
--      Refused: cross-country (item country <> stock line country), an item already
--      linked, a company SKU already linked to another item in that country, a stock
--      line already linked or changed since the proposal (PT409).
--      stock_movements is append-only (inv_ledger_guard), so ledger rows keep their
--      NULL item_id; the balance link alone feeds the register.
--   D. inv_material_link_candidates(country, limit, offset): read-only queue of
--      PROPOSED matches for unlinked ERP items (exact code, normalised OEM). SECURITY
--      INVOKER, so RLS decides what a caller sees.
--   E. inv_material_link_health(): read-only counts for the health card (duplicates,
--      cross-country links, unlinked by country). SECURITY INVOKER.
--
-- ROLLED-BACK PROOF (2026-11-24, transaction ended with ROLLBACK; nothing persisted)
--   Body of this file applied inside BEGIN ... ROLLBACK, then exercised as two real KSA
--   Managers (A proposes, B decides; both given stock:engineering_approve inside the
--   same transaction) and the super admin (aal2 claim) for the all-country case.
--   Checked afterwards: oem_part_references 0 rows, stock_records with no item 43,
--   material_link_proposals does not exist, the grants are gone, functions unpatched.
--     OEM propose by A ......................... stored 'proposed', country filled KSA, proposed_by = A
--     OEM self-approval by A ................... refused 42501
--     OEM link with country UAE on a KSA item .. refused 22023 (cross-country)
--     same OEM number again ("test 123456") .... refused 23505 (oem_part_references_live_uq)
--     OEM link on a UAE item by KSA-only user .. refused 42501
--     OEM approve by B ......................... approved, approved_by = B
--     reject of the approved link .............. refused PT409
--     ERP item -> SKU already linked in KSA .... refused 23505 (duplicate link)
--     exact_code with a different item code .... refused 22023
--     stock line (KSA) -> UAE item, super admin  refused 22023 (cross-country)
--     stock line link: self-approval by A ...... refused 42501
--     stock line link approved by B ............ stock_records.item_id set, decided_by = B
--     second approval of the same proposal ..... refused PT409
--     inv_material_link_health ................. 0 duplicates, 0 cross-country links
--     inv_material_link_candidates ............. UAE 777 (726 exact code, 534 same description,
--                                                51 OEM only), Egypt 30 (all OEM)
--
-- ROLLBACK
--   drop function if exists public.inv_material_link_health();
--   drop function if exists public.inv_material_link_candidates(text, integer, integer);
--   drop function if exists public.inv_material_link_decide(jsonb);
--   drop function if exists public.inv_material_link_propose(jsonb);
--   drop table if exists public.material_link_proposals;
--   -- A and B: re-run the bodies of _inv_compat_propose / _inv_compat_decide from
--   -- 20261120106000_inv_oem_fitments.sql (or pg_get_functiondef captured before apply).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- A. _inv_compat_propose: country of the link = country of the item; write scope.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; a text; n int;
begin
  d := pg_get_functiondef('public._inv_compat_propose(jsonb)'::regprocedure);

  a := $a$if nullif(btrim(p->>'source'), '') is null or jsonb_array_length$a$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception '_inv_compat_propose anchor 1 matched % times', n; end if;
  d := replace(d, a, $r$if not public.app_write_country_ok((select m.country from public.material_master m where m.id = (p->>'item_id')::uuid)) then
    raise exception 'This item is outside your country scope.' using errcode = '42501';
  end if;
  if p->>'kind' = 'oem' and nullif(btrim(p->>'country'), '') is not null
     and exists (select 1 from public.material_master m where m.id = (p->>'item_id')::uuid
                 and lower(btrim(coalesce(m.country, ''))) is distinct from lower(btrim(p->>'country'))) then
    raise exception 'An OEM link must be in the same country as its item.' using errcode = '22023';
  end if;
  $r$ || a);

  a := $a$values (v_org, p->>'country', btrim(p->>'oem_part_no')$a$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception '_inv_compat_propose anchor 2 matched % times', n; end if;
  d := replace(d, a, $r$values (v_org, coalesce(nullif(btrim(p->>'country'), ''), (select m.country from public.material_master m where m.id = (p->>'item_id')::uuid)), btrim(p->>'oem_part_no')$r$);

  execute d;
end $patch$;

-- ---------------------------------------------------------------------------
-- B. _inv_compat_decide: decide only a live record; scope on its country.
-- ---------------------------------------------------------------------------
do $patch$
declare d text; a text; n int;
begin
  d := pg_get_functiondef('public._inv_compat_decide(text, uuid, text, text)'::regprocedure);
  a := $a$if v_by is null then raise exception 'Record not found.' using errcode = 'P0002'; end if;$a$;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception '_inv_compat_decide anchor matched % times', n; end if;
  d := replace(d, a, a || $r$
  if p_kind = 'oem' then
    if exists (select 1 from public.oem_part_references r where r.id = p_id
               and ((v_status in ('approved', 'rejected') and r.status <> 'proposed')
                    or (v_status = 'retired' and r.status <> 'approved'))) then
      raise exception 'This link was already decided. Refresh and review again.' using errcode = 'PT409';
    end if;
    if not public.app_write_country_ok((select r.country from public.oem_part_references r where r.id = p_id)) then
      raise exception 'This link is outside your country scope.' using errcode = '42501';
    end if;
  end if;$r$);
  execute d;
end $patch$;

-- ---------------------------------------------------------------------------
-- C. Link proposals (two-person reconciliation).
-- ---------------------------------------------------------------------------
create table if not exists public.material_link_proposals (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country         text not null,
  kind            text not null check (kind in ('erp_to_catalogue', 'stock_to_item')),
  item_id         uuid not null references public.material_master(id),
  canonical_id    uuid references public.material_canonical(id),
  stock_id        uuid references public.stock_records(id),
  basis           text not null check (basis in ('exact_code', 'normalized_oem', 'confirmed_suggestion')),
  evidence        jsonb not null default '[]'::jsonb,
  note            text,
  stock_updated_at timestamptz,
  status          text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'withdrawn')),
  proposed_by     uuid not null default auth.uid(),
  proposed_at     timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  check ((kind = 'erp_to_catalogue' and canonical_id is not null and stock_id is null)
      or (kind = 'stock_to_item' and stock_id is not null and canonical_id is null)),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0)
);

create unique index if not exists material_link_proposals_live_item_uq
  on public.material_link_proposals (organisation_id, item_id) where status = 'proposed' and kind = 'erp_to_catalogue';
create unique index if not exists material_link_proposals_live_stock_uq
  on public.material_link_proposals (organisation_id, stock_id) where status = 'proposed' and kind = 'stock_to_item';
create index if not exists material_link_proposals_status_idx
  on public.material_link_proposals (organisation_id, status, country);

alter table public.material_link_proposals enable row level security;
drop policy if exists material_link_proposals_org_isolation on public.material_link_proposals;
create policy material_link_proposals_org_isolation on public.material_link_proposals as restrictive for all
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
drop policy if exists material_link_proposals_country_isolation on public.material_link_proposals;
create policy material_link_proposals_country_isolation on public.material_link_proposals as restrictive for select
  using ((select public.is_super_admin()) or (select public.app_sees_all_countries())
         or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])));
drop policy if exists material_link_proposals_read on public.material_link_proposals;
create policy material_link_proposals_read on public.material_link_proposals for select
  using (((select public.app_is_active()) is true) and (select public.inv_can('view')));
-- No insert / update / delete policy: every write goes through the two RPCs below.
revoke all on public.material_link_proposals from anon;
revoke insert, update, delete, truncate on public.material_link_proposals from authenticated;
grant select on public.material_link_proposals to authenticated;

create or replace function public._inv_norm_part(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- True when a part-number-looking token of the item's code or name equals, after
-- normalisation, an OEM alias recorded on the catalogue item. Exact only.
create or replace function public._inv_item_shares_oem(p_item uuid, p_canonical uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.material_master m
    cross join lateral regexp_split_to_table(coalesce(m.item_code, '') || ' ' || coalesce(m.item_name, ''), '[\s,;()]+') t
    join public.material_aliases a
      on a.canonical_id = p_canonical and a.alias_type = 'oem'
     and public._inv_norm_part(a.value) = public._inv_norm_part(t)
    where m.id = p_item
      and length(coalesce(public._inv_norm_part(t), '')) >= 5
      and public._inv_norm_part(t) ~ '[0-9]')
$$;
revoke all on function public._inv_item_shares_oem(uuid, uuid) from public, anon, authenticated;

create or replace function public.inv_material_link_propose(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r jsonb;
  v_org uuid := public.app_current_org();
  v_kind text := p_payload->>'kind';
  v_basis text := coalesce(nullif(p_payload->>'basis', ''), 'confirmed_suggestion');
  v_item public.material_master%rowtype;
  v_stock public.stock_records%rowtype;
  v_can public.material_canonical%rowtype;
  v_id uuid;
begin
  r := public._inv_req_begin('inv_material_link_propose', p_payload); if r is not null then return r; end if;
  if not (public.inv_can('view') and (public.app_is_elevated() or public.inv_can('procure')
          or public.inv_can('engineering_approve') or public.is_super_admin())) then
    raise exception 'Not authorised to propose master-data links.' using errcode = '42501';
  end if;
  if v_kind not in ('erp_to_catalogue', 'stock_to_item') then
    raise exception 'kind must be erp_to_catalogue or stock_to_item.' using errcode = '22023';
  end if;
  if v_basis not in ('exact_code', 'normalized_oem', 'confirmed_suggestion') then
    raise exception 'Invalid basis.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'evidence') is distinct from 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'A proposal needs at least one evidence entry.' using errcode = '22023';
  end if;

  select * into v_item from public.material_master where id = (p_payload->>'item_id')::uuid;
  if not found or v_item.organisation_id is distinct from v_org then
    raise exception 'Item not found in your company.' using errcode = 'P0002';
  end if;
  if not public.app_write_country_ok(v_item.country) then
    raise exception 'This item is outside your country scope.' using errcode = '42501';
  end if;

  if v_kind = 'erp_to_catalogue' then
    select * into v_can from public.material_canonical
     where id = (p_payload->>'canonical_id')::uuid and organisation_id = v_org and status = 'active';
    if not found then raise exception 'Catalogue item not found or not active.' using errcode = 'P0002'; end if;
    if exists (select 1 from public.material_canonical_items where item_id = v_item.id) then
      raise exception 'This ERP item is already linked.' using errcode = '23505';
    end if;
    if exists (select 1 from public.material_canonical_items
               where canonical_id = v_can.id and lower(btrim(coalesce(country, ''))) = lower(btrim(coalesce(v_item.country, '')))) then
      raise exception 'This catalogue item is already linked to another ERP item in this country.' using errcode = '23505';
    end if;
    if v_basis = 'exact_code' and upper(btrim(v_item.item_code)) is distinct from upper(btrim(v_can.company_sku)) then
      raise exception 'The item code does not match the company SKU.' using errcode = '22023';
    end if;
    if v_basis = 'normalized_oem' and not public._inv_item_shares_oem(v_item.id, v_can.id) then
      raise exception 'No OEM number on this item matches the catalogue item.' using errcode = '22023';
    end if;
    if v_basis = 'confirmed_suggestion' and nullif(btrim(p_payload->>'note'), '') is null then
      raise exception 'Explain why this link is right.' using errcode = '22023';
    end if;
    insert into public.material_link_proposals(organisation_id, country, kind, item_id, canonical_id, basis, evidence, note)
    values (v_org, v_item.country, v_kind, v_item.id, v_can.id, v_basis, p_payload->'evidence', nullif(btrim(p_payload->>'note'), ''))
    returning id into v_id;
  else
    select * into v_stock from public.stock_records where id = (p_payload->>'stock_id')::uuid;
    if not found or v_stock.organisation_id is distinct from v_org then
      raise exception 'Stock line not found in your company.' using errcode = 'P0002';
    end if;
    if not public._inv_scope_ok(v_stock.country, v_stock.site) then
      raise exception 'This stock line is outside your scope.' using errcode = '42501';
    end if;
    if v_stock.item_id is not null then
      raise exception 'This stock line is already linked. Use a correction request to move it.' using errcode = '23505';
    end if;
    if lower(btrim(coalesce(v_item.country, ''))) is distinct from lower(btrim(coalesce(v_stock.country, ''))) then
      raise exception 'The item is in another country than the stock line.' using errcode = '22023';
    end if;
    if v_basis = 'normalized_oem' then
      raise exception 'A stock line links by its code or by a confirmed suggestion.' using errcode = '22023';
    end if;
    if v_basis = 'exact_code'
       and upper(btrim(coalesce(v_stock.custom_data->'stock_item'->>'code', ''))) is distinct from upper(btrim(v_item.item_code)) then
      raise exception 'The code on the stock line does not match this item.' using errcode = '22023';
    end if;
    if v_basis = 'confirmed_suggestion' and nullif(btrim(p_payload->>'note'), '') is null then
      raise exception 'Explain why this item is right for the stock line.' using errcode = '22023';
    end if;
    insert into public.material_link_proposals(organisation_id, country, kind, item_id, stock_id, basis, evidence, note, stock_updated_at)
    values (v_org, v_stock.country, v_kind, v_item.id, v_stock.id, v_basis, p_payload->'evidence',
            nullif(btrim(p_payload->>'note'), ''), v_stock.updated_at)
    returning id into v_id;
  end if;

  return public._inv_req_end('inv_material_link_propose', p_payload, jsonb_build_object('id', v_id, 'status', 'proposed'));
end $function$;

create or replace function public.inv_material_link_decide(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r jsonb;
  v_org uuid := public.app_current_org();
  v_dec text := p_payload->>'decision';
  v_note text := nullif(btrim(p_payload->>'note'), '');
  v public.material_link_proposals%rowtype;
  v_item public.material_master%rowtype;
  v_stock public.stock_records%rowtype;
  v_link uuid;
  v_status text;
begin
  r := public._inv_req_begin('inv_material_link_decide', p_payload); if r is not null then return r; end if;
  if v_dec not in ('approve', 'reject', 'withdraw') then
    raise exception 'Decision must be approve, reject or withdraw.' using errcode = '22023';
  end if;
  select * into v from public.material_link_proposals where id = (p_payload->>'id')::uuid for update;
  if not found or v.organisation_id is distinct from v_org then
    raise exception 'Proposal not found.' using errcode = 'P0002';
  end if;
  if v.status <> 'proposed' then
    raise exception 'This proposal was already decided. Refresh and review again.' using errcode = 'PT409';
  end if;

  if v_dec = 'withdraw' then
    if v.proposed_by is distinct from auth.uid() then
      raise exception 'Only the person who proposed it can withdraw it.' using errcode = '42501';
    end if;
    v_status := 'withdrawn';
  else
    if not public._inv_pi_can_master() then
      raise exception 'Deciding a link needs stock:engineering_approve or an elevated role.' using errcode = '42501';
    end if;
    if v.proposed_by = auth.uid() then
      raise exception 'The proposer cannot decide their own link.' using errcode = '42501';
    end if;
    if not public.app_write_country_ok(v.country) then
      raise exception 'This proposal is outside your country scope.' using errcode = '42501';
    end if;
    if v_dec = 'reject' and v_note is null then
      raise exception 'Give a reason for rejecting this link.' using errcode = '22023';
    end if;
    v_status := case v_dec when 'approve' then 'approved' else 'rejected' end;
  end if;

  if v_status = 'approved' then
    select * into v_item from public.material_master where id = v.item_id;
    if v.kind = 'erp_to_catalogue' then
      if exists (select 1 from public.material_canonical_items where item_id = v.item_id) then
        raise exception 'This ERP item is already linked.' using errcode = '23505';
      end if;
      if exists (select 1 from public.material_canonical_items
                 where canonical_id = v.canonical_id and lower(btrim(coalesce(country, ''))) = lower(btrim(coalesce(v_item.country, '')))) then
        raise exception 'This catalogue item is already linked to another ERP item in this country.' using errcode = '23505';
      end if;
      if not exists (select 1 from public.material_canonical where id = v.canonical_id and status = 'active') then
        raise exception 'The catalogue item is no longer active.' using errcode = 'PT409';
      end if;
      insert into public.material_canonical_items(organisation_id, country, canonical_id, item_id, linked_by, note)
      values (v_org, v_item.country, v.canonical_id, v.item_id, auth.uid(),
              'Approved link proposal ' || v.id || ' (' || v.basis || ')')
      returning id into v_link;
    else
      select * into v_stock from public.stock_records where id = v.stock_id for update;
      if not found or v_stock.item_id is not null then
        raise exception 'This stock line is already linked.' using errcode = '23505';
      end if;
      if v_stock.updated_at is distinct from v.stock_updated_at then
        raise exception 'The stock line changed since it was proposed. Propose it again.' using errcode = 'PT409';
      end if;
      if not public._inv_scope_ok(v_stock.country, v_stock.site) then
        raise exception 'This stock line is outside your scope.' using errcode = '42501';
      end if;
      if lower(btrim(coalesce(v_item.country, ''))) is distinct from lower(btrim(coalesce(v_stock.country, ''))) then
        raise exception 'The item is in another country than the stock line.' using errcode = '22023';
      end if;
      perform set_config('inv.posting', 'on', true);
      update public.stock_records set item_id = v.item_id, updated_at = clock_timestamp(), updated_by = auth.uid()
       where id = v_stock.id;
      perform set_config('inv.posting', '', true);
    end if;
    perform public.record_audit_event('material_link_approved', 'material_link_proposals', v.id::text,
      jsonb_build_object('status', 'proposed'),
      jsonb_build_object('kind', v.kind, 'item_id', v.item_id, 'canonical_id', v.canonical_id,
                         'stock_id', v.stock_id, 'basis', v.basis, 'link_id', v_link));
  end if;

  update public.material_link_proposals
     set status = v_status, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = v.id;

  return public._inv_req_end('inv_material_link_decide', p_payload,
    jsonb_build_object('id', v.id, 'status', v_status, 'link_id', v_link));
end $function$;

revoke all on function public.inv_material_link_propose(jsonb) from public, anon;
revoke all on function public.inv_material_link_decide(jsonb) from public, anon;
grant execute on function public.inv_material_link_propose(jsonb) to authenticated, service_role;
grant execute on function public.inv_material_link_decide(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D. Candidate queue (read only, RLS decides visibility).
-- ---------------------------------------------------------------------------
create or replace function public.inv_material_link_candidates(p_country text default null, p_limit integer default 200, p_offset integer default 0)
returns table (
  item_id uuid, country text, item_code text, item_name text,
  canonical_id uuid, company_sku text, canonical_description text,
  basis text, same_description boolean, matched_value text, alias_verified boolean,
  candidate_count integer, canonical_taken boolean,
  proposal_id uuid, proposal_status text, proposed_by uuid, total_count bigint)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  with un as (
    select m.id, m.country, m.item_code, m.item_name
    from public.material_master m
    where public.inv_can('view')
      and (p_country is null or p_country = '' or p_country = 'All' or m.country = p_country)
      and not exists (select 1 from public.material_canonical_items l where l.item_id = m.id)
  ),
  by_code as (
    select un.id item_id, c.id canonical_id, 'exact_code'::text basis, un.item_code matched_value, null::boolean verified
    from un join public.material_canonical c
      on c.status = 'active' and upper(btrim(c.company_sku)) = upper(btrim(un.item_code))
  ),
  toks as (
    select un.id item_id, public._inv_norm_part(t) k
    from un cross join lateral regexp_split_to_table(coalesce(un.item_code, '') || ' ' || coalesce(un.item_name, ''), '[\s,;()]+') t
  ),
  by_oem as (
    select distinct on (toks.item_id, a.canonical_id) toks.item_id, a.canonical_id, 'normalized_oem'::text basis,
           a.value matched_value, a.verified
    from toks join public.material_aliases a
      on a.alias_type = 'oem' and a.canonical_id is not null and public._inv_norm_part(a.value) = toks.k
    where length(coalesce(toks.k, '')) >= 5 and toks.k ~ '[0-9]'
    order by toks.item_id, a.canonical_id, a.verified desc nulls last
  ),
  hits as (
    select distinct on (item_id, canonical_id) * from (select * from by_code union all select * from by_oem) x
    order by item_id, canonical_id, case basis when 'exact_code' then 0 else 1 end
  ),
  rows as (
    select un.id item_id, un.country, un.item_code, un.item_name,
           c.id canonical_id, c.company_sku, c.description canonical_description,
           h.basis,
           (upper(regexp_replace(btrim(coalesce(un.item_name, '')), '\s+', ' ', 'g'))
              in (upper(regexp_replace(btrim(coalesce(c.description, '')), '\s+', ' ', 'g')),
                  upper(regexp_replace(btrim(coalesce(c.specs->>'original_description', '')), '\s+', ' ', 'g')))) same_description,
           h.matched_value, h.verified alias_verified,
           (count(*) over (partition by un.id))::integer candidate_count,
           exists (select 1 from public.material_canonical_items l
                   where l.canonical_id = c.id and lower(btrim(coalesce(l.country, ''))) = lower(btrim(coalesce(un.country, '')))) canonical_taken,
           p.id proposal_id, p.status proposal_status, p.proposed_by
    from hits h
    join un on un.id = h.item_id
    join public.material_canonical c on c.id = h.canonical_id
    left join lateral (
      select mp.id, mp.status, mp.proposed_by from public.material_link_proposals mp
      where mp.kind = 'erp_to_catalogue' and mp.item_id = un.id and mp.canonical_id = c.id
      order by mp.proposed_at desc limit 1) p on true
  )
  select rows.*, count(*) over () total_count
  from rows
  order by country, basis, item_code, company_sku
  limit greatest(1, least(coalesce(p_limit, 200), 1000)) offset greatest(0, coalesce(p_offset, 0))
$$;
revoke all on function public.inv_material_link_candidates(text, integer, integer) from public, anon;
grant execute on function public.inv_material_link_candidates(text, integer, integer) to authenticated, service_role;
grant execute on function public._inv_norm_part(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E. Health card (read only, RLS decides visibility).
-- ---------------------------------------------------------------------------
create or replace function public.inv_material_link_health()
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'links', (select count(*) from public.material_canonical_items),
    'item_linked_twice', (select count(*) from (select item_id from public.material_canonical_items group by 1 having count(*) > 1) x),
    'sku_linked_twice_in_country', (select count(*) from (select canonical_id, lower(btrim(coalesce(country, ''))) from public.material_canonical_items group by 1, 2 having count(*) > 1) x),
    'cross_country_links', (select count(*) from public.material_canonical_items l join public.material_master m on m.id = l.item_id
                            where lower(btrim(coalesce(l.country, ''))) is distinct from lower(btrim(coalesce(m.country, '')))),
    'oem_refs_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.oem_part_references group by 1) x), '{}'::jsonb),
    'oem_cross_country', (select count(*) from public.oem_part_references r join public.material_master m on m.id = r.item_id
                          where r.country is not null and lower(btrim(r.country)) is distinct from lower(btrim(coalesce(m.country, '')))),
    'oem_live_duplicates', (select count(*) from (select oem_part_no_normalized, item_id from public.oem_part_references
                            where status in ('proposed', 'approved') group by 1, 2 having count(*) > 1) x),
    'erp_unlinked_by_country', coalesce((select jsonb_object_agg(coalesce(country, 'none'), n) from (
        select m.country, count(*) n from public.material_master m
        where not exists (select 1 from public.material_canonical_items l where l.item_id = m.id) group by 1) x), '{}'::jsonb),
    'stock_without_item', (select count(*) from public.stock_records where item_id is null),
    'stock_without_item_with_code', (select count(*) from public.stock_records where item_id is null
                                      and nullif(btrim(custom_data->'stock_item'->>'code'), '') is not null),
    'stock_item_without_catalogue', (select count(*) from public.stock_records s where s.item_id is not null
                                      and not exists (select 1 from public.material_canonical_items l where l.item_id = s.item_id)),
    'proposals_open', (select count(*) from public.material_link_proposals where status = 'proposed')
  )
$$;
revoke all on function public.inv_material_link_health() from public, anon;
grant execute on function public.inv_material_link_health() to authenticated, service_role;

commit;

-- VERIFY (after apply):
--   select has_function_privilege('anon', 'public.inv_material_link_decide(jsonb)', 'EXECUTE');      -- false
--   select has_function_privilege('anon', 'public.inv_material_link_candidates(text,integer,integer)', 'EXECUTE'); -- false
--   select pg_get_functiondef('public._inv_compat_propose(jsonb)'::regprocedure) like '%same country as its item%'; -- true
--   select pg_get_functiondef('public._inv_compat_decide(text,uuid,text,text)'::regprocedure) like '%already decided%'; -- true
--   select public.inv_material_link_health();  -- as a signed-in user: cross_country_links 0, item_linked_twice 0
