/**
 * cpkOverviewView.js - pure shaping for the CPK Intelligence overview tab
 * (owner mockup: 5 KPIs, movable cost/km bars, non-movable cost/hour bars,
 * "Why CPK changed", asset-type table, data-quality lineage).
 *
 * No I/O. Inputs are the shapes returned by get_fleet_cpk (fleet / by_type /
 * per_vehicle) and get_cpk_drivers. Nothing is fabricated: a figure the data
 * cannot support comes back null and the page renders "N/A".
 */
import { fleetSideFor, mobilityOfUnit } from './cpkModule'
import { decomposeDrivers, waterfallSteps } from './cpkDrivers'

const fin = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const num = (v) => fin(v) ?? 0

const p2 = (n) => String(n).padStart(2, '0')
const isoUtc = (d) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
const parseDay = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null)

/**
 * The same-length window immediately before {from,to} (inclusive days). This is
 * the comparison window the KPI trend arrows use, and the same default the
 * get_cpk_drivers RPC applies, so the arrows and "Why CPK changed" agree.
 */
export function previousWindow(from, to) {
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b || a > b) return null
  const days = Math.round((b - a) / 86400000) + 1
  const end = new Date(a); end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - (days - 1))
  return { from: isoUtc(start), to: isoUtc(end), days }
}

/** Whole-number percent change, null when either side is missing or prev is 0. */
export function pctChange(cur, prev) {
  const c = fin(cur)
  const p = fin(prev)
  if (c == null || p == null || p === 0) return null
  return Math.round(((c - p) / Math.abs(p)) * 100)
}

/** Whole percentage-point difference between two coverage percentages. */
export function pointChange(cur, prev) {
  const c = fin(cur)
  const p = fin(prev)
  if (c == null || p == null) return null
  return Math.round(c - p)
}

/**
 * The five headline tiles. `cur`/`prev` are single fleet[] rows (one country).
 * Trends are only returned when the previous window was actually loaded and
 * carried the same measure; otherwise they are null (no arrow drawn).
 */
export function overviewKpis(cur, prev) {
  const mv = fleetSideFor(cur, 'movable')
  const nm = fleetSideFor(cur, 'non_movable')
  const pmv = prev ? fleetSideFor(prev, 'movable') : null
  const pnm = prev ? fleetSideFor(prev, 'non_movable') : null
  return {
    currency: cur?.currency || cur?.country || null,
    cpkTyre: { value: fin(mv?.cpkTyre), trend: pctChange(mv?.cpkTyre, pmv?.cpkTyre) },
    cpkTotal: { value: fin(mv?.cpkTotal), trend: pctChange(mv?.cpkTotal, pmv?.cpkTotal) },
    distance: { value: mv ? num(mv.distance) : null, trend: pctChange(mv?.distance, pmv?.distance) },
    coverage: { value: fin(mv?.coveragePct), trend: pointChange(mv?.coveragePct, pmv?.coveragePct) },
    cph: { value: fin(nm?.cpkTotal), trend: pctChange(nm?.cpkTotal, pnm?.cpkTotal) },
    movable: mv,
    nonMovable: nm,
  }
}

const typeKey = (r) => `${String(r?.vehicle_type ?? '').trim().toUpperCase()}|${mobilityOfUnit(r?.unit)}`

/**
 * One row per asset type for the overview table, enriched from per_vehicle:
 *   units      = assets of that type carrying cost or meter data this period
 *   measured   = how many of them have a km / hours denominator
 *   coverage   = share of the type's total cost that sits on measured assets
 * Sorted movable first, then by total cost descending.
 */
export function assetTypeRows(byType = [], perVehicle = []) {
  const agg = new Map()
  for (const v of Array.isArray(perVehicle) ? perVehicle : []) {
    const k = typeKey(v)
    const a = agg.get(k) || { units: 0, measured: 0, cost: 0, measuredCost: 0 }
    a.units += 1
    const cost = num(v.total_cost)
    a.cost += cost
    if (num(v.distance_or_hours) > 0) { a.measured += 1; a.measuredCost += cost }
    agg.set(k, a)
  }
  const rows = (Array.isArray(byType) ? byType : []).map((r) => {
    const a = agg.get(typeKey(r))
    const mobility = mobilityOfUnit(r.unit)
    return {
      key: typeKey(r),
      vehicle_type: r.vehicle_type || 'Unspecified',
      mobility,
      unit: r.unit === 'engine_hours' ? 'engine_hours' : 'km',
      units: a ? a.units : null,
      measured: a ? a.measured : null,
      distance: num(r.distance_or_hours),
      tyre_cost: num(r.tyre_cost),
      maintenance_cost: fin(r.maintenance_cost),
      total_cost: num(r.total_cost),
      cpk_tyre: fin(r.cpk_tyre),
      cpk_total: fin(r.cpk_total),
      coverage: a && a.cost > 0 ? (a.measuredCost / a.cost) * 100 : null,
    }
  })
  return rows.sort((x, y) => (x.mobility === y.mobility ? y.total_cost - x.total_cost : x.mobility === 'movable' ? -1 : 1))
}

