/**
 * downtimeTrackerAnalytics - pure engine for the Fleet Downtime & Availability
 * page (/downtime). Everything the page used to compute inline lives here so
 * it is tested and uses an injected clock (`now`), never Date.now().
 *
 * Honesty rules:
 *  - availability is null (N/A) when there are no vehicles or no measured
 *    period; never a fabricated 100%;
 *  - the 12-month availability trend is null for every month when there are
 *    no vehicles in scope (the old code floored the vehicle count at 1);
 *  - MTBE (mean hours between events) is null, not 0, when no vehicle has two
 *    events;
 *  - MEASURED and ASSUMED are never added into one figure that reads as
 *    measured (ENG-7, 2026-11-12). Hours are MEASURED only from job cards with
 *    two plausible timestamps (see workOrderHours). A tyre event on an asset
 *    with no such job card has NO measured hours; it carries an ASSUMED figure
 *    (severity table below, 2 hours when unrated) that is reported separately
 *    and always named "assumed";
 *  - `totalHours`, `availability` and `totalCost` are measured-only and null
 *    (N/A) when they cannot be measured. The assumed model is exposed as
 *    `modelledHours`, `availabilityAssumed`, `modelledCost`;
 *  - there is NO default hourly downtime rate. A flat 850 with no currency was
 *    applied to SAR, AED and EGP alike. Cost is null until the tenant sets a
 *    rate (settings key downtime_rate), and is then in the page currency.
 */

/** @deprecated No default rate is applied any more (ENG-7). Kept as null for old imports. */
export const DEFAULT_DOWNTIME_RATE = null
/** Hours ASSUMED for a tyre event with no measured job card, by risk rating. An assumption, never a measurement. */
export const ASSUMED_EVENT_HOURS = 2
/** A job card longer than this is a data error (corrupt import dates), not downtime. */
export const MAX_MEASURED_HOURS = 720
/** Job card dates before this year are import artefacts (two digit years, 1900 blanks). */
export const MIN_PLAUSIBLE_YEAR = 2000
export const SHIFT_HOURS = 8
export const TARGET_AVAILABILITY = 95
export const SEVERITY_HOURS = { Critical: 4, High: 3, Medium: 2, Low: 2 }
export const SEVERITY_WEIGHT = { Critical: 3, High: 2, Medium: 1, Low: 0.5 }
export const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low']
export const PERIOD_PRESETS = [
  { label: 'This month', days: 'month' },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6m', days: 180 },
  { label: '1yr', days: 365 },
  { label: 'All', days: null },
]
export const CAUSES = ['Critical Failure', 'Wear-Related', 'Pressure Issue', 'Routine Replacement', 'Unknown']

const DAY = 86400000
const toMs = (now) => (now instanceof Date ? now.getTime() : Number(now))

