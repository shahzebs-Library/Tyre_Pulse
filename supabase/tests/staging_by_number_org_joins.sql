-- Leak cases for 20261117110000_by_number_org_joins.sql, run on a private copy of the LOCAL
-- staging mirror only (synthetic companies Alpha = A, Beta = B). Never run on production.
-- Driver: supabase/tests/staging_by_number_org_joins.sh
--
-- Each case: company B holds the SAME job card number (or asset code) as company A, then the
-- case checks that one company's data does not move the other's. Every case runs in its own
-- sub-transaction that is rolled back (the 'case_done' sentinel), and the whole file ends in
-- ROLLBACK, so the database is unchanged. Prints one PASS/FAIL line per assertion.
-- Before the migration the leak assertions print FAIL; after it they print PASS.
\set ON_ERROR_STOP on

begin;

create temp table k (name text primary key, v text) on commit drop;
insert into k values
  ('A',        '00000000-0000-0000-0000-000000000001'),
  ('B',        'bbbbbbbb-0000-4000-8000-000000000002'),
  ('A_admin',  'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'),   -- Alpha Admin, not super admin
  ('super',    '5eacf3d3-29af-5995-bc52-bcef51b82c38'),   -- super admin (Alpha)
  ('X',        'ALP/JC/R0066/1225'),                      -- Alpha job card, asset TM010, KSA
  ('B_only',   'BET/JC/0001/0425');                       -- a number only Beta holds
create or replace function pg_temp.k(p text) returns text language sql stable as $$ select v from k where name = p $$;

-- Sign in as a synthetic person (or nobody: '' = service role / staging pipe).
create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  if coalesce(p_uid, '') = '' then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  end if;
end $$;

create or replace function pg_temp.verdict(p_ok boolean) returns text language sql immutable as $$
  select case when p_ok then 'PASS' else 'FAIL' end $$;

-- Preconditions the cases rely on.
do $pre$
begin
  if not exists (select 1 from public.work_orders where organisation_id = pg_temp.k('A')::uuid and work_order_no = pg_temp.k('X')) then
    raise exception 'precondition: Alpha job card % missing from the mirror', pg_temp.k('X');
  end if;
  if exists (select 1 from public.work_orders where organisation_id = pg_temp.k('B')::uuid and work_order_no = pg_temp.k('X')) then
    raise exception 'precondition: Beta already holds %', pg_temp.k('X');
  end if;
  if exists (select 1 from public.work_orders where organisation_id = pg_temp.k('A')::uuid and work_order_no = pg_temp.k('B_only')) then
    raise exception 'precondition: Alpha already holds %', pg_temp.k('B_only');
  end if;
end $pre$;

-- 1. process_stg_complaints ---------------------------------------------------------------
do $c1$
declare n_b int; n_a int;
begin
  begin
    -- Beta imports a complaint whose job card number Alpha already holds.
    perform pg_temp.as_user('');
    perform set_config('tp.import_org', pg_temp.k('B'), true);
    insert into public.stg_complaints (country, veh_no, jc_no, complaints, job_done_description, vehicle_in_date)
    values ('KSA', 'ZZB001', pg_temp.k('X'), 'Beta complaint', 'Beta fix', '01-02-2026');
    select count(*) into n_b from public.work_orders where organisation_id = pg_temp.k('B')::uuid and work_order_no = pg_temp.k('X');
    raise notice '% complaints: Beta row with Alpha''s number lands for Beta (beta_rows=%)', pg_temp.verdict(n_b = 1), n_b;
    -- Alpha re-importing its own existing card is still skipped as a duplicate.
    perform set_config('tp.import_org', pg_temp.k('A'), true);
    insert into public.stg_complaints (country, veh_no, jc_no, complaints, job_done_description, vehicle_in_date)
    values ('KSA', 'TM010', pg_temp.k('X'), 'Alpha again', 'x', '01-02-2026');
    select count(*) into n_a from public.work_orders where organisation_id = pg_temp.k('A')::uuid and work_order_no = pg_temp.k('X');
    raise notice '% complaints: Alpha re-upload of its own card still skipped (alpha_rows=%)', pg_temp.verdict(n_a = 1), n_a;
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL complaints: error % %', sqlstate, sqlerrm; end if;
  end;
end $c1$;

