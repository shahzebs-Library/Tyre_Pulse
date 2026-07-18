import { describe, it, expect } from 'vitest'
import {
  calibrationDue, summarizeEquipment, CALIBRATION_WINDOW_DAYS, EQUIPMENT_STATUSES,
  SERVICE_DUE_SOON_DAYS, AGE_BANDS, calibrationState, daysUntilCalibration,
  ageOnRecordYears, ageBand, equipmentAnalytics, equipmentAttention,
} from '../lib/equipment'

// Fixed reference clock so tests are deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

describe('calibrationDue', () => {
  it('flags items whose calibration falls within the 30-day window', () => {
    expect(CALIBRATION_WINDOW_DAYS).toBe(30)
    // Due in 10 days → within window.
    expect(calibrationDue({ calibration_due: iso(NOW + 10 * DAY) }, NOW)).toBe(true)
    // Exactly at the 30-day threshold → due.
    expect(calibrationDue({ calibration_due: iso(NOW + 30 * DAY) }, NOW)).toBe(true)
    // Already overdue → due.
    expect(calibrationDue({ calibration_due: iso(NOW - 5 * DAY) }, NOW)).toBe(true)
    // Comfortably in the future → not due.
    expect(calibrationDue({ calibration_due: iso(NOW + 90 * DAY) }, NOW)).toBe(false)
  })

  it('does not flag items without a calibration date', () => {
    expect(calibrationDue({}, NOW)).toBe(false)
    expect(calibrationDue({ calibration_due: null }, NOW)).toBe(false)
    expect(calibrationDue({ calibration_due: 'not-a-date' }, NOW)).toBe(false)
  })

  it('never flags retired equipment even when overdue', () => {
    expect(calibrationDue({ calibration_due: iso(NOW - 100 * DAY), status: 'retired' }, NOW)).toBe(false)
    expect(calibrationDue({ calibration_due: iso(NOW - 100 * DAY), status: 'available' }, NOW)).toBe(true)
  })

  it('is null-safe on bad input', () => {
    expect(calibrationDue(null, NOW)).toBe(false)
    expect(calibrationDue(undefined, NOW)).toBe(false)
  })
})

describe('summarizeEquipment', () => {
  const rows = [
    { id: 1, status: 'available', equipment_type: 'Torque Wrench', calibration_due: iso(NOW + 5 * DAY) },
    { id: 2, status: 'available', equipment_type: 'torque wrench' }, // dup type (case-insensitive), no calibration
    { id: 3, status: 'in_use', equipment_type: 'Tyre Changer', calibration_due: iso(NOW + 200 * DAY) },
    { id: 4, status: 'maintenance', equipment_type: 'Balancer', calibration_due: iso(NOW - 2 * DAY) }, // overdue
    { id: 5, status: 'retired', equipment_type: 'Air Gauge', calibration_due: iso(NOW - 10 * DAY) }, // retired, ignored
    { id: 6, status: 'available', equipment_type: '  ' }, // blank type, ignored in type count
  ]

  it('counts equipment by status', () => {
    const s = summarizeEquipment(rows, NOW)
    expect(s.total).toBe(6)
    expect(s.available).toBe(3)
    expect(s.in_use).toBe(1)
    expect(s.maintenance).toBe(1)
    expect(s.retired).toBe(1)
  })

  it('counts calibration-due (within window, excluding retired)', () => {
    // id1 (due in 5d) + id4 (overdue) = 2; id3 far future, id5 retired → excluded.
    expect(summarizeEquipment(rows, NOW).calibrationDue).toBe(2)
  })

  it('counts distinct equipment types case-insensitively, ignoring blanks', () => {
    // Torque Wrench (x2, deduped), Tyre Changer, Balancer, Air Gauge = 4.
    expect(summarizeEquipment(rows, NOW).types).toBe(4)
  })

  it('handles empty / bad input deterministically', () => {
    const empty = summarizeEquipment([], NOW)
    expect(empty).toEqual({
      total: 0, available: 0, in_use: 0, maintenance: 0, retired: 0, calibrationDue: 0, types: 0,
    })
    expect(summarizeEquipment(null, NOW).total).toBe(0)
    expect(summarizeEquipment(undefined, NOW).total).toBe(0)
  })

  it('exposes the canonical status list', () => {
    expect(EQUIPMENT_STATUSES).toEqual(['available', 'in_use', 'maintenance', 'retired'])
  })
})

