import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  leagueTable,
  spendBreakdown,
  permissionMatrix,
  summariseHolding,
  LEAGUE_METRICS,
} from '../lib/holdingCompany'

const SUBS = [
  { tenant_id: 'hq', name: 'Group HQ', is_hq: true, vehicles: 200, open_alerts: 50, spend_30d: 100000, fleet_health_score: 60 },
  { tenant_id: 'a', name: 'Alpha Transport', is_hq: false, vehicles: 40, open_alerts: 12, spend_30d: 30000, fleet_health_score: 82 },
  { tenant_id: 'b', name: 'Bravo Logistics', is_hq: false, vehicles: 90, open_alerts: 4, spend_30d: 10000, fleet_health_score: 91 },
  { tenant_id: 'c', name: 'Charlie Haul', is_hq: false, vehicles: 15, open_alerts: 30, spend_30d: 60000, fleet_health_score: 55 },
]

describe('holdingCompany — toFiniteNumber', () => {
  it('parses numbers and numeric strings', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,250')).toBe(1250)
    expect(toFiniteNumber('SAR 300.5')).toBe(300.5)
  })
  it('returns null for empty/invalid', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('holdingCompany — leagueTable', () => {
  it('excludes HQ rows from the league', () => {
    const t = leagueTable(SUBS, 'fleet_health_score')
    expect(t).toHaveLength(3)
    expect(t.some((r) => r.is_hq)).toBe(false)
    expect(t.some((r) => r.tenant_id === 'hq')).toBe(false)
  })

  it('ranks higher-is-better metrics descending (fleet_health_score)', () => {
    const t = leagueTable(SUBS, 'fleet_health_score')
    expect(t.map((r) => r.tenant_id)).toEqual(['b', 'a', 'c'])
    expect(t.map((r) => r.rank)).toEqual([1, 2, 3])
    expect(t[0].metricValue).toBe(91)
  })

  it('ranks higher-is-better metrics descending (vehicles)', () => {
    const t = leagueTable(SUBS, 'vehicles')
    expect(t.map((r) => r.tenant_id)).toEqual(['b', 'a', 'c'])
    expect(t[0].rank).toBe(1)
  })

  it('ranks lower-is-better metrics ascending (open_alerts)', () => {
    const t = leagueTable(SUBS, 'open_alerts')
    expect(t.map((r) => r.tenant_id)).toEqual(['b', 'a', 'c'])
    expect(t.map((r) => r.metricValue)).toEqual([4, 12, 30])
    expect(t.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  it('ranks lower-is-better metrics ascending (spend_30d)', () => {
    const t = leagueTable(SUBS, 'spend_30d')
    expect(t.map((r) => r.tenant_id)).toEqual(['b', 'a', 'c'])
    expect(t[0].metricValue).toBe(10000)
  })

  it('assigns a contiguous 1-based rank', () => {
    const t = leagueTable(SUBS, 'vehicles')
    t.forEach((r, i) => expect(r.rank).toBe(i + 1))
  })

  it('falls back to fleet_health_score for an unknown metric', () => {
    const t = leagueTable(SUBS, 'nonsense')
    expect(t.map((r) => r.tenant_id)).toEqual(['b', 'a', 'c'])
  })

  it('handles empty / non-array input', () => {
    expect(leagueTable([], 'vehicles')).toEqual([])
    expect(leagueTable(undefined)).toEqual([])
    expect(leagueTable(null)).toEqual([])
  })

  it('breaks ties deterministically by name', () => {
    const rows = [
      { tenant_id: 'z', name: 'Zeta', is_hq: false, vehicles: 10 },
      { tenant_id: 'm', name: 'Mid', is_hq: false, vehicles: 10 },
      { tenant_id: 'a', name: 'Ay', is_hq: false, vehicles: 10 },
    ]
    const t = leagueTable(rows, 'vehicles')
    expect(t.map((r) => r.name)).toEqual(['Ay', 'Mid', 'Zeta'])
  })
})

describe('holdingCompany — spendBreakdown', () => {
  it('sorts by spend descending and computes pct of total', () => {
    const b = spendBreakdown(SUBS)
    // total = 100000 + 30000 + 10000 + 60000 = 200000
    expect(b[0].name).toBe('Group HQ')
    expect(b[0].spend).toBe(100000)
    expect(b[0].pct).toBe(50)
    const charlie = b.find((r) => r.name === 'Charlie Haul')
    expect(charlie.pct).toBe(30)
    const sumPct = b.reduce((s, r) => s + r.pct, 0)
    expect(Math.round(sumPct)).toBe(100)
  })

  it('guards divide-by-zero when total spend is 0', () => {
    const b = spendBreakdown([
      { name: 'X', spend_30d: 0 },
      { name: 'Y', spend_30d: 0 },
    ])
    expect(b.every((r) => r.pct === 0)).toBe(true)
  })

  it('handles empty / non-array input', () => {
    expect(spendBreakdown([])).toEqual([])
    expect(spendBreakdown(undefined)).toEqual([])
  })
})

describe('holdingCompany — permissionMatrix', () => {
  const M = permissionMatrix(['owner', 'admin', 'manager', 'viewer'], SUBS)

  it('gives owner and admin full access everywhere', () => {
    const owner = M.find((r) => r.role === 'owner')
    const admin = M.find((r) => r.role === 'admin')
    expect(owner.cells.every((c) => c.level === 'full')).toBe(true)
    expect(admin.cells.every((c) => c.level === 'full')).toBe(true)
  })

  it('gives manager write on HQ and read elsewhere', () => {
    const mgr = M.find((r) => r.role === 'manager')
    const hq = mgr.cells.find((c) => c.is_hq)
    const other = mgr.cells.filter((c) => !c.is_hq)
    expect(hq.level).toBe('write')
    expect(other.every((c) => c.level === 'read')).toBe(true)
  })

  it('gives viewer read on HQ and none elsewhere', () => {
    const v = M.find((r) => r.role === 'viewer')
    const hq = v.cells.find((c) => c.is_hq)
    const other = v.cells.filter((c) => !c.is_hq)
    expect(hq.level).toBe('read')
    expect(other.every((c) => c.level === 'none')).toBe(true)
  })

  it('is deterministic and covers every requested role', () => {
    const a = permissionMatrix(['owner', 'admin', 'manager', 'viewer'], SUBS)
    const b = permissionMatrix(['owner', 'admin', 'manager', 'viewer'], SUBS)
    expect(a).toEqual(b)
    expect(a.map((r) => r.role)).toEqual(['owner', 'admin', 'manager', 'viewer'])
  })

  it('maps an unknown role to none', () => {
    const M2 = permissionMatrix(['ghost'], SUBS)
    expect(M2[0].cells.every((c) => c.level === 'none')).toBe(true)
  })
})

describe('holdingCompany — summariseHolding', () => {
  const dashboard = {
    parent_id: 'hq',
    subsidiary_count: 3,
    grand_total: { vehicles: 345, tyres: 1400, alerts: 96, critical_alerts: 11, low_tread: 40, spend_30d: 200000 },
    subsidiaries: SUBS,
  }

  it('reads the server grand-total roll-up', () => {
    const s = summariseHolding(dashboard)
    expect(s.subsidiaryCount).toBe(3)
    expect(s.totalVehicles).toBe(345)
    expect(s.totalTyres).toBe(1400)
    expect(s.totalOpenAlerts).toBe(96)
    expect(s.totalCritical).toBe(11)
    expect(s.totalSpend30d).toBe(200000)
  })

  it('averages subsidiary fleet-health', () => {
    const s = summariseHolding(dashboard)
    // round((60 + 82 + 91 + 55) / 4) = round(72) = 72
    expect(s.avgHealth).toBe(72)
  })

  it('returns a zeroed summary for an empty dashboard', () => {
    const s = summariseHolding({})
    expect(s).toEqual({
      subsidiaryCount: 0,
      totalVehicles: 0,
      totalTyres: 0,
      totalOpenAlerts: 0,
      totalCritical: 0,
      totalSpend30d: 0,
      avgHealth: 0,
    })
  })

  it('falls back to subsidiaries.length when subsidiary_count is absent', () => {
    const s = summariseHolding({ subsidiaries: SUBS })
    expect(s.subsidiaryCount).toBe(4)
  })
})

describe('holdingCompany — LEAGUE_METRICS registry', () => {
  it('marks alert/spend metrics as lower-is-better', () => {
    expect(LEAGUE_METRICS.open_alerts.dir).toBe('asc')
    expect(LEAGUE_METRICS.spend_30d.dir).toBe('asc')
    expect(LEAGUE_METRICS.fleet_health_score.dir).toBe('desc')
    expect(LEAGUE_METRICS.vehicles.dir).toBe('desc')
  })
})
