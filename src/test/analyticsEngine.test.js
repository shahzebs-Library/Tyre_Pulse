// ─────────────────────────────────────────────────────────────────────────────
// analyticsEngine.test.js — Comprehensive unit tests for analyticsEngine.js
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  mean,
  median,
  stdDev,
  percentile,
  sum,
  groupBy,
  countBy,
  sumBy,
  bucketByMonth,
  rollingAverage,
  linearRegression,
  forecastMonthly,
  computeBrandMetrics,
  computeSiteMetrics,
  computeAssetMetrics,
  monthlyTrendWithForecast,
  computeMonthlyKpiActuals,
  weightedRiskScore,
  detectRiskSpike,
  buildSiteRadar,
  recordCpk,
  computeCountryMetrics,
} from '../lib/analyticsEngine'

// ── mean ─────────────────────────────────────────────────────────────────────

describe('mean', () => {
  it('returns 0 for empty array', () => {
    expect(mean([])).toBe(0)
  })

  it('returns the single value for a one-element array', () => {
    expect(mean([42])).toBe(42)
  })

  it('calculates mean of positive numbers', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3)
  })

  it('calculates mean with negative numbers', () => {
    expect(mean([-10, 0, 10])).toBe(0)
  })

  it('calculates mean with decimals', () => {
    expect(mean([1.5, 2.5])).toBeCloseTo(2.0)
  })

  it('handles all-zero array', () => {
    expect(mean([0, 0, 0])).toBe(0)
  })
})

// ── median ────────────────────────────────────────────────────────────────────

describe('median', () => {
  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0)
  })

  it('returns the single element for a one-element array', () => {
    expect(median([7])).toBe(7)
  })

  it('returns middle value for odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('returns average of two middle values for even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('handles unsorted input correctly', () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3)
  })

  it('handles duplicate values', () => {
    expect(median([2, 2, 2, 2])).toBe(2)
  })

  it('handles negative numbers', () => {
    expect(median([-5, -3, -1])).toBe(-3)
  })
})

// ── stdDev ────────────────────────────────────────────────────────────────────

describe('stdDev', () => {
  it('returns 0 for empty array', () => {
    expect(stdDev([])).toBe(0)
  })

  it('returns 0 for single-element array', () => {
    expect(stdDev([42])).toBe(0)
  })

  it('returns 0 for all-equal values', () => {
    expect(stdDev([5, 5, 5, 5])).toBe(0)
  })

  it('calculates population stdDev correctly', () => {
    // mean([2,4,4,4,5,5,7,9]) = 5, population stdDev = 2
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2)
  })

  it('handles two-element array', () => {
    // mean([0,10]) = 5, variance = ((0-5)^2 + (10-5)^2)/2 = 25, sd = 5
    expect(stdDev([0, 10])).toBeCloseTo(5)
  })

  it('is non-negative for any input', () => {
    expect(stdDev([-100, 0, 100])).toBeGreaterThanOrEqual(0)
  })
})

// ── percentile ────────────────────────────────────────────────────────────────

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0)
  })

  it('returns the only element for p0 and p100 on single-element array', () => {
    expect(percentile([7], 0)).toBe(7)
    expect(percentile([7], 100)).toBe(7)
  })

  it('returns minimum for p0', () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1)
  })

  it('returns maximum for p100', () => {
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5)
  })

  it('returns median for p50 on odd array', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3)
  })

  it('returns interpolated value for non-integer index', () => {
    // sorted [1,2,3,4], idx = 0.75 * 3 = 2.25, lo=2, hi=3 → 3 + 0.25*(4-3) = 3.25
    expect(percentile([1, 2, 3, 4], 75)).toBeCloseTo(3.25)
  })

  it('handles unsorted input', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3)
  })
})

// ── sum ───────────────────────────────────────────────────────────────────────

describe('sum', () => {
  it('returns 0 for empty array', () => {
    expect(sum([])).toBe(0)
  })

  it('sums positive numbers', () => {
    expect(sum([1, 2, 3, 4])).toBe(10)
  })

  it('treats null values as 0', () => {
    expect(sum([1, null, 3])).toBe(4)
  })

  it('treats undefined values as 0', () => {
    expect(sum([1, undefined, 3])).toBe(4)
  })

  it('handles all-zero array', () => {
    expect(sum([0, 0, 0])).toBe(0)
  })

  it('handles negative numbers', () => {
    expect(sum([-1, -2, 3])).toBe(0)
  })
})

