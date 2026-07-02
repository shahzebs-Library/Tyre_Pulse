-- V63: custom_data jsonb on the remaining import-target tables so imported extra
-- headings persist on the live row and can be shown in the UI (CustomFieldsPanel).
ALTER TABLE public.vehicle_fleet   ADD COLUMN IF NOT EXISTS custom_data jsonb;
ALTER TABLE public.accidents       ADD COLUMN IF NOT EXISTS custom_data jsonb;
ALTER TABLE public.inspections     ADD COLUMN IF NOT EXISTS custom_data jsonb;
ALTER TABLE public.stock_records   ADD COLUMN IF NOT EXISTS custom_data jsonb;
ALTER TABLE public.warranty_claims ADD COLUMN IF NOT EXISTS custom_data jsonb;
ALTER TABLE public.gate_passes     ADD COLUMN IF NOT EXISTS custom_data jsonb;
ALTER TABLE public.suppliers       ADD COLUMN IF NOT EXISTS custom_data jsonb;
ALTER TABLE public.drivers         ADD COLUMN IF NOT EXISTS custom_data jsonb;
