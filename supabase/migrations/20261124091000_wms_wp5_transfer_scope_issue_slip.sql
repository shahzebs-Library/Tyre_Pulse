-- =============================================================================
-- 20261124091000_wms_wp5_transfer_scope_issue_slip.sql
--
-- STATUS: AUTHORED, NOT APPLIED. The owner has not approved it. Apply only on the
-- owner's yes, in one transaction, then run the VERIFY block. It was proven on the
-- live database (project jhssdmeruxtrlqnwfksc) inside transactions that were forced
-- to roll back on 2026-11-24; nothing persisted (checked afterwards).
--
-- WHAT IT DOES
--   A. Cross-site transfers. A site-scoped Store Keeper could not dispatch to
--      another site: the in-transit balance lives at the DESTINATION site and every
--      _inv_post leg re-checked the caller's site scope, so the transit leg failed
--      (measured: Demo Store Keeper B, sites DEMO YARD/DEMO PLANT, dispatch to
--      another site -> 42501 "This stock is outside your country or site scope").
--      Return-to-source had no source-scope check at all.
--        * _inv_post(p, p_check_cap, p_transit_leg) holds the ledger body (built from
--          the live body by anchored replacement, nothing retyped). p_transit_leg
--          skips the scope check ONLY when the balance or location is an IN-TRANSIT
--          location (code IN-TRANSIT, type in_transit) of the caller's organisation,
--          and ONLY for transfer_in / transfer_out / release.
--        * _inv_post(p, p_check_cap) becomes a wrapper passing false. Every existing
--          caller (about 20 functions) keeps the full scope check.
--        * dispatch: only the in-transit leg passes true. The source leg and the
--          "source location is outside your scope" check are unchanged.
--        * receive: unchanged (destination scope required, no exemption).
--        * return: NEW source-scope check ("The source site is outside your scope"),
--          in _inv_transfer_move and, before anything posts, in
--          _inv_transfer_return_remaining. Only the out-of-transit leg is exempt.
--   B. Material issue slips post stock. material_issue_lines.stock_id (chosen by the
--      user) and movement_id (written only by the server). inv_issue_slip(issue_id)
--      posts every unposted line of an ISSUED slip in one transaction: MIS through
--      _inv_issue, MRT as issue_return through _inv_post with the "issue" capability.
--      Idempotent (a posted line is skipped; the header row lock serialises two
--      posts). Refuses shortage (the whole slip rolls back, no negative stock),
--      a slip outside the caller's country/site scope, a line whose stock is at
--      another site / country than the slip, and a line whose code differs from its
--      stock line. When the slip names a job card, its movements use
--      source_doc_type 'job_card' (same as Stock > Issue), otherwise
--      'material_issue' / slip id. An MRT must name the job card.
--      Posted lines and slips are frozen by triggers (no edit, delete, cancel,
--      re-point). Write policies also admit app_user_can('stock','issue'), so Store
--      Keepers (issue, no edit) can raise slips; the RESTRICTIVE org / country / site
--      write policies are unchanged.
--   C. Defects from the live acceptance test (lead, 2026-11-24):
--      D3 inv_post_movement (and the legacy post_stock_movement) accepted a bare
--         'receipt' (+7, no GRN/PO/supplier). Now refused for everyone except
--         app_is_org_admin(); goods arrive through inv_receive_goods.
--      D3+ post_stock_movement checked NO capability at all: measured, a Reporter
--         (stock:issue = false) issued 1 and received +9 on a KSA balance. Now every
--         type needs its stock capability (_inv_cap_for), EXCEPT adjustment_up /
--         adjustment_down, which the Expo and Flutter count screens send today
--         (left open on purpose: owner decision, see OPEN below).
--      D4 issue_return / return were unbounded (+50 against 3 issued). Now a return
--         must name a source document and is bounded per stock line by what was
--         issued against that document minus what already came back (reversed
--         movements excluded). Valued at the issued cost when every matching issue
--         was fully valued, else UNVALUED. The client's unit_cost and the current
--         average are never used (owner rule: never replace a missing cost).
--      D6 a retry of a reservation-backed issue failed ("key already used for a
--         different posting") because the reservation consumption was re-derived.
--         _inv_issue now answers from the ledger first; a different stock or qty on
--         the same key is still refused.
--      D7 slip lines accepted any code and qty. A line must carry a material-master
--         code of the slip's organisation and country, or a stock line (its code is
--         stamped in); qty > 0.
--      Keys 'slip:' / 'iss:slip:' are reserved for the server (refused from
--      inv_issue / inv_post_movement), so a client cannot pre-empt a slip posting.
--
-- SECURITY REASONING (why the transit exemption cannot be reached by a client)
--   * No session flag (GUC) is used. The exemption is a function ARGUMENT of
--     _inv_post(jsonb,boolean,boolean), which is SECURITY DEFINER and not executable
--     by anon or authenticated (revoked from PUBLIC, anon, authenticated). Only the
--     three transfer functions pass true, and they choose the balance themselves
--     (server-derived transit location / transfer line), never from the payload.
--   * Proven (rolled back) as Demo Store Keeper B: set_config('inv.transfer_leg'|
--     'inv.posting'|'inv.owner_override','on') then inv_post_movement on the
--     out-of-scope transit balance -> 42501 scope; direct _inv_post(...,true) ->
--     42501 permission denied; direct _inv_transfer_move -> permission denied.
--   * movement_id on slip lines is excluded from the column grants of authenticated
--     (insert and update), so a client can never mark a line posted; a definer write
--     is also checked by a trigger against the exact movement it must be.
--
-- MEASURED (rolled-back runs, 2026-11-24)
--   Before: Store Keeper B dispatch to another site -> REFUSED 42501.
--   After:  dispatch posts both legs (source 17 -> 15, transit 2 at DEMO OTHER);
--           B cannot receive there (42501); a keeper scoped only to DEMO OTHER can
--           receive (1) but cannot return to source (42501) nor dispatch from
--           DEMO YARD (42501); B returns the rest (source 16, transit 0).
--   Slips: MIS 3 -> stock 10 -> 7; second post posts 0; shortage 50 refused, stock
--          unchanged; MIS 3 on job card + MRT 2 -> returned valued at the issued
--          cost (90.00 = 2 x 45); MRT 5 with 1 out refused; MRT without job card
--          refused. Owner super admin and Store Keeper MD JAHID post; Reporter
--          refused. Issue numbers are minted by a sequence, which does not roll back.
--   D3/D4/D6/D7 each refused or replayed as described above.
--
-- VERIFY (expect: t, t, f, f, t, f, f, 3)
--   select to_regprocedure('public._inv_post(jsonb,boolean,boolean)') is not null,
--          to_regprocedure('public.inv_issue_slip(jsonb)') is not null,
--          has_function_privilege('authenticated','public._inv_post(jsonb,boolean,boolean)','EXECUTE'),
--          has_function_privilege('anon','public.inv_issue_slip(jsonb)','EXECUTE'),
--          has_function_privilege('authenticated','public.inv_issue_slip(jsonb)','EXECUTE'),
--          has_column_privilege('authenticated','public.material_issue_lines','movement_id','INSERT'),
--          has_column_privilege('authenticated','public.material_issue_lines','movement_id','UPDATE'),
--          (select count(*) from pg_trigger where not tgisinternal and tgname in
--             ('trg_zzz_material_issue_lines_post_guard','trg_zzz_material_issues_post_guard',
--              'trg_zzy_material_issue_lines_validate'));
--   Then repeat the rolled-back impersonation script in
--   docs/warehouse/05_ISSUE_TRANSFER_DB_CHANGES.md (section "Proof": same users and cases).
--
-- UNDO (one transaction)
--   begin;
--   do $u$ declare r record; begin
--     for r in select def from _bak.wms_wp5_fn_backup_20261124 loop execute r.def; end loop;
--   end $u$;   -- restores _inv_post(jsonb,boolean) body, the transfer functions,
--              -- _inv_post_movement, post_stock_movement, _inv_issue, inv_issue
--   drop function if exists public.inv_issue_slip(jsonb);
--   drop function if exists public._inv_issue_slip(jsonb);
--   drop function if exists public._inv_post(jsonb, boolean, boolean);
--   drop trigger if exists trg_zzz_material_issue_lines_post_guard on public.material_issue_lines;
--   drop trigger if exists trg_zzz_material_issues_post_guard on public.material_issues;
--   drop trigger if exists trg_zzy_material_issue_lines_validate on public.material_issue_lines;
--   drop function if exists public.material_issue_line_post_guard();
--   drop function if exists public.material_issue_post_guard();
--   drop function if exists public.material_issue_line_validate();
--   grant insert, update on public.material_issue_lines to authenticated;
--   alter table public.material_issue_lines drop column if exists movement_id, drop column if exists stock_id;
--   alter policy material_issues_write on public.material_issues
--     using (app_is_elevated() or app_user_can('stock','edit')) with check (app_is_elevated() or app_user_can('stock','edit'));
--   alter policy material_issue_lines_write on public.material_issue_lines
--     using (app_is_elevated() or app_user_can('stock','edit')) with check (app_is_elevated() or app_user_can('stock','edit'));
--   -- restore the backed-up function grants: revoke all ... from public, anon, authenticated on the
--   -- internal ones; grant execute on public.inv_issue(jsonb) to authenticated.
--   commit;
--   (Dropping movement_id loses the slip-to-movement link; the movements themselves stay.)
--
-- OPEN (owner decisions, not done here)
--   * post_stock_movement adjustment_up / adjustment_down still need no capability
--     (the phone count screens use them). Any approved user in scope can adjust.
--   * save_stock_entry 'receipt' mode (Stock quick entry, "New delivery") is still a
--     receipt without a GRN; it requires stock edit/create and a reference.
--   * MRT bound is per stock line and job card: material returned to a different
--     balance (other condition or location) than it was issued from is refused.
-- =============================================================================
begin;

