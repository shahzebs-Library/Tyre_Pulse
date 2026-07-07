// ─────────────────────────────────────────────────────────────────────────────
// executiveAnalytics.js — pure data shaping for the Executive Analytics page.
//
// No echarts import, no Supabase, no React — raw rows in, option-ready
// datasets out (unit-testable). Cost convention matches analyticsEngine /
// supplierScorecard: cost_per_tyre × qty (qty defaults to 1), actual only.
// ─────────────────────────────────────────────────────────────────────────────

import { computePressureCompliance } from './kpiEngine'

// ── Shared helpers ────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Actual spend of one tyre_records row: cost_per_tyre × qty (qty default 1). */
export function rowSpend(r) {
  return num(r?.cost_per_tyre) * (r?.qty == null ? 1 : num(r.qty))
}

/** Tyre units on one row (qty default 1). */
export function rowQty(r) {
  return r?.qty == null ? 1 : Math.max(0, num(r.qty)) || 1
}

/** 'YYYY-MM' for a date string, or null when unparseable. */
export function monthKey(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** The last `n` month keys ending at `now`, ascending. */
export function lastMonthKeys(n = 12, now = new Date()) {
  const out = []
  const base = new Date(now.getFullYear(), now.getMonth(), 1)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** 'Jan 26' style label for a 'YYYY-MM' key. */
export function monthLabel(key) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m] = String(key).split('-')
  const idx = Number(m) - 1
  if (!y || !m || !Number.isInteger(idx) || idx < 0 || idx > 11) return String(key)
  return `${MONTHS[idx]} ${y.slice(2)}`
}

const label = (v, fallback = 'Unknown') => {
  const s = (v == null ? '' : String(v)).trim()
  return s || fallback
}

// ── 1. Cost heatmap: site × month tyre spend ─────────────────────────────────

/**
 * @param {Object[]} records tyre_records rows (site, issue_date, cost_per_tyre, qty)
 * @param {{months?:number, now?:Date, maxSites?:number}} [opts]
 * @returns {{sites:string[], months:string[], monthLabels:string[], cells:Array<[number,number,number]>, max:number, totalSpend:number}}
 */
export function buildCostHeatmap(records = [], { months = 12, now = new Date(), maxSites = 14 } = {}) {
  const keys = lastMonthKeys(months, now)
  const keyIdx = new Map(keys.map((k, i) => [k, i]))

  const bySite = new Map() // site -> { total, byMonth: Map }
  for (const r of records) {
    const mk = monthKey(r?.issue_date)
    if (mk == null || !keyIdx.has(mk)) continue
    const spend = rowSpend(r)
    if (spend <= 0) continue
    const site = label(r?.site)
    if (!bySite.has(site)) bySite.set(site, { total: 0, byMonth: new Map() })
    const s = bySite.get(site)
    s.total += spend
    s.byMonth.set(mk, (s.byMonth.get(mk) || 0) + spend)
  }

  const sites = [...bySite.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, maxSites)
    .map(([site]) => site)

  const cells = []
  let max = 0
  let totalSpend = 0
  sites.forEach((site, yIdx) => {
    const s = bySite.get(site)
    totalSpend += s.total
    for (const [mk, v] of s.byMonth) {
      const val = Math.round(v)
      cells.push([keyIdx.get(mk), yIdx, val])
      if (val > max) max = val
    }
  })

  return { sites, months: keys, monthLabels: keys.map(monthLabel), cells, max, totalSpend }
}

// ── 2. Treemap: spend by brand → size ────────────────────────────────────────

/**
 * @param {Object[]} records tyre_records rows (brand, size, cost_per_tyre, qty)
 * @returns {{children:Array<{name:string,value:number,children:Array<{name:string,value:number}>}>, totalSpend:number}}
 */
