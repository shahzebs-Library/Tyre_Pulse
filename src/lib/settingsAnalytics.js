/**
 * settingsAnalytics - pure engine behind the Settings page (/settings).
 *
 * The Settings page used to compute its derived facts inline (schedule labels,
 * threshold read-outs, "how much of this is configured"). They live here so
 * the page is presentation only and every rule is tested:
 *
 *   SETTINGS_TABS / resolveSettingsTab   which ?tab= values exist, per role
 *   scheduleLabel / scheduleNextRun      the delivery cadence, in Riyadh time
 *   scheduleRows / summarizeSchedules    the Scheduled Reports register + KPIs
 *   filterSchedules                      search + status + frequency filters
 *   kpiTargetCoverage                    how many KPI targets are set
 *   thresholdRows                        read-only threshold list for non-admins
 *   settingsOverview                     the KPI strip at the top of the page
 *
 * Honest nulls: a figure that was not read (a failed load) is null and the
 * page renders N/A. Nothing here reads the clock: `now` is injected.
 */

const arr = (v) => (Array.isArray(v) ? v : [])

// Delivery runs in Riyadh (UTC+3, no daylight saving) - the same zone the
// send-scheduled-reports function uses to fire each schedule.
export const DELIVERY_TZ_OFFSET_MIN = 180

export const SETTINGS_TABS = [
  { id: 'general', label: 'Profile & preferences' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'alerts', label: 'Alerts & targets' },
  { id: 'reports', label: 'Reports & data' },
  { id: 'security', label: 'Security & account' },
  { id: 'about', label: 'About' },
]

/** An unknown or missing ?tab= resolves to the first tab. */
export function resolveSettingsTab(value) {
  return SETTINGS_TABS.some((t) => t.id === value) ? value : SETTINGS_TABS[0].id
}

export const DOW_TO_NUM = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }

/** Human cadence, ASCII only. */
export function scheduleLabel(s) {
  if (!s) return 'N/A'
  const time = s.time || '06:00'
  if (s.frequency === 'Daily') return `Daily at ${time}`
  if (s.frequency === 'Weekly') return `Weekly on ${s.dayOfWeek || 'Monday'} at ${time}`
  return `Monthly on day ${s.dayOfMonth || 1} at ${time}`
}

function parseHm(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''))
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return { h, min }
}

/**
 * The next delivery instant for an ACTIVE schedule, as a Date (UTC). Paused
 * schedules and unparseable times return null. Computed in delivery-zone
 * wall time so a 06:00 schedule means 06:00 in Riyadh whatever the browser.
 */
