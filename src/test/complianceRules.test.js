import { describe, it, expect } from 'vitest'
import {
  pressureRule, hasPressureReading, treadRecordedCount, treadFigure, NOT_RECORDED,
  PRESSURE_TOLERANCE_PCT, PRESSURE_RULE_TEXT,
} from '../lib/complianceRules'
import { computePressureCompliance } from '../lib/kpiEngine'

const insp = (site, psis, extra = {}) => ({
  site, status: 'Done', tyre_conditions: psis.map((p) => ({ pressure_psi: p })), ...extra,
})

describe('complianceRules: one pressure and tread definition for both compliance views', () => {
  it('pressure is the kpiEngine vehicle-median rule, unchanged', () => {
    const rows = [insp('NHC', [100, 100, 100, 100, 60]), insp('JED', [110, 112, 111, 109])]
    const shared = pressureRule(rows)
    const engine = computePressureCompliance(rows)
    expect(shared.pct).toBe(engine.compliancePct)
    expect(shared.readings).toBe(9)
    expect(shared.outside).toBe(1)
    expect(shared.measuredInspections).toBe(2)
    expect(PRESSURE_TOLERANCE_PCT).toBe(15)
    expect(PRESSURE_RULE_TEXT).toContain('15%')
  })

  it('nothing measurable is null, never 0 or 100', () => {
    const none = pressureRule([insp('NHC', [100, 100]), { site: 'JED', status: 'Done' }])
    expect(none.pct).toBeNull()
    expect(none.compliant).toBeNull()
    expect(none.outside).toBeNull()
    expect(none.bySite).toEqual([])
    expect(none.notMeasuredInspections).toBe(2)
    expect(pressureRule().pct).toBeNull()
  })

  it('lists only sites that were actually measured', () => {
    const shared = pressureRule([insp('NHC', [100, 100, 100, 100]), insp('JED', [100])])
    expect(shared.bySite.map((s) => s.site)).toEqual(['NHC'])
  })

  it('knows whether an inspection recorded any pressure', () => {
    expect(hasPressureReading(insp('NHC', [98]))).toBe(true)
    expect(hasPressureReading({ pressure_reading: 100 })).toBe(false)
  })

  it('tread reads Not recorded when no tyre carries a tread depth', () => {
    expect(treadRecordedCount([{ tread_depth: null }, { tread_depth: '' }, {}])).toBe(0)
    expect(treadFigure(0, '100.0%')).toBe(NOT_RECORDED)
    expect(treadFigure(0, 0)).toBe(NOT_RECORDED)
    expect(treadRecordedCount([{ tread_depth: 4.5 }, { tread_depth: '0' }, { tread_depth: null }])).toBe(2)
    expect(treadFigure(2, '50.0%')).toBe('50.0%')
  })
})
