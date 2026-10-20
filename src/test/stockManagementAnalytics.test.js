import { describe, it, expect } from 'vitest'
import {
  deriveStatus, buildVelocityMap, reorderSuggestion, coverBand, enrichStock, filterStock,
  summarizeStock, timelineByDate, timelineSummary, todayStr, offsetDate, firstOfMonth,
  velocitySince, stockExportRows, STOCK_EXPORT_COLS, STOCK_EXPORT_HEADERS,
  summarizeTyreStock, summarizeTyreStockBySite, tyreChangeSummary, lowTyreStockRows,
} from '../lib/stockManagementAnalytics'

const NOW = new Date(2026, 8, 26, 10, 0, 0) // local 26 Sep 2026

const STOCK = [
  { id: 's1', site: 'NHC', description: '315/80', stock_qty: 2, min_level: 5, critical_level: 3, reorder_qty: 0 },
  { id: 's2', site: 'JED', description: '385/65', stock_qty: 4, min_level: 5, critical_level: 3, reorder_qty: 12 },
  { id: 's3', site: 'RUH', description: 'spare', stock_qty: 40, min_level: 5, critical_level: 3, management_action: 'hold' },
]
const ISSUES = [
  { site: 'NHC', qty: 3 }, { site: 'NHC', qty: null }, { site: 'NHC', qty: 2 },
  { site: 'JED', qty: 30 }, { site: null, qty: 9 },
]

describe('dates', () => {
  it('builds local date keys from an injected clock', () => {
    expect(todayStr(NOW)).toBe('2026-09-26')
    expect(offsetDate(-1, NOW)).toBe('2026-09-25')
    expect(offsetDate(-29, NOW)).toBe('2026-08-28')
    expect(firstOfMonth(NOW)).toBe('2026-09-01')
    expect(velocitySince(NOW, 3)).toBe('2026-06-26')
  })
})

describe('status and velocity', () => {
  it('keeps the historical status bands', () => {
    expect(deriveStatus(STOCK[0])).toBe('Critical')
    expect(deriveStatus(STOCK[1])).toBe('Low')
    expect(deriveStatus(STOCK[2])).toBe('OK')
  })
  it('builds per-site velocity and leaves cover null without consumption', () => {
    const v = buildVelocityMap(STOCK, ISSUES, 3)
    expect(v.s1.avgPerMonth).toBe(2) // (3 + 1 + 2) / 3
    expect(v.s1.daysRemaining).toBe(30)
    expect(v.s2.avgPerMonth).toBe(10)
    expect(v.s2.daysRemaining).toBe(12)
    expect(v.s3.avgPerMonth).toBe(0)
    expect(v.s3.daysRemaining).toBeNull()
  })
  it('suggests reorder only under 30 days', () => {
    expect(reorderSuggestion(STOCK[1], { daysRemaining: 12 })).toBe(12)
    expect(reorderSuggestion(STOCK[0], { daysRemaining: 10 })).toBe(8)
    expect(reorderSuggestion(STOCK[0], { daysRemaining: 30 })).toBeNull()
    expect(reorderSuggestion(STOCK[0], null)).toBeNull()
  })
  it('bands cover', () => {
    expect(coverBand(null)).toBe('unknown')
    expect(coverBand(31)).toBe('healthy')
    expect(coverBand(10)).toBe('watch')
    expect(coverBand(9)).toBe('urgent')
  })
})

describe('KPIs and filters', () => {
  const rows = enrichStock(STOCK, buildVelocityMap(STOCK, ISSUES, 3))
  it('summarises an enriched set honestly', () => {
    const k = summarizeStock(rows)
    expect(k.items).toBe(3)
    expect(k.units).toBe(46)
    expect(k.counts).toEqual({ OK: 1, Low: 1, Critical: 1 })
    expect(k.atRisk).toBe(1)
    expect(k.toReorder).toBe(12)
    expect(k.sites).toBe(3)
    expect(k.avgCoverDays).toBe(21)
    const empty = summarizeStock([])
    expect(empty.units).toBeNull()
    expect(empty.avgCoverDays).toBeNull()
  })
  it('filters by search, site and status', () => {
    expect(filterStock(rows, { search: 'hold' }).map(r => r.id)).toEqual(['s3'])
    expect(filterStock(rows, { site: 'JED' }).map(r => r.id)).toEqual(['s2'])
    expect(filterStock(rows, { status: 'Critical' }).map(r => r.id)).toEqual(['s1'])
  })
  it('exports every column with N/A for unmeasured cover', () => {
    const out = stockExportRows(rows)
    expect(STOCK_EXPORT_COLS).toHaveLength(STOCK_EXPORT_HEADERS.length)
    expect(out.find(r => r.site === 'RUH').days_left).toBe('N/A')
  })
})

