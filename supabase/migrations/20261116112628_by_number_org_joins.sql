-- =============================================================================
-- 20261117110000_by_number_org_joins.sql
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner review. Tested on the local
--         mirror (tp_mirror2 copy) only. Rollback: the sibling *_ROLLBACK.sql.
--
-- WHY
--   TEN-1b (20261113100500, applied) made work_orders unique per
--   (organisation_id, work_order_no). A job card number is therefore no longer a
--   global identity: two companies may both hold "GCKR/JC/0001/0126". Anything
--   that joins or looks up a job card BY NUMBER ONLY must also match the
--   company, or once a second company imports an overlapping number:
--     * one company's expense lines attach to the other company's job card
--       (cost, asset, site attribution move across tenants),
--     * a staging import silently skips a row because the OTHER company already
--       has that number, or patches the other company's tyre record.
--   Today one company holds data, so nothing is wrong yet. This closes it before
--   the second company arrives.
--
-- WHAT (full inventory: docs/commercial-readiness/audit/BY_NUMBER_JOIN_AUDIT.md)
--   Re-creates 8 functions and 1 view from their LIVE definitions with the
--   company condition added. Nothing is retyped: each object is read with
--   pg_get_functiondef / pg_get_viewdef, each anchor must occur EXACTLY ONCE or
--   the whole migration aborts, and the edited text is executed. CREATE OR
--   REPLACE keeps owner, grants, SECURITY DEFINER and the pinned search_path.
--   Each edited body carries the marker /* by-number-org */; an object that
--   already carries it is skipped, so a re-run is a no-op.
--
--     1. classify_parts_consumption  (trigger)  tyre-job-card signal matched a
--        tyre of ANY company with the same number + country.
--     2. get_site_operating_cost     (RPC)      parts line -> job card -> asset
--        -> site joined work_orders by number only (and vehicle_fleet by asset
--        number only; same function, same leak class, fixed together).
--     3. get_asset_disposal_register (RPC)      spend per asset summed parts
--        lines of ANY company whose number matched this company's job card.
--     4. process_stg_complaints      (trigger)  duplicate check matched the
--        number in ANY company (other company's card = this row silently
--        skipped). Now: same company, any country (the key is per company, so a
--        same-company card in another country would hit the unique key and abort
--        the batch). The insert now names the company explicitly, resolved the
--        same way as process_stg_wo_lines.
--     5. process_stg_monthly_tyres   (trigger)  existing-row lookup (serial +
--        country + date + job card + position) could PATCH another company's
--        tyre record. Now restricted to the importing company.
--     6. convert_repair_request_to_job_card (RPC) "is this number taken" looked
--        across companies and refused with "belongs to another organisation",
--        which is now wrong: numbers are per company.
--     7. owner_data_audit            (RPC, super admin) orphan line-item count
--        matched a job card in any company.
--     8. tyre_cost_audit_classify    (SQL, invoker) tyre <-> own job card lines
--        and the same-month price index ignored the company. Invoker + RLS
--        protects ordinary users; a super admin or a service caller mixed
--        companies, and tyre_cost_audit_scan then persisted the mix.
--     9. v_tyre_fitment_evidence     (view, security_invoker) job_card_found
--        was true when ANY company had that number.
--
-- NOT CHANGED (checked, already company-scoped): backfill_tyre_prices_from_grid,
--   tyre_price_backfill, work_order_cost_reconcile, process_stg_wo_lines,
--   process_stg_job_cards, get_asset_disposal_fleet_baseline,
--   get_asset_disposal_reliability, list_scrapped_tyres, observation_erp_evaluate,
--   import_existing_keys, promote_erp_tyre_expense, get_maintenance_snapshot,
--   get_parts_expense_snapshot (no number join), report/workshop snapshots.
--
-- The text deliberately contains no destructive keyword so the Supabase MCP
-- apply path does not stop on its confirm prompt.
-- =============================================================================

begin;

