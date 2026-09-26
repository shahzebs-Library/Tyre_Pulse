import { describe, it, expect } from 'vitest'
import {
  detectRotations, buildVehicles, classifyStatus, averageRotationInterval, lifeComparison,
  averageTyreCost, lifeExtensionValue, buildRotationAnalytics, filterVehicles,
  autoScheduleEntries, scheduleSummary, monthlyRotations, statusDistribution,
} from '../lib/rotationScheduleAnalytics'

const NOW = new Date(2026, 8, 15)

const recs = [
  // S1 rotated steer -> drive on V1 at 10,000 km, then fitment odometer 25,000
  { id: 1, serial_no: 'S1', asset_no: 'V1', position: 'LHF1', issue_date: '2026-01-01', km_at_fitment: 0, km_at_removal: 60000, cost_per_tyre: 1000, qty: 1, tread_depth: 10, site: 'NHC' },
  { id: 2, serial_no: 'S1', asset_no: 'V1', position: 'LHRO', issue_date: '2026-08-01', km_at_fitment: 10000, tread_depth: 4, site: 'NHC' },
  { id: 3, serial_no: 'S2', asset_no: 'V1', position: 'RHF1', issue_date: '2026-08-02', km_at_fitment: 32000, tread_depth: 11, site: 'NHC', cost_per_tyre: 1200, km_at_removal: 72000 },
  // V2 never rotated
  { id: 4, serial_no: 'S3', asset_no: 'V2', position: 'LHF1', issue_date: '2026-02-01', km_at_fitment: 0, km_at_removal: 40000, site: 'JED' },
  // V3 rotated but no odometer on the rotation
  { id: 5, serial_no: 'S4', asset_no: 'V3', position: 'LHF1', issue_date: '2026-03-01', site: 'JED' },
  { id: 6, serial_no: 'S4', asset_no: 'V3', position: 'LHRO', issue_date: '2026-09-01', site: 'JED' },
]

describe('rotation detection and status', () => {
  const rot = detectRotations(recs)
  it('detects a position change for the same serial', () => {
    expect(Object.keys(rot).sort()).toEqual(['S1', 'S4'])
    expect(rot.S1[0]).toMatchObject({ from: 'Steer', to: 'Drive', km: 10000, asset: 'V1' })
  })
  it('classifies without inventing distance', () => {
    expect(classifyStatus({ totalRotations: 0 })).toBe('No History')
    expect(classifyStatus({ totalRotations: 1, sinceLastKm: null, dueInKm: null })).toBe('Unmeasured')
    expect(classifyStatus({ totalRotations: 1, sinceLastKm: 25000, dueInKm: -5000 }, 20000)).toBe('Overdue')
    expect(classifyStatus({ totalRotations: 1, sinceLastKm: 19000, dueInKm: 1000 }, 20000)).toBe('Due Soon')
    expect(classifyStatus({ totalRotations: 1, sinceLastKm: 1000, dueInKm: 19000 }, 20000)).toBe('On Schedule')
  })
  it('builds vehicles with honest odometer values', () => {
    const v = buildVehicles(recs, 20000, rot)
    const v1 = v.find(x => x.asset === 'V1')
    expect(v1.currentKm).toBe(32000)
    expect(v1.sinceLastKm).toBe(22000)
    expect(v1.status).toBe('Overdue')
    expect(v1.wearImbalance).toBeCloseTo(7)
    const v3 = v.find(x => x.asset === 'V3')
    expect(v3.currentKm).toBeNull()
    expect(v3.status).toBe('Unmeasured')
    expect(v.find(x => x.asset === 'V2').status).toBe('No History')
    expect(v[0].asset).toBe('V1') // urgency order
  })
})

