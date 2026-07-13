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

// ════════════════════════════════════════════════════════════════════════════
// Fleet Health Pulse intelligence (restored + adapted from tyre_saas
// ops_intelligence). Everything below is pure and deterministic: callers inject
// an explicit `now`, and every threshold is overridable. These power the Pulse
// hero, Anomaly feed, Financial panel and Executive strip that sit ABOVE the
// exception board. Formulas are ported verbatim from the original endpoints,
// with two honest substitutions for signals this schema does not carry:
//   • `open_critical` (no standalone alerts table) → the count of HIGH-severity
//     exceptions from `buildExceptions` (documented in the UI).
//   • retread savings / claim recoveries / emergency premium have no source
//     column → surfaced as explicit "not captured" markers, never fabricated.
// ════════════════════════════════════════════════════════════════════════════

/** Pulse thresholds (all overridable). Mirrors the original endpoint constants. */
export const DEFAULT_PULSE_THRESHOLDS = {
  pressureLow: 80, // PSI — installed tyre under this is "low pressure"
  treadLow: 3, // mm — installed tyre under this is "low tread"
  imbalancePsi: 20, // PSI spread across an asset → pressure imbalance
  overdueInspectionDays: 30, // asset with newest inspection older than this → overdue
  inspectionGapDays: 14, // asset with newest inspection older than this → gap anomaly
  costOutlierMultiple: 2, // net CPK above N× fleet mean → cost outlier
}

const DAY_MS = 24 * 3600 * 1000
const asOfMs = (now) => (now instanceof Date ? now.getTime() : Number(now))

/** A tyre is "installed" (on a vehicle now) when it has no removal date. */
export const isInstalled = (r) => isInService(r)

/** A tyre is "in stock" when its status/current_status mentions stock. */
export const isInStock = (r) => {
  const s = (r?.current_status || r?.status || '').toString().toLowerCase()
  return /stock/.test(s)
}

/**
 * Net cost-per-km for a tyre using the distance it actually earned:
 * (km_at_removal − km_at_fitment) when both are present, else total_km.
 * Returns null when cost or a positive distance is unavailable.
 */
export function tyreNetCpk(rec) {
  const cost = num(rec?.cost_per_tyre)
  const kmFit = num(rec?.km_at_fitment)
  const kmRem = num(rec?.km_at_removal)
  let km = kmRem != null && kmFit != null ? kmRem - kmFit : num(rec?.total_km)
  if (cost == null || km == null || km <= 0) return null
  return cost / km
}

