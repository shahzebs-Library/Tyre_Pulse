-- ============================================================================
-- MIGRATIONS_V201 — Holding Company / Multi-Subsidiary Consolidation
-- ============================================================================
-- Adds a parent→child organisation hierarchy and a SECURE cross-org KPI
-- roll-up for holding companies that own multiple subsidiary tenants.
--
-- SECURITY MODEL (critical):
--   • organisations.parent_organisation_id links a subsidiary to its holding org.
--   • All cross-org reads happen ONLY inside SECURITY DEFINER functions that take
--     NO caller-supplied org ids. Each function derives the caller's own org via
--     app_current_org() and aggregates strictly that org + its direct children
--     (parent_organisation_id = caller org). A caller can never read an org that
--     is not its own child, and cannot pass an arbitrary org id. This preserves
--     the app-wide RESTRICTIVE org-isolation guarantee — the definer functions
--     are the single, audited seam through which a parent sees rolled-up totals.
--   • Writes (link/unlink/transfers) require an elevated role (Admin/Director)
--     and can only claim UNPARENTED orgs (by slug) or release the caller's OWN
--     children — preventing subsidiary theft.
--
-- Depends on V42 helpers: app_current_org(), get_my_role(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

-- 1. Hierarchy column ---------------------------------------------------------
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS parent_organisation_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_organisations_parent ON public.organisations (parent_organisation_id);

-- 2. Cross-subsidiary transfers ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.holding_transfers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),   -- the holding (parent) org that recorded it
  from_org_id       uuid,
  to_org_id         uuid,
  asset_type        text CHECK (asset_type IN ('tyre','vehicle','part','other')),
  asset_ref         text,
  quantity          numeric,
  status            text CHECK (status IN ('pending','in_transit','received','cancelled')),
  notes             text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_holding_transfers_org ON public.holding_transfers (organisation_id);
CREATE INDEX IF NOT EXISTS idx_holding_transfers_created ON public.holding_transfers (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_holding_transfers ON public.holding_transfers;
CREATE TRIGGER set_updated_at_holding_transfers BEFORE UPDATE ON public.holding_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.holding_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS holding_transfers_org_isolation ON public.holding_transfers;
CREATE POLICY holding_transfers_org_isolation ON public.holding_transfers
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());
DROP POLICY IF EXISTS holding_transfers_read ON public.holding_transfers;
CREATE POLICY holding_transfers_read ON public.holding_transfers FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS holding_transfers_insert ON public.holding_transfers;
CREATE POLICY holding_transfers_insert ON public.holding_transfers FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));
DROP POLICY IF EXISTS holding_transfers_update ON public.holding_transfers;
CREATE POLICY holding_transfers_update ON public.holding_transfers FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));
DROP POLICY IF EXISTS holding_transfers_delete ON public.holding_transfers;
CREATE POLICY holding_transfers_delete ON public.holding_transfers FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));
REVOKE ALL ON public.holding_transfers FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holding_transfers TO authenticated;

-- 3. Secure consolidated KPI roll-up -----------------------------------------
CREATE OR REPLACE FUNCTION public.holding_consolidated_kpis()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent uuid := public.app_current_org();
  v_role   text := public.get_my_role();
  v_ids    uuid[];
  v_subs   jsonb;
  v_total  jsonb;
BEGIN
  IF v_parent IS NULL THEN RETURN jsonb_build_object('error','no_org'); END IF;
  IF v_role IS NULL OR v_role NOT IN ('Admin','Manager','Director') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  -- Strictly the caller's own org plus its direct children. No external input.
  SELECT array_agg(id) INTO v_ids
    FROM public.organisations
   WHERE id = v_parent OR parent_organisation_id = v_parent;

  WITH org_ids AS (SELECT unnest(v_ids) AS oid),
  kpi AS (
    SELECT
      org.id::text                                   AS tenant_id,
      org.name                                       AS name,
      org.logo_url                                   AS logo_url,
      (org.id = v_parent)                            AS is_hq,
      (SELECT count(*) FROM public.vehicle_fleet vf
        WHERE vf.organisation_id = o.oid AND COALESCE(vf.is_active, true))          AS vehicles,
      (SELECT count(*) FROM public.tyre_records tr
        WHERE tr.organisation_id = o.oid)                                           AS tyres,
      (SELECT count(*) FROM public.alerts a
        WHERE a.organisation_id = o.oid AND COALESCE(a.resolved, false) = false)    AS open_alerts,
      (SELECT count(*) FROM public.alerts a
        WHERE a.organisation_id = o.oid AND COALESCE(a.resolved, false) = false
          AND a.severity = 'critical')                                             AS critical_alerts,
      (SELECT count(*) FROM public.tyre_records tr
        WHERE tr.organisation_id = o.oid AND tr.tread_depth IS NOT NULL
          AND tr.tread_depth < 3)                                                  AS low_tread,
      (SELECT COALESCE(sum(po.total_amount), 0) FROM public.purchase_orders po
        WHERE po.organisation_id = o.oid AND po.created_at >= now() - interval '30 days'
          AND COALESCE(po.status,'') <> 'cancelled')                               AS spend_30d
    FROM org_ids o JOIN public.organisations org ON org.id = o.oid
  ),
  scored AS (
    SELECT k.*, GREATEST(0, 100 - (low_tread * 5) - (critical_alerts * 10)) AS fleet_health_score
    FROM kpi k
  )
  SELECT
    jsonb_agg(to_jsonb(scored) ORDER BY is_hq DESC, fleet_health_score ASC),
    jsonb_build_object(
      'vehicles',        COALESCE(sum(vehicles), 0),
      'tyres',           COALESCE(sum(tyres), 0),
      'alerts',          COALESCE(sum(open_alerts), 0),
      'critical_alerts', COALESCE(sum(critical_alerts), 0),
      'low_tread',       COALESCE(sum(low_tread), 0),
      'spend_30d',       COALESCE(sum(spend_30d), 0)
    )
  INTO v_subs, v_total
  FROM scored;

  RETURN jsonb_build_object(
    'parent_id',        v_parent,
    'subsidiary_count', (SELECT count(*) FROM public.organisations WHERE parent_organisation_id = v_parent),
    'grand_total',      COALESCE(v_total, '{}'::jsonb),
    'subsidiaries',     COALESCE(v_subs, '[]'::jsonb)
  );
