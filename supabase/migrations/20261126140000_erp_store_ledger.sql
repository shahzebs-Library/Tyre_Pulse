-- ERP Stores Ledger upload (Ramco report CSOL-IMS-013-1)
-- STATUS: NOT APPLIED. Apply only on the owner's explicit OK.
--
-- What it adds
--   1. erp_ledger_uploads: one row per uploaded file (file name, sha256, report id, period,
--      currency, warehouse, every line with its ERP rate and value, and what was posted).
--      The same file (same sha256) can never be posted twice.
--   2. material_master_name_history: every item name the upload changed, old and new.
--   3. inv_erp_ledger_post(p_payload): the owner posts one warehouse file in one go:
--        - adds item codes the Material Master does not have (with the category the screen
--          suggested; reviewed stays false so Material Master review still sees them),
--        - updates item names to the ERP wording (never a fuller name to a cut-off one),
--        - sets a category on items still "unclassified" (unreviewed only),
--        - sets each item's quantity at that store to the ERP closing balance (a stocktake
--          movement for the difference, computed here from live stock, not from the screen),
--        - optionally sets stock the file does not list to zero (only when asked),
--        - holds back negative ERP quantities and anything below reserved stock.
--
-- Owner decisions behind it (2026-11-26)
--   - "If I upload, approval not required": only the platform owner (super admin) may post,
--     and the post needs no second person. Everyone else is refused in the database.
--   - ERP rates are kept on the upload row only; they are NOT written as stock cost.
--     A line with no rate stays unvalued, never 0.
--   - Item codes match exactly (upper case, trimmed); no fuzzy matching.
--
-- Proof: run inside a transaction that ends with ROLLBACK (see the proof block at the end).
-- Undo: drop function public.inv_erp_ledger_post(jsonb);
--       drop table public.material_master_name_history; drop table public.erp_ledger_uploads;
--       Stock movements posted by an upload are reversed with inv_reverse_movement
--       (source_doc_type = 'erp_ledger', source_doc_id = the upload id).

begin;

create table if not exists public.erp_ledger_uploads (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text not null,
  location_id uuid not null references public.inventory_locations(id),
  site text,
  warehouse_code text not null,
  report_id text,
  currency text,
  period_from date,
  period_to date,
  filename text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  line_count integer not null default 0,
  lines jsonb not null default '[]'::jsonb,
  summary jsonb,
  posted_by uuid not null default auth.uid(),
  posted_at timestamptz not null default now(),
  unique (organisation_id, file_sha256)
);
comment on table public.erp_ledger_uploads is
  'ERP Stores Ledger files the owner posted (inv_erp_ledger_post). Lines keep the ERP rate and value; rates are not stock cost.';

create table if not exists public.material_master_name_history (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  item_id uuid not null references public.material_master(id),
  item_code text not null,
  country text,
  old_name text,
  new_name text not null,
  source text not null,
  source_ref uuid,
  changed_by uuid not null default auth.uid(),
  changed_at timestamptz not null default now()
);
create index if not exists material_master_name_history_item_idx on public.material_master_name_history (item_id, changed_at desc);

alter table public.erp_ledger_uploads enable row level security;
alter table public.material_master_name_history enable row level security;

drop policy if exists erp_ledger_uploads_org_isolation on public.erp_ledger_uploads;
create policy erp_ledger_uploads_org_isolation on public.erp_ledger_uploads as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
drop policy if exists erp_ledger_uploads_read on public.erp_ledger_uploads;
create policy erp_ledger_uploads_read on public.erp_ledger_uploads for select to authenticated
  using ((select public.app_is_elevated()) or (select public.is_super_admin()));

drop policy if exists material_master_name_history_org_isolation on public.material_master_name_history;
create policy material_master_name_history_org_isolation on public.material_master_name_history as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
drop policy if exists material_master_name_history_read on public.material_master_name_history;
create policy material_master_name_history_read on public.material_master_name_history for select to authenticated
  using ((select public.app_is_active()) is true);

-- No client writes: rows are written only by inv_erp_ledger_post (security definer).
revoke all on public.erp_ledger_uploads from anon, authenticated;
revoke all on public.material_master_name_history from anon, authenticated;
grant select on public.erp_ledger_uploads to authenticated;
grant select on public.material_master_name_history to authenticated;