-- =====================================================================
-- 0. Save every function this migration rewrites (the undo source).
-- =====================================================================
create schema if not exists _bak;
revoke all on schema _bak from public, anon, authenticated;
create table if not exists _bak.wms_wp5_fn_backup_20261124 (
  fn text primary key, def text not null, saved_at timestamptz not null default now());
insert into _bak.wms_wp5_fn_backup_20261124(fn, def)
select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.oid in ('public._inv_post(jsonb,boolean)'::regprocedure,
                 'public._inv_transfer_dispatch(jsonb)'::regprocedure,
                 'public._inv_transfer_move(jsonb,text)'::regprocedure,
                 'public._inv_transfer_return_remaining(jsonb)'::regprocedure,
                 'public._inv_post_movement(jsonb)'::regprocedure,
                 'public.post_stock_movement(uuid,text,numeric,text,text)'::regprocedure,
                 'public._inv_issue(jsonb)'::regprocedure,
                 'public.inv_issue(jsonb)'::regprocedure)
on conflict (fn) do nothing;

-- =====================================================================
-- A1. _inv_post(p, p_check_cap, p_transit_leg): the ledger body with ONE
--     extra, internal-only argument. Built from the LIVE body by anchored
--     replacement (nothing retyped). Every replace aborts unless its anchor
--     occurs exactly once.
-- =====================================================================
do $mig$
declare v_def text; v_old text; v_new text; v_n int;
  v_transit_rec constant text := 'p_transit_leg and exists (select 1 from public.inventory_locations tl'
    || ' where tl.id = v_rec.location_id and tl.organisation_id = v_org'
    || ' and tl.code = ''IN-TRANSIT'' and tl.location_type = ''in_transit'')';
  v_transit_loc constant text := 'p_transit_leg and exists (select 1 from public.inventory_locations tl'
    || ' where tl.id = v_loc_id2 and tl.organisation_id = v_org'
    || ' and tl.code = ''IN-TRANSIT'' and tl.location_type = ''in_transit'')';
