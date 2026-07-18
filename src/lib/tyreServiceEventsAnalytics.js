/**
 * Pure, unit-testable analytics for Tyre Service Events (the fit / remove /
 * rotate / repair lifecycle log behind CPK and rotation). NO I/O, NO Supabase.
 *
 * This module complements src/lib/tyreServiceEvents.js (which owns the base
 * `summarizeServiceEvents` KPI reducer + EVENT_TYPES/EVENT_TYPE_META vocab) with
 * the deeper operational intelligence the page needs: type breakdown with
 * percentages, monthly trend, most-active assets / positions, site distribution,
 * removal-reason data quality, and the mean interval between interventions per
 * tyre. Everything is derived from the REAL columns on `tyre_service_events`
 * (event_type/event_date/asset_no/tyre_serial/position/site/cost/notes) and
 * degrades honestly to empty / null when the data cannot support a metric.
 *
 * Real event-type vocab (V151, verified against the live table): rotation,
 * repair, inflation, inspection, replacement, other. There is NO structured
 * removal_reason column, so "documented removal reason" is measured against the
 * real free-text `notes` column for the corrective (replacement / repair)
 * events that physically remove or change a tyre.
 */

import { EVENT_TYPES, EVENT_TYPE_META } from './tyreServiceEvents'

/**
 * Corrective interventions that remove or change a tyre and therefore should
 * carry a documented reason. Kept explicit (not inferred) so the data-quality
 * metric stays honest.
 */
export const REMOVAL_TYPES = ['replacement', 'repair']

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86400000

/** Coerce to a finite number or 0. */
const toNum = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** Trimmed string or '' (never null). */
const str = (v) => (v == null ? '' : String(v).trim())

/** Normalise an event_type to one of the six known tokens (unknown -> 'other'). */
export function normEventType(t) {
  const v = str(t).toLowerCase()
  return EVENT_TYPES.includes(v) ? v : 'other'
}

/** Human label for an event type. */
export function eventTypeLabel(t) {
  const v = normEventType(t)
  return EVENT_TYPE_META[v]?.label || v
}

/** Parse an event row's date to epoch ms, or null when unparseable. */
export function eventTime(row) {
  const raw = row?.event_date || row?.created_at
  if (!raw) return null
  // date-only strings ('YYYY-MM-DD') parse as UTC midnight, which is what we want
  const t = Date.parse(String(raw).length <= 10 ? `${String(raw).slice(0, 10)}T00:00:00Z` : raw)
  return Number.isFinite(t) ? t : null
}

/** 'YYYY-MM' bucket key from a row, or null. */
function monthKeyOf(row) {
  const raw = row?.event_date || row?.created_at
  if (!raw) return null
  const s = String(raw)
  if (s.length >= 7 && s[4] === '-') return s.slice(0, 7)
  const t = eventTime(row)
  if (t == null) return null
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key) {
  const [y, m] = String(key).split('-')
  const idx = Number(m) - 1
  return idx >= 0 && idx < 12 ? `${MONTHS_SHORT[idx]} ${y}` : String(key)
}

const rows_ = (rows) => (Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [])

// ─── Breakdown by event type ────────────────────────────────────────────────
/**
 * Count events per type. Returns the full `byType` map (all six keys, zero-filled)
 * plus `items` (only types that occur, sorted by count desc then label) carrying
 * label, colour and share-of-total percentage.
 */
