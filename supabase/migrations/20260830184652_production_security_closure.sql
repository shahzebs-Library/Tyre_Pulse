-- Production security closure, 2026-08-30.
-- Evidence before change:
--   * every exposed public base table with an API grant had RLS enabled
--   * anon had no direct write grant on public base tables
--   * these five migration artefacts were still GraphQL-discoverable to every
--     authenticated user despite not being application data
--   * no duplicate auto:* action sources existed

revoke all on table public._anon_execute_revoked_v500 from anon, authenticated;
revoke all on table public._bak_tyre_size_backfill_v476 from anon, authenticated;
revoke all on table public._current_km_snapshot_v407 from anon, authenticated;
revoke all on table public._rls_policy_backup_v498 from anon, authenticated;
revoke all on table public._workshop_snapshot_v399 from anon, authenticated;

-- Automatic module producers retry after network failures and can race. The
-- client preflight is useful but not an authority; this tenant-scoped partial
-- unique index is the atomic idempotency boundary. Manual/free-text sources are
-- intentionally unaffected.
create unique index if not exists action_items_org_auto_source_uidx
  on public.action_items (organisation_id, source)
  where source like 'auto:%';

-- Keep migration artefacts unavailable if default privileges change later.
alter default privileges in schema public revoke all on tables from anon;

