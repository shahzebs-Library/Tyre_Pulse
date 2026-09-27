import { describe, it, expect } from 'vitest'
import {
  lineCost, pmIntervalSummary, groupVehicleHistory, groupCostAnalysis, tyreLineRows,
  summarizeReport, printableTableHtml,
} from '../lib/reportsAnalytics'

const raw = [
  { asset_no: 'TM1', site: 'NHC', brand: 'A', cost_per_tyre: 100, qty: 2, issue_date: '2026-01-01', risk_level: 'High' },
  { asset_no: 'TM1', site: 'NHC', brand: 'B', cost_per_tyre: null, qty: 1, issue_date: '2026-03-01', risk_level: 'Low' },
  { asset_no: 'TM2', site: 'JED', brand: 'A', cost_per_tyre: null, issue_date: '2026-02-01', risk_level: 'Critical' },
]

describe('lineCost', () => {
  it('is unit x qty with qty defaulting to 1, null when unpriced', () => {
    expect(lineCost(raw[0])).toBe(200)
    expect(lineCost({ cost_per_tyre: 50 })).toBe(50)
    expect(lineCost(raw[1])).toBeNull()
  })
})

describe('pmIntervalSummary', () => {
  it('prefers the calendar interval, then the meter', () => {
    expect(pmIntervalSummary({ interval_value: 3, interval_type: 'months' })).toBe('3 months')
    expect(pmIntervalSummary({ meter_interval: 250, meter_source: 'engine_hours' })).toBe('250 hours')
    expect(pmIntervalSummary({ meter_interval: 10000, meter_source: 'odometer' })).toBe('10000 km')
    expect(pmIntervalSummary({ meter_interval: 5, meter_source: 'none' })).toBe('')
  })
})

describe('groupVehicleHistory', () => {
  it('sums priced lines only and reports N/A for an unpriced asset', () => {
    const g = groupVehicleHistory(raw)
    expect(g[0]).toMatchObject({ asset_no: 'TM1', count: 2, priced_count: 1, total_cost: 200, avg_cost: 200, brands: 'A, B', last_date: '2026-03-01', high_risk_count: 1 })
    expect(g[1]).toMatchObject({ asset_no: 'TM2', total_cost: null, avg_cost: null, high_risk_count: 1 })
  })
})

describe('groupCostAnalysis', () => {
  it('groups by site and brand', () => {
    const g = groupCostAnalysis(raw)
    expect(g).toHaveLength(3)
    expect(g[0]).toMatchObject({ site: 'NHC', brand: 'A', total_cost: 200 })
    expect(g.find(x => x.site === 'JED').total_cost).toBeNull()
  })
})

describe('tyreLineRows + summarizeReport', () => {
  it('keeps unpriced lines as null cost', () => {
    const rows = tyreLineRows(raw)
    expect(rows.map(r => r.cost)).toEqual([200, null, null])
    const s = summarizeReport('Tyre Replacement Log', rows)
    expect(s).toMatchObject({ rows: 3, records: 3, totalCost: 200, pricedRows: 1, assets: 2, sites: 2, highRisk: 2 })
  })
  it('sums grouped counts as records', () => {
    const s = summarizeReport('Vehicle History', groupVehicleHistory(raw))
    expect(s.records).toBe(3)
    expect(s.rows).toBe(2)
    expect(s.highRisk).toBe(2)
  })
  it('reports N/A cost when nothing is priced or the report has no cost', () => {
    expect(summarizeReport('Risk Summary', tyreLineRows([raw[2]])).totalCost).toBeNull()
    expect(summarizeReport('Inspection Report', [{ asset_no: 'X' }]).totalCost).toBeNull()
    expect(summarizeReport('Inspection Report', []).hasCost).toBe(false)
  })
})

describe('printableTableHtml', () => {
  it('escapes cell content and labels blanks', () => {
    const html = printableTableHtml([{ a: '<b>x</b>', b: null }], ['a', 'b'], c => c.toUpperCase())
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('<td>N/A</td>')
    expect(html).toContain('<th>A</th>')
  })
})
