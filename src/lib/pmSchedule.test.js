import { describe, it, expect } from 'vitest'
import {
  METER_DUE_SOON,
  addTimeInterval,
  meterToDue,
  meterDueStatus,
  resolveMeter,
  pmAssetDueStatus,
  advanceSchedule,
  summarizePmCompliance,
} from './pmSchedule'

const NOW = '2026-07-16T00:00:00Z'

describe('addTimeInterval', () => {
  it('adds calendar months keeping day-of-month, clamping overflow', () => {
    expect(addTimeInterval('2026-01-31', 'months', 1)).toBe('2026-02-28') // clamp, non-leap
    expect(addTimeInterval('2024-01-31', 'months', 1)).toBe('2024-02-29') // clamp, leap
    expect(addTimeInterval('2026-07-16', 'months', 6)).toBe('2027-01-16') // year rollover
    expect(addTimeInterval('2026-12-15', 'months', 1)).toBe('2027-01-15')
  })
  it('adds days on the calendar', () => {
    expect(addTimeInterval('2026-07-16', 'days', 10)).toBe('2026-07-26')
    expect(addTimeInterval('2026-07-25', 'days', 10)).toBe('2026-08-04') // month rollover
  })
  it('truncates the interval value to an integer', () => {
    expect(addTimeInterval('2026-07-16', 'months', 1.9)).toBe('2026-08-16')
    expect(addTimeInterval('2026-07-16', 'days', 5.7)).toBe('2026-07-21')
  })
  it('only advances for days / months with a positive integer value', () => {
    expect(addTimeInterval('2026-07-16', 'km', 5000)).toBeNull()
    expect(addTimeInterval('2026-07-16', 'hours', 250)).toBeNull()
    expect(addTimeInterval('2026-07-16', 'months', 0)).toBeNull()
    expect(addTimeInterval('2026-07-16', 'days', -3)).toBeNull()
    expect(addTimeInterval('not-a-date', 'months', 1)).toBeNull()
  })
})

describe('meterToDue / meterDueStatus', () => {
  const odo = { meter_source: 'odometer', next_due_meter: 10000 }
  const eng = { meter_source: 'engine_hours', next_due_meter: 1000 }

  it('computes units remaining, null when no axis / reading / target', () => {
    expect(meterToDue(odo, 9800)).toBe(200)
    expect(meterToDue({ meter_source: 'none' }, 9800)).toBeNull()
    expect(meterToDue(odo, null)).toBeNull()
    expect(meterToDue({ meter_source: 'odometer' }, 9800)).toBeNull() // no next_due_meter
  })
  it('bands the odometer axis at the 500 km threshold', () => {
    expect(METER_DUE_SOON.odometer).toBe(500)
    expect(meterDueStatus(odo, 10001)).toBe('overdue')
    expect(meterDueStatus(odo, 10000)).toBe('due_soon') // remaining 0
    expect(meterDueStatus(odo, 9500)).toBe('due_soon') // remaining 500 == threshold
    expect(meterDueStatus(odo, 9499)).toBe('scheduled') // remaining 501
  })
  it('bands the engine-hours axis at the 25 h threshold', () => {
    expect(METER_DUE_SOON.engine_hours).toBe(25)
    expect(meterDueStatus(eng, 980)).toBe('due_soon') // remaining 20
    expect(meterDueStatus(eng, 975)).toBe('due_soon') // remaining 25
    expect(meterDueStatus(eng, 970)).toBe('scheduled') // remaining 30
  })
  it('returns none when there is no meter axis', () => {
    expect(meterDueStatus({ meter_source: 'none' }, 5)).toBe('none')
  })
})

describe('resolveMeter', () => {
  it('reads the matching axis', () => {
    expect(resolveMeter({ meter_source: 'odometer' }, { currentKm: 1234, currentHours: 50 }))
      .toEqual({ currentMeter: 1234, unit: 'km', source: 'odometer' })
    expect(resolveMeter({ meter_source: 'engine_hours' }, { currentKm: 1234, currentHours: 50 }))
      .toEqual({ currentMeter: 50, unit: 'h', source: 'engine_hours' })
  })
  it('maps legacy interval_type km / hours when meter_source is none', () => {
    expect(resolveMeter({ meter_source: 'none', interval_type: 'km' }, { currentKm: 800 }))
      .toEqual({ currentMeter: 800, unit: 'km', source: 'odometer' })
    expect(resolveMeter({ interval_type: 'hours' }, { currentHours: 42 }))
      .toEqual({ currentMeter: 42, unit: 'h', source: 'engine_hours' })
  })
  it('returns a null reading when there is no axis or no reading', () => {
    expect(resolveMeter({ meter_source: 'none', interval_type: 'days' }, {}))
      .toEqual({ currentMeter: null, unit: '', source: 'none' })
    expect(resolveMeter({ meter_source: 'odometer' }, {}))
      .toEqual({ currentMeter: null, unit: 'km', source: 'odometer' })
  })
})

