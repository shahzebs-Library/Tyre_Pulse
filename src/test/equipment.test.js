import { describe, it, expect } from 'vitest'
import {
  calibrationDue, summarizeEquipment, CALIBRATION_WINDOW_DAYS, EQUIPMENT_STATUSES,
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
