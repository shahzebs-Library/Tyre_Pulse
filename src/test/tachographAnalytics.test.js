import { describe, it, expect } from 'vitest'
import {
  tachographKpis, filterTachograph, tachographExportRows, fmtDuration,
  parseInfringementTypes, fmtInfringementTypes, optionsFor, EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/tachographAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z').getTime()
const rows = [
  { id: 1, driver_name: 'Ali', asset_no: 'TM1', record_date: '2026-09-20', driving_min: 600, distance_km: 400, status: 'flagged', country: 'KSA', download_type: 'driver_card' },
  { id: 2, driver_name: 'Ali', asset_no: 'TM1', record_date: '2026-06-01', driving_min: 300, infringement_count: 2, status: 'reviewed', country: 'KSA', download_type: 'vehicle_unit' },
  { id: 3, driver_name: 'Sara', asset_no: 'TM2', record_date: '2026-09-25', status: 'downloaded', country: 'UAE', notes: 'roster ok' },
]

describe('tachographKpis', () => {
  it('computes measured-only KPIs', () => {
    const k = tachographKpis(rows, { now: NOW })
    expect(k.totalRecords).toBe(3)
    expect(k.distinctDrivers).toBe(2)
    expect(k.infringingRecords).toBe(2)
    expect(k.complianceRate).toBeCloseTo(33.3, 1)
    expect(k.avgDrivingMin).toBe(450)
    expect(k.totalDistanceKm).toBe(400)
    expect(k.recordsInWindow).toBe(2)
    expect(k.overDriveDays).toBe(1)
  })
  it('returns null (N/A) rather than zero when nothing is measurable', () => {
    const k = tachographKpis([], { now: NOW })
    expect(k.complianceRate).toBeNull()
    expect(k.avgDrivingMin).toBeNull()
    expect(k.totalDistanceKm).toBeNull()
    const k2 = tachographKpis([{ driver_name: 'x' }], { now: NOW })
    expect(k2.avgDrivingMin).toBeNull()
    expect(k2.complianceRate).toBe(100)
  })
})

describe('filterTachograph', () => {
  it('filters by country, status, type and search', () => {
    expect(filterTachograph(rows, { country: 'KSA' })).toHaveLength(2)
    expect(filterTachograph(rows, { status: 'flagged' })).toHaveLength(1)
    expect(filterTachograph(rows, { type: 'vehicle_unit' })).toHaveLength(1)
    expect(filterTachograph(rows, { search: 'roster' })).toHaveLength(1)
    expect(filterTachograph(rows, {})).toHaveLength(3)
  })
})

describe('helpers', () => {
  it('formats durations honestly', () => {
    expect(fmtDuration(125)).toBe('2h 05m')
    expect(fmtDuration(null)).toBe('N/A')
    expect(fmtDuration('abc')).toBe('N/A')
  })
  it('parses and renders infringement types', () => {
    expect(parseInfringementTypes('a, b')).toEqual(['a', 'b'])
    expect(parseInfringementTypes('["x"]')).toEqual(['x'])
    expect(parseInfringementTypes('  ')).toBeNull()
    expect(fmtInfringementTypes(['a', 'b'])).toBe('a, b')
  })
  it('builds export rows aligned to the headers', () => {
    const out = tachographExportRows(rows)
    expect(out).toHaveLength(3)
    expect(Object.keys(out[0])).toEqual(EXPORT_COLS)
    expect(EXPORT_HEADERS).toHaveLength(EXPORT_COLS.length)
    expect(out[0].status).toBe('Flagged')
    expect(out[1].download_type).toBe('Vehicle unit')
  })
  it('lists distinct options', () => {
    expect(optionsFor(rows, 'country')).toEqual(['KSA', 'UAE'])
  })
})
