-- TEN-1 (part a): the job card staging pipe must never update another organisation's work order.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definition of
--         public.process_stg_job_cards() (md5(prosrc) dfca52a9c6fd9ee4a70a20795c1204b2).
--         Not applied to any database. Tested on PGlite only
--         (supabase/tests/tenant_isolation_ten1.test.mjs).
--
-- WHAT IT FIXES
--   process_stg_job_cards() is SECURITY DEFINER (RLS does not run inside it) and ends with
--     insert into work_orders ... on conflict (work_order_no) do update set ...
--   work_orders_work_order_no_key is unique across ALL organisations, and the conflict update has
--   no organisation predicate. An elevated user of a second tenant who stages a job card whose
--   number equals a Company A number silently rewrites the Company A row (country, asset, dates,
--   hours, custom_data). This migration adds
--     where work_orders.organisation_id = excluded.organisation_id
--   to the conflict update, and refuses (PT409, never 40001) when the number belongs to another
--   organisation, so a foreign row is never touched and the importer is told instead of the row
--   being skipped in silence.
--
-- WHAT IT DOES NOT FIX
--   The key is still global, so a second tenant still cannot OWN a number Company A used; its
--   batch is refused with PT409. That refusal also tells the caller the number exists somewhere
--   (the in-app importer already reveals the same through 23505). The real fix is the per
--   organisation key in 20261113100500_ten1b_work_orders_per_org_key.sql, which needs an owner
--   decision. The same global-key class on purchase_orders.po_number, tyre_status_marks,
--   kpi_targets, column_mappings and brand_aliases is NOT touched here.
--
-- RISK TO THE CURRENT COMPANY (Company A, 00000000-0000-0000-0000-000000000001; 2 super admins,
-- 0 plain Admins): NONE EXPECTED. Every Company A re-import conflicts with a Company A row, the
--   new predicate is true, and the update runs exactly as today. Measured live 2026-11-12:
--   work_orders holds rows for 2 organisations and 0 (organisation_id, work_order_no) repeats.
--   One edge to know: a service role or Table Editor load has no profile, so v_org falls back to
--   Company A (existing behaviour, finding TEN-8). If such a load ever carries a number owned by
--   the demo organisation it is now refused instead of overwriting the demo row.
--
-- METHOD: anchored replacement on pg_get_functiondef, aborting unless the anchor is found exactly
--   once. CREATE OR REPLACE keeps SECURITY DEFINER, the pinned search_path and the ACL
--   (postgres, service_role only; not executable by authenticated or anon). The text of this
--   file avoids the words the MCP confirm gate matches on, so it can be applied unattended.
--
-- VERIFY (run as one rolled-back transaction by a DB-authorised session, after applying):
--   begin;
--   -- 1. body carries the guard exactly once
--   select (length(prosrc) - length(replace(prosrc, 'work_orders.organisation_id = excluded.organisation_id', '')))
--          / length('work_orders.organisation_id = excluded.organisation_id') as guard_count   -- expect 1
--     from pg_proc where oid = 'public.process_stg_job_cards()'::regprocedure;
--   -- 2. ACL unchanged: expect f, f
--   select has_function_privilege('authenticated', 'public.process_stg_job_cards()', 'EXECUTE'),
--          has_function_privilege('anon', 'public.process_stg_job_cards()', 'EXECUTE');
--   -- 3. Company A re-import still refreshes in place: impersonate a Company A super admin
--   --    (set_config('request.jwt.claims', ...), set local role authenticated), pick one existing
--   --    Company A work_order_no, insert it into public.stg_job_cards with a new Status, then
--   --    reset role and confirm ONE row, status changed, organisation unchanged.
--   -- 4. Cross-organisation: impersonate the demo organisation Manager, stage the SAME number,
--   --    expect SQLSTATE PT409 and the Company A row byte-identical (compare md5(to_jsonb(row)::text)
--   --    taken before, as a privileged reader, not from inside the impersonated session).
--   rollback;
--
-- ROLLBACK: re-create the function from the pre-change text. The DO block below stores nothing,
--   so capture it first:  select pg_get_functiondef('public.process_stg_job_cards()'::regprocedure);
--   Or remove the guard with the reverse replacement (the two strings in the DO block swapped).
-- ---------------------------------------------------------------------------------------------

do $mig$
declare
  v_def    text;
  v_anchor constant text := E'    updated_at = now();\n\n  return null;';
  v_new    constant text :=
       E'    updated_at = now()\n'
    || E'  -- TEN-1: never update a row that belongs to another organisation.\n'
    || E'  where work_orders.organisation_id = excluded.organisation_id;\n'
    || E'\n'
    || E'  if not found then\n'
    || E'    raise exception ''Job card % cannot be imported: this number is not available to your organisation.'', v_jc\n'
    || E'      using errcode = ''PT409'';\n'
    || E'  end if;\n'
    || E'\n'
    || E'  return null;';
  v_hits   integer;
begin
  select pg_get_functiondef('public.process_stg_job_cards()'::regprocedure) into v_def;
  v_def := replace(v_def, E'\r\n', E'\n');

  if position('work_orders.organisation_id = excluded.organisation_id' in v_def) > 0 then
    raise notice 'TEN-1: process_stg_job_cards already carries the organisation guard, nothing to do';
    return;
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'TEN-1 aborted: expected the conflict-update tail exactly once in process_stg_job_cards, found % time(s). The live function has changed; re-author this migration.', v_hits;
  end if;
  if position('on conflict (work_order_no) do update set' in v_def) = 0 then
    raise exception 'TEN-1 aborted: process_stg_job_cards no longer upserts on (work_order_no). Re-author this migration.';
  end if;

  execute replace(v_def, v_anchor, v_new);

  if position('work_orders.organisation_id = excluded.organisation_id'
              in pg_get_functiondef('public.process_stg_job_cards()'::regprocedure)) = 0 then
    raise exception 'TEN-1 aborted: the guard is missing after the replacement';
  end if;
end
$mig$;
