import { describe, it, expect } from 'vitest'
import {
  categorical, withAlpha, fmtInt, fmtCompact, hasData,
  donutOption, hBarOption, vBarOption, gaugeOption, lineAreaOption, comboOption,
  tyreRiskItems, inspectionStatusItems, alertSeverityItems, countBy,
} from './displayCharts'

describe('displayCharts helpers', () => {
  it('categorical cycles the palette', () => {
    expect(categorical(3)).toHaveLength(3)
    expect(categorical(12)).toHaveLength(12)
    expect(categorical(12)[10]).toBe(categorical(12)[0]) // cycles at 10
    expect(categorical(0)).toEqual([])
  })

  it('withAlpha converts hex to rgba, passes through non-hex', () => {
    expect(withAlpha('#38bdf8', 0.5)).toBe('rgba(56,189,248,0.5)')
    expect(withAlpha('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)')
  })

  it('fmtInt / fmtCompact handle numbers and junk', () => {
    expect(fmtInt(1234.6)).toBe('1,235')
    expect(fmtInt('x')).toBe('0')
    expect(fmtCompact(2_500_000)).toBe('2.5M')
    expect(fmtCompact(34_500)).toBe('34.5K')
    expect(fmtCompact(812)).toBe('812')
    expect(fmtCompact(NaN)).toBe('0')
  })

  it('hasData is true only with a positive value', () => {
    expect(hasData([{ value: 0 }, { value: 3 }])).toBe(true)
    expect(hasData([{ value: 0 }, { value: 0 }])).toBe(false)
    expect(hasData([])).toBe(false)
    expect(hasData(null)).toBe(false)
  })
})

describe('displayCharts option builders', () => {
  const items = [{ label: 'A', value: 3 }, { label: 'B', value: 5, color: '#ef4444' }]

  it('donutOption honors per-item colour and falls back to palette', () => {
    const o = donutOption(items)
    expect(o.series[0].type).toBe('pie')
    expect(o.series[0].data[1].itemStyle.color).toBe('#ef4444') // explicit
    expect(o.series[0].data[0].itemStyle.color).toBe(categorical(2)[0]) // fallback
  })

  it('hBarOption / vBarOption build bar series with data', () => {
    expect(hBarOption(items).series[0].type).toBe('bar')
    expect(hBarOption(items).yAxis.data).toEqual(['A', 'B'])
    expect(vBarOption(items).xAxis.data).toEqual(['A', 'B'])
  })

  it('gaugeOption clamps value and flips band with invert', () => {
    const g = gaugeOption(87, { label: 'Available' })
    expect(g.series[0].type).toBe('gauge')
    expect(g.series[0].data[0].value).toBe(87)
    expect(gaugeOption(1, {}).series[0].axisLine.lineStyle.color.at(-1)[1]).toBe('#22c55e')
    expect(gaugeOption(1, { invert: true }).series[0].axisLine.lineStyle.color.at(-1)[1]).toBe('#ef4444')
    expect(gaugeOption('bad', {}).series[0].data[0].value).toBe(0)
  })

  it('lineAreaOption + comboOption build the expected series shapes', () => {
    const la = lineAreaOption(['Jan', 'Feb'], [{ name: 'X', data: [1, 2] }])
    expect(la.series[0].type).toBe('line')
    expect(la.xAxis.data).toEqual(['Jan', 'Feb'])
    const c = comboOption(['Jan'], [10], [2])
    expect(c.series[0].type).toBe('bar')
    expect(c.series[1].type).toBe('line')
    expect(c.series[1].yAxisIndex).toBe(1)
  })
})

describe('displayCharts data shapers', () => {
  it('tyreRiskItems splits Critical/High/OK, empty when no tyres', () => {
    expect(tyreRiskItems({ total: 100, critical: 5, high: 15 })).toEqual([
      { label: 'Critical', value: 5, color: '#ef4444' },
      { label: 'High', value: 15, color: '#f97316' },
      { label: 'OK', value: 80, color: '#22c55e' },
    ])
    expect(tyreRiskItems({ total: 0 })).toEqual([])
    expect(tyreRiskItems({ total: 4, critical: 3, high: 3 })[2].value).toBe(0)
  })

  it('inspectionStatusItems + alertSeverityItems map to coloured items', () => {
    const insp = inspectionStatusItems({ done: 2, pending: 1, overdue: 0 })
    expect(insp.map((i) => i.value)).toEqual([2, 1, 0])
    const sev = alertSeverityItems({ Critical: 2, High: 1 })
    expect(sev).toHaveLength(5)
    expect(sev[0]).toEqual({ label: 'Critical', value: 2, color: '#ef4444' })
    expect(sev[3].value).toBe(0)
  })

  it('countBy groups, folds blanks, sorts desc, caps at top', () => {
    const rows = [
      { site: 'A' }, { site: 'A' }, { site: 'B' }, { site: '' }, { site: null },
    ]
    const out = countBy(rows, (r) => r.site, { top: 2, fallback: 'Unknown' })
    expect(out[0]).toEqual({ label: 'A', value: 2 })
    expect(out).toHaveLength(2)
    const full = countBy(rows, (r) => r.site)
    expect(full.find((x) => x.label === 'Unknown').value).toBe(2)
  })
})