/** Mean net CPK across a fleet (positive values only), or null. */
export function fleetMeanNetCpk(tyres = []) {
  const xs = (Array.isArray(tyres) ? tyres : [])
    .map(tyreNetCpk)
    .filter((v) => v != null && v > 0)
  if (!xs.length) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** cpkm status band (shared with the Financial panel + Executive strip). */
export function cpkmStatus(avgCpk) {
  if (avgCpk == null) return 'unknown'
  if (avgCpk < 0.03) return 'good'
  if (avgCpk < 0.04) return 'average'
  return 'needs_improvement'
}

/** Map asset_no → newest inspection timestamp (ms) from the inspections feed. */
export function newestInspectionByAsset(inspections = []) {
  const map = new Map()
  for (const ins of Array.isArray(inspections) ? inspections : []) {
    const asset = ins?.asset_no
    if (!asset) continue
    const raw = ins?.inspection_date || ins?.completed_date || ins?.scheduled_date
    if (!raw) continue
    const ms = new Date(raw).getTime()
    if (!Number.isFinite(ms)) continue
    const prev = map.get(asset)
    if (prev == null || ms > prev) map.set(asset, ms)
  }
  return map
}

/**
 * Count installed tyres whose asset has no inspection within the overdue window
 * (or none at all). Substitutes the original per-tyre last_inspection_at with a
 * per-asset newest inspection derived from the inspections table.
 */
export function overdueInspectionCount(tyres = [], inspections = [], opts = {}) {
  const now = asOfMs(opts.now)
  const t = { ...DEFAULT_PULSE_THRESHOLDS, ...(opts.thresholds || {}) }
  const cutoff = now - t.overdueInspectionDays * DAY_MS
  const byAsset = newestInspectionByAsset(inspections)
  let n = 0
  for (const r of (Array.isArray(tyres) ? tyres : []).filter(isInstalled)) {
    const last = r.asset_no ? byAsset.get(r.asset_no) : null
    if (last == null || last < cutoff) n += 1
  }
  return n
}

// ── Anomaly detectors (each returns normalised { type, severity, ... } items) ──

/** Installed tyres reading below the low-pressure threshold. */
export function lowPressureAnomalies(tyres = [], opts = {}) {
  const t = { ...DEFAULT_PULSE_THRESHOLDS, ...(opts.thresholds || {}) }
  const out = []
  for (const r of (Array.isArray(tyres) ? tyres : []).filter(isInstalled)) {
    const p = num(r.pressure_reading)
    if (p == null || p >= t.pressureLow) continue
    const label = serialOf(r) || r.asset_no || 'unknown tyre'
    out.push({
      type: 'low_pressure',
      severity: 'warning',
      title: `Low pressure — ${label}`,
      asset_no: r.asset_no || null,
      serial: serialOf(r),
      detail: `Pressure ${round(p, 0)} PSI is below the ${t.pressureLow} PSI minimum${
        r.asset_no ? ` on asset ${r.asset_no}` : ''
      }.`,
      action: 'Inflate to spec — under-inflation accelerates wear and raises blowout risk.',
    })
  }
  return out
}

/** Assets with ≥2 installed pressures spread beyond the imbalance threshold. */
export function pressureImbalanceAnomalies(tyres = [], opts = {}) {
  const t = { ...DEFAULT_PULSE_THRESHOLDS, ...(opts.thresholds || {}) }
  const byAsset = new Map()
  for (const r of (Array.isArray(tyres) ? tyres : []).filter(isInstalled)) {
    const p = num(r.pressure_reading)
    if (p == null || !r.asset_no) continue
    if (!byAsset.has(r.asset_no)) byAsset.set(r.asset_no, [])
    byAsset.get(r.asset_no).push(p)
  }
  const out = []
  for (const [asset, ps] of [...byAsset.entries()].sort((a, b) =>
    String(a[0]).localeCompare(String(b[0])),
  )) {
    if (ps.length < 2) continue
    const mx = Math.max(...ps)
    const mn = Math.min(...ps)
    if (mx - mn <= t.imbalancePsi) continue
    out.push({
      type: 'pressure_imbalance',
      severity: 'warning',
      title: `Pressure imbalance — ${asset}`,
      asset_no: asset,
      serial: null,
      detail: `Pressure varies ${round(mx - mn, 0)} PSI across the asset (${round(mn, 0)}–${round(
        mx,
        0,
      )} PSI).`,
      action: 'Equalise pressures — imbalance causes uneven wear and vehicle pull.',
    })
  }
  return out
}

/** Tyres whose net CPK exceeds N× the fleet mean. Reports the multiple. */
export function costOutlierAnomalies(tyres = [], opts = {}) {
  const t = { ...DEFAULT_PULSE_THRESHOLDS, ...(opts.thresholds || {}) }
  const list = Array.isArray(tyres) ? tyres : []
  const mean = fleetMeanNetCpk(list)
  if (mean == null) return []
  const out = []
  for (const r of list) {
    const cpk = tyreNetCpk(r)
    if (cpk == null || cpk <= 0 || cpk <= mean * t.costOutlierMultiple) continue
    const mult = round(cpk / mean, 1)
    const label = serialOf(r) || r.asset_no || 'unknown tyre'
    out.push({
      type: 'cost_outlier',
      severity: 'warning',
      title: `High cost tyre — ${label}`,
      asset_no: r.asset_no || null,
      serial: serialOf(r),
      cpk: round(cpk, 4),
      multiple: mult,
      detail: `Net CPK ${round(cpk, 4)} — ${mult}× the fleet mean (${round(mean, 4)}).`,
      action: 'Review usage pattern — consider early replacement.',
    })
  }
  return out
}

/** Assets (from installed tyres) with newest inspection older than the gap window. */
export function inspectionGapAnomalies(tyres = [], inspections = [], opts = {}) {
  const now = asOfMs(opts.now)
  const t = { ...DEFAULT_PULSE_THRESHOLDS, ...(opts.thresholds || {}) }
  const cutoff = now - t.inspectionGapDays * DAY_MS
  const byAsset = newestInspectionByAsset(inspections)
  const assets = [
    ...new Set((Array.isArray(tyres) ? tyres : []).filter(isInstalled).map((r) => r.asset_no).filter(Boolean)),
  ].sort()
  const out = []
  for (const asset of assets) {
    const last = byAsset.get(asset)
    if (last != null && last >= cutoff) continue
    const days = last == null ? null : Math.floor((now - last) / DAY_MS)
    out.push({
      type: 'inspection_gap',
      severity: 'warning',
      title: `Inspection gap — ${asset}`,
      asset_no: asset,
      serial: null,
      detail:
        last == null
          ? `No inspection on record — compliance requires inspection within ${t.overdueInspectionDays} days.`
          : `No inspection for ${days}d — exceeds the ${t.inspectionGapDays}-day review window.`,
      action: 'Schedule inspection immediately.',
    })
  }
  return out
}

export const ANOMALY_SEVERITY_RANK = { critical: 3, warning: 2, info: 1 }

/**
 * Build the full anomaly feed from buildable detectors (pressure low, pressure
 * imbalance, cost outlier, inspection gap), severity-sorted (critical first).
 * Retread-on-front, tread-leak and telemetry-gap detectors from the original
 * are intentionally OMITTED — they need axle/retread/TPMS data this schema does
 * not capture, and are surfaced to the user as an honest "not captured" note.
 */
export function buildAnomalyFeed({ tyres = [], inspections = [] } = {}, opts = {}) {
  if (opts.now == null) {
    throw new Error('buildAnomalyFeed requires an explicit `now` (ms or Date).')
  }
  const t = { ...DEFAULT_PULSE_THRESHOLDS, ...(opts.thresholds || {}) }
  const o = { now: opts.now, thresholds: t }
  const items = [
    ...lowPressureAnomalies(tyres, o),
    ...pressureImbalanceAnomalies(tyres, o),
    ...costOutlierAnomalies(tyres, o),
    ...inspectionGapAnomalies(tyres, inspections, o),
  ]
  items.sort(
    (a, b) =>
      (ANOMALY_SEVERITY_RANK[b.severity] || 0) - (ANOMALY_SEVERITY_RANK[a.severity] || 0) ||
      String(a.type).localeCompare(String(b.type)) ||
      String(a.asset_no || a.serial || '').localeCompare(String(b.asset_no || b.serial || '')),
  )
  return items
}

/** Aggregate an anomaly feed into total / critical / warning counts. */
export function summarizeAnomalies(items = []) {
  const list = Array.isArray(items) ? items : []
  return {
    total: list.length,
    critical: list.filter((a) => a.severity === 'critical').length,
    warnings: list.filter((a) => a.severity === 'warning').length,
  }
}

/**
 * Fleet Health score (0–100) — the signature metric. Ported verbatim:
 *   risk = open_critical*15 + low_pressure*5 + low_tread*8
 *          + min(30, overdue_inspection*0.5) + urgent_work_orders*4
 *   score = clamp(0..100, round(100 − risk / max(total_tyres, 1), 1))
 * `openCritical` is the HIGH-severity exception count (alerts-table substitute).
 */
export function computeFleetHealth({
  openCritical = 0,
  lowPressure = 0,
  lowTread = 0,
  overdueInspection = 0,
  urgentWorkOrders = 0,
  totalTyres = 0,
} = {}) {
  const riskItems = {
    openCritical: openCritical * 15,
    lowPressure: lowPressure * 5,
    lowTread: lowTread * 8,
    overdueInspection: Math.min(30, overdueInspection * 0.5),
    urgentWorkOrders: urgentWorkOrders * 4,
  }
  const totalRisk = Object.values(riskItems).reduce((a, b) => a + b, 0)
  const score = Math.max(0, Math.min(100, round(100 - totalRisk / Math.max(totalTyres, 1), 1)))
  return {
    score,
    status: score < 60 ? 'critical' : score < 80 ? 'warning' : 'good',
    riskItems,
    totalRisk: round(totalRisk, 1),
    requiresImmediateAction: openCritical > 0 || lowTread > 0,
    complianceRisk: overdueInspection > 10 ? 'high' : overdueInspection > 5 ? 'medium' : 'low',
  }
}

const isOpenWorkOrder = (w) => {
  const s = (w?.status || '').toString().toLowerCase()
  return ['open', 'assigned', 'in progress', 'in-progress', 'in_progress'].includes(s)
}
const isUrgentWorkOrder = (w) => {
  const s = (w?.status || '').toString().toLowerCase()
  const p = (w?.priority || '').toString().toLowerCase()
  return (s === 'open' || s === 'assigned') && ['urgent', 'high', 'critical'].includes(p)
}

/**
 * Assemble the full Fleet Health Pulse from live datasets. Returns the health
 * score/status/bands plus every headline count the Pulse grid renders.
 * `activeVehicles` is passed through (null when the source is unavailable).
 */
export function buildFleetPulse(
  { tyres = [], workOrders = [], inspections = [], activeVehicles = null } = {},
  opts = {},
) {
  if (opts.now == null) {
    throw new Error('buildFleetPulse requires an explicit `now` (ms or Date).')
  }
  const t = { ...DEFAULT_PULSE_THRESHOLDS, ...(opts.thresholds || {}) }
  const tyreList = Array.isArray(tyres) ? tyres : []
  const woList = Array.isArray(workOrders) ? workOrders : []
  const installed = tyreList.filter(isInstalled)
  const inStock = tyreList.filter(isInStock)
  const lowPressure = installed.filter((r) => {
    const p = num(r.pressure_reading)
    return p != null && p < t.pressureLow
  }).length
  const lowTread = installed.filter((r) => {
    const td = num(r.tread_depth)
    return td != null && td < t.treadLow
  }).length
  const overdueInspection = overdueInspectionCount(tyreList, inspections, {
    now: opts.now,
    thresholds: t,
  })
  const urgentWorkOrders = woList.filter(isUrgentWorkOrder).length
  const openWorkOrders = woList.filter(isOpenWorkOrder).length

  // open_critical substitute: HIGH-severity exceptions from the exception engine.
  const exceptions = buildExceptions(
    { tyres: tyreList, workOrders: woList },
    { now: opts.now, thresholds: opts.exceptionThresholds },
  )
  const openCritical = exceptions.filter((e) => e.severity === 'high').length

  const health = computeFleetHealth({
    openCritical,
    lowPressure,
    lowTread,
    overdueInspection,
    urgentWorkOrders,
    totalTyres: tyreList.length,
  })

  return {
    ...health,
    openCritical,
    counts: {
      activeVehicles: activeVehicles == null ? null : activeVehicles,
      totalTyres: tyreList.length,
      installed: installed.length,
      inStock: inStock.length,
      lowPressure,
      lowTread,
      overdueInspection,
      urgentWorkOrders,
      openWorkOrders,
    },
  }
}

const inYear = (raw, year) => {
  if (!raw) return false
  const d = new Date(raw)
  return !Number.isNaN(d.getTime()) && d.getFullYear() === year
}

/**
 * Financial Intelligence (partial + honest). annual_budget = Σ budgets for the
 * current year; ytd tyre spend = Σ cost_per_tyre issued this year (labelled as
 * TYRE spend, not total procurement); consumption band from the two. Retread
 * savings / claim recoveries / emergency premium have no source column here and
 * are surfaced via `notCaptured`, never invented.
 */
export function buildFinancials({ budgets = [], tyres = [] } = {}, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now())
  const year = Number.isNaN(now.getTime()) ? new Date().getFullYear() : now.getFullYear()
  const budgetList = Array.isArray(budgets) ? budgets : []
  const tyreList = Array.isArray(tyres) ? tyres : []

  const annualBudget = budgetList.reduce((acc, b) => {
    if (b?.year != null && Number(b.year) !== year) return acc
    return acc + (num(b?.monthly_budget) || 0)
  }, 0)
  const ytdSpend = tyreList.reduce((acc, r) => {
    const d = r?.issue_date || r?.fitment_date
    return inYear(d, year) ? acc + (num(r?.cost_per_tyre) || 0) : acc
  }, 0)

  const consumptionPct = annualBudget > 0 ? round((ytdSpend / annualBudget) * 100, 1) : null
  const budgetStatus =
    consumptionPct == null
      ? 'unknown'
      : consumptionPct > 90
        ? 'critical'
        : consumptionPct > 75
          ? 'warning'
          : 'on_track'

  const cpkValues = tyreList.map(tyreNetCpk).filter((v) => v != null && v > 0)
  const avgCpk = cpkValues.length
    ? round(cpkValues.reduce((a, b) => a + b, 0) / cpkValues.length, 4)
    : null

  return {
    year,
    annualBudget: round(annualBudget, 2),
    ytdTyreSpend: round(ytdSpend, 2),
    remainingBudget: annualBudget > 0 ? round(annualBudget - ytdSpend, 2) : null,
    budgetConsumptionPct: consumptionPct,
    budgetStatus,
    avgCpk,
    cpkmStatus: cpkmStatus(avgCpk),
    cpkDataPoints: cpkValues.length,
    // No source column in the current schema — surfaced honestly, never faked.
    notCaptured: ['retread_savings', 'claim_recoveries', 'emergency_premium'],
  }
}