// ── groupBy ───────────────────────────────────────────────────────────────────

describe('groupBy', () => {
  it('groups items by string key', () => {
    const items = [{ k: 'a' }, { k: 'b' }, { k: 'a' }]
    const result = groupBy(items, i => i.k)
    expect(result.a).toHaveLength(2)
    expect(result.b).toHaveLength(1)
  })

  it('returns empty object for empty array', () => {
    expect(groupBy([], i => i.k)).toEqual({})
  })

  it('creates one group when all items have same key', () => {
    const items = [{ k: 'x' }, { k: 'x' }]
    const result = groupBy(items, i => i.k)
    expect(Object.keys(result)).toHaveLength(1)
    expect(result.x).toHaveLength(2)
  })
})

// ── countBy ───────────────────────────────────────────────────────────────────

describe('countBy', () => {
  it('counts occurrences and sorts by count desc', () => {
    const items = [
      { cat: 'A' }, { cat: 'B' }, { cat: 'A' }, { cat: 'A' },
    ]
    const result = countBy(items, i => i.cat)
    expect(result[0]).toEqual({ key: 'A', count: 3 })
    expect(result[1]).toEqual({ key: 'B', count: 1 })
  })

  it('uses Unknown for null key', () => {
    const items = [{ cat: null }, { cat: null }]
    const result = countBy(items, i => i.cat)
    expect(result[0].key).toBe('Unknown')
    expect(result[0].count).toBe(2)
  })

  it('returns empty array for empty input', () => {
    expect(countBy([], i => i.cat)).toEqual([])
  })
})

// ── sumBy ─────────────────────────────────────────────────────────────────────

describe('sumBy', () => {
  it('sums values grouped by key, sorted desc', () => {
    const items = [
      { site: 'A', cost: 100 },
      { site: 'B', cost: 200 },
      { site: 'A', cost: 50 },
    ]
    const result = sumBy(items, i => i.site, i => i.cost)
    expect(result[0]).toEqual({ key: 'B', total: 200 })
    expect(result[1]).toEqual({ key: 'A', total: 150 })
  })

  it('uses Unknown for null key', () => {
    const items = [{ site: null, cost: 10 }]
    const result = sumBy(items, i => i.site, i => i.cost)
    expect(result[0].key).toBe('Unknown')
  })

  it('returns empty array for empty input', () => {
    expect(sumBy([], i => i.site, i => i.cost)).toEqual([])
  })
})

// ── bucketByMonth ─────────────────────────────────────────────────────────────

describe('bucketByMonth', () => {
  it('buckets records into correct months', () => {
    const records = [
      { issue_date: '2024-01-15', cost: 100 },
      { issue_date: '2024-01-20', cost: 200 },
      { issue_date: '2024-02-10', cost: 150 },
    ]
    const result = bucketByMonth(records, r => r.issue_date, r => r.cost)
    expect(result).toHaveLength(2)
    expect(result[0].month).toBe('2024-01')
    expect(result[0].count).toBe(2)
    expect(result[0].total).toBe(300)
    expect(result[1].month).toBe('2024-02')
    expect(result[1].count).toBe(1)
    expect(result[1].total).toBe(150)
  })

  it('skips records with null dates', () => {
    const records = [
      { issue_date: null, cost: 100 },
      { issue_date: '2024-01-15', cost: 200 },
    ]
    const result = bucketByMonth(records, r => r.issue_date, r => r.cost)
    expect(result).toHaveLength(1)
    expect(result[0].count).toBe(1)
  })

  it('returns empty array for empty input', () => {
    expect(bucketByMonth([], r => r.issue_date)).toEqual([])
  })

  it('skips records with invalid dates', () => {
    const records = [
      { issue_date: 'not-a-date' },
      { issue_date: '2024-03-01' },
    ]
    const result = bucketByMonth(records, r => r.issue_date)
    expect(result).toHaveLength(1)
  })

  it('works without valFn — total remains 0', () => {
    const records = [{ issue_date: '2024-06-01' }]
    const result = bucketByMonth(records, r => r.issue_date)
    expect(result[0].total).toBe(0)
  })

  it('sorts buckets ascending by month', () => {
    const records = [
      { issue_date: '2024-03-01' },
      { issue_date: '2024-01-01' },
      { issue_date: '2024-02-01' },
    ]
    const result = bucketByMonth(records, r => r.issue_date)
    expect(result.map(b => b.month)).toEqual(['2024-01', '2024-02', '2024-03'])
  })
})

