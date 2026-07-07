import { describe, it, expect } from 'vitest'
import {
  rowSpend, rowQty, monthKey, lastMonthKeys, monthLabel, fieldCoverage,
  buildCostHeatmap, buildBrandSizeTreemap, buildFlowSankey, buildMonthlyCombo,
  buildGauges, buildRiskMatrix, toExcelRows,
} from '../lib/executiveAnalytics'

const NOW = new Date('2026-06-15T12:00:00Z')

const tyre = (over = {}) => ({
  asset_no: 'T-100', site: 'Riyadh', brand: 'Michelin', size: '315/80R22.5',
  supplier: 'Al Jazira', cost_per_tyre: 1000, qty: 2, issue_date: '2026-06-01',
  ...over,
})

// ── helpers ───────────────────────────────────────────────────────────────────

describe('executiveAnalytics helpers', () => {
  it('rowSpend = cost_per_tyre × qty, qty defaults to 1, garbage → 0', () => {
    expect(rowSpend(tyre())).toBe(2000)
    expect(rowSpend({ cost_per_tyre: 500 })).toBe(500)
    expect(rowSpend({ cost_per_tyre: 'abc', qty: 3 })).toBe(0)
    expect(rowSpend(null)).toBe(0)
  })

  it('rowQty defaults to 1 and never returns 0/negative', () => {
    expect(rowQty({ qty: 4 })).toBe(4)
    expect(rowQty({})).toBe(1)
    expect(rowQty({ qty: -2 })).toBe(1)
  })

  it('monthKey parses and rejects', () => {
    expect(monthKey('2026-03-15')).toBe('2026-03')
    expect(monthKey('not a date')).toBeNull()
    expect(monthKey(null)).toBeNull()
  })

  it('lastMonthKeys returns n ascending keys ending at now', () => {
    const keys = lastMonthKeys(3, NOW)
    expect(keys).toEqual(['2026-04', '2026-05', '2026-06'])
  })

  it('monthLabel renders compact label', () => {
    expect(monthLabel('2026-01')).toBe('Jan 26')
    expect(monthLabel('garbage')).toBe('garbage')
  })

  it('fieldCoverage measures non-empty share', () => {
    const rows = [{ supplier: 'A' }, { supplier: ' ' }, { supplier: null }, { supplier: 'B' }]
    expect(fieldCoverage(rows, 'supplier')).toBe(0.5)
    expect(fieldCoverage([], 'supplier')).toBe(0)
  })
})

// ── heatmap ───────────────────────────────────────────────────────────────────

describe('buildCostHeatmap', () => {
  it('groups spend by site × month within the window', () => {
    const recs = [
      tyre({ site: 'Riyadh', issue_date: '2026-06-01', cost_per_tyre: 100, qty: 1 }),
      tyre({ site: 'Riyadh', issue_date: '2026-06-20', cost_per_tyre: 200, qty: 2 }),
      tyre({ site: 'Jeddah', issue_date: '2026-05-05', cost_per_tyre: 50, qty: 1 }),
      tyre({ site: 'Jeddah', issue_date: '2020-01-01', cost_per_tyre: 999, qty: 9 }), // out of window
    ]
    const h = buildCostHeatmap(recs, { months: 3, now: NOW })
    expect(h.months).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(h.sites).toEqual(['Riyadh', 'Jeddah']) // sorted by spend desc
    // Riyadh June = 100 + 400 = 500 at [monthIdx 2, siteIdx 0]
    expect(h.cells).toContainEqual([2, 0, 500])
    expect(h.cells).toContainEqual([1, 1, 50])
    expect(h.max).toBe(500)
    expect(h.totalSpend).toBe(550)
  })

  it('skips zero-cost rows and caps sites', () => {
    const recs = Array.from({ length: 20 }, (_, i) =>
      tyre({ site: `S${i}`, cost_per_tyre: i + 1, qty: 1, issue_date: '2026-06-01' }))
    recs.push(tyre({ site: 'FreeTyres', cost_per_tyre: 0 }))
    const h = buildCostHeatmap(recs, { months: 2, now: NOW, maxSites: 5 })
    expect(h.sites).toHaveLength(5)
    expect(h.sites).not.toContain('FreeTyres')
  })

  it('handles empty input', () => {
    const h = buildCostHeatmap([], { months: 2, now: NOW })
    expect(h.cells).toEqual([])
    expect(h.sites).toEqual([])
  })
})

// ── treemap ───────────────────────────────────────────────────────────────────

