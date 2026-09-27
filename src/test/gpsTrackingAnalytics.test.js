import { describe, it, expect } from 'vitest'
import {
  motionOf, filterPositions, assetTracks, gpsKpis, stateMix, hasCoords,
} from '../lib/gpsTrackingAnalytics'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, asset_no: 'T1', latitude: 24.7, longitude: 46.7, speed_kmh: 60, recorded_at: '2026-09-27T10:00:00Z', ignition: true },
  { id: 2, asset_no: 'T1', latitude: 24.8, longitude: 46.7, speed_kmh: 130, recorded_at: '2026-09-27T11:00:00Z', ignition: true },
  { id: 3, asset_no: 'T2', latitude: 21.5, longitude: 39.2, speed_kmh: 0, recorded_at: '2026-09-25T08:00:00Z', ignition: true },
  { id: 4, asset_no: 'T3', latitude: null, longitude: null, speed_kmh: 0, recorded_at: null, ignition: false },
  // A 1000 km jump in one hour is a GPS glitch, not a leg.
  { id: 5, asset_no: 'T2', latitude: 30.0, longitude: 39.2, speed_kmh: 0, recorded_at: '2026-09-25T09:00:00Z', ignition: true },
]

describe('gpsTrackingAnalytics', () => {
  it('classifies motion', () => {
    expect(motionOf(rows[0])).toBe('moving')
    expect(motionOf(rows[2])).toBe('idle')
    expect(motionOf(rows[3])).toBe('stopped')
    expect(hasCoords(rows[3])).toBe(false)
  })

  it('filters by asset, motion, overspeed, window and search', () => {
    expect(filterPositions(rows, { asset: 'T1' })).toHaveLength(2)
    expect(filterPositions(rows, { overspeedOnly: true, overspeedKmh: 120 }).map((r) => r.id)).toEqual([2])
    expect(filterPositions(rows, { fromMs: Date.parse('2026-09-26T00:00:00Z') }).map((r) => r.id)).toEqual([1, 2])
    expect(filterPositions(rows, { motion: 'idle' }).map((r) => r.id)).toEqual([3, 5])
  })

  it('reconstructs distance, rejects jumps and leaves single-ping assets at N/A', () => {
    const tracks = assetTracks(rows, { now: NOW, overspeedKmh: 120 })
    const t1 = tracks.find((t) => t.asset_no === 'T1')
    expect(t1.distanceKm).toBeGreaterThan(10)
    expect(t1.overspeedPings).toBe(1)
    expect(t1.stale).toBe(false)
    const t2 = tracks.find((t) => t.asset_no === 'T2')
    expect(t2.glitchLegs).toBe(1)
    expect(t2.distanceKm).toBeNull()
    expect(t2.stale).toBe(true)
    const t3 = tracks.find((t) => t.asset_no === 'T3')
    expect(t3.lastSeenHours).toBeNull()
    expect(t3.stale).toBeNull()
    expect(t3.distanceKm).toBeNull()
  })

  it('kpis stay honest on empty input', () => {
    const k = gpsKpis([], { now: NOW })
    expect(k.distanceKm).toBeNull()
    expect(k.coordinateCoverage).toBeNull()
    const full = gpsKpis(rows, { now: NOW })
    expect(full.coordinateCoverage).toBe(80)
    expect(full.staleAssets).toBe(1)
    expect(stateMix(rows)).toEqual({ moving: 1, idle: 1, stopped: 1 })
  })
})
