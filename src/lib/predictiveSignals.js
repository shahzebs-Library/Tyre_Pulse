/**
 * predictiveSignals - pure engine for the Predictive Maintenance page.
 *
 * Built ONLY on what the fleet actually records:
 *   - tyre running life (the get_tyre_running_life rows, judged with the ONE
 *     shared rule measureFor / bandFor in ./tyreRunningLife)
 *   - job cards (work_orders) and the open breakdown register
 *
 * It deliberately uses NO tread depth, pressure reading, risk level or monthly
 * tyre budget: those columns are empty, and a prediction built on an empty
 * column is a default value wearing a chart. signalGaps() reports what is
 * missing so the page can say so in one line instead of drawing empty panels.
 *
 * No I/O, no React, no clock: `now` is always passed in.
 */
import { measureFor, bandFor, actionRows, BAND_META } from './tyreRunningLife'
import { downDays } from './assetBreakdowns'
import { normSize } from './tyreDemandForecast'

const DAY_MS = 86400000
/** A tyre needs this many days on the wheel before its own usage rate is trusted. */
export const MIN_RATE_DAYS = 30
export const WINDOW_DAYS = 30
export const OUTLOOK_WINDOWS = 3
/** Job cards looked at for "repeat" work, and how many make a repeat. */
export const JOB_CARD_WINDOW_DAYS = 90
export const REPEAT_JOB_CARDS = 3
/** An open breakdown this old counts as long (the register's own "8 to 30 days" band). */
export const LONG_BREAKDOWN_DAYS = 8
/** Below this share a column is too thinly filled to predict from. */
export const MIN_SIGNAL_PCT = 20

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const assetKey = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase()
const toMs = (v) => (v instanceof Date ? v.getTime() : Number(v))

/**
 * Days until one active tyre reaches its expected life, or null when that
 * cannot be worked out.
 *
 * 1. Past expected life already -> 0.
 * 2. Its OWN rate: remaining km (or hours) divided by what this tyre has
 *    actually run per day since fitment. Both meters are tried and the one that
 *    runs out first wins, the same "whichever comes first" rule as measureFor.
 * 3. No usable rate -> the fleet's expected days on the wheel for its kind.
 * 4. Nothing to go on -> null. Never a guessed date.
 */
export function projectEndDays(row) {
  if (!row) return { days: null, basis: null }
  if (bandFor(row) === 'overdue') return { days: 0, basis: 'overdue' }
  const daysOn = num(row.daysOn)
  const rateOk = daysOn != null && daysOn >= MIN_RATE_DAYS
  const own = []
  if (rateOk && num(row.remainingKm) != null && num(row.kmRun) > 0) {
    own.push(row.remainingKm / (row.kmRun / daysOn))
  }
  if (rateOk && num(row.remainingHours) != null && num(row.hoursRun) > 0) {
    own.push(row.remainingHours / (row.hoursRun / daysOn))
  }
  if (own.length) return { days: Math.max(0, Math.round(Math.min(...own))), basis: 'own_rate' }
  if (num(row.remainingDays) != null) return { days: Math.max(0, Math.round(row.remainingDays)), basis: 'fleet_days' }
  return { days: null, basis: null }
}

