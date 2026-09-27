import { describe, it, expect } from 'vitest'
import {
  filterHandovers, pairHandovers, currentlyOut, handoverKpis, dailyTrend, handoverExportRows,
  EXPORT_COLS, OVERDUE_HOURS,
} from '../lib/vehicleCheckInOutAnalytics'

const NOW = new Date('2026-09-27T12:00:00')
const rows = [
  { id: 1, asset_no: 'TRK-1', driver_name: 'Ali', direction: 'out', status: 'closed', odometer_km: 1000, fuel_level: 'Full', site: 'NHC', checked_at: '2026-09-26T08:00:00' },
  { id: 2, asset_no: 'trk-1', driver_name: 'Ali', direction: 'in', status: 'closed', odometer_km: 1250, fuel_level: '1/2', site: 'NHC', checked_at: '2026-09-26T18:00:00' },
  { id: 3, asset_no: 'TRK-2', driver_name: 'Omar', direction: 'out', status: 'open', odometer_km: 500, site: 'JED', checked_at: '2026-09-25T08:00:00' },
  { id: 4, asset_no: 'TRK-3', direction: 'out', status: 'closed', odometer_km: 900, checked_at: '2026-09-27T06:00:00' },
  { id: 5, asset_no: 'TRK-3', direction: 'in', status: 'closed', odometer_km: 800, checked_at: '2026-09-27T09:00:00', condition_notes: 'scratch on door' },
]

describe('vehicleCheckInOutAnalytics', () => {
  it('filters by direction, status, site, date and search', () => {
    expect(filterHandovers(rows, { direction: 'in' }).map((r) => r.id)).toEqual([2, 5])
    expect(filterHandovers(rows, { status: 'open' }).map((r) => r.id)).toEqual([3])
    expect(filterHandovers(rows, { site: 'JED' }).map((r) => r.id)).toEqual([3])
    expect(filterHandovers(rows, { from: '2026-09-27' }).map((r) => r.id)).toEqual([4, 5])
    expect(filterHandovers(rows, { search: 'scratch' }).map((r) => r.id)).toEqual([5])
    expect(filterHandovers(rows, { direction: 'all', status: 'all' })).toHaveLength(5)
  })

  it('pairs a check-out with the next return of the same asset, case-insensitively', () => {
    const p = pairHandovers(rows)
    expect(p).toHaveLength(2)
    const trk1 = p.find((x) => x.asset_no === 'TRK-1')
    expect(trk1).toMatchObject({ hoursOut: 10, kmDriven: 250, odometerBackwards: false, fuelOut: 'Full', fuelIn: '1/2' })
    const trk3 = p.find((x) => x.asset_no === 'TRK-3')
    expect(trk3.kmDriven).toBeNull()
    expect(trk3.odometerBackwards).toBe(true)
  })

  it('lists open check-outs with an overdue flag', () => {
    const out = currentlyOut(rows, { now: NOW })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 3, hoursOut: 52, overdue: true })
    expect(OVERDUE_HOURS).toBe(24)
  })

  it('builds KPIs with honest nulls', () => {
    const k = handoverKpis(rows, { now: NOW })
    expect(k).toMatchObject({ total: 5, currentlyOut: 1, returned: 2, completedHandovers: 2, overdueCount: 1, totalKmDriven: 250, odometerBackwards: 1, todayCount: 2 })
    expect(k.avgHoursOut).toBe(6.5)
    expect(k.fuelCoveragePct).toBe(40)
    const empty = handoverKpis([], { now: NOW })
    expect(empty.avgHoursOut).toBeNull()
    expect(empty.totalKmDriven).toBeNull()
    expect(empty.odometerCoveragePct).toBeNull()
  })

  it('counts outs and ins per day', () => {
    const t = dailyTrend(rows, { now: NOW, days: 3 })
    expect(t.map((d) => d.day)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27'])
    expect(t[1]).toMatchObject({ out: 1, in: 1 })
    expect(t[2]).toMatchObject({ out: 1, in: 1 })
  })

  it('shapes export rows with N/A for missing values', () => {
    const out = handoverExportRows(rows)
    expect(Object.keys(out[0])).toEqual(EXPORT_COLS)
    expect(out[3].driver_name).toBe('N/A')
    expect(out[2].fuel_level).toBe('N/A')
    expect(out[0].direction).toBe('Checked out')
  })
})
