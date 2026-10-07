-- ============================================================================
-- Workshop Status - permission model (Loop 2)
-- ============================================================================
-- STATUS: APPLIED to production 2026-10-07 (owner go-ahead). Tested in PGlite (supabase/tests/
-- workshop_status_permissions.test.mjs, applied on top of the Loop 1
-- foundation). Apply to production only on an explicit owner go-ahead, and
-- only after 20261007090000_workshop_status_foundation.sql.
--
-- Daily Ops -> Workshop Status permissions, built on the EXISTING RBAC:
--   * Every action is a permission KEY under the composite module
--     daily_ops:workshop. Each key is read with app_user_can(key, 'view'), so it
--     is editable per role (module_permissions, org_id null) and per user
--     (user_access_grants, revoke beats grant) in Console -> Access Control.
--     No role name is hard-coded in the check itself.
--   * public.workshop_status_can(action) is THE server-side decision. Later
--     writer RPCs call it; RLS below calls it; the UI reads the same answer
--     through workshop_status_my_permissions().
--   * permanent_delete is super admin ONLY. It has no permission key, so no
--     role row and no per-user grant can ever open it - not even for Admin.
--   * The role defaults seeded here only INSERT a row where none exists for
--     that role + key. An administrator's existing choice is never overwritten,
--     and re-running the migration adds nothing.
--   * Mirror: src/lib/workshopStatus/permissions.js (WORKSHOP_ACTIONS,
--     ROLE_GROUPS, DEFAULT_ROLE_MATRIX). A test parses the arrays below to keep
--     the two from drifting - CHANGE BOTH TOGETHER.
--
-- Action -> permission key:
--   view              daily_ops:workshop               (module view, Loop 1)
--   view_removed      daily_ops:workshop:view_removed  vehicles no longer in the report
--   view_uploads      daily_ops:workshop:view_uploads  upload register + parsed rows
--   view_activity     daily_ops:workshop:view_activity activity log of every record
--   view_reports      daily_ops:workshop:view_reports
--   view_audit        daily_ops:workshop:view_audit    (Admin, or explicit grant)
--   update            daily_ops:workshop:update
--   upload            daily_ops:workshop:upload
--   confirm           daily_ops:workshop:confirm
--   assign            daily_ops:workshop:assign
--   disposition       daily_ops:workshop:disposition
--   export            daily_ops:workshop:export
--   archive           daily_ops:workshop:archive
--   restore           daily_ops:workshop:restore
--   soft_delete       daily_ops:workshop:soft_delete   (Admin, or explicit grant)
--   configure         daily_ops:workshop:configure     (Admin, or explicit grant)
--   permanent_delete  (none)                           super admin only
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The decision function.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_can(p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
begin
  -- An unapproved, locked or signed-out session can do nothing.
  if not coalesce(public.app_is_active(), false) then return false; end if;

  -- Unknown actions are refused for everyone, super admin included, rather
  -- than mapped to a guessed key.
  if not (v_action = any (array[
      'view', 'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'view_audit',
      'update', 'upload', 'confirm', 'assign', 'disposition', 'export',
      'archive', 'restore', 'soft_delete', 'configure', 'permanent_delete'])) then
    return false;
  end if;

  -- Super admin: every action, including the one nobody else can hold.
  if coalesce(public.is_super_admin(), false) then return true; end if;
  if v_action = 'permanent_delete' then return false; end if;

  if v_action = 'view' then return coalesce(public.workshop_status_can_view(), false); end if;

  -- Every action also needs the module itself, so revoking daily_ops:workshop
  -- for a user closes everything at once. soft_delete / configure / view_audit
  -- carry no role default below: they are open to Admin (app_user_can returns
  -- true for role Admin) or to whoever an administrator explicitly grants.
  return coalesce(public.workshop_status_can_view(), false)
     and coalesce(public.app_user_can('daily_ops:workshop:' || v_action, 'view'), false);
end $$;

-- ---------------------------------------------------------------------------
-- 2. The caller's full permission map, for the UI (one round trip).
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(a, public.workshop_status_can(a))
    from unnest(array[
      'view', 'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'view_audit',
      'update', 'upload', 'confirm', 'assign', 'disposition', 'export',
      'archive', 'restore', 'soft_delete', 'configure', 'permanent_delete']) as a
$$;

-- Grant authenticated FIRST, then revoke PUBLIC, then anon: a revoke from anon
-- alone is a no-op against a PUBLIC grant, and a revoke from PUBLIC alone would
-- also strip authenticated (V500).
grant execute on function public.workshop_status_can(text) to authenticated;
grant execute on function public.workshop_status_my_permissions() to authenticated;
revoke all on function public.workshop_status_can(text) from public;
revoke all on function public.workshop_status_my_permissions() from public;
revoke all on function public.workshop_status_can(text) from anon;
revoke all on function public.workshop_status_my_permissions() from anon;

-- ---------------------------------------------------------------------------
-- 3. Role defaults (module_permissions, org_id null). Insert-only: a row an
-- administrator already holds for that role + key is left exactly as it is.
-- Skipped where module_permissions does not exist.
--
-- These roles are matched against profiles.role (Title Case). A role that no
-- profile holds yet simply carries an inert row until someone is given it.
-- ---------------------------------------------------------------------------
do $$
declare
  -- Ground team: see the module and update the operational fields.
  v_ground_roles text[] := array['Mechanic', 'Electrician', 'Inspector', 'Tyre Man', 'Tyre Data Collector'];
  v_ground_actions text[] := array['update'];
  -- Workshop supervisors: run the daily upload and the board.
  v_supervisor_roles text[] := array['Workshop Supervisor', 'Maintenance Supervisor',
    'Workshop Area Manager', 'Workshop Maintenance Area Manager'];
  v_supervisor_actions text[] := array['update', 'upload', 'confirm', 'assign', 'disposition', 'export',
    'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'restore'];
  -- Managers: oversee, assign, decide dispositions, archive.
  v_manager_roles text[] := array['PMV Manager', 'Manager', 'Director', 'Fleet Supervisor'];
  v_manager_actions text[] := array['update', 'assign', 'disposition', 'export',
    'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'archive', 'restore'];
begin
  if to_regclass('public.module_permissions') is null then return; end if;

  insert into public.module_permissions (role, module_key, enabled, org_id)
  select s.role, s.module_key, true, null
    from (
      select r as role, 'daily_ops:workshop' as module_key
        from unnest(v_ground_roles || v_supervisor_roles || v_manager_roles) as r
      union
      select r, 'daily_ops:workshop:' || a from unnest(v_ground_roles) r, unnest(v_ground_actions) a
      union
      select r, 'daily_ops:workshop:' || a from unnest(v_supervisor_roles) r, unnest(v_supervisor_actions) a
      union
      select r, 'daily_ops:workshop:' || a from unnest(v_manager_roles) r, unnest(v_manager_actions) a
    ) s
   where not exists (select 1 from public.module_permissions x
                      where x.role = s.role and x.module_key = s.module_key and x.org_id is null);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Tighten the Loop 1 read policies. Only the permissive <table>_read
-- policies are replaced; the restrictive org / country / site policies stay
-- untouched and still AND with these. Helper calls are wrapped as
-- (select ...) so each is an InitPlan evaluated once per query.
-- ---------------------------------------------------------------------------

-- Records: an active row needs the module. A row that left the report
-- (current_active = false) also needs view_removed. A soft-deleted row is
-- visible only to whoever may soft-delete (Admin / super admin by default).
drop policy if exists workshop_status_records_read on public.workshop_status_records;
create policy workshop_status_records_read on public.workshop_status_records
  for select to authenticated
  using (
    (select public.workshop_status_can_view())
    and (
      (deleted_at is null and current_active)
      or (deleted_at is null and not current_active and (select public.workshop_status_can('view_removed')))
      or (deleted_at is not null and (select public.workshop_status_can('soft_delete')))
    )
  );

-- Uploads and their parsed rows: the upload register permission.
drop policy if exists workshop_status_uploads_read on public.workshop_status_uploads;
create policy workshop_status_uploads_read on public.workshop_status_uploads
  for select to authenticated
  using ((select public.workshop_status_can('view_uploads')));

drop policy if exists workshop_status_upload_rows_read on public.workshop_status_upload_rows;
create policy workshop_status_upload_rows_read on public.workshop_status_upload_rows
  for select to authenticated
  using ((select public.workshop_status_can('view_uploads')));

-- Events: the full activity log needs view_activity. Without it a user still
-- sees their own events and the history of records they can see. The EXISTS
-- runs as the caller, so the records policies above decide which records
-- count as visible. Export events are activity-log only.
drop policy if exists workshop_status_events_read on public.workshop_status_events;
create policy workshop_status_events_read on public.workshop_status_events
  for select to authenticated
  using (
    (select public.workshop_status_can_view())
    and (
      (select public.workshop_status_can('view_activity'))
      or (
        event_type <> 'export'
        and (
          actor_id = (select auth.uid())
          or (record_id is not null
              and exists (select 1 from public.workshop_status_records r where r.id = record_id))
        )
      )
    )
  );

-- Attachments: the module, a record the caller can see, and the attachment not
-- soft-deleted - or the soft-delete permission, which also reveals removed files.
drop policy if exists workshop_status_attachments_read on public.workshop_status_attachments;
create policy workshop_status_attachments_read on public.workshop_status_attachments
  for select to authenticated
  using (
    (select public.workshop_status_can_view())
    and (
      (select public.workshop_status_can('soft_delete'))
      or (deleted_at is null
          and exists (select 1 from public.workshop_status_records r where r.id = record_id))
    )
  );

-- Rollback (restores the Loop 1 read policies; the seeded rows are removed
-- only where they still hold the seeded value, so an administrator's later
-- change is not discarded silently - review before running):
--   do $$ declare t text; begin
--     foreach t in array array['workshop_status_uploads', 'workshop_status_records',
--       'workshop_status_upload_rows', 'workshop_status_events', 'workshop_status_attachments'] loop
--       execute format('drop policy if exists %I on public.%I', t || '_read', t);
--       execute format('create policy %I on public.%I for select to authenticated
--         using ((select public.workshop_status_can_view()))', t || '_read', t);
--     end loop; end $$;
--   delete from public.module_permissions
--    where org_id is null and module_key like 'daily_ops:workshop:%' and enabled = true;
--   drop function public.workshop_status_my_permissions();
--   drop function public.workshop_status_can(text);
-- Note: the daily_ops:workshop rows inserted here for roles Loop 1 did not
-- cover cannot be told apart from Loop 1 rows after the fact; leave them, or
-- remove them by role name after checking with the owner.
