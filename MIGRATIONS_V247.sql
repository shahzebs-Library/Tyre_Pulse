-- V247 — Reconcile the same physical site recorded under different codes.
--
-- After V246 fixed casing, a deeper split remained: tyre_records used a "<CODE>-ST"
-- convention while the master (vehicle_fleet) and accidents/inspections used plain
-- site names, so one physical site was spread across several codes. This adds a
-- confirmed alias map (site_aliases) and folds it into the normalize_site() trigger
-- so every write converges to one canonical code and future imports self-correct.
--
-- ONLY high-confidence same-site groups are merged. Gate/plateau granularity that
-- the master deliberately keeps distinct is PRESERVED and NOT merged:
--   DIRIYAH-ST vs DIRIYAH-G1 / DIRIYAH-G2
--   QIDDIYA-ST vs QIDDIYA-UPPER PLATEAU / QIDDIYA-LOWER PLATEAU
--   RIY-MET-ST vs METRO   (vehicle_fleet lists both as separate sites)
--
-- Canonical names follow the master (vehicle_fleet) as the source of truth.

CREATE TABLE IF NOT EXISTS public.site_aliases (
  alias      text PRIMARY KEY,   -- casing-normalized (UPPER, trimmed, single-spaced)
  canonical  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_aliases_read ON public.site_aliases;
CREATE POLICY site_aliases_read ON public.site_aliases FOR SELECT TO authenticated USING (true);

INSERT INTO public.site_aliases (alias, canonical) VALUES
  ('NHC-ST',    'NHC'),
  ('REDSEA-ST', 'RED SEA'),
  ('REDSEA',    'RED SEA'),
  ('KSP_TP-ST', 'KSP-TP'),
  ('DHABAN-ST', 'DHAHBAN'),
  ('AMALA-ST',  'AMAALA'),
  ('AMALA',     'AMAALA')
ON CONFLICT (alias) DO UPDATE SET canonical = EXCLUDED.canonical;

-- normalize_site now: casing-normalize, then map through site_aliases.
-- SECURITY DEFINER so the lookup always succeeds regardless of the writer's grants.
CREATE OR REPLACE FUNCTION public.normalize_site()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE canon text;
BEGIN
  IF NEW.site IS NOT NULL THEN
    NEW.site := upper(regexp_replace(btrim(NEW.site), '\s+', ' ', 'g'));
    SELECT sa.canonical INTO canon FROM public.site_aliases sa WHERE sa.alias = NEW.site;
    IF canon IS NOT NULL THEN NEW.site := canon; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill all 24 site-normalized tables through the alias map (idempotent).
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'accidents','alerts','budgets','corrective_actions','customers','drivers',
    'fleet_master','gate_passes','goods_receipts','incident_reports','inspections',
    'purchase_orders','rca_records','requisitions','stock','stock_movements',
    'stock_records','suppliers','tyre_records','tyre_rotations','tyre_service_events',
    'vehicle_fleet','warranty_claims','work_orders'
  ];
BEGIN
  ALTER TABLE public.inspections DISABLE TRIGGER trg_lock_inspection_content;
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'UPDATE public.%I t SET site = sa.canonical FROM public.site_aliases sa WHERE t.site = sa.alias',
      tbl);
  END LOOP;
  ALTER TABLE public.inspections ENABLE TRIGGER trg_lock_inspection_content;
END $$;
