-- ERP Stores Ledger, third review round (follow-up to 20261126140000_erp_store_ledger.sql)
-- STATUS: APPLIED LIVE 2026-11-26 (fixes to the feature the owner approved with "apply").
--   - begin takes the country from the store location (Material Master rows match it exactly).
--   - begin and apply refuse a store with an open stock audit.
--   - "balance date in the future" uses the Gulf day, not the UTC day.
--   - a null category counts as unclassified.
--   - finish holds a row the ledger refuses instead of failing every call (an upload could not finish or cancel).
--   - name history gets the same country isolation as the upload tables.
-- Stock increases follow the stock-count rule of _inv_post: the added units take the balance's current
-- average cost when it has valued units, otherwise they stay unvalued. ERP rates are never used.
-- Undo: re-run the three function bodies from 20261126140000 and drop the new policy.

create or replace function public.inv_erp_ledger_begin(p_payload jsonb)
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
  v_to date; v_from date;
  v_up uuid;
  v_prev public.erp_ledger_uploads%rowtype;
  l jsonb;
  v_code text; v_name text; v_cat text;
  v_item public.material_master%rowtype;
  v_cats text[] := array['tyre','spare_part','filter','lubricant','fuel','consumable','service','labour','capital','unclassified'];
  v_added jsonb := '[]'::jsonb; v_renamed jsonb := '[]'::jsonb; v_reclass jsonb := '[]'::jsonb;
  v_lines int; v_pending int;