begin
  if to_regprocedure('public._inv_post(jsonb,boolean,boolean)') is not null then
    raise exception 'WP5 already applied: _inv_post(jsonb,boolean,boolean) exists.';
  end if;
  v_def := pg_get_functiondef('public._inv_post(jsonb,boolean)'::regprocedure);

  v_old := 'FUNCTION public._inv_post(p jsonb, p_check_cap boolean)';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_post header anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old, 'FUNCTION public._inv_post(p jsonb, p_check_cap boolean, p_transit_leg boolean)');

  -- a transit leg may only move units in or out of transit, or release a reservation there
  v_old := '  if v_key is null or length(v_key) > 200 then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_post key anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
       '  if coalesce(p_transit_leg, false) and v_type not in (''transfer_in'', ''transfer_out'', ''release'') then' || chr(10)
    || '    raise exception ''A transit leg may only move stock into or out of transit.'' using errcode = ''22023'';' || chr(10)
    || '  end if;' || chr(10) || v_old);

  v_old := 'if not public._inv_scope_ok(v_rec.country, v_rec.site) then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_post balance scope anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
    'if not public._inv_scope_ok(v_rec.country, v_rec.site) and not (' || v_transit_rec || ') then');

  v_old := 'elsif v_loc_id2 is not null and not public._inv_scope_ok(v_loc_country, v_loc_site) then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_post location scope anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
    'elsif v_loc_id2 is not null and not public._inv_scope_ok(v_loc_country, v_loc_site) and not (' || v_transit_loc || ') then');

  -- D4: returns are bounded by what was issued from this stock line against the same
  -- source document, and come back at the cost they were issued at, never at a guess.
  v_old := '  v_tracked boolean := false;';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_post declare anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
    '  v_ret_issued numeric; v_ret_returned numeric; v_ret_value numeric; v_ret_valued boolean;' || chr(10) || v_old);

  v_old := '  -- Currency: never converted inside inventory (refuse, balance unchanged).';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_post currency anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
       '  if v_type in (''issue_return'', ''return'') then' || chr(10)
    || '    if v_rec.id is null then' || chr(10)
    || '      raise exception ''A return must name the stock line the material was issued from.'' using errcode = ''22023'';' || chr(10)
    || '    end if;' || chr(10)
    || '    if nullif(p->>''source_doc_type'', '''') is null or nullif(p->>''source_doc_id'', '''') is null then' || chr(10)
    || '      raise exception ''A return must name the job card or document the material was issued against.'' using errcode = ''22023'';' || chr(10)
    || '    end if;' || chr(10)
    || '    select coalesce(sum(case when m.movement_type = ''issue'' then -m.qty_change else 0 end), 0),' || chr(10)
    || '           coalesce(sum(case when m.movement_type in (''issue_return'', ''return'') then m.qty_change else 0 end), 0),' || chr(10)
    || '           coalesce(sum(case when m.movement_type = ''issue'' then -m.value_change end), 0),' || chr(10)
    || '           bool_and(m.movement_type <> ''issue'' or (m.value_change is not null and m.unvalued_qty_change = 0' || chr(10)
    || '                    and m.pending_out_change = 0 and m.pending_in_change = 0))' || chr(10)
    || '      into v_ret_issued, v_ret_returned, v_ret_value, v_ret_valued' || chr(10)
    || '      from public.stock_movements m' || chr(10)
    || '     where m.organisation_id = v_org and m.stock_id = v_rec.id' || chr(10)
    || '       and m.movement_type in (''issue'', ''issue_return'', ''return'')' || chr(10)
    || '       and m.source_doc_type = nullif(p->>''source_doc_type'', '''') and m.source_doc_id = nullif(p->>''source_doc_id'', '''')' || chr(10)
    || '       and not exists (select 1 from public.stock_movements x where x.reverses_movement_id = m.id);' || chr(10)
    || '    if v_chg > v_ret_issued - v_ret_returned then' || chr(10)
    || '      raise exception ''Only % unit(s) issued from this stock line against % are still out; a return cannot exceed that.'',' || chr(10)
    || '        greatest(v_ret_issued - v_ret_returned, 0), p->>''source_doc_id'' using errcode = ''23514'';' || chr(10)
    || '    end if;' || chr(10)
    || '    -- the client never prices a return: issued cost when every matching issue was fully valued, else unvalued' || chr(10)
    || '    v_unit := case when v_ret_issued > 0 and coalesce(v_ret_valued, false) and v_ret_value >= 0' || chr(10)
    || '                   then round(v_ret_value / v_ret_issued, 4) end;' || chr(10)
    || '  end if;' || chr(10) || v_old);

  v_old := 'if v_unit is null and v_type in (''issue_return'', ''return'', ''adjustment_up'', ''stocktake'', ''adjustment'') then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_post average-fallback anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old, 'if v_unit is null and v_type in (''adjustment_up'', ''stocktake'', ''adjustment'') then');

  execute v_def;