export function buildBrandSizeTreemap(records = []) {
  const byBrand = new Map() // brand -> { total, sizes: Map }
  for (const r of records) {
    const spend = rowSpend(r)
    if (spend <= 0) continue
    const brand = label(r?.brand)
    const size = label(r?.size, 'Unspecified size')
    if (!byBrand.has(brand)) byBrand.set(brand, { total: 0, sizes: new Map() })
    const b = byBrand.get(brand)
    b.total += spend
    b.sizes.set(size, (b.sizes.get(size) || 0) + spend)
  }

  let totalSpend = 0
  const children = [...byBrand.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([brand, b]) => {
      totalSpend += b.total
      return {
        name: brand,
        value: Math.round(b.total),
        children: [...b.sizes.entries()]
          .sort((a, c) => c[1] - a[1])
          .map(([size, v]) => ({ name: size, value: Math.round(v) })),
      }
    })

  return { children, totalSpend: Math.round(totalSpend) }
}

// ── 3. Sankey: supplier → brand → site (fallback: brand → size → site) ──────

/** Share (0..1) of rows carrying a non-empty value for `field`. */
export function fieldCoverage(records = [], field) {
  if (!records.length) return 0
  const withVal = records.filter((r) => String(r?.[field] ?? '').trim() !== '').length
  return withVal / records.length
}

function topOrOther(map, limit) {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1])
  const keep = new Set(entries.slice(0, limit).map(([k]) => k))
  return (key) => (keep.has(key) ? key : 'Other')
}

/**
 * Three-level Sankey of tyre volume flow. Uses supplier → brand → site when
 * the supplier column has enough coverage; otherwise brand → size → site
 * (`mode` reports which was used so the page can label it honestly).
 *
 * Node names are made unique per level (`id`), with the human label kept in
 * `label` — ECharts sankey requires globally unique node names and supplier /
 * brand strings can collide.
 *
 * @param {Object[]} records
 * @param {{minSupplierCoverage?:number, maxPerLevel?:number}} [opts]
 * @returns {{mode:'supplier'|'brandSize', levels:[string,string,string], nodes:Array<{name:string,label:string,depth:number}>, links:Array<{source:string,target:string,value:number}>}}
 */
export function buildFlowSankey(records = [], { minSupplierCoverage = 0.3, maxPerLevel = 8 } = {}) {
  const useSupplier = fieldCoverage(records, 'supplier') >= minSupplierCoverage
  const mode = useSupplier ? 'supplier' : 'brandSize'
  const fields = useSupplier ? ['supplier', 'brand', 'site'] : ['brand', 'size', 'site']
  const levels = useSupplier ? ['Supplier', 'Brand', 'Site'] : ['Brand', 'Size', 'Site']

  // Volume per raw label per level, to keep only the top N (+ 'Other').
  const totals = fields.map(() => new Map())
  const rows = []
  for (const r of records) {
    const qty = rowQty(r)
    const vals = fields.map((f, i) => label(r?.[f], i === 1 && !useSupplier ? 'Unspecified size' : 'Unknown'))
    rows.push({ vals, qty })
    vals.forEach((v, i) => totals[i].set(v, (totals[i].get(v) || 0) + qty))
  }
  const pick = totals.map((m) => topOrOther(m, maxPerLevel))

  const nodeId = (depth, lbl) => `${depth}:${lbl}`
  const nodes = new Map() // id -> { name, label, depth }
  const linkMap = new Map() // 'src>tgt' -> { source, target, value }

  const addLink = (fromDepth, fromLbl, toDepth, toLbl, qty) => {
    const source = nodeId(fromDepth, fromLbl)
    const target = nodeId(toDepth, toLbl)
    if (!nodes.has(source)) nodes.set(source, { name: source, label: fromLbl, depth: fromDepth })
    if (!nodes.has(target)) nodes.set(target, { name: target, label: toLbl, depth: toDepth })
    const k = `${source}>${target}`
    if (!linkMap.has(k)) linkMap.set(k, { source, target, value: 0 })
    linkMap.get(k).value += qty
  }

  for (const { vals, qty } of rows) {
    const [a, b, c] = vals.map((v, i) => pick[i](v))
    addLink(0, a, 1, b, qty)
    addLink(1, b, 2, c, qty)
  }

  return {
    mode,
    levels,
    nodes: [...nodes.values()],
    links: [...linkMap.values()].map((l) => ({ ...l, value: Math.round(l.value * 100) / 100 })),
  }
}

// ── 4. Multi-axis combo: monthly cost (bar) vs tyre count (line) ────────────

/**
 * @param {Object[]} records
 * @param {{months?:number, now?:Date}} [opts]
 * @returns {{months:string[], monthLabels:string[], cost:number[], count:number[], totalSpend:number, totalCount:number}}
 */
