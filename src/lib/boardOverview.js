/**
 * boardOverview.js - pure consolidation engine for the single Board Overview
 * report (the one management report: KPIs, then trends, then breakdown charts,
 * then recommendations).
 *
 * It does NOT re-implement any KPI maths: CPK / tyre life / failure rate come
 * from kpiEngine.computeAllKpis, claims from claimsAnalytics.analyzeClaims. This
 * module only consolidates those plus simple counts, and buckets rows into a
 * 12-month trend. Chart data is emitted WITHOUT colours; the page applies the
 * shared palette (reportColors.stylize) so the engine stays deterministic and
 * testable. Every number is honest: missing inputs yield null, never a guess.
 */

import { computeAllKpis } from './kpiEngine'
import { analyzeClaims, hasClaim, isClosed } from './claimsAnalytics'

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const isNum = (v) => Number.isFinite(Number(v))

/** The 12 months ending with `now`, oldest first: [{ key:'YYYY-MM', label:'Mon YY' }]. */
export function months12(now = new Date()) {
  const base = now instanceof Date ? now : new Date(now)
  const out = []
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
    out.push({ key, label })
  }
  return out
}

const monthKeyOf = (dateStr) => {
  const s = String(dateStr || '')
  return s.length >= 7 ? s.slice(0, 7) : null
}

/**
 * Sum a value across rows into the 12-month buckets. `valueFn` defaults to a
 * count (1 per row). Returns an array of 12 numbers aligned to months12().
 */
export function bucketMonthly(rows, dateField, valueFn = () => 1, now = new Date()) {
  const slots = months12(now)
  const idx = Object.fromEntries(slots.map((m, i) => [m.key, i]))
  const out = new Array(12).fill(0)
  for (const r of rows || []) {
    const k = monthKeyOf(r?.[dateField])
    if (k != null && idx[k] != null) out[idx[k]] += n(valueFn(r))
  }
  return out
}

/**
 * Consolidated headline KPIs across every module. Values are null when the
 * source is empty / not computable, so the UI can render an honest "N/A".
 */
export function buildBoardKpis({ tyres = [], inspections = [], actions = [], fleetSize = 0, accidents = [], workOrders = [], stock = [], now = new Date() } = {}) {
  const kpi = computeAllKpis(tyres, inspections, actions, fleetSize)
  const claims = analyzeClaims(accidents, { now })

  const tyreSpend = tyres.reduce((s, r) => s + n(r.cost_per_tyre) * (n(r.qty) || 1), 0)
  const openAccidents = accidents.filter((a) => !isClosed(a)).length
  const openWo = workOrders.filter((w) => !/complete|closed|done/i.test(String(w.status || ''))).length
  const overdueWo = workOrders.filter((w) => {
    const due = String(w.due_date || w.target_date || '')
    return due && due.slice(0, 10) < now.toISOString().slice(0, 10) && !/complete|closed|done/i.test(String(w.status || ''))
  }).length
  const lowStock = stock.filter((s) => isNum(s.quantity) && isNum(s.reorder_level) && n(s.quantity) <= n(s.reorder_level)).length

  return {
    fleetSize: fleetSize || null,
    tyresTracked: tyres.length || null,
    fleetAvgCpk: kpi?.cpk?.fleetAvgCpk ?? null,
    avgTyreLifeKm: isNum(kpi?.avgTyreLife?.avgKm) ? n(kpi.avgTyreLife.avgKm) : null,
    failureRatePct: isNum(kpi?.failureRate?.failureRate) ? n(kpi.failureRate.failureRate) * 100 : null,
    tyreSpend: tyres.length ? Math.round(tyreSpend) : null,
    accidents: accidents.length || null,
    openAccidents,
    claimsCount: claims.total || null,
    claimed: claims.claimed || null,
    recovered: claims.recovered || null,
    netExposure: claims.netExposure || null,
    inspections: inspections.length || null,
    inspectionCompliancePct: kpi?.inspectionCompliance?.compliancePct ?? null,
    workOrdersOpen: openWo || null,
    workOrdersOverdue: overdueWo,
    stockItems: stock.length || null,
    lowStock,
  }
}

