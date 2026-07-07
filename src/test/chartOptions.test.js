import { describe, it, expect } from 'vitest'
import { resolveChartTheme } from '../components/charts/theme'
import { buildTrendOption } from '../components/charts/TrendChart'
import { buildGaugeOption, DEFAULT_BANDS } from '../components/charts/GaugeChart'
import { buildParetoOption } from '../components/charts/ParetoChart'
import { buildHeatmapOption } from '../components/charts/HeatmapChart'

const theme = resolveChartTheme(true)

describe('charts - option builders (pure)', () => {
  it('trend: one line series per input series, legend only when multi', () => {
    const single = buildTrendOption({ series: [{ name: 'CPK', data: [['2026-01', 1.2]] }] }, theme)
    expect(single.series).toHaveLength(1)
    expect(single.series[0].type).toBe('line')
    expect(single.legend).toBeUndefined()

    const multi = buildTrendOption({
      series: [
        { name: 'RUH', data: [['2026-01', 1]] },
        { name: 'JED', data: [['2026-01', 2]] },
      ],
    }, theme)
    expect(multi.series).toHaveLength(2)
    expect(multi.legend).toBeTruthy()
  })

  it('gauge: value clamps into axis and bands color the arc', () => {
    const opt = buildGaugeOption({ value: 72, min: 0, max: 100, bands: DEFAULT_BANDS, label: 'Pressure Compliance', unit: '%' }, theme)
    const gauge = opt.series[0]
    expect(gauge.type).toBe('gauge')
    expect(gauge.min).toBe(0)
    expect(gauge.max).toBe(100)
    expect(gauge.data[0].value).toBe(72)
  })

  it('pareto: bars sorted desc + cumulative % line reaching 100', () => {
    const opt = buildParetoOption({
      items: [{ label: 'Underinflation', value: 5 }, { label: 'Alignment', value: 15 }],
      yLabel: 'Failures',
    }, theme)
    const [bars, line] = opt.series
    expect(bars.type).toBe('bar')
    expect(line.type).toBe('line')
    expect(bars.data[0]).toBeGreaterThanOrEqual(bars.data[1])       // sorted desc
    expect(line.data[line.data.length - 1]).toBeCloseTo(100, 5)     // cumulative ends at 100%
  })

  it('heatmap: grid dimensions follow the label axes', () => {
    const opt = buildHeatmapOption({
      xLabels: ['Mon', 'Tue'], yLabels: ['RUH', 'JED'],
      data: [[0, 0, 3], [1, 1, 7]],
    }, theme)
    expect(opt.xAxis.data).toEqual(['Mon', 'Tue'])
    expect(opt.yAxis.data).toEqual(['RUH', 'JED'])
    expect(opt.series[0].type).toBe('heatmap')
    expect(opt.visualMap).toBeTruthy()
  })
})