begin
  r := public._inv_req_begin('inv_erp_ledger_begin', p_payload); if r is not null then return r; end if;
  perform public._inv_erp_ledger_gate();

  if v_country is null then raise exception 'Choose the country.' using errcode = '22023'; end if;
  if v_file is null then raise exception 'The file name is missing.' using errcode = '22023'; end if;
  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'The file fingerprint is missing.' using errcode = '22023'; end if;
  if coalesce(p_payload->>'report_id', '') <> 'CSOL-IMS-013-1' then
    raise exception 'This is not the ERP Stores Ledger report (CSOL-IMS-013-1).' using errcode = '22023';
  end if;
  if v_cur is null or v_cur is distinct from upper(public.currency_for_country(v_country)) then
    raise exception 'This file is in %, but % stock is kept in %. Amounts are never converted.',
      coalesce(v_cur, 'an unknown currency'), v_country, public.currency_for_country(v_country) using errcode = '22023';
  end if;
  begin v_to := (p_payload->>'period_to')::date; exception when others then v_to := null; end;
  begin v_from := nullif(p_payload->>'period_from', '')::date; exception when others then v_from := null; end;
  if v_to is null then raise exception 'The balance date of the file could not be read.' using errcode = '22023'; end if;
  if v_to > (now() at time zone 'Asia/Dubai')::date then raise exception 'The balance date % is in the future.', v_to using errcode = '22023'; end if;
  if jsonb_typeof(p_payload->'lines') is distinct from 'array'
     or jsonb_array_length(p_payload->'lines') < 1 or jsonb_array_length(p_payload->'lines') > 5000 then
    raise exception 'A ledger file needs 1 to 5000 lines.' using errcode = '22023';
  end if;

  select * into v_loc from public.inventory_locations where id = nullif(p_payload->>'location_id', '')::uuid;
  if not found or v_loc.organisation_id is distinct from v_org then
    raise exception 'Store location not found in your company.' using errcode = '42501';
  end if;
  if not v_loc.active then raise exception 'That store location is inactive.' using errcode = '22023'; end if;
  if coalesce(v_loc.location_type, '') <> 'warehouse' then
    raise exception 'The ledger can only be posted to a warehouse location.' using errcode = '22023';
  end if;
  if v_loc.country is not null and lower(btrim(v_loc.country)) <> lower(v_country) then
    raise exception 'That store is not in %.', v_country using errcode = '22023';
  end if;
  -- The store's own country decides the Material Master rows (exact match), never the request text.
  if v_loc.country is not null then v_country := v_loc.country; end if;
  if v_cur is distinct from upper(public.currency_for_country(v_country)) then
    raise exception 'This file is in %, but % stock is kept in %. Amounts are never converted.',
      v_cur, v_country, public.currency_for_country(v_country) using errcode = '22023';
  end if;
  if exists (select 1 from public.inventory_audits au
              where au.organisation_id = v_org and au.location_ids @> array[v_loc.id]
                and au.status in ('in_progress','counting_completed','reconciliation','recount','investigation','approval')) then
    raise exception 'A stock audit is open at this store. Close it before posting an ERP ledger.' using errcode = '22023';
  end if;
  if exists (select 1 from public.inventory_locations c where c.parent_id = v_loc.id) then
    raise exception 'Store % has bins under it; the ledger cannot be matched to one balance.', v_loc.code using errcode = '22023';
  end if;
  -- Every line must belong to this store.
  if exists (select 1 from jsonb_array_elements(p_payload->'lines') e
              where public._inv_erp_warehouse_code(e.value->>'warehouse') <> upper(v_loc.code)) then
    raise exception 'The file has lines for a store other than %. Upload one store per file.', v_loc.code using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_payload->'lines') e
              where nullif(btrim(e.value->>'code'), '') is null
                 or coalesce(e.value->>'qty', '') !~ '^-?[0-9]+(\.[0-9]+)?$') then
    raise exception 'Every line needs an item code and a quantity.' using errcode = '22023';
  end if;

  select * into v_prev from public.erp_ledger_uploads
   where organisation_id = v_org and file_sha256 = v_sha and status <> 'cancelled';
  if found then
    raise exception 'This file was already % on % (%).', case when v_prev.status = 'open' then 'started' else 'posted' end,
      to_char(v_prev.created_at, 'DD Mon YYYY HH24:MI'), v_prev.filename using errcode = '23505';
  end if;
  if exists (select 1 from public.erp_ledger_uploads where organisation_id = v_org and location_id = v_loc.id and status = 'open') then
    raise exception 'Another upload for % is not finished. Finish or cancel it first.', v_loc.code using errcode = '23505';
  end if;
  select * into v_prev from public.erp_ledger_uploads
   where organisation_id = v_org and location_id = v_loc.id and status = 'posted' and period_to > v_to
   order by period_to desc limit 1;
  if found then
    raise exception 'A newer ledger (balance at %) is already posted for %. An older file cannot overwrite it.',
      v_prev.period_to, v_loc.code using errcode = '22023';
  end if;

  insert into public.erp_ledger_uploads(organisation_id, country, location_id, site, warehouse_code, report_id, currency,
    period_from, period_to, filename, file_sha256, line_count, zero_missing, posted_by)
  values (v_org, v_country, v_loc.id, v_loc.site, upper(v_loc.code), 'CSOL-IMS-013-1', v_cur, v_from, v_to,
    v_file, v_sha, jsonb_array_length(p_payload->'lines'), coalesce((p_payload->>'zero_missing')::boolean, false), v_uid)
  returning id into v_up;

  -- 1. New item codes.
  for l in select value from jsonb_array_elements(coalesce(p_payload->'new_items', '[]'::jsonb)) order by value->>'code' loop
    v_code := upper(btrim(coalesce(l->>'code', '')));
    v_name := nullif(btrim(l->>'item_name'), '');
    v_cat := lower(coalesce(nullif(btrim(l->>'category'), ''), 'unclassified'));
    if v_code = '' or v_name is null then continue; end if;
    if not (v_cat = any(v_cats)) then v_cat := 'unclassified'; end if;
    insert into public.material_master(organisation_id, country, item_code, item_name, category, subcategory,
      reviewed, proposed_from, stocked, status, notes, serial_tracked)
    values (v_org, v_country, v_code, v_name, v_cat, nullif(btrim(l->>'subcategory'), ''),
      false, 'erp_store_ledger', true, 'active', 'Added from ERP stores ledger ' || v_file, v_cat = 'tyre')
    on conflict (organisation_id, country, item_code) do nothing;
    if found then v_added := v_added || jsonb_build_object('code', v_code, 'category', v_cat); end if;
  end loop;

  -- 2. Names to the ERP wording (never a fuller name to a cut-off one).
  for l in select value from jsonb_array_elements(coalesce(p_payload->'renames', '[]'::jsonb)) order by value->>'code' loop
    v_code := upper(btrim(coalesce(l->>'code', '')));
    v_name := nullif(btrim(l->>'item_name'), '');
    if v_code = '' or v_name is null then continue; end if;
    select * into v_item from public.material_master
     where organisation_id = v_org and country = v_country and item_code = v_code for update;
    if not found then continue; end if;
    if upper(btrim(coalesce(v_item.item_name, ''))) = upper(v_name) then continue; end if;
    if v_item.item_name is not null and starts_with(upper(btrim(v_item.item_name)), upper(v_name)) then continue; end if;
    update public.material_master set item_name = v_name where id = v_item.id;
    insert into public.material_master_name_history(organisation_id, item_id, item_code, country, old_name, new_name, source, source_ref, changed_by)
    values (v_org, v_item.id, v_code, v_item.country, v_item.item_name, v_name, 'erp_store_ledger', v_up, v_uid);
    v_renamed := v_renamed || to_jsonb(v_code);
  end loop;

  -- 3. A category for items still unclassified and unreviewed.
  for l in select value from jsonb_array_elements(coalesce(p_payload->'reclassify', '[]'::jsonb)) order by value->>'code' loop
    v_code := upper(btrim(coalesce(l->>'code', '')));
    v_cat := lower(coalesce(nullif(btrim(l->>'category'), ''), ''));
    if v_code = '' or not (v_cat = any(v_cats)) or v_cat = 'unclassified' then continue; end if;
    update public.material_master set category = v_cat, serial_tracked = (serial_tracked or v_cat = 'tyre'),
      subcategory = coalesce(subcategory, nullif(btrim(l->>'subcategory'), '')),
      proposed_from = coalesce(proposed_from, 'erp_store_ledger')
     where organisation_id = v_org and country = v_country and item_code = v_code
       and (category = 'unclassified' or category is null) and reviewed is not true;
    if found then v_reclass := v_reclass || jsonb_build_object('code', v_code, 'category', v_cat); end if;
  end loop;

  -- 4. One line per item code. A code with any negative line is held back whole.
  insert into public.erp_ledger_upload_lines(organisation_id, upload_id, country, item_code, description, erp_qty, erp_rate,
    erp_value, source_rows, has_negative, status, reason)
  select v_org, v_up, v_country, g.code, g.description, g.qty, g.rate, g.value, g.n, g.neg,
         case when g.neg then 'held' else 'pending' end, case when g.neg then 'negative_qty' end
    from (
      select upper(btrim(e.value->>'code')) code,
             max(nullif(btrim(e.value->>'description'), '')) description,
             sum((e.value->>'qty')::numeric) qty,
             max(case when coalesce(e.value->>'rate', '') ~ '^[0-9]+(\.[0-9]+)?$' and (e.value->>'rate')::numeric > 0
                      then (e.value->>'rate')::numeric end) rate,
             sum(case when coalesce(e.value->>'value', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.value->>'value')::numeric end) value,
             count(*)::int n,
             bool_or((e.value->>'qty')::numeric < 0 or coalesce((e.value->>'has_negative')::boolean, false)) neg
        from jsonb_array_elements(p_payload->'lines') e
       group by upper(btrim(e.value->>'code'))
    ) g;
  get diagnostics v_lines = row_count;
  select count(*) into v_pending from public.erp_ledger_upload_lines where upload_id = v_up and status = 'pending';

  update public.erp_ledger_uploads set applied = jsonb_build_object('items_added', v_added, 'names_updated', v_renamed,
    'categories_set', v_reclass, 'movements_after_balance_date', p_payload->'movements_after',
    'movements_after_acknowledged', coalesce((p_payload->>'movements_after_ack')::boolean, false)) where id = v_up;

  return public._inv_req_end('inv_erp_ledger_begin', p_payload, jsonb_build_object('upload_id', v_up,
    'codes', v_lines, 'pending', v_pending, 'items_added', jsonb_array_length(v_added),
    'names_updated', jsonb_array_length(v_renamed), 'categories_set', jsonb_array_length(v_reclass)));