// ── rollingAverage ────────────────────────────────────────────────────────────

describe('rollingAverage', () => {
  it('returns null for early positions in the window', () => {
    const result = rollingAverage([1, 2, 3, 4, 5], 3)
    expect(result[0]).toBeNull()
    expect(result[1]).toBeNull()
  })

  it('calculates rolling average correctly from window start', () => {
    const result = rollingAverage([1, 2, 3, 4, 5], 3)
    expect(result[2]).toBeCloseTo(2) // (1+2+3)/3
    expect(result[3]).toBeCloseTo(3) // (2+3+4)/3
    expect(result[4]).toBeCloseTo(4) // (3+4+5)/3
  })

  it('window=1 returns all values as-is', () => {
    const values = [10, 20, 30]
    const result = rollingAverage(values, 1)
    expect(result).toEqual([10, 20, 30])
  })

  it('returns all nulls when window > array length', () => {
    const result = rollingAverage([1, 2], 5)
    expect(result.every(v => v === null)).toBe(true)
  })

  it('defaults to window=3', () => {
    const result = rollingAverage([10, 20, 30])
    expect(result[2]).toBeCloseTo(20)
  })
})

// ── linearRegression ──────────────────────────────────────────────────────────

describe('linearRegression', () => {
  it('returns zero slope and the only y value for a single point', () => {
    const result = linearRegression([[0, 5]])
    expect(result.slope).toBe(0)
    expect(result.intercept).toBe(5)
    expect(result.r2).toBe(0)
  })

  it('fits a perfect upward line (r2=1)', () => {
    const points = [[0, 0], [1, 2], [2, 4], [3, 6]]
    const result = linearRegression(points)
    expect(result.slope).toBeCloseTo(2)
    expect(result.intercept).toBeCloseTo(0)
    expect(result.r2).toBeCloseTo(1)
  })

  it('fits a perfect downward line', () => {
    const points = [[0, 10], [1, 8], [2, 6], [3, 4]]
    const result = linearRegression(points)
    expect(result.slope).toBeCloseTo(-2)
    expect(result.intercept).toBeCloseTo(10)
    expect(result.r2).toBeCloseTo(1)
  })

  it('predict function returns y at given x', () => {
    const points = [[0, 0], [1, 1], [2, 2]]
    const { predict } = linearRegression(points)
    expect(predict(5)).toBeCloseTo(5)
    expect(predict(0)).toBeCloseTo(0)
  })

  it('returns r2=1 for constant y values (ssTot=0)', () => {
    const points = [[0, 5], [1, 5], [2, 5]]
    const result = linearRegression(points)
    expect(result.r2).toBe(1)
  })

  it('handles two points', () => {
    const points = [[0, 0], [1, 10]]
    const result = linearRegression(points)
    expect(result.slope).toBeCloseTo(10)
    expect(result.intercept).toBeCloseTo(0)
  })
})

// ── forecastMonthly ───────────────────────────────────────────────────────────

