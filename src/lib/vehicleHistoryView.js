/**
 * vehicleHistoryView.js - pure view engine behind the redesigned Vehicle
 * History page (route /vehicle-history).
 *
 * It takes what the page already loads for ONE asset (the unified timeline from
 * src/lib/assetHistory.js buildTimeline, the reset-aware meter series, the job
 * card downtime episodes and the vehicle_fleet register row) and turns it into
 * the blocks the owner's mockup shows: the asset header, six KPIs, a typed
 * chronological event list with the odometer and hour meter at each event, the
 * per-tab rows, the monthly maintenance cost stack and the downtime trend.
 *
 * Rules, each enforced here rather than in the page:
 *  - No I/O. `now` is injectable wherever time matters.
 *  - Honest nulls. A figure that cannot be measured is null, never 0.
 *  - Money never blends currencies. The cost stack is built for ONE currency
 *    and the caller picks which when an asset carries more than one.
 *  - Only the classified expense grid (parts lines) counts toward cost. Job card
 *    and tyre amounts are shown per event but never summed, because the grid
 *    already carries that money.
 *  - Movement is INFERRED from the site recorded on dated records. There is no
 *    transfer register, so every movement row says so. Store issue lines are
 *    left out of the inference because their site is the issuing store.
 */

const DAY = 86400000

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function text(v) {
  const s = v === null || v === undefined ? '' : String(v).trim()
  return s || null
}
function ts(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
function isoDay(ms) {
  return ms === null ? null : new Date(ms).toISOString().slice(0, 10)
}
function round1(v) {
  return v === null ? null : Math.round(v * 10) / 10
}

/* ------------------------------------------------------------------ *
 * Event types                                                          *
 * ------------------------------------------------------------------ */

/** The event types the page filters and badges by, in mockup order. */
export const EVENT_TYPES = Object.freeze([
  { key: 'service', label: 'Service', tone: 'good' },
  { key: 'repair', label: 'Repair', tone: 'info' },
  { key: 'tyre', label: 'Tyre', tone: 'info' },
  { key: 'inspection', label: 'Inspection', tone: 'purple' },
  { key: 'movement', label: 'Movement', tone: 'info' },
  { key: 'breakdown', label: 'Breakdown', tone: 'bad' },
  { key: 'accident', label: 'Accident', tone: 'orange' },
  { key: 'policy', label: 'Policy', tone: 'purple' },
  { key: 'registration', label: 'Registration', tone: 'muted' },
  { key: 'wash', label: 'Wash', tone: 'muted' },
  { key: 'meter', label: 'Meter reading', tone: 'muted' },
  { key: 'parts', label: 'Store issue', tone: 'warn' },
  { key: 'cost', label: 'Penalty', tone: 'warn' },
  { key: 'lifecycle', label: 'Lifecycle', tone: 'bad' },
])
const TYPE_BY_KEY = Object.freeze(Object.fromEntries(EVENT_TYPES.map((t) => [t.key, t])))

/** Types left out of the default "Key events" view: high volume, low signal. */
export const KEY_EXCLUDED = Object.freeze(['parts', 'meter'])

export function typeMeta(key) {
  return TYPE_BY_KEY[key] || { key, label: key || 'Other', tone: 'muted' }
}

const SERVICE_WORK = /prevent|service|schedul|\bpm\b/i

/** The view type of one assetHistory timeline event. */
export function eventType(e) {
  switch (e?.source) {
    case 'job_card': return SERVICE_WORK.test(String(e.row?.work_type || '')) ? 'service' : 'repair'
    case 'pm_service': return 'service'
    case 'tyre_fitment':
    case 'tyre_removal':
    case 'tyre_mark': return 'tyre'
    case 'inspection':
    case 'checklist': return 'inspection'
    case 'breakdown': return 'breakdown'
    case 'accident': return 'accident'
    case 'odometer':
    case 'engine_hours':
    case 'utilization': return 'meter'
    case 'parts_line': return 'parts'
    case 'penalty': return 'cost'
    case 'wash': return 'wash'
    case 'disposal': return 'lifecycle'
    default: return e?.type || 'lifecycle'
  }
}

/* ------------------------------------------------------------------ *
 * Register events (policy, registration) from the vehicle_fleet row    *
 * ------------------------------------------------------------------ */

function regEvent(id, type, at, title, detail) {
  const ms = ts(at)
  if (ms === null) return null
  return {
    id: `register:${id}`, source: 'register', type, at, atMs: ms, day: isoDay(ms),
    undated: false, title, detail: detail || null, value: null, currency: null,
    countsToSpend: false, severity: 'info', link: null, ref: null, row: null,
  }
}

/**
 * Dated facts the register itself records. Each one is a real date on the
 * vehicle_fleet row; nothing is invented when a column is blank.
 */
export function registerEvents(fleet) {
  if (!fleet) return []
  const out = [
    regEvent('service_start', 'registration', fleet.operation_start_date, 'Entered service',
      [text(fleet.registration_no) ? `Plate ${fleet.registration_no}` : null, text(fleet.site)].filter(Boolean).join(' - ')),
    regEvent('insurance_start', 'policy', fleet.insurance_start, 'Insurance policy started',
      [text(fleet.insurance_type), text(fleet.insurance_name)].filter(Boolean).join(' - ')),
    regEvent('mvip_issue', 'registration', fleet.mvip_issue, 'Vehicle inspection permit issued',
      text(fleet.mvip_expiry) ? `Valid to ${fleet.mvip_expiry}` : null),
    regEvent('operating_card_issue', 'registration', fleet.operating_card_issue, 'Operating card issued',
      [text(fleet.operating_card_no) ? `Card ${fleet.operating_card_no}` : null,
        text(fleet.operating_card_expiry) ? `Valid to ${fleet.operating_card_expiry}` : null].filter(Boolean).join(' - ')),
  ]
  return out.filter(Boolean)
}

/* ------------------------------------------------------------------ *
 * Movement, inferred from the site on dated records                   *
 * ------------------------------------------------------------------ */

const MOVEMENT_SOURCES = new Set([
  'job_card', 'inspection', 'checklist', 'accident', 'breakdown', 'wash', 'tyre_fitment', 'odometer', 'engine_hours',
])

/**
 * Site changes seen across the asset's own dated records, oldest first.
 * A single record at another site sandwiched between two at the same site is
 * treated as noise (a one-off entry), not as two moves.
 */
export function inferMovements(events) {
  const pts = (Array.isArray(events) ? events : [])
    .filter((e) => MOVEMENT_SOURCES.has(e.source) && !e.undated && text(e.row?.site))
    .map((e) => ({ site: String(e.row.site).trim().toUpperCase(), atMs: e.atMs, source: e.source }))
    .sort((a, b) => a.atMs - b.atMs)
  const runs = []
  for (const p of pts) {
    const last = runs[runs.length - 1]
    if (last && last.site === p.site) { last.lastMs = p.atMs; last.count += 1 }
    else runs.push({ site: p.site, firstMs: p.atMs, lastMs: p.atMs, count: 1, source: p.source })
  }
  // Drop one-record blips between two runs at the same site, then re-merge.
  const clean = []
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    const prev = clean[clean.length - 1]
    const next = runs[i + 1]
    if (r.count === 1 && prev && next && prev.site === next.site) continue
    if (prev && prev.site === r.site) { prev.lastMs = r.lastMs; prev.count += r.count; continue }
    clean.push({ ...r })
  }
  const moves = []
  for (let i = 1; i < clean.length; i++) {
    const from = clean[i - 1]
    const to = clean[i]
    moves.push({
      id: `movement:${i}:${to.firstMs}`,
      source: 'movement',
      type: 'movement',
      at: new Date(to.firstMs).toISOString(),
      atMs: to.firstMs,
      day: isoDay(to.firstMs),
      undated: false,
      title: `Site change: ${from.site} to ${to.site}`,
      detail: `Inferred from the site on the asset's records. Last seen at ${from.site} on ${isoDay(from.lastMs)}.`,
      fromSite: from.site,
      toSite: to.site,
      lastSeenFromMs: from.lastMs,
      value: null, currency: null, countsToSpend: false, severity: 'info', link: null, ref: null, row: null,
    })
  }
  return moves
}

