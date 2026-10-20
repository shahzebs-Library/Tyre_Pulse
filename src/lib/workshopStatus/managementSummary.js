/**
 * Workshop Status -> management summary (Loop 14). Pure: no I/O, every clock
 * dependent function takes `now` so tests are deterministic.
 *
 * One page a manager can forward: vehicles in the workshop right now by site,
 * by stage and by delay reason, how long they have been waiting (age bands),
 * and how many left the report (released) in the recent period.
 *
 * Honesty rules:
 *  - a vehicle whose days down cannot be measured goes to the "unknown" band,
 *    never to 0 days.
 *  - a blank site / stage / reason is counted under "Not recorded", never
 *    dropped, so every breakdown adds up to the active total.
 *  - soft deleted rows (wrong entries) are never counted as released.
 *  - the released figure is null (not 0) when the released list could not be
 *    read, so "we could not look" never reads as "nothing left".
 *  - no money: this report counts vehicles only, so no currency is involved.
 *  - output strings are ASCII only (they go into PDF / Excel).
 */
import { daysDown, localDay } from './activeView'
import { removedStatus, REMOVED_STATUS } from './removedView'

export const NOT_RECORDED = 'Not recorded'

/** Waiting-age bands in whole days. `max` null = open ended. */
export const AGE_BANDS = Object.freeze([
  { key: '0_3', label: '0 to 3 days', min: 0, max: 3 },
  { key: '4_7', label: '4 to 7 days', min: 4, max: 7 },
  { key: '8_14', label: '8 to 14 days', min: 8, max: 14 },
  { key: '15_30', label: '15 to 30 days', min: 15, max: 30 },
  { key: '31_plus', label: '31 days or more', min: 31, max: null },
])
export const AGE_UNKNOWN = Object.freeze({ key: 'unknown', label: 'Days not measurable' })

/** Released-period windows (days back from today, inclusive of today). */
export const RELEASE_WINDOWS = Object.freeze([7, 30])

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')
const DAY_MS = 24 * 60 * 60 * 1000

/** The band key a days-down figure falls into ('unknown' when null). */
export function ageBandOf(days) {
  if (days == null || !Number.isFinite(Number(days)) || Number(days) < 0) return AGE_UNKNOWN.key
  const d = Math.floor(Number(days))
  const band = AGE_BANDS.find((b) => d >= b.min && (b.max == null || d <= b.max))
  return band ? band.key : AGE_UNKNOWN.key
}

/** Count rows by a field; blank values go to NOT_RECORDED. Sorted desc, then A to Z. */
export function countBy(rows, field) {
  const map = new Map()
  for (const r of rows || []) {
    const raw = r?.[field]
    const k = blank(raw) ? NOT_RECORDED : String(raw).trim()
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** Local yyyy-mm-dd `days - 1` days before `now` (window of `days` days incl. today). */
function windowStart(now, days) {
  const today = new Date(`${localDay(now)}T00:00:00`)
  return localDay(new Date(today.getTime() - (days - 1) * DAY_MS))
}

/**
 * Build the management summary.
 *
 * @param {object} p
 * @param {object[]} p.active    current active records (current_active, not deleted)
 * @param {object[]|null} p.released  released/archived/deleted records, or null when unreadable
 * @param {Date} p.now
 * @param {number[]} [p.windows]  released windows in days
 */
export function buildManagementSummary({ active = [], released = null, now = new Date(), windows = RELEASE_WINDOWS } = {}) {
  const act = (active || []).filter((r) => r && blank(r.deleted_at))
  const bands = AGE_BANDS.map((b) => ({ key: b.key, label: b.label, count: 0 }))
  let unknown = 0
  let longest = null
  let sumDays = 0
  let measured = 0
  for (const r of act) {
    const d = daysDown(r, now)
    const k = ageBandOf(d)
    if (k === AGE_UNKNOWN.key) { unknown += 1; continue }
    bands.find((b) => b.key === k).count += 1
    measured += 1
    sumDays += d
    if (longest == null || d > longest.days) longest = { asset_no: r.asset_no || null, days: d }
  }
  bands.push({ key: AGE_UNKNOWN.key, label: AGE_UNKNOWN.label, count: unknown })

  let releasedOut = null
  if (Array.isArray(released)) {
    const today = localDay(now)
    // Released and archived both left the report; soft deleted = wrong entry.
    const left = released.filter((r) => r && removedStatus(r) !== REMOVED_STATUS.DELETED && !blank(r.removed_at))
    releasedOut = windows.map((days) => {
      const from = windowStart(now, days)
      const rows = left.filter((r) => {
        const d = localDay(r.removed_at)
        return d != null && d >= from && d <= today
      })
      return {
        days,
        from,
        to: today,
        count: rows.length,
        bySite: countBy(rows, 'site'),
        withDisposition: rows.filter((r) => !blank(r.final_disposition)).length,
      }
    })
  }

  return {
    generatedDay: localDay(now),
    active: act.length,
    measured,
    avgDaysDown: measured ? Math.round((sumDays / measured) * 10) / 10 : null,
    longest,
    bySite: countBy(act, 'site'),
    byStage: countBy(act, 'current_stage'),
    byDelayReason: countBy(act, 'delay_reason'),
    ageBands: bands,
    released: releasedOut,
  }
}

const pct = (n, total) => (total > 0 ? `${Math.round((n / total) * 1000) / 10}%` : 'N/A')

/**
 * Flatten a summary into one table (Section | Item | Vehicles | Share) for a
 * single PDF / Excel export. ASCII only. Empty breakdowns are stated, not hidden.
 */
export function summaryRows(summary) {
  if (!summary) return []
  const out = []
  const total = summary.active
  const push = (section, item, count, share) => out.push({ section, item, count, share })

  push('Overview', 'Vehicles in workshop now', total, total > 0 ? '100%' : 'N/A')
  push('Overview', 'Average days down (measurable)', summary.avgDaysDown == null ? 'N/A' : summary.avgDaysDown, '')
  push('Overview', 'Longest waiting',
    summary.longest ? `${summary.longest.asset_no || 'Unknown asset'} (${summary.longest.days} days)` : 'N/A', '')

  const section = (name, list) => {
    if (!list.length) { push(name, 'No vehicles', 0, 'N/A'); return }
    for (const r of list) push(name, r.key, r.count, pct(r.count, total))
  }
  section('By site', summary.bySite)
  section('By stage', summary.byStage)
  section('By delay reason', summary.byDelayReason)
  for (const b of summary.ageBands) push('Waiting age', b.label, b.count, pct(b.count, total))

  if (summary.released == null) {
    push('Released', 'Released list not available', 'N/A', '')
  } else {
    for (const w of summary.released) {
      const name = `Released last ${w.days} days`
      push(name, `Total (${w.from} to ${w.to})`, w.count, '')
      push(name, 'With final disposition recorded', w.withDisposition, pct(w.withDisposition, w.count))
      for (const s of w.bySite) push(name, s.key, s.count, pct(s.count, w.count))
    }
  }
  return out
}