/**
 * 12-month trend chart data (labels + datasets, NO colours - the page styles
 * them). One entry per metric the board cares about.
 */
export function buildTrends({ tyres = [], accidents = [], inspections = [], now = new Date() } = {}) {
  const slots = months12(now)
  const labels = slots.map((m) => m.label)
  const claimed = bucketMonthly(accidents.filter(hasClaim), 'incident_date', (r) => n(r.claim_amount), now)
  const recovered = bucketMonthly(accidents.filter(hasClaim), 'incident_date', (r) => n(r.recovered_amount), now)
  return {
    labels,
    tyreSpend: { labels, datasets: [{ label: 'Tyre spend', data: bucketMonthly(tyres, 'issue_date', (r) => n(r.cost_per_tyre) * (n(r.qty) || 1), now) }] },
    accidents: { labels, datasets: [{ label: 'Accidents', data: bucketMonthly(accidents, 'incident_date', () => 1, now) }] },
    claims: { labels, datasets: [{ label: 'Claimed', data: claimed }, { label: 'Recovered', data: recovered }] },
    inspections: { labels, datasets: [{ label: 'Inspections', data: bucketMonthly(inspections, 'completed_date', () => 1, now) }] },
  }
}

const tally = (rows, keyFn) => {
  const m = new Map()
  for (const r of rows || []) {
    const k = keyFn(r)
    if (k == null || k === '') continue
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}
const topChart = (map, limit = 8) => {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
  return { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]) }] }
}

/** Breakdown chart data (doughnut / bar) across modules, NO colours. */
export function buildBreakdowns({ accidents = [], tyres = [] } = {}) {
  return {
    accidentSeverity: topChart(tally(accidents, (a) => String(a.severity || '').trim() || 'Unspecified'), 6),
    accidentsBySite: topChart(tally(accidents, (a) => a.site), 8),
    tyresBySite: topChart(tally(tyres, (t) => t.site), 8),
    claimStatus: topChart(tally(accidents.filter(hasClaim), (a) => String(a.claim_status || '').trim() || 'Unspecified'), 6),
  }
}

/** Honest, number-led board recommendations. Empty array when nothing stands out. */
export function buildBoardRecommendations(kpis) {
  const recs = []
  if (!kpis) return recs
  if (kpis.workOrdersOverdue > 0) recs.push({ level: 'high', text: `${kpis.workOrdersOverdue} work order(s) are overdue. Expedite to cut fleet downtime.` })
  if (kpis.openAccidents > 0) recs.push({ level: 'medium', text: `${kpis.openAccidents} accident case(s) are still open. Drive them to closure to release vehicles and claims.` })
  if (isNum(kpis.claimed) && isNum(kpis.recovered) && kpis.claimed > 0) {
    const rate = Math.round((kpis.recovered / kpis.claimed) * 100)
    if (rate < 50) recs.push({ level: 'medium', text: `Claim recovery is ${rate}% of the amount claimed. Chase insurers on open claims to lift recovery.` })
  }
  if (isNum(kpis.failureRatePct) && kpis.failureRatePct >= 5) recs.push({ level: 'high', text: `Tyre failure rate is ${kpis.failureRatePct}%. Review inflation, alignment and the worst sites and brands.` })
  if (kpis.lowStock > 0) recs.push({ level: 'low', text: `${kpis.lowStock} stock item(s) are at or below reorder level. Raise purchase orders to avoid stockouts.` })
  if (isNum(kpis.inspectionCompliancePct) && kpis.inspectionCompliancePct < 80) recs.push({ level: 'medium', text: `Inspection compliance is ${kpis.inspectionCompliancePct}%. Tighten the inspection schedule to protect uptime and safety.` })
  return recs.slice(0, 6)
}
