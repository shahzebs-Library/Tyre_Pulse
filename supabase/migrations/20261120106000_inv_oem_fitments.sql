-- =============================================================================
-- 20261120106000_inv_oem_fitments.sql
-- STATUS: APPLIED to production 2026-11-20 (ledger 20261120106000, owner order; applied text = sha256 7380c5cc8dccde4e at commit aefb9ee0 before this STATUS edit; see docs/inventory/96_PRODUCTION_RELEASE_RECORD.md). Inventory compatibility data. Requires 20261120100000..101000.
--         Rollback: 20261120106000_inv_oem_fitments_ROLLBACK.sql
--
-- Compatibility comes ONLY from validated data (owner correction 5): an OEM part
-- number cross-referenced to an item, and an item fitted to a make/model/asset
-- class, each with evidence and an engineering approval by someone other than
-- the proposer. No description matching. Until rows are approved, readers must
-- say "No validated compatibility data" - v_validated_compatibility returns only
-- approved, in-date rows.
-- =============================================================================
begin;

create table if not exists public.oem_part_references (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text,
  oem_part_no text not null check (length(btrim(oem_part_no)) between 1 and 120),
  oem_part_no_normalized text generated always as (upper(regexp_replace(oem_part_no, '[^A-Za-z0-9]', '', 'g'))) stored,
  manufacturer text,
  item_id uuid not null references public.material_master(id),
  oem_entry_id uuid,
  evidence jsonb not null default '[]'::jsonb,
  source text not null,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','retired')),
  proposed_by uuid not null default auth.uid(), proposed_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz, decision_note text,
  effective_from date not null default current_date, effective_to date,
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists oem_part_references_live_uq on public.oem_part_references
  (organisation_id, oem_part_no_normalized, item_id) where status in ('proposed','approved');
create index if not exists oem_part_references_item_idx on public.oem_part_references (item_id);
select public._inv_secure_table('oem_part_references', true, false);

create table if not exists public.equipment_fitments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text,
  item_id uuid not null references public.material_master(id),
  make text, model text, asset_class text, model_code text,
  serial_from text, serial_to text,
  position text,
  quantity_per_unit numeric check (quantity_per_unit is null or quantity_per_unit > 0),
  evidence jsonb not null default '[]'::jsonb,
  source text not null,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','retired')),
  proposed_by uuid not null default auth.uid(), proposed_at timestamptz not null default now(),
  engineering_approved_by uuid, engineering_approved_at timestamptz, decision_note text,
  effective_from date not null default current_date, effective_to date,
  check (coalesce(make, model, asset_class, model_code) is not null),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists equipment_fitments_item_idx on public.equipment_fitments (item_id);
create index if not exists equipment_fitments_model_idx on public.equipment_fitments (organisation_id, upper(make), upper(model));
select public._inv_secure_table('equipment_fitments', true, false);

create or replace function public.inv_compat_propose(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_org uuid := public.app_current_org(); v_id uuid;
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('view') and (public.app_is_elevated()
       or public.inv_can('procure') or public.inv_can('engineering_approve'))) then
    raise exception 'Not authorised to propose compatibility data.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.material_master where id = (p->>'item_id')::uuid and organisation_id = v_org) then
    raise exception 'Item not found in your company.' using errcode = '42501';
  end if;
  if nullif(btrim(p->>'source'), '') is null or jsonb_array_length(coalesce(p->'evidence', '[]'::jsonb)) = 0 then
    raise exception 'Compatibility needs a source and at least one evidence entry (manual page, OEM entry, test).' using errcode = '22023';
  end if;
  if p->>'kind' = 'oem' then
    insert into public.oem_part_references(organisation_id, country, oem_part_no, manufacturer, item_id, oem_entry_id, evidence, source,
      effective_from, effective_to)
    values (v_org, p->>'country', btrim(p->>'oem_part_no'), p->>'manufacturer', (p->>'item_id')::uuid,
      nullif(p->>'oem_entry_id', '')::uuid, p->'evidence', btrim(p->>'source'),
      coalesce(nullif(p->>'effective_from', '')::date, current_date), nullif(p->>'effective_to', '')::date)
    returning id into v_id;
  elsif p->>'kind' = 'fitment' then
    insert into public.equipment_fitments(organisation_id, country, item_id, make, model, asset_class, model_code, serial_from,
      serial_to, position, quantity_per_unit, evidence, source, effective_from, effective_to)
    values (v_org, p->>'country', (p->>'item_id')::uuid, p->>'make', p->>'model', p->>'asset_class', p->>'model_code',
      p->>'serial_from', p->>'serial_to', p->>'position', nullif(p->>'quantity_per_unit', '')::numeric, p->'evidence',
      btrim(p->>'source'), coalesce(nullif(p->>'effective_from', '')::date, current_date), nullif(p->>'effective_to', '')::date)
    returning id into v_id;
  else
    raise exception 'kind must be oem or fitment.' using errcode = '22023';
  end if;
  return v_id;
end $fn$;

create or replace function public.inv_compat_decide(p_kind text, p_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_by uuid; v_status text := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected'
  when 'retire' then 'retired' end;
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('engineering_approve') or public.is_super_admin()) then
    raise exception 'Engineering approval permission is required (stock:engineering_approve).' using errcode = '42501';
  end if;
  if v_status is null then raise exception 'Decision must be approve, reject or retire.' using errcode = '22023'; end if;
  if v_status <> 'approved' and nullif(btrim(p_note), '') is null then raise exception 'Give a note.' using errcode = '22023'; end if;
  if p_kind = 'oem' then
    select proposed_by into v_by from public.oem_part_references where id = p_id and organisation_id = public.app_current_org();
  elsif p_kind = 'fitment' then
    select proposed_by into v_by from public.equipment_fitments where id = p_id and organisation_id = public.app_current_org();
  else raise exception 'kind must be oem or fitment.' using errcode = '22023';
  end if;
  if v_by is null then raise exception 'Record not found.' using errcode = 'P0002'; end if;
  if v_by = auth.uid() then raise exception 'The proposer cannot approve their own compatibility record.' using errcode = '42501'; end if;
  if p_kind = 'oem' then
    update public.oem_part_references set status = v_status, approved_by = auth.uid(), approved_at = now(), decision_note = p_note,
      effective_to = case when v_status = 'retired' then current_date else effective_to end where id = p_id;
  else
    update public.equipment_fitments set status = v_status, engineering_approved_by = auth.uid(), engineering_approved_at = now(),
      decision_note = p_note, effective_to = case when v_status = 'retired' then current_date else effective_to end where id = p_id;
  end if;
  return jsonb_build_object('id', p_id, 'status', v_status);
end $fn$;

create or replace view public.v_validated_compatibility with (security_invoker = on) as
select 'oem'::text as kind, o.organisation_id, o.country, o.item_id, o.oem_part_no, o.manufacturer,
       null::text as make, null::text as model, null::text as asset_class, o.approved_by as approved_by, o.approved_at
  from public.oem_part_references o
 where o.status = 'approved' and o.effective_from <= current_date and (o.effective_to is null or o.effective_to >= current_date)
union all
select 'fitment', f.organisation_id, f.country, f.item_id, null, null, f.make, f.model, f.asset_class,
       f.engineering_approved_by, f.engineering_approved_at
  from public.equipment_fitments f
 where f.status = 'approved' and f.effective_from <= current_date and (f.effective_to is null or f.effective_to >= current_date);
revoke all on public.v_validated_compatibility from anon;
grant select on public.v_validated_compatibility to authenticated;

revoke all on function public.inv_compat_propose(jsonb), public.inv_compat_decide(text, uuid, text, text) from public, anon;
grant execute on function public.inv_compat_propose(jsonb), public.inv_compat_decide(text, uuid, text, text) to authenticated;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