/**
 * Executive summary — 4 headlines (safety / operations / financial / cpk) plus
 * an action-required flag, composed from the pulse, anomalies and financials.
 */
export function buildExecutiveSummary({ pulse, anomalies = [], financials } = {}, opts = {}) {
  const currency = opts.currency || 'AED'
  const fmt = (n) =>
    n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
  const c = pulse?.counts || {}
  const anomSummary = summarizeAnomalies(anomalies)

  const safety = `${pulse?.openCritical ?? 0} high-severity exceptions · ${c.lowPressure ?? 0} low pressure · ${c.lowTread ?? 0} low tread`
  const operations = `${c.openWorkOrders ?? 0} open WOs · ${c.urgentWorkOrders ?? 0} urgent`
  const financial = financials
    ? `${currency} ${fmt(financials.ytdTyreSpend)} YTD tyre spend · ${
        financials.budgetConsumptionPct == null
          ? 'no budget set'
          : `${financials.budgetConsumptionPct}% of budget`
      }`
    : 'Financial data unavailable'
  const cpk =
    financials?.avgCpk != null
      ? `${financials.avgCpk} ${currency}/km fleet average`
      : 'CPK data insufficient'

  return {
    fleetHealthScore: pulse?.score ?? null,
    fleetHealthStatus: pulse?.status ?? 'unknown',
    headlines: { safety, operations, financial, cpk },
    anomalies: anomSummary,
    actionRequired: !!pulse?.requiresImmediateAction,
  }
}
