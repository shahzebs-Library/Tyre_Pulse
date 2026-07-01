-- ============================================================================
-- MIGRATIONS_V53_GATE_PASS_BLOCKERS.sql
-- Gate-Pass Safety Gate (Phase 3). A vehicle must NOT be released while critical
-- safety defects are open. Read-only SECURITY DEFINER aggregator returning open
-- blockers for one asset, org + country scoped (null-safe). Additive only.
--
-- Blocker sources:
--   (a) corrective_actions: priority='High' AND status NOT IN ('Closed','Resolved')
--   (b) tyre_records: risk_level='Critical', latest row per serial_no for the asset
--   (c) inspections: severity='Critical' AND status NOT IN ('Done','Cancelled')
--       (verified: inspections.status ∈ Scheduled/In Progress/Done/Overdue/Cancelled —
--        an earlier draft excluded non-existent 'Completed'/'Approved' and was fixed.)
--
-- Depends on: app_current_org(), is_approved_and_unlocked().
-- Rollback: DROP FUNCTION IF EXISTS public.gate_pass_blockers(text, text);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gate_pass_blockers(p_asset_no text, p_country text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_org uuid := public.app_current_org();
  v_asset text := btrim(p_asset_no);
  v_country text := NULLIF(btrim(p_country), '');
  v_ca jsonb; v_ty jsonb; v_ins jsonb; v_total int;
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN
    RAISE EXCEPTION 'Not authorised.' USING errcode = '42501';
  END IF;
  IF v_asset IS NULL OR v_asset = '' THEN
    RAISE EXCEPTION 'asset_no is required.' USING errcode = '22004';
  END IF;
  IF v_country = 'All' THEN v_country := NULL; END IF;

  -- (a) open HIGH corrective actions
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'priority', c.priority,
           'status', c.status, 'root_cause', c.root_cause,
           'tyre_serial', c.tyre_serial, 'due_date', c.due_date, 'site', c.site)
         ORDER BY c.due_date NULLS LAST), '[]'::jsonb)
    INTO v_ca
  FROM public.corrective_actions c
  WHERE c.asset_no = v_asset
    AND c.priority = 'High'
    AND COALESCE(c.status, 'Open') NOT IN ('Closed', 'Resolved')
    AND (c.organisation_id IS NULL OR c.organisation_id = v_org)
    AND (v_country IS NULL OR c.country = v_country OR c.country IS NULL);

  -- (b) latest tyre_records row per serial for this asset, risk_level='Critical'
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', t.id, 'serial_no', t.serial_no, 'brand', t.brand,
           'risk_level', t.risk_level, 'tread_depth', t.tread_depth,
           'removal_reason', t.removal_reason, 'site', t.site)
         ORDER BY t.serial_no), '[]'::jsonb)
    INTO v_ty
  FROM (
    SELECT DISTINCT ON (tr.serial_no) tr.*
    FROM public.tyre_records tr
    WHERE tr.asset_no = v_asset
      AND (tr.organisation_id IS NULL OR tr.organisation_id = v_org)
      AND (v_country IS NULL OR tr.country = v_country OR tr.country IS NULL)
    ORDER BY tr.serial_no, tr.created_at DESC NULLS LAST, tr.id DESC
  ) t
  WHERE t.risk_level = 'Critical';

  -- (c) open CRITICAL inspections (Done/Cancelled are resolved)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id, 'title', i.title, 'inspection_type', i.inspection_type,
           'severity', i.severity, 'status', i.status,
           'tyre_serial', i.tyre_serial, 'inspection_date', i.inspection_date,
           'findings', i.findings, 'site', i.site)
         ORDER BY i.inspection_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_ins
  FROM public.inspections i
  WHERE i.asset_no = v_asset
    AND i.severity = 'Critical'
    AND COALESCE(i.status, '') NOT IN ('Done', 'Cancelled')
    AND (i.organisation_id IS NULL OR i.organisation_id = v_org)
    AND (v_country IS NULL OR i.country = v_country OR i.country IS NULL);

  v_total := jsonb_array_length(v_ca) + jsonb_array_length(v_ty) + jsonb_array_length(v_ins);

  RETURN jsonb_build_object(
    'asset_no', v_asset, 'country', v_country, 'total', v_total, 'blocked', (v_total > 0),
    'corrective_actions', v_ca, 'tyres', v_ty, 'inspections', v_ins);
END; $fn$;

REVOKE ALL ON FUNCTION public.gate_pass_blockers(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gate_pass_blockers(text, text) TO authenticated;
COMMENT ON FUNCTION public.gate_pass_blockers(text, text) IS
  'Open critical safety blockers for an asset (High corrective_actions, Critical latest-per-serial tyre_records, Critical open inspections). Org + country scoped. Powers the gate-pass safety gate.';