export function buildMonthlyCombo(records = [], { months = 12, now = new Date() } = {}) {
  const keys = lastMonthKeys(months, now)
  const keyIdx = new Map(keys.map((k, i) => [k, i]))
  const cost = keys.map(() => 0)
  const count = keys.map(() => 0)

  for (const r of records) {
    const mk = monthKey(r?.issue_date)
    if (mk == null || !keyIdx.has(mk)) continue
    const i = keyIdx.get(mk)
    cost[i] += rowSpend(r)
    count[i] += rowQty(r)
  }

  return {
    months: keys,
    monthLabels: keys.map(monthLabel),
    cost: cost.map((v) => Math.round(v)),
    count,
    totalSpend: Math.round(cost.reduce((s, v) => s + v, 0)),
    totalCount: count.reduce((s, v) => s + v, 0),
  }
}

// ── 5. Executive gauges ──────────────────────────────────────────────────────

/**
 * Pressure compliance reuses the kpiEngine formula (Done + findings present
 * over non-Cancelled). Fleet availability = Active share of vehicle_fleet.
 *
 * @param {{inspections?:Object[], fleet?:Object[]}} input
 * @returns {{pressure:{value:number,compliant:number,total:number}, availability:{value:number,active:number,total:number}}}
 */
export function buildGauges({ inspections = [], fleet = [] } = {}) {
  const pc = computePressureCompliance(inspections)

  const total = fleet.length
  const active = fleet.filter((v) => /^active$/i.test(String(v?.status ?? '').trim())).length
  const availability = total > 0 ? (active / total) * 100 : 0

  return {
    pressure: {
      value: Math.round(pc.compliancePct * 10) / 10,
      compliant: pc.compliantCount,
      total: pc.totalCount,
    },
    availability: {
      value: Math.round(availability * 10) / 10,
      active,
      total,
    },
  }
}

// ── 6. Risk matrix scatter ───────────────────────────────────────────────────

/** True when an inspection counts as overdue (explicit status or past-due open). */
function isOverdueInspection(i, now) {
  const status = String(i?.status ?? '').trim()
  if (/^overdue$/i.test(status)) return true
  if (/^(done|cancelled)$/i.test(status)) return false
  if (!i?.scheduled_date) return false
  const d = new Date(i.scheduled_date)
  return !isNaN(d.getTime()) && d < now
}

/**
 * Per-vehicle risk matrix.
 * x = open High/Critical tyre count, y = 90-day overdue inspection count,
 * bubble size = 12-month tyre spend.
 *
 * @param {{openTyres?:Object[], inspections?:Object[], records?:Object[], now?:Date, maxPoints?:number}} input
 * @returns {{points:Array<{asset:string,site:string,x:number,y:number,spend:number}>, xAvg:number, yAvg:number, maxSpend:number}}
 */
export function buildRiskMatrix({ openTyres = [], inspections = [], records = [], now = new Date(), maxPoints = 150 } = {}) {
  const assets = new Map() // asset -> { x, y, spend, site }
  const get = (assetNo, site) => {
    const key = label(assetNo)
    if (!assets.has(key)) assets.set(key, { asset: key, site: label(site, ''), x: 0, y: 0, spend: 0 })
    const a = assets.get(key)
    if (!a.site && site) a.site = label(site, '')
    return a
  }

  for (const t of openTyres) {
    if (!t?.asset_no) continue
    if (t.risk_level !== 'High' && t.risk_level !== 'Critical') continue
    get(t.asset_no, t.site).x += 1
  }
  for (const i of inspections) {
    if (!i?.asset_no) continue
    if (isOverdueInspection(i, now)) get(i.asset_no, i.site).y += 1
  }
  for (const r of records) {
    if (!r?.asset_no) continue
    const spend = rowSpend(r)
    if (spend <= 0) continue
    if (!assets.has(label(r.asset_no))) continue // spend only sizes vehicles already at risk
    get(r.asset_no, r.site).spend += spend
  }

  const points = [...assets.values()]
    .filter((a) => a.x > 0 || a.y > 0)
    .map((a) => ({ ...a, spend: Math.round(a.spend) }))
    .sort((a, b) => (b.x + b.y) - (a.x + a.y) || b.spend - a.spend)
    .slice(0, maxPoints)

  const xAvg = points.length ? points.reduce((s, p) => s + p.x, 0) / points.length : 0
  const yAvg = points.length ? points.reduce((s, p) => s + p.y, 0) / points.length : 0
  const maxSpend = points.reduce((m, p) => Math.max(m, p.spend), 0)

  return {
    points,
    xAvg: Math.round(xAvg * 100) / 100,
    yAvg: Math.round(yAvg * 100) / 100,
    maxSpend,
  }
}

