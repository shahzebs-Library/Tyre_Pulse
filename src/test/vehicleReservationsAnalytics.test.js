import { describe, it, expect } from 'vitest'
import {
  filterReservations, reservationKpis, reservationStatusMix, departmentDemand, monthlyBookings,
  findConflicts, conflictIdSet, isOverdueReturn, reservationExportRows,
} from '../lib/vehicleReservationsAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const rows = [
  { id: 'a', asset_no: 'P1', status: 'out', start_at: '2026-09-26T08:00:00Z', end_at: '2026-09-27T08:00:00Z', department: 'Ops', expected_km: 100 },
  { id: 'b', asset_no: 'P1', status: 'approved', start_at: '2026-09-27T06:00:00Z', end_at: '2026-09-27T10:00:00Z', department: 'Ops' },
  { id: 'c', asset_no: 'P2', status: 'requested', start_at: '2026-10-01T08:00:00Z', end_at: '2026-10-01T12:00:00Z' },
  { id: 'd', asset_no: 'P3', status: 'cancelled', start_at: '2026-09-10T08:00:00Z', end_at: '2026-09-10T12:00:00Z', department: 'HR' },
]

describe('vehicleReservationsAnalytics', () => {
  it('flags overdue returns only for out bookings past their end', () => {
    expect(isOverdueReturn(rows[0], { now: NOW })).toBe(true)
    expect(isOverdueReturn(rows[1], { now: NOW })).toBe(false)
    expect(isOverdueReturn({ status: 'out' }, { now: NOW })).toBe(false)
  })

  it('KPIs reuse the base summary and keep honest nulls', () => {
    const k = reservationKpis(rows, { now: NOW })
    expect(k.totalReservations).toBe(4)
    expect(k.overdueReturns).toBe(1)
    expect(k.pendingApproval).toBe(1)
    expect(k.conflictCount).toBe(1)
    expect(k.bookedHours).toBe(32)
    expect(k.avgDurationHours).toBe(10.7)
    expect(k.cancellationRate).toBe(25)
    expect(k.expectedKm).toBe(100)
    const empty = reservationKpis([], { now: NOW })
    expect(empty.cancellationRate).toBeNull()
    expect(empty.bookedHours).toBeNull()
  })

  it('filters by conflicts, department, overdue and pickup range', () => {
    const ids = conflictIdSet(findConflicts(rows))
    expect([...ids].sort()).toEqual(['a', 'b'])
    expect(filterReservations(rows, { conflictsOnly: true, conflictIds: ids }).map((r) => r.id)).toEqual(['a', 'b'])
    expect(filterReservations(rows, { department: 'No department' }).map((r) => r.id)).toEqual(['c'])
    expect(filterReservations(rows, { overdueOnly: true, now: NOW }).map((r) => r.id)).toEqual(['a'])
    expect(filterReservations(rows, { from: '2026-10-01' }).map((r) => r.id)).toEqual(['c'])
  })

  it('status mix, department demand and monthly trend', () => {
    expect(reservationStatusMix(rows).find((s) => s.key === 'out').count).toBe(1)
    const d = departmentDemand(rows)
    expect(d[0]).toEqual({ department: 'Ops', bookings: 2, hours: 28 })
    expect(d.find((x) => x.department === 'HR')).toBeUndefined()
    const t = monthlyBookings(rows, { now: NOW })
    expect(t[11]).toEqual({ month: '2026-09', bookings: 2, cancelled: 1 })
  })

  it('export rows mark double-booked rows and leave unknowns blank', () => {
    const ids = conflictIdSet(findConflicts(rows))
    const ex = reservationExportRows(rows, { conflictIds: ids })
    expect(ex[0].double_booked).toBe('Yes')
    expect(ex[2].double_booked).toBe('No')
    expect(ex[2].expected_km).toBe('')
  })
})
