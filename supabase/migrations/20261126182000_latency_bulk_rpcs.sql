-- =============================================================================
-- 20261126182000_latency_bulk_rpcs.sql
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's yes.
--
-- WHY (docs/performance/REGION_LATENCY_AUDIT.md): users are in Saudi Arabia and
-- the database is in Tokyo, so every request costs ~400 ms of network while the
-- server answers in ~10 ms. Two client paths spend that cost per item:
--
--   1. Purchase order lines. The web adds each line with its own
--      inv_po_add_line call, one after the other: a 20-line PO is ~8 s of
--      network. inv_po_add_lines takes the same per-line payloads in ONE call.
--   2. Access on sign-in and on every tab refocus: get_user_module_permissions,
--      get_my_access_grants and get_my_capabilities are three separate requests.
--      get_my_access_bundle answers all three in one.
--
-- NOTHING CHANGES ABOUT WHAT IS ALLOWED OR WRITTEN:
--   * Both functions are SECURITY INVOKER on purpose. They add no privilege:
--     each one only calls the EXISTING client functions, which keep every check
--     they already make (approved/unlocked account, organisation, country,
--     site, PO status, role caps). An invoker wrapper cannot read or write
--     anything the caller could not already reach with the single calls.
--   * inv_po_add_lines hands each line's payload to inv_po_add_line VERBATIM, so
--     the idempotency_key and the stored payload hash (md5 of the payload) are
--     exactly what the one-call-per-line path produces. A retry through either
--     path replays the line instead of adding it twice, and a key reused with a
--     different payload is still refused (23505).
--   * Each line runs in its own subtransaction: a failing line is rolled back
--     alone and reported with its SQLSTATE and message, the lines before and
--     after it still save - the same outcome as one request per line. Lines run
--     in array order, so line numbers are assigned in the same order as before.
--   * get_my_access_bundle reports a failure of each part separately
--     ({data, error}), so the client keeps the fail-closed handling it already
--     has for each read.
--
-- CLIENT FALLBACK: src/lib/api/procurementChain.js and src/lib/api/accessBundle.js
-- call these functions first and fall back to the per-call path when they are
-- missing (42883 / PGRST202). So the web works the same before and after apply.
--
-- VERIFY (in a transaction that is ROLLED BACK, impersonating a real approved
-- buyer: set local role authenticated; set local request.jwt.claims = ...):
--   a) select public.get_my_access_bundle();
--      -> module_permissions.data / access_grants.data / capabilities.data equal
--         get_user_module_permissions() / get_my_access_grants() /
--         get_my_capabilities() for the same user; every .error is false.
--   b) On a Draft PO the user may edit:
--      select public.inv_po_add_lines(jsonb_build_object('po_id', '<po>', 'lines',
--        jsonb_build_array(
--          jsonb_build_object('po_id','<po>','idempotency_key','t1','item_id','<item>','qty_ordered',1),
--          jsonb_build_object('po_id','<po>','idempotency_key','t2','item_id','<bad item>','qty_ordered',1))));
--      -> results[0].ok = true (a purchase_order_lines row exists),
--         results[1].ok = false with the same message inv_po_add_line raises.
--      Call it again: results[0].result.replayed = true and no second line.
--   c) As anon: has_function_privilege('anon', 'public.inv_po_add_lines(jsonb)', 'execute')
--      and the same for get_my_access_bundle() are false.
--
-- ROLLBACK:
--   drop function if exists public.inv_po_add_lines(jsonb);
--   drop function if exists public.get_my_access_bundle();
--   (Clients fall back to the per-call path on their own.)
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.inv_po_add_line(jsonb)') is null then
    raise exception 'inv_po_add_line(jsonb) is missing; apply 20261120107000_inv_api_contract first.';
  end if;
  if to_regprocedure('public.get_my_access_grants()') is null
     or to_regprocedure('public.get_my_capabilities()') is null then
    raise exception 'get_my_access_grants() / get_my_capabilities() are missing.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Purchase order lines in one call
-- ---------------------------------------------------------------------------
create or replace function public.inv_po_add_lines(p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $fn$
declare
  v_po    text := nullif(btrim(coalesce(p_payload->>'po_id', '')), '');
  v_lines jsonb := p_payload->'lines';
  v_out   jsonb := '[]'::jsonb;
  v_res   jsonb;
  r       record;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'p_payload must be a JSON object.' using errcode = '22023';
  end if;
  if v_po is null then
    raise exception 'po_id is required in p_payload.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_lines) is distinct from 'array' then
    raise exception 'lines must be a JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_lines) > 200 then
    raise exception 'Send at most 200 lines per call.' using errcode = '22023';
  end if;

  for r in select e.value as line, e.n - 1 as idx
             from jsonb_array_elements(v_lines) with ordinality as e(value, n)
            order by e.n
  loop
    begin
      -- Every line must name the same PO as the call, so one request can never
      -- write to a PO the caller did not ask for.
      if jsonb_typeof(r.line) is distinct from 'object' or (r.line->>'po_id') is distinct from v_po then
        raise exception 'Each line must carry the same po_id as the call.' using errcode = '22023';
      end if;
      v_res := public.inv_po_add_line(r.line);
      v_out := v_out || jsonb_build_array(jsonb_build_object('index', r.idx, 'ok', true, 'result', v_res));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'index', r.idx, 'ok', false, 'code', sqlstate, 'message', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('results', v_out);
end $fn$;

revoke all on function public.inv_po_add_lines(jsonb) from public;
revoke all on function public.inv_po_add_lines(jsonb) from anon;
grant execute on function public.inv_po_add_lines(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The three access reads in one call
-- ---------------------------------------------------------------------------
create or replace function public.get_my_access_bundle() returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $fn$
declare
  v_perms jsonb; v_grants jsonb; v_caps jsonb;
  e_perms boolean := false; e_grants boolean := false; e_caps boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  begin v_perms := to_jsonb(public.get_user_module_permissions()); exception when others then e_perms := true; end;
  begin v_grants := to_jsonb(public.get_my_access_grants());       exception when others then e_grants := true; end;
  begin v_caps := to_jsonb(public.get_my_capabilities());          exception when others then e_caps := true; end;
  return jsonb_build_object(
    'module_permissions', jsonb_build_object('data', v_perms,  'error', e_perms),
    'access_grants',      jsonb_build_object('data', v_grants, 'error', e_grants),
    'capabilities',       jsonb_build_object('data', v_caps,   'error', e_caps));
end $fn$;

revoke all on function public.get_my_access_bundle() from public;
revoke all on function public.get_my_access_bundle() from anon;
grant execute on function public.get_my_access_bundle() to authenticated;

commit;