// ── Excel export shaping ─────────────────────────────────────────────────────

/**
 * Flatten a chart's dataset into rows/columns/headers for exportToExcel.
 * @param {'heatmap'|'treemap'|'sankey'|'combo'|'gauges'|'risk'} chartKey
 * @param {object} data the corresponding build* result
 * @returns {{rows:Object[], columns:string[], headers:string[]}}
 */
export function toExcelRows(chartKey, data) {
  switch (chartKey) {
    case 'heatmap': {
      const rows = (data?.cells ?? []).map(([mIdx, sIdx, value]) => ({
        site: data.sites[sIdx],
        month: data.months[mIdx],
        spend: value,
      })).sort((a, b) => a.site.localeCompare(b.site) || a.month.localeCompare(b.month))
      return { rows, columns: ['site', 'month', 'spend'], headers: ['Site', 'Month', 'Tyre Spend'] }
    }
    case 'treemap': {
      const rows = []
      for (const brand of data?.children ?? []) {
        for (const size of brand.children ?? []) {
          rows.push({ brand: brand.name, size: size.name, spend: size.value })
        }
      }
      return { rows, columns: ['brand', 'size', 'spend'], headers: ['Brand', 'Size', 'Tyre Spend'] }
    }
    case 'sankey': {
      const lbl = new Map((data?.nodes ?? []).map((n) => [n.name, n.label]))
      const depth = new Map((data?.nodes ?? []).map((n) => [n.name, n.depth]))
      const levels = data?.levels ?? ['From', 'To', '']
      const rows = (data?.links ?? []).map((l) => ({
        from_level: levels[depth.get(l.source) ?? 0] ?? '',
        from: lbl.get(l.source) ?? l.source,
        to_level: levels[depth.get(l.target) ?? 1] ?? '',
        to: lbl.get(l.target) ?? l.target,
        tyres: l.value,
      }))
      return {
        rows,
        columns: ['from_level', 'from', 'to_level', 'to', 'tyres'],
        headers: ['From (level)', 'From', 'To (level)', 'To', 'Tyres'],
      }
    }
    case 'combo': {
      const rows = (data?.months ?? []).map((m, i) => ({
        month: m,
        spend: data.cost[i],
        tyres: data.count[i],
      }))
      return { rows, columns: ['month', 'spend', 'tyres'], headers: ['Month', 'Tyre Spend', 'Tyre Count'] }
    }
    case 'gauges': {
      const rows = [
        {
          metric: 'Pressure compliance',
          value_pct: data?.pressure?.value ?? 0,
          numerator: data?.pressure?.compliant ?? 0,
          denominator: data?.pressure?.total ?? 0,
        },
        {
          metric: 'Fleet availability',
          value_pct: data?.availability?.value ?? 0,
          numerator: data?.availability?.active ?? 0,
          denominator: data?.availability?.total ?? 0,
        },
      ]
      return {
        rows,
        columns: ['metric', 'value_pct', 'numerator', 'denominator'],
        headers: ['Metric', 'Value %', 'Numerator', 'Denominator'],
      }
    }
    case 'risk': {
      const rows = (data?.points ?? []).map((p) => ({
        asset: p.asset,
        site: p.site,
        open_high_critical: p.x,
        overdue_inspections: p.y,
        spend_12m: p.spend,
      }))
      return {
        rows,
        columns: ['asset', 'site', 'open_high_critical', 'overdue_inspections', 'spend_12m'],
        headers: ['Vehicle', 'Site', 'Open High/Critical Tyres', 'Overdue Inspections (90d)', '12-Month Tyre Spend'],
      }
    }
    default:
      return { rows: [], columns: [], headers: [] }
  }
}
