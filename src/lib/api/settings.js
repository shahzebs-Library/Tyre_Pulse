/**
 * Settings service - the exact reads/writes the Settings screen consumes across
 * its app-settings, profile, alert-threshold, KPI-target, report-schedule and
 * account-security (auth/MFA) sections.
 *
 * Read-only/write pass-throughs: each returns the raw Supabase query builder
 * (thenable) or auth promise the page reads via `.data` / `.error`, preserving
 * the page's existing destructuring, `Promise.all` and error handling exactly.
 * Explicit column lists where the page used them (no widening of selects).
 * Additive only - mirrors dashboard.js. `settings` and `app_settings` are two
 * distinct tables and stay distinct here.
 */
import { supabase } from './_client'

/** All global key/value settings rows the page hydrates `appSettings` from. */
export function listSettings() {
  return supabase.from('settings').select('key, value')
}

/** Three most-recent upload history rows for the "recent uploads" panel. */
export function listUploadHistory() {
  return supabase
    .from('upload_history')
    .select('id, file_names, records_added, records_skipped, uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(3)
}

/** KPI target rows for a given year, hydrating the KPI-targets editor. */
export function listKpiTargetsByYear(year) {
  return supabase.from('kpi_targets').select('*').eq('year', year)
}

/** The single `alert_thresholds` app_settings row (JSON value). */
export function getAlertThresholds() {
  return supabase.from('app_settings').select('value').eq('key', 'alert_thresholds').single()
}

/** Upsert one global `settings` row (onConflict: key). Page builds the row. */
export function upsertSetting(row) {
  return supabase.from('settings').upsert(row, { onConflict: 'key' })
}

/** Upsert one `app_settings` row (onConflict: key). Page builds the row. */
export function upsertAppSetting(row) {
  return supabase.from('app_settings').upsert(row, { onConflict: 'key' })
}

/** Update the caller's profile by id with the given patch. */
export function updateProfile(id, patch) {
  return supabase.from('profiles').update(patch).eq('id', id)
}

/** Bulk-upsert KPI target rows (onConflict: metric,year,month,site). */
export function upsertKpiTargets(rows) {
  return supabase.from('kpi_targets').upsert(rows, { onConflict: 'metric,year,month,site' })
}

/** All report schedules, oldest first, with the columns the section renders. */
export function listReportSchedules() {
  return supabase
    .from('report_schedules')
    .select('id,name,report_type,frequency,day_of_week,day_of_month,time_of_day,recipients,active')
    .order('created_at', { ascending: true })
}

/** Insert a new report schedule row (built by the page). */
export function insertReportSchedule(row) {
  return supabase.from('report_schedules').insert(row)
}

/** Delete a report schedule by id, returning the deleted id(s) for verification. */
export function deleteReportSchedule(id) {
  return supabase.from('report_schedules').delete().eq('id', id).select('id')
}

/** Update a report schedule by id with the given patch. */
export function updateReportSchedule(id, patch) {
  return supabase.from('report_schedules').update(patch).eq('id', id)
}

/** Update the signed-in user's password (Supabase Auth). */
export function updatePassword(password) {
  return supabase.auth.updateUser({ password })
}

/** List the user's enrolled MFA factors. */
export function listMfaFactors() {
  return supabase.auth.mfa.listFactors()
}

/** Unenroll a single MFA (TOTP) factor by id. */
export function unenrollMfaFactor(factorId) {
  return supabase.auth.mfa.unenroll({ factorId })
}
