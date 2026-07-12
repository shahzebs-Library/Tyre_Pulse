import { describe, it, expect } from 'vitest'
import {
  deviceOnline, summarizeDevices, hoursSinceSeen, DEFAULT_ONLINE_THRESHOLD_HOURS,
} from '../lib/telematicsDevices'

// Fixed reference clock so tests are deterministic.
const NOW = new Date('2026-07-12T00:00:00Z').getTime()
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString()

describe('telematicsDevices — deviceOnline', () => {
  it('is online when last seen within the default 24h window', () => {
    expect(deviceOnline({ status: 'active', last_seen_at: hoursAgo(1) }, NOW)).toBe(true)
    expect(deviceOnline({ status: 'active', last_seen_at: hoursAgo(23) }, NOW)).toBe(true)
  })

  it('is offline when last seen beyond the window', () => {
    expect(deviceOnline({ status: 'active', last_seen_at: hoursAgo(25) }, NOW)).toBe(false)
    expect(deviceOnline({ status: 'offline', last_seen_at: hoursAgo(100) }, NOW)).toBe(false)
  })

  it('honours a custom threshold', () => {
    expect(deviceOnline({ status: 'active', last_seen_at: hoursAgo(5) }, NOW, 6)).toBe(true)
    expect(deviceOnline({ status: 'active', last_seen_at: hoursAgo(5) }, NOW, 4)).toBe(false)
  })

  it('is never online when decommissioned or never seen', () => {
    expect(deviceOnline({ status: 'decommissioned', last_seen_at: hoursAgo(1) }, NOW)).toBe(false)
    expect(deviceOnline({ status: 'active', last_seen_at: null }, NOW)).toBe(false)
    expect(deviceOnline({ status: 'active' }, NOW)).toBe(false)
    expect(deviceOnline(null, NOW)).toBe(false)
  })

  it('treats a future last_seen (clock skew) as a recent contact', () => {
    expect(deviceOnline({ status: 'active', last_seen_at: hoursAgo(-2) }, NOW)).toBe(true)
  })

  it('exposes a sane default threshold', () => {
    expect(DEFAULT_ONLINE_THRESHOLD_HOURS).toBe(24)
  })
})

describe('telematicsDevices — hoursSinceSeen', () => {
  it('reports hours since last contact, null when never seen', () => {
    expect(hoursSinceSeen({ last_seen_at: hoursAgo(3) }, NOW)).toBe(3)
    expect(hoursSinceSeen({ last_seen_at: null }, NOW)).toBeNull()
    expect(hoursSinceSeen({}, NOW)).toBeNull()
    expect(hoursSinceSeen({ last_seen_at: hoursAgo(-5) }, NOW)).toBe(0) // future clamps to 0
  })
})

describe('telematicsDevices — summarizeDevices', () => {
  it('handles empty / non-array input', () => {
    expect(summarizeDevices([], NOW)).toEqual({
      total: 0,
      byStatus: { active: 0, offline: 0, decommissioned: 0 },
      online: 0, offline: 0, neverSeen: 0, assetsCovered: 0, unassigned: 0,
    })
    expect(summarizeDevices(null, NOW).total).toBe(0)
    expect(summarizeDevices(undefined, NOW).total).toBe(0)
  })

  it('counts status, online/offline split, assets covered and unassigned', () => {
    const rows = [
      { status: 'active', last_seen_at: hoursAgo(1), asset_no: 'V-100' },   // online
      { status: 'active', last_seen_at: hoursAgo(48), asset_no: 'V-100' },  // offline, same asset
      { status: 'offline', last_seen_at: hoursAgo(72), asset_no: 'V-200' }, // offline
      { status: 'decommissioned', last_seen_at: hoursAgo(1), asset_no: '' },// offline (decommissioned), unassigned
      { status: 'active', asset_no: null },                                 // never seen, unassigned
      { status: 'weird', last_seen_at: hoursAgo(2), asset_no: 'V-300' },    // unknown → active bucket, online
    ]
    const s = summarizeDevices(rows, NOW)
    expect(s.total).toBe(6)
    expect(s.byStatus).toEqual({ active: 4, offline: 1, decommissioned: 1 })
    expect(s.online).toBe(2)
    expect(s.offline).toBe(4)
    expect(s.neverSeen).toBe(1)
    expect(s.assetsCovered).toBe(3) // V-100, V-200, V-300 (deduped)
    expect(s.unassigned).toBe(2)    // blank + null
  })

  it('respects a custom online threshold', () => {
    const rows = [{ status: 'active', last_seen_at: hoursAgo(5), asset_no: 'A' }]
    expect(summarizeDevices(rows, NOW, 6).online).toBe(1)
    expect(summarizeDevices(rows, NOW, 4).online).toBe(0)
  })
})
