import { describe, it, expect } from 'vitest'
import {
  filterDtcRows, recurrenceIndex, rowRecurrence, openAgeDays, buildDtcModel,
  systemOptions, dtcRegisterRows,
} from '../lib/dtcDiagnosticsAnalytics'

const NOW = new Date('2026-09-15T12:00:00Z')
const ROWS = [
  { id: 1, asset_no: 'TRK-1', code: 'p0301', system: 'Engine', severity: 'critical', status: 'active', detected_at: '2026-09-01' },
  { id: 2, asset_no: 'TRK-1', code: 'P0301', system: 'Engine', severity: 'warning', status: 'cleared', detected_at: '2026-08-01' },
  { id: 3, asset_no: 'TRK-2', code: 'C1234', system: 'ABS', severity: 'info', status: 'acknowledged', detected_at: '2026-06-01', notes: 'sensor' },
  { id: 4, asset_no: 'TRK-3', code: null, system: '', severity: 'warning', status: 'active' },
]

describe('dtcDiagnosticsAnalytics', () => {
  it('filters by status, severity, asset, system and text (incl. notes)', () => {
    expect(filterDtcRows(ROWS, { status: 'active' })).toHaveLength(2)
    expect(filterDtcRows(ROWS, { severity: 'critical' })[0].id).toBe(1)
    expect(filterDtcRows(ROWS, { asset: 'TRK-2' })).toHaveLength(1)
    expect(filterDtcRows(ROWS, { system: 'Engine' })).toHaveLength(2)
    expect(filterDtcRows(ROWS, { search: 'sensor' })[0].id).toBe(3)
    expect(filterDtcRows(null)).toEqual([])
  })

  it('recurrence is case-insensitive on code and 0 when unknown', () => {
    const model = buildDtcModel(ROWS, NOW)
    expect(rowRecurrence(ROWS[0], model.index)).toBe(2)
    expect(rowRecurrence(ROWS[3], model.index)).toBe(0)
    expect(rowRecurrence(ROWS[0], null)).toBe(0)
    expect(recurrenceIndex([]).size).toBe(0)
  })

  it('open age is null for cleared or undated codes', () => {
    expect(openAgeDays(ROWS[0], NOW)).toBe(14)
    expect(openAgeDays(ROWS[1], NOW)).toBeNull()
    expect(openAgeDays({ status: 'active' }, NOW)).toBeNull()
  })

  it('builds honest KPIs', () => {
    const k = buildDtcModel(ROWS, NOW).kpis
    expect(k.total).toBe(4)
    expect(k.open).toBe(3)
    expect(k.criticalActive).toBe(1)
    expect(k.clearedPct).toBe(25)
    expect(k.repeatOffenderAssets).toBe(1)
    expect(k.openOver30).toBe(1)
    expect(buildDtcModel([], NOW).kpis.clearedPct).toBeNull()
  })

  it('register rows expose labels and null recurrence below two', () => {
    const model = buildDtcModel(ROWS, NOW)
    const rows = dtcRegisterRows(ROWS, model.index, NOW)
    expect(rows[0]).toMatchObject({ recurrence: 2, severityLabel: 'Critical', statusLabel: 'Active', openDays: 14 })
    expect(rows[2].recurrence).toBeNull()
    expect(rows[3]).toMatchObject({ code: null, detectedMs: null })
    expect(systemOptions(ROWS)).toEqual(['ABS', 'Engine'])
  })
})