// ── Deep analytics additions ─────────────────────────────────────────────────
const isoTs = (offsetDays) => new Date(NOW + offsetDays * DAY).toISOString()
const dateOnly = (offsetDays) => isoTs(offsetDays).slice(0, 10)

const deepRows = [
  { id: 'a', name: 'Jack 20T', equipment_type: 'Jack', serial_no: 'J1', site: 'Metro', status: 'available', calibration_due: dateOnly(-10), created_at: isoTs(-400) }, // overdue, ~1.1y
  { id: 'b', name: 'Balancer', equipment_type: 'Balancer', serial_no: 'B1', site: 'Metro', status: 'in_use', calibration_due: dateOnly(15), created_at: isoTs(-1300) }, // due soon, ~3.6y
  { id: 'c', name: 'Torque wrench', equipment_type: 'Torque wrench', serial_no: 'T1', site: 'Depot', status: 'maintenance', calibration_due: dateOnly(120), created_at: isoTs(-100) }, // ok, <1y
  { id: 'd', name: 'Old gauge', equipment_type: 'Gauge', serial_no: 'G1', site: 'Depot', status: 'retired', calibration_due: dateOnly(-5), created_at: isoTs(-4000) }, // retired -> none
  { id: 'e', name: 'Mystery tool', equipment_type: '', serial_no: '', site: '', status: 'available', calibration_due: null, created_at: null }, // data-quality flags, no date
]

describe('service-due constants', () => {
  it('exposes the soon window and age bands', () => {
    expect(SERVICE_DUE_SOON_DAYS).toBe(CALIBRATION_WINDOW_DAYS)
    expect(AGE_BANDS).toEqual(['< 1y', '1 to 3y', '3 to 5y', '5 to 10y', '10y+'])
  })
})

describe('calibrationState', () => {
  it('classifies each item', () => {
    expect(calibrationState(deepRows[0], NOW)).toBe('overdue')
    expect(calibrationState(deepRows[1], NOW)).toBe('due_soon')
    expect(calibrationState(deepRows[2], NOW)).toBe('ok')
    expect(calibrationState(deepRows[3], NOW)).toBe('none') // retired
    expect(calibrationState(deepRows[4], NOW)).toBe('none') // no date
  })
  it('boundaries: at the soon window is due_soon, one day past is ok', () => {
    expect(calibrationState({ status: 'available', calibration_due: isoTs(SERVICE_DUE_SOON_DAYS) }, NOW)).toBe('due_soon')
    expect(calibrationState({ status: 'available', calibration_due: isoTs(SERVICE_DUE_SOON_DAYS + 1) }, NOW)).toBe('ok')
  })
})

describe('daysUntilCalibration', () => {
  it('returns signed days and null when undated', () => {
    expect(daysUntilCalibration(deepRows[0], NOW)).toBe(-10)
    expect(daysUntilCalibration(deepRows[1], NOW)).toBe(15)
    expect(daysUntilCalibration(deepRows[4], NOW)).toBeNull()
  })
})

describe('ageOnRecordYears / ageBand', () => {
  it('computes tenure and null when missing', () => {
    const y = ageOnRecordYears(deepRows[2], NOW)
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThan(1)
    expect(ageOnRecordYears(deepRows[4], NOW)).toBeNull()
  })
  it('clamps a future created_at to 0, never negative', () => {
    expect(ageOnRecordYears({ created_at: isoTs(30) }, NOW)).toBe(0)
  })
  it('maps years to bands', () => {
    expect(ageBand(0.5)).toBe('< 1y')
    expect(ageBand(2)).toBe('1 to 3y')
    expect(ageBand(4)).toBe('3 to 5y')
    expect(ageBand(7)).toBe('5 to 10y')
    expect(ageBand(12)).toBe('10y+')
    expect(ageBand(null)).toBeNull()
  })
})

