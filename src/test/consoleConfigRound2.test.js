import { describe, it, expect } from 'vitest'
import { riskFor, rangeError, rangeHint, summarizeHistory, maskEmails, CONTROL_META } from '../console/pages/config/configMeta'
import { moveItemTo, moveGroupTo, describeLayout } from '../console/pages/navigation/navDiff'
import { darkenToContrast, fixPalette, colourName, averageLightness, contrastRatio } from '../console/pages/appearance/paletteCheck'
import { logoFileProblem, fitLogo } from '../console/pages/appearance/logoUpload'
import { countByType, vehicleCoverage, biggestGaps, positionsByType, wheelCheck } from '../console/pages/vehicleDesigner/coverage'

describe('System Configuration rules', () => {
  it('flags risky changes with a typed word only where it stops work for many people', () => {
    expect(riskFor('maintenance_mode', 'false', 'true')).toMatchObject({ tone: 'danger', word: 'MAINTENANCE' })
    expect(riskFor('maintenance_mode', 'true', 'false')).toBeNull()
    expect(riskFor('export_enabled', undefined, 'false')).toMatchObject({ word: 'EXPORTS OFF' })
    expect(riskFor('ai_enabled', 'true', 'false')).toMatchObject({ tone: 'warning', word: null })
    expect(riskFor('audit_retention_days', '0', '30')).toMatchObject({ word: 'DELETE LOGS' })
    expect(riskFor('audit_retention_days', '30', '0')).toBeNull()
    expect(riskFor('max_upload_rows', '1', '2')).toBeNull()
  })
  it('checks ranges and writes the hint with the unit', () => {
    expect(rangeError('max_upload_rows', '50')).toMatch(/At least 100/)
    expect(rangeError('max_upload_rows', '5000')).toBeNull()
    expect(rangeError('session_timeout_hours', '999')).toMatch(/At most 168/)
    expect(rangeError('app_version', 'x')).toBeNull()
    expect(rangeHint('password_min_length')).toBe('6 to 64 characters')
    expect(rangeHint('maintenance_mode')).toBe('')
    expect(CONTROL_META.push_notifications.who).toMatch(/Flutter/)
  })
  it('summarises history and masks emails', () => {
    const now = Date.parse('2026-10-04T10:00:00Z')
    const s = summarizeHistory([
      { key: 'a', changed_at: '2026-10-01T00:00:00Z', changed_by: 'u1' },
      { key: 'a', changed_at: '2026-10-03T00:00:00Z', changed_by: 'u2' },
      { key: 'b', changed_at: '2026-07-01T00:00:00Z', changed_by: null },
    ], now)
    expect(s.latest.a.changed_by).toBe('u2')
    expect(s.changed30).toBe(1)
    expect(s.authors).toBe(2)
    expect(maskEmails('sent to owner@example.com')).toBe('sent to o***@example.com')
  })
})

describe('Navigation drag and versions', () => {
  const model = [
    { key: 'g1', items: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] },
    { key: 'g2', items: [{ key: 'd' }] },
  ]
  it('moves an item within and across groups without mutating', () => {
    expect(moveItemTo(model, { g: 0, i: 0 }, { g: 0, i: 3 })[0].items.map((x) => x.key)).toEqual(['b', 'c', 'a'])
    const across = moveItemTo(model, { g: 0, i: 1 }, { g: 1, i: 0 })
    expect(across[0].items.map((x) => x.key)).toEqual(['a', 'c'])
    expect(across[1].items.map((x) => x.key)).toEqual(['b', 'd'])
    expect(model[0].items).toHaveLength(3)
    expect(moveItemTo(model, { g: 5, i: 0 }, { g: 0, i: 0 })).toBe(model)
  })
  it('moves a group and describes stored layouts', () => {
    expect(moveGroupTo(model, 1, 0).map((g) => g.key)).toEqual(['g2', 'g1'])
    expect(describeLayout(null)).toBe('Built-in sidebar')
    expect(describeLayout('{"groups":[],"items":[]}')).toBe('Built-in sidebar')
    expect(describeLayout('{bad')).toBe('Unreadable layout')
    expect(describeLayout(JSON.stringify({ groups: [{ key: 'x', label: 'X', hidden: true }], items: [{ key: 'y', hidden: true }] })))
      .toBe('1 groups, 1 items arranged, 2 hidden, 1 renamed')
  })
})

describe('Report Appearance helpers', () => {
  it('darkens a pale colour until it is readable on white', () => {
    const fixed = darkenToContrast('#fde68a')
    expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(darkenToContrast('#1f2937')).toBe('#1f2937')
    expect(darkenToContrast('nope')).toBeNull()
    expect(fixPalette(['#fde68a', '#000000']).every((c) => contrastRatio(c, '#ffffff') >= 3)).toBe(true)
  })
  it('names colours and measures logo lightness', () => {
    expect(colourName('#fde68a')).toBe('pale yellow')
    expect(colourName('#ffffff')).toBe('white')
    expect(colourName('#1d4ed8')).toMatch(/blue/)
    expect(averageLightness(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]))).toBeCloseTo(1, 5)
    expect(averageLightness(new Uint8ClampedArray([0, 0, 0, 0]))).toBeNull()
  })
  it('accepts only raster images under 3 MB and fits the logo box', () => {
    expect(logoFileProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/SVG/)
    expect(logoFileProblem({ type: 'image/png', size: 4 * 1024 * 1024 })).toMatch(/3 MB/)
    expect(logoFileProblem({ type: 'image/png', size: 1000 })).toBeNull()
    expect(fitLogo(960, 160)).toEqual({ width: 480, height: 80 })
    expect(fitLogo(100, 50)).toEqual({ width: 100, height: 50 })
  })
})

describe('Vehicle Designer coverage', () => {
  const counts = countByType([{ vehicle_type: 'tr-mixer' }, { vehicle_type: 'TR-MIXER' }, { vehicle_type: 'PUMP' }, { vehicle_type: '' }])
  it('counts vehicles and the share on an active design', () => {
    expect(counts).toEqual({ 'TR-MIXER': 2, PUMP: 1 })
    expect(vehicleCoverage(counts, [{ vehicle_type: 'TR-MIXER', active: true }])).toEqual({ covered: 2, total: 3, pct: 67 })
    expect(vehicleCoverage(counts, [{ vehicle_type: 'TR-MIXER', active: false }]).covered).toBe(0)
    expect(vehicleCoverage({}, []).pct).toBeNull()
  })
  it('lists the biggest gaps first and checks wheel counts', () => {
    expect(biggestGaps(counts, [])[0]).toEqual({ vehicle_type: 'TR-MIXER', vehicles: 2 })
    expect(biggestGaps(counts, [{ vehicle_type: 'TR-MIXER' }])).toEqual([{ vehicle_type: 'PUMP', vehicles: 1 }])
    expect(positionsByType([{ vehicle_type: 'a', tyre_position: 'lf' }, { vehicle_type: 'A', tyre_position: 'LF ' }, { vehicle_type: 'A', tyre_position: 'RF' }])).toEqual({ A: 2 })
    expect(wheelCheck(10, 12).state).toBe('short')
    expect(wheelCheck(12, 12).state).toBe('ok')
    expect(wheelCheck(null, 4).state).toBe('unknown')
    expect(wheelCheck(10, null).text).toBe('N/A')
  })
})
