-- ============================================================================
-- DRIVER CHARGE CASES (2026-11-26)
-- STATUS: AUTHORED, NOT APPLIED. Do not apply without the owner's explicit yes.
--
-- Why: a driver may complain to the labour ministry about a deduction he did
-- not authorise. Every amount the company recovers from a driver must be
-- traceable to (a) a written basis and evidence, (b) a server-stamped notice,
-- (c) the driver's signed written consent OR a witnessed refusal plus an
-- independent review and an appeal window, (d) two different reviewers
-- (supervisor, then finance), (e) a schedule that never takes more than the
-- configured share of the monthly wage, and (f) an appeal decided by a third
-- person. Nothing is ever deleted or silently edited after the driver is
-- notified: a wrong charge is reversed with a reason and reissued.
--
-- This EXTENDS the traffic-fine engine (driver_workspace_command and its
-- idempotency ledger, driver_workspace_events, driver_workspace_access). It is
-- not a second workflow system. A traffic fine can be recovered from the driver
-- by opening a charge whose source is that fine.
--
-- Also in this file:
--   * accident liability approval moves into approve_accident_liability()
--     (approver and time stamped on the server, approval immutable, audited);
--     payer = driver_recovery opens the linked driver charge automatically.
--   * driver_expenses: only the owner may edit a pending claim; approval is a
--     server-stamped RPC and nobody approves their own claim.
--
--   * an administrator can reopen an approved liability decision with an
--     audited reason; the charge it opened is reversed, never deleted.
--
-- KSA (2026-11-26, owner): charges on drivers in Saudi Arabia follow the Saudi
-- Labour Law (Royal Decree M/51): Art 91 damage or loss caused by the worker
-- may be deducted without written consent, at most 5 days' wage a month, and the
-- worker may object within 15 working days; Art 92 every other deduction,
-- including a government traffic fine recovered from the driver (a debt, not an
-- employer penalty under Art 70/71), needs written consent; Art 93 all
-- deductions together at most half the wage. NOTE: the 50% check only counts
-- deductions recorded through this system; payroll deductions made elsewhere
-- (loans, housing, GOSI) are not known here and finance must allow for them.
-- UAE and Egypt keep the configurable cap and window until legally confirmed.
-- This is an implementation of the owner's reading, not legal advice.
-- Damage charges need at least one photo before the driver is notified; the
-- driver signs a statement in English, Arabic or Urdu, stored verbatim.
--
-- Review fixes (2026-11-26): monthly cap is per driver per month across all
-- charges; a refusal needs the named witness to confirm with their own login;
-- issuer, notifier and witness cannot approve at any stage; linked records
-- must be in the driver's scope and name this driver; a charged traffic fine
-- is locked against its own payment step; currency must match the country.
--
-- All touched tables had 0 rows live at authoring time: no data migration.
-- Contract: docs/document-specs/driver-charge-contract.md
-- ============================================================================

-- Settings live in system_config, never hard-coded in code paths.
DO $settings$
BEGIN
  IF to_regclass('public.system_config') IS NOT NULL THEN
    INSERT INTO public.system_config(key,value,description,category) VALUES
      ('driver_charge_instalment_cap_pct','20','Highest share (percent) of the monthly wage that one driver charge instalment may deduct.','driver_charges'),
      ('driver_charge_appeal_window_days','7','Days a driver has to appeal a charge he did not accept before a deduction can be scheduled.','driver_charges')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $settings$;

CREATE TABLE public.driver_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  charge_no text NOT NULL,
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  vehicle_id uuid REFERENCES public.vehicle_fleet(id),
  country text NOT NULL,
  site text NOT NULL,
  category text NOT NULL CHECK (category IN ('traffic_fine','accident_damage','tyre_damage','missing_item','handover_damage','other')),
  source_type text NOT NULL CHECK (source_type IN ('accident','handover_report','inspection','checklist_submission','tyre_record','driver_fine','none')),
  source_id uuid,
  source_summary jsonb NOT NULL DEFAULT '{}',
  source_link_unverified boolean NOT NULL DEFAULT false,
  incident_at timestamptz,
  basis text NOT NULL CHECK (length(btrim(basis)) BETWEEN 10 AND 4000),
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount::text NOT IN ('NaN','Infinity','-Infinity')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','notified','accepted','disputed','refused',
    'supervisor_approved','finance_approved','under_appeal','scheduled','deducted','waived','cancelled_wrongly_issued')),
  driver_response text CHECK (driver_response IN ('accepted','disputed','refused')),
  response_explanation text,
  acknowledged_at timestamptz,
  notified_at timestamptz,
  notified_by uuid REFERENCES public.profiles(id),
  deducted_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (deducted_amount >= 0 AND deducted_amount <= amount),
  schedule_monthly_wage numeric(14,2),
  schedule_cap_pct numeric(5,2),
  schedule_cap_amount numeric(14,2),
  scheduled_by uuid REFERENCES public.profiles(id),
  scheduled_at timestamptz,
  schedule_wage_currency text CHECK (schedule_wage_currency IS NULL OR schedule_wage_currency = currency),
  -- Which deduction rule set the schedule was checked against (see driver_charge_country_rule).
  schedule_rule text CHECK (schedule_rule IN ('ksa_labour_law','company_setting')),
  refusal_witness_id uuid REFERENCES public.profiles(id),
  refusal_recorded_by uuid REFERENCES public.profiles(id),
  refusal_recorded_at timestamptz,
  -- When the driver's objection window closes. Stamped once at finance
  -- approval (country rule + holiday calendar of that moment), never recomputed.
  objection_deadline timestamptz,
  reversal_code text CHECK (reversal_code IN ('wrong_driver','duplicate','wrong_amount','wrong_vehicle','misused','other')),
  close_reason text,
  supersedes_charge_id uuid REFERENCES public.driver_charges(id) DEFERRABLE INITIALLY DEFERRED,
  superseded_by_charge_id uuid REFERENCES public.driver_charges(id) DEFERRABLE INITIALLY DEFERRED,
  version integer NOT NULL DEFAULT 1,
  issued_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, charge_no),
  CHECK ((source_type = 'none') = (source_id IS NULL))
);
-- Duplicate guard: one live charge per source record per driver.
CREATE UNIQUE INDEX driver_charges_one_live_per_source
  ON public.driver_charges(organisation_id, source_type, source_id, driver_id)
  WHERE source_id IS NOT NULL AND status <> 'cancelled_wrongly_issued';
CREATE INDEX driver_charges_driver ON public.driver_charges(driver_id, created_at DESC, id);
CREATE INDEX driver_charges_queue ON public.driver_charges(organisation_id, status, created_at, id);

CREATE TABLE public.driver_charge_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.driver_charges(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('notice','photo','document','record','statement','other')),
  ref text NOT NULL CHECK (length(btrim(ref)) BETWEEN 1 AND 500),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  added_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_charge_evidence_case ON public.driver_charge_evidence(charge_id, created_at, id);

CREATE TABLE public.driver_charge_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.driver_charges(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('driver_acceptance','driver_dispute','refusal_witness')),
  signer_id uuid REFERENCES public.profiles(id),
  signer_name text NOT NULL CHECK (length(btrim(signer_name)) BETWEEN 2 AND 160),
  statement_version text NOT NULL,
  statement_language text NOT NULL DEFAULT 'en' CHECK (statement_language IN ('en','ar','ur')),
  statement_text text NOT NULL,
  signature text NOT NULL CHECK (length(signature) BETWEEN 100 AND 500000),
  charge_version integer NOT NULL,
  charge_snapshot jsonb NOT NULL,
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_charge_signatures_case ON public.driver_charge_signatures(charge_id, signed_at, id);

CREATE TABLE public.driver_charge_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.driver_charges(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('supervisor','finance','appeal','waiver','reversal','deduction','schedule')),
  decision text NOT NULL CHECK (decision IN ('approve','return','upheld','allowed','waive','reverse','deducted','scheduled')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  decided_by uuid NOT NULL REFERENCES public.profiles(id),
  charge_version integer NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_charge_decisions_case ON public.driver_charge_decisions(charge_id, created_at, id);

CREATE TABLE public.driver_charge_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL UNIQUE REFERENCES public.driver_charges(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 4000),
  prior_status text NOT NULL,
  filed_by uuid NOT NULL REFERENCES public.profiles(id),
  filed_at timestamptz NOT NULL DEFAULT now(),
  outcome text CHECK (outcome IN ('upheld','allowed')),
  decision_reason text,
  decided_by uuid REFERENCES public.profiles(id),
  decided_at timestamptz
);

CREATE TABLE public.driver_charge_instalments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.driver_charges(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 60),
  due_month date NOT NULL CHECK (due_month = date_trunc('month', due_month)::date),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','deducted','cancelled')),
  payroll_reference text,
  deducted_by uuid REFERENCES public.profiles(id),
  deducted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (charge_id, seq)
);

ALTER TABLE public.driver_workspace_events ADD COLUMN charge_id uuid REFERENCES public.driver_charges(id);
CREATE INDEX driver_events_charge ON public.driver_workspace_events(charge_id, created_at, id) WHERE charge_id IS NOT NULL;

-- A traffic fine recovered from the driver's wages is linked to that charge so
-- the fine's own payment step cannot also record the same money.
ALTER TABLE public.driver_fines ADD COLUMN recovery_charge_id uuid REFERENCES public.driver_charges(id);
CREATE FUNCTION private.driver_fine_recovery_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF coalesce(current_setting('tyrepulse.charge_recovery', true),'') = 'on' THEN RETURN NEW; END IF;
  IF NEW.recovery_charge_id IS DISTINCT FROM OLD.recovery_charge_id THEN
    RAISE EXCEPTION 'The recovery link is set only by the driver charge workflow' USING ERRCODE='42501';
  END IF;
  IF OLD.recovery_charge_id IS NOT NULL AND (NEW.paid_amount, NEW.status) IS DISTINCT FROM (OLD.paid_amount, OLD.status) THEN
    RAISE EXCEPTION 'This fine is being recovered through a driver charge. Close or reverse that charge first.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.driver_fine_recovery_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER driver_fine_recovery_guard BEFORE UPDATE ON public.driver_fines FOR EACH ROW EXECUTE FUNCTION private.driver_fine_recovery_guard();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['driver_charges','driver_charge_evidence','driver_charge_signatures','driver_charge_decisions','driver_charge_appeals','driver_charge_instalments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY driver_charge_read ON public.%I FOR SELECT TO authenticated USING (organisation_id=public.app_current_org() AND private.driver_workspace_access(driver_id)<>''none'')',t);
  END LOOP;
END $$;
-- Signature images are personal data: no direct table read at all. They are
-- returned only by driver_charge_detail(), which omits them for viewers.
DROP POLICY driver_charge_read ON public.driver_charge_signatures;
REVOKE SELECT ON public.driver_charge_signatures FROM authenticated;
-- The wage behind a deduction schedule is personal pay data: no direct column
-- read. driver_charge_detail() returns it only to the driver, staff and finance.
DO $wage$ DECLARE cols text; BEGIN
  SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) INTO cols FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'driver_charges' AND column_name NOT IN ('schedule_monthly_wage','schedule_cap_amount');
  EXECUTE 'REVOKE SELECT ON public.driver_charges FROM authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.driver_charges TO authenticated', cols);
END $wage$;