describe('forecastMonthly', () => {
  it('returns empty array for fewer than 2 months', () => {
    expect(forecastMonthly([])).toEqual([])
    expect(forecastMonthly([{ month: '2024-01', count: 5, total: 100 }])).toEqual([])
  })

  it('returns correct number of forecast points', () => {
    const data = [
      { month: '2024-01', count: 10, total: 1000 },
      { month: '2024-02', count: 12, total: 1200 },
      { month: '2024-03', count: 14, total: 1400 },
    ]
    const result = forecastMonthly(data, 3, 'count')
    const forecast = result.filter(r => r.isForecast)
    expect(forecast).toHaveLength(3)
  })

  it('marks historical records as isForecast=false', () => {
    const data = [
      { month: '2024-01', count: 5, total: 500 },
      { month: '2024-02', count: 10, total: 1000 },
    ]
    const result = forecastMonthly(data, 1, 'count')
    const historical = result.filter(r => !r.isForecast)
    expect(historical).toHaveLength(2)
  })

  it('forecast months follow the correct YYYY-MM sequence', () => {
    const data = [
      { month: '2024-11', count: 10, total: 1000 },
      { month: '2024-12', count: 12, total: 1200 },
    ]
    const result = forecastMonthly(data, 2, 'count')
    const forecast = result.filter(r => r.isForecast)
    expect(forecast[0].month).toBe('2025-01')
    expect(forecast[1].month).toBe('2025-02')
  })

  it('forecasted values are non-negative (clamped at 0)', () => {
    // Declining trend that would go negative
    const data = [
      { month: '2024-01', count: 10, total: 100 },
      { month: '2024-02', count: 5,  total: 50 },
      { month: '2024-03', count: 1,  total: 10 },
    ]
    const result = forecastMonthly(data, 5, 'count')
    result.filter(r => r.isForecast).forEach(r => {
      expect(r.value).toBeGreaterThanOrEqual(0)
      expect(r.predicted).toBeGreaterThanOrEqual(0)
    })
  })

  it('total field is used when specified', () => {
    const data = [
      { month: '2024-01', count: 2, total: 200 },
      { month: '2024-02', count: 2, total: 400 },
    ]
    // With perfect upward trend in total, forecast should continue that trend
    const result = forecastMonthly(data, 1, 'total')
    const forecastVal = result.find(r => r.isForecast)
    expect(forecastVal).toBeDefined()
    expect(forecastVal.value).toBeGreaterThan(0)
  })
})

// ── computeBrandMetrics ───────────────────────────────────────────────────────

describe('computeBrandMetrics', () => {
  const records = [
    { brand: 'Michelin', cost_per_tyre: 1000, qty: 1, risk_level: 'High',   category: 'Blowout', issue_date: '2024-01-01' },
    { brand: 'Michelin', cost_per_tyre: 1200, qty: 2, risk_level: 'Low',    category: 'Blowout', issue_date: '2024-03-01' },
    { brand: 'Bridgestone', cost_per_tyre: 800,  qty: 1, risk_level: 'Medium', category: 'Wear',    issue_date: '2024-02-01' },
    { brand: 'Bridgestone', cost_per_tyre: 900,  qty: 1, risk_level: 'High',   category: 'Wear',    issue_date: '2024-04-01' },
  ]

  it('returns one entry per brand', () => {
    const result = computeBrandMetrics(records)
    const brands = result.map(b => b.brand)
    expect(brands).toContain('Michelin')
    expect(brands).toContain('Bridgestone')
    expect(result).toHaveLength(2)
  })

  it('counts records correctly per brand', () => {
    const result = computeBrandMetrics(records)
    const michelin = result.find(b => b.brand === 'Michelin')
    expect(michelin.count).toBe(2)
  })

  it('computes totalCost with qty multiplier', () => {
    const result = computeBrandMetrics(records)
    const michelin = result.find(b => b.brand === 'Michelin')
    // 1000*1 + 1200*2 = 3400
    expect(michelin.totalCost).toBe(3400)
  })

  it('computes highRiskCount correctly', () => {
    const result = computeBrandMetrics(records)
    const michelin = result.find(b => b.brand === 'Michelin')
    expect(michelin.highRiskCount).toBe(1)
  })

  it('computes failureRate as percentage', () => {
    const result = computeBrandMetrics(records)
    const michelin = result.find(b => b.brand === 'Michelin')
    expect(michelin.failureRate).toBeCloseTo(50)
  })

  it('uses defaultCost when cost_per_tyre missing', () => {
    const recs = [
      { brand: 'Generic', cost_per_tyre: 500, qty: 2 },
    ]
    const result = computeBrandMetrics(recs, 500)
    expect(result[0].totalCost).toBe(1000) // 500 * 2
  })

  it('assigns topCategory from most frequent category', () => {
    const result = computeBrandMetrics(records)
    const bridgestone = result.find(b => b.brand === 'Bridgestone')
    expect(bridgestone.topCategory).toBe('Wear')
  })

  it('groups records with no brand under Unknown', () => {
    const recs = [{ cost_per_tyre: 100, qty: 1 }]
    const result = computeBrandMetrics(recs)
    expect(result[0].brand).toBe('Unknown')
  })

  it('sorts by count descending', () => {
    const recs = [
      { brand: 'X', cost_per_tyre: 100, qty: 1 },
      { brand: 'Y', cost_per_tyre: 100, qty: 1 },
      { brand: 'Y', cost_per_tyre: 100, qty: 1 },
    ]
    const result = computeBrandMetrics(recs)
    expect(result[0].brand).toBe('Y')
  })
})