/* ------------------------------------------------------------------ *
 * Meters at an event                                                   *
 * ------------------------------------------------------------------ */

function lastPointAtOrBefore(points, atMs) {
  if (!Array.isArray(points) || atMs === null) return null
  let best = null
  for (const p of points) {
    if (p.atMs === null || p.atMs === undefined) continue
    if (p.atMs <= atMs) best = p
    else break
  }
  return best ? best.value : null
}

/**
 * The odometer and hour meter to show against an event: the event's own
 * reading when the record carries one, otherwise the latest logged reading on
 * or before the event date. `kmOwn` / `hoursOwn` say which, so the page can
 * label a borrowed reading.
 */
export function meterAt(event, meters) {
  const r = event?.row || {}
  let km = null
  let hours = null
  if (event?.source === 'odometer') km = num(event.value)
  else if (event?.source === 'engine_hours') hours = num(event.value)
  else if (event?.source === 'job_card') km = num(r.odometer)
  else if (event?.source === 'tyre_fitment') km = num(r.km_at_fitment)
  else if (event?.source === 'tyre_removal') km = num(r.km_at_removal)
  else if (event?.source === 'disposal') { km = num(r.meter_km); hours = num(r.meter_hours) }
  if (km !== null && km <= 0) km = null
  if (hours !== null && hours <= 0) hours = null
  const kmOwn = km !== null
  const hoursOwn = hours !== null
  if (km === null) km = lastPointAtOrBefore(meters?.km?.points, event?.atMs ?? null)
  if (hours === null) hours = lastPointAtOrBefore(meters?.hours?.points, event?.atMs ?? null)
  return { km, hours, kmOwn: kmOwn || false, hoursOwn: hoursOwn || false }
}