END $$;

-- 4. List this holding's subsidiaries (children only) ------------------------
CREATE OR REPLACE FUNCTION public.holding_subsidiaries()
RETURNS TABLE(id uuid, name text, slug text, logo_url text, active boolean, country text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.name, o.slug, o.logo_url, o.active, o.primary_country
  FROM public.organisations o
  WHERE o.parent_organisation_id = public.app_current_org()
  ORDER BY o.name;
$$;

-- 5. Claim an UNPARENTED org as a subsidiary (by slug) -----------------------
CREATE OR REPLACE FUNCTION public.holding_link_subsidiary(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent uuid := public.app_current_org();
  v_role   text := public.get_my_role();
  v_child  public.organisations%ROWTYPE;
BEGIN
  IF v_parent IS NULL THEN RETURN jsonb_build_object('error','no_org'); END IF;
  IF v_role IS NULL OR v_role NOT IN ('Admin','Director') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  SELECT * INTO v_child FROM public.organisations WHERE slug = p_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF v_child.id = v_parent THEN RETURN jsonb_build_object('error','cannot_link_self'); END IF;
  IF v_child.parent_organisation_id IS NOT NULL THEN RETURN jsonb_build_object('error','already_linked'); END IF;
  -- Cycle guard: the target must not be an ancestor of the caller.
  IF EXISTS (SELECT 1 FROM public.organisations WHERE id = v_parent AND parent_organisation_id = v_child.id) THEN
    RETURN jsonb_build_object('error','would_create_cycle');
  END IF;
  UPDATE public.organisations SET parent_organisation_id = v_parent, updated_at = now() WHERE id = v_child.id;
  RETURN jsonb_build_object('ok', true, 'linked', v_child.id, 'name', v_child.name);
END $$;

-- 6. Release one of the caller's OWN subsidiaries ----------------------------
CREATE OR REPLACE FUNCTION public.holding_unlink_subsidiary(p_child uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent uuid := public.app_current_org();
  v_role   text := public.get_my_role();
  v_rows   int;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('Admin','Director') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  UPDATE public.organisations SET parent_organisation_id = NULL, updated_at = now()
    WHERE id = p_child AND parent_organisation_id = v_parent;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('error','not_a_subsidiary'); END IF;
  RETURN jsonb_build_object('ok', true, 'unlinked', p_child);
END $$;

REVOKE ALL ON FUNCTION public.holding_consolidated_kpis() FROM anon;
REVOKE ALL ON FUNCTION public.holding_subsidiaries() FROM anon;
REVOKE ALL ON FUNCTION public.holding_link_subsidiary(text) FROM anon;
REVOKE ALL ON FUNCTION public.holding_unlink_subsidiary(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.holding_consolidated_kpis() TO authenticated;
GRANT EXECUTE ON FUNCTION public.holding_subsidiaries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.holding_link_subsidiary(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.holding_unlink_subsidiary(uuid) TO authenticated;

-- Reversible:
--   DROP FUNCTION IF EXISTS public.holding_consolidated_kpis();
--   DROP FUNCTION IF EXISTS public.holding_subsidiaries();
--   DROP FUNCTION IF EXISTS public.holding_link_subsidiary(text);
--   DROP FUNCTION IF EXISTS public.holding_unlink_subsidiary(uuid);
--   DROP TABLE IF EXISTS public.holding_transfers;
--   ALTER TABLE public.organisations DROP COLUMN IF EXISTS parent_organisation_id;
