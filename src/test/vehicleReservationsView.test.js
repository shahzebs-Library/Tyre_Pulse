import { describe, it, expect } from 'vitest'
import * as detailHelpers from '../lib/vehicleReservationsView'
import {
  deriveStatus, viewKpis, summarySegments, buildSlots, shiftAnchor, layoutCalendar,
  clashesFor, availability, upcomingList, mapImportRow, startOfWeek,
} from '../lib/vehicleReservationsView'

// Wednesday 23 Sep 2026, 12:00 local.
const NOW = new Date(2026, 8, 23, 12, 0).getTime()
const at = (d, h = 8) => new Date(2026, 8, d, h, 0).toISOString()

describe('deriveStatus', () => {
  it('reads the workflow status against the clock', () => {
    expect(deriveStatus({ status: 'cancelled', start_at: at(25) }, { now: NOW })).toBe('cancelled')
    expect(deriveStatus({ status: 'returned' }, { now: NOW })).toBe('completed')
    expect(deriveStatus({ status: 'out', end_at: at(24) }, { now: NOW })).toBe('active')
    expect(deriveStatus({ status: 'out', end_at: at(22) }, { now: NOW })).toBe('overdue')
    expect(deriveStatus({ status: 'out' }, { now: NOW })).toBe('active')
    expect(deriveStatus({ status: 'approved', start_at: at(25) }, { now: NOW })).toBe('upcoming')
    expect(deriveStatus({ status: 'requested', start_at: at(21) }, { now: NOW })).toBe('not_started')
    expect(deriveStatus({ status: 'requested' }, { now: NOW })).toBe('unscheduled')
  })
})

describe('viewKpis and summary', () => {
  const rows = [
    { status: 'out', end_at: at(24) },
    { status: 'out', end_at: at(22) },
    { status: 'approved', start_at: at(25) },
    { status: 'approved', start_at: at(29, 8) + '' }, // 6 days ahead
    { status: 'approved', start_at: new Date(2026, 9, 5).toISOString() }, // beyond 7 days
    { status: 'cancelled' },
  ]
  it('counts upcoming only inside the next seven days', () => {
    expect(viewKpis(rows, { now: NOW })).toEqual({ total: 6, active: 1, upcoming: 2, overdue: 1, cancelled: 1 })
  })
  it('keeps a stable legend and hides unscheduled only when empty', () => {
    const seg = summarySegments(rows, { now: NOW })
    expect(seg.map((s) => s.key)).not.toContain('unscheduled')
    expect(seg.reduce((s, x) => s + x.count, 0)).toBe(6)
    expect(summarySegments([{ status: 'requested' }]).map((s) => s.key)).toContain('unscheduled')
  })
})

describe('calendar slots', () => {
  it('week starts on Monday and spans seven days', () => {
    const g = buildSlots(NOW, 'week', { now: NOW })
    expect(g.slots).toHaveLength(7)
    expect(new Date(g.start).getDay()).toBe(1)
    expect(new Date(g.start).getDate()).toBe(21)
    expect(g.slots.filter((s) => s.today)).toHaveLength(1)
    expect(startOfWeek(NOW).getDate()).toBe(21)
  })
  it('month has every day, day has twelve two-hour slots', () => {
    expect(buildSlots(NOW, 'month').slots).toHaveLength(30)
    expect(buildSlots(NOW, 'day').slots).toHaveLength(12)
  })
  it('shifts by one period', () => {
    expect(new Date(shiftAnchor(NOW, 'week', 1)).getDate()).toBe(30)
    expect(new Date(shiftAnchor(NOW, 'month', -1)).getMonth()).toBe(7)
    expect(new Date(shiftAnchor(NOW, 'day', 1)).getDate()).toBe(24)
  })
})

describe('layoutCalendar', () => {
  const grid = buildSlots(NOW, 'week', { now: NOW })
  it('spans bars across days, clips at the range edge and packs overlaps into lanes', () => {
    const rows = [
      { id: 1, asset_no: 'TM1', status: 'approved', start_at: at(22), end_at: at(24, 18) },
      { id: 2, asset_no: 'TM1', status: 'approved', start_at: at(23), end_at: at(25) },
      { id: 3, asset_no: 'TM2', status: 'out', start_at: at(19), end_at: at(22, 10) },
      { id: 4, asset_no: 'TM3', status: 'cancelled', start_at: at(22), end_at: at(23) },
      { id: 5, asset_no: 'TM4', status: 'requested' },
      { id: 6, asset_no: 'TM5', status: 'approved', start_at: at(2), end_at: at(3) },
    ]
    const out = layoutCalendar(rows, grid, { now: NOW })
    expect(out.vehicles.map((v) => v.asset)).toEqual(['TM1', 'TM2'])
    const tm1 = out.vehicles[0]
    expect(tm1.laneCount).toBe(2)
    expect(tm1.bars[0]).toMatchObject({ startCol: 1, span: 3, lane: 0 })
    expect(tm1.bars[1]).toMatchObject({ startCol: 2, lane: 1 })
    expect(out.vehicles[1].bars[0]).toMatchObject({ startCol: 0, span: 2, clippedStart: true })
    expect(out.unplaced).toBe(1)
    expect(out.outOfRange).toBe(1)
  })
})

