-- ============================================================================
-- MIGRATIONS_V55_ANON_READ_LOCKDOWN.sql
-- ----------------------------------------------------------------------------
-- Security fix (RLS audit, Session 7). Three tables were readable by the
-- UNAUTHENTICATED `anon` role — anyone with the app's public anon key could
-- read all rows without logging in:
--   * drivers             — driver PII (names / ids / licences)
--   * suppliers            — vendor records
--   * knowledge_documents  — internal SOPs / manuals / RCA (RAG corpus)
-- Each had a SELECT policy `USING (true)` targeting PUBLIC ({} roles, which
-- includes anon) AND an over-broad `GRANT ALL ... TO anon` (incl. write/TRUNCATE).
--
-- Fix: restrict the SELECT policy to `authenticated` (single-tenant today, so
-- logged-in users still read all rows — app behaviour unchanged) and revoke
-- every anon privilege on the three tables. RLS was already enabled on all
-- tables; this closes the public read hole without touching authenticated flows.
--
-- vehicle_fleet's anon SELECT is INTENTIONAL (registration / site lookup runs
-- pre-auth, Session 4) and is deliberately NOT changed here.
--
-- Verified by a rolled-back BEGIN..ROLLBACK assertion before applying live
-- (anon grants = 0; 0 select policies target PUBLIC; 3 target authenticated).
--
-- Rollback (restores the public read exposure — do NOT unless intentional):
--   ALTER POLICY drivers_select ON public.drivers TO public;
--   ALTER POLICY suppliers_select ON public.suppliers TO public;
--   ALTER POLICY knowledge_documents_select ON public.knowledge_documents TO public;
--   GRANT SELECT ON public.drivers, public.suppliers, public.knowledge_documents TO anon;
-- ============================================================================

ALTER POLICY drivers_select             ON public.drivers             TO authenticated;
ALTER POLICY suppliers_select           ON public.suppliers           TO authenticated;
ALTER POLICY knowledge_documents_select ON public.knowledge_documents TO authenticated;

REVOKE ALL ON public.drivers             FROM anon;
REVOKE ALL ON public.suppliers           FROM anon;
REVOKE ALL ON public.knowledge_documents FROM anon;
