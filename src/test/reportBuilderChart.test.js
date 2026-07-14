import { describe, it, expect } from 'vitest'
import {
  CHART_TYPES, CHART_TYPE_KEYS, CHART_PALETTE, MAX_CHART_POINTS,
  applyAggregations, buildReportChartData, chartMetricOptions, validateConfig,
} from '../lib/reportBuilder'

// Build a real aggregation result to feed the chart shaper, using the tyres
// dataset (has numeric columns) grouped by a text column.
function aggFixture(rows, group) {
  const config = { dataset: 'tyres', columns: ['brand'], group }
  return applyAggregations(rows, config)
}

describe('reportBuilder chart constants', () => {
  it('exposes 4 chart types with stable keys', () => {
    expect(CHART_TYPES.map(t => t.key)).toEqual(['bar', 'line', 'pie', 'hbar'])
    expect(CHART_TYPE_KEYS).toContain('hbar')
  })
  it('palette is non-empty hex colours', () => {
    expect(CHART_PALETTE.length).toBeGreaterThan(3)
    for (const c of CHART_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('chartMetricOptions', () => {
  it('returns count plus each numeric aggregate', () => {
    const agg = aggFixture(
      [
        { brand: 'Michelin', total_amount: 100 },
        { brand: 'Michelin', total_amount: 300 },
        { brand: 'Bridgestone', total_amount: 200 },
      ],
      { by: 'brand', metrics: [{ col: 'total_amount', fn: 'sum' }] },
    )
    const opts = chartMetricOptions(agg)
    const keys = opts.map(o => o.key)
    expect(keys).toContain('count')
    expect(keys).toContain('sum_total_amount')
  })
  it('returns [] for null aggregation', () => {
    expect(chartMetricOptions(null)).toEqual([])
  })
})

describe('buildReportChartData', () => {
  const rows = [
    { brand: 'Michelin', total_amount: 100 },
    { brand: 'Michelin', total_amount: 300 },
    { brand: 'Bridgestone', total_amount: 200 },
    { brand: '', total_amount: 50 },
  ]
  const agg = aggFixture(rows, { by: 'brand', metrics: [{ col: 'total_amount', fn: 'sum' }] })

  it('plots the count series by default and labels blanks', () => {
    const chart = buildReportChartData(agg, { type: 'bar', metric: 'count' })
    expect(chart).not.toBeNull()
    expect(chart.type).toBe('bar')
    expect(chart.metricKey).toBe('count')
    // Michelin has 2 rows -> sorted first with count 2.
    expect(chart.data.labels[0]).toBe('Michelin')
    expect(chart.data.datasets[0].data[0]).toBe(2)
    // Empty group value renders as (blank), never a raw dash.
    expect(chart.data.labels).toContain('(blank)')
  })

  it('plots a sum aggregate series when requested', () => {
    const chart = buildReportChartData(agg, { type: 'hbar', metric: 'sum_total_amount' })
    expect(chart.type).toBe('hbar')
    expect(chart.metricKey).toBe('sum_total_amount')
    const mi = chart.data.labels.indexOf('Michelin')
    expect(chart.data.datasets[0].data[mi]).toBe(400) // 100 + 300
  })

  it('pie datasets get a per-slice colour array', () => {
    const chart = buildReportChartData(agg, { type: 'pie', metric: 'count' })
    expect(chart.type).toBe('pie')
    expect(Array.isArray(chart.data.datasets[0].backgroundColor)).toBe(true)
    expect(chart.data.datasets[0].backgroundColor.length).toBe(chart.data.labels.length)
  })

  it('falls back to bar + count for an unknown type/metric', () => {
    const chart = buildReportChartData(agg, { type: 'nope', metric: 'ghost' })
    expect(chart.type).toBe('bar')
    expect(chart.metricKey).toBe('count')
  })

  it('caps plotted points at MAX_CHART_POINTS', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ brand: `B${i}`, total_amount: i }))
    const bigAgg = aggFixture(many, { by: 'brand', metrics: [] })
    const chart = buildReportChartData(bigAgg, { type: 'bar', metric: 'count' })
    expect(chart.data.labels.length).toBe(MAX_CHART_POINTS)
  })

  it('returns null when there are no rows', () => {
    const emptyAgg = aggFixture([], { by: 'brand', metrics: [] })
    expect(buildReportChartData(emptyAgg, { type: 'bar', metric: 'count' })).toBeNull()
  })

  it('returns null when aggregation is null', () => {
    expect(buildReportChartData(null, { type: 'bar', metric: 'count' })).toBeNull()
  })
})

describe('validateConfig chart clause', () => {
  it('keeps a valid chart on a grouped config', () => {
    const { valid, config } = validateConfig({
      dataset: 'tyres', columns: ['brand'],
      group: { by: 'brand', metrics: [{ col: 'total_amount', fn: 'sum' }] },
      chart: { type: 'pie', metric: 'sum_total_amount' },
    })
    expect(valid).toBe(true)
    expect(config.chart).toEqual({ type: 'pie', metric: 'sum_total_amount' })
  })

  it('defaults to null chart when omitted (backward compatible)', () => {
    const { valid, config } = validateConfig({ dataset: 'tyres', columns: ['brand'] })
    expect(valid).toBe(true)
    expect(config.chart).toBeNull()
  })

  it('rejects a chart without a group-by', () => {
    const { valid, errors } = validateConfig({
      dataset: 'tyres', columns: ['brand'],
      chart: { type: 'bar', metric: 'count' },
    })
    expect(valid).toBe(false)
    expect(errors.join(' ')).toMatch(/group/i)
  })

  it('rejects an unknown chart type', () => {
    const { valid, errors } = validateConfig({
      dataset: 'tyres', columns: ['brand'],
      group: { by: 'brand', metrics: [] },
      chart: { type: 'sankey', metric: 'count' },
    })
    expect(valid).toBe(false)
    expect(errors.join(' ')).toMatch(/chart type/i)
  })

  it('coerces an invalid metric to count', () => {
    const { valid, config } = validateConfig({
      dataset: 'tyres', columns: ['brand'],
      group: { by: 'brand', metrics: [] },
      chart: { type: 'bar', metric: 'sum_missing' },
    })
    expect(valid).toBe(true)
    expect(config.chart.metric).toBe('count')
  })
})
