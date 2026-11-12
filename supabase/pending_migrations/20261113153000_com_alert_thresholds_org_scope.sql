-- COM-3 (audit MODB-4): alert rules count inside the rule owner's organisation only.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definition of
--         evaluate_alert_thresholds (pg_get_functiondef, project jhssdmeruxtrlqnwfksc, SELECT
--         only). Not applied to any database. Tested on PGlite only
--         (supabase/tests/commercial_notifications.test.mjs).
--
-- ROOT CAUSE (three defects in one function; cron job evaluate-alert-thresholds, hourly)
--   1. The tread, pressure, tyre age and overdue-inspection metrics count public.inspections and
--      public.tyre_records with a site (and brand) filter only. There is no organisation
--      predicate, so a rule owned by company B counts company A's rows and the notification
--      tells B's user that number.
--   2. The ten "count" metrics do carry "($2::uuid IS NULL OR organisation_id = $2)", but the
--      value is alert_thresholds.org_id, a NULLABLE column. A rule saved without it counts
--      every organisation.
--   3. The tread_depth metric reads inspections.tread_depth, a column that does not exist
--      (information_schema, 2026-11-12). The first tread rule would raise 42703 and, with no
--      handler, abort the whole hourly run for every rule after it.
--   Latent today: alert_thresholds holds 0 rows.
--
-- WHAT THIS CHANGES
--   * Each rule is evaluated for ONE organisation: alert_thresholds.org_id, else the rule
--     owner's profile organisation. A rule with neither is skipped (it cannot be scoped).
--   * Every metric query carries "organisation_id = <that organisation>" as a bound value.
--   * tread_depth reads the real source: inspections.tyre_conditions, per wheel key
--     tread_depth_mm (the only place tread is recorded). Non-numeric values are ignored.
--   * Each rule runs in its own block: a failing rule is reported with RAISE WARNING and
--     counted in the result ("failed"); the run continues with the next rule.
--   * Everything else (operators, site and brand filters, the 23 hour re-fire guard, the
--     notification text, the domain event) is the live text, unchanged.
--   NOT INCLUDED: country scope. alert_thresholds has no country column; a country-restricted
--   user's rule still counts all countries of its own organisation. Recorded as a follow-up.
--
-- RISK TO THE CURRENT COMPANY: NONE. No rules exist, so no notification changes. For a future
--   rule in the current company the counts are the same as today's for its own rows; rows of
--   other organisations are no longer included.
--
-- VERIFY (after applying; read only)
--   select position('tread_depth_mm' in pg_get_functiondef('public.evaluate_alert_thresholds()'::regprocedure)) > 0; -- t
--   select position('IS NULL OR organisation_id' in pg_get_functiondef('public.evaluate_alert_thresholds()'::regprocedure)) = 0; -- t
--   select has_function_privilege('authenticated','public.evaluate_alert_thresholds()','EXECUTE'); -- f (unchanged)
--
-- ROLLBACK
--   Re-create evaluate_alert_thresholds from
--   supabase/tests/fixtures/commercial_live_functions.sql (faithful copy, md5 checked by the test).

do $guard$
declare
  v text;
begin
  select md5(prosrc) into v from pg_proc
   where oid = 'public.evaluate_alert_thresholds()'::regprocedure;
  if v is distinct from 'e0a7f85ddb78e63045c3b49258a3f5e8' then
    raise exception 'COM-3: evaluate_alert_thresholds has changed since this draft was written (md5 %). Re-author against the live body.', v;
  end if;
end
$guard$;

create or replace function public.evaluate_alert_thresholds()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  t       record;
  v_count int;
  v_fired int := 0;
  v_failed int := 0;
  v_skipped int := 0;
  v_op    text;
  v_is_count boolean;
  v_hit   boolean;
  v_sql   text;
  v_org   uuid;
