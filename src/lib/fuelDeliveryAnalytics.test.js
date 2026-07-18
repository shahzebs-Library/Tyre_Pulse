import { describe, it, expect } from 'vitest'
import {
  num, isCounted, deliveryTime, pricePerLitre, groupByKey, monthlyTrend,
  priceTrend, priceStats, detectAnomalies, distinctValues, filterDeliveries,
  analyzeDeliveries, STATUSES,
} from './fuelDeliveryAnalytics'

const row = (o = {}) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  status: 'delivered', ...o,
})

describe('num', () => {
  it('coerces strings, currency text and nullish to finite numbers', () => {
    expect(num('1000')).toBe(1000)
    expect(num('2.85')).toBe(2.85)
    expect(num('1,200.5')).toBe(1200.5)
    expect(num(null)).toBe(0)
    expect(num('')).toBe(0)
    expect(num('abc')).toBe(0)
    expect(num(42)).toBe(42)
  })
})

describe('isCounted', () => {
  it('excludes cancelled, includes ordered/delivered/unknown', () => {
    expect(isCounted(row({ status: 'cancelled' }))).toBe(false)
    expect(isCounted(row({ status: 'Cancelled' }))).toBe(false)
    expect(isCounted(row({ status: 'delivered' }))).toBe(true)
    expect(isCounted(row({ status: 'ordered' }))).toBe(true)
    expect(isCounted(row({ status: null }))).toBe(true)
  })
})

describe('deliveryTime', () => {
  it('parses date-only strings as UTC midnight and falls back to created_at', () => {
    expect(deliveryTime({ delivered_at: '2026-03-15' })).toBe(Date.parse('2026-03-15T00:00:00Z'))
    expect(deliveryTime({ created_at: '2026-01-02T10:00:00Z' })).toBe(Date.parse('2026-01-02T10:00:00Z'))
    expect(deliveryTime({})).toBeNull()
    expect(deliveryTime({ delivered_at: 'nonsense' })).toBeNull()
  })
})

describe('pricePerLitre', () => {
  it('prefers blended total/litres, falls back to unit_price, else null', () => {
    expect(pricePerLitre({ litres: 100, total_cost: 285 })).toBeCloseTo(2.85, 5)
    expect(pricePerLitre({ litres: 0, unit_price: 3 })).toBe(3)
    expect(pricePerLitre({ unit_price: '2.5' })).toBe(2.5)
    expect(pricePerLitre({})).toBeNull()
  })
})

describe('groupByKey', () => {
  const rows = [
    row({ site: 'Depot A', litres: 100, total_cost: 285 }),
    row({ site: 'Depot A', litres: 50, total_cost: 150 }),
    row({ site: 'Depot B', litres: 200, total_cost: 500 }),
    row({ site: '', litres: 10, total_cost: 30 }),
    row({ site: 'Depot B', litres: 999, total_cost: 999, status: 'cancelled' }), // excluded
  ]
  it('aggregates counted rows by key with blended avg price, cost-desc sorted', () => {
    const g = groupByKey(rows, 'site')
    expect(g.map((x) => x.key)).toEqual(['Depot B', 'Depot A', 'Unspecified'])
    const b = g.find((x) => x.key === 'Depot B')
    expect(b.litres).toBe(200)
    expect(b.cost).toBe(500)
    expect(b.deliveries).toBe(1)
    expect(b.avgPrice).toBe(2.5)
    const a = g.find((x) => x.key === 'Depot A')
    expect(a.litres).toBe(150)
    expect(a.cost).toBe(435)
    expect(a.deliveries).toBe(2)
  })
  it('returns [] for no rows', () => {
    expect(groupByKey([], 'supplier')).toEqual([])
  })
})