describe('pmAssetDueStatus', () => {
  it('takes the worst of the date and meter axes', () => {
    // Date is far out (scheduled) but the odometer is overdue -> band overdue.
    const plan = { status: 'active', next_due: '2027-01-01', meter_source: 'odometer', next_due_meter: 5000 }
    const st = pmAssetDueStatus(plan, { now: NOW, currentKm: 6000 })
    expect(st.dateBand).toBe('scheduled')
    expect(st.meterBand).toBe('overdue')
    expect(st.band).toBe('overdue')
    expect(st.meterRemaining).toBe(-1000)
    expect(st.unit).toBe('km')
  })
  it('bands on date alone when there is no meter axis', () => {
    const plan = { status: 'active', next_due: '2026-07-01', meter_source: 'none' }
    const st = pmAssetDueStatus(plan, { now: NOW })
    expect(st.dateBand).toBe('overdue')
    expect(st.meterBand).toBe('none')
    expect(st.band).toBe('overdue')
  })
})

describe('advanceSchedule', () => {
  it('mirrors the SQL RPC for date + meter advance', () => {
    const plan = {
      interval_type: 'months', interval_value: 6, next_due: '2026-07-16',
      meter_source: 'odometer', meter_interval: 250, next_due_meter: 1000,
    }
    expect(advanceSchedule(plan, { service_date: '2026-07-16', meter_reading: 1005 }))
      .toEqual({ next_due: '2027-01-16', next_due_meter: 1255 })
  })
  it('leaves next_due unchanged for a meter-only interval, advances the meter', () => {
    const plan = {
      interval_type: 'km', interval_value: 5000, next_due: '2026-09-01',
      meter_source: 'odometer', meter_interval: 5000, next_due_meter: 20000,
    }
    expect(advanceSchedule(plan, { service_date: '2026-07-16', meter_reading: 18000 }))
      .toEqual({ next_due: '2026-09-01', next_due_meter: 23000 })
  })
  it('leaves next_due_meter unchanged with no meter axis or no reading', () => {
    const plan = {
      interval_type: 'days', interval_value: 30, next_due: '2026-07-16',
      meter_source: 'none', meter_interval: 0, next_due_meter: null,
    }
    expect(advanceSchedule(plan, { service_date: '2026-07-16' }))
      .toEqual({ next_due: '2026-08-15', next_due_meter: null })
  })
})

describe('summarizePmCompliance', () => {
  const rows = [
    { status: 'active', asset_no: 'A1', asset_category: 'vehicle', next_due: '2026-07-01' }, // overdue
    { status: 'active', asset_no: 'A2', asset_category: 'generator', next_due: '2026-07-26' }, // due_soon
    { status: 'active', asset_no: 'A3', asset_category: 'vehicle', next_due: '2027-02-01' }, // scheduled
    { status: 'paused', asset_no: 'A4', asset_category: 'plant', next_due: '2026-07-01' }, // ignored
  ]

  it('rolls up active plans only, with honest counts and buckets', () => {
    const s = summarizePmCompliance(rows, { now: NOW })
    expect(s.total).toBe(4)
    expect(s.active).toBe(3)
    expect(s.overdue).toBe(1)
    expect(s.dueSoon).toBe(1)
    expect(s.compliantPct).toBe(67) // round((3 - 1) / 3 * 100)
    expect(s.buckets).toEqual({ d30: 2, d60: 2, d90: 2 })
    expect(s.byCategory).toEqual([
      { category: 'vehicle', count: 2 },
      { category: 'generator', count: 1 },
    ])
    expect(s.dueList.map((p) => p.asset_no)).toEqual(['A1', 'A2']) // worst-first
    expect(s.dueList[0].band).toBe('overdue')
  })
  it('counts a meter-due active plan into the buckets', () => {
    const meterRows = [
      { status: 'active', asset_no: 'M1', asset_category: 'equipment', next_due: '2027-06-01', meter_source: 'odometer', next_due_meter: 10000 },
    ]
    const s = summarizePmCompliance(meterRows, { now: NOW, kmByAsset: { M1: 9800 } })
    expect(s.dueSoon).toBe(1)
    expect(s.buckets).toEqual({ d30: 1, d60: 1, d90: 1 })
  })
  it('returns null compliantPct when there are no active plans', () => {
    const s = summarizePmCompliance([], { now: NOW })
    expect(s.total).toBe(0)
    expect(s.active).toBe(0)
    expect(s.compliantPct).toBeNull()
    expect(s.buckets).toEqual({ d30: 0, d60: 0, d90: 0 })
    expect(s.dueList).toEqual([])
  })
})
