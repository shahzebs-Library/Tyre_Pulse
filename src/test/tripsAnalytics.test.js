import { describe, it, expect } from 'vitest'
import {
  filterTrips, tripKpis, monthlyDistance, statusMix, driverTotals, tripExportRows,
  statusLabel, EXPORT_COLS, SPEED_REVIEW_KMH,
} from '../lib/tripsAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, asset_no: 'A1', driver_name: 'Ali', origin: 'Riyadh', destination: 'Dammam', started_at: '2026-09-25T06:00:00Z', distance_km: 400, duration_min: 300, idle_min: 30, max_speed_kmh: 130, status: 'completed' },
  { id: 2, asset_no: 'A1', driver_name: 'Ali', origin: 'Dammam', destination: 'Riyadh', started_at: '2026-08-02T06:00:00Z', distance_km: 100, duration_min: 60, idle_min: 0, max_speed_kmh: 90, status: 'in_progress' },
  { id: 3, asset_no: 'A2', driver_name: '', origin: 'Jeddah', destination: 'Makkah', started_at: null, distance_km: null, duration_min: null, status: null },
]

describe('tripsAnalytics', () => {
  it('filters by search, asset, driver, status and start date', () => {
    expect(filterTrips(rows, { search: 'jeddah' }).map((r) => r.id)).toEqual([3])
    expect(filterTrips(rows, { asset: 'A1', status: 'completed' }).map((r) => r.id)).toEqual([1])
    expect(filterTrips(rows, { driver: 'Ali' })).toHaveLength(2)
    expect(filterTrips(rows, { from: '2026-09-01' }).map((r) => r.id)).toEqual([1])
  })

  it('computes KPIs and keeps unmeasured values honest', () => {
    const k = tripKpis(rows, { now: NOW })
    expect(k.totalTrips).toBe(3)
    expect(k.withDistance).toBe(2)
    expect(k.missingDistance).toBe(1)
    expect(k.avgTripKm).toBe(250)
    expect(k.idleSharePct).toBe(8.3)
    expect(k.speedReviewCount).toBe(1)
    expect(k.last7Count).toBe(1)
    expect(k.distinctDrivers).toBe(1)
    const empty = tripKpis([], { now: NOW })
    expect(empty.avgTripKm).toBeNull()
    expect(empty.idleSharePct).toBeNull()
    expect(empty.completionPct).toBeNull()
    expect(SPEED_REVIEW_KMH).toBe(120)
  })

  it('buckets distance by month over 12 months', () => {
    const t = monthlyDistance(rows, { now: NOW })
    expect(t).toHaveLength(12)
    expect(t[11]).toEqual({ month: '2026-09', trips: 1, distanceKm: 400 })
    expect(t[10]).toEqual({ month: '2026-08', trips: 1, distanceKm: 100 })
  })

  it('breaks trips down by status and driver', () => {
    expect(statusMix(rows)).toEqual([
      { label: 'In progress', count: 1 }, { label: 'Completed', count: 1 }, { label: 'Not recorded', count: 1 },
    ])
    expect(driverTotals(rows)).toEqual([{ driver: 'Ali', trips: 2, distanceKm: 500, durationMin: 360 }])
    expect(statusLabel('in_progress')).toBe('In progress')
    expect(statusLabel(null)).toBe('N/A')
  })

  it('shapes export rows with N/A for missing values', () => {
    const out = tripExportRows(rows)
    expect(Object.keys(out[0])).toEqual(EXPORT_COLS)
    expect(out[2].distance_km).toBe('N/A')
    expect(out[2].status).toBe('N/A')
  })
})
