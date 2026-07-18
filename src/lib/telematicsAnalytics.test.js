import { describe, it, expect } from 'vitest'
import {
  AGE_BUCKETS,
  SORT_KEYS,
  DEVICE_STATUSES,
  normStatus,
  heartbeatBucket,
  statusDistribution,
  connectivity,
  fleetCoverage,
  unassignedCount,
  byVendor,
  bySite,
  installPipeline,
  dataQualityFlags,
  filterDevices,
  sortDevices,
  analyzeTelematics,
} from './telematicsAnalytics'

// Fixed clock so every heartbeat assertion is deterministic.
const NOW = new Date('2026-07-18T12:00:00Z').getTime()
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString()

function dev(over = {}) {
  return {
    id: over.id || Math.random().toString(36).slice(2),
    device_id: 'IMEI-1',
    provider: 'Teltonika',
    sim_number: '8901',
    asset_no: 'A-1',
    install_date: '2026-01-01',
    last_seen_at: hoursAgo(1),
    status: 'active',
    site: 'DHAHBAN',
    ...over,
  }
}

describe('normStatus', () => {
  it('passes through known statuses', () => {
    for (const st of DEVICE_STATUSES) expect(normStatus(st)).toBe(st)
  })
  it('defaults unknown/blank to active', () => {
    expect(normStatus('mystery')).toBe('active')
    expect(normStatus(undefined)).toBe('active')
    expect(normStatus(null)).toBe('active')
  })
})

describe('heartbeatBucket', () => {
  it('never when no last_seen_at', () => {
    expect(heartbeatBucket(dev({ last_seen_at: null }), NOW)).toBe('never')
  })
  it('live under 1h', () => {
    expect(heartbeatBucket(dev({ last_seen_at: hoursAgo(0.5) }), NOW)).toBe('live')
  })
  it('today for 1-24h', () => {
    expect(heartbeatBucket(dev({ last_seen_at: hoursAgo(5) }), NOW)).toBe('today')
  })
  it('week for 1-7d', () => {
    expect(heartbeatBucket(dev({ last_seen_at: hoursAgo(48) }), NOW)).toBe('week')
  })
  it('month for 7-30d', () => {
    expect(heartbeatBucket(dev({ last_seen_at: hoursAgo(24 * 10) }), NOW)).toBe('month')
  })
  it('stale over 30d', () => {
    expect(heartbeatBucket(dev({ last_seen_at: hoursAgo(24 * 60) }), NOW)).toBe('stale')
  })
  it('AGE_BUCKETS covers 6 ordered bands ending in never', () => {
    expect(AGE_BUCKETS).toHaveLength(6)
    expect(AGE_BUCKETS[AGE_BUCKETS.length - 1].key).toBe('never')
  })
})

describe('statusDistribution', () => {
  it('always returns every canonical status key', () => {
    const d = statusDistribution([dev(), dev({ status: 'offline' })])
    expect(Object.keys(d.counts).sort()).toEqual([...DEVICE_STATUSES].sort())
    expect(d.total).toBe(2)
    expect(d.counts.active).toBe(1)
    expect(d.counts.offline).toBe(1)
  })
  it('computes pct and handles empty', () => {
    const empty = statusDistribution([])
    expect(empty.total).toBe(0)
    expect(empty.items.every((i) => i.count === 0 && i.pct === 0)).toBe(true)
    const one = statusDistribution([dev(), dev(), dev({ status: 'offline' }), dev({ status: 'offline' })])
    expect(one.items.find((i) => i.key === 'active').pct).toBe(50)
  })
})

describe('connectivity', () => {
  const rows = [
    dev({ last_seen_at: hoursAgo(1) }), // online
    dev({ last_seen_at: hoursAgo(2) }), // online
    dev({ last_seen_at: hoursAgo(48) }), // offline (stale > 24h)
    dev({ last_seen_at: null }), // never
    dev({ status: 'decommissioned', last_seen_at: hoursAgo(1) }), // excluded from online split
  ]
  it('splits online/offline over expected (non-decommissioned) devices', () => {
    const c = connectivity(rows, NOW, 24)
    expect(c.expected).toBe(4)
    expect(c.online).toBe(2)
    expect(c.offline).toBe(2) // 48h + never
    expect(c.never).toBe(1)
    expect(c.decommissioned).toBe(1)
    expect(c.onlinePct).toBe(50)
  })
  it('threshold is tunable', () => {
    const c = connectivity([dev({ last_seen_at: hoursAgo(30) })], NOW, 48)
    expect(c.online).toBe(1)
    const c2 = connectivity([dev({ last_seen_at: hoursAgo(30) })], NOW, 24)
    expect(c2.online).toBe(0)
  })
  it('onlinePct null and hasHeartbeatData false when no expected/heartbeat', () => {
    const c = connectivity([dev({ status: 'decommissioned', last_seen_at: null })], NOW, 24)
    expect(c.onlinePct).toBe(null)
    expect(c.hasHeartbeatData).toBe(false)
  })
})

