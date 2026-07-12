/**
 * Ops Intelligence — pure exception engine (no I/O) for the Exception Command
 * Center module. It scans the fleet's existing operational data (tyre_records +
 * work_orders) and derives a normalised feed of "things that need action now",
 * each carrying a severity, category, the affected asset/tyre, a human detail
 * line, and a deep-link into the module that resolves it.
 *
 * Everything here is deterministic and unit-tested: the caller injects a
 * reference `now` (ms or Date) — this module never reads Date.now itself — so the
 * age-derived exceptions are reproducible in tests. Banding for tyre age reuses
 * the single source of truth in `./tyreAge`.
 */
import { tyreAgeBand, tyreAgeYears } from './tyreAge'

// ── Category / severity vocabularies ───────────────────────────────────────────
export const SEVERITIES = ['high', 'medium', 'low']

export const SEVERITY_META = {
  high: { label: 'High', rank: 3 },
  medium: { label: 'Medium', rank: 2 },
  low: { label: 'Low', rank: 1 },
}

export const CATEGORIES = [
  'aged_tyre',
  'low_tread',
  'high_cpk',
  'recent_failure',
  'open_work_order',
]

export const CATEGORY_META = {
  aged_tyre: { label: 'Aged tyre', module: 'Tyre Passport' },
  low_tread: { label: 'Low tread', module: 'Tyre Passport' },
  high_cpk: { label: 'High CPK', module: 'Tyre Passport' },
  recent_failure: { label: 'Recent failure', module: 'Tyre Passport' },
  open_work_order: { label: 'Open work order', module: 'Work Orders' },
}

// ── Tunable thresholds (all overridable from the page/service) ──────────────────
export const DEFAULT_OPS_THRESHOLDS = {
  treadHigh: 3, // mm — at/under → high severity
  treadMedium: 5, // mm — under → medium severity
  cpkPercentile: 0.9, // fleet CPK cut-off for the "high CPK" exception
}

// ── Small pure helpers ──────────────────────────────────────────────────────────
const num = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

const serialOf = (r) =>
  r?.serial_no || r?.serial_number || r?.tyre_serial || null

const removalReasonOf = (r) =>
  (r?.reason_for_removal || r?.removal_reason || '').toString().trim()

const isInService = (r) => !r?.removal_date

const round = (n, dp = 2) => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** Cost-per-kilometre for a tyre, or null when it cannot be computed. */
export function tyreCpk(rec) {
  const cost = num(rec?.cost_per_tyre)
  const km = num(rec?.total_km)
  if (cost == null || km == null || km <= 0) return null
  return cost / km
}

/**
 * Linear-interpolated percentile of a numeric array (ascending). Deterministic;
 * returns null for an empty set. Used for the fleet CPK cut-off.
 */
export function percentile(values, p) {
  const xs = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!xs.length) return null
  if (xs.length === 1) return xs[0]
  const clamped = Math.min(Math.max(p, 0), 1)
  const idx = clamped * (xs.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return xs[lo]
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo)
}

const tyreLink = (serial) =>
  serial ? `/tyre-passport/${encodeURIComponent(serial)}` : '/tyre-passport'

/**
 * Build the full exception feed from the fleet's tyre + work-order data.
 *
 * @param {{ tyres?: object[], workOrders?: object[] }} data
 * @param {{ now: number|Date, thresholds?: object }} opts
 * @returns {Array<{ id, category, severity, title, asset_no, site, detail, link,
 *   serial, cpk, ageYears }>} sorted most-severe first (stable within severity).
 */
