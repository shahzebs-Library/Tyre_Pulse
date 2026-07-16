-- =============================================================================
-- MIGRATIONS_V253_PM_MODULE.sql
-- Complete Preventive Maintenance (PM) module - deepen pm_programs (V163) into a
-- full time + meter based service scheduler covering ALL asset types (vehicles,
-- generators, plant, machinery, equipment).
--
-- What this does:
--   1a. ALTER pm_programs  - add asset_category, a meter axis (meter_source /
--       meter_interval / last_done_meter / next_due_meter), assigned_to,
--       priority, estimated_cost, task_list. The existing interval_type/
--       interval_value stay unchanged (the TIME axis for days/months).
--   1b. CREATE pm_service_records - the execution / "fixed it" history child
--       table (one row per service performed), org-isolated, elevated writes.
--   1c. CREATE record_pm_service(...) - SECURITY DEFINER RPC that inserts a
--       service record AND atomically advances the parent plan's schedule.
--   1d. Widen work_orders.work_type CHECK to add 'Service' and
--       'Preventive Maintenance' so PM-spawned work orders are typed correctly.
--
-- Blast radius: additive. No existing pm_programs rows/columns dropped; the only
-- destructive-looking step is dropping+re-adding the work_orders work_type CHECK
-- with a strict superset of values (safe). Depends on existing helpers
-- app_current_org(), set_updated_at(), get_my_role().
-- Idempotent: ADD COLUMN IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE.
-- Reversible: see the footer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Deepen pm_programs
-- ---------------------------------------------------------------------------
ALTER TABLE public.pm_programs
  ADD COLUMN IF NOT EXISTS asset_category text,
  ADD COLUMN IF NOT EXISTS meter_source   text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS meter_interval numeric,
  ADD COLUMN IF NOT EXISTS last_done_meter numeric,
  ADD COLUMN IF NOT EXISTS next_due_meter numeric,
  ADD COLUMN IF NOT EXISTS assigned_to    text,
  ADD COLUMN IF NOT EXISTS priority       text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS estimated_cost numeric,
  ADD COLUMN IF NOT EXISTS task_list      jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Controlled vocabularies (idempotent add via DO guards).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pm_programs_asset_category_check') THEN
    ALTER TABLE public.pm_programs ADD CONSTRAINT pm_programs_asset_category_check
      CHECK (asset_category IS NULL OR asset_category IN
        ('vehicle','generator','plant','machinery','equipment','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pm_programs_meter_source_check') THEN
    ALTER TABLE public.pm_programs ADD CONSTRAINT pm_programs_meter_source_check
      CHECK (meter_source IN ('odometer','engine_hours','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pm_programs_priority_check') THEN
    ALTER TABLE public.pm_programs ADD CONSTRAINT pm_programs_priority_check
      CHECK (priority IN ('low','medium','high','critical'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pm_programs_next_due_meter ON public.pm_programs (next_due_meter);
CREATE INDEX IF NOT EXISTS idx_pm_programs_asset_no       ON public.pm_programs (asset_no);

-- ---------------------------------------------------------------------------
-- 1b. Execution / history child table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pm_service_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  pm_program_id    uuid NOT NULL REFERENCES public.pm_programs(id) ON DELETE CASCADE,
  asset_no         text,
  service_date     date NOT NULL DEFAULT current_date,
  meter_reading    numeric,
  meter_type       text NOT NULL DEFAULT 'none'
                     CHECK (meter_type IN ('odometer','engine_hours','none')),
  performed_by     text,
  workshop         text,
  site             text,
  tasks_done       jsonb NOT NULL DEFAULT '[]'::jsonb,
  parts_used       jsonb NOT NULL DEFAULT '[]'::jsonb,
  parts_cost       numeric,
  labour_cost      numeric,
  total_cost       numeric GENERATED ALWAYS AS
                     (COALESCE(parts_cost,0) + COALESCE(labour_cost,0)) STORED,
  findings         text,
  outcome          text NOT NULL DEFAULT 'completed'
                     CHECK (outcome IN ('completed','partial','deferred','failed')),
  next_due         date,
  next_due_meter   numeric,
  work_order_no    text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pm_service_records_org       ON public.pm_service_records (organisation_id);
CREATE INDEX IF NOT EXISTS idx_pm_service_records_program   ON public.pm_service_records (pm_program_id);
CREATE INDEX IF NOT EXISTS idx_pm_service_records_asset     ON public.pm_service_records (asset_no);
CREATE INDEX IF NOT EXISTS idx_pm_service_records_date      ON public.pm_service_records (service_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_pm_service_records ON public.pm_service_records;
CREATE TRIGGER set_updated_at_pm_service_records BEFORE UPDATE ON public.pm_service_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pm_service_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pm_service_records_org_isolation ON public.pm_service_records;
CREATE POLICY pm_service_records_org_isolation ON public.pm_service_records
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS pm_service_records_read ON public.pm_service_records;
CREATE POLICY pm_service_records_read ON public.pm_service_records
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS pm_service_records_insert ON public.pm_service_records;
CREATE POLICY pm_service_records_insert ON public.pm_service_records
  FOR INSERT WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS pm_service_records_update ON public.pm_service_records;
CREATE POLICY pm_service_records_update ON public.pm_service_records
  FOR UPDATE USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS pm_service_records_delete ON public.pm_service_records;
CREATE POLICY pm_service_records_delete ON public.pm_service_records
  FOR DELETE USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.pm_service_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pm_service_records TO authenticated;

-- ---------------------------------------------------------------------------
-- 1c. Atomic insert-and-advance RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_pm_service(
  p_program_id    uuid,
  p_service_date  date    DEFAULT current_date,
  p_meter_reading numeric DEFAULT NULL,
  p_performed_by  text    DEFAULT NULL,
  p_workshop      text    DEFAULT NULL,
  p_site          text    DEFAULT NULL,
  p_tasks_done    jsonb   DEFAULT '[]'::jsonb,
  p_parts_used    jsonb   DEFAULT '[]'::jsonb,
  p_parts_cost    numeric DEFAULT NULL,
  p_labour_cost   numeric DEFAULT NULL,
  p_findings      text    DEFAULT NULL,
  p_outcome       text    DEFAULT 'completed',
  p_work_order_no text    DEFAULT NULL,
  p_notes         text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan           public.pm_programs%ROWTYPE;
  v_rec            public.pm_service_records%ROWTYPE;
  v_next_due       date;
  v_next_due_meter numeric;
  v_svc_date       date := COALESCE(p_service_date, current_date);
  v_outcome        text := COALESCE(NULLIF(btrim(p_outcome), ''), 'completed');
BEGIN
  -- Lock the plan row for the duration of the advance (no concurrent double-advance).
  SELECT * INTO v_plan FROM public.pm_programs WHERE id = p_program_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PM program not found';
  END IF;

  -- SECURITY DEFINER bypasses RLS: re-enforce org + role in-body.
  IF v_plan.organisation_id IS DISTINCT FROM public.app_current_org() THEN
    RAISE EXCEPTION 'Not authorized for this organisation';
  END IF;
  IF public.get_my_role() NOT IN ('Admin','Manager','Director') THEN
    RAISE EXCEPTION 'Not authorized to record a service';
  END IF;

  IF v_outcome NOT IN ('completed','partial','deferred','failed') THEN
    RAISE EXCEPTION 'Invalid outcome: %', v_outcome;
  END IF;

  -- Date axis advance (only for the time interval tokens days / months).
  v_next_due := v_plan.next_due;
  IF v_plan.interval_value IS NOT NULL AND v_plan.interval_value > 0 THEN
    IF v_plan.interval_type = 'days' THEN
      v_next_due := v_svc_date + make_interval(days => v_plan.interval_value::int);
    ELSIF v_plan.interval_type = 'months' THEN
      v_next_due := v_svc_date + make_interval(months => v_plan.interval_value::int);
    END IF;
  END IF;

  -- Meter axis advance (odometer / engine_hours). Monotonic guard.
  v_next_due_meter := v_plan.next_due_meter;
  IF v_plan.meter_source <> 'none'
     AND v_plan.meter_interval IS NOT NULL AND v_plan.meter_interval > 0
     AND p_meter_reading IS NOT NULL THEN
    IF v_plan.last_done_meter IS NOT NULL AND p_meter_reading < v_plan.last_done_meter THEN
      RAISE EXCEPTION 'Meter reading % is below the last recorded reading %',
        p_meter_reading, v_plan.last_done_meter;
    END IF;
    v_next_due_meter := p_meter_reading + v_plan.meter_interval;
  END IF;

  -- Insert the service (history) record with the computed snapshot.
  INSERT INTO public.pm_service_records (
    organisation_id, country, pm_program_id, asset_no, service_date,
    meter_reading, meter_type, performed_by, workshop, site,
    tasks_done, parts_used, parts_cost, labour_cost, findings, outcome,
    next_due, next_due_meter, work_order_no, notes
  ) VALUES (
    v_plan.organisation_id, v_plan.country, v_plan.id, v_plan.asset_no, v_svc_date,
    p_meter_reading, v_plan.meter_source, p_performed_by, p_workshop, COALESCE(p_site, v_plan.site),
    COALESCE(p_tasks_done, '[]'::jsonb), COALESCE(p_parts_used, '[]'::jsonb),
    p_parts_cost, p_labour_cost, p_findings, v_outcome,
    v_next_due, v_next_due_meter, p_work_order_no, p_notes
  ) RETURNING * INTO v_rec;

  -- Advance the plan schedule.
  UPDATE public.pm_programs SET
    last_done       = v_svc_date,
    last_done_meter = COALESCE(p_meter_reading, last_done_meter),
    next_due        = v_next_due,
    next_due_meter  = v_next_due_meter,
    updated_at      = now()
  WHERE id = p_program_id
  RETURNING * INTO v_plan;

  RETURN json_build_object('record', row_to_json(v_rec), 'program', row_to_json(v_plan));
END;
$function$;

REVOKE ALL ON FUNCTION public.record_pm_service(uuid,date,numeric,text,text,text,jsonb,jsonb,numeric,numeric,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pm_service(uuid,date,numeric,text,text,text,jsonb,jsonb,numeric,numeric,text,text,text,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1d. Widen work_orders.work_type to allow PM-spawned jobs
-- ---------------------------------------------------------------------------
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.work_orders'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%work_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.work_orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_work_type_check
  CHECK (work_type IN (
    'Tyre Change','Inspection','Repair','Rotation','Balancing','Alignment',
    'Retread','Puncture Repair','Pressure Check','Emergency','Other',
    'Service','Preventive Maintenance'
  ));

-- =============================================================================
-- Reversal (manual):
--   DROP FUNCTION IF EXISTS public.record_pm_service(uuid,date,numeric,text,text,text,jsonb,jsonb,numeric,numeric,text,text,text,text);
--   DROP TABLE IF EXISTS public.pm_service_records;
--   ALTER TABLE public.pm_programs
--     DROP COLUMN IF EXISTS asset_category, DROP COLUMN IF EXISTS meter_source,
--     DROP COLUMN IF EXISTS meter_interval, DROP COLUMN IF EXISTS last_done_meter,
--     DROP COLUMN IF EXISTS next_due_meter, DROP COLUMN IF EXISTS assigned_to,
--     DROP COLUMN IF EXISTS priority, DROP COLUMN IF EXISTS estimated_cost,
--     DROP COLUMN IF EXISTS task_list;
--   (work_orders CHECK: re-add the original 11-value constraint.)
-- =============================================================================
