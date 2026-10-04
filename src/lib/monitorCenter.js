/**
 * monitorCenter.js - pure shaping for the Control Center MONITOR screens
 * (Error Center, Alert Center, Analytics, Notifications, Operations).
 *
 * No I/O. Every function takes the RPC payloads from src/lib/api/monitorCenter.js
 * and returns what a screen draws. Rules kept here so they are tested once:
 *   - unknown stays null (the screen prints N/A with a reason), never 0
 *   - money is never added across currencies (nothing here sums money)
 *   - percentages are rounded for display only; raw counts travel alongside
 */

export const nf = new Intl.NumberFormat('en-US')

/** Integer with separators, or N/A for a missing value. */
export function fmtNum(v) {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return 'N/A'
  return nf.format(Number(v))
}

/** "15%" from a part and a whole; null when the whole is 0 or unknown. */
export function pctOf(part, whole, digits = 0) {
  const p = Number(part); const w = Number(whole)
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return null
  const f = 10 ** digits
  return Math.round((p / w) * 100 * f) / f
}

export function fmtPct(v) { return v === null || v === undefined ? 'N/A' : `${v}%` }

/** Mask an email to a***@x.com. Anything without an @ comes back null. */
export function maskEmail(email) {
  const s = String(email || '')
  const at = s.indexOf('@')
  if (at < 1) return null
  return `${s[0]}***@${s.slice(at + 1)}`
}

/** Short Riyadh date, e.g. "19 Aug". Null for a missing or bad value. */
export function shortDate(v) {
  if (!v) return null
  const d = new Date(v)
  if (!Number.isFinite(d.getTime())) return null
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Riyadh' })
}

/** Riyadh date and time, e.g. "30 Sep 11:15". */
export function riyadhDateTime(v) {
  if (!v) return null
  const d = new Date(v)
  if (!Number.isFinite(d.getTime())) return null
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Riyadh' })
}