-- ── Photo privacy ────────────────────────────────────────────────────────────
-- Charge photos are uploaded to tyre-photos under modules/driver-charge/. The
-- bucket's tyre_photos_read policy lets any active member of the organisation
-- read modules/*; for these objects that is too wide. This RESTRICTIVE policy
-- (ANDed with every permissive read policy) narrows them to: the uploader, a
-- super admin, an organisation admin, or anyone whose driver-workspace access
-- reaches the driver of a charge that lists the photo (the driver himself,
-- the issuer or supervisor in scope, finance). Other paths are unaffected.
CREATE FUNCTION private.driver_charge_photo_readable(p_name text, p_owner_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF p_owner_id IS NOT NULL AND p_owner_id = auth.uid()::text THEN RETURN true; END IF;
  IF coalesce(public.is_super_admin(), false) THEN RETURN true; END IF;
  RETURN EXISTS(SELECT 1 FROM public.driver_charge_evidence e
    WHERE e.ref = 'tp-storage://tyre-photos/' || p_name AND e.organisation_id = public.app_current_org()
      AND (coalesce(public.app_is_org_admin(), false) OR private.driver_workspace_access(e.driver_id) <> 'none'));
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_photo_readable(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.driver_charge_photo_readable(text,text) TO authenticated;
CREATE POLICY driver_charge_photos_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'tyre-photos' OR name NOT LIKE 'modules/driver-charge/%'
    OR private.driver_charge_photo_readable(name, owner_id));

-- ── Append-only and post-notification immutability (defence in depth: the
--    tables carry SELECT grants only, so these guard definer-function bugs). ──
CREATE FUNCTION private.driver_charge_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'Charge records are append-only' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_append_only() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER driver_charge_evidence_append_only BEFORE UPDATE OR DELETE ON public.driver_charge_evidence FOR EACH ROW EXECUTE FUNCTION private.driver_charge_append_only();
CREATE TRIGGER driver_charge_signatures_append_only BEFORE UPDATE OR DELETE ON public.driver_charge_signatures FOR EACH ROW EXECUTE FUNCTION private.driver_charge_append_only();
CREATE TRIGGER driver_charge_decisions_append_only BEFORE UPDATE OR DELETE ON public.driver_charge_decisions FOR EACH ROW EXECUTE FUNCTION private.driver_charge_append_only();

CREATE FUNCTION private.driver_charge_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Charges are never deleted. Reverse it with a reason.' USING ERRCODE='42501'; END IF;
  IF OLD.notified_at IS NOT NULL AND (
       NEW.organisation_id, NEW.driver_id, NEW.charge_no, NEW.category, NEW.source_type, NEW.source_id, NEW.source_link_unverified,
       NEW.vehicle_id, NEW.incident_at, NEW.basis, NEW.amount, NEW.currency, NEW.issued_by, NEW.notified_at, NEW.notified_by)
     IS DISTINCT FROM (
       OLD.organisation_id, OLD.driver_id, OLD.charge_no, OLD.category, OLD.source_type, OLD.source_id, OLD.source_link_unverified,
       OLD.vehicle_id, OLD.incident_at, OLD.basis, OLD.amount, OLD.currency, OLD.issued_by, OLD.notified_at, OLD.notified_by) THEN
    RAISE EXCEPTION 'A notified charge cannot be edited. Reverse it and reissue with a reason.' USING ERRCODE='42501';
  END IF;
  IF OLD.status IN ('deducted','waived','cancelled_wrongly_issued') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'This charge is closed.' USING ERRCODE='42501';
  END IF;
  IF OLD.objection_deadline IS NOT NULL AND NEW.objection_deadline IS NOT NULL AND NEW.objection_deadline IS DISTINCT FROM OLD.objection_deadline THEN
    RAISE EXCEPTION 'The objection deadline was fixed at finance approval and cannot be moved.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER driver_charges_guard BEFORE UPDATE OR DELETE ON public.driver_charges FOR EACH ROW EXECUTE FUNCTION private.driver_charge_guard();

CREATE FUNCTION private.driver_charge_appeal_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.outcome IS NOT NULL
     OR (NEW.charge_id, NEW.driver_id, NEW.organisation_id, NEW.reason, NEW.prior_status, NEW.filed_by, NEW.filed_at)
        IS DISTINCT FROM (OLD.charge_id, OLD.driver_id, OLD.organisation_id, OLD.reason, OLD.prior_status, OLD.filed_by, OLD.filed_at) THEN
    RAISE EXCEPTION 'An appeal is recorded once and decided once.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_appeal_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER driver_charge_appeals_guard BEFORE UPDATE OR DELETE ON public.driver_charge_appeals FOR EACH ROW EXECUTE FUNCTION private.driver_charge_appeal_guard();

CREATE FUNCTION private.driver_charge_instalment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'scheduled'
     OR (NEW.charge_id, NEW.seq, NEW.due_month, NEW.amount, NEW.currency) IS DISTINCT FROM (OLD.charge_id, OLD.seq, OLD.due_month, OLD.amount, OLD.currency) THEN
    RAISE EXCEPTION 'A recorded instalment cannot be changed.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_instalment_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER driver_charge_instalments_guard BEFORE UPDATE OR DELETE ON public.driver_charge_instalments FOR EACH ROW EXECUTE FUNCTION private.driver_charge_instalment_guard();

-- Separation of duties is enforced on the decision ledger itself, so no code
-- path can record a second approval by the same person.
CREATE FUNCTION private.driver_charge_decision_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.driver_charges%ROWTYPE; conflicted boolean;
BEGIN
  SELECT * INTO c FROM public.driver_charges WHERE id = NEW.charge_id;
  -- The issuer, the person who served the notice and the refusal witness are
  -- parties to the facts and may not approve at any stage.
  conflicted := NEW.decided_by = c.issued_by OR NEW.decided_by IS NOT DISTINCT FROM c.notified_by
    OR NEW.decided_by IS NOT DISTINCT FROM c.refusal_witness_id OR NEW.decided_by IS NOT DISTINCT FROM c.refusal_recorded_by
    OR EXISTS(SELECT 1 FROM public.driver_charge_signatures s WHERE s.charge_id = NEW.charge_id AND s.kind = 'refusal_witness' AND s.signer_id = NEW.decided_by);
  IF NEW.stage = 'supervisor' AND NEW.decision = 'approve' AND conflicted THEN
    RAISE EXCEPTION 'The person who issued, served or witnessed the charge cannot also approve it' USING ERRCODE='42501';
  END IF;
  IF NEW.stage = 'finance' AND NEW.decision = 'approve' AND (conflicted OR EXISTS(
       SELECT 1 FROM public.driver_charge_decisions x WHERE x.charge_id = NEW.charge_id AND x.stage = 'supervisor' AND x.decision = 'approve' AND x.decided_by = NEW.decided_by)) THEN
    RAISE EXCEPTION 'A different finance reviewer is required' USING ERRCODE='42501';
  END IF;
  IF NEW.stage = 'appeal' AND (conflicted
       OR EXISTS(SELECT 1 FROM public.driver_charge_decisions x WHERE x.charge_id = NEW.charge_id AND x.stage IN ('supervisor','finance') AND x.decision = 'approve' AND x.decided_by = NEW.decided_by)
       OR EXISTS(SELECT 1 FROM public.driver_account_links l WHERE l.driver_id = c.driver_id AND l.user_id = NEW.decided_by)) THEN
    RAISE EXCEPTION 'An appeal must be decided by a third person who did not issue, serve, witness or approve the charge' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_decision_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER driver_charge_decisions_duty BEFORE INSERT ON public.driver_charge_decisions FOR EACH ROW EXECUTE FUNCTION private.driver_charge_decision_guard();

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE FUNCTION private.driver_charge_setting(p_key text, p_default numeric)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE raw text;
BEGIN
  IF to_regclass('public.system_config') IS NULL THEN RETURN p_default; END IF;
  EXECUTE 'SELECT btrim(coalesce(value_text, value::text), '' "'') FROM public.system_config WHERE key=$1' INTO raw USING p_key;
  RETURN coalesce(nullif(raw,'')::numeric, p_default);
EXCEPTION WHEN others THEN RETURN p_default;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_setting(text,numeric) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.driver_charge_finite(p numeric)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p IS NOT NULL AND p::text NOT IN ('NaN','Infinity','-Infinity')
$$;
REVOKE ALL ON FUNCTION private.driver_charge_finite(numeric) FROM PUBLIC,anon,authenticated;

-- Driver-workspace access of ANOTHER account (the named witness). Runs the
-- normal access rules with that account's identity for this call only.
CREATE FUNCTION private.driver_workspace_access_for(p_user uuid, p_driver uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_sub text := current_setting('request.jwt.claim.sub', true); old_claims text := current_setting('request.jwt.claims', true); r text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  r := private.driver_workspace_access(p_driver);
  -- Put back exactly what was there. set_config cannot store SQL NULL (it stores ''),
  -- and auth.uid()/auth.jwt() read '' as no caller, so an unset value stays unset.
  PERFORM set_config('request.jwt.claim.sub', old_sub, true);
  PERFORM set_config('request.jwt.claims', old_claims, true);
  RETURN coalesce(r, 'none');
EXCEPTION WHEN others THEN RETURN 'none';
END $$;
REVOKE ALL ON FUNCTION private.driver_workspace_access_for(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Currency of a country from country_currency. NULL when that table is not
-- installed; '' when installed but the country has no currency configured.
CREATE FUNCTION private.driver_charge_country_currency(p_country text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r text;
BEGIN
  IF to_regclass('public.country_currency') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT upper(btrim(currency)) FROM public.country_currency WHERE upper(btrim(country)) = upper(btrim($1)) LIMIT 1' INTO r USING p_country;
  RETURN coalesce(r, '');
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_country_currency(text) FROM PUBLIC,anon,authenticated;

-- ── Country deduction rules ──────────────────────────────────────────────────
-- KSA: Saudi Labour Law (Royal Decree M/51). Statute, so not a setting:
--   Art 91  damage or loss caused by the worker's fault: may be deducted without
--           written consent, at most 5 days' wage per month; the worker may
--           object within 15 working days.
--   Art 92  any other deduction needs the worker's written consent. A traffic
--           fine issued by the authorities and recovered from the driver is
--           such a deduction (it is not an Art 70/71 employer penalty).
--   Art 93  all deductions together at most half the wage due (only the
--           deductions recorded through this system are counted).
-- A day's wage = monthly wage / 30. Working week Sunday to Thursday (Friday and
-- Saturday off), Asia/Riyadh. Public holidays are not excluded (not modelled).
-- Every other country: the configurable cap and appeal window, marked as
-- needing legal confirmation. Not legal advice.
-- Mirrors: src/lib/driverCharges.js chargeCountryRule() and
-- tyre_pulse_flutter/.../driver_charge.dart driverChargeCountryRule().
-- One spelling per country, used by the rules AND the holiday calendar, so a
-- mistyped or long-form country never falls through to the wrong rule set.
-- Mirrors: chargeCountryKey() in src/lib/driverCharges.js, driverChargeCountryKey() in Dart.
CREATE FUNCTION private.driver_charge_country_key(p_country text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN k IN ('KSA','SA','SAU','SAUDI','SAUDIARABIA','KINGDOMOFSAUDIARABIA') THEN 'KSA'
    WHEN k IN ('UAE','AE','ARE','UNITEDARABEMIRATES','EMIRATES') THEN 'UAE'
    WHEN k IN ('EGYPT','EG','EGY','ARABREPUBLICOFEGYPT') THEN 'EGYPT'
    ELSE nullif(k,'') END
  FROM (SELECT regexp_replace(upper(coalesce(p_country,'')), '[^A-Z]', '', 'g') AS k) x
$$;
REVOKE ALL ON FUNCTION private.driver_charge_country_key(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.driver_charge_country_rule(p_country text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN private.driver_charge_country_key(p_country) = 'KSA'
    THEN jsonb_build_object('rule','ksa_labour_law','statutory',true,'needs_legal_confirmation',false,
      'damage_days',5,'wage_days',30,'total_pct',50,'objection_working_days',15,
      'weekend_isodow',jsonb_build_array(5,6),'timezone','Asia/Riyadh','without_consent',jsonb_build_array('damage'))
    ELSE jsonb_build_object('rule','company_setting','statutory',false,'needs_legal_confirmation',true) END
$$;
REVOKE ALL ON FUNCTION private.driver_charge_country_rule(text) FROM PUBLIC,anon,authenticated;

-- Which deduction bucket a category falls in: damage or loss (Art 91), or a
-- deduction that always needs written consent (Art 92: traffic fine, other).
CREATE FUNCTION private.driver_charge_bucket(p_category text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p_category IN ('accident_damage','tyre_damage','missing_item','handover_damage') THEN 'damage'
    ELSE 'consent' END
$$;
REVOKE ALL ON FUNCTION private.driver_charge_bucket(text) FROM PUBLIC,anon,authenticated;

-- Physical damage must be shown to the driver: at least one photo before notice.
CREATE FUNCTION private.driver_charge_needs_photo(p_category text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(p_category,'') IN ('accident_damage','tyre_damage','handover_damage')
$$;
REVOKE ALL ON FUNCTION private.driver_charge_needs_photo(text) FROM PUBLIC,anon,authenticated;

-- Public holidays the working-day counter skips, maintained per organisation
-- and country by an administrator (for example Eid holidays in KSA). Seeded
-- empty on purpose: the dates are announced each year.
CREATE TABLE public.driver_charge_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  country text NOT NULL CHECK (length(btrim(country)) BETWEEN 2 AND 60),
  holiday date NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 160),
  created_by uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX driver_charge_holidays_day ON public.driver_charge_holidays(organisation_id, country, holiday);
-- Every change is kept (append-only), and a day in the past can no longer be
-- added, changed or removed: deadlines are stamped at finance approval, and the
-- calendar that produced them must stay as it was.
CREATE TABLE public.driver_charge_holiday_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  holiday_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  before jsonb,
  after jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_charge_holiday_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_charge_holiday_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.driver_charge_holiday_events TO authenticated;
CREATE POLICY driver_charge_holiday_events_read ON public.driver_charge_holiday_events FOR SELECT TO authenticated
  USING (organisation_id = public.app_current_org() AND coalesce(public.app_is_active(), false));
CREATE FUNCTION private.driver_charge_holiday_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.holiday < today THEN
    RAISE EXCEPTION 'A holiday in the past cannot be changed or removed' USING ERRCODE='42501';
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    NEW.country := coalesce(private.driver_charge_country_key(NEW.country), NEW.country);
    IF NEW.holiday < today THEN RAISE EXCEPTION 'A holiday in the past cannot be added' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO public.driver_charge_holiday_events(organisation_id, holiday_id, action, before, after, actor_id)
    VALUES (coalesce(NEW.organisation_id, OLD.organisation_id), coalesce(NEW.id, OLD.id), lower(TG_OP),
      CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END, auth.uid());
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_holiday_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER driver_charge_holidays_guard BEFORE INSERT OR UPDATE OR DELETE ON public.driver_charge_holidays
  FOR EACH ROW EXECUTE FUNCTION private.driver_charge_holiday_guard();
ALTER TABLE public.driver_charge_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_charge_holidays FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_charge_holidays TO authenticated;
CREATE POLICY driver_charge_holidays_read ON public.driver_charge_holidays FOR SELECT TO authenticated
  USING (organisation_id = public.app_current_org() AND coalesce(public.app_is_active(), false));
CREATE POLICY driver_charge_holidays_admin ON public.driver_charge_holidays FOR ALL TO authenticated
  USING (organisation_id = public.app_current_org() AND (coalesce(public.app_is_org_admin(), false) OR coalesce(public.is_super_admin(), false)))
  WITH CHECK (organisation_id = public.app_current_org() AND (coalesce(public.app_is_org_admin(), false) OR coalesce(public.is_super_admin(), false)));

-- End of the p_days-th working day (Sunday to Thursday, not a listed public
-- holiday of p_country in p_org) after the local date of p_from in
-- Asia/Riyadh. The window is open until this moment.
CREATE FUNCTION private.driver_charge_working_deadline(p_from timestamptz, p_days integer, p_country text DEFAULT NULL, p_org uuid DEFAULT NULL)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d date; n integer := 0; guard integer := 0;
BEGIN
  IF p_from IS NULL OR p_days IS NULL OR p_days < 1 THEN RETURN p_from; END IF;
  d := (p_from AT TIME ZONE 'Asia/Riyadh')::date;
  WHILE n < p_days AND guard < 3660 LOOP
    d := d + 1; guard := guard + 1;
    IF extract(isodow FROM d) NOT IN (5,6) AND NOT EXISTS(
         SELECT 1 FROM public.driver_charge_holidays h WHERE h.organisation_id = p_org
           AND h.country = private.driver_charge_country_key(p_country) AND h.holiday = d) THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN (d + 1)::timestamp AT TIME ZONE 'Asia/Riyadh';
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_working_deadline(timestamptz,integer,text,uuid) FROM PUBLIC,anon,authenticated;

-- When the driver's objection window would close if finance approved at
-- p_approved. Used ONCE, at finance approval, to stamp
-- driver_charges.objection_deadline; reads use the stamped value.
CREATE FUNCTION private.driver_charge_compute_deadline(p_charge uuid, p_approved timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c_country text; c_org uuid; r jsonb;
BEGIN
  SELECT country, organisation_id INTO c_country, c_org FROM public.driver_charges WHERE id = p_charge;
  IF NOT FOUND OR p_approved IS NULL THEN RETURN NULL; END IF;
  r := private.driver_charge_country_rule(c_country);
  IF coalesce((r->>'statutory')::boolean, false) THEN
    RETURN private.driver_charge_working_deadline(p_approved, (r->>'objection_working_days')::integer, c_country, c_org);
  END IF;
  RETURN p_approved + make_interval(days => private.driver_charge_setting('driver_charge_appeal_window_days', 7)::integer);
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_compute_deadline(uuid,timestamptz) FROM PUBLIC,anon,authenticated;

-- The stamped deadline (NULL until finance has approved).
CREATE FUNCTION private.driver_charge_objection_deadline(p_charge uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT objection_deadline FROM public.driver_charges WHERE id = p_charge
$$;
REVOKE ALL ON FUNCTION private.driver_charge_objection_deadline(uuid) FROM PUBLIC,anon,authenticated;

-- Why a deduction cannot be scheduled yet for a charge the driver did not
-- accept, or NULL when it can. The ONE place this rule lives: charge_schedule
-- raises its message, driver_charge_actions hides the action, and
-- driver_charge_detail returns it so the screens show the reason instead of a
-- button the server would refuse. {code, article, until, message}.
CREATE FUNCTION private.driver_charge_schedule_block(p_charge uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.driver_charges%ROWTYPE; r jsonb; deadline timestamptz; last_day text;
BEGIN
  SELECT * INTO c FROM public.driver_charges WHERE id = p_charge;
  IF NOT FOUND OR c.driver_response IS NOT DISTINCT FROM 'accepted' THEN RETURN NULL; END IF;
  r := private.driver_charge_country_rule(c.country);
  deadline := private.driver_charge_objection_deadline(c.id);
  last_day := to_char((deadline - interval '1 second') AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD');
  IF coalesce((r->>'statutory')::boolean, false) THEN
    IF private.driver_charge_bucket(c.category) <> 'damage' THEN
      RETURN jsonb_build_object('code','consent_required','article','92','until',NULL,
        'message','Saudi Labour Law (Article 92): this charge can be deducted only with the driver''s written consent. It cannot be scheduled because the driver did not accept it.');
    END IF;
    IF EXISTS(SELECT 1 FROM public.driver_charge_appeals a WHERE a.charge_id = c.id AND a.outcome IS NULL) THEN
      RETURN jsonb_build_object('code','open_objection','article','91','until',NULL,'message','Saudi Labour Law (Article 91): the driver has an open objection. Decide it first.');
    END IF;
    IF deadline IS NULL OR deadline > now() THEN
      RETURN jsonb_build_object('code','window_open','article','91','until',last_day,
        'message', format('Saudi Labour Law (Article 91): the driver has 15 working days to object. A deduction can be scheduled after %s.', coalesce(last_day, 'the finance approval')));
    END IF;
    RETURN NULL;
  END IF;
  IF EXISTS(SELECT 1 FROM public.driver_charge_appeals a WHERE a.charge_id = c.id AND a.outcome = 'upheld') THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.driver_charge_appeals a WHERE a.charge_id = c.id AND a.outcome IS NULL) THEN
    RETURN jsonb_build_object('code','open_objection','article',NULL,'until',NULL,'message','The driver has an open appeal. Decide it first.');
  END IF;
  IF deadline IS NULL OR deadline > now() THEN
    RETURN jsonb_build_object('code','window_open','article',NULL,'until',last_day,
      'message', format('The driver did not consent. A deduction can be scheduled only after the appeal period ends (%s) or an appeal is decided.', coalesce(last_day, 'after the finance approval')));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_schedule_block(uuid) FROM PUBLIC,anon,authenticated;

-- One evidence item. A photo must be a private storage reference in one of the
-- photo buckets (never a public URL), so the driver and the PDF can show it.
CREATE FUNCTION private.driver_charge_valid_evidence(p_kind text, p_ref text, p_label text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT coalesce(p_kind,'') IN ('notice','photo','document','record','statement','other')
    AND length(btrim(coalesce(p_ref,''))) BETWEEN 1 AND 500 AND length(btrim(coalesce(p_label,''))) BETWEEN 1 AND 160
    AND (p_kind <> 'photo' OR (btrim(p_ref) ~ '^tp-storage://(tyre-photos|accident-photos|inspection-photos)/[^[:space:][:cntrl:]]+$'
      AND position('..' IN p_ref) = 0))
$$;
REVOKE ALL ON FUNCTION private.driver_charge_valid_evidence(text,text,text) FROM PUBLIC,anon,authenticated;

-- A charge photo (tyre-photos/modules/driver-charge/...) may be attached only by
-- the person who uploaded it, and only to one charge (a reissue may carry the
-- photos of the charge it replaces). This stops one charge reading another
-- charge's photos by naming their path. Raises; returns nothing.
CREATE FUNCTION private.driver_charge_claim_photo(p_charge uuid, p_ref text, p_actor uuid, p_supersedes uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text := btrim(coalesce(p_ref,'')); obj text;
BEGIN
  IF r NOT LIKE 'tp-storage://tyre-photos/modules/driver-charge/%' THEN RETURN; END IF;
  obj := substr(r, length('tp-storage://tyre-photos/') + 1);
  IF EXISTS(SELECT 1 FROM public.driver_charge_evidence e WHERE e.ref = r AND e.charge_id <> p_charge
      AND e.charge_id IS DISTINCT FROM p_supersedes) THEN
    RAISE EXCEPTION 'This photo is already attached to another charge. Upload it again for this charge.' USING ERRCODE='22023';
  END IF;
  IF p_supersedes IS NOT NULL AND EXISTS(SELECT 1 FROM public.driver_charge_evidence e WHERE e.ref = r AND e.charge_id = p_supersedes) THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'tyre-photos' AND o.name = obj AND o.owner_id = p_actor::text) THEN
    RAISE EXCEPTION 'Attach only photos you uploaded for this charge.' USING ERRCODE='42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_claim_photo(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;

-- The exact words a signer agreed to, in English, Arabic or Urdu. Stored
-- verbatim with every signature. Single source of the wording:
-- docs/document-specs/driver-charge-statements.json (a test checks this text,
-- the web locales and the Flutter ARB files are identical). Plain words for
-- drivers who read little. The Arabic and Urdu need owner and legal approval.
-- deduction-consent-v3 carries {amount}: the server fills it with the charge
-- total (driver_charge_amount_text) before showing or storing the words.
CREATE FUNCTION private.driver_charge_amount_text(p_amount numeric, p_currency text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p_amount IS NULL THEN NULL
    ELSE btrim(to_char(p_amount, 'FM999,999,999,990.00')) || ' ' || coalesce(nullif(btrim(p_currency),''), '') END
$$;
REVOKE ALL ON FUNCTION private.driver_charge_amount_text(numeric,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.driver_charge_statement(p_version text, p_language text DEFAULT 'en')
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE p_version || ':' || coalesce(nullif(p_language,''),'en')
    WHEN 'deduction-consent-v3:en' THEN 'I am the driver named on this paper. I have seen this charge: the reason, the evidence and the photos. I agree that I must pay {amount} in total for this charge. I agree that the company may take this amount from my salary in monthly parts. The amount taken in any one month will never be more than the legal monthly limit, and I will be shown the amount for each month before it is taken. This agreement is only for this charge. I can still object within the time written on this paper.'
    WHEN 'deduction-consent-v3:ar' THEN 'أنا السائق المذكور اسمه في هذه الورقة. اطلعت على هذه المطالبة: السبب والأدلة والصور. أوافق على أنني ملزم بدفع مبلغ {amount} إجمالا عن هذه المطالبة. وأوافق على أن تخصم الشركة هذا المبلغ من راتبي على أجزاء شهرية. لن يزيد جزء أي شهر عن الحد الشهري الذي يسمح به النظام، وسيعرض علي مبلغ كل شهر قبل خصمه. هذه الموافقة تخص هذه المطالبة فقط. ويحق لي الاعتراض خلال المدة المكتوبة في هذه الورقة.'
    WHEN 'deduction-consent-v3:ur' THEN 'میں اس کاغذ پر لکھا ہوا ڈرائیور ہوں۔ میں نے یہ چارج دیکھ لیا ہے: اس کی وجہ، ثبوت اور تصویریں۔ میں مانتا ہوں کہ اس چارج کے لیے مجھے کل {amount} ادا کرنے ہیں۔ میں اجازت دیتا ہوں کہ کمپنی یہ رقم میری تنخواہ سے ماہانہ قسطوں میں کاٹے۔ کسی بھی مہینے کی قسط قانون کی ماہانہ حد سے زیادہ نہیں ہوگی، اور ہر مہینے کی رقم کاٹنے سے پہلے مجھے دکھائی جائے گی۔ یہ اجازت صرف اسی چارج کے لیے ہے۔ میں اس کاغذ پر لکھی مدت کے اندر اب بھی اعتراض کر سکتا ہوں۔'
    WHEN 'receipt-dispute-v2:en' THEN 'I am the driver named on this paper. I have received this charge and I have seen the reason, the evidence and the photos. I do not agree with this charge, for the reasons I wrote. My signature only shows that I received this paper. It does not mean that I agree. I can object within the time written on this paper.'
    WHEN 'receipt-dispute-v2:ar' THEN 'أنا السائق المذكور اسمه في هذه الورقة. استلمت هذه المطالبة واطلعت على السبب والأدلة والصور. لا أوافق على هذه المطالبة للأسباب التي كتبتها. توقيعي يثبت فقط أنني استلمت هذه الورقة، ولا يعني أنني موافق. ويحق لي الاعتراض خلال المدة المكتوبة في هذه الورقة.'
    WHEN 'receipt-dispute-v2:ur' THEN 'میں اس کاغذ پر لکھا ہوا ڈرائیور ہوں۔ مجھے یہ چارج مل گیا ہے اور میں نے اس کی وجہ، ثبوت اور تصویریں دیکھ لی ہیں۔ میں ان وجوہات کی وجہ سے جو میں نے لکھی ہیں، اس چارج سے متفق نہیں ہوں۔ میرے دستخط صرف یہ بتاتے ہیں کہ مجھے یہ کاغذ مل گیا ہے۔ اس کا مطلب یہ نہیں کہ میں متفق ہوں۔ میں اس کاغذ پر لکھی مدت کے اندر اعتراض کر سکتا ہوں۔'
    WHEN 'refusal-witness-v2:en' THEN 'I saw this charge paper given to the driver named on it. The driver did not want to sign it or answer. The date and time of this record are set by the system.'
    WHEN 'refusal-witness-v2:ar' THEN 'رأيت أن ورقة هذه المطالبة سلمت إلى السائق المذكور اسمه فيها، وأن السائق رفض التوقيع عليها أو الرد. تاريخ ووقت هذا السجل يحددهما النظام.'
    WHEN 'refusal-witness-v2:ur' THEN 'میں نے دیکھا کہ اس چارج کا کاغذ اس پر لکھے ہوئے ڈرائیور کو دیا گیا۔ ڈرائیور نے اس پر دستخط کرنے یا جواب دینے سے انکار کیا۔ اس ریکارڈ کی تاریخ اور وقت سسٹم طے کرتا ہے۔'
  END
$$;
REVOKE ALL ON FUNCTION private.driver_charge_statement(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.driver_charge_statement(text,text) TO authenticated;

-- Every statement version in every language, for the detail payload.
CREATE FUNCTION private.driver_charge_statements(p_amount_text text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_object_agg(v, jsonb_build_object(
    'en', replace(private.driver_charge_statement(v,'en'), '{amount}', coalesce(p_amount_text,'{amount}')),
    'ar', replace(private.driver_charge_statement(v,'ar'), '{amount}', coalesce(p_amount_text,'{amount}')),
    'ur', replace(private.driver_charge_statement(v,'ur'), '{amount}', coalesce(p_amount_text,'{amount}'))))
  FROM unnest(ARRAY['deduction-consent-v3','receipt-dispute-v2','refusal-witness-v2']) v
$$;
REVOKE ALL ON FUNCTION private.driver_charge_statements(text) FROM PUBLIC,anon,authenticated;

-- A signature must carry real content: a PNG of at least about 1 KB, or an
-- SVG with at least 10 drawn points. An empty or near-empty pad is refused.
CREATE FUNCTION private.driver_charge_valid_signature(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT (coalesce(p,'') ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$' AND length(p) >= 1400)
    OR (coalesce(p,'') ~ '^<svg xmlns="http://www.w3.org/2000/svg" width="[0-9]+" height="[0-9]+" viewBox="[0-9 .]+">(<path d="[ML0-9 .-]+" fill="none" stroke="#[a-fA-F0-9]{6}" stroke-width="[0-9.]+" stroke-linecap="round" stroke-linejoin="round"/>)+</svg>$'
        AND length(p) - length(replace(p, 'L', '')) >= 9)
$$;
REVOKE ALL ON FUNCTION private.driver_charge_valid_signature(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.driver_charge_source_table(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE p_type WHEN 'accident' THEN 'accidents' WHEN 'handover_report' THEN 'handover_reports'
    WHEN 'inspection' THEN 'inspections' WHEN 'checklist_submission' THEN 'checklist_submissions'
    WHEN 'tyre_record' THEN 'tyre_records' WHEN 'driver_fine' THEN 'driver_fines' END
$$;
REVOKE ALL ON FUNCTION private.driver_charge_source_table(text) FROM PUBLIC,anon,authenticated;

-- Verify the linked record exists in this organisation and return a limited
-- summary. Never exposes the source row's internal fields.
CREATE FUNCTION private.driver_charge_source_summary(p_org uuid, p_type text, p_id uuid, p_driver uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tbl text := private.driver_charge_source_table(p_type); r jsonb; d public.drivers%ROWTYPE;
  ids text[]; names text[]; src_country text; src_site text;
BEGIN
  IF tbl IS NULL OR p_id IS NULL OR to_regclass('public.'||tbl) IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO d FROM public.drivers WHERE id = p_driver AND organisation_id = p_org;
  IF NOT FOUND THEN RETURN NULL; END IF;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.id=$1', tbl) INTO r USING p_id;
  IF r IS NULL OR (r->>'organisation_id') IS DISTINCT FROM p_org::text THEN RETURN NULL; END IF;
  -- The record must be in the driver's country and inside the caller's own
  -- driver-workspace scope (country and site), not just the same tenant.
  src_country := nullif(btrim(r->>'country'), ''); src_site := nullif(btrim(r->>'site'), '');
  IF src_country IS NOT NULL AND lower(src_country) <> lower(btrim(coalesce(d.country,''))) THEN RETURN NULL; END IF;
  IF NOT private.driver_workspace_scope(p_org, coalesce(src_country, d.country), coalesce(src_site, d.site)) THEN RETURN NULL; END IF;
  -- Where the record names a driver it must be this driver.
  IF p_type = 'driver_fine' AND (r->>'driver_id') IS DISTINCT FROM p_driver::text THEN RETURN NULL; END IF;
  ids := CASE WHEN p_type IN ('driver_fine','tyre_record') THEN ARRAY[r->>'driver_id'] ELSE ARRAY[]::text[] END;
  names := CASE p_type WHEN 'accident' THEN ARRAY[r->>'driver_name'] WHEN 'tyre_record' THEN ARRAY[r->>'driver_name']
    WHEN 'handover_report' THEN ARRAY[r->>'from_driver', r->>'to_driver'] ELSE ARRAY[]::text[] END;
  SELECT coalesce(array_agg(x) FILTER (WHERE nullif(btrim(x),'') IS NOT NULL), '{}') INTO ids FROM unnest(ids) x;
  SELECT coalesce(array_agg(lower(btrim(x))) FILTER (WHERE nullif(btrim(x),'') IS NOT NULL), '{}') INTO names FROM unnest(names) x;
  IF p_type = 'driver_fine' THEN ids := ARRAY[p_driver::text]; END IF;
  IF (cardinality(ids) > 0 OR cardinality(names) > 0)
     AND NOT (p_driver::text = ANY(ids) OR lower(btrim(coalesce(d.driver_name,''))) = ANY(names) OR lower(btrim(coalesce(d.driver_id,''))) = ANY(names)) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('type', p_type, 'id', p_id,
    'label', nullif(concat_ws(' · ', r->>'reference_no', r->>'notice_reference', r->>'title', r->>'template_name', r->>'serial_no', r->>'asset_no',
      left(coalesce(r->>'incident_date', r->>'incident_at', r->>'inspection_date', r->>'submitted_at', r->>'created_at'), 10)), ''),
    'country', r->>'country', 'site', r->>'site', 'amount', r->>'amount', 'currency', r->>'currency',
    'driver_recorded', cardinality(ids) > 0 OR cardinality(names) > 0);
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_source_summary(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Insert one charge (status issued). Used by the command and by the accident
-- liability approval, so both open charges by the same rules.
CREATE FUNCTION private.driver_charge_issue(p_org uuid, p_actor uuid, p_driver_id uuid, p jsonb, p_supersedes uuid)
RETURNS public.driver_charges LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.drivers%ROWTYPE; v public.vehicle_fleet%ROWTYPE; c public.driver_charges%ROWTYPE; f public.driver_fines%ROWTYPE;
  expected_currency text; src_type text := coalesce(nullif(p->>'source_type',''),'none'); src_id uuid := nullif(p->>'source_id','')::uuid;
  summary jsonb := '{}'; item jsonb; unverified boolean := false; yr text := to_char(now(),'YYYY'); next_no integer;
BEGIN
  SELECT * INTO d FROM public.drivers WHERE id = p_driver_id AND organisation_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce(p->>'category','') NOT IN ('traffic_fine','accident_damage','tyre_damage','missing_item','handover_damage','other') THEN RAISE EXCEPTION 'Choose a charge category' USING ERRCODE='22023'; END IF;
  IF src_type NOT IN ('accident','handover_report','inspection','checklist_submission','tyre_record','driver_fine','none') THEN RAISE EXCEPTION 'Unsupported source record' USING ERRCODE='22023'; END IF;
  IF p->>'category' = 'traffic_fine' AND src_type <> 'driver_fine' THEN RAISE EXCEPTION 'A traffic fine charge must link the traffic fine record' USING ERRCODE='22023'; END IF;
  IF (src_type = 'none') <> (src_id IS NULL) THEN RAISE EXCEPTION 'Choose the linked record' USING ERRCODE='22023'; END IF;
  IF src_id IS NOT NULL THEN
    summary := private.driver_charge_source_summary(p_org, src_type, src_id, d.id);
    IF summary IS NULL THEN RAISE EXCEPTION 'Linked record unavailable' USING ERRCODE='42501'; END IF;
    -- A record that names no driver cannot prove the link; the issuer must say
    -- so explicitly and the notice states it.
    IF NOT coalesce((summary->>'driver_recorded')::boolean, false) THEN
      IF (p->>'link_unverified') IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'This record does not name a driver. Confirm that you are linking it to this driver without proof from the record.' USING ERRCODE='22023';
      END IF;
      unverified := true;
    END IF;
    IF EXISTS(SELECT 1 FROM public.driver_charges x WHERE x.organisation_id = p_org AND x.source_type = src_type AND x.source_id = src_id AND x.driver_id = d.id AND x.status <> 'cancelled_wrongly_issued') THEN
      RAISE EXCEPTION 'This record already has a live charge for this driver' USING ERRCODE='23505';
    END IF;
  END IF;
  IF length(btrim(coalesce(p->>'basis',''))) NOT BETWEEN 10 AND 4000 THEN RAISE EXCEPTION 'Write the basis for the charge (at least 10 characters)' USING ERRCODE='22023'; END IF;
  IF NOT private.driver_charge_finite(nullif(p->>'amount','')::numeric) OR (p->>'amount')::numeric <= 0 OR (p->>'amount')::numeric > 1000000 THEN RAISE EXCEPTION 'Amount must be greater than zero and at most 1,000,000' USING ERRCODE='22023'; END IF;
  IF upper(coalesce(p->>'currency','')) !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Currency code required' USING ERRCODE='22023'; END IF;
  expected_currency := private.driver_charge_country_currency(d.country);
  IF expected_currency = '' THEN RAISE EXCEPTION 'No currency is configured for the driver country %', d.country USING ERRCODE='22023'; END IF;
  IF expected_currency IS NOT NULL AND upper(p->>'currency') <> expected_currency THEN
    RAISE EXCEPTION 'The charge must be in % (the currency of %)', expected_currency, d.country USING ERRCODE='22023';
  END IF;
  IF src_type = 'driver_fine' THEN
    SELECT * INTO f FROM public.driver_fines WHERE id = src_id AND organisation_id = p_org FOR UPDATE;
    IF NOT FOUND OR f.status <> 'open' OR f.response_status <> 'approved' OR f.review_stage <> 'complete' OR f.paid_amount <> 0 OR f.recovery_charge_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only an approved traffic fine with no payment recorded can be recovered from the driver' USING ERRCODE='22023';
    END IF;
    IF upper(p->>'currency') <> f.currency OR (p->>'amount')::numeric > f.amount THEN
      RAISE EXCEPTION 'The charge must be in the fine currency and not more than the fine amount' USING ERRCODE='22023';
    END IF;
  END IF;
  IF nullif(p->>'incident_at','') IS NOT NULL AND (p->>'incident_at')::timestamptz > now() THEN RAISE EXCEPTION 'Incident cannot be in the future' USING ERRCODE='22023'; END IF;
  IF nullif(p->>'vehicle_id','') IS NOT NULL THEN
    SELECT * INTO v FROM public.vehicle_fleet WHERE id = (p->>'vehicle_id')::uuid;
    IF NOT FOUND OR v.organisation_id IS DISTINCT FROM p_org OR v.country IS DISTINCT FROM d.country THEN RAISE EXCEPTION 'Vehicle outside scope' USING ERRCODE='42501'; END IF;
  END IF;
  IF jsonb_typeof(coalesce(p->'evidence','[]')) <> 'array' OR jsonb_array_length(coalesce(p->'evidence','[]')) > 50 THEN RAISE EXCEPTION 'Invalid evidence list' USING ERRCODE='22023'; END IF;
  IF src_id IS NULL AND jsonb_array_length(coalesce(p->'evidence','[]')) = 0 THEN RAISE EXCEPTION 'Link a source record or list at least one piece of evidence' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('driver_charge_no'||p_org::text||yr,0));
  SELECT coalesce(max(nullif(split_part(charge_no,'-',3),'')::integer),0)+1 INTO next_no FROM public.driver_charges WHERE organisation_id = p_org AND charge_no LIKE 'DC-'||yr||'-%';
  INSERT INTO public.driver_charges(organisation_id, charge_no, driver_id, vehicle_id, country, site, category, source_type, source_id, source_summary, source_link_unverified,
      incident_at, basis, amount, currency, issued_by, supersedes_charge_id)
    VALUES (p_org, 'DC-'||yr||'-'||lpad(next_no::text,5,'0'), d.id, v.id, d.country, d.site, p->>'category', src_type, src_id, coalesce(summary,'{}'), unverified,
      nullif(p->>'incident_at','')::timestamptz, btrim(p->>'basis'), round((p->>'amount')::numeric,2), upper(p->>'currency'), p_actor, p_supersedes)
    RETURNING * INTO c;
  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p->'evidence','[]')) LOOP
    IF NOT private.driver_charge_valid_evidence(item->>'kind', item->>'ref', item->>'label') THEN
      RAISE EXCEPTION 'Each evidence item needs a type, reference and label. A photo must be an uploaded photo.' USING ERRCODE='22023';
    END IF;
    PERFORM private.driver_charge_claim_photo(c.id, item->>'ref', p_actor, p_supersedes);
    INSERT INTO public.driver_charge_evidence(charge_id, driver_id, organisation_id, kind, ref, label, added_by)
      VALUES (c.id, d.id, p_org, item->>'kind', btrim(item->>'ref'), btrim(item->>'label'), p_actor);
  END LOOP;
  IF src_type = 'driver_fine' THEN
    PERFORM set_config('tyrepulse.charge_recovery','on',true);
    UPDATE public.driver_fines SET recovery_charge_id = c.id, version = version + 1, updated_at = now() WHERE id = src_id;
    PERFORM set_config('tyrepulse.charge_recovery','off',true);
  END IF;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_issue(uuid,uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.driver_charge_snapshot(p_charge uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT to_jsonb(c) || jsonb_build_object('evidence', (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id),'[]') FROM public.driver_charge_evidence e WHERE e.charge_id = c.id))
  FROM public.driver_charges c WHERE c.id = p_charge
$$;
REVOKE ALL ON FUNCTION private.driver_charge_snapshot(uuid) FROM PUBLIC,anon,authenticated;

-- When a charge that recovers a traffic fine closes, record what was actually
-- deducted against the fine and release the link unless the fine is settled.
CREATE FUNCTION private.driver_charge_close_fine(p_charge uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.driver_charges%ROWTYPE; f public.driver_fines%ROWTYPE; paid numeric;
BEGIN
  SELECT * INTO c FROM public.driver_charges WHERE id = p_charge;
  IF NOT FOUND OR c.source_type <> 'driver_fine' THEN RETURN; END IF;
  SELECT * INTO f FROM public.driver_fines WHERE id = c.source_id AND recovery_charge_id = c.id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  paid := least(f.amount, f.paid_amount + c.deducted_amount);
  PERFORM set_config('tyrepulse.charge_recovery','on',true);
  UPDATE public.driver_fines SET paid_amount = paid,
    status = CASE WHEN paid >= amount THEN 'settled' ELSE status END,
    recovery_charge_id = CASE WHEN paid >= amount THEN c.id ELSE NULL END,
    version = version + 1, updated_at = now() WHERE id = f.id;
  PERFORM set_config('tyrepulse.charge_recovery','off',true);
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_close_fine(uuid) FROM PUBLIC,anon,authenticated;

-- ── The command (routed from public.driver_workspace_command) ────────────────
CREATE FUNCTION private.driver_charge_command(p_action text, p_payload jsonb, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid := auth.uid(); org uuid := public.app_current_org();
  d public.drivers%ROWTYPE; c public.driver_charges%ROWTYPE; nc public.driver_charges%ROWTYPE;
  ap public.driver_charge_appeals%ROWTYPE; inst public.driver_charge_instalments%ROWTYPE;
  previous private.driver_workspace_requests%ROWTYPE; answer jsonb;
  detail jsonb := p_payload - 'signature' - 'witness_signature'; access_mode text; is_driver boolean;
  is_staff boolean; is_finance boolean; is_manager boolean; choice text; target_driver uuid; v_reason text := btrim(coalesce(p_payload->>'reason',''));
  stmt_version text; stmt text; cap_pct numeric; cap_amount numeric; wage numeric; total numeric := 0; item jsonb; seq integer := 0; last_month date;
  appeal_days numeric; approved_at timestamptz; approved_at_cap numeric; reissue jsonb; notify_driver boolean := false; signer text;
  lang text; block jsonb; crule jsonb; statutory boolean := false; bucket text; deadline timestamptz; breach text; damage_cap numeric; total_cap numeric;
BEGIN
  IF actor IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text) > 600000 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
  SELECT * INTO previous FROM private.driver_workspace_requests WHERE actor_id = actor AND request_id = p_request_id;
  IF FOUND THEN
    IF previous.action <> p_action OR previous.payload <> p_payload THEN RAISE EXCEPTION 'Request already used' USING ERRCODE='22023'; END IF;
    IF private.driver_workspace_access((previous.result->>'driver_id')::uuid) = 'none' THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
    RETURN previous.result;
  END IF;

  SELECT * INTO d FROM public.drivers WHERE id = nullif(p_payload->>'driver_id','')::uuid AND organisation_id = org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver unavailable' USING ERRCODE='42501'; END IF;
  access_mode := private.driver_workspace_access(d.id);
  IF access_mode = 'none' THEN RAISE EXCEPTION 'Driver unavailable' USING ERRCODE='42501'; END IF;
  is_driver := EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id = d.id AND user_id = actor);
  is_staff := access_mode IN ('manager','supervisor') AND NOT is_driver;
  -- NOTE every choice below is coalesced: NULL NOT IN (...) is NULL and would pass.
  is_manager := access_mode = 'manager' AND NOT is_driver;
  is_finance := private.driver_workspace_is_finance_reviewer() AND NOT is_driver;

  IF p_action <> 'charge_issue' THEN
    SELECT * INTO c FROM public.driver_charges WHERE id = nullif(p_payload->>'charge_id','')::uuid AND driver_id = d.id AND organisation_id = org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Charge unavailable' USING ERRCODE='42501'; END IF;
    IF c.version IS DISTINCT FROM (p_payload->>'version')::integer THEN RAISE EXCEPTION 'Charge changed; refresh and review again' USING ERRCODE='PT409'; END IF;
  END IF;

  CASE p_action
  WHEN 'charge_issue' THEN
    IF NOT is_staff THEN RAISE EXCEPTION 'Only an assigned supervisor or a manager may issue a charge' USING ERRCODE='42501'; END IF;
    c := private.driver_charge_issue(org, actor, d.id, p_payload, NULL);

  WHEN 'charge_correct' THEN
    IF NOT (is_manager OR (is_staff AND c.issued_by = actor)) THEN RAISE EXCEPTION 'Correction not permitted' USING ERRCODE='42501'; END IF;
    IF c.status <> 'issued' OR c.notified_at IS NOT NULL THEN RAISE EXCEPTION 'A notified charge cannot be edited. Reverse it and reissue with a reason.' USING ERRCODE='42501'; END IF;
    IF length(v_reason) < 3 THEN RAISE EXCEPTION 'Correction reason required' USING ERRCODE='22023'; END IF;
    IF p_payload ? 'amount' AND (NOT private.driver_charge_finite(nullif(p_payload->>'amount','')::numeric) OR (p_payload->>'amount')::numeric <= 0 OR (p_payload->>'amount')::numeric > 1000000) THEN RAISE EXCEPTION 'Amount must be greater than zero and at most 1,000,000' USING ERRCODE='22023'; END IF;
    IF p_payload ? 'amount' AND c.source_type = 'driver_fine' AND (p_payload->>'amount')::numeric > (SELECT f.amount FROM public.driver_fines f WHERE f.id = c.source_id) THEN RAISE EXCEPTION 'The charge cannot be more than the fine amount' USING ERRCODE='22023'; END IF;
    IF nullif(p_payload->>'incident_at','') IS NOT NULL AND (p_payload->>'incident_at')::timestamptz > now() THEN RAISE EXCEPTION 'Incident cannot be in the future' USING ERRCODE='22023'; END IF;
    IF p_payload ? 'basis' AND length(btrim(coalesce(p_payload->>'basis',''))) NOT BETWEEN 10 AND 4000 THEN RAISE EXCEPTION 'Write the basis for the charge' USING ERRCODE='22023'; END IF;
    IF nullif(p_payload->>'vehicle_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vehicle_fleet v WHERE v.id = (p_payload->>'vehicle_id')::uuid AND v.organisation_id = org AND v.country IS NOT DISTINCT FROM d.country) THEN RAISE EXCEPTION 'Vehicle outside scope' USING ERRCODE='42501'; END IF;
    detail := jsonb_build_object('reason', v_reason, 'before', private.driver_charge_snapshot(c.id), 'changes', p_payload - 'reason' - 'driver_id' - 'charge_id' - 'version');
    UPDATE public.driver_charges SET
      amount = CASE WHEN p_payload ? 'amount' THEN round((p_payload->>'amount')::numeric,2) ELSE amount END,
      basis = CASE WHEN p_payload ? 'basis' THEN btrim(p_payload->>'basis') ELSE basis END,
      vehicle_id = CASE WHEN p_payload ? 'vehicle_id' THEN nullif(p_payload->>'vehicle_id','')::uuid ELSE vehicle_id END,
      incident_at = CASE WHEN p_payload ? 'incident_at' THEN nullif(p_payload->>'incident_at','')::timestamptz ELSE incident_at END,
      version = version + 1, updated_at = now() WHERE id = c.id;

  WHEN 'charge_attach_evidence' THEN
    IF NOT (is_manager OR (is_staff AND c.issued_by = actor)) OR c.status <> 'issued' THEN RAISE EXCEPTION 'Evidence can be added only before the driver is notified' USING ERRCODE='42501'; END IF;
    IF NOT private.driver_charge_valid_evidence(p_payload->>'kind', p_payload->>'ref', p_payload->>'label') THEN RAISE EXCEPTION 'Evidence needs a type, reference and label. A photo must be an uploaded photo.' USING ERRCODE='22023'; END IF;
    PERFORM private.driver_charge_claim_photo(c.id, p_payload->>'ref', actor, c.supersedes_charge_id);
    INSERT INTO public.driver_charge_evidence(charge_id, driver_id, organisation_id, kind, ref, label, added_by)
      VALUES (c.id, d.id, org, p_payload->>'kind', btrim(p_payload->>'ref'), btrim(p_payload->>'label'), actor);
    UPDATE public.driver_charges SET version = version + 1, updated_at = now() WHERE id = c.id;

  WHEN 'charge_notify' THEN
    IF NOT is_staff THEN RAISE EXCEPTION 'Only staff may notify the driver' USING ERRCODE='42501'; END IF;
    IF c.status <> 'issued' THEN RAISE EXCEPTION 'Charge already notified' USING ERRCODE='PT409'; END IF;
    -- The driver must see the damage before he is asked to accept or dispute it.
    IF private.driver_charge_needs_photo(c.category) AND NOT EXISTS(SELECT 1 FROM public.driver_charge_evidence e WHERE e.charge_id = c.id AND e.kind = 'photo') THEN
      RAISE EXCEPTION 'Add at least one photo of the damage before sending this charge to the driver' USING ERRCODE='22023';
    END IF;
    UPDATE public.driver_charges SET status = 'notified', notified_at = now(), notified_by = actor, version = version + 1, updated_at = now() WHERE id = c.id;
    notify_driver := true;

  WHEN 'charge_respond' THEN
    IF NOT is_driver THEN RAISE EXCEPTION 'Only the linked driver may respond' USING ERRCODE='42501'; END IF;
    IF c.status <> 'notified' THEN RAISE EXCEPTION 'This charge is not waiting for your response' USING ERRCODE='PT409'; END IF;
    choice := coalesce(p_payload->>'response','');
    IF choice NOT IN ('accept','dispute') THEN RAISE EXCEPTION 'Choose accept or dispute' USING ERRCODE='22023'; END IF;
    stmt_version := CASE choice WHEN 'accept' THEN 'deduction-consent-v3' ELSE 'receipt-dispute-v2' END;
    IF p_payload->>'statement_version' IS DISTINCT FROM stmt_version OR (p_payload->>'acknowledged')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Read and confirm the statement before signing' USING ERRCODE='22023'; END IF;
    lang := coalesce(nullif(p_payload->>'statement_language',''),'en');
    IF lang NOT IN ('en','ar','ur') THEN RAISE EXCEPTION 'Choose the statement language: English, Arabic or Urdu' USING ERRCODE='22023'; END IF;
    IF choice = 'dispute' AND length(btrim(coalesce(p_payload->>'explanation',''))) NOT BETWEEN 10 AND 4000 THEN RAISE EXCEPTION 'Explain why you dispute the charge' USING ERRCODE='22023'; END IF;
    IF NOT private.driver_charge_valid_signature(p_payload->>'signature') THEN RAISE EXCEPTION 'Valid signature required' USING ERRCODE='22023'; END IF;
    stmt := replace(private.driver_charge_statement(stmt_version, lang), '{amount}', private.driver_charge_amount_text(c.amount, c.currency));
    SELECT full_name INTO signer FROM public.profiles WHERE id = actor;
    INSERT INTO public.driver_charge_signatures(charge_id, driver_id, organisation_id, kind, signer_id, signer_name, statement_version, statement_language, statement_text, signature, charge_version, charge_snapshot, recorded_by)
      VALUES (c.id, d.id, org, CASE choice WHEN 'accept' THEN 'driver_acceptance' ELSE 'driver_dispute' END, actor, coalesce(nullif(btrim(signer),''), d.driver_name),
        stmt_version, lang, stmt, p_payload->>'signature', c.version, private.driver_charge_snapshot(c.id), actor);
    UPDATE public.driver_charges SET status = CASE choice WHEN 'accept' THEN 'accepted' ELSE 'disputed' END,
      driver_response = CASE choice WHEN 'accept' THEN 'accepted' ELSE 'disputed' END,
      response_explanation = nullif(btrim(coalesce(p_payload->>'explanation','')),''), acknowledged_at = now(),
      refusal_witness_id = NULL, refusal_recorded_by = NULL, refusal_recorded_at = NULL,
      version = version + 1, updated_at = now() WHERE id = c.id;

  WHEN 'charge_record_refusal' THEN
    -- Step 1 of 2: staff record that the driver refused and name the witness
    -- account. Nothing counts as refused until that witness confirms it.
    IF NOT is_staff THEN RAISE EXCEPTION 'Only staff may record a refusal' USING ERRCODE='42501'; END IF;
    IF c.status <> 'notified' THEN RAISE EXCEPTION 'This charge is not waiting for the driver' USING ERRCODE='PT409'; END IF;
    -- While unconfirmed, the refusal may be recorded again (for example with a different witness).
    target_driver := nullif(p_payload->>'witness_user_id','')::uuid;
    IF target_driver IS NULL THEN RAISE EXCEPTION 'Choose the witness. The witness confirms the refusal from their own account.' USING ERRCODE='22023'; END IF;
    IF target_driver = actor OR target_driver = c.issued_by OR target_driver IS NOT DISTINCT FROM c.notified_by
       OR EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id = d.id AND user_id = target_driver)
       OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id = target_driver AND p.org_id = org AND coalesce(p.approved,false) AND NOT coalesce(p.locked,false)) THEN
      RAISE EXCEPTION 'The witness must be another active person: not you, the issuer, the person who served the notice or the driver' USING ERRCODE='22023';
    END IF;
    IF private.driver_workspace_access_for(target_driver, d.id) IN ('none','driver') THEN
      RAISE EXCEPTION 'The witness must have access to this driver''s workspace' USING ERRCODE='22023';
    END IF;
    IF length(v_reason) < 3 THEN RAISE EXCEPTION 'Describe how the notice was presented' USING ERRCODE='22023'; END IF;
    UPDATE public.driver_charges SET refusal_witness_id = target_driver, refusal_recorded_by = actor, refusal_recorded_at = now(),
      response_explanation = v_reason, version = version + 1, updated_at = now() WHERE id = c.id;
    INSERT INTO public.notifications(user_id, type, title, body, entity_type, entity_id)
      VALUES (target_driver, 'driver_workspace', 'Confirm a refusal you witnessed', 'Open the driver workspace to confirm and sign the refusal you witnessed.', 'driver_workspace', d.id::text);
    target_driver := NULL;

  WHEN 'charge_witness_confirm' THEN
    -- Step 2 of 2: only the named witness, signing in as themselves.
    IF c.status <> 'notified' OR c.refusal_witness_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'You are not the witness named for this refusal' USING ERRCODE='42501'; END IF;
    IF is_driver OR actor = c.issued_by OR actor IS NOT DISTINCT FROM c.notified_by OR actor IS NOT DISTINCT FROM c.refusal_recorded_by THEN RAISE EXCEPTION 'The witness must be an independent person' USING ERRCODE='42501'; END IF;
    IF p_payload->>'statement_version' IS DISTINCT FROM 'refusal-witness-v2' OR (p_payload->>'acknowledged')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Read and confirm the statement before signing' USING ERRCODE='22023'; END IF;
    lang := coalesce(nullif(p_payload->>'statement_language',''),'en');
    IF lang NOT IN ('en','ar','ur') THEN RAISE EXCEPTION 'Choose the statement language: English, Arabic or Urdu' USING ERRCODE='22023'; END IF;
    IF NOT private.driver_charge_valid_signature(p_payload->>'signature') THEN RAISE EXCEPTION 'Valid signature required' USING ERRCODE='22023'; END IF;
    SELECT full_name INTO signer FROM public.profiles WHERE id = actor;
    INSERT INTO public.driver_charge_signatures(charge_id, driver_id, organisation_id, kind, signer_id, signer_name, statement_version, statement_language, statement_text, signature, charge_version, charge_snapshot, recorded_by)
      VALUES (c.id, d.id, org, 'refusal_witness', actor, coalesce(nullif(btrim(signer),''), 'Witness'), 'refusal-witness-v2', lang,
        private.driver_charge_statement('refusal-witness-v2', lang), p_payload->>'signature', c.version, private.driver_charge_snapshot(c.id), actor);
    UPDATE public.driver_charges SET status = 'refused', driver_response = 'refused', version = version + 1, updated_at = now() WHERE id = c.id;

  WHEN 'charge_supervisor_review' THEN
    IF NOT is_staff THEN RAISE EXCEPTION 'Supervisor review not permitted' USING ERRCODE='42501'; END IF;
    IF c.status NOT IN ('accepted','disputed','refused') THEN RAISE EXCEPTION 'Charge is not waiting for supervisor review' USING ERRCODE='PT409'; END IF;
    IF length(v_reason) < 3 THEN RAISE EXCEPTION 'Review reason required' USING ERRCODE='22023'; END IF;
    choice := coalesce(p_payload->>'decision','');
    IF choice NOT IN ('approve','return') THEN RAISE EXCEPTION 'Invalid review decision' USING ERRCODE='22023'; END IF;
    INSERT INTO public.driver_charge_decisions(charge_id, driver_id, organisation_id, stage, decision, reason, decided_by, charge_version, details)
      VALUES (c.id, d.id, org, 'supervisor', choice, v_reason, actor, c.version, detail);
    UPDATE public.driver_charges SET status = CASE choice WHEN 'approve' THEN 'supervisor_approved' ELSE 'notified' END,
      driver_response = CASE choice WHEN 'return' THEN NULL ELSE driver_response END,
      refusal_witness_id = CASE choice WHEN 'return' THEN NULL ELSE refusal_witness_id END,
      refusal_recorded_by = CASE choice WHEN 'return' THEN NULL ELSE refusal_recorded_by END,
      refusal_recorded_at = CASE choice WHEN 'return' THEN NULL ELSE refusal_recorded_at END,
      version = version + 1, updated_at = now() WHERE id = c.id;
    notify_driver := choice = 'return';

  WHEN 'charge_finance_review' THEN
    IF NOT is_finance THEN RAISE EXCEPTION 'Finance review not permitted' USING ERRCODE='42501'; END IF;
    IF c.status <> 'supervisor_approved' THEN RAISE EXCEPTION 'Charge is not waiting for finance' USING ERRCODE='PT409'; END IF;
    IF length(v_reason) < 3 THEN RAISE EXCEPTION 'Review reason required' USING ERRCODE='22023'; END IF;
    choice := coalesce(p_payload->>'decision','');
    IF choice NOT IN ('approve','return') THEN RAISE EXCEPTION 'Invalid review decision' USING ERRCODE='22023'; END IF;
    INSERT INTO public.driver_charge_decisions(charge_id, driver_id, organisation_id, stage, decision, reason, decided_by, charge_version, details)
      VALUES (c.id, d.id, org, 'finance', choice, v_reason, actor, c.version, detail);
    UPDATE public.driver_charges SET status = CASE choice WHEN 'approve' THEN 'finance_approved' ELSE driver_response END,
      objection_deadline = CASE choice WHEN 'approve' THEN private.driver_charge_compute_deadline(c.id, now()) ELSE NULL END,
      refusal_witness_id = CASE choice WHEN 'return' THEN NULL ELSE refusal_witness_id END,
      refusal_recorded_by = CASE choice WHEN 'return' THEN NULL ELSE refusal_recorded_by END,
      refusal_recorded_at = CASE choice WHEN 'return' THEN NULL ELSE refusal_recorded_at END,
      version = version + 1, updated_at = now() WHERE id = c.id;
    notify_driver := choice = 'approve';

  WHEN 'charge_schedule' THEN
    IF NOT is_finance THEN RAISE EXCEPTION 'Only finance may schedule a deduction' USING ERRCODE='42501'; END IF;
    IF c.status <> 'finance_approved' THEN RAISE EXCEPTION 'Charge is not approved for deduction' USING ERRCODE='PT409'; END IF;
    crule := private.driver_charge_country_rule(c.country);
    statutory := coalesce((crule->>'statutory')::boolean, false);
    bucket := private.driver_charge_bucket(c.category);
    -- Consent, objection and window rules: driver_charge_schedule_block().
    block := private.driver_charge_schedule_block(c.id);
    IF block IS NOT NULL THEN RAISE EXCEPTION '%', block->>'message' USING ERRCODE='22023'; END IF;
    wage := nullif(p_payload->>'monthly_wage','')::numeric;
    IF NOT private.driver_charge_finite(wage) OR wage <= 0 OR wage > 1000000 THEN RAISE EXCEPTION 'Enter the driver monthly wage (more than 0 and at most 1,000,000)' USING ERRCODE='22023'; END IF;
    IF upper(coalesce(p_payload->>'wage_currency','')) IS DISTINCT FROM c.currency THEN RAISE EXCEPTION 'State the wage in the charge currency (%)', c.currency USING ERRCODE='22023'; END IF;
    IF statutory THEN
      -- One day's wage = monthly wage / 30. Damage 5 days; with consent up to half the wage.
      damage_cap := round(wage * (crule->>'damage_days')::numeric / (crule->>'wage_days')::numeric, 2);
      total_cap := round(wage * (crule->>'total_pct')::numeric / 100, 2);
      cap_amount := CASE bucket WHEN 'damage' THEN damage_cap ELSE total_cap END;
      cap_pct := CASE bucket WHEN 'damage' THEN round((crule->>'damage_days')::numeric * 100 / (crule->>'wage_days')::numeric, 2)
        ELSE (crule->>'total_pct')::numeric END;
    ELSE
      cap_pct := private.driver_charge_setting('driver_charge_instalment_cap_pct', 20);
      IF cap_pct <= 0 OR cap_pct > 100 THEN RAISE EXCEPTION 'Instalment limit setting is invalid' USING ERRCODE='22023'; END IF;
      cap_amount := round(wage * cap_pct / 100, 2);
    END IF;
    IF jsonb_typeof(p_payload->'instalments') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'instalments') NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Add between 1 and 60 instalments' USING ERRCODE='22023'; END IF;
    UPDATE public.driver_charge_instalments SET status = 'cancelled' WHERE charge_id = c.id AND status = 'scheduled';
    seq := coalesce((SELECT max(i.seq) FROM public.driver_charge_instalments i WHERE i.charge_id = c.id), 0);
    FOR item IN SELECT * FROM jsonb_array_elements(p_payload->'instalments') LOOP
      seq := seq + 1;
      IF (item->>'due_month')::date IS NULL OR (item->>'due_month')::date <> date_trunc('month',(item->>'due_month')::date)::date
         OR (item->>'due_month')::date < date_trunc('month', current_date)::date OR (last_month IS NOT NULL AND (item->>'due_month')::date <= last_month) THEN
        RAISE EXCEPTION 'Each instalment month must be the first of a month, from this month on, in order' USING ERRCODE='22023';
      END IF;
      IF NOT private.driver_charge_finite(nullif(item->>'amount','')::numeric) OR (item->>'amount')::numeric <= 0 OR round((item->>'amount')::numeric,2) > cap_amount THEN
        RAISE EXCEPTION 'An instalment exceeds the monthly limit of % %', cap_amount, c.currency USING ERRCODE='22023';
      END IF;
      last_month := (item->>'due_month')::date; total := total + round((item->>'amount')::numeric,2);
      INSERT INTO public.driver_charge_instalments(charge_id, driver_id, organisation_id, seq, due_month, amount, currency)
        VALUES (c.id, d.id, org, seq, last_month, round((item->>'amount')::numeric,2), c.currency);
    END LOOP;
    IF total <> c.amount - c.deducted_amount THEN RAISE EXCEPTION 'Instalments must add up to the outstanding amount of % %', c.amount - c.deducted_amount, c.currency USING ERRCODE='22023'; END IF;
    -- The limit is per driver per month across ALL his charges, not per charge.
    -- The driver row is locked FOR UPDATE above, so two schedules cannot race.
    -- Traffic fines are only recovered from wages through a charge, so they are covered here.
    IF EXISTS(SELECT 1 FROM public.driver_charge_instalments i WHERE i.driver_id = d.id AND i.status <> 'cancelled' AND i.currency <> c.currency
        AND i.due_month IN (SELECT n.due_month FROM public.driver_charge_instalments n WHERE n.charge_id = c.id AND n.status = 'scheduled')) THEN
      RAISE EXCEPTION 'This driver already has deductions in another currency in one of these months' USING ERRCODE='22023';
    END IF;
    -- The month limit uses the LOWEST wage stated for this driver in that month,
    -- so a later schedule with a higher wage cannot raise it.
    IF statutory THEN
      -- KSA: damage and loss within 5 days' wage, everything together within
      -- half the wage, per month across all charges recorded here.
      SELECT q.due_month, q.label, q.total, q.cap INTO last_month, breach, total, approved_at_cap FROM (
        SELECT m.due_month, b.label, b.total, b.cap, b.ord FROM (
          SELECT i.due_month,
            least(wage, coalesce(min(oc.schedule_monthly_wage) FILTER (WHERE oc.id <> c.id), wage)) AS low_wage,
            coalesce(sum(i.amount) FILTER (WHERE private.driver_charge_bucket(oc.category) = 'damage'), 0) AS damage_total,
            sum(i.amount) AS all_total
          FROM public.driver_charge_instalments i JOIN public.driver_charges oc ON oc.id = i.charge_id
          WHERE i.driver_id = d.id AND i.status <> 'cancelled' AND i.currency = c.currency
            AND i.due_month IN (SELECT n.due_month FROM public.driver_charge_instalments n WHERE n.charge_id = c.id AND n.status = 'scheduled')
          GROUP BY i.due_month) m
        CROSS JOIN LATERAL (VALUES
          ('damage and loss deductions (Article 91, 5 days'' wage)', m.damage_total, round(m.low_wage * (crule->>'damage_days')::numeric / (crule->>'wage_days')::numeric, 2), 1),
          ('total deductions (Article 93, half the wage)', m.all_total, round(m.low_wage * (crule->>'total_pct')::numeric / 100, 2), 3)) b(label, total, cap, ord)
        WHERE b.total > b.cap) q
        ORDER BY q.due_month, q.ord LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'In % this driver''s % across all charges would be % %, above the Saudi Labour Law limit of % %', to_char(last_month,'YYYY-MM'), breach, total, c.currency, approved_at_cap, c.currency USING ERRCODE='22023';
      END IF;
    ELSE
    SELECT q.due_month, q.total, q.month_cap INTO last_month, total, approved_at_cap FROM (
      SELECT i.due_month, sum(i.amount) AS total,
        round(least(wage, coalesce(min(oc.schedule_monthly_wage) FILTER (WHERE oc.id <> c.id), wage)) * cap_pct / 100, 2) AS month_cap
      FROM public.driver_charge_instalments i JOIN public.driver_charges oc ON oc.id = i.charge_id
      WHERE i.driver_id = d.id AND i.status <> 'cancelled' AND i.currency = c.currency
        AND i.due_month IN (SELECT n.due_month FROM public.driver_charge_instalments n WHERE n.charge_id = c.id AND n.status = 'scheduled')
      GROUP BY i.due_month) q
      WHERE q.total > q.month_cap ORDER BY q.due_month LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'In % this driver''s deductions across all charges would be % %, above the monthly limit of % %', to_char(last_month,'YYYY-MM'), total, c.currency, approved_at_cap, c.currency USING ERRCODE='22023';
    END IF;
    END IF;
    IF length(v_reason) < 3 THEN v_reason := 'Deduction schedule recorded'; END IF;
    INSERT INTO public.driver_charge_decisions(charge_id, driver_id, organisation_id, stage, decision, reason, decided_by, charge_version, details)
      VALUES (c.id, d.id, org, 'schedule', 'scheduled', v_reason, actor, c.version, jsonb_build_object('cap_pct', cap_pct, 'rule', crule->>'rule', 'bucket', bucket, 'instalments', p_payload->'instalments'));
    detail := detail - 'monthly_wage' - 'wage_currency';
    UPDATE public.driver_charges SET status = 'scheduled', schedule_monthly_wage = wage, schedule_wage_currency = c.currency, schedule_cap_pct = cap_pct, schedule_cap_amount = cap_amount, schedule_rule = crule->>'rule',
      scheduled_by = actor, scheduled_at = now(), version = version + 1, updated_at = now() WHERE id = c.id;
    notify_driver := true;

  WHEN 'charge_record_deduction' THEN
    IF NOT is_finance THEN RAISE EXCEPTION 'Only finance may record a deduction' USING ERRCODE='42501'; END IF;
    IF c.status <> 'scheduled' THEN RAISE EXCEPTION 'Deductions can be recorded only on a scheduled charge with no open appeal' USING ERRCODE='PT409'; END IF;
    SELECT * INTO inst FROM public.driver_charge_instalments WHERE id = nullif(p_payload->>'instalment_id','')::uuid AND charge_id = c.id FOR UPDATE;
    IF NOT FOUND OR inst.status <> 'scheduled' THEN RAISE EXCEPTION 'Instalment unavailable' USING ERRCODE='PT409'; END IF;
    IF inst.due_month > date_trunc('month', current_date)::date THEN RAISE EXCEPTION 'This instalment is not due yet' USING ERRCODE='22023'; END IF;
    IF length(btrim(coalesce(p_payload->>'payroll_reference',''))) < 3 THEN RAISE EXCEPTION 'Payroll reference required' USING ERRCODE='22023'; END IF;
    UPDATE public.driver_charge_instalments SET status = 'deducted', payroll_reference = btrim(p_payload->>'payroll_reference'), deducted_by = actor, deducted_at = now() WHERE id = inst.id;
    INSERT INTO public.driver_charge_decisions(charge_id, driver_id, organisation_id, stage, decision, reason, decided_by, charge_version, details)
      VALUES (c.id, d.id, org, 'deduction', 'deducted', coalesce(nullif(v_reason,''),'Payroll deduction recorded'), actor, c.version,
        jsonb_build_object('instalment_id', inst.id, 'seq', inst.seq, 'amount', inst.amount, 'payroll_reference', btrim(p_payload->>'payroll_reference')));
    UPDATE public.driver_charges SET deducted_amount = deducted_amount + inst.amount,
      status = CASE WHEN deducted_amount + inst.amount >= amount THEN 'deducted' ELSE status END,
      version = version + 1, updated_at = now() WHERE id = c.id;
    IF c.deducted_amount + inst.amount >= c.amount THEN PERFORM private.driver_charge_close_fine(c.id); END IF;

  WHEN 'charge_waive' THEN
    IF NOT (is_manager OR is_finance) THEN RAISE EXCEPTION 'Waiver not permitted' USING ERRCODE='42501'; END IF;
    IF c.status IN ('deducted','waived','cancelled_wrongly_issued') THEN RAISE EXCEPTION 'This charge is closed' USING ERRCODE='PT409'; END IF;
    IF length(v_reason) < 3 THEN RAISE EXCEPTION 'Waiver reason required' USING ERRCODE='22023'; END IF;
    INSERT INTO public.driver_charge_decisions(charge_id, driver_id, organisation_id, stage, decision, reason, decided_by, charge_version, details)
      VALUES (c.id, d.id, org, 'waiver', 'waive', v_reason, actor, c.version, detail);
    UPDATE public.driver_charge_instalments SET status = 'cancelled' WHERE charge_id = c.id AND status = 'scheduled';
    UPDATE public.driver_charges SET status = 'waived', close_reason = v_reason, version = version + 1, updated_at = now() WHERE id = c.id;
    PERFORM private.driver_charge_close_fine(c.id);
    notify_driver := true;

  WHEN 'charge_reverse' THEN
    IF NOT is_manager THEN RAISE EXCEPTION 'Only a manager may reverse a charge' USING ERRCODE='42501'; END IF;
    IF c.status IN ('deducted','waived','cancelled_wrongly_issued') OR c.deducted_amount > 0 THEN RAISE EXCEPTION 'A charge with recorded deductions cannot be reversed. Waive the remainder instead.' USING ERRCODE='PT409'; END IF;
    IF coalesce(p_payload->>'reversal_code','') NOT IN ('wrong_driver','duplicate','wrong_amount','wrong_vehicle','misused','other') THEN RAISE EXCEPTION 'Choose why the charge was wrong' USING ERRCODE='22023'; END IF;
    IF length(v_reason) < 10 THEN RAISE EXCEPTION 'Explain the reversal (at least 10 characters)' USING ERRCODE='22023'; END IF;
    reissue := p_payload->'reissue';
    IF reissue IS NOT NULL AND jsonb_typeof(reissue) <> 'object' THEN reissue := NULL; END IF;
    IF reissue IS NOT NULL AND p_payload->>'reversal_code' IN ('duplicate','misused') THEN RAISE EXCEPTION 'A duplicate or misused charge is reversed without reissue' USING ERRCODE='22023'; END IF;
    INSERT INTO public.driver_charge_decisions(charge_id, driver_id, organisation_id, stage, decision, reason, decided_by, charge_version, details)
      VALUES (c.id, d.id, org, 'reversal', 'reverse', v_reason, actor, c.version, detail);
    UPDATE public.driver_charge_instalments SET status = 'cancelled' WHERE charge_id = c.id AND status = 'scheduled';
    UPDATE public.driver_charges SET status = 'cancelled_wrongly_issued', reversal_code = p_payload->>'reversal_code', close_reason = v_reason,
      version = version + 1, updated_at = now() WHERE id = c.id;
    PERFORM private.driver_charge_close_fine(c.id);
    IF reissue IS NOT NULL THEN
      target_driver := coalesce(nullif(reissue->>'driver_id','')::uuid, d.id);
      IF p_payload->>'reversal_code' = 'wrong_driver' AND target_driver = d.id THEN RAISE EXCEPTION 'Choose the correct driver for the reissued charge' USING ERRCODE='22023'; END IF;
      IF private.driver_workspace_access(target_driver) NOT IN ('manager','supervisor') THEN RAISE EXCEPTION 'Target driver outside your scope' USING ERRCODE='42501'; END IF;
      nc := private.driver_charge_issue(org, actor, target_driver, jsonb_build_object(
        'category', c.category, 'source_type', c.source_type, 'source_id', c.source_id, 'link_unverified', CASE WHEN c.source_link_unverified THEN 'true' END,
        'vehicle_id', CASE WHEN reissue ? 'vehicle_id' THEN reissue->>'vehicle_id' ELSE c.vehicle_id::text END,
        'incident_at', c.incident_at, 'basis', coalesce(nullif(btrim(reissue->>'basis'),''), c.basis),
        'amount', coalesce((reissue->>'amount')::numeric, c.amount), 'currency', c.currency,
        'evidence', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'ref',e.ref,'label',e.label) ORDER BY e.created_at, e.id),'[]') FROM public.driver_charge_evidence e WHERE e.charge_id = c.id)), c.id);
      UPDATE public.driver_charges SET superseded_by_charge_id = nc.id WHERE id = c.id;
      INSERT INTO public.driver_workspace_events(organisation_id, driver_id, charge_id, actor_id, action, details)
        VALUES (org, nc.driver_id, nc.id, actor, 'charge_reissued_in', jsonb_build_object('previous_charge_id', c.id, 'previous_driver_id', d.id, 'reason', v_reason));
      detail := detail || jsonb_build_object('replacement_charge_id', nc.id);
    END IF;
    notify_driver := true;

  WHEN 'charge_appeal' THEN
    IF NOT is_driver THEN RAISE EXCEPTION 'Only the linked driver may appeal' USING ERRCODE='42501'; END IF;
    IF c.status NOT IN ('supervisor_approved','finance_approved','scheduled') THEN RAISE EXCEPTION 'This charge cannot be appealed now' USING ERRCODE='PT409'; END IF;
    IF EXISTS(SELECT 1 FROM public.driver_charge_appeals WHERE charge_id = c.id) THEN RAISE EXCEPTION 'An appeal was already filed for this charge' USING ERRCODE='23505'; END IF;
    -- Allowing an appeal after money was taken would close the charge with no
    -- refund recorded. Until a refund step exists, appeals end at the first deduction.
    IF c.deducted_amount > 0 THEN RAISE EXCEPTION 'Deductions have already started on this charge, so it can no longer be appealed here. Ask a manager to review it; a manager or finance can waive the remainder.' USING ERRCODE='PT409'; END IF;
    IF length(v_reason) NOT BETWEEN 10 AND 4000 THEN RAISE EXCEPTION 'Explain your appeal (at least 10 characters)' USING ERRCODE='22023'; END IF;
    INSERT INTO public.driver_charge_appeals(charge_id, driver_id, organisation_id, reason, prior_status, filed_by)
      VALUES (c.id, d.id, org, v_reason, c.status, actor);
    UPDATE public.driver_charges SET status = 'under_appeal', version = version + 1, updated_at = now() WHERE id = c.id;

  WHEN 'charge_decide_appeal' THEN
    IF NOT (is_staff OR is_finance) THEN RAISE EXCEPTION 'Appeal decision not permitted' USING ERRCODE='42501'; END IF;
    IF c.status <> 'under_appeal' THEN RAISE EXCEPTION 'No open appeal' USING ERRCODE='PT409'; END IF;
    choice := coalesce(p_payload->>'outcome','');
    IF choice NOT IN ('upheld','allowed') THEN RAISE EXCEPTION 'Choose upheld or allowed' USING ERRCODE='22023'; END IF;
    IF length(v_reason) < 10 THEN RAISE EXCEPTION 'Explain the appeal decision (at least 10 characters)' USING ERRCODE='22023'; END IF;
    SELECT * INTO ap FROM public.driver_charge_appeals WHERE charge_id = c.id FOR UPDATE;
    INSERT INTO public.driver_charge_decisions(charge_id, driver_id, organisation_id, stage, decision, reason, decided_by, charge_version, details)
      VALUES (c.id, d.id, org, 'appeal', choice, v_reason, actor, c.version, detail);
    UPDATE public.driver_charge_appeals SET outcome = choice, decision_reason = v_reason, decided_by = actor, decided_at = now() WHERE id = ap.id;
    IF choice = 'allowed' THEN
      UPDATE public.driver_charge_instalments SET status = 'cancelled' WHERE charge_id = c.id AND status = 'scheduled';
      UPDATE public.driver_charges SET status = 'waived', close_reason = 'Appeal allowed: '||v_reason, version = version + 1, updated_at = now() WHERE id = c.id;
      PERFORM private.driver_charge_close_fine(c.id);
    ELSE
      UPDATE public.driver_charges SET status = ap.prior_status, version = version + 1, updated_at = now() WHERE id = c.id;
    END IF;
    notify_driver := true;

  ELSE RAISE EXCEPTION 'Unsupported charge action' USING ERRCODE='22023';
  END CASE;

  INSERT INTO public.driver_workspace_events(organisation_id, driver_id, charge_id, actor_id, action, details)
    VALUES (org, d.id, c.id, actor, p_action, detail);
  INSERT INTO public.notifications(user_id, type, title, body, entity_type, entity_id)
    SELECT recipient, 'driver_workspace',
      CASE WHEN notify_driver AND recipient IN (SELECT l.user_id FROM public.driver_account_links l WHERE l.driver_id = d.id) THEN 'Driver charge needs your attention' ELSE 'Driver charge updated' END,
      'Open your driver workspace to review the latest charge action.', 'driver_workspace', d.id::text
    FROM (SELECT l.user_id recipient FROM public.driver_account_links l WHERE l.driver_id = d.id
      UNION SELECT a.supervisor_id FROM public.driver_team_assignments a WHERE a.driver_id = d.id AND a.ends_at IS NULL
      UNION SELECT a.manager_id FROM public.driver_team_assignments a WHERE a.driver_id = d.id AND a.ends_at IS NULL) q
    WHERE recipient IS NOT NULL AND recipient <> actor;
  answer := jsonb_build_object('driver_id', d.id, 'id', c.id, 'charge_no', c.charge_no, 'action', p_action)
    || CASE WHEN nc.id IS NOT NULL THEN jsonb_build_object('replacement_charge_id', nc.id) ELSE '{}'::jsonb END;
  INSERT INTO private.driver_workspace_requests VALUES (actor, p_request_id, p_action, p_payload, answer);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_command(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.driver_workspace_command(p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_action IN ('review_fine','correct_fine','reassign_fine') THEN
    RETURN private.driver_fine_enterprise_command(p_action,p_payload,p_request_id);
  END IF;
  IF left(coalesce(p_action,''),7) = 'charge_' THEN
    RETURN private.driver_charge_command(p_action,p_payload,p_request_id);
  END IF;
  RETURN private.driver_workspace_command(p_action,p_payload,p_request_id);
END $$;
REVOKE ALL ON FUNCTION public.driver_workspace_command(text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_workspace_command(text,jsonb,uuid) TO authenticated;

-- ── Reads ────────────────────────────────────────────────────────────────────
CREATE FUNCTION private.driver_charge_actions(c public.driver_charges, p_access text)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE is_driver boolean := EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id = c.driver_id AND user_id = auth.uid());
  staff boolean := p_access IN ('manager','supervisor') AND NOT is_driver; mgr boolean := p_access = 'manager' AND NOT is_driver;
  fin boolean := private.driver_workspace_is_finance_reviewer() AND NOT is_driver; a text[] := '{}';
BEGIN
  IF c.status = 'issued' AND (mgr OR (staff AND c.issued_by = auth.uid())) THEN a := a || ARRAY['charge_correct','charge_attach_evidence']; END IF;
  IF c.status = 'issued' AND staff THEN a := array_append(a, 'charge_notify'); END IF;
  IF c.status = 'notified' AND is_driver THEN a := array_append(a, 'charge_respond'); END IF;
  IF c.status = 'notified' AND staff THEN a := array_append(a, 'charge_record_refusal'); END IF;
  IF c.status = 'notified' AND c.refusal_witness_id = auth.uid() AND NOT is_driver THEN a := array_append(a, 'charge_witness_confirm'); END IF;
  IF c.status IN ('accepted','disputed','refused') AND staff AND c.issued_by <> auth.uid() AND c.notified_by IS DISTINCT FROM auth.uid()
     AND c.refusal_witness_id IS DISTINCT FROM auth.uid() AND c.refusal_recorded_by IS DISTINCT FROM auth.uid() THEN a := array_append(a, 'charge_supervisor_review'); END IF;
  IF c.status = 'supervisor_approved' AND fin THEN a := array_append(a, 'charge_finance_review'); END IF;
  IF c.status = 'finance_approved' AND fin AND private.driver_charge_schedule_block(c.id) IS NULL THEN a := array_append(a, 'charge_schedule'); END IF;
  IF c.status = 'scheduled' AND fin THEN a := array_append(a, 'charge_record_deduction'); END IF;
  IF c.status IN ('supervisor_approved','finance_approved','scheduled') AND is_driver AND c.deducted_amount = 0 AND NOT EXISTS(SELECT 1 FROM public.driver_charge_appeals WHERE charge_id = c.id) THEN a := array_append(a, 'charge_appeal'); END IF;
  IF c.status = 'under_appeal' AND (staff OR fin) THEN a := array_append(a, 'charge_decide_appeal'); END IF;
  IF c.status NOT IN ('deducted','waived','cancelled_wrongly_issued') AND (mgr OR fin) THEN a := array_append(a, 'charge_waive'); END IF;
  IF c.status NOT IN ('deducted','waived','cancelled_wrongly_issued') AND c.deducted_amount = 0 AND mgr THEN a := array_append(a, 'charge_reverse'); END IF;
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION private.driver_charge_actions(public.driver_charges,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.driver_charges_list(p_filters jsonb DEFAULT '{}'::jsonb, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid := public.app_current_org(); q text := left(coalesce(p_filters->>'search',''),160); result jsonb;
BEGIN
  IF auth.uid() IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object(
    'rows', coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC, x->>'id'), '[]'),
    'can_finance', private.driver_workspace_is_finance_reviewer(),
    'cap_pct', private.driver_charge_setting('driver_charge_instalment_cap_pct', 20),
    'appeal_window_days', private.driver_charge_setting('driver_charge_appeal_window_days', 7)) INTO result
  FROM (
    SELECT jsonb_build_object('id', c.id, 'charge_no', c.charge_no, 'driver_id', c.driver_id, 'driver_name', d.driver_name, 'employee_id', d.driver_id,
      'category', c.category, 'source_type', c.source_type, 'source_id', c.source_id, 'source_label', c.source_summary->>'label',
      'asset_no', v.asset_no, 'site', c.site, 'country', c.country, 'amount', c.amount, 'currency', c.currency,
      'deducted_amount', c.deducted_amount, 'outstanding', CASE WHEN c.status IN ('waived','cancelled_wrongly_issued') THEN 0 ELSE c.amount - c.deducted_amount END,
      'status', c.status, 'driver_response', c.driver_response, 'version', c.version, 'notified_at', c.notified_at,
      'created_at', c.created_at, 'updated_at', c.updated_at, 'superseded_by_charge_id', c.superseded_by_charge_id, 'supersedes_charge_id', c.supersedes_charge_id) x
    FROM public.driver_charges c JOIN public.drivers d ON d.id = c.driver_id LEFT JOIN public.vehicle_fleet v ON v.id = c.vehicle_id
    WHERE c.organisation_id = org AND private.driver_workspace_access(c.driver_id) <> 'none'
      AND (nullif(p_filters->>'driver_id','') IS NULL OR c.driver_id = (p_filters->>'driver_id')::uuid)
      AND (coalesce(p_filters->>'status','') = '' OR c.status = p_filters->>'status')
      AND (coalesce(p_filters->>'category','') = '' OR c.category = p_filters->>'category')
      AND (q = '' OR concat_ws(' ', c.charge_no, d.driver_name, d.driver_id, v.asset_no, c.basis, c.source_summary->>'label') ILIKE '%'||q||'%')
    ORDER BY c.created_at DESC, c.id LIMIT 101 OFFSET p_offset
  ) z;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.driver_charges_list(jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_charges_list(jsonb,integer) TO authenticated;

CREATE FUNCTION public.driver_charge_detail(p_charge_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.driver_charges%ROWTYPE; d public.drivers%ROWTYPE; access_mode text; with_signatures boolean;
BEGIN
  IF auth.uid() IS NULL OR public.app_current_org() IS NULL OR NOT coalesce(public.app_is_active(),false) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.driver_charges WHERE id = p_charge_id AND organisation_id = public.app_current_org();
  IF NOT FOUND THEN RAISE EXCEPTION 'Charge unavailable' USING ERRCODE='42501'; END IF;
  access_mode := private.driver_workspace_access(c.driver_id);
  IF access_mode = 'none' THEN RAISE EXCEPTION 'Charge unavailable' USING ERRCODE='42501'; END IF;
  with_signatures := access_mode <> 'viewer';
  SELECT * INTO d FROM public.drivers WHERE id = c.driver_id;
  RETURN jsonb_build_object(
    'access', access_mode,
    'actions', to_jsonb(private.driver_charge_actions(c, access_mode)),
    'charge', CASE WHEN access_mode = 'viewer' THEN to_jsonb(c) - 'schedule_monthly_wage' - 'schedule_cap_amount' ELSE to_jsonb(c) END || jsonb_build_object('asset_no', (SELECT asset_no FROM public.vehicle_fleet WHERE id = c.vehicle_id),
      'issued_by_name', (SELECT full_name FROM public.profiles WHERE id = c.issued_by),
      'notified_by_name', (SELECT full_name FROM public.profiles WHERE id = c.notified_by),
      'scheduled_by_name', (SELECT full_name FROM public.profiles WHERE id = c.scheduled_by)),
    'driver', jsonb_build_object('id', d.id, 'driver_id', d.driver_id, 'driver_name', d.driver_name, 'country', d.country, 'site', d.site),
    'evidence', (SELECT coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('added_by_name', p.full_name) ORDER BY e.created_at, e.id),'[]') FROM public.driver_charge_evidence e LEFT JOIN public.profiles p ON p.id = e.added_by WHERE e.charge_id = c.id),
    'signatures', (SELECT coalesce(jsonb_agg(CASE WHEN with_signatures THEN to_jsonb(s) - 'charge_snapshot' ELSE to_jsonb(s) - 'charge_snapshot' - 'signature' END
      || jsonb_build_object('recorded_by_name', p.full_name) ORDER BY s.signed_at, s.id),'[]') FROM public.driver_charge_signatures s LEFT JOIN public.profiles p ON p.id = s.recorded_by WHERE s.charge_id = c.id),
    'decisions', (SELECT coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('decided_by_name', p.full_name) ORDER BY x.created_at, x.id),'[]') FROM public.driver_charge_decisions x LEFT JOIN public.profiles p ON p.id = x.decided_by WHERE x.charge_id = c.id),
    'appeal', (SELECT to_jsonb(a) || jsonb_build_object('decided_by_name', p.full_name) FROM public.driver_charge_appeals a LEFT JOIN public.profiles p ON p.id = a.decided_by WHERE a.charge_id = c.id),
    'instalments', (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.seq),'[]') FROM public.driver_charge_instalments i WHERE i.charge_id = c.id),
    'events', (SELECT coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object('actor_name', p.full_name) ORDER BY e.created_at, e.id),'[]') FROM public.driver_workspace_events e LEFT JOIN public.profiles p ON p.id = e.actor_id WHERE e.charge_id = c.id),
    'statements', private.driver_charge_statements(private.driver_charge_amount_text(c.amount, c.currency)),
    'settings', jsonb_build_object(
      'cap_pct', private.driver_charge_setting('driver_charge_instalment_cap_pct', 20),
      'appeal_window_days', private.driver_charge_setting('driver_charge_appeal_window_days', 7),
      -- "Needs legal confirmation" is a note for staff only; a driver sees the rule, not the caveat.
      'country_rule', CASE WHEN access_mode = 'driver' THEN private.driver_charge_country_rule(c.country) - 'needs_legal_confirmation'
        ELSE private.driver_charge_country_rule(c.country) END,
      'bucket', private.driver_charge_bucket(c.category),
      'needs_photo', private.driver_charge_needs_photo(c.category),
      'objection_deadline', private.driver_charge_objection_deadline(c.id),
      'schedule_block', private.driver_charge_schedule_block(c.id),
      -- The last calendar day the driver may object (Riyadh date of the moment before the deadline).
      'objection_last_day', to_char((private.driver_charge_objection_deadline(c.id) - interval '1 second') AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD')));
END $$;
REVOKE ALL ON FUNCTION public.driver_charge_detail(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_charge_detail(uuid) TO authenticated;

-- Source picker for the issue form. Staff only; tenant from the session.
CREATE FUNCTION public.driver_charge_sources(p_source_type text, p_driver_id uuid, p_search text DEFAULT '', p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid := public.app_current_org(); tbl text := private.driver_charge_source_table(p_source_type); result jsonb;
  cols text[]; present text[]; search_expr text; extra text := ''; d public.drivers%ROWTYPE; q text := btrim(coalesce(p_search,''));
  recorded text[] := '{}'; matched text[] := '{}';
BEGIN
  IF auth.uid() IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) OR private.driver_workspace_access(p_driver_id) NOT IN ('manager','supervisor') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF tbl IS NULL OR p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000 OR length(q) > 160 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023'; END IF;
  IF to_regclass('public.'||tbl) IS NULL THEN RETURN '[]'::jsonb; END IF;
  -- Large registers are searched, not listed: at least 3 characters.
  IF p_source_type IN ('tyre_record','inspection','checklist_submission') AND length(q) < 3 THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO d FROM public.drivers WHERE id = p_driver_id;
  SELECT coalesce(array_agg(c.column_name::text), '{}') INTO present FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = tbl;
  -- Search only these human-readable columns, never the whole row.
  cols := CASE p_source_type
    WHEN 'accident' THEN ARRAY['reference_no','asset_no','plate_number','driver_name','description']
    WHEN 'handover_report' THEN ARRAY['asset_no','from_driver','to_driver','notes']
    WHEN 'inspection' THEN ARRAY['title','asset_no','inspector','notes']
    WHEN 'checklist_submission' THEN ARRAY['template_name','title','asset_no']
    WHEN 'tyre_record' THEN ARRAY['serial_no','asset_no','job_card','driver_name','description']
    WHEN 'driver_fine' THEN ARRAY['notice_reference','authority','description'] END;
  SELECT coalesce(string_agg(format('r.%I::text', x), ','), '') INTO search_expr FROM unnest(cols) x WHERE x = ANY(present);
  IF search_expr = '' THEN search_expr := 'NULL::text'; END IF;
  -- Cheap pre-filters mirroring the summary rules, applied before LIMIT.
  IF 'country' = ANY(present) THEN extra := ' AND (nullif(btrim(r.country),'''') IS NULL OR lower(btrim(r.country)) = lower(btrim($6)))'; END IF;
  IF p_source_type = 'driver_fine' THEN
    extra := extra || ' AND r.driver_id = $3 AND r.status = ''open'' AND r.response_status = ''approved'' AND r.review_stage = ''complete'' AND r.paid_amount = 0 AND r.recovery_charge_id IS NULL';
  ELSE
    IF p_source_type = 'tyre_record' AND 'driver_id' = ANY(present) THEN
      recorded := array_append(recorded, 'r.driver_id IS NOT NULL'); matched := array_append(matched, 'r.driver_id = $3');
    END IF;
    SELECT recorded || coalesce(array_agg(format('nullif(btrim(r.%I),'''') IS NOT NULL', x)), '{}'),
           matched || coalesce(array_agg(format('lower(btrim(r.%I)) IN (lower(btrim($7)), lower(btrim($8)))', x)), '{}')
      INTO recorded, matched
      FROM unnest(CASE p_source_type WHEN 'accident' THEN ARRAY['driver_name'] WHEN 'tyre_record' THEN ARRAY['driver_name']
        WHEN 'handover_report' THEN ARRAY['from_driver','to_driver'] ELSE ARRAY[]::text[] END) x WHERE x = ANY(present);
    IF cardinality(recorded) > 0 THEN
      extra := extra || ' AND (NOT (' || array_to_string(recorded, ' OR ') || ') OR ' || array_to_string(matched, ' OR ') || ')';
    END IF;
  END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''id'', y.id, ''summary'', y.summary) ORDER BY y.created_at DESC NULLS LAST, y.id), ''[]'') FROM ('
    || 'SELECT p.id, p.created_at, private.driver_charge_source_summary($1,$2,p.id,$3) AS summary FROM ('
    || 'SELECT r.id, r.created_at FROM public.%I r WHERE r.organisation_id = $1 %s'
    || ' AND ($4 = '''' OR concat_ws('' '', %s) ILIKE ''%%''||$4||''%%'') ORDER BY r.created_at DESC NULLS LAST, r.id LIMIT 101 OFFSET $5) p) y WHERE y.summary IS NOT NULL',
    tbl, extra, search_expr)
    INTO result USING org, p_source_type, p_driver_id, q, p_offset, d.country, d.driver_name, d.driver_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.driver_charge_sources(text,uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_charge_sources(text,uuid,text,integer) TO authenticated;

-- ============================================================================
-- ACCIDENT LIABILITY APPROVAL: server stamped, immutable, audited.
-- ============================================================================
CREATE TABLE public.accident_liability_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  assessment_id uuid NOT NULL REFERENCES public.accident_liability_assessments(id),
  accident_id uuid NOT NULL,
  approved_by uuid NOT NULL REFERENCES public.profiles(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  assessment_snapshot jsonb NOT NULL,
  driver_charge_id uuid REFERENCES public.driver_charges(id)
);
ALTER TABLE public.accident_liability_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accident_liability_approvals FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accident_liability_approvals TO authenticated;
-- The EXISTS runs with the caller's rights, so the assessment's own org,
-- country and site policies decide who can read its approval history.
CREATE POLICY accident_liability_approvals_read ON public.accident_liability_approvals FOR SELECT TO authenticated
  USING (organisation_id = public.app_current_org() AND coalesce(public.app_is_active(),false)
    AND EXISTS(SELECT 1 FROM public.accident_liability_assessments a WHERE a.id = assessment_id));
CREATE TRIGGER accident_liability_approvals_append_only BEFORE UPDATE OR DELETE ON public.accident_liability_approvals FOR EACH ROW EXECUTE FUNCTION private.driver_charge_append_only();
CREATE INDEX accident_liability_approvals_assessment ON public.accident_liability_approvals(assessment_id, approved_at DESC, id);
CREATE INDEX accident_liability_approvals_accident ON public.accident_liability_approvals(accident_id);

-- An approved decision can be reopened by an administrator with a reason. The
-- row is reused (accident_id is unique on assessments), the reopen is audited
-- and any driver charge it opened is reversed, never deleted.
CREATE TABLE public.accident_liability_reopens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  assessment_id uuid NOT NULL REFERENCES public.accident_liability_assessments(id),
  accident_id uuid NOT NULL,
  approval_id uuid REFERENCES public.accident_liability_approvals(id),
  reversed_charge_id uuid REFERENCES public.driver_charges(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 2000),
  reopened_by uuid NOT NULL REFERENCES public.profiles(id),
  reopened_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.accident_liability_reopens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accident_liability_reopens FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accident_liability_reopens TO authenticated;
CREATE POLICY accident_liability_reopens_read ON public.accident_liability_reopens FOR SELECT TO authenticated
  USING (organisation_id = public.app_current_org() AND coalesce(public.app_is_active(),false)
    AND EXISTS(SELECT 1 FROM public.accident_liability_assessments a WHERE a.id = assessment_id));
CREATE TRIGGER accident_liability_reopens_append_only BEFORE UPDATE OR DELETE ON public.accident_liability_reopens FOR EACH ROW EXECUTE FUNCTION private.driver_charge_append_only();

-- The client can no longer set the approval columns, and an approved row is
-- frozen except for field_audit (per-field source notes). Approval and reopen
-- flow only through the definer RPCs, which set a transaction-local flag.
-- Deleting: an approved assessment, or one with an approval history, is kept
-- for audit. Deleting the ACCIDENT itself is blocked while an approval exists
-- (chosen over cascading, so a money decision is never erased by a case delete);
-- an accident whose assessment was never approved still cascades normally.
CREATE FUNCTION private.accident_liability_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE approving boolean := coalesce(current_setting('tyrepulse.liability_approval', true),'') = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS(SELECT 1 FROM public.accident_liability_approvals x WHERE x.assessment_id = OLD.id) THEN
      RAISE EXCEPTION 'This liability assessment has an approval history and is kept for audit.' USING ERRCODE='42501';
    END IF;
    -- The parent accident is already gone when this runs as part of deleting the
    -- whole case (ON DELETE CASCADE). That covers assessments approved before
    -- this migration, which have no approval row; the case delete is allowed.
    IF (OLD.approved OR OLD.locked) AND EXISTS(SELECT 1 FROM public.accidents x WHERE x.id = OLD.accident_id) THEN
      RAISE EXCEPTION 'An approved liability assessment cannot be deleted on its own. An administrator can reopen it, or the whole accident case can be deleted.' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  IF approving THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.approved := false; NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.locked := false;
    RETURN NEW;
  END IF;
  IF OLD.locked OR OLD.approved THEN
    IF (to_jsonb(NEW) - 'field_audit' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'field_audit' - 'updated_at') THEN
      RAISE EXCEPTION 'Approved liability is locked. An administrator can reopen it with a reason.' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  NEW.approved := OLD.approved; NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at; NEW.locked := OLD.locked;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.accident_liability_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER accident_liability_guard BEFORE INSERT OR UPDATE OR DELETE ON public.accident_liability_assessments
  FOR EACH ROW EXECUTE FUNCTION private.accident_liability_guard();

CREATE FUNCTION private.accident_liability_delete_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.accident_liability_approvals x WHERE x.accident_id = OLD.id) THEN
    RAISE EXCEPTION 'This accident has an approved liability decision on record and cannot be deleted. Close the case instead.' USING ERRCODE='42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.accident_liability_delete_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER accident_liability_delete_guard BEFORE DELETE ON public.accidents
  FOR EACH ROW EXECUTE FUNCTION private.accident_liability_delete_guard();

CREATE FUNCTION public.approve_accident_liability(p_assessment_id uuid, p_reason text, p_charge jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid := auth.uid(); org uuid := public.app_current_org(); a public.accident_liability_assessments%ROWTYPE;
  c public.driver_charges%ROWTYPE; acc jsonb; ref text; approval_id uuid;
BEGIN
  IF actor IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF NOT (coalesce(public.app_is_elevated(),false) OR coalesce(public.app_user_can('accidents','approve_liability'),false)) THEN RAISE EXCEPTION 'Liability approval not permitted' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.accident_liability_assessments WHERE id = p_assessment_id AND organisation_id = org FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(public.app_can_see_country(a.country),false) OR NOT coalesce(public.app_can_see_site(a.site),false) THEN RAISE EXCEPTION 'Assessment unavailable' USING ERRCODE='42501'; END IF;
  IF a.approved OR a.locked THEN RAISE EXCEPTION 'This assessment is already approved' USING ERRCODE='PT409'; END IF;
  IF a.created_by = actor THEN RAISE EXCEPTION 'The person who recorded the assessment cannot approve it' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'Approval reason required' USING ERRCODE='22023'; END IF;
  IF a.payer = 'driver_recovery' THEN
    IF p_charge IS NULL OR jsonb_typeof(p_charge) <> 'object' OR nullif(p_charge->>'driver_id','') IS NULL THEN RAISE EXCEPTION 'Choose the driver to recover from' USING ERRCODE='22023'; END IF;
    IF private.driver_workspace_access((p_charge->>'driver_id')::uuid) NOT IN ('manager','supervisor') OR EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id = (p_charge->>'driver_id')::uuid AND user_id = actor) THEN
      RAISE EXCEPTION 'Driver outside your scope' USING ERRCODE='42501';
    END IF;
    SELECT to_jsonb(x) INTO acc FROM public.accidents x WHERE x.id = a.accident_id AND x.organisation_id = org;
    IF acc IS NULL THEN RAISE EXCEPTION 'Accident unavailable' USING ERRCODE='42501'; END IF;
    ref := coalesce(acc->>'reference_no', a.accident_id::text);
    c := private.driver_charge_issue(org, actor, (p_charge->>'driver_id')::uuid, jsonb_build_object(
      'category', 'accident_damage', 'source_type', 'accident', 'source_id', a.accident_id, 'link_unverified', 'true',
      'vehicle_id', acc->>'vehicle_id',
      'incident_at', CASE WHEN acc->>'incident_date' IS NOT NULL THEN (acc->>'incident_date')||'T00:00:00Z' END,
      'basis', coalesce(nullif(btrim(p_charge->>'basis'),''), 'Accident '||ref||': approved liability assessment names the driver as the payer for recovery. Approval reason: '||btrim(p_reason)),
      'amount', coalesce(nullif(p_charge->>'amount','')::numeric, nullif(acc->>'repair_cost','')::numeric),
      'currency', p_charge->>'currency', 'evidence', coalesce(p_charge->'evidence','[]'::jsonb)), NULL);
  END IF;
  PERFORM set_config('tyrepulse.liability_approval','on',true);
  UPDATE public.accident_liability_assessments SET approved = true, approved_by = actor, approved_at = now(), locked = true, updated_at = now() WHERE id = a.id RETURNING * INTO a;
  PERFORM set_config('tyrepulse.liability_approval','off',true);
  INSERT INTO public.accident_liability_approvals(organisation_id, assessment_id, accident_id, approved_by, reason, assessment_snapshot, driver_charge_id)
    VALUES (org, a.id, a.accident_id, actor, btrim(p_reason), to_jsonb(a), c.id) RETURNING id INTO approval_id;
  IF c.id IS NOT NULL THEN
    INSERT INTO public.driver_workspace_events(organisation_id, driver_id, charge_id, actor_id, action, details)
      VALUES (org, c.driver_id, c.id, actor, 'charge_issue', jsonb_build_object('source', 'accident_liability_approval', 'assessment_id', a.id, 'reason', btrim(p_reason)));
  END IF;
  RETURN jsonb_build_object('assessment_id', a.id, 'approved_by', a.approved_by, 'approved_at', a.approved_at, 'approval_id', approval_id, 'driver_charge_id', c.id, 'charge_no', c.charge_no);
END $$;
REVOKE ALL ON FUNCTION public.approve_accident_liability(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_accident_liability(uuid,text,jsonb) TO authenticated;

CREATE FUNCTION public.reopen_accident_liability(p_assessment_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid := auth.uid(); org uuid := public.app_current_org(); a public.accident_liability_assessments%ROWTYPE;
  ap public.accident_liability_approvals%ROWTYPE; c public.driver_charges%ROWTYPE; reversed uuid; reopen_id uuid; why text := btrim(coalesce(p_reason,''));
BEGIN
  IF actor IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF NOT (coalesce(public.is_super_admin(),false) OR coalesce(public.app_is_org_admin(),false)) THEN
    RAISE EXCEPTION 'Only an administrator can reopen an approved liability decision' USING ERRCODE='42501';
  END IF;
  SELECT * INTO a FROM public.accident_liability_assessments WHERE id = p_assessment_id AND organisation_id = org FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(public.app_can_see_country(a.country),false) OR NOT coalesce(public.app_can_see_site(a.site),false) THEN RAISE EXCEPTION 'Assessment unavailable' USING ERRCODE='42501'; END IF;
  IF NOT (a.approved OR a.locked) THEN RAISE EXCEPTION 'This assessment is not approved' USING ERRCODE='PT409'; END IF;
  IF length(why) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Explain why the decision is reopened (at least 10 characters)' USING ERRCODE='22023'; END IF;
  SELECT * INTO ap FROM public.accident_liability_approvals WHERE assessment_id = a.id ORDER BY approved_at DESC, id DESC LIMIT 1;
  IF ap.driver_charge_id IS NOT NULL THEN
    SELECT * INTO c FROM public.driver_charges WHERE id = ap.driver_charge_id FOR UPDATE;
    IF c.deducted_amount > 0 OR c.status = 'deducted' THEN
      RAISE EXCEPTION 'Deductions are already recorded on driver charge %. Waive the remainder on that charge before reopening.', c.charge_no USING ERRCODE='PT409';
    END IF;
    IF c.status NOT IN ('waived','cancelled_wrongly_issued') THEN
      INSERT INTO public.driver_charge_decisions(charge_id, driver_id, organisation_id, stage, decision, reason, decided_by, charge_version, details)
        VALUES (c.id, c.driver_id, org, 'reversal', 'reverse', 'Accident liability reopened: '||why, actor, c.version,
          jsonb_build_object('source', 'accident_liability_reopen', 'assessment_id', a.id));
      UPDATE public.driver_charge_instalments SET status = 'cancelled' WHERE charge_id = c.id AND status = 'scheduled';
      UPDATE public.driver_charges SET status = 'cancelled_wrongly_issued', reversal_code = 'other', close_reason = 'Accident liability reopened: '||why,
        version = version + 1, updated_at = now() WHERE id = c.id;
      INSERT INTO public.driver_workspace_events(organisation_id, driver_id, charge_id, actor_id, action, details)
        VALUES (org, c.driver_id, c.id, actor, 'charge_reverse', jsonb_build_object('source', 'accident_liability_reopen', 'assessment_id', a.id, 'reason', why));
      reversed := c.id;
    END IF;
  END IF;
  PERFORM set_config('tyrepulse.liability_approval','on',true);
  UPDATE public.accident_liability_assessments SET approved = false, approved_by = NULL, approved_at = NULL, locked = false,
    change_reason = why, updated_at = now() WHERE id = a.id;
  PERFORM set_config('tyrepulse.liability_approval','off',true);
  INSERT INTO public.accident_liability_reopens(organisation_id, assessment_id, accident_id, approval_id, reversed_charge_id, reason, reopened_by)
    VALUES (org, a.id, a.accident_id, ap.id, reversed, why, actor) RETURNING id INTO reopen_id;
  RETURN jsonb_build_object('assessment_id', a.id, 'reopen_id', reopen_id, 'reversed_charge_id', reversed);
END $$;
REVOKE ALL ON FUNCTION public.reopen_accident_liability(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reopen_accident_liability(uuid,text) TO authenticated;

-- ============================================================================
-- DRIVER EXPENSES: owner edits a pending claim; review is server stamped.
-- ============================================================================
ALTER TABLE public.driver_expenses
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reason text;

CREATE FUNCTION private.driver_expense_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE reviewing boolean := coalesce(current_setting('tyrepulse.expense_review', true),'') = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'pending' AND NOT coalesce(public.is_super_admin(),false) THEN
      RAISE EXCEPTION 'A reviewed expense claim is kept for audit' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  -- The review and pending rules govern signed-in client writes. Service role,
  -- definer import functions (Data Intake) and maintenance run as other roles.
  IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT reviewing THEN
      NEW.status := 'pending'; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_reason := NULL;
      IF auth.uid() IS NOT NULL THEN NEW.created_by := auth.uid(); END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT reviewing AND ((NEW.status, NEW.reviewed_by, NEW.reviewed_at, NEW.review_reason, NEW.created_by)
      IS DISTINCT FROM (OLD.status, OLD.reviewed_by, OLD.reviewed_at, OLD.review_reason, OLD.created_by)) THEN
    RAISE EXCEPTION 'Expense status changes go through the review action' USING ERRCODE='42501';
  END IF;
  IF NOT reviewing AND OLD.status <> 'pending' AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'A reviewed expense claim cannot be edited' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.driver_expense_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS driver_expense_guard ON public.driver_expenses;
CREATE TRIGGER driver_expense_guard BEFORE INSERT OR UPDATE OR DELETE ON public.driver_expenses FOR EACH ROW EXECUTE FUNCTION private.driver_expense_guard();

DROP POLICY IF EXISTS driver_expenses_update ON public.driver_expenses;
DROP POLICY IF EXISTS driver_expenses_delete ON public.driver_expenses;
CREATE POLICY driver_expenses_update ON public.driver_expenses FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() AND status = 'pending') OR coalesce(public.app_is_elevated(),false))
  WITH CHECK ((created_by = auth.uid() AND status = 'pending') OR coalesce(public.app_is_elevated(),false));
CREATE POLICY driver_expenses_delete ON public.driver_expenses FOR DELETE TO authenticated
  USING ((status = 'pending' AND (created_by = auth.uid() OR coalesce(public.app_is_elevated(),false))) OR coalesce(public.is_super_admin(),false));

-- p_expected_updated_at is the updated_at the reviewer saw (optimistic check).
CREATE FUNCTION public.review_driver_expense(p_id uuid, p_status text, p_reason text, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.driver_expenses%ROWTYPE; actor uuid := auth.uid(); v_site text;
BEGIN
  IF actor IS NULL OR NOT coalesce(public.app_is_active(),false) OR NOT coalesce(public.app_is_elevated(),false) THEN RAISE EXCEPTION 'Expense review not permitted' USING ERRCODE='42501'; END IF;
  IF p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'Refresh the claim before reviewing it' USING ERRCODE='22023'; END IF;
  SELECT * INTO e FROM public.driver_expenses WHERE id = p_id AND organisation_id IS NOT DISTINCT FROM public.app_current_org() FOR UPDATE;
  IF NOT FOUND OR NOT (e.country IS NULL OR coalesce(public.app_can_see_country(e.country),false)) THEN RAISE EXCEPTION 'Expense unavailable' USING ERRCODE='42501'; END IF;
  -- Site: the claim's own site when the column exists, else the vehicle's site.
  v_site := coalesce(nullif(btrim(to_jsonb(e)->>'site'),''),
    (SELECT v.site FROM public.vehicle_fleet v WHERE v.organisation_id = e.organisation_id AND v.asset_no = e.asset_no
       AND (e.country IS NULL OR v.country = e.country) ORDER BY v.id LIMIT 1));
  IF v_site IS NOT NULL AND NOT coalesce(public.app_can_see_site(v_site),false) THEN RAISE EXCEPTION 'Expense unavailable' USING ERRCODE='42501'; END IF;
  IF e.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'This claim changed since you opened it. Refresh and review again.' USING ERRCODE='PT409'; END IF;
  IF e.created_by = actor THEN RAISE EXCEPTION 'You cannot review your own expense claim' USING ERRCODE='42501'; END IF;
  IF NOT ((e.status = 'pending' AND coalesce(p_status,'') IN ('approved','rejected')) OR (e.status = 'approved' AND coalesce(p_status,'') = 'reimbursed')) THEN RAISE EXCEPTION 'Invalid expense status change' USING ERRCODE='22023'; END IF;
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'Review reason required' USING ERRCODE='22023'; END IF;
  PERFORM set_config('tyrepulse.expense_review','on',true);
  UPDATE public.driver_expenses SET status = p_status, reviewed_by = actor, reviewed_at = now(), review_reason = btrim(p_reason), updated_at = now() WHERE id = e.id RETURNING * INTO e;
  PERFORM set_config('tyrepulse.expense_review','off',true);
  RETURN to_jsonb(e);
END $$;
REVOKE ALL ON FUNCTION public.review_driver_expense(uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_driver_expense(uuid,text,text,timestamptz) TO authenticated;

-- Rollback (only while every new table is still empty):
--   DROP FUNCTION public.review_driver_expense(uuid,text,text,timestamptz); DROP TRIGGER driver_expense_guard ON public.driver_expenses;
--   DROP FUNCTION private.driver_expense_guard(); (restore the V152 update/delete policies)
--   DROP FUNCTION public.reopen_accident_liability(uuid,text), public.approve_accident_liability(uuid,text,jsonb);
--   DROP POLICY driver_charge_photos_read ON storage.objects; DROP FUNCTION private.driver_charge_photo_readable(text,text);
--   DROP TABLE public.driver_charge_holidays;
--   DROP TRIGGER accident_liability_guard ON public.accident_liability_assessments; DROP TRIGGER accident_liability_delete_guard ON public.accidents;
--   DROP FUNCTION private.accident_liability_guard(), private.accident_liability_delete_guard();
--   DROP TABLE public.accident_liability_reopens, public.accident_liability_approvals;
--   DROP TRIGGER driver_fine_recovery_guard ON public.driver_fines; ALTER TABLE public.driver_fines DROP COLUMN recovery_charge_id;
--   restore public.driver_workspace_command from 20260921134725; DROP FUNCTION public.driver_charges_list, public.driver_charge_detail, public.driver_charge_sources;
--   ALTER TABLE public.driver_workspace_events DROP COLUMN charge_id;
--   DROP TABLE public.driver_charge_instalments, public.driver_charge_appeals, public.driver_charge_decisions,
--     public.driver_charge_signatures, public.driver_charge_evidence, public.driver_charges;