-- 2. process_stg_monthly_tyres ------------------------------------------------------------
do $c2$
declare t record; v_before text; v_after text; n_upd int;
begin
  begin
    select * into t from public.tyre_records
     where organisation_id = pg_temp.k('A')::uuid and removal_date is not null and job_card is not null
       and position is not null and serial_no is not null and issue_date is not null and removal_date > issue_date
     order by id limit 1;
    v_before := md5(to_jsonb(t)::text);
    -- Beta's monthly file carries a row with the same serial, country, date, job card and
    -- position as Alpha's tyre, with a different removal reason.
    perform pg_temp.as_user('');
    perform set_config('tp.import_org', pg_temp.k('B'), true);
    insert into public.stg_monthly_tyres (organisation_id, country, job_card_no, veh_no, tyre_position, tyre_no,
                                          tyre_fix_date, tyre_removed_date, reason, brand)
    values (pg_temp.k('B')::uuid, t.country, t.job_card, t.asset_no, t.position, t.serial_no,
            to_char(t.issue_date, 'YYYY-MM-DD'), to_char(t.removal_date, 'YYYY-MM-DD'), 'ZZ BETA REASON', 'ZZBETABRAND');
    select md5(to_jsonb(r)::text) into v_after from public.tyre_records r where r.id = t.id;
    select count(*) into n_upd from public.stg_monthly_tyres_audit
     where tyre_record_id = t.id and reason = 'updated_changed_values';
    raise notice '% monthly tyres: Beta''s file does not patch Alpha''s tyre (alpha_row_unchanged=%, patched=%)',
      pg_temp.verdict(v_before = v_after and n_upd = 0), v_before = v_after, n_upd;
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL monthly tyres: error % %', sqlstate, sqlerrm; end if;
  end;
end $c2$;

-- 3. convert_repair_request_to_job_card ---------------------------------------------------
do $c3$
declare v_rr uuid; v_res jsonb; v_b_before text; v_b_after text; n_a int;
begin
  begin
    select md5(to_jsonb(w)::text) into v_b_before from public.work_orders w
     where organisation_id = pg_temp.k('B')::uuid and work_order_no = pg_temp.k('B_only');
    perform pg_temp.as_user(pg_temp.k('A_admin'));
    insert into public.repair_requests (organisation_id, country, site, asset_no, description, priority, status)
    values (pg_temp.k('A')::uuid, 'KSA', 'ALPHA EAST PLANT', 'TM010', 'by-number test', 'Medium', 'submitted')
    returning id into v_rr;
    -- Alpha chooses a job card number that only Beta holds: per-company numbers allow it.
    v_res := public.convert_repair_request_to_job_card(v_rr, pg_temp.k('B_only'), null, null);
    select count(*) into n_a from public.work_orders where organisation_id = pg_temp.k('A')::uuid and work_order_no = pg_temp.k('B_only');
    raise notice '% convert repair request: Alpha not refused because Beta holds the number (ok=%, alpha_rows=%, reason=%)',
      pg_temp.verdict(coalesce((v_res->>'ok')::boolean, false) and n_a = 1), v_res->>'ok', n_a, coalesce(v_res->>'message', '-');
    select md5(to_jsonb(w)::text) into v_b_after from public.work_orders w
     where organisation_id = pg_temp.k('B')::uuid and work_order_no = pg_temp.k('B_only');
    raise notice '% convert repair request: Beta''s job card untouched', pg_temp.verdict(v_b_before = v_b_after);
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL convert repair request: error % %', sqlstate, sqlerrm; end if;
  end;
end $c3$;

-- 4. get_site_operating_cost --------------------------------------------------------------
do $c4$
declare v_before jsonb; v_after jsonb;
begin
  begin
    perform pg_temp.as_user(pg_temp.k('A_admin'));
    v_before := public.get_site_operating_cost('KSA');
    -- Beta: a job card with Alpha's number (other asset), a fleet row with Alpha's asset code
    -- (other site), and an expense line on that number.
    perform pg_temp.as_user('');
    insert into public.work_orders (organisation_id, country, work_order_no, asset_no, site, work_type, status, opened_at)
    values (pg_temp.k('B')::uuid, 'KSA', pg_temp.k('X'), 'ZZBASSET', 'ZZ BETA SITE', 'Repair', 'Open', now());
    insert into public.vehicle_fleet (organisation_id, country, asset_no, site, status)
    values (pg_temp.k('B')::uuid, 'KSA', 'TM010', 'ZZ BETA SITE', 'Active');
    insert into public.parts_consumption (organisation_id, country, work_order_no, asset_code, txn_date, item_code,
                                          item_description, qty, value_amount, store_code)
    values (pg_temp.k('B')::uuid, 'KSA', pg_temp.k('X'), 'TM010', '2026-01-15', 'ZZ-0001', 'BETA BOLT', '1', '55555', 'ZZBSTORE');
    perform pg_temp.as_user(pg_temp.k('A_admin'));
    v_after := public.get_site_operating_cost('KSA');
    raise notice '% site operating cost: Alpha''s totals unchanged when Beta reuses the number and asset (before=% after=%)',
      pg_temp.verdict(v_before = v_after), md5(v_before::text), md5(v_after::text);
    raise notice '% site operating cost: no Beta site or asset in Alpha''s report',
      pg_temp.verdict(position('ZZ BETA SITE' in v_after::text) = 0 and position('ZZBASSET' in v_after::text) = 0);
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL site operating cost: error % %', sqlstate, sqlerrm; end if;
  end;