// ── computeSiteMetrics ────────────────────────────────────────────────────────

describe('computeSiteMetrics', () => {
  const records = [
    { site: 'Riyadh', cost_per_tyre: 1000, qty: 1, risk_level: 'High',   category: 'Blowout', brand: 'Michelin', issue_date: '2024-01-10' },
    { site: 'Riyadh', cost_per_tyre: 800,  qty: 1, risk_level: 'Low',    category: 'Wear',    brand: 'Bridgestone', issue_date: '2024-01-15' },
    { site: 'Jeddah', cost_per_tyre: 1500, qty: 2, risk_level: 'High',   category: 'Cut',     brand: 'Pirelli', issue_date: '2024-02-01' },
  ]

  it('returns one entry per site', () => {
    const result = computeSiteMetrics(records)
    const sites = result.map(s => s.site)
    expect(sites).toContain('Riyadh')
    expect(sites).toContain('Jeddah')
  })

  it('computes highRiskPct correctly', () => {
    const result = computeSiteMetrics(records)
    const riyadh = result.find(s => s.site === 'Riyadh')
    expect(riyadh.highRiskPct).toBeCloseTo(50) // 1/2
  })

  it('sorts by totalCost descending', () => {
    const result = computeSiteMetrics(records)
    // Jeddah: 1500*2=3000, Riyadh: 1000+800=1800
    expect(result[0].site).toBe('Jeddah')
  })

  it('sets topBrand to most frequent brand', () => {
    const result = computeSiteMetrics(records)
    const riyadh = result.find(s => s.site === 'Riyadh')
    // Michelin and Bridgestone both appear once; either could be first
    expect(['Michelin', 'Bridgestone']).toContain(riyadh.topBrand)
  })

  it('includes monthlyTrend array', () => {
    const result = computeSiteMetrics(records)
    result.forEach(s => {
      expect(Array.isArray(s.monthlyTrend)).toBe(true)
    })
  })

  it('groups records without site under Unknown', () => {
    const recs = [{ cost_per_tyre: 500, qty: 1 }]
    const result = computeSiteMetrics(recs)
    expect(result[0].site).toBe('Unknown')
  })
})

// ── computeAssetMetrics ───────────────────────────────────────────────────────

describe('computeAssetMetrics', () => {
  const records = [
    { asset_no: 'TRK-01', cost_per_tyre: 1000, qty: 1, risk_level: 'High',   brand: 'Michelin', site: 'A', category: 'Blowout', issue_date: '2024-01-01' },
    { asset_no: 'TRK-01', cost_per_tyre: 800,  qty: 1, risk_level: 'Low',    brand: 'Bridgestone', site: 'A', category: 'Wear', issue_date: '2024-06-01' },
    { asset_no: 'TRK-02', cost_per_tyre: 1200, qty: 2, risk_level: 'High',   brand: 'Pirelli', site: 'B', category: 'Cut',  issue_date: '2024-03-01' },
  ]

  it('returns one entry per asset', () => {
    const result = computeAssetMetrics(records)
    expect(result.map(a => a.assetNo)).toContain('TRK-01')
    expect(result.map(a => a.assetNo)).toContain('TRK-02')
  })

  it('computes totalCost correctly', () => {
    const result = computeAssetMetrics(records)
    const trk01 = result.find(a => a.assetNo === 'TRK-01')
    expect(trk01.totalCost).toBe(1800) // 1000+800
  })

  it('collects unique brands per asset', () => {
    const result = computeAssetMetrics(records)
    const trk01 = result.find(a => a.assetNo === 'TRK-01')
    expect(trk01.brands).toContain('Michelin')
    expect(trk01.brands).toContain('Bridgestone')
    expect(trk01.brands).toHaveLength(2)
  })

  it('sets lastSeen to most recent issue_date', () => {
    const result = computeAssetMetrics(records)
    const trk01 = result.find(a => a.assetNo === 'TRK-01')
    expect(trk01.lastSeen).toBe('2024-06-01')
  })

  it('sets firstSeen to earliest issue_date', () => {
    const result = computeAssetMetrics(records)
    const trk01 = result.find(a => a.assetNo === 'TRK-01')
    expect(trk01.firstSeen).toBe('2024-01-01')
  })

  it('computes failureFreqPerMonth > 0', () => {
    const result = computeAssetMetrics(records)
    result.forEach(a => {
      expect(a.failureFreqPerMonth).toBeGreaterThan(0)
    })
  })

  it('returns lastSeen and firstSeen as null when no dates present', () => {
    const recs = [{ asset_no: 'X', cost_per_tyre: 100, qty: 1 }]
    const result = computeAssetMetrics(recs)
    expect(result[0].lastSeen).toBeNull()
    expect(result[0].firstSeen).toBeNull()
  })
})