/**
 * Bars for one mobility, worst (highest) total cost per unit first. Types with no
 * measured denominator have no rate; they are counted in `unmeasured` and named
 * in a note instead of being drawn as a zero bar.
 */
export function rateBars(rows = [], mobility, limit = 8) {
  const mine = rows.filter((r) => r.mobility === mobility)
  const measured = mine.filter((r) => r.cpk_total != null).sort((a, b) => b.cpk_total - a.cpk_total)
  const shown = measured.slice(0, limit)
  const max = shown.reduce((m, r) => Math.max(m, r.cpk_total), 0)
  return {
    bars: shown.map((r) => ({ key: r.key, label: r.vehicle_type, value: r.cpk_total, share: max > 0 ? r.cpk_total / max : 0, row: r })),
    hidden: Math.max(0, measured.length - shown.length),
    unmeasured: mine.filter((r) => r.cpk_total == null).map((r) => r.vehicle_type),
  }
}

/**
 * "Why CPK changed" for the overview card: the km segment (cost per km) of the
 * drivers payload, falling back to the hours segment. Each step carries its
 * share of the prior CPK as a whole percent, so the card reads like the mockup
 * ("Tyre price +6%") from real decomposition data.
 */
export function overviewDrivers(payload) {
  const dec = decomposeDrivers(payload)
  if (!dec.ok || !dec.segments.length) return { ok: false, windows: dec.windows || null, segment: null, steps: [] }
  const seg = dec.segments.find((s) => s.unit === 'km') || dec.segments[0]
  const { steps } = waterfallSteps(seg)
  const base = seg.cpkPrev
  return {
    ok: true,
    windows: dec.windows,
    segment: seg,
    comparable: seg.comparable,
    steps: steps
      .map((s) => ({ key: s.key, label: s.label, amount: s.amount, pct: base ? Math.round((s.amount / base) * 100) : null, isResidual: s.isResidual }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    totalPct: pctChange(seg.cpkNow, seg.cpkPrev),
  }
}

/** Plain-language lineage lines for the data-quality card (no invented values). */
export function lineageFacts(k) {
  const out = []
  const mv = k?.movable
  const nm = k?.nonMovable
  if (mv) {
    out.push(`Cost per km uses only cost that has a measured distance: ${mv.coveragePct == null ? 'coverage not reported' : `${Math.round(mv.coveragePct)}% of movable cost is covered`}.`)
    if (num(mv.unregisteredCost) > 0) out.push(`${Math.round(num(mv.unregisteredCost)).toLocaleString('en-US')} ${k.currency || ''} of movable spend sits on assets missing from the fleet register and is left out of the rate.`.replace('  ', ' '))
  } else {
    out.push('No movable cost or distance was recorded for this period, so cost per km is not available.')
  }
  if (nm) {
    out.push(`Cost per hour uses engine-hour spans: ${nm.coveragePct == null ? 'coverage not reported' : `${Math.round(nm.coveragePct)}% of non-movable cost is covered`}.`)
  }
  return out
}

/** Compact amount: 1.05M, 92.4k, 812. null -> 'N/A'. */
export function fmtCompact(v) {
  const n = fin(v)
  if (n == null) return 'N/A'
  const a = Math.abs(n)
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`
  return Math.round(n).toLocaleString('en-US')
}

/** A cost-per-unit rate: 3 decimals below 1, 2 decimals above. null -> 'N/A'. */
export function fmtRate(v) {
  const n = fin(v)
  if (n == null) return 'N/A'
  return Math.abs(n) < 1 ? n.toFixed(3) : n.toFixed(2)
}

/** Signed whole percent for a driver chip, e.g. "+6%" / "-3%" / "0%". */
export function fmtSignedPct(p) {
  if (p == null) return 'N/A'
  return `${p > 0 ? '+' : ''}${p}%`
}
