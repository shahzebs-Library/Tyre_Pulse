-- V264: custom board layout for report shares (bespoke TV / kiosk boards).
--
-- Adds report_shares.layout (jsonb, NULL = render the fixed page catalog). An
-- elevated user designs boards block-by-block in the builder
-- (src/components/display/ReportShareBuilder.jsx) and saves via updateReportShare,
-- a direct RLS-gated UPDATE (policy report_shares_update = is_elevated_user() AND
-- own org). get_report_snapshot now echoes the stored layout back to the anon
-- viewer alongside the EXISTING aggregate channels (kpis / trends / breakdowns /
-- heatmap / ops) that every block renders from - so a custom layout exposes NO new
-- data and needs no new grant.
--
-- The authoritative function body is applied live via Supabase MCP (project
-- jhssdmeruxtrlqnwfksc); this file is the repo record. See
-- src/lib/reportShareLayout.js (schema + resolveBlock), src/lib/reportShareCharts.js
-- (shared light chart options) and src/components/display/ShareBlockView.jsx (the
-- single block renderer used by both the viewer and the builder preview).

ALTER TABLE public.report_shares ADD COLUMN IF NOT EXISTS layout jsonb;

-- CREATE OR REPLACE FUNCTION public.get_report_snapshot(
--   p_token text, p_password text DEFAULT NULL,
--   p_site text DEFAULT NULL, p_country text DEFAULT NULL,
--   p_from text DEFAULT NULL, p_to text DEFAULT NULL
-- ) RETURNS jsonb ... adds  'layout', t.layout  to the returned jsonb
-- (see the live definition; body unchanged from V263 apart from that one key).
