-- =============================================================================
-- 20260924123000_retire_developer_api_keys.sql
-- Retire the separate `developer_api_keys` table (V194). COMMENT ONLY.
--
-- STATUS: APPLIED LIVE 2026-09-25 via Supabase MCP (project jhssdmeruxtrlqnwfksc).
--
-- WHY: there must be ONE API key system. The canonical keys live in
-- public.api_keys (V99): minted by create_api_key, revoked by revoke_api_key,
-- authenticated by the public-api edge function and administered by super
-- admins at /console/api-keys. developer_api_keys only ever held metadata
-- ("key references") that could not authenticate anything. The Developer
-- Portal (src/lib/api/developerPortal.js) now reads and writes api_keys.
--
-- MEASURED BEFORE: developer_api_keys held 0 rows and no database function
-- referenced it. The table is NOT dropped: an irreversible deletion needs the
-- owner's approval. With zero rows and no reader, dropping it later is safe.
--
-- ROLLBACK: comment on table public.developer_api_keys is null;
-- =============================================================================

comment on table public.developer_api_keys is
  'RETIRED 2026-09-25 (20260924123000). Not read or written by the app. The one API key system is public.api_keys (create_api_key / revoke_api_key, /console/api-keys). Held 0 rows when retired; drop only with owner approval.';