end $function$;

create or replace function public.inv_erp_ledger_apply(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r jsonb;
  v_org uuid := public.app_current_org();
  v public.erp_ledger_uploads%rowtype;
  v_loc public.inventory_locations%rowtype;
  v_limit int := least(greatest(coalesce((p_payload->>'limit')::int, 150), 1), 200);
  x public.erp_ledger_upload_lines%rowtype;
  v_item public.material_master%rowtype;
  v_rec public.stock_records%rowtype;
  v_delta numeric; v_res jsonb; v_n int := 0; v_left int;
begin
  r := public._inv_req_begin('inv_erp_ledger_apply', p_payload); if r is not null then return r; end if;
  perform public._inv_erp_ledger_gate();
  select * into v from public.erp_ledger_uploads where id = nullif(p_payload->>'upload_id', '')::uuid for update;
  if not found or v.organisation_id is distinct from v_org then raise exception 'Upload not found.' using errcode = 'P0002'; end if;
  if v.status <> 'open' then raise exception 'This upload is already %.', v.status using errcode = '22023'; end if;
  select * into v_loc from public.inventory_locations where id = v.location_id;
  if exists (select 1 from public.inventory_audits au
              where au.organisation_id = v_org and au.location_ids @> array[v.location_id]
                and au.status in ('in_progress','counting_completed','reconciliation','recount','investigation','approval')) then
    raise exception 'A stock audit is open at this store. Close it before posting an ERP ledger.' using errcode = '22023';
  end if;

  for x in select * from public.erp_ledger_upload_lines
             where upload_id = v.id and status = 'pending' order by item_code limit v_limit for update loop
    select * into v_item from public.material_master
     where organisation_id = v_org and country = v.country and item_code = x.item_code;
    if not found then
      update public.erp_ledger_upload_lines set status = 'held', reason = 'no_item', processed_at = now() where id = x.id;
      v_n := v_n + 1; continue;
    end if;
    if v_item.serial_tracked or v_item.lot_tracked or v_item.category = 'tyre' then
      update public.erp_ledger_upload_lines set status = 'held', reason = 'serial_tracked', item_id = v_item.id, processed_at = now() where id = x.id;
      v_n := v_n + 1; continue;
    end if;
    select * into v_rec from public.stock_records
     where organisation_id = v_org and item_id = v_item.id and location_id = v_loc.id
       and condition = 'new' and ownership = 'owned' and owner_supplier_id is null
     for update;
    if found and x.erp_qty < coalesce(v_rec.qty_reserved, 0) then
      update public.erp_ledger_upload_lines set status = 'held', reason = 'below_reserved', item_id = v_item.id,
        stock_id = v_rec.id, qty_before = v_rec.qty_on_hand, processed_at = now() where id = x.id;
      v_n := v_n + 1; continue;
    end if;
    v_delta := x.erp_qty - coalesce(v_rec.qty_on_hand, 0);
    if v_delta = 0 then
      update public.erp_ledger_upload_lines set status = 'unchanged', item_id = v_item.id, stock_id = v_rec.id,
        qty_before = v_rec.qty_on_hand, qty_change = 0, processed_at = now() where id = x.id;
      v_n := v_n + 1; continue;
    end if;
    begin
      v_res := public._inv_post(jsonb_build_object(
        'idempotency_key', 'erpledger:' || v.id::text || ':' || x.item_code,
        'stock_id', v_rec.id, 'item_id', v_item.id, 'location_id', v_loc.id,
        'movement_type', 'stocktake', 'qty_change', v_delta,
        'reason', 'ERP stores ledger ' || v.filename || ' as at ' || v.period_to,
        'source_doc_type', 'erp_ledger', 'source_doc_id', v.id::text, 'approval_ref', v.id::text), false);
      if v_res->>'status' = 'refused_shortage' then
        raise exception 'Item % at % cannot go below reserved stock.', x.item_code, v_loc.code using errcode = '23514';
      end if;
      update public.erp_ledger_upload_lines set status = 'posted', item_id = v_item.id,
        stock_id = coalesce(v_rec.id, nullif(v_res->>'stock_id', '')::uuid), qty_before = coalesce(v_rec.qty_on_hand, 0),
        qty_change = v_delta, movement_id = nullif(v_res->>'movement_id', '')::uuid, processed_at = now()
       where id = x.id;
    exception when others then
      -- One bad line must not block the whole store: hold it with the reason and carry on.
      update public.erp_ledger_upload_lines set status = 'held', reason = 'error: ' || left(sqlerrm, 180), item_id = v_item.id,
        stock_id = v_rec.id, qty_before = v_rec.qty_on_hand, processed_at = now() where id = x.id;
    end;
    v_n := v_n + 1;
  end loop;

  select count(*) into v_left from public.erp_ledger_upload_lines where upload_id = v.id and status = 'pending';
  return public._inv_req_end('inv_erp_ledger_apply', p_payload, jsonb_build_object('upload_id', v.id, 'processed', v_n, 'remaining', v_left));
end $function$;

create or replace function public.inv_erp_ledger_finish(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r jsonb;
  v_org uuid := public.app_current_org();
  v public.erp_ledger_uploads%rowtype;
  v_limit int := least(greatest(coalesce((p_payload->>'limit')::int, 150), 1), 200);
  v_rec record; v_res jsonb; v_n int := 0; v_left int := 0; v_summary jsonb;
begin
  r := public._inv_req_begin('inv_erp_ledger_finish', p_payload); if r is not null then return r; end if;
  perform public._inv_erp_ledger_gate();
  select * into v from public.erp_ledger_uploads where id = nullif(p_payload->>'upload_id', '')::uuid for update;
  if not found or v.organisation_id is distinct from v_org then raise exception 'Upload not found.' using errcode = 'P0002'; end if;
  if v.status <> 'open' then raise exception 'This upload is already %.', v.status using errcode = '22023'; end if;
  if exists (select 1 from public.erp_ledger_upload_lines where upload_id = v.id and status = 'pending') then
    raise exception 'Some lines are not posted yet. Continue the upload first.' using errcode = '22023';
  end if;

  if v.zero_missing then
    for v_rec in
      select s.id, s.qty_on_hand, s.qty_reserved, m.item_code, coalesce(m.item_name, s.description) description, m.id item_id
        from public.stock_records s join public.material_master m on m.id = s.item_id
       where s.organisation_id = v_org and s.location_id = v.location_id and s.qty_on_hand > 0
         and s.condition = 'new' and s.ownership = 'owned' and s.owner_supplier_id is null
         and not exists (select 1 from public.erp_ledger_upload_lines x where x.upload_id = v.id and x.item_code = upper(btrim(m.item_code)))
       order by s.id limit v_limit
       for update of s
    loop
      if coalesce(v_rec.qty_reserved, 0) > 0 or exists (select 1 from public.material_master mm where mm.id = v_rec.item_id and (mm.serial_tracked or mm.lot_tracked or mm.category = 'tyre')) then
        insert into public.erp_ledger_upload_lines(organisation_id, upload_id, country, item_code, description, erp_qty, status, reason,
          item_id, stock_id, qty_before, processed_at)
        values (v_org, v.id, v.country, v_rec.item_code, v_rec.description, null, 'held',
          case when coalesce(v_rec.qty_reserved, 0) > 0 then 'missing_but_reserved' else 'serial_tracked' end,
          v_rec.item_id, v_rec.id, v_rec.qty_on_hand, now());
        v_n := v_n + 1; continue;
      end if;
      begin
        v_res := public._inv_post(jsonb_build_object(
          'idempotency_key', 'erpledger:' || v.id::text || ':zero:' || v_rec.id::text,
          'stock_id', v_rec.id, 'movement_type', 'stocktake', 'qty_change', -v_rec.qty_on_hand,
          'reason', 'Not in ERP stores ledger ' || v.filename || ' as at ' || v.period_to, 'source_doc_type', 'erp_ledger',
          'source_doc_id', v.id::text, 'approval_ref', v.id::text), false);
        if v_res->>'status' = 'refused_shortage' then
          raise exception 'Stock % cannot go below reserved stock.', v_rec.item_code using errcode = '23514';
        end if;
        insert into public.erp_ledger_upload_lines(organisation_id, upload_id, country, item_code, description, erp_qty, status,
          item_id, stock_id, qty_before, qty_change, movement_id, processed_at)
        values (v_org, v.id, v.country, v_rec.item_code, v_rec.description, 0, 'zeroed', v_rec.item_id, v_rec.id,
          v_rec.qty_on_hand, -v_rec.qty_on_hand, nullif(v_res->>'movement_id', '')::uuid, now());
      exception when others then
        -- One row the ledger refuses (e.g. a blind count in progress) is held; the upload still finishes.
        insert into public.erp_ledger_upload_lines(organisation_id, upload_id, country, item_code, description, erp_qty, status, reason,
          item_id, stock_id, qty_before, processed_at)
        values (v_org, v.id, v.country, v_rec.item_code, v_rec.description, null, 'held', 'error: ' || left(sqlerrm, 180),
          v_rec.item_id, v_rec.id, v_rec.qty_on_hand, now())
        on conflict (upload_id, item_code) do nothing;
      end;
      v_n := v_n + 1;
    end loop;
    select count(*) into v_left
      from public.stock_records s join public.material_master m on m.id = s.item_id
     where s.organisation_id = v_org and s.location_id = v.location_id and s.qty_on_hand > 0
       and s.condition = 'new' and s.ownership = 'owned' and s.owner_supplier_id is null
       and not exists (select 1 from public.erp_ledger_upload_lines x where x.upload_id = v.id and x.item_code = upper(btrim(m.item_code)));
  end if;

  if v_left > 0 then
    return public._inv_req_end('inv_erp_ledger_finish', p_payload, jsonb_build_object('upload_id', v.id, 'processed', v_n, 'remaining', v_left));
  end if;

  select jsonb_build_object('upload_id', v.id, 'location', v.warehouse_code, 'site', v.site,
      'items_added', jsonb_array_length(coalesce(v.applied->'items_added', '[]')),
      'names_updated', jsonb_array_length(coalesce(v.applied->'names_updated', '[]')),
      'categories_set', jsonb_array_length(coalesce(v.applied->'categories_set', '[]')),
      'quantities_changed', count(*) filter (where status = 'posted'),
      'quantities_unchanged', count(*) filter (where status = 'unchanged'),
      'set_to_zero', count(*) filter (where status = 'zeroed'),
      'qty_increase', coalesce(sum(qty_change) filter (where qty_change > 0), 0),
      'qty_decrease', coalesce(sum(qty_change) filter (where qty_change < 0), 0),
      'held_back', coalesce(jsonb_agg(jsonb_build_object('code', item_code, 'qty', erp_qty, 'reason', reason) order by item_code)
                              filter (where status = 'held'), '[]'::jsonb))
    into v_summary from public.erp_ledger_upload_lines where upload_id = v.id;
  update public.erp_ledger_uploads set status = 'posted', posted_at = now(), summary = v_summary where id = v.id;
  insert into public.system_logs (module_id, severity, source, message, detail, user_id)
  values ('stock', 'info', 'inv_erp_ledger_finish', 'ERP stores ledger posted', v_summary, auth.uid());
  return public._inv_req_end('inv_erp_ledger_finish', p_payload, v_summary || jsonb_build_object('remaining', 0, 'done', true));
end $function$;

drop policy if exists material_master_name_history_country_isolation on public.material_master_name_history;
create policy material_master_name_history_country_isolation on public.material_master_name_history as restrictive for select to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));
