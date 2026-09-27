import { describe, it, expect } from 'vitest'
import {
  assetKey, withGridCost, assetRows, siteOptions, brandOptions, filterAssets, activeFilterCount,
  fleetKpis, assetTrend, trendNote, serialLifecycle, exportRows, EXPORT_COLUMNS,
} from '../lib/fleetAnalyticsView'

const METRICS = [
  { assetNo: ' tm1 ', count: 10, totalCost: 500, highRiskCount: 2, failureFreqPerMonth: 3.2, sites: ['NHC'], brands: ['ROADX'], lastSeen: '2026-05-01', firstSeen: '2025-01-01' },
  { assetNo: 'TM2', count: 4, totalCost: 100, highRiskCount: 0, failureFreqPerMonth: 0.5, sites: ['JED', 'NHC'], brands: ['TRIANGLE'], lastSeen: '2026-01-10' },
  { assetNo: 'TM3', count: 1, totalCost: null, highRiskCount: 0, failureFreqPerMonth: null, sites: null, brands: undefined, lastSeen: null },
]

describe('grid cost overlay', () => {
  it('uses the expense grid when it carries the asset, else the tyre-record total', () => {
    const grid = new Map([['TM1', 9000]])
    const rows = withGridCost(METRICS, grid)
    expect(assetKey(' tm1 ')).toBe('TM1')
    expect(rows[0]).toMatchObject({ totalCost: 9000, costBasis: 'grid' })
    expect(rows[1]).toMatchObject({ totalCost: 100, costBasis: 'records' })
    expect(rows[2].totalCost).toBeNull()
  })
  it('falls back entirely when the grid is unavailable', () => {
    expect(withGridCost(METRICS, null).every((r) => r.costBasis === 'records')).toBe(true)
  })
})

describe('rows, options and filters', () => {
  const rows = assetRows(withGridCost(METRICS, null))
  it('normalises arrays and nulls', () => {
    expect(rows[2]).toMatchObject({ sites: [], brands: [], failureFreqPerMonth: null, lastSeen: null })
    expect(siteOptions(rows)).toEqual(['JED', 'NHC'])
    expect(brandOptions(rows)).toEqual(['ROADX', 'TRIANGLE'])
  })
  it('filters by search, dates, site, brand and risk', () => {
    const ids = (f) => filterAssets(rows, f).map((r) => r.assetNo)
    expect(ids({ search: 'tm2' })).toEqual(['TM2'])
    expect(ids({ from: '2026-02-01' })).toEqual([' tm1 ', 'TM3'])
    expect(ids({ site: 'JED' })).toEqual(['TM2'])
    expect(ids({ brand: 'ROADX' })).toEqual([' tm1 '])
    expect(ids({ risk: 'high' })).toEqual([' tm1 '])
    expect(ids({ risk: 'frequent' })).toEqual([' tm1 '])
    expect(activeFilterCount({ search: 'x' })).toBe(0)
    expect(activeFilterCount({ site: 'NHC', risk: 'high' })).toBe(2)
  })
})

describe('fleetKpis', () => {
  it('averages cost over costed assets only', () => {
    const k = fleetKpis(assetRows(withGridCost(METRICS, new Map([['TM1', 900]]))))
    expect(k).toMatchObject({ assets: 3, records: 15, highFreq: 1, highRiskAssets: 1, totalCost: 1000, avgCost: 500, gridCosted: 1 })
  })
  it('returns null cost when nothing is costed', () => {
    const k = fleetKpis([])
    expect(k.avgCost).toBeNull()
    expect(k.totalCost).toBeNull()
    expect(k.assets).toBe(0)
  })
})

describe('drill-down', () => {
  const recs = [
    { serial_no: 'S1', issue_date: '2026-01-05', risk_level: 'Low', brand: 'A', cost_per_tyre: 100, qty: 1 },
    { serial_no: 'S1', issue_date: '2026-03-05', risk_level: 'High', brand: 'A', cost_per_tyre: 100, qty: 2 },
    { serial_no: 'S2', issue_date: '2026-02-05', brand: 'B' },
    { serial_no: null, issue_date: '2026-02-06' },
  ]
  it('groups serials newest-first with the latest reading', () => {
    const s = serialLifecycle(recs)
    expect(s.map((x) => x.serial)).toEqual(['S1', 'S2'])
    expect(s[0]).toMatchObject({ events: 2, risk: 'High', latestDate: '2026-03-05', firstDate: '2026-01-05' })
    expect(s[1].risk).toBeNull()
  })
  it('buckets by month and writes a trend note', () => {
    const { monthly, reg } = assetTrend(recs)
    expect(monthly.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(reg).not.toBeNull()
    expect(trendNote(reg)).toMatch(/^R2 \d\.\d{2} \| (rising|falling|flat)/)
    expect(trendNote(null)).toBeNull()
    expect(assetTrend([]).reg).toBeNull()
  })
})

describe('exportRows', () => {
  it('exports every row with honest blanks and its cost basis', () => {
    const out = exportRows(assetRows(withGridCost(METRICS, new Map([['TM1', 900]]))))
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ total_cost: 900, cost_basis: 'Expense grid', fail_per_month: '3.2' })
    expect(out[2]).toMatchObject({ total_cost: 'N/A', fail_per_month: 'N/A', last_seen: 'N/A' })
    expect(Object.keys(out[0])).toEqual(EXPORT_COLUMNS.map(([k]) => k))
  })
})
