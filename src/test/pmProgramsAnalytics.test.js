import { describe, it, expect } from 'vitest'
import {
  sumPartsCost, intervalSummary, filterPlans, filterHistory, dueSortValue, historySummary,
  planExportRows, historyExportRows, PLAN_EXPORT_COLS, HIST_EXPORT_COLS,
} from '../lib/pmProgramsAnalytics'

const plan = (o) => ({ id: 1, name: 'Oil change', asset_no: 'TM1', status: 'active', _st: { band: 'scheduled', daysToDue: 20 }, ...o })

describe('pmProgramsAnalytics', () => {
  it('sums parts cost with a default qty of 1', () => {
    expect(sumPartsCost([{ qty: 2, cost: 10.555 }, { cost: 5 }, { qty: 0, cost: 1 }])).toBe(27.11)
    expect(sumPartsCost(null)).toBe(0)
  })

  it('summarises time and meter intervals', () => {
    expect(intervalSummary({ interval_value: 6, interval_type: 'months', meter_source: 'odometer', meter_interval: 10000 }).map(i => i.text))
      .toEqual(['6 months', 'every 10,000 km'])
    expect(intervalSummary({})).toEqual([])
  })

  it('filters plans by search, status, category and due-only', () => {
    const rows = [
      plan({ id: 1 }),
      plan({ id: 2, name: 'Generator', asset_category: 'generator', status: 'paused', _st: { band: 'overdue', daysToDue: -3 } }),
    ]
    expect(filterPlans(rows, { search: 'gener' }).map(r => r.id)).toEqual([2])
    expect(filterPlans(rows, { status: 'active' }).map(r => r.id)).toEqual([1])
    expect(filterPlans(rows, { category: 'generator' }).map(r => r.id)).toEqual([2])
    expect(filterPlans(rows, { dueOnly: true }).map(r => r.id)).toEqual([2])
  })

  it('orders due status overdue first, then soonest, then undated', () => {
    const keys = [
      { band: 'scheduled', daysToDue: 5 }, { band: 'overdue', daysToDue: -10 },
      { band: 'none', daysToDue: null }, { band: 'due_soon', daysToDue: 2 },
    ].map(dueSortValue)
    const order = keys.map((k, i) => [k, i]).sort((a, b) => a[0] - b[0]).map(x => x[1])
    expect(order).toEqual([1, 3, 0, 2])
  })

  const hist = [
    { id: 'a', asset_no: 'TM1', pm_program_id: 1, outcome: 'completed', service_date: '2026-01-10', total_cost: 100, work_order_no: 'WO1' },
    { id: 'b', asset_no: 'TM2', pm_program_id: 2, outcome: 'deferred', service_date: '2026-03-10', total_cost: null },
    { id: 'c', asset_no: 'TM1', pm_program_id: 1, outcome: 'completed', service_date: null, total_cost: 300 },
  ]

  it('filters history and excludes undated rows only when a range is set', () => {
    expect(filterHistory(hist, { asset: 'tm1' }).map(r => r.id)).toEqual(['a', 'c'])
    expect(filterHistory(hist, { program: '2' }).map(r => r.id)).toEqual(['b'])
    expect(filterHistory(hist, { outcome: 'completed', from: '2026-01-01' }).map(r => r.id)).toEqual(['a'])
    expect(filterHistory(hist, { to: '2026-02-01' }).map(r => r.id)).toEqual(['a'])
  })

  it('summarises service history with honest nulls', () => {
    const s = historySummary(hist)
    expect(s).toMatchObject({ services: 3, assets: 2, totalCost: 400, avgCost: 200, withWorkOrder: 1 })
    expect(s.costedShare).toBeCloseTo(2 / 3)
    expect(historySummary([])).toMatchObject({ services: 0, totalCost: null, avgCost: null, costedShare: null })
  })

  it('shapes export rows to the declared columns', () => {
    const p = planExportRows([plan({ priority: 'high', meter_source: 'odometer', next_due_meter: 5000 })])[0]
    expect(Object.keys(p)).toEqual(PLAN_EXPORT_COLS)
    expect(p.next_due_meter).toBe('5000 km')
    const h = historyExportRows(hist, new Map([['1', 'Oil change']]))[0]
    expect(Object.keys(h)).toEqual(HIST_EXPORT_COLS)
    expect(h.plan).toBe('Oil change')
  })
})