/* ------------------------------------------------------------------ *
 * The unified view timeline                                            *
 * ------------------------------------------------------------------ */

function breakdownDays(row, nowMs) {
  const start = ts(row?.reported_on)
  const end = ts(row?.returned_on)
  if (start === null) return null
  if (end !== null) return Math.max(0, Math.round((end - start) / DAY))
  if (row?.returned_to_service !== true && nowMs !== null) return Math.max(0, Math.round((nowMs - start) / DAY))
  return null
}

/**
 * Every event the page lists, newest first, each carrying its view type, the
 * meters at that point and (where measurable) the downtime it represents.
 *
 * @param {{timeline?:{events:Array}, fleet?:object, meters?:object, downtime?:object, now?:any}} input
 */
export function buildViewTimeline({ timeline, fleet, meters, downtime, now } = {}) {
  const nowMs = ts(now)
  const base = Array.isArray(timeline?.events) ? timeline.events : []
  const epById = new Map()
  for (const ep of downtime?.episodes || []) if (ep.id !== null && ep.id !== undefined) epById.set(String(ep.id), ep)

  const all = [...base, ...registerEvents(fleet), ...inferMovements(base)]
  const out = all.map((e) => {
    const type = e.type && e.source === 'register' ? e.type : eventType(e)
    const m = meterAt(e, meters)
    let downtimeDays = null
    if (e.source === 'job_card') {
      const ep = epById.get(String(e.row?.id))
      if (ep && ep.total !== null && ep.total !== undefined) downtimeDays = round1(ep.total / 24)
    } else if (e.source === 'breakdown' && String(e.id).startsWith('breakdown:')) {
      downtimeDays = breakdownDays(e.row, nowMs)
    }
    const meta = typeMeta(type)
    return {
      ...e,
      type,
      typeLabel: meta.label,
      tone: meta.tone,
      km: m.km,
      hours: m.hours,
      kmOwn: m.kmOwn,
      hoursOwn: m.hoursOwn,
      downtimeDays,
      site: text(e.row?.site) || (e.toSite || null),
    }
  })
  out.sort((a, b) => {
    if (a.undated !== b.undated) return a.undated ? 1 : -1
    if (!a.undated && a.atMs !== b.atMs) return b.atMs - a.atMs
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0
  })
  return out
}

/** Period presets for the filter bar. months null = all history. */
export const PERIODS = Object.freeze([
  { key: '12', label: 'Last 12 months', months: 12 },
  { key: '24', label: 'Last 24 months', months: 24 },
  { key: 'all', label: 'All history', months: null },
])

export function periodStartMs(months, now) {
  const nowMs = ts(now)
  if (!months || nowMs === null) return null
  const d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months + 1, 1)
}

