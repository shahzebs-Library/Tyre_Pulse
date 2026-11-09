import { describe, it, expect } from 'vitest'
import { computeFleetStats, buildCohortModels, buildFailureRiskRows } from '../lib/predictiveMaintenance'
import { threeVehicles, sameVehicleRefit } from './lifetimeFixture.groupD'

describe('predictiveMaintenance on physical tyres', () => {
  it('a tyre fitted on 3 vehicles is ONE completed life of 60,000 km, priced once', () => {
    const s = computeFleetStats(threeVehicles())
    expect(s.avgKmLife).toBe((60000 + 40000) / 2)
    expect(s.avgCost).toBe((1000 + 2000) / 2)
  })
  it('a refit on the same vehicle is not a second purchase or a second life', () => {
    const s = computeFleetStats(sameVehicleRefit())
    expect(s.avgKmLife).toBe(40000)
    expect(s.avgCost).toBe(1000)
  })
  it('cohort samples are physical tyres; an open fitment adds prior km to the run', () => {
    const rows = []
    for (let i = 0; i < 5; i += 1) rows.push(...sameVehicleRefit().map((r) => ({ ...r, id: `${r.id}-${i}`, serial_no: `SER00000${i}`, size: '11R', km_at_removal: r.km_at_removal + (r.id === 'a2' ? i * 1000 : 0) })))
    const m = buildCohortModels(rows).get('Alpha||11R')
    expect(m.n).toBe(5) // 10 fitment rows -> 5 tyres
    const open = { id: 'x', serial_no: 'SER000000', country: 'KSA', asset_no: 'V1', brand: 'Alpha', size: '11R', km_at_fitment: 70000, total_km: 5000, tread_depth: 8 }
    const [row] = buildFailureRiskRows([...rows.filter((r) => r.serial_no === 'SER000000'), open], { nowMs: Date.UTC(2025, 11, 1) })
    expect(row.total_km).toBe(40000 + 5000)
  })
})
