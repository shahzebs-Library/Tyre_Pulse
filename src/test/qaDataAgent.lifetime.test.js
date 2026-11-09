import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ supabase: {} }))
const call = vi.fn(async () => ({ response: 'ok' }))
vi.mock('../lib/agents/index', () => ({ callAiEdgeFunction: (...a) => call(...a) }))
import { threeVehicles, sameVehicleRefit } from './lifetimeFixture.groupD'

describe('qaDataAgent life on physical tyres', async () => {
  const mod = await import('../lib/agents/qaDataAgent')
  const run = Object.values(mod).find((f) => typeof f === 'function')
  it('a tyre fitted on 3 vehicles is one life (km summed)', async () => {
    const r = await run('quality?', { records: threeVehicles() })
    expect(r.checks.avgTyreLifeKm).toBe(50000)
    expect(r.checks.physicalTyres).toBe(2)
  })
  it('a refit on the same vehicle is one tyre, not two lives', async () => {
    const r = await run('quality q2', { records: sameVehicleRefit() })
    expect(r.checks.avgTyreLifeKm).toBe(40000)
  })
  it('repeated-serial and odometer checks stay per fitment row', async () => {
    const r = await run('quality q3', { records: sameVehicleRefit() })
    expect(r.checks.totalRecords).toBe(2)
    expect(r.checks.duplicateSerials.serials[0].count).toBe(2)
  })
})