describe('buildBrandSizeTreemap', () => {
  it('nests spend brand → size, sorted desc', () => {
    const recs = [
      tyre({ brand: 'Michelin', size: 'A', cost_per_tyre: 100, qty: 1 }),
      tyre({ brand: 'Michelin', size: 'B', cost_per_tyre: 300, qty: 1 }),
      tyre({ brand: 'Bridgestone', size: 'A', cost_per_tyre: 50, qty: 2 }),
    ]
    const t = buildBrandSizeTreemap(recs)
    expect(t.children[0].name).toBe('Michelin')
    expect(t.children[0].value).toBe(400)
    expect(t.children[0].children[0]).toEqual({ name: 'B', value: 300 })
    expect(t.totalSpend).toBe(500)
  })

  it('labels missing brand/size and drops zero spend', () => {
    const t = buildBrandSizeTreemap([
      tyre({ brand: null, size: null, cost_per_tyre: 10, qty: 1 }),
      tyre({ cost_per_tyre: 0 }),
    ])
    expect(t.children).toHaveLength(1)
    expect(t.children[0].name).toBe('Unknown')
    expect(t.children[0].children[0].name).toBe('Unspecified size')
  })
})

// ── sankey ────────────────────────────────────────────────────────────────────

describe('buildFlowSankey', () => {
  it('uses supplier → brand → site when supplier coverage is good', () => {
    const recs = [
      tyre({ supplier: 'SupA', brand: 'M', site: 'Riyadh', qty: 3 }),
      tyre({ supplier: 'SupA', brand: 'B', site: 'Jeddah', qty: 1 }),
    ]
    const s = buildFlowSankey(recs)
    expect(s.mode).toBe('supplier')
    expect(s.levels).toEqual(['Supplier', 'Brand', 'Site'])
    const labels = s.nodes.map((n) => n.label)
    expect(labels).toContain('SupA')
    expect(labels).toContain('Riyadh')
    // link SupA→M carries qty 3
    const link = s.links.find((l) => l.source === '0:SupA' && l.target === '1:M')
    expect(link.value).toBe(3)
  })

  it('falls back to brand → size → site when supplier is sparse', () => {
    const recs = [
      tyre({ supplier: null, brand: 'M', size: 'A', site: 'Riyadh' }),
      tyre({ supplier: '', brand: 'M', size: 'A', site: 'Riyadh' }),
      tyre({ supplier: null, brand: 'B', size: 'C', site: 'Jeddah' }),
      tyre({ supplier: 'OnlyOne', brand: 'B', size: 'C', site: 'Jeddah' }),
    ]
    const s = buildFlowSankey(recs) // 25% coverage < 30% threshold
    expect(s.mode).toBe('brandSize')
    expect(s.levels).toEqual(['Brand', 'Size', 'Site'])
  })

  it('keeps node names unique across levels even when labels collide', () => {
    const recs = [tyre({ supplier: 'Michelin', brand: 'Michelin', site: 'Michelin' })]
    const s = buildFlowSankey(recs)
    const names = s.nodes.map((n) => n.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(3)
  })

  it('buckets long tails into Other', () => {
    const recs = Array.from({ length: 12 }, (_, i) =>
      tyre({ supplier: `Sup${i}`, brand: 'M', site: 'Riyadh', qty: 12 - i }))
    const s = buildFlowSankey(recs, { maxPerLevel: 3 })
    const supplierLabels = s.nodes.filter((n) => n.depth === 0).map((n) => n.label)
    expect(supplierLabels).toHaveLength(4) // top 3 + Other
    expect(supplierLabels).toContain('Other')
  })
})

// ── combo ─────────────────────────────────────────────────────────────────────

describe('buildMonthlyCombo', () => {
  it('sums cost and qty per month, zero-fills the window', () => {
    const recs = [
      tyre({ issue_date: '2026-06-01', cost_per_tyre: 100, qty: 2 }),
      tyre({ issue_date: '2026-04-10', cost_per_tyre: 10, qty: 1 }),
    ]
    const c = buildMonthlyCombo(recs, { months: 3, now: NOW })
    expect(c.months).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(c.cost).toEqual([10, 0, 200])
    expect(c.count).toEqual([1, 0, 2])
    expect(c.totalSpend).toBe(210)
    expect(c.totalCount).toBe(3)
  })
})

// ── gauges ────────────────────────────────────────────────────────────────────

describe('buildGauges', () => {
  it('pressure compliance matches the kpiEngine formula (Done + findings / non-Cancelled)', () => {
    const inspections = [
      { status: 'Done', findings: 'ok' },
      { status: 'Done', findings: '' },      // done but no findings → not compliant
      { status: 'Scheduled', findings: '' },
      { status: 'Cancelled', findings: 'x' }, // excluded entirely
    ]
    const g = buildGauges({ inspections, fleet: [] })
    expect(g.pressure.total).toBe(3)
    expect(g.pressure.compliant).toBe(1)
    expect(g.pressure.value).toBeCloseTo(33.3, 1)
  })

  it('availability = Active share of vehicle_fleet (case-insensitive)', () => {
    const fleet = [
      { status: 'Active' }, { status: 'active' }, { status: 'Workshop' }, { status: null },
    ]
    const g = buildGauges({ inspections: [], fleet })
    expect(g.availability.total).toBe(4)
    expect(g.availability.active).toBe(2)
    expect(g.availability.value).toBe(50)
  })

  it('empty inputs give zero denominators without NaN', () => {
    const g = buildGauges({})
    expect(g.pressure.value).toBe(0)
    expect(g.availability.value).toBe(0)
  })
})

// ── risk matrix ───────────────────────────────────────────────────────────────

describe('buildRiskMatrix', () => {
  it('combines open risk tyres, overdue inspections and 12-month spend per asset', () => {
    const openTyres = [
      { asset_no: 'V1', site: 'Riyadh', risk_level: 'High' },
      { asset_no: 'V1', site: 'Riyadh', risk_level: 'Critical' },
      { asset_no: 'V2', site: 'Jeddah', risk_level: 'Low' }, // ignored
    ]
    const inspections = [
      { asset_no: 'V1', status: 'Overdue', scheduled_date: '2026-05-01' },
      { asset_no: 'V3', status: 'Scheduled', scheduled_date: '2026-01-01' }, // past due + open
      { asset_no: 'V4', status: 'Done', scheduled_date: '2026-01-01' },      // done → not overdue
    ]
    const records = [
      tyre({ asset_no: 'V1', cost_per_tyre: 500, qty: 2 }),
      tyre({ asset_no: 'V9', cost_per_tyre: 900, qty: 1 }), // no risk → no point
    ]
    const m = buildRiskMatrix({ openTyres, inspections, records, now: NOW })
    const v1 = m.points.find((p) => p.asset === 'V1')
    expect(v1).toMatchObject({ x: 2, y: 1, spend: 1000, site: 'Riyadh' })
    const v3 = m.points.find((p) => p.asset === 'V3')
    expect(v3).toMatchObject({ x: 0, y: 1 })
    expect(m.points.find((p) => p.asset === 'V2')).toBeUndefined()
    expect(m.points.find((p) => p.asset === 'V9')).toBeUndefined()
    expect(m.xAvg).toBe(1)
    expect(m.yAvg).toBe(1)
    expect(m.maxSpend).toBe(1000)
  })

  it('handles empty input', () => {
    const m = buildRiskMatrix({})
    expect(m.points).toEqual([])
    expect(m.xAvg).toBe(0)
  })
})

// ── excel shaping ─────────────────────────────────────────────────────────────

describe('toExcelRows', () => {
  it('heatmap flattens cells back to site/month/spend', () => {
    const h = buildCostHeatmap([tyre({ issue_date: '2026-06-01', cost_per_tyre: 100, qty: 1 })], { months: 2, now: NOW })
    const { rows, columns, headers } = toExcelRows('heatmap', h)
    expect(rows).toEqual([{ site: 'Riyadh', month: '2026-06', spend: 100 }])
    expect(columns).toEqual(['site', 'month', 'spend'])
    expect(headers).toHaveLength(3)
  })

  it('treemap flattens brand/size rows', () => {
    const t = buildBrandSizeTreemap([tyre({ cost_per_tyre: 100, qty: 1 })])
    const { rows } = toExcelRows('treemap', t)
    expect(rows).toEqual([{ brand: 'Michelin', size: '315/80R22.5', spend: 100 }])
  })

  it('sankey resolves node ids to human labels with level names', () => {
    const s = buildFlowSankey([tyre({ qty: 2 })])
    const { rows } = toExcelRows('sankey', s)
    expect(rows).toContainEqual({
      from_level: 'Supplier', from: 'Al Jazira', to_level: 'Brand', to: 'Michelin', tyres: 2,
    })
  })

  it('combo, gauges and risk produce aligned rows', () => {
    const c = buildMonthlyCombo([tyre({ issue_date: '2026-06-01' })], { months: 1, now: NOW })
    expect(toExcelRows('combo', c).rows).toEqual([{ month: '2026-06', spend: 2000, tyres: 2 }])

    const g = buildGauges({ inspections: [{ status: 'Done', findings: 'ok' }], fleet: [{ status: 'Active' }] })
    const gRows = toExcelRows('gauges', g).rows
    expect(gRows).toHaveLength(2)
    expect(gRows[0].value_pct).toBe(100)

    const m = buildRiskMatrix({ openTyres: [{ asset_no: 'V1', risk_level: 'High' }], now: NOW })
    expect(toExcelRows('risk', m).rows[0]).toMatchObject({ asset: 'V1', open_high_critical: 1 })
  })

  it('unknown chart key returns empty shape', () => {
    expect(toExcelRows('nope', {})).toEqual({ rows: [], columns: [], headers: [] })
  })
})
