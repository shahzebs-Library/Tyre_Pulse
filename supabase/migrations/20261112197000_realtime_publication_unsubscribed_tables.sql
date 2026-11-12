-- supabase_realtime: stop publishing two tables nobody subscribes to (PERF-3)
-- STATUS: APPLIED LIVE 2026-11-12 (schema_migrations 20261112080832). Publication 17 -> 15 tables.
--
-- REMOVED: action_item_history (824 inserts in 2.9 days, the second busiest published table) and
--   shift_handovers (0 writes). Neither has a subscriber in src/, in mobile/ today, in the
--   installed Expo build (6c27046) or in the Flutter app. Both tables and their data are untouched.
-- KEPT, checked one by one: the audit listed corrective_actions, inspections, rca_records and
--   stock_records as unsubscribed too. They are subscribed through mobile/hooks/useRealtime.ts
--   (tasks, history, calendar, rca, stock screens), so they stay.
--
-- MEASURED, AND THE HONEST RESULT IS "NO CHANGE IN THE DECODER":
--   decoder (SELECT wal->>... FROM realtime.list_changes) before: 2,829 buffers per call,
--   1.63 calls/s over 758 s; after: 2,744 buffers per call over 218 s. Within noise.
--   The per-poll cost does not come from the publication list (pg_publication_tables lookup:
--   137 buffers at 17 tables and at 15) - it is the logical decoding of ALL WAL since the last
--   poll, and the poll runs about once a second whenever any client holds a subscription. At the
--   probe the only subscriber was one phone (profiles, user_access_grants, module_permissions,
--   accidents). So this change removes ~13% of published row changes and nothing else.
--   Lowering the decoder needs the Realtime poll interval (Supabase dashboard) or fewer always-on
--   subscriptions in the mobile apps. Neither can be done from a migration.
--
-- Written as SET TABLE with the full list, guarded so it only runs against the measured set.
--
-- ROLLBACK: alter publication supabase_realtime add table public.action_item_history, public.shift_handovers;

do $$
declare
  v_now  text[];
  v_keep text[] := array['accidents','action_items','ai_tyre_inspection_jobs','alerts','corrective_actions',
                         'inspections','module_permissions','notifications','pending_uploads','profiles',
                         'rca_records','stock_records','tyre_records','user_access_grants','work_orders'];
  v_gone text[] := array['action_item_history','shift_handovers'];
begin
  select array_agg(tablename::text order by tablename) into v_now
    from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
  -- Only act on the exact set that was measured; anything else means someone
  -- changed the publication since and this must be re-read, not applied.
  if not (v_now <@ (v_keep || v_gone) and v_keep <@ v_now) then
    raise exception 'supabase_realtime is not the measured set: %', v_now;
  end if;
  alter publication supabase_realtime set table
    public.accidents, public.action_items, public.ai_tyre_inspection_jobs, public.alerts,
    public.corrective_actions, public.inspections, public.module_permissions, public.notifications,
    public.pending_uploads, public.profiles, public.rca_records, public.stock_records,
    public.tyre_records, public.user_access_grants, public.work_orders;
end $$;