end $mig$;

-- Internal only. Supabase grants EXECUTE to anon/authenticated at CREATE time,
-- and a revoke from PUBLIC alone does not clear those explicit grants.
revoke all on function public._inv_post(jsonb, boolean, boolean) from public;
revoke all on function public._inv_post(jsonb, boolean, boolean) from anon, authenticated;

-- The two-argument form keeps every existing caller (about 20 functions) on the
-- normal scope check: it can never request the transit exemption.
create or replace function public._inv_post(p jsonb, p_check_cap boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  -- 20261124091000: thin wrapper. The ledger body lives in the 3-argument form
  -- (SQL mirror of src/lib/inventory/valuation.js; change both together).
  return public._inv_post(p, p_check_cap, false);
end $fn$;
revoke all on function public._inv_post(jsonb, boolean) from public;
revoke all on function public._inv_post(jsonb, boolean) from anon, authenticated;

-- =====================================================================
-- A2. Dispatch: only the in-transit leg (destination site) is exempt. The
--     source leg and the caller's source scope check are unchanged.
-- =====================================================================
do $mig$
declare v_def text; v_old text; v_n int;
begin
  v_def := pg_get_functiondef('public._inv_transfer_dispatch(jsonb)'::regprocedure);
  v_old := '''reason'', ''In transit '' || v_t.ref, ''source_doc_type'', ''stock_transfer'', ''source_doc_id'', v_t.id::text), false);';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'dispatch transit-leg anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
    '''reason'', ''In transit '' || v_t.ref, ''source_doc_type'', ''stock_transfer'', ''source_doc_id'', v_t.id::text), false, true);');
  execute v_def;
end $mig$;

-- =====================================================================
-- A3. Receive / return: receive keeps its destination check; return now
--     requires the SOURCE site; only the return's out-of-transit leg is exempt.
-- =====================================================================
do $mig$
declare v_def text; v_old text; v_n int; v_pos int; v_tail text; v_end int;
begin
  v_def := pg_get_functiondef('public._inv_transfer_move(jsonb,text)'::regprocedure);

  v_old := '  if p_mode = ''receive'' and not public._inv_scope_ok(v_t.country, v_t.to_site) then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'move scope anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
       '  if p_mode not in (''receive'', ''return'') then' || chr(10)
    || '    raise exception ''Unknown transfer move.'' using errcode = ''22023'';' || chr(10)
    || '  end if;' || chr(10)
    || '  if p_mode = ''return'' and not public._inv_scope_ok(v_t.country, v_t.site) then' || chr(10)
    || '    raise exception ''The source site is outside your scope.'' using errcode = ''42501'';' || chr(10)
    || '  end if;' || chr(10) || v_old);

  -- the out-of-transit leg: first "), false);" after the ':out' key
  v_old := 'v_out := public._inv_post(jsonb_build_object(''idempotency_key'', ''trf:'' || v_key || '':'' || ln.id || '':out''';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'move out-leg anchor found % times', v_n; end if;
  v_pos := strpos(v_def, v_old);
  v_tail := substr(v_def, v_pos);
  v_end := strpos(v_tail, '), false);');
  if v_end = 0 then raise exception 'move out-leg terminator not found'; end if;
  v_def := substr(v_def, 1, v_pos - 1)
        || substr(v_tail, 1, v_end - 1) || '), false, p_mode = ''return'');'
        || substr(v_tail, v_end + length('), false);'));
  execute v_def;
end $mig$;

