-- STATUS: AUTHORED, NOT APPLIED.
--
-- Per-user UI preferences (theme mode + accent colour today) so a user's
-- appearance follows them across devices. Written by the row owner through the
-- existing profiles_update_own RLS policy (id = auth.uid()).
--
-- NOT a privileged column: guard_profile_privileged_cols() checks an explicit
-- list (role, approved, locked, is_super_admin, country, site, org ids, sites,
-- countries, web_access, module_overrides, employee_id, email, username), so a
-- change to ui_preferences alone passes its first "nothing privileged changed"
-- branch. Keep it OUT of that list.
--
-- Shape: {"appearance": {"mode": "light|dark|system", "accent": "<preset id or #hex>", "updatedAt": <ms>}}
-- The CHECK keeps it a small JSON object so it cannot become a dumping ground.
--
-- Client: src/lib/api/uiPreferences.js degrades to device-only storage while
-- this column is absent (42703 / PGRST204), so the app is safe either side.
--
-- Verify (expect: jsonb, '{}', t):
--   select data_type, column_default from information_schema.columns
--    where table_schema='public' and table_name='profiles' and column_name='ui_preferences';
--   select position('ui_preferences' in pg_get_functiondef('public.guard_profile_privileged_cols'::regproc)) = 0;
--
-- Rollback:
--   alter table public.profiles drop constraint if exists profiles_ui_preferences_shape;
--   alter table public.profiles drop column if exists ui_preferences;

alter table public.profiles
  add column if not exists ui_preferences jsonb not null default '{}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_ui_preferences_shape;
alter table public.profiles
  add constraint profiles_ui_preferences_shape
  check (jsonb_typeof(ui_preferences) = 'object' and pg_column_size(ui_preferences) <= 4096);

comment on column public.profiles.ui_preferences is
  'Per-user UI preferences (appearance: mode, accent, updatedAt). Owner-writable via profiles_update_own; not a guarded privileged column.';
