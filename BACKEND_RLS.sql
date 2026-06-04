-- ============================================================
-- TYREPULSE — ROLE-BASED ROW LEVEL SECURITY
-- Run in Supabase SQL Editor AFTER SUPABASE_SCHEMA.sql + MIGRATIONS.sql
-- Built by Shahzeb Rahman © 2026
-- ============================================================
-- Roles (set in profiles.role):
--   Admin     — full access to everything including delete + settings
--   Manager   — can edit records, close actions, manage stock/budgets
--   Director  — read-only across all tables (analytics/reporting)
--   Reporter  — can upload/insert data and log actions; cannot delete
-- ============================================================

-- ── Helper function ───────────────────────────────────────────────────────────
-- Avoids a subquery in every single policy. security definer means it runs
-- as the table owner so it can always read profiles regardless of caller.
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Grant execute to authenticated users
grant execute on function public.get_my_role() to authenticated;


-- ============================================================
-- DROP ALL OLD PERMISSIVE POLICIES
-- ============================================================
drop policy if exists "Auth users full access" on public.tyre_records;
drop policy if exists "Auth users full access" on public.stock_records;
drop policy if exists "Auth users full access" on public.budgets;
drop policy if exists "Auth users full access" on public.corrective_actions;
drop policy if exists "Auth users full access" on public.rca_records;
drop policy if exists "Auth users full access" on public.upload_history;
drop policy if exists "Auth users full access" on public.column_mappings;
drop policy if exists "Auth users full access" on public.cleaning_log;
drop policy if exists "Auth users full access" on public.settings;
drop policy if exists "Auth users full access" on public.inspections;
drop policy if exists "Auth users full access" on public.stock_movements;
drop policy if exists "Auth users full access" on public.audit_log;
drop policy if exists "Auth users full access" on public.kpi_targets;
drop policy if exists "Users can view all profiles"  on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;


-- ============================================================
-- PROFILES
-- ============================================================
-- Everyone can view all profiles (needed to display names everywhere)
create policy "profiles_select"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Users can update their own profile only
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Admin can insert new profiles (e.g. manual creation) and delete
create policy "profiles_admin_insert"
  on public.profiles for insert
  with check (public.get_my_role() = 'Admin');

create policy "profiles_admin_delete"
  on public.profiles for delete
  using (public.get_my_role() = 'Admin');


-- ============================================================
-- TYRE RECORDS
-- ============================================================
create policy "tyre_records_select"
  on public.tyre_records for select
  using (auth.role() = 'authenticated');

-- Reporter, Manager, Admin can insert (upload data)
create policy "tyre_records_insert"
  on public.tyre_records for insert
  with check (public.get_my_role() in ('Reporter', 'Manager', 'Admin'));

-- Manager and Admin can update (edit records, re-classify)
create policy "tyre_records_update"
  on public.tyre_records for update
  using (public.get_my_role() in ('Manager', 'Admin'));

-- Admin only can delete
create policy "tyre_records_delete"
  on public.tyre_records for delete
  using (public.get_my_role() = 'Admin');


-- ============================================================
-- STOCK RECORDS
-- ============================================================
create policy "stock_records_select"
  on public.stock_records for select
  using (auth.role() = 'authenticated');

-- Manager and Admin can insert / update stock records
create policy "stock_records_insert"
  on public.stock_records for insert
  with check (public.get_my_role() in ('Manager', 'Admin'));

create policy "stock_records_update"
  on public.stock_records for update
  using (public.get_my_role() in ('Manager', 'Admin'));

-- Admin only can delete stock records
create policy "stock_records_delete"
  on public.stock_records for delete
  using (public.get_my_role() = 'Admin');


-- ============================================================
-- STOCK MOVEMENTS (append-only log — no delete, no update)
-- ============================================================
create policy "stock_movements_select"
  on public.stock_movements for select
  using (auth.role() = 'authenticated');

-- Manager and Admin can log movements
create policy "stock_movements_insert"
  on public.stock_movements for insert
  with check (public.get_my_role() in ('Manager', 'Admin'));

-- Nobody can update or delete a movement log (immutable audit trail)
-- (no update / delete policies = those operations are blocked)


-- ============================================================
-- BUDGETS
-- ============================================================
create policy "budgets_select"
  on public.budgets for select
  using (auth.role() = 'authenticated');

-- Admin only can create / edit / delete budget records
create policy "budgets_insert"
  on public.budgets for insert
  with check (public.get_my_role() = 'Admin');

create policy "budgets_update"
  on public.budgets for update
  using (public.get_my_role() = 'Admin');

create policy "budgets_delete"
  on public.budgets for delete
  using (public.get_my_role() = 'Admin');