describe('timeline', () => {
  const days = timelineByDate([
    { issue_date: '2026-09-26', qty: 2 },
    { issue_date: '2026-09-26T08:00:00', qty: -1 },
    { issue_date: '2026-09-25', qty: 4 },
    { issue_date: null, qty: 9 },
  ])
  it('groups by day with returns as stock in', () => {
    expect(days).toEqual([
      { date: '2026-09-25', in: 0, out: 4, net: -4 },
      { date: '2026-09-26', in: 1, out: 2, net: -1 },
    ])
  })
  it('compares today with yesterday and returns null without a baseline', () => {
    const s = timelineSummary(days, NOW)
    expect(s.todayIssues).toBe(2)
    expect(s.yesterdayIssues).toBe(4)
    expect(s.changePct).toBe(-50)
    expect(s.busiest.date).toBe('2026-09-25')
    expect(timelineSummary([], NOW).changePct).toBeNull()
    expect(timelineSummary([], NOW).busiest).toBeNull()
  })
})

describe('company tyre summary', () => {
  it('sums only confirmed piece-based tyre stock and groups it by size', () => {
    const summary = summarizeTyreStock([
      { description: 'Tyre 315/80R22.5', tyre_size: '315/80R22.5', stock_qty: 8, custom_data: { stock_item: { kind: 'tyre', unit: 'PCS', size: '315/80R22.5' } } },
      { description: 'Tyre 315/80R22.5', stock_qty: 4, custom_data: { stock_item: { kind: 'tyre', unit: 'PCS', size: '315/80R22.5' } } },
      { description: 'Tyre set 385/65R22.5', stock_qty: 2, custom_data: { stock_item: { kind: 'tyre', unit: 'SET' } } },
      { description: 'Wheel rim', stock_qty: 10, custom_data: { stock_item: { kind: 'rim', unit: 'PCS' } } },
      { description: 'Tyre 12.00R24', stock_qty: 3, tyre_size: '12.00R24' },
    ])
    expect(summary.pcs).toBe(15)
    expect(summary.nonPcsLines).toBe(1)
    expect(summary.bySize).toEqual([
      { size: '315/80R22.5', quantity: 12 },
      { size: '12.00R24', quantity: 3 },
    ])
  })

  it('builds a site by size matrix from current tyre balances and keeps totals aligned', () => {
    const rows = [
      { site: 'Qiddiya G1', description: '315/80R22.5 tyre', stock_qty: 12, custom_data: { stock_item: { kind: 'tyre', unit: 'PCS' } } },
      { site: 'Qiddiya G1', description: '385/65R22.5 tyre', stock_qty: 4, custom_data: { stock_item: { kind: 'tyre', unit: 'PCS' } } },
      { site: 'Diriyah 2', description: '315/80R22.5 tyre', stock_qty: 7, custom_data: { stock_item: { kind: 'tyre', unit: 'PCS' } } },
      { site: 'Diriyah 2', description: 'Rim 22.5', stock_qty: 5, custom_data: { stock_item: { kind: 'rim', unit: 'PCS' } } },
      { site: 'Qiddiya G1', description: 'Tyre set 11R22.5', stock_qty: 2, custom_data: { stock_item: { kind: 'tyre', unit: 'SET' } } },
    ]
    const summary = summarizeTyreStockBySite(rows)
    expect(summary).toEqual({
      pcs: 23,
      sizes: ['315/80R22.5', '385/65R22.5'],
      sites: [
        { site: 'Qiddiya G1', country: '', key: '["","Qiddiya G1"]', total: 16, bySize: [{ size: '315/80R22.5', quantity: 12 }, { size: '385/65R22.5', quantity: 4 }] },
        { site: 'Diriyah 2', country: '', key: '["","Diriyah 2"]', total: 7, bySize: [{ size: '315/80R22.5', quantity: 7 }] },
      ],
    })
  })

  it('recovers imported tyre sizes and merges equivalent size formatting', () => {
    const imported = [
      ['TIRE 10-16.5', 2],
      ['TIRE 11R22.5 TL 16PR', 7],
      ['TIRE 195 R 15C-6PR NEW MODEL 2007 TOYOTA', 1],
      ['TIRE 195R15 6PR', 3],
      ['TIRE 205R16 /689', 3],
      ['TIRE 235-70R16 TL ROA', 6],
      ['TIRE 235-75R17.5 TL 16PR', 8],
      ['TIRE 385-65R22.5', 21],
      ['TIRE 7.00 R16 10PR R 230TT BRIDGESTONE', 6],
      ['TIRE 9.00R20 HANK', 5],
    ].map(([name, stock_qty]) => ({
      description: '', stock_qty, site: 'NHC',
      custom_data: { stock_item: { kind: 'tyre', unit: 'PCS', source: { name } } },
    }))
    imported.push(
      { description: 'TIRE 315/80 R22.5 TECHKING', stock_qty: 45, site: 'NHC', tyre_size: '315/80 R22.5', custom_data: { stock_item: { kind: 'tyre', unit: 'PCS' } } },
      { description: 'TIRE 315/80R22.5 Double coin', stock_qty: 35, site: 'NHC', custom_data: { stock_item: { kind: 'tyre', unit: 'PCS' } } },
      { description: 'TIRE 95 R 15C-6PR', stock_qty: 2, site: 'NHC', tyre_size: '95 R 15', custom_data: { stock_item: { kind: 'tyre', unit: 'PCS' } } },
    )
    const summary = summarizeTyreStockBySite(imported)
    expect(summary.pcs).toBe(144)
    expect(summary.sizes).toEqual(expect.arrayContaining([
      '10-16.5', '11R22.5', '195R15', '205R16', '235/70R16',
      '235/75R17.5', '385/65R22.5', '7.00R16', '9.00R20', '95R15', '315/80R22.5',
    ]))
    expect(summary.sizes).not.toContain('Size not recorded')
    expect(summary.sites[0].bySize.find(({ size }) => size === '315/80R22.5').quantity).toBe(80)
    expect(summary.sites[0].bySize.find(({ size }) => size === '195R15').quantity).toBe(4)
  })

  it('hides sizes and sites whose counted tyre stock is zero', () => {
    const summary = summarizeTyreStockBySite([
      { site: 'NHC', description: 'TIRE 315/80 R22.5', stock_qty: 5, custom_data: { stock_item: { kind: 'tyre', unit: 'PCS' } } },
      { site: 'NHC', description: 'TIRE 17.5R25', stock_qty: 0, custom_data: { stock_item: { kind: 'tyre', unit: 'PCS' } } },
      { site: 'DIRIYAH', description: 'TIRE 17.5R25', stock_qty: 0, custom_data: { stock_item: { kind: 'tyre', unit: 'PCS' } } },
    ])
    expect(summary.sites).toHaveLength(1)
    expect(summary.sites[0].site).toBe('NHC')
    expect(summary.sites[0].bySize).toEqual([{ size: '315/80R22.5', quantity: 5 }])
    expect(summary.sizes).toEqual(['315/80R22.5'])
  })

  it('counts recorded changes by size and month, excluding returns and out-of-window rows', () => {
    const summary = tyreChangeSummary([
      { issue_date: '2026-09-02', size: '315/80R22.5', qty: 3 },
      { issue_date: '2026-09-03', size: '315/80R22.5', qty: 2 },
      { issue_date: '2026-08-12', size: '385/65R22.5', qty: 4 },
      { issue_date: '2026-07-12', size: null, qty: null },
      { issue_date: '2026-09-04', size: '315/80R22.5', qty: -1 },
      { issue_date: '2026-03-30', size: '315/80R22.5', qty: 99 },
    ], NOW)
    expect(summary.total).toBe(10)
    expect(summary.months.map(month => month.quantity)).toEqual([0, 0, 0, 1, 4, 5])
    expect(summary.bySize).toEqual([
      { size: '315/80R22.5', quantity: 5 },
      { size: '385/65R22.5', quantity: 4 },
      { size: 'Size not recorded', quantity: 1 },
    ])
  })

  it('flags only tyre stock lines at or below their minimum', () => {
    const flagged = lowTyreStockRows([
      { description: '315/80R22.5 tyre', stock_qty: 3, min_level: 5 },
      { description: 'Tyre 12.00R24', stock_qty: 5, min_level: 5 },
      { description: 'Tyre 385/65R22.5', stock_qty: 7, min_level: 5 },
      { description: 'Wheel rim', stock_qty: 0, min_level: 5 },
      { description: '315/80R22.5 tyre', stock_qty: 0, min_level: 5, custom_data: { stock_item: { kind: 'rim' } } },
    ])
    expect(flagged.map(row => row.stock_qty)).toEqual([3, 5])
  })
})
