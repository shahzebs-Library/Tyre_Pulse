-- V345 — Tyre scrap workflow: widen tyre_status_marks to carry a 'scrap' mark + reason.
--
-- Operators scrap end-of-life tyres. In Serial Tracker they search a serial and mark
-- it scrapped. The existing tyre_status_marks table already flags returned/written_off
-- serials; this adds 'scrap' as a first-class mark type plus an optional free-text
-- reason (the acting user is stored in the existing created_by column). Additive +
-- idempotent; no data change. The client also stamps tyre_records.status='Scrapped'
-- for the serial so the existing pool/lifecycle logic (isRemovedOrScrapped) honours it.

-- 1. Allow the 'scrap' mark type (keep the existing returned/written_off).
ALTER TABLE public.tyre_status_marks DROP CONSTRAINT IF EXISTS tyre_status_marks_mark_type_check;
ALTER TABLE public.tyre_status_marks
  ADD CONSTRAINT tyre_status_marks_mark_type_check
  CHECK (mark_type = ANY (ARRAY['returned'::text, 'written_off'::text, 'scrap'::text]));

-- 2. Capture why (audit); created_by already exists for the acting user.
ALTER TABLE public.tyre_status_marks ADD COLUMN IF NOT EXISTS reason text;

-- ============================================================================
-- REVERSIBLE:
--   ALTER TABLE public.tyre_status_marks DROP COLUMN IF EXISTS reason;
--   ALTER TABLE public.tyre_status_marks DROP CONSTRAINT IF EXISTS tyre_status_marks_mark_type_check;
--   ALTER TABLE public.tyre_status_marks ADD CONSTRAINT tyre_status_marks_mark_type_check
--     CHECK (mark_type = ANY (ARRAY['returned'::text, 'written_off'::text]));
-- ============================================================================