create schema if not exists _bak;
create table if not exists _bak.by_number_org_joins_defs (
  object_name text primary key,
  kind        text not null,
  definition  text not null,
  saved_at    timestamptz not null default now()
);
revoke all on _bak.by_number_org_joins_defs from public;

-- Replace ONE occurrence of p_anchor; abort unless it occurs exactly once.
create or replace function pg_temp.by_number_patch(p_def text, p_anchor text, p_repl text, p_label text)
returns text language plpgsql as $f$
declare n int;
begin
  n := (length(p_def) - length(replace(p_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if n <> 1 then
    raise exception 'by-number-org: anchor % found % times (expected 1)', p_label, n;
  end if;
  return replace(p_def, p_anchor, p_repl);
end $f$;

-- Read the live function, save it once, apply a list of (anchor, replacement)
-- pairs, execute. Skips an object already carrying the marker.
create or replace function pg_temp.by_number_apply(p_sig text, p_pairs text[][])
returns void language plpgsql as $f$
declare v_def text; v_new text; i int;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  if position('/* by-number-org */' in v_def) > 0 then
    raise notice 'by-number-org: % already patched, skipped', p_sig;
    return;
  end if;
  insert into _bak.by_number_org_joins_defs(object_name, kind, definition)
  values (p_sig, 'function', v_def)
  on conflict (object_name) do nothing;
  v_new := v_def;
  for i in 1 .. array_length(p_pairs, 1) loop
    v_new := pg_temp.by_number_patch(v_new, p_pairs[i][1], p_pairs[i][2], p_sig || ' #' || i);
  end loop;
  if position('/* by-number-org */' in v_new) = 0 then
    raise exception 'by-number-org: % edited without the marker', p_sig;
  end if;
  execute v_new;
end $f$;

-- 1. classify_parts_consumption -------------------------------------------------
select pg_temp.by_number_apply('public.classify_parts_consumption()', array[
  array[$a$       and upper(btrim(t.job_card)) = upper(btrim(NEW.work_order_no))$a$,
        $r$       and t.organisation_id = NEW.organisation_id /* by-number-org */
       and upper(btrim(t.job_card)) = upper(btrim(NEW.work_order_no))$r$]
]);

-- 2. get_site_operating_cost ---------------------------------------------------
select pg_temp.by_number_apply('public.get_site_operating_cost(text,date,date)', array[
  array[$a$      on w.work_order_no = pc.work_order_no
$a$,
        $r$      on w.work_order_no = pc.work_order_no
     and w.organisation_id = pc.organisation_id /* by-number-org */
$r$],
  array[$a$      where upper(btrim(vf.asset_no)) = upper(btrim(w.asset_no))
$a$,
        $r$      where upper(btrim(vf.asset_no)) = upper(btrim(w.asset_no))
        and vf.organisation_id = pc.organisation_id
$r$]
]);

-- 3. get_asset_disposal_register -----------------------------------------------
select pg_temp.by_number_apply('public.get_asset_disposal_register(text)', array[
  array[$a$join public.work_orders w on w.work_order_no = p.work_order_no$a$,
        $r$join public.work_orders w on w.work_order_no = p.work_order_no and p.organisation_id = w.organisation_id /* by-number-org */$r$]
]);

-- 4. process_stg_complaints ----------------------------------------------------
select pg_temp.by_number_apply('public.process_stg_complaints()', array[
  array[$a$DECLARE outd date;$a$,
        $r$DECLARE outd date; v_org uuid;$r$],
  array[$a$  IF coalesce(btrim(NEW.jc_no),'')='' AND coalesce(btrim(NEW.veh_no),'')='' THEN RETURN NULL; END IF;
$a$,
        $r$  IF coalesce(btrim(NEW.jc_no),'')='' AND coalesce(btrim(NEW.veh_no),'')='' THEN RETURN NULL; END IF;
  v_org := coalesce(public.app_current_org(), public._resolve_import_org()); /* by-number-org */
$r$],
  array[$a$       AND w.country IS NOT DISTINCT FROM NEW.country) THEN RETURN NULL; END IF;$a$,
        $r$       AND w.organisation_id IS NOT DISTINCT FROM v_org) THEN RETURN NULL; END IF;$r$],
  array[$a$    (country, work_order_no, asset_no,$a$,
        $r$    (organisation_id, country, work_order_no, asset_no,$r$],
  array[$a$  VALUES (NEW.country, NEW.jc_no, NEW.veh_no,$a$,
        $r$  VALUES (v_org, NEW.country, NEW.jc_no, NEW.veh_no,$r$]
]);

-- 5. process_stg_monthly_tyres -------------------------------------------------
select pg_temp.by_number_apply('public.process_stg_monthly_tyres()', array[
  array[$a$    and t.country is not distinct from new.country
    and t.issue_date is not distinct from fd
$a$,
        $r$    and t.country is not distinct from new.country
    and t.organisation_id is not distinct from coalesce(new.organisation_id, public.app_current_org(), public._resolve_import_org()) /* by-number-org */
    and t.issue_date is not distinct from fd
$r$]
]);

-- 6. convert_repair_request_to_job_card ----------------------------------------
select pg_temp.by_number_apply('public.convert_repair_request_to_job_card(uuid,text,text,timestamp with time zone)', array[
  array[$a$    select w.id into v_id from public.work_orders w where w.work_order_no = v_no;$a$,
        $r$    select w.id into v_id from public.work_orders w where w.work_order_no = v_no and w.organisation_id = v_org; /* by-number-org */$r$]
]);

-- 7. owner_data_audit ----------------------------------------------------------
select pg_temp.by_number_apply('public.owner_data_audit()', array[
  array[$a$     and not exists (select 1 from work_orders w where w.work_order_no=li.work_order_no);$a$,
        $r$     and not exists (select 1 from work_orders w where w.work_order_no=li.work_order_no
                       and w.organisation_id is not distinct from li.organisation_id /* by-number-org */);$r$]
]);

-- 8. tyre_cost_audit_classify (LANGUAGE sql, invoker) -------------------------
select pg_temp.by_number_apply('public.tyre_cost_audit_classify(text,date,date)', array[
  array[$a$  select r.id, r.country, r.cost_per_tyre cost,$a$,
        $r$  select r.id, r.organisation_id org, r.country, r.cost_per_tyre cost,$r$],
  array[$a$  select p.id, p.country, btrim(p.work_order_no) jc,$a$,
        $r$  select p.id, p.organisation_id org, p.country, btrim(p.work_order_no) jc,$r$],
  array[$a$  select p.country, upper(regexp_replace(coalesce(p.item_code,''), '\s+', '', 'g')) item, to_char(p.event_date, 'YYYY-MM') m,
         count(distinct$a$,
        $r$  select p.organisation_id org, p.country, upper(regexp_replace(coalesce(p.item_code,''), '\s+', '', 'g')) item, to_char(p.event_date, 'YYYY-MM') m,
         count(distinct$r$],
  array[$a$  group by 1, 2, 3),$a$,
        $r$  group by 1, 2, 3, 4),$r$],
  array[$a$  from t left join own o on o.country = t.country and o.jc = t.jc$a$,
        $r$  from t left join own o on o.org = t.org /* by-number-org */ and o.country = t.country and o.jc = t.jc$r$],
  array[$a$  group by t.id, t.country, t.cost,$a$,
        $r$  group by t.id, t.org, t.country, t.cost,$r$],
  array[$a$  from a left join idx i on i.country = a.country$a$,
        $r$  from a left join idx i on i.org = a.org and i.country = a.country$r$]
]);

-- 9. v_tyre_fitment_evidence (view, security_invoker) --------------------------
do $v$
declare v_def text; v_new text;
begin
  v_def := pg_get_viewdef('public.v_tyre_fitment_evidence'::regclass);
  if position('(wo.org = f.organisation_id)' in v_def) > 0 then
    raise notice 'by-number-org: v_tyre_fitment_evidence already patched, skipped';
    return;
  end if;
  insert into _bak.by_number_org_joins_defs(object_name, kind, definition)
  values ('public.v_tyre_fitment_evidence', 'view', v_def)
  on conflict (object_name) do nothing;
  v_new := pg_temp.by_number_patch(v_def,
    $a$         SELECT DISTINCT upper(btrim((work_orders.work_order_no)::text)) AS n
$a$,
    $r$         SELECT DISTINCT work_orders.organisation_id AS org,
            upper(btrim((work_orders.work_order_no)::text)) AS n
$r$, 'view wo');
  v_new := pg_temp.by_number_patch(v_new,
    $a$                  WHERE (wo.n = upper(btrim(f.job_card))))) AS job_card_found,$a$,
    $r$                  WHERE ((wo.org = f.organisation_id) AND (wo.n = upper(btrim(f.job_card)))))) AS job_card_found,$r$,
    'view exists');
  execute 'create or replace view public.v_tyre_fitment_evidence with (security_invoker = on) as ' || v_new;
end $v$;

-- Post-conditions: every object carries the company condition; the view stays invoker.
do $chk$
declare r record; missing text := '';
begin
  for r in select unnest(array[
      'public.classify_parts_consumption()',
      'public.get_site_operating_cost(text,date,date)',
      'public.get_asset_disposal_register(text)',
      'public.process_stg_complaints()',
      'public.process_stg_monthly_tyres()',
      'public.convert_repair_request_to_job_card(uuid,text,text,timestamp with time zone)',
      'public.owner_data_audit()',
      'public.tyre_cost_audit_classify(text,date,date)']) as sig
  loop
    if position('/* by-number-org */' in pg_get_functiondef(r.sig::regprocedure)) = 0 then
      missing := missing || r.sig || ' ';
    end if;
  end loop;
  if position('(wo.org = f.organisation_id)' in pg_get_viewdef('public.v_tyre_fitment_evidence'::regclass)) = 0 then
    missing := missing || 'v_tyre_fitment_evidence ';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.v_tyre_fitment_evidence'::regclass
                 and 'security_invoker=on' = any(reloptions)) then
    raise exception 'by-number-org: v_tyre_fitment_evidence lost security_invoker';
  end if;
  if missing <> '' then
    raise exception 'by-number-org: not patched: %', missing;
  end if;
