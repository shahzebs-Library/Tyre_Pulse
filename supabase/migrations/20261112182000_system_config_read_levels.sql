-- system_config: active accounts only, sensitive keys limited; console stats
-- limited to super admins.
--
-- FINDINGS: RLS-11 (P2), CON-6 (P3)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live): a Driver, a Manager of another organisation
--   and the one locked + unapproved account each read all 62 keys, including the
--   accident e-mail distribution lists, alert / support addresses and the
--   security switches. get_console_stats() answered any signed-in user with the
--   organisation's user totals including the number of super admins.
--
-- WHAT THIS DOES
--   1. system_config_read_level(key) -> 'all' | 'elevated' | 'super'
--      (IMMUTABLE, no table access). A key that is not listed is 'all', so a
--      new key keeps working for the apps until someone classifies it.
--        super    console_ip_allowlist_enabled, dual_control_enabled,
--                 max_login_attempts, api_key_max_age_days, audit_retention_days,
--                 data_retention_months, backup_enabled, backup_max_table_rows,
--                 cron_alert_* (5), sentry_auto_incidents,
--                 tenant_export_retention_days, max_users_per_org,
--                 user_issue_breach_alerts, alert_email, ai_model,
--                 ai_rate_limit_per_min, ai_cache_ttl_hours
--        elevated accident_email_to, accident_email_cc,
--                 accident_email_subject_prefix, support_email, digest_frequency
--   2. The two permissive read policies (sc_read_authenticated,
--      system_config_read) now require an approved, unlocked account and the
--      key's read level. Write policies are untouched.
--   3. get_console_stats() raises 42501 unless the caller is a super admin
--      (anchored insertion into the live definition).
--   A key list in a function was chosen over a new column: no row is updated, so
--   the history / guard triggers on system_config do not fire and the rollback
--   is two ALTER POLICY statements.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Which keys ordinary clients read (grep of src/, mobile/, tyre_pulse_flutter/):
--   SettingsContext loads every row once and falls back to safe defaults for a
--   missing key. Keys used outside the console: maintenance_mode,
--   maintenance_message, app_version, export_enabled, max_export_rows,
--   max_upload_rows, session_timeout_hours, two_factor_required,
--   password_min_length, default_currency, report_palette, company_logo,
--   report_diagram_bg, nav_layout, new_features_admin_only, mobile_min_version,
--   mobile_latest_version, flutter_min_version, mobile_login_hero,
--   accident_emails_enabled, ai_monthly_budget_usd (AI tyre inspection page,
--   open to Tyre Man / Tyre Data Collector / Maintenance Supervisor), and
--   email_notifications (send-email reads it with the caller's token).
--   All of these stay 'all'. The accident e-mail routing keys are read only by
--   the Accident Workflow settings page (Admin / Manager / Director) -> 'elevated'.
--   The 'super' keys are read only by console pages and by SECURITY DEFINER
--   functions / edge functions on the service role.
-- Database readers that run as the caller: stamp_import_default_org reads
--   single_tenant_mode ('all'); accident_apply_tokens reads company_name ('all').
--   No policy or view on another table reads system_config.
-- get_console_stats: one caller, src/console/pages/ConsoleDashboard.jsx.
-- Data loss: none. Locks: catalog only.
-- Client behaviour that changes: a locked or pending account gets no config rows
--   (the apps fall back to defaults and sign such an account out). A non-elevated
--   user no longer receives 26 keys no screen of theirs uses.
-- Left open: Manager / Director of ANY organisation still read the 5 'elevated'
--   keys (the table is global, not per organisation). The two older policies
--   sc_super_admin_all / super_admin_manage_system_config test the profile flag
--   directly, so a super admin without an MFA session still reads and writes
--   all keys.
-- Rollback: at the foot.

create or replace function public.system_config_read_level(p_key text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select case
    when p_key in (
      'console_ip_allowlist_enabled','dual_control_enabled','max_login_attempts',
      'api_key_max_age_days','audit_retention_days','data_retention_months',
      'backup_enabled','backup_max_table_rows',
      'cron_alert_enabled','cron_alert_fail_streak','cron_alert_grace_min',
      'cron_alert_recover_ok','cron_alert_stuck_min',
      'sentry_auto_incidents','tenant_export_retention_days','max_users_per_org',
      'user_issue_breach_alerts','alert_email',
      'ai_model','ai_rate_limit_per_min','ai_cache_ttl_hours'
    ) then 'super'
    when p_key in (
      'accident_email_to','accident_email_cc','accident_email_subject_prefix',
      'support_email','digest_frequency'
    ) then 'elevated'
    else 'all'
  end;
$fn$;

comment on function public.system_config_read_level(text) is
  'Who may read a system_config key: all (any approved, unlocked account), elevated (Admin/Manager/Director), super (super admin only). Used by the system_config read policies. A key not listed is readable by all active accounts.';

grant execute on function public.system_config_read_level(text) to authenticated, service_role;
revoke execute on function public.system_config_read_level(text) from public, anon;

alter policy sc_read_authenticated on public.system_config
  using (
    (select public.app_is_active()) is true
    and (
      public.system_config_read_level(key) = 'all'
      or (public.system_config_read_level(key) = 'elevated' and (select public.app_is_elevated()) is true)
      or (select public.is_super_admin()) is true
    )
  );

alter policy system_config_read on public.system_config
  using (
    (select public.app_is_active()) is true
    and (
      public.system_config_read_level(key) = 'all'
      or (public.system_config_read_level(key) = 'elevated' and (select public.app_is_elevated()) is true)
      or (select public.is_super_admin()) is true
    )
  );

do $mig$
declare
  v_def text;
  v_anchor text := E'begin\n  if (select public.is_super_admin()) then';
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'get_console_stats';
  v_def := replace(v_def, E'\r\n', E'\n');
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'get_console_stats: anchor not found exactly once';
  end if;
  if v_def like '%Not authorized%' then
    raise exception 'get_console_stats already carries a gate';
  end if;
  v_new := replace(v_def, v_anchor,
    E'begin\n  if not coalesce((select public.is_super_admin()), false) then\n    raise exception ''Not authorized'' using errcode = ''42501'';\n  end if;\n  if (select public.is_super_admin()) then');
  execute v_new;
end
$mig$;

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12, rolled back)       rows   restricted keys visible   15 client keys   get_console_stats
--   before, every identity             62     all                       15               answered
--   Driver                             36     none                      15               42501
--   KSA Manager                        41     the 5 elevated            15               42501
--   other-org Manager                  41     the 5 elevated            15               42501
--   locked + unapproved account         0     none                       0               42501
--   super admin, MFA session           62     all 26                    15               answered
--   super admin, no MFA session        62     all 26 (older policies)   15               42501
--   "15 client keys" = maintenance_mode, export_enabled, max_export_rows,
--   max_upload_rows, session_timeout_hours, two_factor_required, app_version,
--   mobile_min_version, company_logo, report_palette, single_tenant_mode,
--   ai_monthly_budget_usd, accident_emails_enabled, email_notifications,
--   default_currency.
--
-- ---------------------------------------------------------------------- ROLLBACK
--   alter policy sc_read_authenticated on public.system_config
--     using ((select auth.role()) = 'authenticated');
--   alter policy system_config_read on public.system_config
--     using ((select auth.role()) = 'authenticated' or key = any (array['maintenance_mode',
--       'maintenance_message','allow_signups','registration_open','require_approval','app_version',
--       'default_currency','password_min_length','two_factor_required','session_timeout_hours']));
--   get_console_stats: re-create without the first IF block.