create or replace function public.inv_erp_ledger_post(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r jsonb;
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_country text := nullif(btrim(p_payload->>'country'), '');
  v_loc public.inventory_locations%rowtype;
  v_sha text := lower(btrim(coalesce(p_payload->>'file_sha256', '')));
  v_file text := nullif(btrim(p_payload->>'filename'), '');
  v_cur text := upper(nullif(btrim(p_payload->>'currency'), ''));
  v_up uuid;
  v_prev public.erp_ledger_uploads%rowtype;
  l jsonb;
  v_code text; v_name text; v_cat text; v_sub text; v_qty numeric;
  v_item public.material_master%rowtype;
  v_rec public.stock_records%rowtype;
  v_delta numeric; v_res jsonb;
  v_codes text[] := '{}';
  v_added int := 0; v_renamed int := 0; v_reclass int := 0;
  v_changed int := 0; v_unchanged int := 0; v_zeroed int := 0;
  v_up_qty numeric := 0; v_down_qty numeric := 0;
  v_held jsonb := '[]'::jsonb;
  v_cats text[] := array['tyre','spare_part','filter','lubricant','fuel','consumable','service','labour','capital','unclassified'];
  v_reason text;
  v_summary jsonb;
begin
  r := public._inv_req_begin('inv_erp_ledger_post', p_payload); if r is not null then return r; end if;

  if not public.is_super_admin() then
    raise exception 'Only the owner can post an ERP stores ledger.' using errcode = '42501';
  end if;
  if v_country is null then raise exception 'Choose the country.' using errcode = '22023'; end if;
  if v_file is null then raise exception 'The file name is missing.' using errcode = '22023'; end if;
  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'The file fingerprint is missing.' using errcode = '22023'; end if;
  if jsonb_typeof(p_payload->'lines') is distinct from 'array'
     or jsonb_array_length(p_payload->'lines') < 1 or jsonb_array_length(p_payload->'lines') > 5000 then
    raise exception 'A ledger file needs 1 to 5000 lines.' using errcode = '22023';
  end if;
  if v_cur is not null and v_cur is distinct from upper(public.currency_for_country(v_country)) then
    raise exception 'This file is in %, but % stock is kept in %. Amounts are never converted.', v_cur, v_country,
      public.currency_for_country(v_country) using errcode = '22023';
  end if;

  select * into v_loc from public.inventory_locations where id = nullif(p_payload->>'location_id', '')::uuid;
  if not found or v_loc.organisation_id is distinct from v_org then
    raise exception 'Store location not found in your company.' using errcode = '42501';
  end if;
  if not v_loc.active then raise exception 'That store location is inactive.' using errcode = '22023'; end if;
  if v_loc.country is not null and lower(btrim(v_loc.country)) <> lower(v_country) then
    raise exception 'That store is not in %.', v_country using errcode = '22023';
  end if;

  select * into v_prev from public.erp_ledger_uploads where organisation_id = v_org and file_sha256 = v_sha;
  if found then
    raise exception 'This file was already posted on % (%).', to_char(v_prev.posted_at, 'DD Mon YYYY HH24:MI'), v_prev.filename
      using errcode = '23505';
  end if;

  insert into public.erp_ledger_uploads(organisation_id, country, location_id, site, warehouse_code, report_id, currency,
    period_from, period_to, filename, file_sha256, line_count, lines, posted_by)
  values (v_org, v_country, v_loc.id, v_loc.site, upper(coalesce(nullif(btrim(p_payload->>'warehouse'), ''), v_loc.code)),
    nullif(btrim(p_payload->>'report_id'), ''), v_cur,
    nullif(p_payload->>'period_from', '')::date, nullif(p_payload->>'period_to', '')::date,
    v_file, v_sha, jsonb_array_length(p_payload->'lines'), p_payload->'lines', v_uid)
  returning id into v_up;

  -- 1. New item codes.
  for l in select value from jsonb_array_elements(coalesce(p_payload->'new_items', '[]'::jsonb)) loop
    v_code := upper(btrim(coalesce(l->>'code', '')));
    v_name := nullif(btrim(l->>'item_name'), '');
    v_cat := lower(coalesce(nullif(btrim(l->>'category'), ''), 'unclassified'));
    if v_code = '' or v_name is null then continue; end if;
    if not (v_cat = any(v_cats)) then v_cat := 'unclassified'; end if;
    insert into public.material_master(organisation_id, country, item_code, item_name, category, subcategory,
      reviewed, proposed_from, stocked, status, notes)
    values (v_org, v_country, v_code, v_name, v_cat, nullif(btrim(l->>'subcategory'), ''),
      false, 'erp_store_ledger', true, 'active', 'Added from ERP stores ledger ' || v_file)
    on conflict (organisation_id, country, item_code) do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;

  -- 2. Names to the ERP wording (never a fuller name to a cut-off one).
  for l in select value from jsonb_array_elements(coalesce(p_payload->'renames', '[]'::jsonb)) loop
    v_code := upper(btrim(coalesce(l->>'code', '')));
    v_name := nullif(btrim(l->>'item_name'), '');
    if v_code = '' or v_name is null then continue; end if;
    select * into v_item from public.material_master
     where organisation_id = v_org and lower(coalesce(country, '')) = lower(v_country) and item_code = v_code for update;
    if not found then continue; end if;
    if upper(btrim(coalesce(v_item.item_name, ''))) = upper(v_name) then continue; end if;
    if v_item.item_name is not null and upper(btrim(v_item.item_name)) like upper(v_name) || '%' then continue; end if;
    update public.material_master set item_name = v_name where id = v_item.id;
    insert into public.material_master_name_history(organisation_id, item_id, item_code, country, old_name, new_name, source, source_ref, changed_by)
    values (v_org, v_item.id, v_code, v_item.country, v_item.item_name, v_name, 'erp_store_ledger', v_up, v_uid);
    v_renamed := v_renamed + 1;
  end loop;

  -- 3. A category for items still unclassified and unreviewed.
  for l in select value from jsonb_array_elements(coalesce(p_payload->'reclassify', '[]'::jsonb)) loop
    v_code := upper(btrim(coalesce(l->>'code', '')));
    v_cat := lower(coalesce(nullif(btrim(l->>'category'), ''), ''));
    if v_code = '' or not (v_cat = any(v_cats)) or v_cat = 'unclassified' then continue; end if;
    update public.material_master set category = v_cat,
      subcategory = coalesce(subcategory, nullif(btrim(l->>'subcategory'), '')),
      proposed_from = coalesce(proposed_from, 'erp_store_ledger')
     where organisation_id = v_org and lower(coalesce(country, '')) = lower(v_country) and item_code = v_code
       and category = 'unclassified' and reviewed is not true;
    if found then v_reclass := v_reclass + 1; end if;
  end loop;

  -- 4. Quantities: set each item at this store to the ERP closing balance.
  for l in
    select jsonb_build_object('code', upper(btrim(value->>'code')), 'qty', sum((value->>'qty')::numeric)) as value
      from jsonb_array_elements(p_payload->'lines')
     where nullif(btrim(value->>'code'), '') is not null
     group by upper(btrim(value->>'code'))
  loop
    v_code := l->>'code';
    v_codes := v_codes || v_code;
    begin
      v_qty := (l->>'qty')::numeric;
    exception when others then
      v_held := v_held || jsonb_build_object('code', v_code, 'reason', 'bad_qty'); continue;
    end;
    if v_qty < 0 then
      v_held := v_held || jsonb_build_object('code', v_code, 'qty', v_qty, 'reason', 'negative_qty'); continue;
    end if;
    select * into v_item from public.material_master
     where organisation_id = v_org and lower(coalesce(country, '')) = lower(v_country) and item_code = v_code;
    if not found then
      v_held := v_held || jsonb_build_object('code', v_code, 'qty', v_qty, 'reason', 'no_item'); continue;
    end if;
    select * into v_rec from public.stock_records
     where organisation_id = v_org and item_id = v_item.id and location_id = v_loc.id
       and condition = 'new' and ownership = 'owned' and owner_supplier_id is null
     for update;
    if found and v_qty < coalesce(v_rec.qty_reserved, 0) then
      v_held := v_held || jsonb_build_object('code', v_code, 'qty', v_qty, 'reason', 'below_reserved'); continue;
    end if;
    v_delta := v_qty - coalesce(v_rec.qty_on_hand, 0);
    if v_delta = 0 then v_unchanged := v_unchanged + 1; continue; end if;
    v_reason := 'ERP stores ledger ' || v_file || coalesce(' as at ' || (p_payload->>'period_to'), '');
    v_res := public._inv_post(jsonb_build_object(
      'idempotency_key', 'erpledger:' || v_up::text || ':' || v_code,
      'stock_id', v_rec.id, 'item_id', v_item.id, 'location_id', v_loc.id,
      'movement_type', 'stocktake', 'qty_change', v_delta,
      'currency', public.currency_for_country(v_country),
      'reason', v_reason, 'source_doc_type', 'erp_ledger', 'source_doc_id', v_up::text, 'approval_ref', v_up::text), false);
    if v_res->>'status' = 'refused_shortage' then
      raise exception 'Item % at % cannot go below reserved stock.', v_code, v_loc.code using errcode = '23514';
    end if;
    v_changed := v_changed + 1;
    if v_delta > 0 then v_up_qty := v_up_qty + v_delta; else v_down_qty := v_down_qty + v_delta; end if;
  end loop;

  -- 5. Optional: stock this store holds that the file does not list goes to zero.
  if coalesce((p_payload->>'zero_missing')::boolean, false) then
    for v_rec in
      select s.* from public.stock_records s join public.material_master m on m.id = s.item_id
       where s.organisation_id = v_org and s.location_id = v_loc.id and s.qty_on_hand > 0
         and not (m.item_code = any(v_codes))
       for update of s
    loop
      if coalesce(v_rec.qty_reserved, 0) > 0 then
        v_held := v_held || jsonb_build_object('stock_id', v_rec.id, 'reason', 'missing_but_reserved'); continue;
      end if;
      v_res := public._inv_post(jsonb_build_object(
        'idempotency_key', 'erpledger:' || v_up::text || ':zero:' || v_rec.id::text,
        'stock_id', v_rec.id, 'movement_type', 'stocktake', 'qty_change', -v_rec.qty_on_hand,
        'reason', 'Not in ERP stores ledger ' || v_file, 'source_doc_type', 'erp_ledger',
        'source_doc_id', v_up::text, 'approval_ref', v_up::text), false);
      if v_res->>'status' = 'refused_shortage' then
        raise exception 'Stock % cannot go below reserved stock.', v_rec.id using errcode = '23514';
      end if;
      v_zeroed := v_zeroed + 1;
      v_down_qty := v_down_qty - v_rec.qty_on_hand;
    end loop;
  end if;

  v_summary := jsonb_build_object('upload_id', v_up, 'location', v_loc.code, 'site', v_loc.site,
    'items_added', v_added, 'names_updated', v_renamed, 'categories_set', v_reclass,
    'quantities_changed', v_changed, 'quantities_unchanged', v_unchanged, 'set_to_zero', v_zeroed,
    'qty_increase', v_up_qty, 'qty_decrease', v_down_qty, 'held_back', v_held);
  update public.erp_ledger_uploads set summary = v_summary where id = v_up;

  insert into public.system_logs (module_id, severity, source, message, detail, user_id)
  values ('stock', 'info', 'inv_erp_ledger_post', 'ERP stores ledger posted', v_summary, v_uid);

  return public._inv_req_end('inv_erp_ledger_post', p_payload, v_summary);
end $function$;

revoke all on function public.inv_erp_ledger_post(jsonb) from public;
revoke all on function public.inv_erp_ledger_post(jsonb) from anon;
grant execute on function public.inv_erp_ledger_post(jsonb) to authenticated;

commit;

-- Proof (run as the owner inside BEGIN ... ROLLBACK; nothing persists):
--   select set_config('request.jwt.claims', '{"sub":"<owner uuid>","role":"authenticated"}', true);
--   set local role authenticated;
--   select public.inv_erp_ledger_post('{"idempotency_key":"<uuid>", ...}'::jsonb);
--   -- then: a non-owner gets 42501; the same file_sha256 again gets 23505;
--   -- a negative qty line is listed in held_back; stock_records at the store match the file.