describe('clash and availability', () => {
  const rows = [
    { id: 'a', asset_no: 'TM1', status: 'approved', start_at: at(22), end_at: at(24) },
    { id: 'b', asset_no: 'TM2', status: 'cancelled', start_at: at(22), end_at: at(24) },
    { id: 'c', asset_no: 'TM3', status: 'returned', start_at: at(22), end_at: at(24) },
  ]
  it('flags only live bookings on the same vehicle, and ignores the row being edited', () => {
    const cand = { asset_no: 'TM1', start_at: at(23), end_at: at(25) }
    expect(clashesFor(cand, rows).map((r) => r.id)).toEqual(['a'])
    expect(clashesFor(cand, rows, { excludeId: 'a' })).toEqual([])
    expect(clashesFor({ ...cand, asset_no: 'TM2' }, rows)).toEqual([])
    expect(clashesFor({ asset_no: 'TM1', start_at: at(24), end_at: at(25) }, rows)).toEqual([])
  })
  it('splits the fleet into free and booked for a window', () => {
    const fleet = [{ asset_no: 'TM1' }, { asset_no: 'TM2' }, { asset_no: 'TM3' }, { asset_no: 'TM1' }]
    const res = availability(fleet, rows, { from: at(23), to: at(23, 12) })
    expect(res.booked.map((b) => b.asset.asset_no)).toEqual(['TM1'])
    expect(res.free.map((f) => f.asset_no)).toEqual(['TM2', 'TM3'])
    expect(availability(fleet, rows, { from: at(23), to: at(22) })).toBeNull()
  })
})

describe('upcomingList and import mapping', () => {
  it('lists open bookings soonest first', () => {
    const rows = [
      { id: 1, status: 'approved', start_at: at(26) },
      { id: 2, status: 'returned', start_at: at(20) },
      { id: 3, status: 'out', start_at: at(21), end_at: at(24) },
    ]
    expect(upcomingList(rows, { now: NOW }).map((r) => r.id)).toEqual([3, 1])
  })
  it('maps sheet headers and rejects rows it cannot use', () => {
    expect(mapImportRow({ 'Asset No': 'TM1', Start: '2026-09-25 08:00', End: '2026-09-25 18:00', 'Booked by': 'Ops' }).values)
      .toMatchObject({ asset_no: 'TM1', requester_name: 'Ops' })
    expect(mapImportRow({ Start: '2026-09-25' }).error).toBe('No asset number')
    expect(mapImportRow({ Asset: 'TM1', Start: 'soon' }).error).toBe('Start time is not a date')
    expect(mapImportRow({ Asset: 'TM1', Start: '2026-09-25 10:00', End: '2026-09-25 09:00' }).error).toBe('End is not after start')
  })
})

describe('reservation detail helpers', () => {
  const m = detailHelpers

  it('offers approve and reject only to managers', () => {
    expect(m.workflowActions({ status: 'requested' }, { elevated: false })).toEqual([])
    expect(m.workflowActions({ status: 'requested' }, { elevated: true })).toEqual(['approve', 'reject'])
    expect(m.workflowActions({ status: 'approved' }, { elevated: false })).toEqual(['checkout'])
    expect(m.workflowActions({ status: 'out' })).toEqual(['return'])
    expect(m.workflowActions({ status: 'returned' }, { elevated: true })).toEqual([])
  })

  it('reads trip facts and never turns a missing reading into zero', () => {
    const f = m.tripFacts({ odometer_out: 1000, odometer_in: 1150, expected_km: 100, start_at: '2026-01-01T08:00:00Z', actual_pickup_at: '2026-01-01T09:00:00Z' })
    expect(f.distance).toBe(150)
    expect(f.variancePct).toBe(50)
    expect(f.pickupLateMin).toBe(60)
    expect(f.returnLateMin).toBeNull()
    expect(m.tripFacts({ odometer_out: 1000 }).distance).toBeNull()
    expect(m.tripFacts({ odometer_out: 1000, odometer_in: 900 }).distance).toBeNull()
  })

  it('describes events in plain words', () => {
    expect(m.describeEvent({ event_type: 'rejected', detail: { reason: 'No driver' } })).toEqual({ label: 'Rejected', text: 'Reason: No driver' })
    expect(m.describeEvent({ event_type: 'edited', detail: { fields: ['driver_id', 'driver_name', 'purpose'] } }).text).toBe('Changed driver, purpose')
    expect(m.lateText(2)).toBe('on time')
    expect(m.lateText(-90)).toBe('1.5 h early')
    expect(m.lateText(null)).toBeNull()
    expect(m.isRejected({ rejected_at: 'x' })).toBe(true)
  })
})
