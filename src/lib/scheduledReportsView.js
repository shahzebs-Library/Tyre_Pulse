/**
 * scheduledReportsView - pure shaping for the rebuilt Scheduled Reports page
 * (registry table, KPI tiles, schedule health donut, 7-day delivery trend and
 * recent activity). No I/O; every time-relative helper takes `now`.
 *
 * Sources it shapes (read by the page): report_schedules rows and
 * report_send_log runs. Honesty rules:
 *   - A month-on-month trend is returned only when the previous month lies
 *     fully inside the loaded delivery window AND had a non-zero count.
 *   - "Expected" runs in the trend are derived from each ACTIVE schedule's
 *     current cadence settings; they are an expectation, not a stored record.
 *   - Who paused a schedule is not recorded, so activity only lists real
 *     deliveries (sent / failed) from report_send_log.
 */

const DAY = 86400000
const toMs = (v) => (v instanceof Date ? v.getTime() : Number(v))

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** report_type -> the module it reports on (registry "Module" column). */
export const MODULE_OF = {
  executive: 'Executive',
  kpi: 'Tyres',
  fleet: 'Fleet',
  cost: 'Finance',
  inspection: 'Compliance',
  accidents: 'Safety',
  claims: 'Insurance',
  stock: 'Inventory',
  vendor: 'Procurement',
  pm: 'Maintenance',
  workshop: 'Workshop',
}

export function moduleOf(reportType) {
  const t = String(reportType || '')
  if (t.startsWith('builder:')) return 'Custom layout'
  return MODULE_OF[t] || 'Other'
}

export const MODULE_OPTIONS = [...new Set([...Object.values(MODULE_OF), 'Custom layout'])]