describe('monthlyTrend', () => {
  const now = new Date(Date.UTC(2026, 2, 15)) // Mar 2026
  it('produces N trailing buckets, places rows in the right month, excludes cancelled', () => {
    const rows = [
      row({ delivered_at: '2026-03-01', litres: 100, total_cost: 300 }),
      row({ delivered_at: '2026-03-20', litres: 100, total_cost: 320 }),
      row({ delivered_at: '2026-01-10', litres: 50, total_cost: 150 }),
      row({ delivered_at: '2026-03-05', litres: 500, total_cost: 500, status: 'cancelled' }),
    ]
    const t = monthlyTrend(rows, 12, now)
    expect(t).toHaveLength(12)
    expect(t[t.length - 1].key).toBe('2026-03')
    const mar = t[t.length - 1]
    expect(mar.litres).toBe(200)
    expect(mar.cost).toBe(620)
    expect(mar.deliveries).toBe(2)
    expect(mar.avgPrice).toBe(3.1)
    const jan = t.find((b) => b.key === '2026-01')
    expect(jan.deliveries).toBe(1)
    // month with no data -> avgPrice null
    const feb = t.find((b) => b.key === '2026-02')
    expect(feb.litres).toBe(0)
    expect(feb.avgPrice).toBeNull()
  })
})

describe('priceTrend', () => {
  it('compares last two priced months', () => {
    const monthly = [
      { key: 'a', litres: 100, avgPrice: 2.0 },
      { key: 'b', litres: 0, avgPrice: null },
      { key: 'c', litres: 100, avgPrice: 2.5 },
    ]
    const t = priceTrend(monthly)
    expect(t.current).toBe(2.5)
    expect(t.previous).toBe(2.0)
    expect(t.changePct).toBe(25)
    expect(t.direction).toBe('up')
  })
  it('down and na cases', () => {
    expect(priceTrend([{ litres: 100, avgPrice: 3 }, { litres: 100, avgPrice: 2.7 }]).direction).toBe('down')
    expect(priceTrend([{ litres: 100, avgPrice: 3 }]).direction).toBe('na')
    expect(priceTrend([]).direction).toBe('na')
  })
})

describe('priceStats', () => {
  it('mean/min/max/stdDev across priced counted rows', () => {
    const rows = [
      row({ litres: 100, total_cost: 200 }), // 2.0
      row({ litres: 100, total_cost: 300 }), // 3.0
      row({ litres: 100, total_cost: 400, status: 'cancelled' }), // excluded
    ]
    const s = priceStats(rows)
    expect(s.count).toBe(2)
    expect(s.mean).toBe(2.5)
    expect(s.min).toBe(2)
    expect(s.max).toBe(3)
    expect(s.stdDev).toBeGreaterThan(0)
  })
  it('empty when no priced rows', () => {
    expect(priceStats([]).mean).toBeNull()
    expect(priceStats([row({})]).count).toBe(0)
  })
})

describe('detectAnomalies', () => {
  it('flags missing cost, missing litres, cost mismatch and price outliers', () => {
    const rows = [
      row({ id: 'm1', litres: 100 }), // missing_cost
      row({ id: 'm2', total_cost: 300 }), // missing_litres
      row({ id: 'mm', litres: 100, unit_price: 3, total_cost: 500 }), // cost_mismatch (expected 300)
      row({ id: 'p1', litres: 100, total_cost: 300 }), // 3.0
      row({ id: 'p2', litres: 100, total_cost: 300 }), // 3.0
      row({ id: 'p3', litres: 100, total_cost: 300 }), // 3.0
      row({ id: 'out', litres: 100, total_cost: 900 }), // 9.0 outlier
    ]
    const a = detectAnomalies(rows)
    const types = a.map((x) => x.type)
    expect(types).toContain('missing_cost')
    expect(types).toContain('missing_litres')
    expect(types).toContain('cost_mismatch')
    expect(types).toContain('price_outlier')
    // high severity (outlier) sorts first
    expect(a[0].severity).toBe('high')
  })
  it('no anomalies for clean uniform data', () => {
    const rows = [
      row({ litres: 100, unit_price: 3, total_cost: 300 }),
      row({ litres: 200, unit_price: 3, total_cost: 600 }),
    ]
    expect(detectAnomalies(rows)).toEqual([])
  })
})

describe('distinctValues', () => {
  it('unique non-empty sorted', () => {
    const rows = [row({ site: 'B' }), row({ site: 'A' }), row({ site: 'A' }), row({ site: '' })]
    expect(distinctValues(rows, 'site')).toEqual(['A', 'B'])
  })
})