export function eventTypeBreakdown(rows = []) {
  const list = rows_(rows)
  const byType = EVENT_TYPES.reduce((a, t) => { a[t] = 0; return a }, {})
  for (const r of list) byType[normEventType(r.event_type)] += 1
  const total = list.length
  const items = EVENT_TYPES
    .filter((t) => byType[t] > 0)
    .map((t) => ({
      type: t,
      label: EVENT_TYPE_META[t].label,
      color: EVENT_TYPE_META[t].color,
      count: byType[t],
      pct: total ? Math.round((byType[t] / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return { total, byType, items }
}

// ─── Monthly trend ──────────────────────────────────────────────────────────
/**
 * Events per calendar month for the last `months` months ending at `ref`.
 * Each bucket carries the total and a per-type breakdown so the chart can stack.
 * @returns {Array<{ key:string, label:string, total:number, byType:Record<string,number> }>}
 */
export function monthlyTrend(rows = [], months = 12, ref = new Date()) {
  const n = Math.max(1, Math.floor(months))
  const base = ref instanceof Date && !Number.isNaN(ref.getTime()) ? ref : new Date()
  const buckets = []
  const index = new Map()
  let y = base.getUTCFullYear()
  let m = base.getUTCMonth() // 0-based
  // walk back n-1 months from ref
  y = base.getUTCFullYear()
  m = base.getUTCMonth() - (n - 1)
  while (m < 0) { m += 12; y -= 1 }
  for (let i = 0; i < n; i++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    const bucket = { key, label: monthLabel(key), total: 0, byType: EVENT_TYPES.reduce((a, t) => { a[t] = 0; return a }, {}) }
    buckets.push(bucket)
    index.set(key, bucket)
    m += 1
    if (m > 11) { m = 0; y += 1 }
  }
  for (const r of rows_(rows)) {
    const key = monthKeyOf(r)
    const bucket = key && index.get(key)
    if (bucket) { bucket.total += 1; bucket.byType[normEventType(r.event_type)] += 1 }
  }
  return buckets
}

// ─── Grouped rankings ───────────────────────────────────────────────────────
function rankBy(rows, keyField, limit) {
  const map = new Map()
  for (const r of rows_(rows)) {
    const key = str(r[keyField])
    if (!key) continue
    const cur = map.get(key) || { key, count: 0, totalCost: 0, lastTime: null }
    cur.count += 1
    cur.totalCost += toNum(r.cost)
    const t = eventTime(r)
    if (t != null && (cur.lastTime == null || t > cur.lastTime)) cur.lastTime = t
    map.set(key, cur)
  }
  const arr = [...map.values()]
    .map((x) => ({
      key: x.key,
      count: x.count,
      totalCost: Math.round(x.totalCost * 100) / 100,
      lastDate: x.lastTime == null ? null : new Date(x.lastTime).toISOString().slice(0, 10),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  return limit ? arr.slice(0, limit) : arr
}

/** Most-serviced assets (by asset_no) with event count, spend and last-seen date. */
export function topAssets(rows = [], limit = 10) {
  return rankBy(rows, 'asset_no', limit).map(({ key, ...rest }) => ({ asset_no: key, ...rest }))
}

/** Most-serviced wheel positions (by position). */
export function topPositions(rows = [], limit = 10) {
  return rankBy(rows, 'position', limit).map(({ key, ...rest }) => ({ position: key, ...rest }))
}

/** Event distribution by site (workshop / depot). */
export function bySite(rows = [], limit = 0) {
  return rankBy(rows, 'site', limit).map(({ key, ...rest }) => ({ site: key, ...rest }))
}

// ─── Removal-reason data quality ────────────────────────────────────────────
/**
 * How well the corrective (replacement / repair) events are documented. A
 * removal without a recorded reason (blank `notes`) is a data-quality gap that
 * erodes root-cause analysis. Percentages are share of the removal events only.
 * @returns {{ removalEvents:number, documented:number, blank:number, documentedPct:number }}
 */
export function removalReasonQuality(rows = []) {
  let removalEvents = 0
  let documented = 0
  for (const r of rows_(rows)) {
    if (!REMOVAL_TYPES.includes(normEventType(r.event_type))) continue
    removalEvents += 1
    if (str(r.notes)) documented += 1
  }
  const blank = removalEvents - documented
  return {
    removalEvents,
    documented,
    blank,
    documentedPct: removalEvents ? Math.round((documented / removalEvents) * 1000) / 10 : 0,
  }
}

// ─── Mean interval between interventions ────────────────────────────────────
/**
 * Mean number of days between consecutive service events on the SAME key
 * (default: tyre serial), averaged across every consecutive pair. Needs at
 * least two dated events on a key; returns null samples-honestly otherwise.
 * Distance between events is intentionally NOT derived: `tyre_service_events`
 * carries no odometer/mileage column, so a km interval would be fabrication.
 * @returns {{ meanDays:number|null, pairs:number, keys:number }}
 */
export function meanIntervalDays(rows = [], keyField = 'tyre_serial') {
  const groups = new Map()
  for (const r of rows_(rows)) {
    const key = str(r[keyField])
    const t = eventTime(r)
    if (!key || t == null) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }
  let totalDays = 0
  let pairs = 0
  let keysWithInterval = 0
  for (const times of groups.values()) {
    if (times.length < 2) continue
    times.sort((a, b) => a - b)
    keysWithInterval += 1
    for (let i = 1; i < times.length; i++) {
      totalDays += (times[i] - times[i - 1]) / DAY_MS
      pairs += 1
    }
  }
  return {
    meanDays: pairs ? Math.round((totalDays / pairs) * 10) / 10 : null,
    pairs,
    keys: keysWithInterval,
  }
}

// ─── KPI tiles ──────────────────────────────────────────────────────────────
/**
 * Headline KPIs for the page tiles.
 * @param {Array<object>} rows
 * @param {{ periodDays?:number, now?:Date }} [opts]
 */
export function computeKpis(rows = [], { periodDays = 30, now = new Date() } = {}) {
  const list = rows_(rows)
  const ref = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now()
  const since = ref - Math.max(1, periodDays) * DAY_MS
  const assets = new Set()
  const tyres = new Set()
  let thisPeriod = 0
  let totalCost = 0
  for (const r of list) {
    const a = str(r.asset_no); if (a) assets.add(a)
    const s = str(r.tyre_serial); if (s) tyres.add(s)
    totalCost += toNum(r.cost)
    const t = eventTime(r)
    if (t != null && t >= since && t <= ref) thisPeriod += 1
  }
  const breakdown = eventTypeBreakdown(list)
  const removal = removalReasonQuality(list)
  const interval = meanIntervalDays(list, 'tyre_serial')
  const top = breakdown.items[0] || null
  return {
    total: list.length,
    thisPeriod,
    periodDays: Math.max(1, periodDays),
    topType: top ? { type: top.type, label: top.label, count: top.count } : null,
    distinctAssets: assets.size,
    distinctTyres: tyres.size,
    totalCost: Math.round(totalCost * 100) / 100,
    removalDocumentedPct: removal.documentedPct,
    removalBlank: removal.blank,
    removalEvents: removal.removalEvents,
    meanDaysBetween: interval.meanDays,
  }
}

// ─── Filtering (table) ──────────────────────────────────────────────────────
/**
 * Filter/search event rows. All predicates are ANDed. Empty / 'all' filters are
 * no-ops. `search` matches serial, asset, position, technician, site and notes.
 * @param {Array<object>} rows
 * @param {{ type?:string, site?:string, position?:string, from?:string, to?:string, search?:string }} [f]
 */
export function filterEvents(rows = [], f = {}) {
  const type = f.type && f.type !== 'all' ? normEventType(f.type) : null
  const site = f.site && f.site !== 'all' ? str(f.site).toLowerCase() : null
  const position = f.position && f.position !== 'all' ? str(f.position).toLowerCase() : null
  const q = str(f.search).toLowerCase()
  const from = f.from ? Date.parse(`${String(f.from).slice(0, 10)}T00:00:00Z`) : null
  const to = f.to ? Date.parse(`${String(f.to).slice(0, 10)}T23:59:59Z`) : null
  return rows_(rows).filter((r) => {
    if (type && normEventType(r.event_type) !== type) return false
    if (site && str(r.site).toLowerCase() !== site) return false
    if (position && str(r.position).toLowerCase() !== position) return false
    if (from != null || to != null) {
      const t = eventTime(r)
      if (t == null) return false
      if (from != null && t < from) return false
      if (to != null && t > to) return false
    }
    if (q) {
      const hay = `${r.tyre_serial || ''} ${r.asset_no || ''} ${r.position || ''} ${r.technician || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Distinct, sorted, non-empty values of a field (for filter dropdowns). */
export function distinctValues(rows = [], field) {
  const set = new Set()
  for (const r of rows_(rows)) { const v = str(r[field]); if (v) set.add(v) }
  return [...set].sort((a, b) => a.localeCompare(b))
}

// ─── Master roll-up ─────────────────────────────────────────────────────────
/**
 * Everything the page needs in one pass. Pure; safe on [] / null.
 * @param {Array<object>} rows
 * @param {{ periodDays?:number, months?:number, now?:Date, topN?:number }} [opts]
 */
export function analyzeServiceEvents(rows = [], opts = {}) {
  const { periodDays = 30, months = 12, now = new Date(), topN = 8 } = opts
  const list = rows_(rows)
  return {
    kpis: computeKpis(list, { periodDays, now }),
    breakdown: eventTypeBreakdown(list),
    trend: monthlyTrend(list, months, now),
    topAssets: topAssets(list, topN),
    topPositions: topPositions(list, topN),
    bySite: bySite(list, topN),
    removalQuality: removalReasonQuality(list),
    interval: meanIntervalDays(list, 'tyre_serial'),
    sites: distinctValues(list, 'site'),
    positions: distinctValues(list, 'position'),
  }
}