describe('equipmentAnalytics', () => {
  const a = equipmentAnalytics(deepRows, NOW)
  it('rolls up status', () => {
    expect(a.total).toBe(5)
    expect(a.byStatus).toEqual({ available: 2, in_use: 1, maintenance: 1, retired: 1 })
  })
  it('groups by category with an Uncategorised bucket', () => {
    const cats = Object.fromEntries(a.byCategory.map((c) => [c.label, c.count]))
    expect(cats.Jack).toBe(1)
    expect(cats.Uncategorised).toBe(1)
    expect(a.types).toBe(4)
  })
  it('groups by site with an Unassigned bucket', () => {
    const sites = Object.fromEntries(a.bySite.map((c) => [c.label, c.count]))
    expect(sites.Metro).toBe(2)
    expect(sites.Depot).toBe(2)
    expect(sites.Unassigned).toBe(1)
  })
  it('summarises calibration states', () => {
    expect(a.calibration).toMatchObject({ overdue: 1, dueSoon: 1, ok: 1, none: 2, tracked: 3 })
  })
  it('produces age bands over all AGE_BANDS with an average', () => {
    expect(a.ageBands.map((b) => b.band)).toEqual(AGE_BANDS)
    expect(a.ageBands.reduce((s, b) => s + b.count, 0)).toBe(4)
    expect(a.datedCount).toBe(4)
    expect(a.avgAgeYears).toBeGreaterThan(0)
  })
  it('computes availability excluding retired', () => {
    expect(a.availability).toMatchObject({ operational: 3, down: 1, retired: 1, active: 4 })
    expect(a.availability.availabilityPct).toBeCloseTo(75, 5)
  })
  it('flags data quality', () => {
    expect(a.dataQuality.missingCategory).toBe(1)
    expect(a.dataQuality.missingSerial).toBe(1)
    expect(a.dataQuality.missingSite).toBe(1)
    expect(a.dataQuality.missingCalibration).toBe(1)
    expect(a.dataQuality.overdueCalibration).toBe(1)
    expect(a.dataQuality.flagged).toBeGreaterThanOrEqual(2)
  })
  it('handles empty and null input', () => {
    const empty = equipmentAnalytics([], NOW)
    expect(empty.total).toBe(0)
    expect(empty.avgAgeYears).toBeNull()
    expect(empty.availability.availabilityPct).toBeNull()
    expect(equipmentAnalytics(null, NOW).total).toBe(0)
  })
})

describe('equipmentAttention', () => {
  const att = equipmentAttention(deepRows, NOW)
  it('lists overdue with ASCII reasons', () => {
    expect(att.overdue.map((r) => r.id)).toEqual(['a'])
    expect(att.overdue[0].reason).toBe('Calibration overdue by 10d')
  })
  it('lists due-soon', () => {
    expect(att.dueSoon.map((r) => r.id)).toEqual(['b'])
    expect(att.dueSoon[0].reason).toBe('Calibration due in 15d')
  })
  it('lists data-quality issues in one joined reason', () => {
    const e = att.dataQuality.find((r) => r.id === 'e')
    expect(e).toBeTruthy()
    expect(e.reason).toContain('no category')
    expect(e.reason).toContain('no serial')
    expect(e.reason).toContain('no calibration date')
  })
  it('emits no dash/curly-quote characters in reasons', () => {
    const all = [...att.overdue, ...att.dueSoon, ...att.dataQuality]
    for (const r of all) expect(r.reason).not.toMatch(/[‒-―‘’“”]/)
  })
})