const dayLabel = (ms) => {
  const d = new Date(ms)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getDate()} ${names[d.getMonth()]}`
}

/**
 * Expected tyre replacements: already past life, then three 30-day windows,
 * split by tyre size. Counts only, so it is safe on the All countries view.
 *
 * `notProjectable` is returned, never dropped: a tyre with no meter and no
 * baseline is not "fine", it is unknown, and the page states how many.
 */
export function replacementOutlook(rows = [], { now, windows = OUTLOOK_WINDOWS } = {}) {
  const t0 = toMs(now)
  const wins = Array.from({ length: windows }, (_, i) => ({
    key: `w${i + 1}`,
    fromDay: i * WINDOW_DAYS + (i === 0 ? 0 : 1),
    toDay: (i + 1) * WINDOW_DAYS,
    label: Number.isFinite(t0)
      ? `${dayLabel(t0 + (i * WINDOW_DAYS + (i === 0 ? 0 : 1)) * DAY_MS)} to ${dayLabel(t0 + (i + 1) * WINDOW_DAYS * DAY_MS)}`
      : `Days ${i * WINDOW_DAYS + (i === 0 ? 0 : 1)} to ${(i + 1) * WINDOW_DAYS}`,
    count: 0,
  }))
  const horizon = windows * WINDOW_DAYS
  const sizes = new Map()
  const basis = { own_rate: 0, fleet_days: 0 }
  let overdue = 0; let later = 0; let notProjectable = 0
  const list = Array.isArray(rows) ? rows : []
  for (const r of list) {
    const { days, basis: b } = projectEndDays(r)
    if (days == null) { notProjectable += 1; continue }
    if (b === 'own_rate' || b === 'fleet_days') basis[b] += 1
    let slot
    if (b === 'overdue') { overdue += 1; slot = 'overdue' } else if (days > horizon) { later += 1; continue } else {
      const i = Math.min(windows - 1, Math.max(0, Math.ceil(days / WINDOW_DAYS) - 1))
      wins[i].count += 1
      slot = wins[i].key
    }
    const size = normSize(r.size)
    let e = sizes.get(size)
    if (!e) { e = { size, overdue: 0, total: 0, ...Object.fromEntries(wins.map((w) => [w.key, 0])) }; sizes.set(size, e) }
    e[slot] += 1
    e.total += 1
  }
  const bySize = [...sizes.values()].sort((a, b) => b.total - a.total || a.size.localeCompare(b.size))
  const upcoming = wins.reduce((s, w) => s + w.count, 0)
  return {
    total: list.length,
    overdue,
    windows: wins,
    upcoming,
    needed: overdue + upcoming,
    later,
    notProjectable,
    basis,
    bySize,
    horizonDays: horizon,
  }
}

/** Table rows for the tyres to act on now, on the shared running-life judgement. */
export function dueTyreRows(rows = []) {
  return actionRows(rows).map((r, i) => {
    const m = measureFor(r)
    const p = projectEndDays(r)
    return {
      id: `${r.asset}|${r.position}|${r.serial}|${i}`,
      asset: r.asset || '',
      position: r.position || '',
      serial: r.serial || '',
      size: r.size || '',
      brand: r.brand || '',
      site: r.site || '',
      vehicleType: r.vehicleType || '',
      band: m.band,
      bandLabel: BAND_META[m.band]?.label || 'Not measurable',
      remaining: m.remaining,
      dimension: m.dimension,
      usedPct: m.used,
      fittedOn: r.fittedOn || null,
      daysToEnd: p.days,
    }
  })
}

export const DUE_EXPORT_COLUMNS = [
  { key: 'asset', header: 'Asset' },
  { key: 'position', header: 'Position' },
  { key: 'serial', header: 'Serial' },
  { key: 'size', header: 'Size' },
  { key: 'brand', header: 'Brand' },
  { key: 'site', header: 'Site' },
  { key: 'state', header: 'State' },
  { key: 'remaining', header: 'Remaining' },
  { key: 'usedPct', header: 'Life used %' },
  { key: 'fittedOn', header: 'Fitted on' },
]

export function remainingText(row) {
  if (!row || row.remaining == null || !row.dimension) return 'N/A'
  const n = Math.round(row.remaining).toLocaleString('en-US')
  return row.dimension === 'hours' ? `${n} hrs` : `${n} km`
}

export function dueExportRows(rows = []) {
  return rows.map((r) => ({
    asset: r.asset || 'N/A',
    position: r.position || 'N/A',
    serial: r.serial || 'N/A',
    size: r.size || 'N/A',
    brand: r.brand || 'N/A',
    site: r.site || 'N/A',
    state: r.bandLabel,
    remaining: remainingText(r),
    usedPct: r.usedPct == null ? 'N/A' : Math.round(r.usedPct),
    fittedOn: r.fittedOn ? String(r.fittedOn).slice(0, 10) : 'N/A',
  }))
}

/** Filter the due-tyre table. */
export function filterDueRows(rows = [], { q = '', site = '', band = '' } = {}) {
  const needle = String(q).trim().toLowerCase()
  return rows.filter((r) => {
    if (site && r.site !== site) return false
    if (band && r.band !== band) return false
    if (needle) {
      const hay = [r.asset, r.serial, r.size, r.brand, r.position, r.site].join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })
}

/**
 * Assets that look like a maintenance risk, from two recorded facts only:
 *   - an OPEN breakdown that has run LONG_BREAKDOWN_DAYS or more
 *   - REPEAT_JOB_CARDS or more job cards opened in the last window
 *
 * `breakdowns` / `jobCards` may be null when that source could not be read:
 * the matching figures come back null (unknown), never 0.
 * The asset key carries the country, because the same asset code in two
 * countries is usually a different machine.
 */
export function maintenanceRisk({ breakdowns = null, jobCards = null, now, windowDays = JOB_CARD_WINDOW_DAYS,
  repeatMin = REPEAT_JOB_CARDS, longDays = LONG_BREAKDOWN_DAYS } = {}) {
  const t0 = toMs(now)
  const since = t0 - windowDays * DAY_MS
  const map = new Map()
  const entry = (asset, country, site) => {
    const k = `${country || ''}|${assetKey(asset)}`
    let e = map.get(k)
    if (!e) {
      e = { id: k, asset: String(asset).trim(), country: country || null, site: site || null,
        openBreakdowns: 0, downDays: null, breakdownDetail: null, expectedReturn: null,
        jobCards: 0, emergencyCards: 0, lastJobCard: null }
      map.set(k, e)
    }
    if (!e.site && site) e.site = site
    return e
  }
  let openBreakdowns = null
  if (Array.isArray(breakdowns)) {
    openBreakdowns = 0
    for (const b of breakdowns) {
      if (!b?.asset_no || b.returned_to_service) continue
      openBreakdowns += 1
      const e = entry(b.asset_no, b.country, b.site)
      e.openBreakdowns += 1
      const d = downDays(b, t0)
      if (d != null && (e.downDays == null || d > e.downDays)) {
        e.downDays = d
        e.breakdownDetail = b.details || null
        e.expectedReturn = b.expected_return || null
      }
    }
  }
  let cardsInWindow = null
  if (Array.isArray(jobCards)) {
    cardsInWindow = 0
    for (const j of jobCards) {
      if (!j?.asset_no) continue
      const t = Date.parse(j.opened_at)
      // A future-dated card is a data error, not work that happened.
      if (!Number.isFinite(t) || t < since || t > t0) continue
      cardsInWindow += 1
      const e = entry(j.asset_no, j.country, j.site)
      e.jobCards += 1
      if (/emergency|break/i.test(String(j.work_type || ''))) e.emergencyCards += 1
      if (!e.lastJobCard || j.opened_at > e.lastJobCard) e.lastJobCard = j.opened_at
    }
  }
  const rows = []
  for (const e of map.values()) {
    const long = e.downDays != null && e.downDays >= longDays
    const repeat = e.jobCards >= repeatMin
    if (!long && !repeat) continue
    const reasons = []
    if (long) reasons.push(`Broken down ${e.downDays} days`)
    if (repeat) reasons.push(`${e.jobCards} job cards in ${windowDays} days`)
    rows.push({
      ...e,
      // Unknown, not zero, when a source was unreadable.
      jobCards: cardsInWindow == null ? null : e.jobCards,
      emergencyCards: cardsInWindow == null ? null : e.emergencyCards,
      long, repeat, both: long && repeat, reasons, reason: reasons.join('. '),
    })
  }
  rows.sort((a, b) => Number(b.both) - Number(a.both)
    || (b.downDays ?? -1) - (a.downDays ?? -1)
    || (b.jobCards ?? 0) - (a.jobCards ?? 0)
    || a.asset.localeCompare(b.asset))
  return {
    rows,
    summary: {
      atRisk: rows.length,
      longBreakdowns: openBreakdowns == null ? null : rows.filter((r) => r.long).length,
      repeatAssets: cardsInWindow == null ? null : rows.filter((r) => r.repeat).length,
      openBreakdowns,
      cardsInWindow,
      windowDays, repeatMin, longDays,
    },
  }
}

export const RISK_EXPORT_COLUMNS = [
  { key: 'asset', header: 'Asset' },
  { key: 'country', header: 'Country' },
  { key: 'site', header: 'Site' },
  { key: 'reason', header: 'Why it is listed' },
  { key: 'downDays', header: 'Open breakdown days' },
  { key: 'jobCards', header: 'Job cards in window' },
  { key: 'emergencyCards', header: 'Of which breakdown or emergency' },
  { key: 'breakdownDetail', header: 'Breakdown detail' },
  { key: 'expectedReturn', header: 'Expected return' },
]

export function riskExportRows(rows = []) {
  const na = (v) => (v == null || v === '' ? 'N/A' : v)
  return rows.map((r) => ({
    asset: r.asset, country: na(r.country), site: na(r.site), reason: r.reason,
    downDays: r.downDays == null ? 'No open breakdown' : r.downDays,
    jobCards: na(r.jobCards), emergencyCards: na(r.emergencyCards),
    breakdownDetail: na(r.breakdownDetail),
    expectedReturn: r.expectedReturn ? String(r.expectedReturn).slice(0, 10) : 'N/A',
  }))
}

const GAP_FIELDS = [
  { key: 'tread', label: 'tread depth', have: 'withTread', of: 'tyres', unit: 'tyres', blocks: 'wear predictions' },
  { key: 'pressure', label: 'tyre pressure', have: 'withPressure', of: 'tyres', unit: 'tyres', blocks: 'pressure predictions' },
  { key: 'risk', label: 'risk level', have: 'withRisk', of: 'tyres', unit: 'tyres', blocks: 'failure risk scores' },
  { key: 'budget', label: 'monthly tyre budget', have: 'withBudget', of: 'fleet', unit: 'assets', blocks: 'budget forecasts' },
]

/**
 * Which signals the fleet does not record (or records too thinly to use), plus
 * the meter coverage sentence. `cov` holds counts; a null count means that
 * read failed and is reported as "could not be checked", never as zero.
 */
export function signalGaps(cov = {}) {
  const c = cov || {}
  const items = GAP_FIELDS.map((f) => {
    const have = num(c[f.have]); const of = num(c[f.of])
    const pct = have != null && of > 0 ? Math.round((have / of) * 100) : null
    const state = have == null || of == null ? 'unchecked'
      : have === 0 ? 'none'
        : pct < MIN_SIGNAL_PCT ? 'sparse' : 'present'
    return { ...f, haveCount: have, ofCount: of, pct, state }
  })
  const fmt = (n) => Number(n).toLocaleString('en-US')
  const join = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)
  const none = items.filter((i) => i.state === 'none')
  const parts = []
  if (none.length) {
    const blocked = join(none.map((i) => i.blocks))
    parts.push(`Not recorded yet: ${join(none.map((i) => i.label))}. ${blocked[0].toUpperCase()}${blocked.slice(1)} are not shown, because they would only be default values.`)
  }
  for (const i of items.filter((x) => x.state === 'sparse')) {
    parts.push(`${i.label[0].toUpperCase()}${i.label.slice(1)} is recorded on only ${fmt(i.haveCount)} of ${fmt(i.ofCount)} ${i.unit}, too few to predict from.`)
  }
  for (const i of items.filter((x) => x.state === 'present')) {
    parts.push(`${i.label[0].toUpperCase()}${i.label.slice(1)} is recorded on ${fmt(i.haveCount)} of ${fmt(i.ofCount)} ${i.unit}, but this page does not use it yet.`)
  }
  const unchecked = items.filter((i) => i.state === 'unchecked')
  if (unchecked.length) parts.push(`Could not be checked: ${join(unchecked.map((i) => i.label))}.`)

  const fleet = num(c.fleet); const withKm = num(c.withKm)
  const meter = fleet == null || withKm == null
    ? { fleet, withKm, pct: null, note: 'Meter coverage could not be checked.' }
    : {
      fleet, withKm,
      pct: fleet > 0 ? Math.round((withKm / fleet) * 100) : null,
      note: fleet === 0 ? 'No assets in this scope.'
        : `${fmt(withKm)} of ${fmt(fleet)} assets have a current odometer reading. Tyres on the other ${fmt(fleet - withKm)} can only be judged on engine hours or on days in service.`,
    }
  return { items, note: parts.join(' '), meter, allRecorded: items.every((i) => i.state === 'present') }
}

/** Sum of the next N months from a forecastTyreDemand result, as plain rows. */
export function historyDemandRows(fc) {
  if (!fc || !Array.isArray(fc.forecastMonths) || !fc.forecastMonths.length) return []
  return fc.forecastMonths.map((key, i) => ({ key, label: fc.forecastLabels?.[i] || key, count: fc.totals?.forecast?.[i] ?? null }))
}
