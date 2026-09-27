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
 *  - downtime hours are ACTUAL where a work order carries opened/completed
 *    timestamps, otherwise an ESTIMATE per severity, and every row says which.
 */

export const DEFAULT_DOWNTIME_RATE = 850
export const SHIFT_HOURS = 8
export const TARGET_AVAILABILITY = 95
export const SEVERITY_HOURS = { Critical: 4, High: 3, Medium: 2, Low: 2 }
export const SEVERITY_WEIGHT = { Critical: 3, High: 2, Medium: 1, Low: 0.5 }
export const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low']
export const PERIOD_PRESETS = [
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

/** Actual downtime hours from a work order, or null. */
export function workOrderHours(wo) {
  if (!wo || !wo.opened_at || !wo.completed_at) return null
  const h = (new Date(wo.completed_at) - new Date(wo.opened_at)) / 3600000
  return Number.isFinite(h) && h > 0 ? h : null
}

/** asset_no -> average ACTUAL hours from work orders carrying both timestamps. */
export function actualHoursByAsset(workOrders = []) {
  const acc = new Map()
  for (const wo of workOrders) {
    const h = workOrderHours(wo)
    if (h == null || !wo.asset_no) continue
    const cur = acc.get(wo.asset_no) || { sum: 0, n: 0 }
    cur.sum += h; cur.n += 1
    acc.set(wo.asset_no, cur)
  }
  const out = new Map()
  acc.forEach((v, k) => out.set(k, v.sum / v.n))
  return out
}

export function downtimeHours(record, actualByAsset) {
  const actual = actualByAsset && record?.asset_no ? actualByAsset.get(record.asset_no) : undefined
  if (actual != null) return { hours: actual, actual: true }
  return { hours: SEVERITY_HOURS[record?.risk_level] ?? 2, actual: false }
}

export function causeLabel(record) {
  const rl = record?.risk_level
  const rfr = String(record?.reason_for_removal || '').toLowerCase()
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
      const hay = `${r.asset_no || ''} ${r.serial_number || ''} ${r.brand || ''} ${r.reason_for_removal || ''} ${r.site || ''}`.toLowerCase()
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

export function downtimeKpis(events = [], { cutoff = null, now, actualByAsset = new Map(), rate = DEFAULT_DOWNTIME_RATE } = {}) {
  let totalHours = 0; let actualEvents = 0
  for (const r of events) {
    const d = downtimeHours(r, actualByAsset)
    totalHours += d.hours
    if (d.actual) actualEvents += 1
  }
  const vehicles = new Set(events.map((r) => r.asset_no).filter(Boolean)).size
  const days = periodDays(events, cutoff, now)
  const vehicleDays = vehicles * days
  const availability = vehicleDays > 0
    ? Math.max(0, Math.min(100, ((vehicleDays - totalHours / SHIFT_HOURS) / vehicleDays) * 100))
    : null

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
    totalHours,
    downDays: totalHours / SHIFT_HOURS,
    totalCost: totalHours * rate,
    availability,
    mtbeHours: gapN ? gapSum / gapN : null,
    uniqueVehicles: vehicles,
    unplannedEvents: unplanned,
    unplannedPct: events.length ? Math.round((unplanned / events.length) * 1000) / 10 : null,
    actualEvents,
    actualPct: events.length ? Math.round((actualEvents / events.length) * 1000) / 10 : null,
    periodDays: days,
  }
}

/** 12-month availability series; null per month when there are no vehicles. */
export function availabilityTrend(records = [], { now, actualByAsset = new Map() } = {}) {
  const months = last12Months(now)
  const vehicles = new Set(records.map((r) => r.asset_no).filter(Boolean)).size
  const values = months.map((ym) => {
    if (!vehicles) return null
    const [y, m] = ym.split('-')
    const days = new Date(+y, +m, 0).getDate()
    const hours = records.filter((r) => yearMonth(r.issue_date) === ym)
      .reduce((s, r) => s + downtimeHours(r, actualByAsset).hours, 0)
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
    const h = downtimeHours(r, actualByAsset).hours
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

export function monthlyCost(events = [], { now, actualByAsset = new Map(), rate = DEFAULT_DOWNTIME_RATE } = {}) {
  const months = last12Months(now)
  let cum = 0
  const rows = months.map((ym) => {
    let planned = 0; let unplanned = 0
    for (const r of events) {
      if (yearMonth(r.issue_date) !== ym) continue
      const cost = downtimeHours(r, actualByAsset).hours * rate
      if (isUnplanned(r)) unplanned += cost; else planned += cost
    }
    cum += planned + unplanned
    return { month: ym, planned: Math.round(planned), unplanned: Math.round(unplanned), cumulative: Math.round(cum) }
  })
  return rows
}

/** One row per vehicle, ALL vehicles (the table sorts and pages them). */
export function vehicleRows(events = [], { cutoff = null, now, actualByAsset = new Map(), rate = DEFAULT_DOWNTIME_RATE } = {}) {
  const map = new Map()
  for (const r of events) {
    if (!r.asset_no) continue
    const cur = map.get(r.asset_no) || { asset: r.asset_no, site: r.site || 'N/A', dates: [], totalHours: 0, totalCost: 0, severitySum: 0, actual: 0 }
    const d = downtimeHours(r, actualByAsset)
    cur.dates.push(r.issue_date)
    cur.totalHours += d.hours
    cur.totalCost += d.hours * rate
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
      totalCost: v.totalCost,
      avgBetween,
      riskScore: Math.round((v.severitySum / months) * 100) / 100,
      basis: v.actual === v.dates.length ? 'Actual' : v.actual ? 'Mixed' : 'Estimated',
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
    cells.set(k, (cells.get(k) || 0) + downtimeHours(r, actualByAsset).hours)
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

export const EVENT_EXPORT_HEADERS = ['Asset No', 'Site', 'Country', 'Risk Level', 'Issue Date', 'Reason for Removal', 'Brand', 'Position', 'Downtime Hours', 'Downtime Cost', 'Cause', 'Data Source']
export const EVENT_EXPORT_KEYS = ['asset_no', 'site', 'country', 'risk_level', 'issue_date', 'reason_for_removal', 'brand', 'position', 'downtime_hours', 'downtime_cost', 'cause', 'data_source']

export function eventExportRows(events = [], { actualByAsset = new Map(), rate = DEFAULT_DOWNTIME_RATE } = {}) {
  return events.map((r) => {
    const d = downtimeHours(r, actualByAsset)
    return {
      asset_no: r.asset_no || '', site: r.site || '', country: r.country || '',
      risk_level: r.risk_level || 'Not rated', issue_date: r.issue_date || '',
      reason_for_removal: r.reason_for_removal || '', brand: r.brand || '', position: r.position || '',
      downtime_hours: Math.round(d.hours * 100) / 100,
      downtime_cost: Math.round(d.hours * rate * 100) / 100,
      cause: causeLabel(r),
      data_source: d.actual ? 'Actual (work order)' : 'Estimated (severity)',
    }
  })
}