end $c4$;

-- 4b. get_site_operating_cost, fleet side: Alpha's job card names an asset that only Beta's
-- fleet register carries. Alpha's line must not take Beta's site.
do $c4b$
declare v_after jsonb;
begin
  begin
    perform pg_temp.as_user('');
    insert into public.work_orders (organisation_id, country, work_order_no, asset_no, site, work_type, status, opened_at)
    values (pg_temp.k('A')::uuid, 'KSA', 'ZZ/JC/FLEET/0001', 'ZZAONLY', 'ALPHA EAST PLANT', 'Repair', 'Open', now());
    insert into public.vehicle_fleet (organisation_id, country, asset_no, site, status)
    values (pg_temp.k('B')::uuid, 'KSA', 'ZZAONLY', 'ZZ BETA FLEET SITE', 'Active');
    insert into public.parts_consumption (organisation_id, country, work_order_no, asset_code, txn_date, item_code,
                                          item_description, qty, value_amount, store_code)
    values (pg_temp.k('A')::uuid, 'KSA', 'ZZ/JC/FLEET/0001', 'ZZAONLY', '2026-01-18', 'ZZ-0005', 'ALPHA WASHER', '1', '321', 'ZZASTORE');
    perform pg_temp.as_user(pg_temp.k('A_admin'));
    v_after := public.get_site_operating_cost('KSA');
    raise notice '% site operating cost: Alpha''s line does not take a site from Beta''s fleet register',
      pg_temp.verdict(position('ZZ BETA FLEET SITE' in v_after::text) = 0);
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL site operating cost fleet: error % %', sqlstate, sqlerrm; end if;
  end;
end $c4b$;

-- 5. get_asset_disposal_register ----------------------------------------------------------
do $c5$
declare v_before numeric; v_after numeric;
begin
  begin
    perform pg_temp.as_user(pg_temp.k('A_admin'));
    insert into public.asset_disposals (organisation_id, country, asset_no, disposition, status)
    values (pg_temp.k('A')::uuid, 'KSA', 'TM010', 'scrap', 'proposed');
    v_before := (public.get_asset_disposal_register('KSA')->'totals'->>'lifetime_spend')::numeric;
    -- Beta books an expense line on Alpha's job card number.
    perform pg_temp.as_user('');
    insert into public.parts_consumption (organisation_id, country, work_order_no, asset_code, txn_date, item_code,
                                          item_description, qty, value_amount, store_code)
    values (pg_temp.k('B')::uuid, 'KSA', pg_temp.k('X'), 'TM010', '2026-01-16', 'ZZ-0002', 'BETA NUT', '1', '77777', 'ZZBSTORE');
    perform pg_temp.as_user(pg_temp.k('A_admin'));
    v_after := (public.get_asset_disposal_register('KSA')->'totals'->>'lifetime_spend')::numeric;
    raise notice '% disposal register: Beta''s spend not in Alpha''s register (before=% after=%)',
      pg_temp.verdict(v_before is not distinct from v_after), v_before, v_after;
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL disposal register: error % %', sqlstate, sqlerrm; end if;
  end;
end $c5$;

-- 6. v_tyre_fitment_evidence.job_card_found -----------------------------------------------
-- Read as the database owner (no RLS), which is how a super admin / service caller sees it.
do $c6$
declare v_id uuid; v_found boolean; v_own boolean;
begin
  begin
    select id into v_id from public.tyre_records
     where organisation_id = pg_temp.k('A')::uuid and job_card is not null order by id limit 1;
    select job_card_found into v_own from public.v_tyre_fitment_evidence where id = v_id;
    -- Point Alpha's tyre at a job card number only Beta holds.
    update public.tyre_records set job_card = pg_temp.k('B_only') where id = v_id;
    select job_card_found into v_found from public.v_tyre_fitment_evidence where id = v_id;
    raise notice '% fitment evidence: Beta''s job card does not count as Alpha''s (job_card_found=%)',
      pg_temp.verdict(v_found is false), v_found;
    -- Control: Alpha's own job card number is still found.
    update public.tyre_records set job_card = pg_temp.k('X') where id = v_id;
    select job_card_found into v_found from public.v_tyre_fitment_evidence where id = v_id;
    raise notice '% fitment evidence: Alpha''s own job card still found (job_card_found=%)', pg_temp.verdict(v_found is true), v_found;
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL fitment evidence: error % %', sqlstate, sqlerrm; end if;
  end;
end $c6$;