describe('fleetCoverage', () => {
  const rows = [
    dev({ asset_no: 'A-1' }),
    dev({ asset_no: 'A-2' }),
    dev({ asset_no: 'A-2' }), // duplicate asset
    dev({ asset_no: '', status: 'offline' }), // unassigned
    dev({ asset_no: 'A-9', status: 'decommissioned' }), // does not cover
  ]
  it('counts distinct covered assets (excludes decommissioned) and pct with a real total', () => {
    const c = fleetCoverage(rows, 10)
    expect(c.assetsCovered).toBe(2) // A-1, A-2
    expect(c.assetsAssigned).toBe(3) // A-1, A-2, A-9
    expect(c.totalAssets).toBe(10)
    expect(c.coveragePct).toBe(20)
    expect(c.uncovered).toBe(8)
  })
  it('returns null pct when no real fleet total (honest, no guess)', () => {
    expect(fleetCoverage(rows).coveragePct).toBe(null)
    expect(fleetCoverage(rows, 0).coveragePct).toBe(null)
    expect(fleetCoverage(rows, -5).totalAssets).toBe(null)
  })
})

describe('unassignedCount', () => {
  it('counts devices with no asset_no', () => {
    expect(unassignedCount([dev(), dev({ asset_no: '' }), dev({ asset_no: null })])).toBe(2)
  })
})

describe('byVendor / bySite grouping', () => {
  const rows = [
    dev({ provider: 'Teltonika', site: 'DHAHBAN', last_seen_at: hoursAgo(1) }),
    dev({ provider: 'Teltonika', site: 'DHAHBAN', last_seen_at: hoursAgo(48) }),
    dev({ provider: '', site: '', last_seen_at: null }),
  ]
  it('groups by vendor with online/offline/never and blank fallback', () => {
    const g = byVendor(rows, NOW, 24)
    const telto = g.find((x) => x.key === 'Teltonika')
    expect(telto.total).toBe(2)
    expect(telto.online).toBe(1)
    expect(telto.offline).toBe(1)
    expect(g.find((x) => x.key === 'Unknown').total).toBe(1)
  })
  it('groups by site, blank -> Unassigned, sorted by total desc', () => {
    const g = bySite(rows, NOW, 24)
    expect(g[0].key).toBe('DHAHBAN')
    expect(g[0].total).toBe(2)
    expect(g.find((x) => x.key === 'Unassigned').never).toBe(1)
  })
})

describe('installPipeline', () => {
  it('splits installed vs pending and buckets recent months', () => {
    const rows = [
      dev({ install_date: '2026-05-10' }),
      dev({ install_date: '2026-05-20' }),
      dev({ install_date: '2026-06-01' }),
      dev({ install_date: null }),
    ]
    const p = installPipeline(rows, NOW, 6)
    expect(p.installed).toBe(3)
    expect(p.pending).toBe(1)
    expect(p.recent.find((m) => m.month === '2026-05').count).toBe(2)
    expect(p.recent.find((m) => m.month === '2026-06').count).toBe(1)
  })
})

describe('dataQualityFlags', () => {
  it('flags stale-active, never-reported, no-asset, no-sim, duplicates', () => {
    const rows = [
      dev({ device_id: 'DUP', last_seen_at: hoursAgo(100), status: 'active', asset_no: 'A-5' }), // stale active
      dev({ device_id: 'DUP', last_seen_at: hoursAgo(1), asset_no: 'A-6' }), // duplicate id
      dev({ device_id: 'N1', last_seen_at: null, asset_no: 'A-7' }), // never reported
      dev({ device_id: 'N2', asset_no: '', sim_number: '', last_seen_at: hoursAgo(1) }), // no asset + no sim
      dev({ device_id: 'N3', asset_no: 'A-5', status: 'active', last_seen_at: hoursAgo(1) }), // 2nd active on A-5
    ]
    const flags = dataQualityFlags(rows, NOW, 24)
    const by = Object.fromEntries(flags.map((f) => [f.key, f.count]))
    // stale-active counts the 100h-ago active device AND the never-reported
    // active device (both are active yet offline beyond the threshold).
    expect(by.staleActive).toBe(2)
    expect(by.noHeartbeat).toBe(1)
    expect(by.noAsset).toBe(1)
    expect(by.noSim).toBe(1)
    expect(by.dupIds).toBe(1)
    expect(by.dupAssets).toBe(1)
  })
  it('returns only non-zero flags (clean set -> empty)', () => {
    const clean = [dev({ device_id: 'X', asset_no: 'A-1', sim_number: '1', last_seen_at: hoursAgo(1) })]
    expect(dataQualityFlags(clean, NOW, 24)).toEqual([])
  })
})

