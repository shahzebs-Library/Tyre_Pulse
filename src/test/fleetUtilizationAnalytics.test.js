import { describe, it, expect } from 'vitest'
import {
  attachRegister, siteComparison, telematicsCoverage, captureTimeline, idleRanking, filterByRegister, NO_SITE,
} from '../lib/fleetUtilizationAnalytics'

const fleet = [
  { asset_no: 'TM1', country: 'KSA', site: 'NHC', vehicle_type: 'TR-MIXER', status: 'Active' },
  { asset_no: 'TM2', country: 'KSA', site: 'NHC', vehicle_type: 'TR-MIXER', status: 'Active' },
  { asset_no: 'TM3', country: 'KSA', site: 'JED', vehicle_type: 'PUMPS', status: null },
  { asset_no: 'OLD', country: 'KSA', site: 'JED', vehicle_type: 'PUMPS', status: 'Inactive' },
]
const rows = [
  { asset_no: 'tm1', country: 'KSA', utilization_pct: 80, idle_pct: 10, distance_km: 100, working_seconds: 7200, idle_seconds: 3600, captured_at: '2026-07-28T00:00:00Z' },
  { asset_no: 'TM3', country: 'KSA', utilization_pct: 20, idle_pct: 60, distance_km: null, working_seconds: null, idle_seconds: 36000, captured_at: '2026-07-28T00:00:00Z' },
  { asset_no: 'ZZ9', country: 'KSA', utilization_pct: null, captured_at: '2026-07-28T00:00:00Z' },
]

describe('fleetUtilizationAnalytics', () => {
  it('attaches register site and type by country + asset', () => {
    const a = attachRegister(rows, fleet)
    expect(a[0]).toMatchObject({ site: 'NHC', vehicle_type: 'TR-MIXER', in_register: true })
    expect(a[2]).toMatchObject({ site: '', in_register: false })
  })

  it('compares sites with null for unmeasured totals', () => {
    const s = siteComparison(attachRegister(rows, fleet))
    const jed = s.find((x) => x.site === 'JED')
    expect(jed).toMatchObject({ assets: 1, avgUtilization: 20, highIdle: 1, distanceKm: null, workingHours: null, idleHours: 10 })
    const none = s.find((x) => x.site === NO_SITE)
    expect(none.avgUtilization).toBeNull()
  })

  it('reports the telematics coverage gap over active register assets only', () => {
    const c = telematicsCoverage(rows, fleet)
    expect(c).toMatchObject({ activeAssets: 3, covered: 2, unregistered: 1 })
    expect(c.coveragePct).toBe(66.7)
    expect(c.uncovered.map((u) => u.asset_no)).toEqual(['TM2'])
    expect(c.bySite[0]).toMatchObject({ site: 'NHC', gap: 1 })
    expect(telematicsCoverage([], []).coveragePct).toBeNull()
  })

  it('refuses a trend from a single capture', () => {
    const t = captureTimeline(rows)
    expect(t.points).toHaveLength(1)
    expect(t.trendable).toBe(false)
    expect(captureTimeline([...rows, { captured_at: '2026-08-28', utilization_pct: 50 }]).trendable).toBe(true)
  })

  it('ranks idle time and filters by register fields', () => {
    const r = idleRanking(rows, { minIdlePct: 50 })
    expect(r).toHaveLength(1)
    expect(r[0].asset_no).toBe('TM3')
    const a = attachRegister(rows, fleet)
    expect(filterByRegister(a, { site: 'NHC' })).toHaveLength(1)
    expect(filterByRegister(a, { site: NO_SITE })).toHaveLength(1)
    expect(filterByRegister(a, { vehicleType: 'PUMPS' })).toHaveLength(1)
  })
})