/**
 * Filter the view timeline. `type` is 'key' (default: everything except the
 * high-volume store issues and meter readings), 'all', or one EVENT_TYPES key.
 * Undated events are kept only on the all-history period, because a period
 * filter cannot place them.
 */
export function filterViewEvents(events, { type = 'key', months = null, search = '', now } = {}) {
  const start = periodStartMs(months, now)
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(events) ? events : []).filter((e) => {
    if (type === 'key' && KEY_EXCLUDED.includes(e.type)) return false
    if (type !== 'key' && type !== 'all' && e.type !== type) return false
    if (start !== null) {
      if (e.undated) return false
      if (e.atMs < start) return false
    }
    if (q) {
      const hay = [e.title, e.detail, e.typeLabel, e.ref, e.site].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Count of events per type, for the filter select. */
export function typeCounts(events) {
  const c = {}
  for (const e of Array.isArray(events) ? events : []) c[e.type] = (c[e.type] || 0) + 1
  return c
}

/* ------------------------------------------------------------------ *
 * Tabs                                                                 *
 * ------------------------------------------------------------------ */

const TAB_TYPES = Object.freeze({
  service: ['service', 'repair', 'wash'],
  movement: ['movement'],
  inspection: ['inspection'],
  cost: ['parts', 'cost'],
})

/** The rows one tab shows, from the (already period and search filtered) events. */
export function tabEvents(events, tab) {
  const types = TAB_TYPES[tab]
  if (!types) return Array.isArray(events) ? events : []
  return (Array.isArray(events) ? events : []).filter((e) => types.includes(e.type))
}

/**
 * The register's document facts for the Documents tab. Returns [] when the
 * register row carries none, so the tab can say so honestly.
 */
export function documentRows(fleet, { now } = {}) {
  if (!fleet) return []
  const nowMs = ts(now)
  const state = (exp) => {
    const e = ts(exp)
    if (e === null || nowMs === null) return null
    const days = Math.round((e - nowMs) / DAY)
    if (days < 0) return { key: 'expired', label: 'Expired', tone: 'bad', days }
    if (days <= 30) return { key: 'due', label: `Expires in ${days} days`, tone: 'warn', days }
    return { key: 'valid', label: 'Valid', tone: 'good', days }
  }
  const rows = [
    { key: 'registration', label: 'Registration plate', ref: text(fleet.registration_no), issued: null, expires: null },
    { key: 'chassis', label: 'Chassis number', ref: text(fleet.chassis_no), issued: null, expires: null },
    { key: 'insurance', label: 'Insurance', ref: [text(fleet.insurance_type), text(fleet.insurance_name)].filter(Boolean).join(' - ') || null,
      issued: text(fleet.insurance_start), expires: text(fleet.insurance_expiry) },
    { key: 'mvip', label: 'Vehicle inspection permit', ref: null, issued: text(fleet.mvip_issue), expires: text(fleet.mvip_expiry) },
    { key: 'operating_card', label: 'Operating card', ref: text(fleet.operating_card_no), issued: text(fleet.operating_card_issue), expires: text(fleet.operating_card_expiry) },
    { key: 'driver_licence', label: 'Driver licence', ref: null, issued: text(fleet.driver_licence_issue), expires: text(fleet.driver_licence_expiry) },
  ]
  return rows
    .filter((r) => r.ref || r.issued || r.expires)
    .map((r) => ({ ...r, state: state(r.expires) }))
}

/* ------------------------------------------------------------------ *
 * Monthly axes and charts                                              *
 * ------------------------------------------------------------------ */

/** 'YYYY-MM' keys for the last n months ending with the month of `now`. */
export function monthAxis(n, now) {
  const nowMs = ts(now)
  if (nowMs === null || !n) return []
  const d = new Date(nowMs)
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))
    out.push(x.toISOString().slice(0, 7))
  }
  return out
}

/** The months to chart for a period: 12, 24, or (all history) from the first event, capped at 60. */
export function chartMonths(months, events, now) {
  if (months) return monthAxis(months, now)
  const nowMs = ts(now)
  const dated = (Array.isArray(events) ? events : []).filter((e) => !e.undated && e.atMs !== null)
  if (!dated.length || nowMs === null) return monthAxis(12, now)
  const first = Math.min(...dated.map((e) => e.atMs))
  const a = new Date(first)
  const b = new Date(nowMs)
  const span = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + 1
  return monthAxis(Math.max(1, Math.min(60, span)), now)
}