describe('filterDeliveries', () => {
  const rows = [
    row({ id: '1', supplier: 'ADNOC', site: 'Depot A', delivered_at: '2026-01-10', delivery_no: 'DN-1' }),
    row({ id: '2', supplier: 'ENOC', site: 'Depot B', delivered_at: '2026-03-10', notes: 'diesel batch' }),
    row({ id: '3', supplier: 'ADNOC', site: 'Depot A', delivered_at: '2026-05-10', status: 'cancelled' }),
  ]
  it('filters by status, site, supplier', () => {
    expect(filterDeliveries(rows, { site: 'Depot A' }).map((r) => r.id)).toEqual(['1', '3'])
    expect(filterDeliveries(rows, { supplier: 'ENOC' }).map((r) => r.id)).toEqual(['2'])
    expect(filterDeliveries(rows, { status: 'cancelled' }).map((r) => r.id)).toEqual(['3'])
  })
  it('filters by date range (inclusive) and search', () => {
    expect(filterDeliveries(rows, { from: '2026-02-01', to: '2026-04-01' }).map((r) => r.id)).toEqual(['2'])
    expect(filterDeliveries(rows, { search: 'diesel' }).map((r) => r.id)).toEqual(['2'])
    expect(filterDeliveries(rows, { search: 'dn-1' }).map((r) => r.id)).toEqual(['1'])
  })
})

describe('analyzeDeliveries', () => {
  const now = new Date(Date.UTC(2026, 2, 15))
  const rows = [
    row({ id: '1', supplier: 'ADNOC', site: 'Depot A', litres: 100, total_cost: 285, unit_price: 2.85, delivered_at: '2026-03-01' }),
    row({ id: '2', supplier: 'ADNOC', site: 'Depot A', litres: 200, total_cost: 580, unit_price: 2.9, delivered_at: '2026-02-05' }),
    row({ id: '3', supplier: 'ENOC', site: 'Depot B', litres: 150, total_cost: 450, unit_price: 3.0, delivered_at: '2026-03-08' }),
    row({ id: '4', supplier: 'ENOC', site: 'Depot B', litres: 999, total_cost: 9999, delivered_at: '2026-03-09', status: 'cancelled' }),
  ]
  it('computes headline KPIs excluding cancelled', () => {
    const a = analyzeDeliveries(rows, { now })
    expect(a.totalDeliveries).toBe(4)
    expect(a.countedDeliveries).toBe(3)
    expect(a.cancelledDeliveries).toBe(1)
    expect(a.totalLitres).toBe(450)
    expect(a.totalCost).toBe(1315)
    expect(a.avgPricePerLitre).toBeCloseTo(2.922, 2)
    expect(a.avgDeliverySize).toBe(150)
  })
  it('builds breakdowns, monthly trend and status counts', () => {
    const a = analyzeDeliveries(rows, { now })
    expect(a.bySupplier.map((s) => s.key)).toEqual(['ADNOC', 'ENOC'])
    expect(a.topSupplier.key).toBe('ADNOC')
    expect(a.bySite).toHaveLength(2)
    expect(a.monthly).toHaveLength(12)
    expect(a.statusCounts.delivered).toBe(3)
    expect(a.statusCounts.cancelled).toBe(1)
    expect(a.priceCoveragePct).toBe(100)
  })
  it('handles empty input honestly', () => {
    const a = analyzeDeliveries([], { now })
    expect(a.totalDeliveries).toBe(0)
    expect(a.totalLitres).toBe(0)
    expect(a.avgPricePerLitre).toBeNull()
    expect(a.bySite).toEqual([])
    expect(a.topSupplier).toBeNull()
    expect(a.anomalies).toEqual([])
  })
  it('is defensive against non-array input', () => {
    expect(analyzeDeliveries(null).totalDeliveries).toBe(0)
    expect(analyzeDeliveries(undefined).bySupplier).toEqual([])
  })
})

describe('STATUSES', () => {
  it('exports the canonical status vocab', () => {
    expect(STATUSES).toEqual(['ordered', 'delivered', 'cancelled'])
  })
})
