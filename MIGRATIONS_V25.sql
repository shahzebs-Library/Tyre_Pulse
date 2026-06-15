-- MIGRATIONS_V25.sql
-- Accident & Claims Tracker fields — mirrors the operational claims tracker
-- workbook (liability, case stage, damage condition, current status, owner,
-- required action, status update + expected release dates). All changes are
-- captured by the existing log_accident_change audit trigger, so every update
-- to these columns is linked to the accident in accident_audit_log.
-- Idempotent.

ALTER TABLE public.accidents
  ADD COLUMN IF NOT EXISTS case_stage            text,
  ADD COLUMN IF NOT EXISTS damage_condition      text,
  ADD COLUMN IF NOT EXISTS current_status        text,
  ADD COLUMN IF NOT EXISTS action_to_be_taken    text,
  ADD COLUMN IF NOT EXISTS responsible_owner     text,
  ADD COLUMN IF NOT EXISTS required_action       text,
  ADD COLUMN IF NOT EXISTS status_update_date    date,
  ADD COLUMN IF NOT EXISTS status_update_note    text,
  ADD COLUMN IF NOT EXISTS expected_release_date date;

CREATE INDEX IF NOT EXISTS idx_accidents_case_stage     ON public.accidents (case_stage);
CREATE INDEX IF NOT EXISTS idx_accidents_current_status ON public.accidents (current_status);
CREATE INDEX IF NOT EXISTS idx_accidents_resp_owner     ON public.accidents (responsible_owner);
CREATE INDEX IF NOT EXISTS idx_accidents_exp_release    ON public.accidents (expected_release_date);

COMMENT ON COLUMN public.accidents.case_stage            IS 'Current case stage in the claims workflow (tracker stage)';
COMMENT ON COLUMN public.accidents.damage_condition      IS 'Damage severity classification e.g. Minor Repair / Major Repair';
COMMENT ON COLUMN public.accidents.current_status        IS 'Current operational status of the asset/repair e.g. Under Repair, Running Condition';
COMMENT ON COLUMN public.accidents.responsible_owner     IS 'Person accountable for driving the case to closure';
COMMENT ON COLUMN public.accidents.required_action       IS 'Next required action / latest progress note';
COMMENT ON COLUMN public.accidents.status_update_date    IS 'Date of the most recent tracker status update';
COMMENT ON COLUMN public.accidents.expected_release_date IS 'Expected date the asset is released back to operations';