/** '07:00' / '07:00:00' -> '07:00 AM'. Null for a blank or junk value. */
export function time12(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''))
  if (!m) return null
  const h = Number(m[1]); const min = m[2]
  if (h > 23) return null
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${String(h12).padStart(2, '0')}:${min} ${suffix}`
}

export function ordinal(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  const s = v % 100 >= 11 && v % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')
  return `${v}${s}`
}

/** Two-line cadence label: { line1: 'Weekly', line2: 'Mon 07:00 AM' }. */
export function scheduleLabel(s = {}) {
  const t = time12(s.time_of_day) || 'Time not set'
  switch (s.frequency) {
    case 'daily': return { line1: 'Daily', line2: t }
    case 'weekly': return { line1: 'Weekly', line2: `${WEEKDAY[Number(s.day_of_week)] ?? 'Day not set'} ${t}` }
    case 'monthly': return { line1: 'Monthly', line2: `${s.day_of_month ? ordinal(s.day_of_month) : 'Day not set'} ${t}` }
    case 'once': {
      const d = s.run_at ? new Date(s.run_at) : null
      return { line1: 'Once', line2: d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : 'Date not set' }
    }
    default: return { line1: s.frequency || 'Not set', line2: '' }
  }
}

/** Latest run per schedule id from report_send_log rows. */
export function latestRunBySchedule(runs = []) {
  const m = new Map()
  for (const r of runs) {
    if (!r?.schedule_id) continue
    const cur = m.get(r.schedule_id)
    if (!cur || String(r.sent_at) > String(cur.sent_at)) m.set(r.schedule_id, r)
  }
  return m
}

/**
 * Registry status of one schedule:
 *   'paused'  - switched off
 *   'expired' - active one-off whose run time has passed
 *   'failing' - active and its latest delivery failed
 *   'active'  - everything else that is switched on
 */
export function scheduleStatus(s, latestRun, now) {
  if (!s?.active) return 'paused'
  if (s.frequency === 'once') {
    const at = s.run_at ? new Date(s.run_at).getTime() : null
    const next = s.next_run_at ? new Date(s.next_run_at).getTime() : null
    if (at != null && at < toMs(now) && (next == null || next < toMs(now))) return 'expired'
  }
  if (latestRun && latestRun.status && latestRun.status !== 'sent') return 'failing'
  return 'active'
}

export const STATUS_META = {
  active: { label: 'Active', tone: 'good', color: 'var(--cc-green)' },
  paused: { label: 'Paused', tone: 'warn', color: 'var(--cc-amber)' },
  failing: { label: 'Failed', tone: 'bad', color: 'var(--cc-red)' },
  expired: { label: 'Inactive', tone: 'muted', color: 'var(--cc-ink-3)' },
}

export function healthSegments(schedules = [], runs = [], now) {
  const latest = latestRunBySchedule(runs)
  const counts = { active: 0, paused: 0, failing: 0, expired: 0 }
  for (const s of schedules) counts[scheduleStatus(s, latest.get(s.id), now)] += 1
  return Object.keys(counts).map((k) => ({ key: k, label: STATUS_META[k].label, color: STATUS_META[k].color, count: counts[k] }))
}

function monthStart(d, offset = 0) {
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime()
}

/**
 * KPI strip. `windowStart` is the earliest sent_at the delivery read could
 * return (now - days); a previous-month trend needs the whole month inside it.
 */
export function registryKpis(schedules = [], runs = [], { now, windowStart } = {}) {
  const n = new Date(toMs(now))
  const thisFrom = monthStart(n, 0)
  const prevFrom = monthStart(n, -1)
  const inRange = (r, a, b) => { const t = new Date(r.sent_at).getTime(); return Number.isFinite(t) && t >= a && t < b }
  const cur = runs.filter((r) => inRange(r, thisFrom, toMs(now) + 1))
  const prev = runs.filter((r) => inRange(r, prevFrom, thisFrom))
  const sentCur = cur.filter((r) => r.status === 'sent').length
  const failCur = cur.filter((r) => r.status && r.status !== 'sent').length
  const sentPrev = prev.filter((r) => r.status === 'sent').length
  const failPrev = prev.filter((r) => r.status && r.status !== 'sent').length
  const prevCovered = windowStart != null && toMs(windowStart) <= prevFrom
  const trend = (a, b) => (prevCovered && b > 0 ? Math.round(((a - b) / b) * 100) : null)
  const active = schedules.filter((s) => s.active).length
  const recipients = new Set()
  for (const s of schedules) if (s.active) for (const e of s.recipients || []) recipients.add(String(e).trim().toLowerCase())
  const decided = sentCur + failCur
  return {
    total: schedules.length,
    active,
    activePct: schedules.length ? Math.round((active / schedules.length) * 100) : null,
    deliveries: sentCur,
    deliveriesTrend: trend(sentCur, sentPrev),
    successPct: decided ? Math.round((sentCur / decided) * 1000) / 10 : null,
    failed: failCur,
    failedTrend: trend(failCur, failPrev),
    recipients: recipients.size,
  }
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Would this schedule run on the given local day, by its current settings? */
export function expectedOn(s, day) {
  if (!s?.active) return false
  if (s.start_date) {
    const st = new Date(`${s.start_date}T00:00:00`)
    if (!Number.isNaN(st.getTime()) && day < st) return false
  }
  switch (s.frequency) {
    case 'daily': return true
    case 'weekly': return Number(s.day_of_week) === day.getDay()
    case 'monthly': return Number(s.day_of_month) === day.getDate()
    case 'once': { const d = s.run_at ? new Date(s.run_at) : null; return Boolean(d && !Number.isNaN(d.getTime()) && sameLocalDay(d, day)) }
    default: return false
  }
}

/** Last `days` local days: sent / failed from the log, expected from settings. */
export function deliveryTrend(runs = [], schedules = [], now, days = 7) {
  const end = new Date(toMs(now))
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)
    const next = day.getTime() + DAY
    let sent = 0; let failed = 0
    for (const r of runs) {
      const t = new Date(r.sent_at).getTime()
      if (!Number.isFinite(t) || t < day.getTime() || t >= next) continue
      if (r.status === 'sent') sent += 1
      else if (r.status) failed += 1
    }
    out.push({
      date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
      label: day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      sent, failed,
      expected: schedules.filter((s) => expectedOn(s, day)).length,
    })
  }
  return out
}

/** Newest deliveries as activity rows. */
export function recentActivity(runs = [], limit = 5) {
  return [...runs]
    .filter((r) => r?.sent_at)
    .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
    .slice(0, limit)
    .map((r) => {
      const ok = r.status === 'sent'
      const n = Array.isArray(r.recipients) ? r.recipients.length : null
      return {
        id: r.id,
        kind: ok ? 'sent' : 'failed',
        name: r.schedule_name || 'Unnamed schedule',
        verb: ok ? 'sent successfully' : 'failed to send',
        detail: ok ? (n == null ? 'Recipients not recorded' : `to ${n} recipient${n === 1 ? '' : 's'}`) : (String(r.error || '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'No reason recorded'),
        at: r.sent_at,
      }
    })
}

/** Registry filters beyond the shared search / frequency filter. */
export function filterRegistry(schedules = [], { module = '', format = '', recipient = '', status = '' } = {}, { runs = [], now } = {}) {
  const latest = latestRunBySchedule(runs)
  const r = String(recipient || '').toLowerCase()
  return schedules.filter((s) => {
    if (module && moduleOf(s.report_type) !== module) return false
    if (format && !(s.output_formats?.length ? s.output_formats : ['pdf']).includes(format)) return false
    if (r && !(s.recipients || []).some((e) => String(e).toLowerCase() === r)) return false
    if (status && scheduleStatus(s, latest.get(s.id), now) !== status) return false
    return true
  })
}

/** Distinct recipient addresses across schedules, sorted. */
export function recipientOptions(schedules = []) {
  const set = new Set()
  for (const s of schedules) for (const e of s.recipients || []) if (e) set.add(String(e).trim().toLowerCase())
  return [...set].sort()
}

/** One or two capital letters for a recipient avatar: "ahmad.khan@x.com" -> "AK". */
export function recipientInitials(email) {
  const local = String(email || '').trim().split('@')[0]
  const parts = local.split(/[._\-+\s]+/).filter((p) => /[a-z0-9]/i.test(p))
  if (!parts.length) return '?'
  const first = parts[0].match(/[a-z0-9]/i)[0]
  const second = parts.length > 1 ? parts[1].match(/[a-z0-9]/i)[0] : ''
  return (first + second).toUpperCase()
}

/**
 * Turn a stored schedule row into the editor form shape. Shared by Edit and
 * Duplicate so the two can never disagree about which fields carry over.
 */
export function scheduleToForm(s = {}) {
  return {
    name: s.name || '',
    report_type: s.report_type || 'executive',
    frequency: s.frequency || 'weekly',
    day_of_week: s.day_of_week ?? 1,
    day_of_month: s.day_of_month ?? 1,
    time_of_day: s.time_of_day ?? '07:00',
    run_at: s.run_at ? new Date(s.run_at).toISOString().slice(0, 16) : '',
    start_date: s.start_date ?? '',
    period: s.period ?? 'last_30',
    period_from: s.period_from ?? '',
    period_to: s.period_to ?? '',
    output_formats: s.output_formats?.length ? [...s.output_formats] : ['pdf'],
    recipients_raw: (s.recipients ?? []).join('\n'),
    active: s.active ?? true,
  }
}

/**
 * Form for a copy of an existing schedule. The copy is named "<name> (copy)"
 * and starts PAUSED, so saving a duplicate never sends a second set of emails
 * to the same recipients until someone deliberately switches it on. A one-off
 * schedule's run time is cleared because the original's moment has usually
 * already passed.
 */
export function duplicateScheduleForm(s = {}) {
  const f = scheduleToForm(s)
  const base = f.name.trim() || 'Schedule'
  return { ...f, name: `${base} (copy)`, active: false, run_at: f.frequency === 'once' ? '' : f.run_at }
}