BEGIN
  FOR t IN
    SELECT * FROM public.alert_thresholds
     WHERE active
       AND metric IN ('tread_depth','pressure','tyre_age_days','inspection_overdue_days',
                    'open_breakdowns','stock_below_min','overdue_parts_requests','expiring_certifications',
                    'open_corrective_actions','pending_approvals','overdue_work_orders','open_accidents',
                    'pm_overdue','high_risk_tyres')
       AND (last_triggered_at IS NULL OR last_triggered_at < now() - interval '23 hours')
  LOOP
    -- COM-3: one organisation per rule. A rule that cannot be scoped is not evaluated.
    v_org := COALESCE(t.org_id,
                      (SELECT COALESCE(p.org_id, p.organisation_id)
                         FROM public.profiles p WHERE p.id = t.user_id));
    IF v_org IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
    v_op := CASE t.operator
              WHEN 'lt' THEN '<' WHEN 'lte' THEN '<='
              WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' ELSE '=' END;
    v_count := 0;
    v_is_count := false;
    IF t.metric = 'tread_depth' THEN
      -- Tread is recorded per wheel inside tyre_conditions (key tread_depth_mm).
      EXECUTE format(
        'SELECT count(*) FROM public.inspections i
          WHERE i.organisation_id = $3
            AND i.created_at > now() - interval ''25 hours''
            AND ($2 IS NULL OR i.site = $2)
            AND EXISTS (
              SELECT 1
                FROM jsonb_each(CASE WHEN jsonb_typeof(i.tyre_conditions) = ''object''
                                     THEN i.tyre_conditions ELSE ''{}''::jsonb END) e
               WHERE (CASE WHEN jsonb_typeof(e.value) = ''object''
                            AND (e.value ->> ''tread_depth_mm'') ~ ''^[0-9]+(\.[0-9]+)?$''
                           THEN (e.value ->> ''tread_depth_mm'')::numeric END) %s $1)',
        v_op)
      INTO v_count USING t.threshold, NULLIF(t.site_filter, ''), v_org;
    ELSIF t.metric = 'pressure' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.inspections
          WHERE organisation_id = $3
            AND created_at > now() - interval ''25 hours''
            AND pressure_reading IS NOT NULL AND pressure_reading %s $1
            AND ($2 IS NULL OR site = $2)',
        v_op)
      INTO v_count USING t.threshold, NULLIF(t.site_filter, ''), v_org;
    ELSIF t.metric = 'tyre_age_days' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.tyre_records
          WHERE organisation_id = $4
            AND issue_date IS NOT NULL
            AND (current_date - issue_date) %s $1
            AND ($2 IS NULL OR site = $2)
            AND ($3 IS NULL OR brand = $3)',
        v_op)
      INTO v_count USING t.threshold::int, NULLIF(t.site_filter, ''), NULLIF(t.brand_filter, ''), v_org;
    ELSIF t.metric = 'inspection_overdue_days' THEN
      EXECUTE format(
        'SELECT count(*) FROM (
           SELECT asset_no,
                  current_date - max(COALESCE(completed_date, scheduled_date)) AS days_since
             FROM public.inspections
            WHERE asset_no IS NOT NULL
              AND organisation_id = $3
              AND ($2 IS NULL OR site = $2)
            GROUP BY asset_no
         ) x WHERE x.days_since %s $1',
        v_op)
      INTO v_count USING t.threshold::int, NULLIF(t.site_filter, ''), v_org;
    ELSE
      v_is_count := true;
      v_sql := CASE t.metric
        WHEN 'open_breakdowns' THEN
          'SELECT count(*) FROM public.asset_breakdowns WHERE NOT COALESCE(returned_to_service, false)'
        WHEN 'stock_below_min' THEN
          'SELECT count(*) FROM public.stock_records WHERE min_level IS NOT NULL AND stock_qty IS NOT NULL AND stock_qty <= min_level'
        WHEN 'overdue_parts_requests' THEN
          'SELECT count(*) FROM public.parts_requests WHERE needed_by < now() AND lower(COALESCE(status, '''')) NOT IN (''fulfilled'',''rejected'',''cancelled'')'
        WHEN 'expiring_certifications' THEN
          'SELECT count(*) FROM public.certifications WHERE expiry_date BETWEEN current_date AND current_date + 30 AND lower(COALESCE(status, '''')) <> ''revoked'''
        WHEN 'open_corrective_actions' THEN
          'SELECT count(*) FROM public.corrective_actions WHERE lower(COALESCE(status, '''')) NOT IN (''closed'',''completed'',''cancelled'',''resolved'',''verified'')'
        WHEN 'pending_approvals' THEN
          'SELECT count(*) FROM public.inspections WHERE approval_status = ''pending_approval'''
        WHEN 'overdue_work_orders' THEN
          'SELECT count(*) FROM public.work_orders WHERE target_completion < now() AND public.wo_status_canonical(status) NOT IN (''Completed'',''Closed'',''Cancelled'')'
        WHEN 'open_accidents' THEN
          'SELECT count(*) FROM public.accidents WHERE lower(COALESCE(status, '''')) NOT IN (''closed'',''cancelled'')'
        WHEN 'pm_overdue' THEN
          'SELECT count(*) FROM public.pm_programs WHERE lower(COALESCE(status, '''')) = ''active'' AND next_due < current_date'
        WHEN 'high_risk_tyres' THEN
          'SELECT count(*) FROM public.tyre_records WHERE risk_level IN (''High'',''Critical'')'
      END;
      IF v_sql IS NOT NULL THEN
        EXECUTE v_sql || ' AND ($1::text IS NULL OR site = $1) AND organisation_id = $2'
          INTO v_count USING NULLIF(t.site_filter, ''), v_org;
      END IF;
    END IF;
    IF v_is_count THEN
      EXECUTE format('SELECT $1 %s $2', v_op) INTO v_hit USING COALESCE(v_count, 0)::numeric, t.threshold;
    ELSE
      v_hit := COALESCE(v_count, 0) > 0;
    END IF;
    IF COALESCE(v_hit, false) THEN
      IF COALESCE(t.notify_in_app, true) AND t.user_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
        VALUES (t.user_id, 'threshold',
                'Threshold triggered: ' || t.name,
                v_count || ' record(s) matched ' || t.metric || ' ' || t.operator || ' ' || t.threshold ||
                  COALESCE(' at ' || NULLIF(t.site_filter, ''), '') || '.',
                'alert_threshold', t.id);
      END IF;
      UPDATE public.alert_thresholds
         SET triggered_count = COALESCE(triggered_count, 0) + 1, last_triggered_at = now()
       WHERE id = t.id;
      PERFORM public.emit_domain_event('threshold.triggered', 'alert_threshold', t.id::text,
        jsonb_build_object('name', t.name, 'metric', t.metric, 'operator', t.operator,
                           'threshold', t.threshold, 'matched', v_count, 'site_filter', t.site_filter),
        NULL, t.user_id);
      v_fired := v_fired + 1;
    END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad rule must not stop the hourly run for every other company's rules.
      v_failed := v_failed + 1;
      RAISE WARNING 'evaluate_alert_thresholds: rule % (%) failed: %', t.id, t.metric, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('fired', v_fired, 'failed', v_failed, 'skipped', v_skipped);
END;
$function$;

revoke all on function public.evaluate_alert_thresholds() from public, anon, authenticated;
grant execute on function public.evaluate_alert_thresholds() to service_role;
