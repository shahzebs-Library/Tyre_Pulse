/**
 * Pure rules behind System Configuration: the allowed range and unit of each
 * number setting, who a change affects in plain English, which changes are
 * risky enough to need a reason and a typed confirmation, and a summary of
 * the recorded change history (system_config_history, from 30 Sep 2026).
 *
 * No I/O here so every rule is unit tested.
 */

const DAY = 86400000

/** Range, unit and audience for every control on the page. */
export const CONTROL_META = Object.freeze({
  maintenance_mode: { who: 'Every non-admin account on the web app. Super admins and Admins still get in.' },
  registration_open: { who: 'People who do not have an account yet. Existing accounts are not affected.' },
  require_approval: { who: 'New sign-ups only. Off means a new account can sign in straight away.' },
  app_version: { who: 'Shown in the sidebar footer for everyone. Does not force an update.' },
  max_upload_rows: { min: 100, max: 1000000, unit: 'rows', who: 'Anyone importing a spreadsheet through Data Intake.' },
  ai_enabled: { who: 'Every AI feature for every organisation (Fleet AI, analysis, summaries).' },
  ai_model: { who: 'Nobody today. The model is locked on the server for safety.' },
  ai_monthly_budget_usd: { min: 0, max: 100000, unit: 'USD a month', who: 'All AI calls stop for the month once spend reaches this. 0 means no cap.' },
  ai_rate_limit_per_min: { min: 0, max: 1000, unit: 'requests a minute', who: 'Each user calling AI. 0 means no limit.' },
  ai_cache_ttl_hours: { min: 0, max: 720, unit: 'hours', who: 'How fresh AI answers are. Lower costs more.' },
  session_timeout_hours: { min: 0, max: 168, unit: 'hours', who: 'Web app users only. Phones and the console (10 minute idle) are not changed. 0 means no idle sign-out.' },
  max_login_attempts: { min: 0, max: 50, unit: 'attempts', who: 'Anyone signing in. A low number can lock out people who mistype. 0 means no lockout.' },
  password_min_length: { min: 6, max: 64, unit: 'characters', who: 'New passwords and password resets on web and the Flutter app. Existing passwords keep working.' },
  two_factor_required: { who: 'Admin accounts. They are asked to enrol an authenticator app.' },
  audit_retention_days: { min: 0, max: 3650, unit: 'days', who: 'Audit and error logs older than this are deleted every night. 0 keeps them forever. Business records are never touched.' },
  email_notifications: { who: 'Every transactional email: approvals, alerts, password resets, scheduled reports.' },
  alert_email: { who: 'Nobody today. Sentry alerts use their own address.' },
  digest_frequency: { who: 'Nobody today. Each scheduled report keeps its own cadence.' },
  push_notifications: { who: 'Push messages to the Flutter app on every phone.' },
  data_retention_months: { min: 0, max: 240, unit: 'months', who: 'Nobody today. Business records are protected from automatic deletion.' },
  backup_enabled: { who: 'The nightly backup snapshot. Off means no new restore point is taken.' },
  export_enabled: { who: 'Every Excel, PDF and PowerPoint download for everyone.' },
  max_export_rows: { min: 100, max: 1000000, unit: 'rows', who: 'Anyone downloading a report. Larger files take longer.' },
})

const on = (v) => v === true || v === 'true'

/**
 * Is this change risky? Returns null for an ordinary change, otherwise
 * { tone, word, why } where `word` must be typed to confirm.
 */
export function riskFor(key, from, to) {
  if (key === 'maintenance_mode' && on(to) && !on(from)) return { tone: 'danger', word: 'MAINTENANCE', why: 'Locks every regular user out at once.' }
  if (key === 'export_enabled' && !on(to) && on(from ?? 'true')) return { tone: 'danger', word: 'EXPORTS OFF', why: 'Stops every download for everyone.' }
  if (key === 'backup_enabled' && !on(to) && on(from ?? 'true')) return { tone: 'danger', word: 'NO BACKUPS', why: 'No new nightly restore point is taken.' }
  if (key === 'ai_enabled' && !on(to) && on(from ?? 'true')) return { tone: 'warning', word: null, why: 'Turns off every AI feature.' }
  if (key === 'email_notifications' && !on(to) && on(from ?? 'true')) return { tone: 'warning', word: null, why: 'Password reset and approval emails stop.' }
  if (key === 'two_factor_required' && !on(to) && on(from)) return { tone: 'warning', word: null, why: 'Admins are no longer asked for a second factor.' }
  if (key === 'require_approval' && !on(to) && on(from ?? 'true')) return { tone: 'warning', word: null, why: 'Anyone who signs up gets in without review.' }
  if (key === 'audit_retention_days' && String(from ?? '') !== String(to ?? '')) {
    const n = Number(to)
    if (Number.isFinite(n) && n > 0) return { tone: 'danger', word: 'DELETE LOGS', why: `Audit and error logs older than ${n} days are deleted at the next nightly run.` }
  }
  return null
}

/** Range check for a number control: null when fine, else a sentence. */
export function rangeError(key, raw) {
  const meta = CONTROL_META[key]
  if (!meta || meta.max == null || raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return 'Must be a number.'
  if (n < 0) return 'Cannot be negative.'
  if (meta.min != null && n < meta.min) return `At least ${meta.min}${meta.unit ? ` ${meta.unit}` : ''}.`
  if (meta.max != null && n > meta.max) return `At most ${meta.max.toLocaleString('en-US')}${meta.unit ? ` ${meta.unit}` : ''}.`
  return null
}

/** "100 to 1,000,000 rows" style hint, or '' when the control has no range. */
export function rangeHint(key) {
  const m = CONTROL_META[key]
  if (!m || m.max == null) return ''
  return `${m.min.toLocaleString('en-US')} to ${m.max.toLocaleString('en-US')} ${m.unit || ''}`.trim()
}

/**
 * Summarise history rows (newest first or any order).
 * Returns { latest: {key: row}, changed30: number of distinct keys changed
 * in the last 30 days, authors: distinct people recorded }.
 */
export function summarizeHistory(rows = [], now = Date.now()) {
  const latest = {}
  const recent = new Set()
  const authors = new Set()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.key) continue
    const t = new Date(r.changed_at).getTime()
    const prev = latest[r.key]
    if (!prev || new Date(prev.changed_at).getTime() < t) latest[r.key] = r
    if (Number.isFinite(t) && now - t <= 30 * DAY) recent.add(r.key)
    if (r.changed_by) authors.add(r.changed_by)
  }
  return { latest, changed30: recent.size, authors: authors.size }
}

/** Mask anything that looks like an email address. */
export function maskEmails(text) {
  return String(text ?? '').replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2')
}