export function scheduleNextRun(s, now = new Date()) {
  if (!s || s.active === false) return null
  const hm = parseHm(s.time)
  const base = now instanceof Date ? now : new Date(now)
  if (!hm || Number.isNaN(base.getTime())) return null
  const off = DELIVERY_TZ_OFFSET_MIN * 60000
  // Work in a shifted clock whose UTC fields read as Riyadh wall time.
  const local = new Date(base.getTime() + off)
  const at = (y, mo, d) => new Date(Date.UTC(y, mo, d, hm.h, hm.min) - off)
  const y = local.getUTCFullYear()
  const mo = local.getUTCMonth()
  const d = local.getUTCDate()

  if (s.frequency === 'Weekly') {
    const target = DOW_TO_NUM[s.dayOfWeek] ?? 1
    for (let i = 0; i <= 7; i++) {
      const cand = at(y, mo, d + i)
      const dow = new Date(cand.getTime() + off).getUTCDay()
      if (dow === target && cand > base) return cand
    }
    return null
  }
  if (s.frequency === 'Monthly') {
    const day = Math.min(Math.max(Number(s.dayOfMonth) || 1, 1), 28)
    const thisMonth = at(y, mo, day)
    return thisMonth > base ? thisMonth : at(y, mo + 1, day)
  }
  const today = at(y, mo, d)
  return today > base ? today : at(y, mo, d + 1)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseRecipients(text) {
  return String(text || '').split(',').map((e) => e.trim()).filter(Boolean)
}

/** Register rows: each schedule plus its label, next run and recipient check. */
export function scheduleRows(schedules, now = new Date()) {
  return arr(schedules).map((s) => {
    const recipients = parseRecipients(s.recipients)
    const invalid = recipients.filter((e) => !EMAIL_RE.test(e))
    const next = scheduleNextRun(s, now)
    return {
      ...s,
      label: scheduleLabel(s),
      nextRun: next ? next.toISOString() : null,
      recipientList: recipients,
      recipientCount: recipients.length,
      invalidRecipients: invalid,
      status: s.active === false ? 'Paused' : 'Active',
    }
  })
}

export function summarizeSchedules(rows) {
  const list = arr(rows)
  const active = list.filter((r) => r.active !== false)
  const distinct = new Set()
  for (const r of list) for (const e of arr(r.recipientList)) distinct.add(e.toLowerCase())
  const nextRuns = active.map((r) => r.nextRun).filter(Boolean).sort()
  const byFrequency = {}
  for (const r of list) byFrequency[r.frequency] = (byFrequency[r.frequency] || 0) + 1
  return {
    total: list.length,
    active: active.length,
    paused: list.length - active.length,
    recipients: distinct.size,
    withInvalidRecipients: list.filter((r) => arr(r.invalidRecipients).length > 0).length,
    withNoRecipients: list.filter((r) => (r.recipientCount || 0) === 0).length,
    nextRun: nextRuns[0] || null,
    byFrequency,
  }
}

export function filterSchedules(rows, { q = '', status = 'all', frequency = 'all' } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  return arr(rows).filter((r) => {
    if (status === 'active' && r.active === false) return false
    if (status === 'paused' && r.active !== false) return false
    if (frequency !== 'all' && r.frequency !== frequency) return false
    if (!needle) return true
    return [r.reportName, r.recipients, r.label].some((f) => String(f || '').toLowerCase().includes(needle))
  })
}

/** How many KPI targets carry a value. `targets` null = not loaded. */
export function kpiTargetCoverage(targets, fields) {
  const keys = arr(fields).map((f) => f.key)
  if (!targets) return { set: null, total: keys.length }
  const set = keys.filter((k) => {
    const v = targets[k]
    return v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v))
  }).length
  return { set, total: keys.length }
}

function fmtNum(v, suffix = '') {
  const n = Number(v)
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) return 'N/A'
  return `${n.toLocaleString('en-US')}${suffix}`
}

/** Read-only threshold list (legacy local values + synced extended values). */
export function thresholdRows({ highRiskPct, critCostThresh, lowTreadMm } = {}, extended = {}, extendedFields = []) {
  return [
    { group: 'Legacy', key: 'thresh_highRisk', label: 'High Risk Threshold', value: fmtNum(highRiskPct, '%') },
    { group: 'Legacy', key: 'thresh_critCost', label: 'Critical Cost Threshold', value: fmtNum(critCostThresh) },
    { group: 'Legacy', key: 'thresh_lowTread', label: 'Low Tread Depth', value: fmtNum(lowTreadMm, ' mm') },
    ...arr(extendedFields).map((f) => ({ group: 'Extended', key: f.key, label: f.label, value: fmtNum(extended?.[f.key]) })),
  ]
}

/**
 * The KPI strip. Every input may be null (not loaded / failed) and the matching
 * figure is then null, never a reassuring zero.
 */
export function settingsOverview({ schedules = null, kpiTargets = null, kpiFields = [], channelCount = null, mfaEnabled = null, uploads = null } = {}) {
  const sched = schedules ? summarizeSchedules(schedules) : null
  const coverage = kpiTargetCoverage(kpiTargets, kpiFields)
  const lastUpload = Array.isArray(uploads) && uploads.length
    ? uploads.map((u) => u.uploaded_at).filter(Boolean).sort().slice(-1)[0] || null
    : null
  return {
    schedulesActive: sched ? sched.active : null,
    schedulesTotal: sched ? sched.total : null,
    nextDelivery: sched ? sched.nextRun : null,
    kpiTargetsSet: coverage.set,
    kpiTargetsTotal: coverage.total,
    channelsOn: Number.isFinite(channelCount) ? channelCount : null,
    mfaEnabled: typeof mfaEnabled === 'boolean' ? mfaEnabled : null,
    lastUpload: uploads == null ? null : lastUpload,
    uploadsKnown: uploads != null,
  }
}