export function periodStart(days, now) {
  if (days === 'month') {
    const d = new Date(toMs(now))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }
  if (!days) return null
  const d = new Date(toMs(now))
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export function presetStart(label, now) {
  const p = PERIOD_PRESETS.find((x) => x.label === label)
  return p ? periodStart(p.days, now) : null
}

export function yearMonth(dateStr) {
  return dateStr ? String(dateStr).slice(0, 7) : null
}

export function last12Months(now) {
  const base = new Date(toMs(now))
  const out = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * MEASURED downtime hours from a work order, or null.
 *
 * Only a job card with two PLAUSIBLE timestamps measures anything. Live KSA
 * job cards (2026-11-12): 10,790 opened before 1990 (two digit year import),
 * 977 completed before opened, 1,025 longer than a year, 364 opened in the
 * future. One such card used to make an asset's "actual" downtime thousands of
 * hours, and that average was then applied to every tyre event on the asset.
 * Rejected here: a date before MIN_PLAUSIBLE_YEAR, a date after `now` (when a
 * clock is supplied), completed at or before opened, a span over
 * MAX_MEASURED_HOURS.
 * @param {object} wo
 * @param {{ now?: Date|number }} [opts]
 */
export function workOrderHours(wo, { now } = {}) {
  if (!wo || !wo.opened_at || !wo.completed_at) return null
  const a = new Date(wo.opened_at)
  const b = new Date(wo.completed_at)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  if (a.getUTCFullYear() < MIN_PLAUSIBLE_YEAR || b.getUTCFullYear() < MIN_PLAUSIBLE_YEAR) return null
  if (now != null) {
    const n = toMs(now)
    if (Number.isFinite(n) && (a.getTime() > n || b.getTime() > n)) return null
  }
  const h = (b - a) / 3600000
  return Number.isFinite(h) && h > 0 && h <= MAX_MEASURED_HOURS ? h : null
}

/** asset_no -> average ACTUAL hours from work orders carrying both timestamps. */
export function actualHoursByAsset(workOrders = [], opts = {}) {
  const acc = new Map()
  for (const wo of workOrders) {
    const h = workOrderHours(wo, opts)
    if (h == null || !wo.asset_no) continue
    const cur = acc.get(wo.asset_no) || { sum: 0, n: 0 }
    cur.sum += h; cur.n += 1
    acc.set(wo.asset_no, cur)
  }
  const out = new Map()
  acc.forEach((v, k) => out.set(k, v.sum / v.n))
  return out
}

/**
 * Downtime of one tyre event.
 *   hours        MEASURED hours (asset's mean job card duration), or null
 *   actual       true when measured
 *   assumedHours the ASSUMPTION for an unmeasured event, else null
 *   modelHours   hours ?? assumedHours: for charts that are labelled as a model
 * `hours` is never an assumption (audit case C28b).
 */
export function downtimeHours(record, actualByAsset) {
  const actual = actualByAsset && record?.asset_no ? actualByAsset.get(record.asset_no) : undefined
  if (actual != null) return { hours: actual, actual: true, assumedHours: null, modelHours: actual }
  const assumed = SEVERITY_HOURS[record?.risk_level] ?? ASSUMED_EVENT_HOURS
  return { hours: null, actual: false, assumedHours: assumed, modelHours: assumed }
}

/** The removal reason text of a tyre row. The populated column is `removal_reason`. */
export const removalReasonOf = (record) => String(record?.removal_reason ?? record?.reason_for_removal ?? '')

export function causeLabel(record) {
  const rl = record?.risk_level
  // ENG-7: the page used to read `reason_for_removal`, filled on 0 rows, so the
  // cause could only be Unknown or Routine. The populated column is removal_reason.
  const rfr = removalReasonOf(record).toLowerCase()
  if (rl === 'Critical') return 'Critical Failure'
  if (rfr.includes('pressure') || rfr.includes('blow') || rfr.includes('burst')) return 'Pressure Issue'
  if (rl === 'High') return 'Wear-Related'
  if (rfr.includes('wear') || rfr.includes('worn')) return 'Wear-Related'
  if (rl === 'Low') return 'Routine Replacement'
  if (rl === 'Medium') return 'Wear-Related'
  return 'Unknown'
}

export const isUnplanned = (r) => r?.risk_level === 'Critical' || r?.risk_level === 'High'

export function filterEvents(records = [], { cutoff = null, site = '', country = '', risk = '', search = '', cause = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return records.filter((r) => {
    if (cutoff && r.issue_date && r.issue_date < cutoff) return false
    if (site && r.site !== site) return false
    if (country && r.country !== country) return false
    if (risk === 'unrated' ? !!r.risk_level : risk && r.risk_level !== risk) return false
    if (cause && causeLabel(r) !== cause) return false
    if (q) {
      const hay = `${r.asset_no || ''} ${r.serial_number || ''} ${r.brand || ''} ${removalReasonOf(r)} ${r.site || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function filterWorkOrders(workOrders = [], { cutoff = null, site = '' } = {}) {
  return workOrders.filter((w) => {
    if (cutoff && w.created_at && String(w.created_at).slice(0, 10) < cutoff) return false
    if (site && w.site !== site) return false
    return true
  })
}

/** Days covered by the view: period length, or the observed span when "All". */
export function periodDays(events, cutoff, now) {
  if (cutoff) return Math.max(1, Math.ceil((toMs(now) - new Date(cutoff).getTime()) / DAY))
  const dates = events.map((r) => r.issue_date).filter(Boolean).sort()
  if (!dates.length) return 0
  return Math.max(1, Math.ceil((new Date(dates[dates.length - 1]) - new Date(dates[0])) / DAY) + 1)
}

/**
 * Headline figures. MEASURED and ASSUMED are separate (see file header).
 * @param {object} opts
 * @param {number|null} [opts.rate] the tenant's hourly downtime rate in the page
 *   currency, or null when none is configured (cost is then null, N/A).
 */
export function downtimeKpis(events = [], { cutoff = null, now, actualByAsset = new Map(), rate = null } = {}) {
  let measured = 0; let assumed = 0; let actualEvents = 0
  for (const r of events) {
    const d = downtimeHours(r, actualByAsset)
    if (d.actual) { measured += d.hours; actualEvents += 1 } else { assumed += d.assumedHours }
  }
  const unmeasuredEvents = events.length - actualEvents
  // Measured hours exist only when at least one event was measured.
  const totalHours = actualEvents > 0 ? measured : null
  const modelledHours = measured + assumed
  const vehicles = new Set(events.map((r) => r.asset_no).filter(Boolean)).size
  const days = periodDays(events, cutoff, now)
  const vehicleDays = vehicles * days
  const avail = (h) => (vehicleDays > 0
    ? Math.max(0, Math.min(100, ((vehicleDays - h / SHIFT_HOURS) / vehicleDays) * 100))
    : null)
  // Availability is MEASURED only when every event in view has measured hours.
  // With any assumed event the figure is a model and is reported as such.
  const availability = events.length > 0 && unmeasuredEvents === 0 ? avail(measured) : null
  const availabilityAssumed = avail(modelledHours)
  const hasRate = Number.isFinite(Number(rate)) && Number(rate) > 0

  const byVehicle = new Map()
  for (const r of events) {
    if (!r.asset_no || !r.issue_date) continue
    if (!byVehicle.has(r.asset_no)) byVehicle.set(r.asset_no, [])
    byVehicle.get(r.asset_no).push(r.issue_date)
  }
  let gapSum = 0; let gapN = 0
  byVehicle.forEach((dates) => {
    const s = [...dates].sort()
    for (let i = 1; i < s.length; i++) {
      const diff = (new Date(s[i]) - new Date(s[i - 1])) / 3600000
      if (diff > 0) { gapSum += diff; gapN += 1 }
    }
  })
  const unplanned = events.filter(isUnplanned).length
  return {
    totalEvents: events.length,
    // measured only; null when nothing was measured
    totalHours,
    measuredHours: totalHours,
    downDays: totalHours == null ? null : totalHours / SHIFT_HOURS,
    totalCost: hasRate && totalHours != null ? totalHours * Number(rate) : null,
    availability,
    // the assumed model, always labelled assumed on screen and in exports
    assumedHours: assumed,
    modelledHours,
    modelledDownDays: modelledHours / SHIFT_HOURS,
    modelledCost: hasRate ? modelledHours * Number(rate) : null,
    availabilityAssumed,
    unmeasuredEvents,
    rateConfigured: hasRate,
    mtbeHours: gapN ? gapSum / gapN : null,
    uniqueVehicles: vehicles,
    unplannedEvents: unplanned,
    unplannedPct: events.length ? Math.round((unplanned / events.length) * 1000) / 10 : null,
    actualEvents,
    actualPct: events.length ? Math.round((actualEvents / events.length) * 1000) / 10 : null,
    periodDays: days,
  }
}

/**
 * 12-month availability series; null per month when there are no vehicles.
 * A MODEL: it includes assumed hours for events with no measured job card, so
 * the chart that draws it must say "includes assumed hours".
 */
export function availabilityTrend(records = [], { now, actualByAsset = new Map() } = {}) {
  const months = last12Months(now)
  const vehicles = new Set(records.map((r) => r.asset_no).filter(Boolean)).size
  const values = months.map((ym) => {
    if (!vehicles) return null
    const [y, m] = ym.split('-')
    const days = new Date(+y, +m, 0).getDate()
    const hours = records.filter((r) => yearMonth(r.issue_date) === ym)
      .reduce((s, r) => s + downtimeHours(r, actualByAsset).modelHours, 0)
    const vd = vehicles * days
    return Math.max(0, Math.min(100, ((vd - hours / SHIFT_HOURS) / vd) * 100))
  })
  return { months, values }
}

export function siteBreakdown(events = [], { actualByAsset = new Map(), limit = 12 } = {}) {
  const map = new Map()
  for (const r of events) {
    const s = r.site || 'Unknown'
    const cur = map.get(s) || { site: s, planned: 0, unplanned: 0 }
    // model hours (measured where a job card exists, otherwise assumed)
    const h = downtimeHours(r, actualByAsset).modelHours
    if (isUnplanned(r)) cur.unplanned += h; else cur.planned += h
    map.set(s, cur)
  }
  return [...map.values()].map((v) => ({ ...v, total: v.planned + v.unplanned }))
    .sort((a, b) => b.total - a.total || a.site.localeCompare(b.site)).slice(0, limit)
}

export function causeBreakdown(events = []) {
  const map = new Map()
  for (const r of events) {
    const c = causeLabel(r)
    map.set(c, (map.get(c) || 0) + 1)
  }
  return CAUSES.filter((c) => map.has(c)).map((c) => ({ cause: c, count: map.get(c) }))
}

export function monthlyCost(events = [], { now, actualByAsset = new Map(), rate = null } = {}) {
  const months = last12Months(now)
  // No configured rate, no cost series (never a default rate with no currency).
  if (!(Number.isFinite(Number(rate)) && Number(rate) > 0)) {
    return months.map((ym) => ({ month: ym, planned: null, unplanned: null, cumulative: null }))
  }
  let cum = 0
  const rows = months.map((ym) => {
    let planned = 0; let unplanned = 0
    for (const r of events) {
      if (yearMonth(r.issue_date) !== ym) continue
      const cost = downtimeHours(r, actualByAsset).modelHours * rate
      if (isUnplanned(r)) unplanned += cost; else planned += cost
    }
    cum += planned + unplanned
    return { month: ym, planned: Math.round(planned), unplanned: Math.round(unplanned), cumulative: Math.round(cum) }
  })
  return rows
}

/** One row per vehicle, ALL vehicles (the table sorts and pages them). */
export function vehicleRows(events = [], { cutoff = null, now, actualByAsset = new Map(), rate = null } = {}) {
  const hasRate = Number.isFinite(Number(rate)) && Number(rate) > 0
  const map = new Map()
  for (const r of events) {
    if (!r.asset_no) continue
    const cur = map.get(r.asset_no) || { asset: r.asset_no, site: r.site || 'N/A', dates: [], totalHours: 0, measuredHours: 0, assumedHours: 0, severitySum: 0, actual: 0 }
    const d = downtimeHours(r, actualByAsset)
    cur.dates.push(r.issue_date)
    // totalHours is the MODEL (measured + assumed); `basis` says which it is.
    cur.totalHours += d.modelHours
    if (d.actual) cur.measuredHours += d.hours; else cur.assumedHours += d.assumedHours
    cur.severitySum += SEVERITY_WEIGHT[r.risk_level] ?? 1
    if (d.actual) cur.actual += 1
    map.set(r.asset_no, cur)
  }
  const days = cutoff ? periodDays(events, cutoff, now) : 365
  const months = Math.max(1, days / 30)
  const rows = [...map.values()].map((v) => {
    const s = v.dates.filter(Boolean).sort()
    let avgBetween = null
    if (s.length >= 2) {
      let sum = 0
      for (let i = 1; i < s.length; i++) sum += (new Date(s[i]) - new Date(s[i - 1])) / DAY
      avgBetween = sum / (s.length - 1)
    }
    return {
      asset: v.asset,
      site: v.site,
      eventCount: v.dates.length,
      totalHours: v.totalHours,
      measuredHours: v.actual > 0 ? v.measuredHours : null,
      assumedHours: v.assumedHours,
      totalCost: hasRate ? v.totalHours * Number(rate) : null,
      avgBetween,
      riskScore: Math.round((v.severitySum / months) * 100) / 100,
      basis: v.actual === v.dates.length ? 'Measured' : v.actual ? 'Part assumed' : 'Assumed',
    }
  })
  const avgEvents = rows.length ? rows.reduce((s, r) => s + r.eventCount, 0) / rows.length : 0
  return rows
    .map((r) => ({ ...r, isHigh: avgEvents > 0 && r.eventCount > avgEvents * 2 }))
    .sort((a, b) => b.totalHours - a.totalHours || a.asset.localeCompare(b.asset))
}

export function heatmap(events = [], { now, actualByAsset = new Map(), limit = 10 } = {}) {
  const months = last12Months(now)
  const cells = new Map()
  for (const r of events) {
    if (!r.asset_no) continue
    const ym = yearMonth(r.issue_date)
    if (!ym || !months.includes(ym)) continue
    const k = `${r.asset_no}::${ym}`
    cells.set(k, (cells.get(k) || 0) + downtimeHours(r, actualByAsset).modelHours)
  }
  const assets = [...new Set(events.map((r) => r.asset_no).filter(Boolean))]
  const rows = assets
    .map((a) => ({ asset: a, cells: months.map((m) => cells.get(`${a}::${m}`) || 0) }))
    .map((x) => ({ ...x, total: x.cells.reduce((s, v) => s + v, 0) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total || a.asset.localeCompare(b.asset))
    .slice(0, limit)
  return { months, rows }
}

/**
 * Structured recommendations; the page translates `key` + `params`.
 * key: 'vehicle' | 'site' | 'critical' | 'availability' | 'ok'
 */
export function recommendations(events = [], vehicles = [], kpis = {}) {
  const recs = []
  vehicles.slice(0, 3).forEach((v) => {
    if (v.eventCount >= 2) {
      recs.push({ key: 'vehicle', severity: v.eventCount >= 5 ? 'critical' : v.eventCount >= 3 ? 'high' : 'medium', params: { asset: v.asset, count: v.eventCount } })
    }
  })
  const siteTotals = new Map()
  for (const r of events) { const s = r.site || 'Unknown'; siteTotals.set(s, (siteTotals.get(s) || 0) + 1) }
  const avg = events.length / Math.max(siteTotals.size, 1)
  ;[...siteTotals.entries()].filter(([, c]) => c > avg * 1.5).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .forEach(([site, count]) => {
      recs.push({ key: 'site', severity: 'high', params: { site, pct: avg > 0 ? Math.round(((count - avg) / avg) * 100) : null } })
    })
  const critical = events.filter((r) => r.risk_level === 'Critical').length
  if (events.length && critical / events.length > 0.2) {
    recs.push({ key: 'critical', severity: 'critical', params: { pct: Math.round((critical / events.length) * 100) } })
  }
  if (kpis.availability != null && kpis.availability < TARGET_AVAILABILITY) {
    recs.push({ key: 'availability', severity: kpis.availability < 90 ? 'critical' : 'high', params: { pct: kpis.availability.toFixed(1), target: TARGET_AVAILABILITY } })
  }
  if (!recs.length && events.length) recs.push({ key: 'ok', severity: 'low', params: {} })
  return recs
}

export const EVENT_EXPORT_HEADERS = ['Asset No', 'Site', 'Country', 'Risk Level', 'Issue Date', 'Reason for Removal', 'Brand', 'Position', 'Measured Downtime Hours', 'Assumed Downtime Hours', 'Downtime Cost', 'Cause', 'Hours Basis']
export const EVENT_EXPORT_KEYS = ['asset_no', 'site', 'country', 'risk_level', 'issue_date', 'reason_for_removal', 'brand', 'position', 'downtime_hours', 'assumed_hours', 'downtime_cost', 'cause', 'data_source']

export function eventExportRows(events = [], { actualByAsset = new Map(), rate = null } = {}) {
  const hasRate = Number.isFinite(Number(rate)) && Number(rate) > 0
  return events.map((r) => {
    const d = downtimeHours(r, actualByAsset)
    return {
      asset_no: r.asset_no || '', site: r.site || '', country: r.country || '',
      risk_level: r.risk_level || 'Not rated', issue_date: r.issue_date || '',
      reason_for_removal: removalReasonOf(r), brand: r.brand || '', position: r.position || '',
      // measured and assumed sit in separate columns; neither is ever a blank zero
      downtime_hours: d.actual ? Math.round(d.hours * 100) / 100 : 'N/A',
      assumed_hours: d.actual ? 'N/A' : d.assumedHours,
      downtime_cost: hasRate ? Math.round(d.modelHours * Number(rate) * 100) / 100 : 'N/A',
      cause: causeLabel(r),
      data_source: d.actual ? 'Measured (job card timestamps, asset average)' : 'Assumed (no job card with valid timestamps)',
    }
  })
}