/** Whole days between a time and now, or null. */
export function daysSince(v, now = Date.now()) {
  if (!v) return null
  const t = new Date(v).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

/* ── Error Center ─────────────────────────────────────────────────────────── */

export const ERROR_STATUSES = [
  { key: 'for_review', label: 'For review', tone: 'warning' },
  { key: 'reviewed', label: 'Reviewed (has owner)', tone: 'info' },
  { key: 'fixed_in_code', label: 'Fixed, waiting release', tone: 'accent' },
  { key: 'routine', label: 'Routine notices', tone: 'quiet' },
  { key: 'resolved', label: 'Resolved', tone: 'good' },
  { key: 'ignored', label: 'Ignored', tone: 'quiet' },
]
export const ERROR_STATUS_META = Object.fromEntries(ERROR_STATUSES.map((s) => [s.key, s]))

const SEV_RANK = { critical: 4, error: 3, warning: 2, info: 1 }

/**
 * Effective triage status of a group. A stored state wins; with none, info and
 * warning rows from background jobs are Routine and everything else is For review.
 */
export function groupStatus(g) {
  if (g?.state?.status) return g.state.status
  const bg = (g?.surfaces || []).every((s) => s === 'background')
  if (g?.severity === 'info' || (g?.severity === 'warning' && bg)) return 'routine'
  return 'for_review'
}

/** Where an error happened, in words. */
export function surfaceLabel(g) {
  const s = new Set(g?.surfaces || [])
  if (s.has('android')) return 'Android app'
  if (s.has('web')) return 'Web app'
  return 'Background job'
}

/** People affected in words: "1 staff", "3 customers, 1 staff", "N/A no user id". */
export function peopleLabel(g) {
  const staff = Number(g?.staff) || 0
  const cust = Number(g?.customers) || 0
  if (!staff && !cust) return { value: null, note: 'no user id' }
  const parts = []
  if (cust) parts.push(`${cust} customer${cust === 1 ? '' : 's'}`)
  if (staff) parts.push(`${staff} staff`)
  return { value: staff + cust, note: parts.join(', ') }
}

/** Title for a group: the latest raw message, trimmed. */
export function groupTitle(g) {
  const s = String(g?.sample || g?.key || '').replace(/\s+/g, ' ').trim()
  return s.length > 140 ? `${s.slice(0, 137)}...` : s || 'Untitled error'
}

/**
 * Facet counts for the rail: by status, severity, surface, who hit it. Counts
 * are GROUPS (the unit the table shows), with events alongside.
 */
export function errorFacets(groups = []) {
  const out = { status: {}, severity: {}, surface: {}, who: { customers: 0, staff: 0, none: 0 } }
  for (const g of groups) {
    const st = groupStatus(g)
    out.status[st] = (out.status[st] || 0) + 1
    out.severity[g.severity] = (out.severity[g.severity] || 0) + 1
    const sf = surfaceLabel(g)
    out.surface[sf] = (out.surface[sf] || 0) + 1
    if (Number(g.customers) > 0) out.who.customers += 1
    if (Number(g.staff) > 0) out.who.staff += 1
    if (!Number(g.customers) && !Number(g.staff)) out.who.none += 1
  }
  return out
}

/** Filter + sort groups for the table. */
export function filterErrorGroups(groups = [], { q = '', status = '', severity = '', surface = '', who = '', sort = 'newest' } = {}) {
  const needle = q.trim().toLowerCase()
  const rows = groups.filter((g) => {
    if (status && groupStatus(g) !== status) return false
    if (severity && g.severity !== severity) return false
    if (surface && surfaceLabel(g) !== surface) return false
    if (who === 'customers' && !(Number(g.customers) > 0)) return false
    if (who === 'staff' && !(Number(g.staff) > 0)) return false
    if (who === 'none' && (Number(g.customers) > 0 || Number(g.staff) > 0)) return false
    if (needle) {
      const hay = `${g.sample || ''} ${(g.urls || []).join(' ')} ${(g.sources || []).join(' ')}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })
  const by = {
    newest: (a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')),
    events: (a, b) => (Number(b.events) || 0) - (Number(a.events) || 0),
    people: (a, b) => ((Number(b.staff) || 0) + (Number(b.customers) || 0)) - ((Number(a.staff) || 0) + (Number(a.customers) || 0)),
    severity: (a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0),
  }
  return [...rows].sort(by[sort] || by.newest)
}

/** Daily series for the trend chart: last N days, zero-filled, Riyadh days. */
export function dailySeries(daily = [], days = 14, now = new Date()) {
  const map = new Map((daily || []).map((d) => [String(d.day), d]))
  const labels = []; const total = []; const errors = []
  for (let i = days - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 86_400_000)
    const key = t.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
    const row = map.get(key)
    labels.push(t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Riyadh' }))
    total.push(row ? Number(row.total) || 0 : 0)
    errors.push(row ? Number(row.errors) || 0 : 0)
  }
  return { labels, total, errors }
}

/* ── Alert Center ─────────────────────────────────────────────────────────── */

export const ALERT_SOURCES = [
  { key: 'error_log', label: 'Error log' },
  { key: 'crash', label: 'Crash reports' },
  { key: 'upload_gap', label: 'Upload gaps' },
  { key: 'security', label: 'Security scan' },
  { key: 'trust', label: 'Data trust' },
  { key: 'incident', label: 'Incidents' },
]
export const ALERT_SOURCE_LABEL = Object.fromEntries(ALERT_SOURCES.map((s) => [s.key, s.label]))

export const ALERT_SEVERITY = {
  critical: { label: 'Critical', tone: 'danger', rank: 5 },
  high: { label: 'High', tone: 'danger', rank: 4 },
  medium: { label: 'Medium', tone: 'warning', rank: 3 },
  low: { label: 'Low', tone: 'default', rank: 2 },
  info: { label: 'Info', tone: 'info', rank: 1 },
}

/** Which inbox group an alert belongs to. */
export function alertGroup(a) {
  if (a?.recovered) return 'fixed'
  if (a?.severity === 'low' || a?.severity === 'info') return 'routine'
  return 'person'
}
export const ALERT_GROUPS = [
  { key: 'person', label: 'Needs a person' },
  { key: 'fixed', label: 'Probably already fixed' },
  { key: 'routine', label: 'Routine' },
]

/** Inbox tab an alert sits in. New and acknowledged both count as Open. */
export function alertTab(a) {
  const s = a?.state || 'new'
  if (s === 'snoozed') return 'snoozed'
  if (s === 'resolved') return 'resolved'
  if (s === 'acknowledged') return 'acknowledged'
  return 'open'
}

export function filterAlerts(items = [], { tab = 'open', q = '', source = '', severity = '', owner = '' } = {}) {
  const needle = q.trim().toLowerCase()
  return items.filter((a) => {
    const t = alertTab(a)
    if (tab === 'open' ? !(t === 'open' || t === 'acknowledged') : t !== tab) return false
    if (source && a.source !== source) return false
    if (severity && a.severity !== severity) return false
    if (owner === 'none' && a.owner_id) return false
    if (owner && owner !== 'none' && a.owner_id !== owner) return false
    if (needle && !`${a.title} ${a.detail} ${a.affected}`.toLowerCase().includes(needle)) return false
    return true
  }).sort((a, b) => (ALERT_SEVERITY[b.severity]?.rank || 0) - (ALERT_SEVERITY[a.severity]?.rank || 0))
}

export function alertTabCounts(items = []) {
  const c = { open: 0, acknowledged: 0, snoozed: 0, resolved: 0 }
  for (const a of items) {
    const t = alertTab(a)
    if (t === 'open') c.open += 1
    if (t === 'acknowledged') { c.acknowledged += 1; c.open += 1 }
    if (t === 'snoozed') c.snoozed += 1
    if (t === 'resolved') c.resolved += 1
  }
  return c
}

/** "177 of 229 (77%) are routine": from the error log source tile. */
export function noiseCheck(errorLog) {
  const total = Number(errorLog?.unresolved)
  const routine = Number(errorLog?.routine)
  if (!Number.isFinite(total) || !Number.isFinite(routine) || total <= 0) return null
  return { routine, total, pct: pctOf(routine, total) }
}

/**
 * Plain-English sentence for an alert rule, including the Wait / Remind /
 * Recover lines when set.
 */
export function ruleSentence(r = {}) {
  const op = { gt: 'is above', gte: 'is at least', lt: 'is below', lte: 'is at most', eq: 'equals' }[r.operator] || r.operator || 'crosses'
  const parts = [`If ${r.metric || 'the metric'} ${op} ${r.threshold ?? 'N/A'}`]
  if (Number(r.pending_checks) > 1) parts.push(`for ${r.pending_checks} checks in a row`)
  const chans = [r.notify_in_app ? 'in the app' : null, r.notify_email ? 'by email' : null].filter(Boolean)
  parts.push(`then tell admins ${chans.length ? chans.join(' and ') : 'nowhere yet'}`)
  if (Number(r.renotify_minutes) > 0) {
    const h = Math.round((Number(r.renotify_minutes) / 60) * 10) / 10
    parts.push(`remind every ${h} h${Number(r.renotify_max) > 0 ? `, at most ${r.renotify_max} times` : ''}`)
  }
  if (Number(r.recover_after_hours) > 0) parts.push(`close it after ${r.recover_after_hours} h back to normal`)
  return `${parts.join(', ')}.`
}

/* ── Analytics ────────────────────────────────────────────────────────────── */

export const MODULE_LABELS = {
  expense_lines: 'Expense lines', job_cards: 'Job cards', inspections: 'Inspections',
  meter_readings: 'Meter readings', tyre_records: 'Tyre records', checklists: 'Checklists', accidents: 'Accidents',
}

/**
 * Per-module records table: today / last 7 / previous 7 / 30 days, change and
 * share of 30 days. `now` is a Date; days are Riyadh calendar days.
 */
export function moduleTable(daily = [], now = new Date()) {
  const dayKey = (offset) => new Date(now.getTime() - offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
  const today = dayKey(0)
  const last7 = new Set(Array.from({ length: 7 }, (_, i) => dayKey(i)))
  const prev7 = new Set(Array.from({ length: 7 }, (_, i) => dayKey(i + 7)))
  const last30 = new Set(Array.from({ length: 30 }, (_, i) => dayKey(i)))
  const rows = {}
  for (const d of daily || []) {
    const m = d.module
    rows[m] = rows[m] || { module: m, label: MODULE_LABELS[m] || m, today: 0, last7: 0, prev7: 0, d30: 0 }
    const n = Number(d.n) || 0
    const k = String(d.day)
    if (k === today) rows[m].today += n
    if (last7.has(k)) rows[m].last7 += n
    if (prev7.has(k)) rows[m].prev7 += n
    if (last30.has(k)) rows[m].d30 += n
  }
  for (const m of Object.keys(MODULE_LABELS)) {
    rows[m] = rows[m] || { module: m, label: MODULE_LABELS[m], today: 0, last7: 0, prev7: 0, d30: 0 }
  }
  const list = Object.values(rows)
  const total30 = list.reduce((a, r) => a + r.d30, 0)
  for (const r of list) {
    r.change = r.prev7 > 0 ? Math.round(((r.last7 - r.prev7) / r.prev7) * 100) : (r.last7 > 0 ? 'new' : null)
    r.share = pctOf(r.d30, total30)
  }
  list.sort((a, b) => b.d30 - a.d30)
  const totals = list.reduce((a, r) => ({ today: a.today + r.today, last7: a.last7 + r.last7, prev7: a.prev7 + r.prev7, d30: a.d30 + r.d30 }), { today: 0, last7: 0, prev7: 0, d30: 0 })
  totals.change = totals.prev7 > 0 ? Math.round(((totals.last7 - totals.prev7) / totals.prev7) * 100) : null
  return { rows: list, totals }
}

/** Records written per day, all modules, last N days (zero-filled). */
export function recordsPerDay(daily = [], days = 30, now = new Date()) {
  const sums = new Map()
  for (const d of daily || []) sums.set(String(d.day), (sums.get(String(d.day)) || 0) + (Number(d.n) || 0))
  const labels = []; const values = []; const keys = []
  for (let i = days - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 86_400_000)
    const key = t.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' })
    keys.push(key)
    labels.push(t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Riyadh' }))
    values.push(sums.get(key) || 0)
  }
  let peak = null
  values.forEach((v, i) => { if (v > 0 && (!peak || v > peak.value)) peak = { value: v, label: labels[i], key: keys[i] } })
  return { labels, values, peak }
}

/** Stickiness = 7-day active over 30-day active, as a percent. */
export function stickiness(d7, d30) { return pctOf(d7, d30) }

/** A metric is Certified when a stored status says so, or (no status) it is complete. */
export function metricCertified(m) {
  if (m?.status) return m.status === 'certified'
  return Boolean(m?.business_owner && m?.refresh_sla && m?.calc_ref && Array.isArray(m?.dashboards) && m.dashboards.length)
}

/* ── Notifications ────────────────────────────────────────────────────────── */

export const EVENT_LABELS = {
  'inspection.approval_requested': 'Inspection waiting for approval',
  'workflow.step_advanced': 'Workflow step assigned or decided',
  'checklist.approval_requested': 'Checklist waiting for sign-off',
  'upload.gap_detected': 'Upload gap reminder',
}
export const BELL_TYPE_LABELS = {
  approval: 'Approval requests', approval_decision: 'Approval decisions', upload_gap: 'Upload gap notices',
  security: 'Security notices', escalation: 'Escalations', accident: 'Accident updates', system: 'System messages',
}

export function eventLabel(t) { return EVENT_LABELS[t] || String(t || 'Other').replace(/[._]/g, ' ') }

/** Seconds as "2.0 min" / "45 s"; N/A when unknown. */
export function fmtDuration(sec) {
  const s = Number(sec)
  if (sec === null || sec === undefined || !Number.isFinite(s)) return 'N/A'
  if (s < 90) return `${Math.round(s)} s`
  if (s < 5400) return `${(s / 60).toFixed(1)} min`
  return `${(s / 3600).toFixed(1)} h`
}

/* ── Operations ───────────────────────────────────────────────────────────── */

export const BATCH_STATUS = {
  committed: { label: 'Imported', tone: 'good' },
  failed: { label: 'Failed', tone: 'danger' },
  staged: { label: 'Never approved', tone: 'warning' },
  reversed: { label: 'Undone', tone: 'info' },
}

export function batchStatus(b) {
  const s = String(b?.import_status || '').toLowerCase()
  return BATCH_STATUS[s] ? s : 'other'
}

export function batchStatusCounts(batches = []) {
  const c = { all: batches.length, committed: 0, failed: 0, staged: 0, reversed: 0, other: 0 }
  for (const b of batches) c[batchStatus(b)] = (c[batchStatus(b)] || 0) + 1
  return c
}

/** Plain-English change line for one batch. */
export function batchChangeLine(b) {
  const n = Number(b?.imported_rows) || 0
  const mod = b?.module || 'rows'
  switch (batchStatus(b)) {
    case 'committed': return n ? `Added ${fmtNum(n)} ${mod} rows.` : 'Finished, but nothing was added.'
    case 'failed': return 'The upload failed and nothing was saved.'
    case 'staged': return 'Uploaded and previewed, but never approved. Nothing was written.'
    case 'reversed': return 'Imported and then undone. Those rows were removed again.'
    default: return 'Status not recorded.'
  }
}

/**
 * Two uploads of the same module + country with the same imported row count
 * inside 3 days look like the same file sent twice. Returns a Set of batch ids.
 */
export function possibleRepeats(batches = [], windowDays = 3) {
  const out = new Set()
  const done = batches.filter((b) => batchStatus(b) === 'committed' && Number(b.imported_rows) > 0)
  for (let i = 0; i < done.length; i++) {
    for (let j = i + 1; j < done.length; j++) {
      const a = done[i]; const b = done[j]
      if (a.module !== b.module || a.country !== b.country || Number(a.imported_rows) !== Number(b.imported_rows)) continue
      const gap = Math.abs(new Date(a.created_at) - new Date(b.created_at)) / 86_400_000
      if (gap <= windowDays) out.add(new Date(a.created_at) > new Date(b.created_at) ? a.id : b.id)
    }
  }
  return out
}

/** Readable cron schedule for the common shapes; the raw text otherwise. Times in Riyadh (UTC+3). */
export function describeSchedule(expr) {
  const s = String(expr || '').trim()
  if (s === '* * * * *') return 'Every minute'
  let m = s.match(/^\*\/(\d+) \* \* \* \*$/)
  if (m) return `Every ${m[1]} min`
  m = s.match(/^(\d+) \* \* \* \*$/)
  if (m) return `Hourly at :${m[1].padStart(2, '0')}`
  const at = (min, hr) => {
    const h = (Number(hr) + 3) % 24
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }
  m = s.match(/^(\d+) (\d+) \* \* \*$/)
  if (m) return `Daily ${at(m[1], m[2])}`
  m = s.match(/^(\d+) (\d+) \* \* (\d)$/)
  if (m) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return `${days[Number(m[3]) % 7]} ${at(m[1], m[2])}`
  }
  return s
}

/** State of a scheduled job for the table. */
export function jobState(j) {
  if (!j) return { label: 'Unknown', tone: 'quiet' }
  if (!j.active) return { label: 'Paused', tone: 'quiet' }
  if (j.stuck) return { label: 'Stuck', tone: 'danger' }
  if (Number(j.fail_streak) > 0 || Number(j.failed_nd) > 0) return { label: `${j.failed_nd} failed`, tone: 'danger' }
  if (Number(j.missed_nd) > 0) {
    const perDay = Number(j.period_min) >= 1440
    return { label: perDay ? `${j.missed_nd} day${j.missed_nd === 1 ? '' : 's'} missed` : `${j.missed_nd} runs missed`, tone: 'warning' }
  }
  return { label: 'OK', tone: 'good' }
}
