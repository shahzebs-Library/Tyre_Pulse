import { describe, it, expect } from 'vitest'
import { scoreTyres } from '../lib/fleetRisk'
import { CPK_KIND } from '../lib/tyreLifetime'

const NOW = new Date('2025-12-01T00:00:00Z')
const base = { serial_no: 'SER1234567', country: 'KSA', brand: 'A', tread_depth: 8, pressure_reading: 100, fitment_date: '2025-01-01' }
const rows = [
  { ...base, id: 1, asset_no: 'V1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000 },
  { ...base, id: 2, asset_no: 'V2', issue_date: '2025-04-01', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 80000, cost_per_tyre: 1000 },
  { ...base, id: 3, asset_no: 'V3', issue_date: '2025-07-01', status: 'Fitted', km_at_fitment: 5000, total_km: 10000, cost_per_tyre: null },
]

describe('fleetRisk.scoreTyres on physical tyres', () => {
  it('a tyre fitted on 3 vehicles carries its whole life (km summed, price once)', () => {
    const [live] = scoreTyres({ tyres: rows }, { now: NOW })
    expect(live.km).toBe(60000)
    expect(live.cpk).toBeCloseTo(Math.round((1000 / 60000) * 1000) / 1000, 6)
    expect(live.cpk_kind).toBe(CPK_KIND.TYRE_LIFETIME)
    expect(live.cpk_provisional).toBe(true)
    expect(live.fitments).toBe(3)
  })
  it('a priced refit is not a second purchase', () => {
    const [live] = scoreTyres({ tyres: rows }, { now: NOW })
    expect(live.cpk).not.toBeCloseTo(2000 / 60000, 3)
  })
  it('only the in-service fitment is scored (removed fitments are events)', () => {
    expect(scoreTyres({ tyres: rows }, { now: NOW })).toHaveLength(1)
  })
})