export function buildExceptions({ tyres = [], workOrders = [] } = {}, opts = {}) {
  const now = opts.now
  if (now == null) {
    throw new Error('buildExceptions requires an explicit `now` (ms or Date).')
  }
  const t = { ...DEFAULT_OPS_THRESHOLDS, ...(opts.thresholds || {}) }
  const out = []

  const tyreList = Array.isArray(tyres) ? tyres : []
  const inService = tyreList.filter(isInService)

  // Fleet CPK 90th percentile — computed once from in-service tyres with usable
  // mileage, so the "high CPK" flag is relative to this fleet, not a magic number.
  const cpkValues = inService
    .map((r) => tyreCpk(r))
    .filter((v) => v != null)
  const cpkCut = percentile(cpkValues, t.cpkPercentile)

  for (const r of inService) {
    const serial = serialOf(r)
    const asset = r.asset_no || null
    const site = r.site || null
    const label = serial || asset || 'Unknown tyre'

    // 1. Aged tyre — non-compliant age band.
    if (tyreAgeBand(r, now) === 'non_compliant') {
      const yrs = tyreAgeYears(r, now)
      out.push({
        id: `aged:${serial || asset || r.id}`,
        category: 'aged_tyre',
        severity: 'high',
        title: `Aged tyre — ${label}`,
        asset_no: asset,
        site,
        serial,
        ageYears: yrs,
        cpk: null,
        detail: `In service ${yrs == null ? 'over the age limit' : `${yrs} yrs`}${
          r.brand ? ` · ${r.brand}` : ''
        }${r.size ? ` ${r.size}` : ''} — exceeds the fleet age limit.`,
        link: tyreLink(serial),
      })
    }

    // 2. Low tread.
    const tread = num(r.tread_depth)
    if (tread != null && tread < t.treadMedium) {
      const high = tread < t.treadHigh
      out.push({
        id: `tread:${serial || asset || r.id}`,
        category: 'low_tread',
        severity: high ? 'high' : 'medium',
        title: `Low tread ${round(tread, 1)}mm — ${label}`,
        asset_no: asset,
        site,
        serial,
        ageYears: null,
        cpk: null,
        detail: `Tread depth ${round(tread, 1)}mm is below the ${
          high ? t.treadHigh : t.treadMedium
        }mm ${high ? 'replacement' : 'advisory'} threshold${
          asset ? ` on asset ${asset}` : ''
        }.`,
        link: tyreLink(serial),
      })
    }

    // 3. High CPK — above the fleet 90th percentile.
    const cpk = tyreCpk(r)
    if (cpk != null && cpkCut != null && cpk > cpkCut) {
      out.push({
        id: `cpk:${serial || asset || r.id}`,
        category: 'high_cpk',
        severity: 'medium',
        title: `High CPK — ${label}`,
        asset_no: asset,
        site,
        serial,
        ageYears: null,
        cpk: round(cpk, 4),
        detail: `Cost-per-km ${round(cpk, 3)} is above the fleet 90th percentile (${round(
          cpkCut,
          3,
        )}).`,
        link: tyreLink(serial),
      })
    }
  }

  // 4. Recent failure — a removed tyre carrying a removal reason.
  for (const r of tyreList) {
    if (isInService(r)) continue
    const reason = removalReasonOf(r)
    if (!reason) continue
    const serial = serialOf(r)
    const asset = r.asset_no || null
    const label = serial || asset || 'Unknown tyre'
    out.push({
      id: `failure:${serial || asset || r.id}`,
      category: 'recent_failure',
      severity: 'medium',
      title: `Tyre removed — ${label}`,
      asset_no: asset,
      site: r.site || null,
      serial,
      ageYears: null,
      cpk: null,
      detail: `Removed for "${reason}"${r.removal_date ? ` on ${r.removal_date}` : ''}${
        r.brand ? ` · ${r.brand}` : ''
      }.`,
      link: tyreLink(serial),
    })
  }

  // 5. Open high-priority work order.
  const woList = Array.isArray(workOrders) ? workOrders : []
  for (const w of woList) {
    const status = (w?.status || '').toString().trim().toLowerCase()
    const priority = (w?.priority || '').toString().trim().toLowerCase()
    const isOpen = status === 'open' || status === 'in progress' || status === 'in-progress'
    const isUrgent = priority === 'high' || priority === 'critical'
    if (!isOpen || !isUrgent) continue
    const woNo = w.work_order_no || w.id
    out.push({
      id: `wo:${woNo}`,
      category: 'open_work_order',
      severity: 'high',
      title: `${priority === 'critical' ? 'Critical' : 'High-priority'} work order — ${woNo}`,
      asset_no: w.asset_no || null,
      site: w.site || null,
      serial: null,
      ageYears: null,
      cpk: null,
      detail: `${w.status} · ${w.priority} priority${
        w.asset_no ? ` · asset ${w.asset_no}` : ''
      }${w.created_at ? ` · opened ${String(w.created_at).slice(0, 10)}` : ''}.`,
      link: '/work-orders',
    })
  }

  // Deterministic order: severity desc, then category order, then title.
  const catRank = (c) => CATEGORIES.indexOf(c)
  out.sort((a, b) => {
    const s = (SEVERITY_META[b.severity]?.rank || 0) - (SEVERITY_META[a.severity]?.rank || 0)
    if (s !== 0) return s
    const c = catRank(a.category) - catRank(b.category)
    if (c !== 0) return c
    return (a.title || '').localeCompare(b.title || '')
  })

  return out
}

/**
 * Aggregate a built exception feed into counts by severity + category and a
 * top-line total. Pure and deterministic.
 */
export function summarizeExceptions(exceptions = []) {
  const list = Array.isArray(exceptions) ? exceptions : []
  const bySeverity = { high: 0, medium: 0, low: 0 }
  const byCategory = CATEGORIES.reduce((acc, c) => ({ ...acc, [c]: 0 }), {})
  const affectedAssets = new Set()

  for (const e of list) {
    if (e.severity in bySeverity) bySeverity[e.severity] += 1
    if (e.category in byCategory) byCategory[e.category] += 1
    if (e.asset_no) affectedAssets.add(e.asset_no)
  }

  return {
    total: list.length,
    bySeverity,
    byCategory,
    affectedAssets: affectedAssets.size,
  }
}