describe('filterDevices', () => {
  const rows = [
    dev({ device_id: 'AAA', provider: 'Teltonika', site: 'DHAHBAN', asset_no: 'A-1', status: 'active', last_seen_at: hoursAgo(1) }),
    dev({ device_id: 'BBB', provider: 'Queclink', site: 'NHC', asset_no: 'A-2', status: 'offline', last_seen_at: hoursAgo(50) }),
    dev({ device_id: 'CCC', provider: '', site: '', asset_no: '', status: 'active', last_seen_at: null }),
  ]
  it('filters by status, site, vendor', () => {
    expect(filterDevices(rows, { status: 'offline' }, NOW).map((r) => r.device_id)).toEqual(['BBB'])
    expect(filterDevices(rows, { site: 'DHAHBAN' }, NOW).map((r) => r.device_id)).toEqual(['AAA'])
    expect(filterDevices(rows, { vendor: 'Unknown' }, NOW).map((r) => r.device_id)).toEqual(['CCC'])
  })
  it('filters by connectivity', () => {
    expect(filterDevices(rows, { connectivity: 'online' }, NOW, 24).map((r) => r.device_id)).toEqual(['AAA'])
    expect(filterDevices(rows, { connectivity: 'never' }, NOW).map((r) => r.device_id)).toEqual(['CCC'])
    expect(filterDevices(rows, { connectivity: 'offline' }, NOW, 24).map((r) => r.device_id).sort()).toEqual(['BBB', 'CCC'])
  })
  it('search matches across id/provider/sim/asset/site', () => {
    expect(filterDevices(rows, { search: 'quec' }, NOW).map((r) => r.device_id)).toEqual(['BBB'])
    expect(filterDevices(rows, { search: 'a-1' }, NOW).map((r) => r.device_id)).toEqual(['AAA'])
    expect(filterDevices(rows, { search: 'zzz' }, NOW)).toEqual([])
  })
  it('empty predicates match all', () => {
    expect(filterDevices(rows, {}, NOW)).toHaveLength(3)
  })
})

describe('sortDevices', () => {
  const rows = [
    dev({ device_id: 'B', last_seen_at: hoursAgo(10), install_date: '2026-02-01' }),
    dev({ device_id: 'A', last_seen_at: hoursAgo(1), install_date: '2026-01-01' }),
    dev({ device_id: 'C', last_seen_at: null, install_date: null }),
  ]
  it('SORT_KEYS is the documented set', () => {
    expect(SORT_KEYS).toContain('last_seen')
    expect(SORT_KEYS).toContain('device_id')
  })
  it('sorts by device_id asc', () => {
    expect(sortDevices(rows, 'device_id', 'asc').map((r) => r.device_id)).toEqual(['A', 'B', 'C'])
  })
  it('sorts by last_seen desc with nulls last', () => {
    expect(sortDevices(rows, 'last_seen', 'desc').map((r) => r.device_id)).toEqual(['A', 'B', 'C'])
  })
  it('sorts by last_seen asc with nulls still last', () => {
    expect(sortDevices(rows, 'last_seen', 'asc').map((r) => r.device_id)).toEqual(['B', 'A', 'C'])
  })
  it('does not mutate the input array', () => {
    const copy = [...rows]
    sortDevices(rows, 'device_id', 'asc')
    expect(rows).toEqual(copy)
  })
})

describe('analyzeTelematics', () => {
  const rows = [
    dev({ asset_no: 'A-1', status: 'active', last_seen_at: hoursAgo(1) }),
    dev({ asset_no: 'A-2', status: 'active', last_seen_at: hoursAgo(48) }),
    dev({ asset_no: '', status: 'offline', last_seen_at: null }),
    dev({ asset_no: 'A-3', status: 'decommissioned', last_seen_at: hoursAgo(1) }),
  ]
  it('assembles KPIs, status, connectivity, coverage and intelligence', () => {
    const a = analyzeTelematics(rows, { now: NOW, thresholdHours: 24, totalAssets: 12 })
    expect(a.total).toBe(4)
    expect(a.kpis.active).toBe(2)
    expect(a.kpis.activePct).toBe(50)
    expect(a.kpis.online).toBe(1) // only A-1
    expect(a.kpis.assetsCovered).toBe(2) // A-1, A-2 (A-3 decommissioned)
    expect(a.kpis.coveragePct).toBe(Math.round((2 / 12) * 1000) / 10)
    expect(a.kpis.unassigned).toBe(1)
    expect(a.vendors[0].total).toBe(4)
    expect(a.connectivity.expected).toBe(3)
  })
  it('defaults are safe on empty input', () => {
    const a = analyzeTelematics([], { now: NOW })
    expect(a.total).toBe(0)
    expect(a.kpis.coveragePct).toBe(null)
    expect(a.activePct).toBe(0)
    expect(a.flags).toEqual([])
  })
  it('coverage pct is null without a real fleet total', () => {
    const a = analyzeTelematics(rows, { now: NOW })
    expect(a.coverage.coveragePct).toBe(null)
  })
})