-- =====================================================================
-- A4. Return remaining: source scope checked BEFORE anything posts, and the
--     reservation release on the in-transit balance is a transit leg.
-- =====================================================================
do $mig$
declare v_def text; v_old text; v_n int;
begin
  v_def := pg_get_functiondef('public._inv_transfer_return_remaining(jsonb)'::regprocedure);
  v_old := '  if p->''lines'' is null or jsonb_typeof(p->''lines'') = ''null''';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'return-remaining lines anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
       '  if not public._inv_scope_ok(v_t.country, v_t.site) then' || chr(10)
    || '    raise exception ''The source site is outside your scope.'' using errcode = ''42501'';' || chr(10)
    || '  end if;' || chr(10) || v_old);
  v_old := '''reason'', ''return '' || v_t.ref, ''source_doc_type'', ''stock_reservation'', ''source_doc_id'', v_res.id::text), false);';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'return-remaining release anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
    '''reason'', ''return '' || v_t.ref, ''source_doc_type'', ''stock_reservation'', ''source_doc_id'', v_res.id::text), false, true);');
  execute v_def;
end $mig$;

-- CREATE OR REPLACE keeps grants; re-assert the internal ones stay closed.
revoke all on function public._inv_transfer_dispatch(jsonb) from public, anon, authenticated;
revoke all on function public._inv_transfer_move(jsonb, text) from public, anon, authenticated;
revoke all on function public._inv_transfer_return_remaining(jsonb) from public, anon, authenticated;

-- =====================================================================
-- B1. Slip lines carry the balance they come from and their posting.
-- =====================================================================
alter table public.material_issue_lines
  add column if not exists stock_id uuid references public.stock_records(id),
  add column if not exists movement_id uuid references public.stock_movements(id);
create index if not exists material_issue_lines_stock_idx
  on public.material_issue_lines(stock_id) where stock_id is not null;
create unique index if not exists material_issue_lines_movement_uidx
  on public.material_issue_lines(movement_id) where movement_id is not null;

-- movement_id is written only by the posting function (definer, owner rights).
-- A client may choose stock_id; it can never claim a line is posted.
revoke insert, update on public.material_issue_lines from anon, authenticated;
grant insert (id, issue_id, line_no, doc_type, item_code, item_description, qty, uom, unit_cost,
              category, custom_data, created_at, stock_id)
  on public.material_issue_lines to authenticated;
grant update (line_no, doc_type, item_code, item_description, qty, uom, unit_cost, category,
              custom_data, stock_id)
  on public.material_issue_lines to authenticated;

-- =====================================================================
-- B2. A posted line / slip is frozen (stock already moved).
-- =====================================================================
create or replace function public.material_issue_line_post_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_h public.material_issues%rowtype; v_m public.stock_movements%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.movement_id is not null then
      raise exception 'A posted slip line cannot be deleted; raise a return (MRT) instead.' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.movement_id is not null then
      raise exception 'A slip line is posted only by inv_issue_slip.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.movement_id is not null then
    if new.movement_id is distinct from old.movement_id or new.stock_id is distinct from old.stock_id
       or new.qty is distinct from old.qty or new.issue_id is distinct from old.issue_id
       or new.doc_type is distinct from old.doc_type or new.item_code is distinct from old.item_code then
      raise exception 'This slip line is posted to stock and can no longer change.' using errcode = '42501';
    end if;
  elsif new.movement_id is not null then
    -- Defence in depth: even an owner-rights writer may only link the movement
    -- that the posting function created for exactly this line.
    select * into v_h from public.material_issues where id = new.issue_id;
    select * into v_m from public.stock_movements where id = new.movement_id;
    if v_m.id is null or v_m.organisation_id is distinct from v_h.organisation_id
       or v_m.stock_id is distinct from new.stock_id
       or v_m.source_doc_type is distinct from
          (case when nullif(btrim(v_h.work_order_no), '') is not null then 'job_card' else 'material_issue' end)
       or v_m.source_doc_id is distinct from coalesce(nullif(btrim(v_h.work_order_no), ''), new.issue_id::text)
       or v_m.idempotency_key not in ('iss:slip:' || new.id, 'slip:' || new.id)
       or (v_h.doc_type = 'MIS' and (v_m.movement_type <> 'issue' or v_m.qty_change <> -new.qty))
       or (v_h.doc_type = 'MRT' and (v_m.movement_type <> 'issue_return' or v_m.qty_change <> new.qty)) then
      raise exception 'The stock movement does not match this slip line.' using errcode = '22023';
    end if;
  end if;
  return new;
end $fn$;
revoke all on function public.material_issue_line_post_guard() from public, anon, authenticated;
create or replace trigger trg_zzz_material_issue_lines_post_guard
  before insert or update or delete on public.material_issue_lines
  for each row execute function public.material_issue_line_post_guard();

create or replace function public.material_issue_post_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not exists (select 1 from public.material_issue_lines l where l.issue_id = old.id and l.movement_id is not null) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'This slip is posted to stock and cannot be deleted.' using errcode = '42501';
  end if;
  if new.doc_type is distinct from old.doc_type or new.status is distinct from old.status
     or new.organisation_id is distinct from old.organisation_id or new.country is distinct from old.country
     or new.site is distinct from old.site or new.issue_number is distinct from old.issue_number
     or new.work_order_no is distinct from old.work_order_no then
    raise exception 'This slip is posted to stock; its type, status, site, job card and number can no longer change.'
      using errcode = '42501';
  end if;
  return new;
