import { describe, it, expect } from 'vitest'
import { buildTwin } from '../lib/digitalTwin'

const base = { serial_no: 'SER1234567', country: 'KSA', position: 'Steer L' }
const history = [
  { ...base, id: 1, asset_no: 'V1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 10000, km_at_removal: 30000, cost_per_tyre: 1000 },
  { ...base, id: 2, asset_no: 'V2', issue_date: '2025-04-01', removal_date: '2025-06-01', km_at_fitment: 50000, km_at_removal: 80000, cost_per_tyre: 1000 },
  { ...base, id: 3, asset_no: 'V3', issue_date: '2025-07-01', status: 'Fitted', km_at_fitment: 5000, total_km: 10000, cost_per_tyre: null },
]

describe('digitalTwin.buildTwin lifetime CPK', () => {
  it('with history, a tyre fitted on 3 vehicles is one tyre: price once, km summed', () => {
    const t = buildTwin([history[2]], { now: new Date('2025-12-01'), history })
    expect(t.positions[0].cpk).toBeCloseTo(Math.round((1000 / 60000) * 1000) / 1000, 6)
    expect(t.positions[0].cpkProvisional).toBe(true)
  })
  it('without history the row stands alone (no price on the refit row -> N/A)', () => {
    const t = buildTwin([history[2]], { now: new Date('2025-12-01') })
    expect(t.positions[0].cpk).toBeNull()
  })
  it('tyreCount stays the number of fitted positions (rows on the asset)', () => {
    expect(buildTwin([history[2]], { now: new Date('2025-12-01'), history }).tyreCount).toBe(1)
  })
})
