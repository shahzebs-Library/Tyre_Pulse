-- Assertions for 20261117112000_complaints_missing_in_date_reject.sql.
-- Runs inside one transaction that ends in ROLLBACK; prints PASS/FAIL lines.
-- A file with one good row, one blank Vehicle In Date and one unreadable one.
begin;
do $t$
declare
  n_wo int; n_rej_missing int; n_rej_bad int; v_msg text; v_org uuid;
begin
  begin
    insert into public.stg_complaints (country, veh_no, jc_no, complaints, job_done_description, vehicle_in_date, vehicle_out_date)
    values ('KSA', 'ZZT001', 'ZZTEST/JC/0001', 'Brake noise', 'Pads replaced', '01-02-2026', '03-02-2026'),
           ('KSA', 'ZZT002', 'ZZTEST/JC/0002', 'Tyre wear',   'Rotated',       '',           ''),
           ('KSA', 'ZZT003', 'ZZTEST/JC/0003', 'Oil leak',    'Seal',          'not a date', '');
  exception when others then
    raise notice 'FAIL batch aborted: sqlstate=% (%)', sqlstate, sqlerrm;
    return;
  end;
  select count(*) into n_wo from public.work_orders where work_order_no like 'ZZTEST/JC/%';
  select count(*) filter (where reject_reason = 'complaint_missing_vehicle_in_date' and work_order_no = 'ZZTEST/JC/0002'),
         count(*) filter (where reject_reason = 'complaint_unreadable_vehicle_in_date' and work_order_no = 'ZZTEST/JC/0003')
    into n_rej_missing, n_rej_bad
    from public.expense_import_rejects where work_order_no like 'ZZTEST/JC/%';
  raise notice '% valid row landed (work_orders=%)', case when n_wo = 1 then 'PASS' else 'FAIL' end, n_wo;
  raise notice '% blank date recorded as complaint_missing_vehicle_in_date', case when n_rej_missing = 1 then 'PASS' else 'FAIL' end;
  raise notice '% unreadable date recorded as complaint_unreadable_vehicle_in_date', case when n_rej_bad = 1 then 'PASS' else 'FAIL' end;
  select item_description, organisation_id into v_msg, v_org
    from public.expense_import_rejects where work_order_no = 'ZZTEST/JC/0003';
  raise notice '% reason names the value and the asset: %',
    case when v_msg like '%"not a date" could not be read, asset ZZT003%' then 'PASS' else 'FAIL' end, v_msg;
  raise notice '% reject carries the importing company', case when v_org is not null then 'PASS' else 'FAIL' end;
  select count(*) into n_wo from public.work_orders where work_order_no in ('ZZTEST/JC/0002','ZZTEST/JC/0003');
  raise notice '% no date invented for skipped rows (rows=%)', case when n_wo = 0 then 'PASS' else 'FAIL' end, n_wo;
  -- A re-upload of a card that already exists is still skipped as a duplicate
  -- (before the date check), not logged as a reject.
  insert into public.stg_complaints (country, veh_no, jc_no, complaints, job_done_description, vehicle_in_date)
  values ('KSA', 'ZZT001', 'ZZTEST/JC/0001', 'Brake noise', 'Pads replaced', '');
  select count(*) into n_rej_missing from public.expense_import_rejects where work_order_no = 'ZZTEST/JC/0001';
  raise notice '% existing card re-upload skipped silently (rejects=%)',
    case when n_rej_missing = 0 then 'PASS' else 'FAIL' end, n_rej_missing;
end $t$;
rollback;
