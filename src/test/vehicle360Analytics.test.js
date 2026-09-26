import { describe, it, expect } from 'vitest'
import {
  num, costByCurrency, monthlyCost, workOrderSummary, accidentSummary, inspectionSummary,
  meterSummary, tyreSummary, insuranceSummary, activityRows, filterActivity, sortActivity, buildVehicle360,
} from '../lib/vehicle360Analytics'

const NOW = Date.parse('2026-09-26T10:00:00Z')

describe('vehicle360Analytics', () => {
  it('num returns null for blanks, not zero', () => {
    expect(num('')).toBeNull()
    expect(num(null)).toBeNull()
    expect(num('12.5')).toBe(12.5)
  })

  it('never adds currencies together', () => {
    const c = costByCurrency([
      { currency: 'SAR', tyre_cost: 100, spare_cost: 50, oil_cost: 0, line_cost: 150 },
      { currency: 'AED', tyre_cost: 10, spare_cost: 0, oil_cost: 5, line_cost: 15 },
      { currency: 'SAR', tyre_cost: 0, spare_cost: 20, oil_cost: 0, line_cost: 20 },
    ])
    expect(c).toHaveLength(2)
    expect(c[0]).toMatchObject({ currency: 'SAR', tyre: 100, spare: 70, total: 170, lines: 2 })
    expect(c[1]).toMatchObject({ currency: 'AED', total: 15 })
  })

  it('withholds the chart when more than one currency is present', () => {
    const r = buildVehicle360({ partsLines: [{ currency: 'SAR', line_cost: 1 }, { currency: 'EGP', line_cost: 1 }], now: NOW })
    expect(r.chartCurrency).toBeNull()
    expect(buildVehicle360({ partsLines: [{ currency: 'SAR', line_cost: 1 }], now: NOW }).chartCurrency).toBe('SAR')
  })

  it('buckets monthly cost for one currency only', () => {
    const s = monthlyCost([
      { currency: 'SAR', event_date: '2026-09-02', tyre_cost: 10, spare_cost: 3, oil_cost: 2 },
      { currency: 'AED', event_date: '2026-09-02', tyre_cost: 99 },
      { currency: 'SAR', event_date: '2024-01-01', tyre_cost: 99 },
    ], 'SAR', { now: NOW, months: 12 })
    expect(s.labels).toHaveLength(12)
    expect(s.labels[11]).toBe('2026-09')
    expect(s.tyre[11]).toBe(10)
    expect(s.other[11]).toBe(5)
    expect(s.tyre.reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('summarizes work orders with breakdown hours only from closed cards', () => {
    const w = workOrderSummary([
      { status: 'Open', opened_at: '2026-09-01', breakdown_hours: 40000 },
      { status: 'Closed', opened_at: '2026-08-01', breakdown_hours: 12 },
    ])
    expect(w).toMatchObject({ total: 2, open: 1, closed: 1, lastOpened: '2026-09-01', breakdownHours: 12 })
    expect(workOrderSummary([]).breakdownHours).toBeNull()
  })

  it('summarizes accidents and inspections', () => {
    const a = accidentSummary([{ status: 'closed', incident_date: '2026-01-01', severity: 'severe' }, { status: 'reported', incident_date: '2026-03-01', severity: 'minor' }])
    expect(a).toMatchObject({ total: 2, open: 1, lastIncident: '2026-03-01' })
    const i = inspectionSummary([{ inspection_date: '2026-09-20', inspector: 'A' }, { inspection_date: '2026-09-01' }], { now: NOW })
    expect(i).toMatchObject({ total: 2, lastDate: '2026-09-20', lastInspector: 'A', daysSince: 6 })
    expect(inspectionSummary([], { now: NOW }).daysSince).toBeNull()
  })

  it('takes the higher of register km and latest reading, and reports hours honestly', () => {
    const m = meterSummary({ current_km: 5000 }, [{ odometer_km: 4800, reading_date: '2026-09-01' }], [])
    expect(m.currentKm).toBe(5000)
    expect(m.kmDate).toBe('2026-09-01')
    expect(m.engineHours).toBeNull()
    expect(meterSummary(null, [], []).currentKm).toBeNull()
  })

  it('counts fitted vs removed tyres', () => {
    expect(tyreSummary([{ removal_date: null }, { removal_date: '2026-01-01' }])).toEqual({ total: 2, fitted: 1, removed: 1 })
  })

  it('classifies insurance lines by cover window, sum insured per currency', () => {
    const s = insuranceSummary([
      { cover_from: '2026-01-01', cover_to: '2026-12-31', sum_insured: 100, currency: 'SAR' },
      { cover_from: '2025-01-01', cover_to: '2025-12-31', sum_insured: 999, currency: 'SAR' },
      { cover_from: '2027-01-01', cover_to: '2027-12-31', sum_insured: 5, currency: 'SAR' },
    ], { now: NOW })
    expect(s).toMatchObject({ lines: 3, active: 1, expired: 1, upcoming: 1, nextExpiry: '2026-12-31' })
    expect(s.sumInsured).toEqual([{ currency: 'SAR', amount: 100 }])
    expect(s.daysToExpiry).toBe(96)
  })

  it('builds, filters and sorts a unified activity list', () => {
    const rows = activityRows({
      jobCards: [{ id: 1, opened_at: '2026-09-01', work_order_no: 'JC1', description: 'Brake', status: 'Open' }],
      tyres: [{ id: 2, issue_date: '2026-08-01', serial_no: 'S1', position: 'LHF1' }],
      partsLines: [{ id: 3, event_date: '2026-07-01', line_cost: 50, currency: 'SAR', item_description: 'Filter' }],
    })
    expect(rows).toHaveLength(3)
    expect(filterActivity(rows, { type: 'tyre' })).toHaveLength(1)
    expect(filterActivity(rows, { search: 'brake' })).toHaveLength(1)
    expect(filterActivity(rows, { from: '2026-08-01' })).toHaveLength(2)
    expect(sortActivity(rows, 'date', 'asc')[0].type).toBe('expense')
    expect(sortActivity(rows, 'amount', 'desc')[0].amount).toBe(50)
  })
})