export const COST_CATEGORIES = Object.freeze([
  { key: 'service', label: 'Oil and service', field: 'oil_cost' },
  { key: 'tyres', label: 'Tyres', field: 'tyre_cost' },
  { key: 'repairs', label: 'Spare parts', field: 'spare_cost' },
  { key: 'other', label: 'Other', field: null },
])

/** The currencies the asset's classified expense lines are recorded in. */
export function costCurrencies(events) {
  const set = new Set()
  for (const e of Array.isArray(events) ? events : []) {
    if (e.countsToSpend && e.currency && num(e.value) !== null) set.add(e.currency)
  }
  return [...set].sort()
}

/**
 * Monthly maintenance cost for ONE currency, split by the expense grid's own
 * buckets. Only classified expense lines count. Returns totals per category and
 * a grand total, and `lines` (the number of lines behind it) so an empty chart
 * is read as no recorded spend rather than a zero-cost machine.
 */
export function costByMonth(events, { currency, months } = {}) {
  const axis = Array.isArray(months) ? months : []
  const idx = new Map(axis.map((m, i) => [m, i]))
  const series = Object.fromEntries(COST_CATEGORIES.map((c) => [c.key, axis.map(() => 0)]))
  const totals = Object.fromEntries(COST_CATEGORIES.map((c) => [c.key, 0]))
  let total = 0
  let lines = 0
  for (const e of Array.isArray(events) ? events : []) {
    if (!e.countsToSpend || e.undated) continue
    if (currency && e.currency !== currency) continue
    const i = idx.get(String(e.day || '').slice(0, 7))
    if (i === undefined) continue
    const line = num(e.value)
    if (line === null) continue
    const r = e.row || {}
    let known = 0
    for (const c of COST_CATEGORIES) {
      if (!c.field) continue
      const v = num(r[c.field]) || 0
      series[c.key][i] += v
      totals[c.key] += v
      known += v
    }
    const rest = line - known
    if (rest > 0.005) { series.other[i] += rest; totals.other += rest }
    lines += 1
  }
  const r2 = (v) => Math.round(v * 100) / 100
  for (const k of Object.keys(series)) series[k] = series[k].map(r2)
  for (const k of Object.keys(totals)) { totals[k] = r2(totals[k]); total += totals[k] }
  return { months: axis, series, totals, total: r2(total), lines, currency: currency || null }
}

/**
 * Downtime days per month, from the job card flow (production out to
 * production in), attributed to the month the card went out of production.
 * A month whose cards were all unmeasurable is null, never 0; a month with no
 * card at all is 0 recorded downtime.
 */
export function downtimeByMonth(episodes, { months } = {}) {
  const axis = Array.isArray(months) ? months : []
  const idx = new Map(axis.map((m, i) => [m, i]))
  const hours = axis.map(() => 0)
  const seen = axis.map(() => 0)
  const measured = axis.map(() => 0)
  for (const ep of Array.isArray(episodes) ? episodes : []) {
    const ms = ts(ep.at)
    if (ms === null) continue
    const i = idx.get(isoDay(ms).slice(0, 7))
    if (i === undefined) continue
    seen[i] += 1
    const h = num(ep.total)
    if (h === null) continue
    measured[i] += 1
    hours[i] += h
  }
  const days = axis.map((_, i) => (seen[i] > 0 && measured[i] === 0 ? null : round1(hours[i] / 24)))
  const measuredDays = days.filter((d) => d !== null)
  const total = measuredDays.length ? round1(measuredDays.reduce((s, v) => s + v, 0)) : null
  return { months: axis, days, total, cards: seen.reduce((s, v) => s + v, 0) }
}

/* ------------------------------------------------------------------ *
 * Header and KPIs                                                      *
 * ------------------------------------------------------------------ */

/**
 * The six mockup KPIs for one asset. Every value is null when the source
 * cannot support it, and each carries a `basis` line the tile shows.
 */