end $fn$;
revoke all on function public.material_issue_post_guard() from public, anon, authenticated;
create or replace trigger trg_zzz_material_issues_post_guard
  before update or delete on public.material_issues
  for each row execute function public.material_issue_post_guard();

-- =====================================================================
-- B3. inv_issue_slip: post every unposted line of one slip, atomically.
-- =====================================================================
create or replace function public._inv_issue_slip(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.app_current_org(); v_id uuid;
  v_h public.material_issues%rowtype; ln public.material_issue_lines%rowtype;
  v_rec public.stock_records%rowtype; v_code text; v_post jsonb; v_reason text; v_lno text;
  v_posted int := 0; v_already int := 0; v_lines jsonb := '[]'::jsonb;
  v_src_type text; v_src_id text;
begin
  if v_uid is null or v_org is null or not public.is_approved_and_unlocked() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'p_payload must be a JSON object.' using errcode = '22023';
  end if;
  begin
    v_id := nullif(btrim(p_payload->>'issue_id'), '')::uuid;
  exception when others then
    raise exception 'issue_id must be a slip id.' using errcode = '22023';
  end;
  if v_id is null then raise exception 'issue_id is required.' using errcode = '22023'; end if;

  -- The header lock serialises two posts of the same slip: the second one waits,
  -- then finds every line already carrying its movement and posts nothing.
  select * into v_h from public.material_issues where id = v_id and organisation_id = v_org for update;
  if not found then raise exception 'Slip not found.' using errcode = 'P0002'; end if;
  if not public._inv_scope_ok(v_h.country, v_h.site) then
    raise exception 'This slip belongs to a site outside your scope.' using errcode = '42501';
  end if;
  if v_h.status <> 'issued' then
    raise exception 'Only an issued slip posts stock (this one is %).', v_h.status using errcode = '22023';
  end if;
  if not exists (select 1 from public.material_issue_lines where issue_id = v_h.id) then
    raise exception 'This slip has no lines.' using errcode = '22023';
  end if;
  -- The job card is the source document when the slip names one, so a slip issue and a
  -- Stock > Issue against the same job card share one history (and one return bound).
  v_src_type := case when nullif(btrim(v_h.work_order_no), '') is not null then 'job_card' else 'material_issue' end;
  v_src_id := coalesce(nullif(btrim(v_h.work_order_no), ''), v_h.id::text);
  if v_h.doc_type = 'MRT' and v_src_type <> 'job_card' then
    raise exception 'A return slip (MRT) must name the job card the material comes back from.' using errcode = '22023';
  end if;
  v_reason := left(coalesce(nullif(btrim(v_h.notes), ''), nullif(btrim(v_h.work_order_no), ''), v_h.issue_number), 500);
  for ln in select * from public.material_issue_lines where issue_id = v_h.id
            order by line_no nulls last, id for update loop
    v_lno := coalesce(ln.line_no::text, '?');
    if ln.movement_id is not null then
      v_already := v_already + 1;
      v_lines := v_lines || jsonb_build_object('line_id', ln.id, 'line_no', ln.line_no,
        'movement_id', ln.movement_id, 'already_posted', true);
      continue;
    end if;
    if ln.stock_id is null then
      raise exception 'Line %: choose the stock balance it comes from.', v_lno using errcode = '22023';
    end if;
    select * into v_rec from public.stock_records where id = ln.stock_id;
    if v_rec.id is null or v_rec.organisation_id is distinct from v_org then
      raise exception 'Line %: stock balance not found.', v_lno using errcode = '42501';
    end if;
    if v_h.country is not null and v_rec.country is not null
       and lower(btrim(v_h.country)) <> lower(btrim(v_rec.country)) then
      raise exception 'Line %: the stock is in another country than the slip.', v_lno using errcode = '22023';
    end if;
    if nullif(btrim(v_h.site), '') is not null
       and upper(btrim(coalesce(v_rec.site, ''))) <> upper(btrim(v_h.site)) then
      raise exception 'Line %: the stock is at another site than the slip.', v_lno using errcode = '22023';
    end if;
    if nullif(btrim(ln.item_code), '') is not null and v_rec.item_id is not null then
      select item_code into v_code from public.material_master where id = v_rec.item_id;
      if v_code is not null and upper(btrim(v_code)) <> upper(btrim(ln.item_code)) then
        raise exception 'Line %: that balance holds item %, the line says %.', v_lno, v_code, ln.item_code
          using errcode = '22023';
      end if;
    end if;

    if v_h.doc_type = 'MIS' then
      -- _inv_issue re-checks "issue", and _inv_post re-checks site scope on the balance.
      v_post := public._inv_issue(jsonb_build_object('idempotency_key', 'slip:' || ln.id,
        'stock_id', ln.stock_id, 'qty', ln.qty, 'reference_no', v_h.issue_number,
        'source_doc_type', v_src_type, 'source_doc_id', v_src_id, 'reason', v_reason));
    else
      -- bounded inside _inv_post by what this job card took from this stock line
      v_post := public._inv_post(jsonb_build_object('idempotency_key', 'slip:' || ln.id,
        'stock_id', ln.stock_id, 'movement_type', 'issue_return', 'qty_change', ln.qty,
        'reference_no', v_h.issue_number, 'source_doc_type', v_src_type,
        'source_doc_id', v_src_id, 'reason', v_reason), true);
    end if;
    if v_post->>'status' = 'refused_shortage' then
      -- No negative stock: the whole slip rolls back, nothing posts.
      raise exception 'Line %: not enough stock (% available, % asked).', v_lno,
        coalesce(v_post->>'qty_available', '0'), ln.qty using errcode = '23514';
    end if;
    if nullif(v_post->>'movement_id', '') is null then
      raise exception 'Line %: the stock posting returned no movement.', v_lno using errcode = 'P0001';
    end if;
    update public.material_issue_lines set movement_id = (v_post->>'movement_id')::uuid where id = ln.id;
    v_posted := v_posted + 1;
    v_lines := v_lines || jsonb_build_object('line_id', ln.id, 'line_no', ln.line_no,
      'movement_id', v_post->>'movement_id', 'qty_on_hand', v_post->'qty_on_hand', 'already_posted', false);
  end loop;

  return jsonb_build_object('issue_id', v_h.id, 'issue_number', v_h.issue_number, 'doc_type', v_h.doc_type,
    'posted_lines', v_posted, 'already_posted', v_already, 'lines', v_lines);
end $fn$;
revoke all on function public._inv_issue_slip(jsonb) from public;
revoke all on function public._inv_issue_slip(jsonb) from anon, authenticated;

create or replace function public.inv_issue_slip(p_payload jsonb)
returns jsonb language sql security definer set search_path = public, pg_temp as $fn$
  select public._inv_issue_slip(p_payload)
$fn$;
revoke all on function public.inv_issue_slip(jsonb) from public;
revoke all on function public.inv_issue_slip(jsonb) from anon;
grant execute on function public.inv_issue_slip(jsonb) to authenticated, service_role;

-- =====================================================================
-- B4. The people who issue stock may raise the slip. The RESTRICTIVE org,
--     country and site write policies are unchanged and still bound them.
-- =====================================================================
alter policy material_issues_write on public.material_issues
  using (app_is_elevated() or app_user_can('stock','edit') or app_user_can('stock','issue'))
  with check (app_is_elevated() or app_user_can('stock','edit') or app_user_can('stock','issue'));
alter policy material_issue_lines_write on public.material_issue_lines
  using (app_is_elevated() or app_user_can('stock','edit') or app_user_can('stock','issue'))
  with check (app_is_elevated() or app_user_can('stock','edit') or app_user_can('stock','issue'));

-- =====================================================================
-- C1 (D3 + key namespace). inv_post_movement: no bare receipts for
--     non-admins (goods arrive through inv_receive_goods), and the key
--     prefixes the server uses for slips cannot be chosen by a client.
-- =====================================================================
do $mig$
declare v_def text; v_old text; v_n int;
begin
  v_def := pg_get_functiondef('public._inv_post_movement(jsonb)'::regprocedure);
  v_old := '  if lower(btrim(coalesce(p->>''movement_type'', ''''))) in (''reversal'', ''opening'') then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_post_movement anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
       '  if lower(btrim(coalesce(p->>''movement_type'', ''''))) in (''receipt'', ''consignment_receipt'')' || chr(10)
    || '     and not public.app_is_org_admin() then' || chr(10)
    || '    raise exception ''Goods are received through a goods receipt (inv_receive_goods), not as a bare movement.'' using errcode = ''42501'';' || chr(10)
    || '  end if;' || chr(10)
    || '  if lower(btrim(coalesce(p->>''idempotency_key'', ''''))) ~ ''^(iss:)?slip:'' then' || chr(10)
    || '    raise exception ''That idempotency_key prefix is reserved.'' using errcode = ''22023'';' || chr(10)
    || '  end if;' || chr(10) || v_old);
  execute v_def;
end $mig$;
revoke all on function public._inv_post_movement(jsonb) from public, anon, authenticated;

-- C2. post_stock_movement (legacy, callable by every approved user): it posted
--     receipt / issue / scrap / returns with NO capability check. Now: receipts
--     admin-only (as C1), every other type needs its stock capability, except the
--     two count adjustments the phone apps use today (kept; owner decision, see header).
do $mig$
declare v_def text; v_old text; v_n int;
begin
  v_def := pg_get_functiondef('public.post_stock_movement(uuid,text,numeric,text,text)'::regprocedure);
  v_old := '  if p_qty is null or p_qty <= 0 then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'post_stock_movement anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
       '  if v_type = ''receipt'' and not public.app_is_org_admin() then' || chr(10)
    || '    raise exception ''Goods are received through a goods receipt (inv_receive_goods), not as a bare movement.'' using errcode = ''42501'';' || chr(10)
    || '  end if;' || chr(10)
    || '  if v_type not in (''adjustment_up'', ''adjustment_down'') and not public.inv_can(public._inv_cap_for(v_type)) then' || chr(10)
    || '    raise exception ''Stock permission "%" is required.'', public._inv_cap_for(v_type) using errcode = ''42501'';' || chr(10)
    || '  end if;' || chr(10) || v_old);
  execute v_def;
end $mig$;

-- =====================================================================
-- C3 (D6). _inv_issue answers a retry from the ledger BEFORE re-deriving the
--     reservation, so a network retry returns the original posting instead of
--     "already used for a different posting".
-- =====================================================================
do $mig$
declare v_def text; v_old text; v_n int;
begin
  v_def := pg_get_functiondef('public._inv_issue(jsonb)'::regprocedure);
  v_old := 'v_consume numeric := 0; v_post jsonb; v_ag record;';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_issue declare anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old, v_old || ' v_prev public.stock_movements%rowtype; v_prev_x public.stock_exceptions%rowtype;');
  v_old := '  if nullif(p->>''reservation_id'', '''') is not null then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception '_inv_issue reservation anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
       '  -- same lock _inv_post takes for this key (re-entrant inside one transaction)' || chr(10)
    || '  perform pg_advisory_xact_lock(hashtextextended(v_org::text || '':inv:'' || ''iss:'' || v_key, 0));' || chr(10)
    || '  select * into v_prev from public.stock_movements where organisation_id = v_org and idempotency_key = ''iss:'' || v_key;' || chr(10)
    || '  if found then' || chr(10)
    || '    if v_prev.stock_id is distinct from nullif(p->>''stock_id'', '''')::uuid or v_prev.qty_change <> -v_qty then' || chr(10)
    || '      raise exception ''This idempotency_key was already used for a different posting.'' using errcode = ''23505'';' || chr(10)
    || '    end if;' || chr(10)
    || '    return public._inv_movement_json(v_prev) || jsonb_build_object(''replayed'', true);' || chr(10)
    || '  end if;' || chr(10)
    || '  select * into v_prev_x from public.stock_exceptions where organisation_id = v_org and idempotency_key = ''iss:'' || v_key;' || chr(10)
    || '  if found then' || chr(10)
    || '    return jsonb_build_object(''status'',''refused_shortage'',''exception_id'',v_prev_x.id,''stock_id'',v_prev_x.stock_id,' || chr(10)
    || '      ''qty_available'',v_prev_x.qty_available,''qty_requested'',v_prev_x.qty_requested,''replayed'',true);' || chr(10)
    || '  end if;' || chr(10) || v_old);
  execute v_def;
end $mig$;
revoke all on function public._inv_issue(jsonb) from public, anon, authenticated;

create or replace function public.inv_issue(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if lower(btrim(coalesce(p_payload->>'idempotency_key', ''))) ~ '^slip:' then
    raise exception 'That idempotency_key prefix is reserved.' using errcode = '22023';
  end if;
  return public._inv_issue(p_payload);
end $fn$;
revoke all on function public.inv_issue(jsonb) from public;
revoke all on function public.inv_issue(jsonb) from anon;
grant execute on function public.inv_issue(jsonb) to authenticated, service_role;

-- =====================================================================
-- C4 (D7). A slip line names a real item: a material-master code of the
--     slip's company and country, or a stock line (its item is stamped in).
-- =====================================================================
create or replace function public.material_issue_line_validate()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_h public.material_issues%rowtype; v_rec public.stock_records%rowtype; v_code text;
begin
  select * into v_h from public.material_issues where id = new.issue_id;
  if v_h.id is null then raise exception 'Slip not found.' using errcode = '23503'; end if;
  if new.qty is null or new.qty <= 0 then
    raise exception 'Quantity must be above zero.' using errcode = '22023';
  end if;
  new.item_code := nullif(btrim(new.item_code), '');
  if new.stock_id is not null then
    select * into v_rec from public.stock_records where id = new.stock_id;
    if v_rec.id is null or v_rec.organisation_id is distinct from v_h.organisation_id then
      raise exception 'Stock balance not found.' using errcode = '22023';
    end if;
    if v_rec.item_id is not null then
      select item_code into v_code from public.material_master where id = v_rec.item_id;
      if new.item_code is null then
        new.item_code := v_code;
      elsif v_code is not null and upper(new.item_code) <> upper(btrim(v_code)) then
        raise exception 'That stock line holds item %, the line says %.', v_code, new.item_code using errcode = '22023';
      end if;
    end if;
  end if;
  if new.item_code is null then
    if new.stock_id is null then
      raise exception 'Choose an item from the material master, or the stock line it comes from.' using errcode = '22023';
    end if;
  elsif not exists (select 1 from public.material_master mm
                     where mm.organisation_id = v_h.organisation_id
                       and mm.item_code in (new.item_code, upper(new.item_code))
                       and (v_h.country is null or mm.country is null
                            or lower(btrim(mm.country)) = lower(btrim(v_h.country)))) then
    raise exception 'Item code % is not in the material master for this country.', new.item_code using errcode = '22023';
  end if;
  return new;
end $fn$;
revoke all on function public.material_issue_line_validate() from public, anon, authenticated;
create or replace trigger trg_zzy_material_issue_lines_validate
  before insert or update of item_code, qty, stock_id, issue_id on public.material_issue_lines
  for each row execute function public.material_issue_line_validate();

commit;