-- 7. classify_parts_consumption tyre job card signal ----------------------------------------
do $c7$
declare v_b record; v_cat_a text; v_by_a text; v_cat_b text; v_by_b text;
begin
  begin
    -- A Beta tyre carries a job card number; Alpha books an unidentified tyre-size line on
    -- the same number. Only Beta's own line may take the tyre-job-card signal.
    select id, country into v_b from public.tyre_records
     where organisation_id = pg_temp.k('B')::uuid and country is not null order by id limit 1;
    update public.tyre_records set job_card = 'ZZ/JC/TYRE/0001' where id = v_b.id;
    perform pg_temp.as_user('');
    insert into public.parts_consumption (organisation_id, country, work_order_no, txn_date, item_code,
                                          item_description, qty, value_amount, store_code)
    values (pg_temp.k('A')::uuid, v_b.country, 'ZZ/JC/TYRE/0001', '2026-01-17', 'ZZ-0003', '315/80 R22.5 20PR', '1', '900', 'ZZASTORE')
    returning cost_category, classified_by into v_cat_a, v_by_a;
    insert into public.parts_consumption (organisation_id, country, work_order_no, txn_date, item_code,
                                          item_description, qty, value_amount, store_code)
    values (pg_temp.k('B')::uuid, v_b.country, 'ZZ/JC/TYRE/0001', '2026-01-17', 'ZZ-0003', '315/80 R22.5 20PR', '1', '900', 'ZZBSTORE')
    returning cost_category, classified_by into v_cat_b, v_by_b;
    raise notice '% classify: Beta''s tyre job card does not classify Alpha''s line (alpha=% by %)',
      pg_temp.verdict(v_cat_a is distinct from v_cat_b), v_cat_a, v_by_a;
    raise notice '% classify: Beta''s own line still takes the tyre job card signal (beta=% by %)',
      pg_temp.verdict(v_cat_b = 'tyre'), v_cat_b, v_by_b;
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL classify: error % %', sqlstate, sqlerrm; end if;
  end;
end $c7$;

-- 8. owner_data_audit orphan line items (super admin) ---------------------------------------
do $c8$
declare v_before int; v_after int;
begin
  begin
    perform pg_temp.as_user(pg_temp.k('super'));
    v_before := (public.owner_data_audit()->'work_orders'->>'line_items_orphan')::int;
    -- A Beta line item on a job card number only Alpha holds: Beta has no such card.
    perform pg_temp.as_user('');
    insert into public.work_order_line_items (organisation_id, country, work_order_no, asset_no, task)
    values (pg_temp.k('B')::uuid, 'KSA', pg_temp.k('X'), 'ZZBASSET', 'orphan test');
    perform pg_temp.as_user(pg_temp.k('super'));
    v_after := (public.owner_data_audit()->'work_orders'->>'line_items_orphan')::int;
    raise notice '% owner audit: Beta line item on Alpha''s number counted as orphan (before=% after=%)',
      pg_temp.verdict(v_after = v_before + 1), v_before, v_after;
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL owner audit: error % %', sqlstate, sqlerrm; end if;
  end;
end $c8$;

-- 9. tyre_cost_audit_classify (invoker; read as the database owner, i.e. a service caller) ------
do $c9$
declare v_a record; v_line uuid; v_row record;
begin
  begin
    select id, country into v_a from public.tyre_records
     where organisation_id = pg_temp.k('A')::uuid and country is not null order by id limit 1;
    update public.tyre_records set job_card = 'ZZ/JC/PRICE/0001', cost_per_tyre = null,
           issue_date = '2026-01-10' where id = v_a.id;
    perform pg_temp.as_user('');
    insert into public.parts_consumption (organisation_id, country, work_order_no, txn_date, item_code,
                                          item_description, qty, value_amount, store_code)
    values (pg_temp.k('B')::uuid, v_a.country, 'ZZ/JC/PRICE/0001', '2026-01-10', 'ZZ-0004', 'TYRE 315/80 R22.5', '1', '1234', 'ZZBSTORE')
    returning id into v_line;
    select * into v_row from public.tyre_cost_audit_classify(v_a.country, '2026-01-01', '2026-01-31') c where c.tyre_id = v_a.id;
    raise notice '% tyre cost audit: Beta''s line is not Alpha''s tyre price (class=% proposed=% source=%)',
      pg_temp.verdict(v_row.source_line_id is distinct from v_line::text and v_row.proposed_cost is distinct from 1234),
      v_row.class, v_row.proposed_cost, case when v_row.source_line_id = v_line::text then 'beta line' else coalesce(v_row.source_line_id, '-') end;
    raise exception 'case_done';
  exception when others then
    if sqlerrm <> 'case_done' then raise notice 'FAIL tyre cost audit: error % %', sqlstate, sqlerrm; end if;
  end;
end $c9$;

rollback;
