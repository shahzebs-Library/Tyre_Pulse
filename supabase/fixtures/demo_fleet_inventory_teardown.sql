-- =============================================================================
-- supabase/fixtures/demo_fleet_inventory_teardown.sql
-- Purpose : retire the inventory acceptance fixture in "Tyre Pulse Demo Fleet".
--
-- The stock ledger is APPEND-ONLY by design (stock_movements guard trigger), so
-- this script does not delete fixture stock, movements or audit history. It
-- closes everything that is still open, through the same RPCs the app uses:
--   1. every still-open fixture audit ('[demo-acceptance ...]') is cancelled; one that has
--      already posted an adjustment is closed instead (it cannot be cancelled); one that cannot
--      be closed yet (open discrepancy) is reported and left, without stopping the teardown;
--   2. every still-open fixture transfer returns its remaining quantity to source;
--   3. the fixture stock grants (note = demo_fleet_inventory_acceptance) are removed;
--   4. (the Demo "Store Keeper" custom role and its Demo module rows are kept; they
--      grant nothing without an approved account)
--   5. the three test sign-ins are set back to NOT approved (they can no longer
--      sign in) - their rows stay in the Demo company.
-- demo.manager stays as it was before the fixture (its fixture grants are removed).
-- Everything remains inside the Demo company; the same in-progress-row guard as
-- the fixture rolls the whole run back if a row outside it was written.
--
-- RESET for a fresh round: run this file, set c_run in BOTH
-- demo_fleet_inventory_acceptance.sql and demo_fleet_inventory_accounts.sql to the
-- next value (r1 -> r2), run the fixture, approve the sign-ins again by running the
-- accounts script. New audits/transfer/receipt are created under the new run tag;
-- locations and items are reused.
-- =============================================================================
do $td$
declare
  c_org   constant uuid := 'a50e2d87-39fb-4d1e-83dc-c2c3feb1eef7';
  c_mgr   constant uuid := 'c2f9a806-1d9c-4c3a-9a38-0bd7fefb087e';
  c_owner constant uuid := 'd2d43a5f-0906-4f7a-9577-e36d89164914';
  c_tag   constant text := 'demo_fleet_inventory_acceptance';
  v_a record; v_tr record; v_skipped text := ''; v_t text; v_col text; v_n int; v_bad text := '';
  v_epoch bigint := (txid_current() >> 32) * 4294967296;
  v_xid0  bigint := txid_current() % 4294967296;
begin
  if (select name from public.organisations where id = c_org) is distinct from 'Tyre Pulse Demo Fleet' then
    raise exception 'Demo company not found - refusing.';
  end if;
  -- demo.manager still holds its fixture grants here, so it can cancel and return
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', c_mgr, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  if public.app_current_org() is distinct from c_org then raise exception 'demo.manager session not in Demo - refusing.'; end if;

  -- Pre-posting audits are cancelled. An audit that already posted an adjustment cannot be
  -- cancelled (_inv_audit_cancel refuses), so it goes through the normal close instead; if the
  -- close is refused too (an open discrepancy), that one audit is left as it is and reported,
  -- and the rest of the teardown still runs.
  for v_a in select a.id, a.status,
                    (a.status in ('reconciliation','adjustment_posted','investigation','approval')
                     or exists (select 1 from public.inventory_adjustments j
                                 where j.audit_id = a.id and j.status = 'posted')) as close_path
               from public.inventory_audits a
              where a.organisation_id = c_org and a.instructions like '[demo-acceptance %'
                and a.status not in ('closed','cancelled','rejected') loop
    begin
      if v_a.close_path then
        perform public.inv_audit_close(jsonb_build_object('idempotency_key', 'demo-inv-acc:teardown:close:' || v_a.id,
          'audit_id', v_a.id, 'note', 'Acceptance fixture teardown'));
      else
        perform public.inv_audit_close(jsonb_build_object('idempotency_key', 'demo-inv-acc:teardown:aud:' || v_a.id,
          'audit_id', v_a.id, 'cancel', true, 'reason', 'Acceptance fixture teardown'));
      end if;
    exception when sqlstate '22023' then
      v_skipped := v_skipped || v_a.id::text || ' (' || v_a.status || ': ' || sqlerrm || ') ';
    end;
  end loop;

  for v_tr in select t.id, (select jsonb_agg(jsonb_build_object('line_id', l.id,
                       'qty', l.qty_dispatched - l.qty_received - l.qty_returned))
                    from public.stock_transfer_lines l
                   where l.transfer_id = t.id and l.qty_dispatched - l.qty_received - l.qty_returned > 0) lines
               from public.stock_transfers t
              where t.organisation_id = c_org and t.notes like '[demo-acceptance %'
                and t.status in ('dispatched','in_transit','partially_received') loop
    if v_tr.lines is null then continue; end if;
    perform public.inv_transfer_return_remaining(jsonb_build_object(
      'idempotency_key', 'demo-inv-acc:teardown:trf:' || v_tr.id, 'transfer_id', v_tr.id,
      'lines', v_tr.lines, 'reason', 'Acceptance fixture teardown'));
  end loop;
  perform set_config('request.jwt.claims', '', true);

  delete from public.user_access_grants where org_id = c_org and note = c_tag;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', c_owner, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  update public.profiles set approved = false
   where org_id = c_org and organisation_id = c_org and approved
     and username in ('demo.storekeeper.a','demo.storekeeper.b','demo.nostock');
  perform set_config('request.jwt.claims', '', true);

  for v_t, v_col in select * from (values
      ('stock_records','organisation_id'), ('stock_movements','organisation_id'), ('stock_transfers','organisation_id'),
      ('stock_transfer_lines','organisation_id'), ('inventory_audits','organisation_id'),
      ('inventory_rpc_requests','organisation_id'), ('profiles','organisation_id'), ('user_access_grants','org_id')) x(t, c) loop
    execute format('select count(*) from public.%I where %I is distinct from $1
                     and (case when xmin::text::bigint >= $3
                               then pg_xact_status(($2 + xmin::text::bigint)::text::xid8) end) = %L',
                   v_t, v_col, 'in progress')
       into v_n using c_org, v_epoch, v_xid0;
    if v_n > 0 then v_bad := v_bad || v_t || '=' || v_n || ' '; end if;
  end loop;
  if v_bad <> '' then raise exception 'Isolation guard: rows outside the Demo company (%). Rolled back.', v_bad; end if;
  if v_skipped <> '' then
    raise notice 'Audits left open (resolve their discrepancies on the web, then re-run): %', v_skipped;
  end if;
end
$td$;