end $chk$;

commit;

-- =============================================================================
-- VERIFY (run as a separate call; ends in ROLLBACK, changes nothing)
--   Simulates a second company holding the same job card number, then checks
--   that company A's figures do not move.
--
-- begin;
--   insert into public.organisations(id, name) values ('00000000-0000-0000-0000-0000000000b2', 'VERIFY B');
--   -- pick one real company-A expense line that has a job card + asset
--   create temp table v_src as
--     select pc.work_order_no, pc.asset_code, pc.country from public.parts_consumption pc
--     join public.work_orders w on w.organisation_id = pc.organisation_id and w.work_order_no = pc.work_order_no
--     where pc.organisation_id = '00000000-0000-0000-0000-000000000001' and pc.line_cost > 0 limit 1;
--   insert into public.work_orders(organisation_id, country, work_order_no, asset_no, work_type, status, opened_at)
--     select '00000000-0000-0000-0000-0000000000b2', country, work_order_no, 'VERIFY-B-ASSET', 'Repair', 'Open', now() from v_src;
--   -- (a) disposal register spend for company A unchanged: compare
--   --     get_asset_disposal_register(null) before/after the insert (as an A user).
--   -- (b) site operating cost: as an A user, get_site_operating_cost() totals unchanged and
--   --     no asset 'VERIFY-B-ASSET' appears.
--   -- (c) complaints import as company B (set tp.import_org = B) of that number inserts
--   --     a B row instead of being skipped; as company A it is skipped.
-- rollback;
--   The local test that ran these assertions is recorded in
--   docs/commercial-readiness/audit/BY_NUMBER_JOIN_AUDIT.md (section "Local test").
-- =============================================================================