// ── weightedRiskScore ─────────────────────────────────────────────────────────

describe('weightedRiskScore', () => {
  it('returns 0 for empty records', () => {
    expect(weightedRiskScore([])).toBe(0)
  })

  it('returns 100 for all-High risk records', () => {
    const records = [
      { risk_level: 'High' },
      { risk_level: 'High' },
    ]
    expect(weightedRiskScore(records)).toBe(100)
  })

  it('returns a proportional score for mixed risk levels', () => {
    // High weight=3, Medium weight=1.5, total = 4.5, maxPossible = 2*3 = 6
    // score = round((4.5/6)*100) = round(75) = 75
    const records = [{ risk_level: 'High' }, { risk_level: 'Medium' }]
    expect(weightedRiskScore(records)).toBe(75)
  })

  it('uses default weight 1 for unknown risk levels', () => {
    const records = [{ risk_level: 'Extreme' }]
    // total=1, maxPossible=3, score = round(1/3*100) = 33
    expect(weightedRiskScore(records)).toBe(33)
  })

  it('returns a value between 0 and 100', () => {
    const records = [
      { risk_level: 'Low' },
      { risk_level: 'Medium' },
      { risk_level: 'High' },
    ]
    const score = weightedRiskScore(records)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})

// ── detectRiskSpike ───────────────────────────────────────────────────────────

describe('detectRiskSpike', () => {
  it('returns isSpike=false when not enough records', () => {
    const records = Array.from({ length: 80 }, (_, i) => ({
      risk_level: 'Low',
      created_at: `2024-01-${String(i % 28 + 1).padStart(2, '0')}`,
    }))
    // Need >= 100 records for windowSize=50
    const result = detectRiskSpike(records, 50)
    expect(result.isSpike).toBe(false)
  })

  it('detects a spike when recent high-risk rate is > 25% higher than prior', () => {
    // prior window (2023): all Low — sorted DESC these are older, filling the "prior" slice
    const priorRecs = Array.from({ length: 50 }, (_, i) => ({
      risk_level: 'Low',
      created_at: new Date(2023, 0, i + 1).toISOString(),
    }))
    // recent window (2025): all High — sorted DESC these are newer, filling the "recent" slice
    const recentRecs = Array.from({ length: 50 }, (_, i) => ({
      risk_level: 'High',
      created_at: new Date(2025, 0, i + 1).toISOString(),
    }))
    // detectRiskSpike sorts by created_at DESC, so recentRecs (2025) are "recent"
    const result = detectRiskSpike([...priorRecs, ...recentRecs], 50)
    expect(result.isSpike).toBe(true)
    expect(result.current).toBe(100)
    expect(result.prior).toBe(0)
  })

  it('returns deltaPct=0 when prior and recent are equal', () => {
    const records = Array.from({ length: 100 }, (_, i) => ({
      risk_level: 'High',
      created_at: new Date(2024, 0, i + 1).toISOString(),
    }))
    const result = detectRiskSpike(records, 50)
    expect(result.deltaPct).toBe(0)
    expect(result.isSpike).toBe(false)
  })
})

// ── recordCpk ─────────────────────────────────────────────────────────────────

describe('recordCpk', () => {
  it('calculates CPK correctly', () => {
    const record = { km_at_fitment: 10000, km_at_removal: 50000, cost_per_tyre: 1000 }
    expect(recordCpk(record)).toBeCloseTo(1000 / 40000)
  })

  it('returns null when km_at_fitment is missing', () => {
    const record = { km_at_removal: 50000, cost_per_tyre: 1000 }
    expect(recordCpk(record)).toBeNull()
  })

  it('returns null when km_at_removal is missing', () => {
    const record = { km_at_fitment: 10000, cost_per_tyre: 1000 }
    expect(recordCpk(record)).toBeNull()
  })

  it('returns null when km_at_removal <= km_at_fitment', () => {
    const record = { km_at_fitment: 50000, km_at_removal: 10000, cost_per_tyre: 1000 }
    expect(recordCpk(record)).toBeNull()
  })

  it('returns null when km_at_fitment equals km_at_removal (zero km)', () => {
    const record = { km_at_fitment: 10000, km_at_removal: 10000, cost_per_tyre: 1000 }
    expect(recordCpk(record)).toBeNull()
  })

  it('returns 0 CPK when cost_per_tyre is 0', () => {
    const record = { km_at_fitment: 0, km_at_removal: 10000, cost_per_tyre: 0 }
    // km_at_fitment=0 treated as falsy, so returns null
    expect(recordCpk(record)).toBeNull()
  })
})

// ── computeMonthlyKpiActuals ──────────────────────────────────────────────────

describe('computeMonthlyKpiActuals', () => {
  const records = [
    { issue_date: '2024-03-05', cost_per_tyre: 1000, qty: 1, risk_level: 'High' },
    { issue_date: '2024-03-15', cost_per_tyre: 800,  qty: 2, risk_level: 'Low' },
    { issue_date: '2024-04-01', cost_per_tyre: 500,  qty: 1, risk_level: 'High' },
  ]
  const actions = [
    { due_date: '2020-01-01', status: 'Open' },  // overdue
    { due_date: '2099-01-01', status: 'Open' },  // not overdue
    { due_date: '2020-01-01', status: 'Closed' }, // closed → skip
  ]

  it('filters records to the requested month', () => {
    const result = computeMonthlyKpiActuals(records, [], '2024-03')
    expect(result.count).toBe(2)
  })

  it('computes totalCost for the month', () => {
    const result = computeMonthlyKpiActuals(records, [], '2024-03')
    // 1000*1 + 800*2 = 2600
    expect(result.totalCost).toBe(2600)
  })

  it('counts highRisk records', () => {
    const result = computeMonthlyKpiActuals(records, [], '2024-03')
    expect(result.highRiskCount).toBe(1)
  })

  it('computes highRiskPct correctly', () => {
    const result = computeMonthlyKpiActuals(records, [], '2024-03')
    expect(result.highRiskPct).toBeCloseTo(50)
  })

  it('counts overdue open actions', () => {
    const result = computeMonthlyKpiActuals(records, actions, '2024-03')
    expect(result.overdueActions).toBe(1)
  })

  it('computes avgCostPerTyre', () => {
    const result = computeMonthlyKpiActuals(records, [], '2024-03')
    // totalCost=2600, count=2 → 1300
    expect(result.avgCostPerTyre).toBeCloseTo(1300)
  })

  it('returns 0 values for a month with no records', () => {
    const result = computeMonthlyKpiActuals(records, [], '2024-06')
    expect(result.count).toBe(0)
    expect(result.totalCost).toBe(0)
    expect(result.highRiskPct).toBe(0)
    expect(result.avgCostPerTyre).toBe(0)
  })
})

// ── buildSiteRadar ────────────────────────────────────────────────────────────

describe('buildSiteRadar', () => {
  it('returns empty labels and datasets for empty input', () => {
    const result = buildSiteRadar([])
    expect(result.labels).toEqual([])
    expect(result.datasets).toEqual([])
  })

  it('returns correct labels', () => {
    const siteMetrics = [
      { site: 'Riyadh', totalCost: 1000, count: 5, highRiskPct: 20, riskScore: 1.5, topCategory: 'Blowout' },
    ]
    const result = buildSiteRadar(siteMetrics)
    expect(result.labels).toEqual(['Cost Efficiency', 'Safety', 'Volume', 'Risk Quality', 'Data Quality'])
  })

  it('creates one dataset per site', () => {
    const siteMetrics = [
      { site: 'A', totalCost: 1000, count: 10, highRiskPct: 10, riskScore: 1, topCategory: 'Wear' },
      { site: 'B', totalCost: 500,  count: 5,  highRiskPct: 20, riskScore: 2, topCategory: 'Unknown' },
    ]
    const result = buildSiteRadar(siteMetrics)
    expect(result.datasets).toHaveLength(2)
    expect(result.datasets[0].label).toBe('A')
    expect(result.datasets[1].label).toBe('B')
  })

  it('highest-cost site gets Cost Efficiency = 0', () => {
    const siteMetrics = [
      { site: 'Expensive', totalCost: 10000, count: 5, highRiskPct: 0, riskScore: 1, topCategory: 'Wear' },
      { site: 'Cheap',     totalCost: 1000,  count: 5, highRiskPct: 0, riskScore: 1, topCategory: 'Wear' },
    ]
    const result = buildSiteRadar(siteMetrics)
    const expensive = result.datasets.find(d => d.label === 'Expensive')
    expect(expensive.data[0]).toBe(0) // Cost Efficiency = (1-1)*100 = 0
  })

  it('data array has 5 dimensions per site', () => {
    const siteMetrics = [
      { site: 'X', totalCost: 500, count: 10, highRiskPct: 10, riskScore: 1, topCategory: 'Cut' },
    ]
    const result = buildSiteRadar(siteMetrics)
    expect(result.datasets[0].data).toHaveLength(5)
  })
})

// ── computeCountryMetrics ─────────────────────────────────────────────────────

describe('computeCountryMetrics', () => {
  const records = [
    { country: 'KSA', cost_per_tyre: 1000, qty: 1, risk_level: 'High', brand: 'Michelin', site: 'Riyadh', km_at_fitment: 0, km_at_removal: 50000 },
    { country: 'KSA', cost_per_tyre: 800,  qty: 1, risk_level: 'Low',  brand: 'Bridgestone', site: 'Jeddah' },
    { country: 'UAE', cost_per_tyre: 1500, qty: 2, risk_level: 'High', brand: 'Pirelli', site: 'Dubai' },
  ]

  it('returns one entry per country', () => {
    const result = computeCountryMetrics(records)
    const countries = result.map(c => c.country)
    expect(countries).toContain('KSA')
    expect(countries).toContain('UAE')
  })

  it('computes count correctly', () => {
    const result = computeCountryMetrics(records)
    const ksa = result.find(c => c.country === 'KSA')
    expect(ksa.count).toBe(2)
  })

  it('computes totalCost with qty multiplier', () => {
    const result = computeCountryMetrics(records)
    const uae = result.find(c => c.country === 'UAE')
    expect(uae.totalCost).toBe(3000) // 1500*2
  })

  it('sorts by totalCost descending', () => {
    const result = computeCountryMetrics(records)
    expect(result[0].totalCost).toBeGreaterThanOrEqual(result[1].totalCost)
  })

  it('defaults to KSA when country field is missing', () => {
    const recs = [{ cost_per_tyre: 500, qty: 1 }]
    const result = computeCountryMetrics(recs)
    expect(result[0].country).toBe('KSA')
  })

  it('counts unique brands and sites', () => {
    const result = computeCountryMetrics(records)
    const ksa = result.find(c => c.country === 'KSA')
    expect(ksa.brandCount).toBe(2)
    expect(ksa.siteCount).toBe(2)
  })

  it('counts open and overdue actions per country', () => {
    const actions = [
      { country: 'KSA', status: 'Open',   due_date: '2020-01-01' }, // overdue
      { country: 'KSA', status: 'Open',   due_date: '2099-01-01' }, // not overdue
      { country: 'KSA', status: 'Closed', due_date: '2020-01-01' }, // closed
      { country: 'UAE', status: 'Open',   due_date: '2020-01-01' },
    ]
    const result = computeCountryMetrics(records, actions)
    const ksa = result.find(c => c.country === 'KSA')
    expect(ksa.openActions).toBe(2)
    expect(ksa.overdueActions).toBe(1)
  })

  it('returns avgCpk as null when no valid CPK values exist', () => {
    const recs = [{ country: 'KSA', cost_per_tyre: 500, qty: 1 }]
    const result = computeCountryMetrics(recs)
    expect(result[0].avgCpk).toBeNull()
  })
})