-- ============================================================
-- CORRECTIVE ACTIONS
-- ============================================================
create policy "actions_select"
  on public.corrective_actions for select
  using (auth.role() = 'authenticated');

-- Reporter can create new actions
create policy "actions_insert"
  on public.corrective_actions for insert
  with check (public.get_my_role() in ('Reporter', 'Manager', 'Admin'));

-- Manager and Admin can update / close actions
create policy "actions_update"
  on public.corrective_actions for update
  using (public.get_my_role() in ('Manager', 'Admin'));

-- Admin only can delete
create policy "actions_delete"
  on public.corrective_actions for delete
  using (public.get_my_role() = 'Admin');


-- ============================================================
-- RCA RECORDS
-- ============================================================
create policy "rca_select"
  on public.rca_records for select
  using (auth.role() = 'authenticated');

create policy "rca_insert"
  on public.rca_records for insert
  with check (public.get_my_role() in ('Reporter', 'Manager', 'Admin'));

create policy "rca_update"
  on public.rca_records for update
  using (public.get_my_role() in ('Manager', 'Admin'));

create policy "rca_delete"
  on public.rca_records for delete
  using (public.get_my_role() = 'Admin');


-- ============================================================
-- INSPECTIONS
-- ============================================================
create policy "inspections_select"
  on public.inspections for select
  using (auth.role() = 'authenticated');

create policy "inspections_insert"
  on public.inspections for insert
  with check (public.get_my_role() in ('Reporter', 'Manager', 'Admin'));

create policy "inspections_update"
  on public.inspections for update
  using (public.get_my_role() in ('Manager', 'Admin'));

create policy "inspections_delete"
  on public.inspections for delete
  using (public.get_my_role() = 'Admin');


-- ============================================================
-- KPI TARGETS
-- ============================================================
create policy "kpi_targets_select"
  on public.kpi_targets for select
  using (auth.role() = 'authenticated');

-- Manager and Admin can set/update KPI targets
create policy "kpi_targets_insert"
  on public.kpi_targets for insert
  with check (public.get_my_role() in ('Manager', 'Admin'));

create policy "kpi_targets_update"
  on public.kpi_targets for update
  using (public.get_my_role() in ('Manager', 'Admin'));

create policy "kpi_targets_delete"
  on public.kpi_targets for delete
  using (public.get_my_role() = 'Admin');


-- ============================================================
-- SETTINGS  (Admin-only writes — most sensitive table)
-- ============================================================
create policy "settings_select"
  on public.settings for select
  using (auth.role() = 'authenticated');

create policy "settings_admin_write"
  on public.settings for all
  using (public.get_my_role() = 'Admin')
  with check (public.get_my_role() = 'Admin');


-- ============================================================
-- UPLOAD HISTORY
-- ============================================================
create policy "upload_history_select"
  on public.upload_history for select
  using (auth.role() = 'authenticated');

create policy "upload_history_insert"
  on public.upload_history for insert
  with check (public.get_my_role() in ('Reporter', 'Manager', 'Admin'));

-- Nobody can edit or delete upload history (immutable log)


-- ============================================================
-- COLUMN MAPPINGS  (shared memory — all roles can read + write)
-- ============================================================
create policy "column_mappings_select"
  on public.column_mappings for select
  using (auth.role() = 'authenticated');

create policy "column_mappings_insert"
  on public.column_mappings for insert
  with check (auth.role() = 'authenticated');

create policy "column_mappings_update"
  on public.column_mappings for update
  using (auth.role() = 'authenticated');

-- Admin only can delete saved mappings
create policy "column_mappings_delete"
  on public.column_mappings for delete
  using (public.get_my_role() = 'Admin');


-- ============================================================
-- CLEANING LOG
-- ============================================================
create policy "cleaning_log_select"
  on public.cleaning_log for select
  using (auth.role() = 'authenticated');

create policy "cleaning_log_insert"
  on public.cleaning_log for insert
  with check (public.get_my_role() in ('Reporter', 'Manager', 'Admin'));

-- Immutable — no update or delete policies


-- ============================================================
-- AUDIT LOG  (append-only — no update, no delete for anyone)
-- ============================================================
create policy "audit_log_select"
  on public.audit_log for select
  using (auth.role() = 'authenticated');

create policy "audit_log_insert"
  on public.audit_log for insert
  with check (auth.role() = 'authenticated');

-- No update or delete policies — audit trail is immutable


-- ============================================================
-- VERIFY — run this query after applying to confirm policies
-- ============================================================
-- select schemaname, tablename, policyname, cmd, qual
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, cmd;
