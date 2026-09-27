import { describe, it, expect } from 'vitest'
import {
  normalizeReading, deviationLabel, filterReadings, honestCompliance, complianceTone,
  targetCoverage, tpmsExportRows, distinctValues, DEFAULT_TARGET_PRESSURE,
} from '../lib/tpmsPageAnalytics'

describe('normalizeReading', () => {
  it('normalises a sensor row', () => {
    const r = normalizeReading({ id: 1, pressure: 5, tyre_serial: 'S1', tyre_position: 'LF', target_pressure: 8, temperature: '40', recorded_at: '2026-01-02' }, 'sensor')
    expect(r.serial).toBe('S1')
    expect(r.band).toBe('critical')
    expect(r.temperature).toBe(40)
    expect(r.targetIsDefault).toBe(false)
  })
  it('normalises a baseline row with the default target and no temperature', () => {
    const r = normalizeReading({ id: 2, pressure_reading: 8, serial_no: 'X', position: 'RR', issue_date: '2026-02-01' }, 'baseline')
    expect(r.target).toBe(DEFAULT_TARGET_PRESSURE)
    expect(r.targetIsDefault).toBe(true)
    expect(r.temperature).toBeNull()
    expect(r.band).toBe('optimal')
  })
  it('a missing pressure is not assessed', () => {
    const r = normalizeReading({ id: 3 }, 'baseline')
    expect(r.pressure).toBeNull()
    expect(r.band).toBe('unknown')
    expect(deviationLabel(r)).toBe('N/A')
  })
})

describe('filters and labels', () => {
  const list = [
    normalizeReading({ id: 1, pressure: 5, site: 'A', tyre_position: 'LF', asset_no: 'TM1' }, 'sensor'),
    normalizeReading({ id: 2, pressure: 8, site: 'B', tyre_position: 'RF', asset_no: 'TM2' }, 'sensor'),
  ]
  it('filters by band, site, position and search', () => {
    expect(filterReadings(list, { band: 'critical' })).toHaveLength(1)
    expect(filterReadings(list, { site: 'B' })[0].id).toBe(2)
    expect(filterReadings(list, { position: 'LF' })[0].id).toBe(1)
    expect(filterReadings(list, { search: 'tm2' })[0].id).toBe(2)
  })
  it('deviation label is signed', () => {
    expect(deviationLabel(list[0])).toBe('-38%')
  })
  it('distinct values are sorted', () => {
    expect(distinctValues(list, 'site')).toEqual(['A', 'B'])
  })
})

describe('honesty', () => {
  it('compliance is null when nothing was assessed', () => {
    expect(honestCompliance({ assessed: 0, compliancePct: 0 })).toBeNull()
    expect(honestCompliance({ assessed: 4, compliancePct: 75 })).toBe(75)
    expect(complianceTone(null)).toBe('neutral')
    expect(complianceTone(95)).toBe('good')
    expect(complianceTone(80)).toBe('warn')
    expect(complianceTone(10)).toBe('crit')
  })
  it('target coverage is null for an empty set', () => {
    expect(targetCoverage([])).toBeNull()
    expect(targetCoverage([{ targetIsDefault: true }, { targetIsDefault: false }])).toBe(50)
  })
  it('export rows use N/A for missing values', () => {
    const ex = tpmsExportRows([normalizeReading({ id: 9 }, 'baseline')])
    expect(ex[0].pressure).toBe('N/A')
    expect(ex[0].status).toBe('Not assessed')
    expect(ex[0].source).toBe('Tyre record baseline')
  })
})