export function historyKpis({ fleet, events, meters, downtime, now } = {}) {
  const nowMs = ts(now)
  const list = Array.isArray(events) ? events : []
  const dated = list.filter((e) => !e.undated && e.atMs !== null)

  const regKm = num(fleet?.current_km)
  const meterKm = num(meters?.km?.last)
  const totalKm = regKm !== null && regKm > 0 ? regKm : (meterKm !== null && meterKm > 0 ? meterKm : null)
  const kmBasis = regKm !== null && regKm > 0 ? 'Register odometer' : meterKm !== null && meterKm > 0 ? 'Latest odometer log' : 'No odometer recorded'

  const startMs = ts(fleet?.operation_start_date)
  const firstMs = dated.length ? Math.min(...dated.map((e) => e.atMs)) : null
  const fromMs = startMs !== null ? startMs : firstMs
  const activeYears = fromMs !== null && nowMs !== null && nowMs >= fromMs ? round1((nowMs - fromMs) / (365.25 * DAY)) : null
  const yearsBasis = startMs !== null ? `Since ${isoDay(startMs)}` : firstMs !== null ? `Since first record ${isoDay(firstMs)}` : 'No dated record'

  const maintenanceEvents = list.filter((e) => e.source === 'job_card' || e.source === 'pm_service').length
  const tyreChanges = list.filter((e) => e.source === 'tyre_fitment').length
  const accidents = list.filter((e) => e.source === 'accident').length
  const breakdowns = list.filter((e) => e.source === 'breakdown' && String(e.id).startsWith('breakdown:')).length

  const jobHours = num(downtime?.totals?.total)
  const bdDays = num(downtime?.breakdownDays)
  const downtimeDays = jobHours !== null ? round1(jobHours / 24) : bdDays
  const downtimeBasis = jobHours !== null ? 'Job card time out of production' : bdDays !== null ? 'Breakdown register days' : 'Not measurable'

  return {
    totalKm, kmBasis,
    activeYears, yearsBasis,
    maintenanceEvents,
    tyreChanges,
    incidents: accidents + breakdowns, accidents, breakdowns,
    downtimeDays, downtimeBasis,
  }
}

/** Header facts: last service, latest utilisation reading, status. */
export function assetHeader(fleet, events) {
  const list = Array.isArray(events) ? events : []
  const lastService = list.find((e) => e.type === 'service' && !e.undated && e.source !== 'wash') || null
  const util = list.find((e) => e.source === 'utilization' && num(e.row?.utilization_pct) !== null) || null
  return {
    status: text(fleet?.status),
    opsStatus: text(fleet?.ops_status),
    make: text(fleet?.make),
    model: text(fleet?.model),
    category: text(fleet?.vehicle_type),
    year: num(fleet?.model_year),
    site: text(fleet?.site),
    operator: text(fleet?.operator_name) || text(fleet?.user1_name),
    lastServiceAt: lastService ? lastService.day : null,
    lastServiceKm: lastService ? lastService.km : null,
    utilizationPct: util ? num(util.row.utilization_pct) : null,
    utilizationAt: util ? util.day : null,
  }
}

/* ------------------------------------------------------------------ *
 * Export                                                               *
 * ------------------------------------------------------------------ */

export const HISTORY_VIEW_EXPORT_COLUMNS = Object.freeze([
  { key: 'date', header: 'Date' },
  { key: 'type', header: 'Event type' },
  { key: 'title', header: 'Event' },
  { key: 'detail', header: 'Detail' },
  { key: 'site', header: 'Site' },
  { key: 'odometer', header: 'Odometer (km)' },
  { key: 'hours', header: 'Hour meter (h)' },
  { key: 'cost', header: 'Amount' },
  { key: 'currency', header: 'Currency' },
  { key: 'downtime', header: 'Downtime (days)' },
])

export function historyViewExportRows(events) {
  return (Array.isArray(events) ? events : []).map((e) => ({
    date: e.undated ? 'Undated' : e.day,
    type: e.typeLabel,
    title: e.title || '',
    detail: e.detail || '',
    site: e.site || '',
    odometer: e.km === null || e.km === undefined ? '' : e.km,
    hours: e.hours === null || e.hours === undefined ? '' : e.hours,
    cost: num(e.value) === null || !e.currency ? '' : num(e.value),
    currency: num(e.value) === null ? '' : e.currency || '',
    downtime: e.downtimeDays === null || e.downtimeDays === undefined ? '' : e.downtimeDays,
  }))
}