describe('fleet analytics', () => {
  it('average interval and life comparison', () => {
    expect(averageRotationInterval({ A: [{ km: 1000 }, { km: 21000 }] })).toEqual({ avgInterval: 20000, samples: 1 })
    expect(averageRotationInterval({})).toEqual({ avgInterval: null, samples: 0 })
    const life = lifeComparison(recs, detectRotations(recs))
    expect(life.avgLifeWith).toBe(60000)
    expect(life.avgLifeWithout).toBe(40000)
  })
  it('average cost is null with no priced rows (no placeholder denominator)', () => {
    expect(averageTyreCost([{ cost_per_tyre: null }, {}])).toBeNull()
    expect(averageTyreCost([{ cost_per_tyre: 1000, qty: 1 }, { cost_per_tyre: 2000, qty: 3 }])).toBeCloseTo(1750)
  })
  it('life-extension value needs measured lives and a price', () => {
    const v = lifeExtensionValue({ avgLifeWith: 60000, avgLifeWithout: 40000, avgCost: 1200, tyresAtRisk: 10 })
    expect(v.perTyre).toBeCloseTo(400)
    expect(v.total).toBeCloseTo(4000)
    expect(lifeExtensionValue({ avgLifeWith: 40000, avgLifeWithout: 60000, avgCost: 1200, tyresAtRisk: 10 }).total).toBeNull()
    expect(lifeExtensionValue({ avgLifeWith: null, avgLifeWithout: 40000, avgCost: 1200 }).perTyre).toBeNull()
  })
  it('builds the full picture', () => {
    const a = buildRotationAnalytics(recs, 20000, NOW)
    expect(a.total).toBe(3)
    expect(a.overdue).toBe(1)
    expect(a.unmeasured).toBe(1)
    expect(a.noHistory).toBe(1)
    expect(a.compliancePct).toBe(0)
    expect(a.monthly).toHaveLength(12)
    expect(a.monthly[11].count).toBe(1) // S4 rotated 2026-09-01
    expect(a.hasMonthlyRotations).toBe(true)
    expect(a.imbalanced.map(v => v.asset)).toEqual(['V1'])
    expect(statusDistribution(a.vehicles).reduce((s, d) => s + d.count, 0)).toBe(3)
  })
  it('empty fleet reports null compliance, not 0 or 100', () => {
    const a = buildRotationAnalytics([], 20000, NOW)
    expect(a.compliancePct).toBeNull()
    expect(a.avgCost).toBeNull()
    expect(a.lifeValueTotal).toBeNull()
    expect(monthlyRotations({}, NOW).every(m => m.count === 0)).toBe(true)
  })
})

describe('filters and scheduling', () => {
  const a = buildRotationAnalytics(recs, 20000, NOW)
  it('filters vehicles', () => {
    expect(filterVehicles(a.vehicles, { site: 'JED' }).map(v => v.asset).sort()).toEqual(['V2', 'V3'])
    expect(filterVehicles(a.vehicles, { status: 'Overdue' }).map(v => v.asset)).toEqual(['V1'])
    expect(filterVehicles(a.vehicles, { search: 'v2' }).map(v => v.asset)).toEqual(['V2'])
  })
  it('auto-schedules only overdue/due-soon without an open entry', () => {
    const e = autoScheduleEntries(a.vehicles, [], 20000, NOW)
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ asset: 'V1', priority: 'Critical', scheduledDate: '2026-09-18', status: 'Open' })
    expect(e[0].notes).toContain('Overdue by 2,000 km')
    expect(autoScheduleEntries(a.vehicles, [{ asset: 'V1', status: 'Open' }], 20000, NOW)).toHaveLength(0)
  })
  it('summarises the schedule', () => {
    const s = scheduleSummary([
      { status: 'Open', priority: 'Critical', scheduledDate: '2026-09-01' },
      { status: 'Open', priority: 'High', scheduledDate: '2026-10-01' },
      { status: 'Completed', priority: 'Low', scheduledDate: '2026-08-01' },
    ], NOW)
    expect(s).toMatchObject({ open: 2, completed: 1, late: 1 })
    expect(s.byPriority.Critical).toBe(1)
  })
})
