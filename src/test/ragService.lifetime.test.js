import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase', () => ({ supabase: {} }))
import { summarizeTyreKpis, describeCpkBasis, assembleContext } from '../lib/ragService'
import { threeVehicles, sameVehicleRefit, REFIT_CPK } from './lifetimeFixture.groupD'

describe('ragService AI context on physical tyres', () => {
  it('a tyre fitted on 3 vehicles is one tyre, price once, km summed', () => {
    const k = summarizeTyreKpis(threeVehicles().map(({ serial_no, ...r }) => ({ ...r, tyre_serial: serial_no })))
    expect(k.physicalTyres).toBe(2)
    expect(k.avgCpk).toBeCloseTo(3000 / 100000, 10)
    expect(k.avgLifeKm).toBe(50000)
  })
  it('a refit on the same vehicle is not a second purchase', () => {
    const k = summarizeTyreKpis(sameVehicleRefit())
    expect(k.totalTyreCost).toBe(1000)
    expect(k.avgCpk).toBeCloseTo(REFIT_CPK, 10)
  })
  it('replacements stay per fitment row and the context states the CPK kind + coverage', () => {
    const k = summarizeTyreKpis(sameVehicleRefit())
    expect(k.totalReplacements).toBe(2)
    expect(describeCpkBasis(k)).toMatch(/Physical tyre lifetime CPK/)
    expect(describeCpkBasis(k)).toMatch(/1 of 1 tyres measurable/)
    const ctx = assembleContext({ kpiData: sameVehicleRefit() })
    expect(ctx).toMatch(/Fleet CPK=/)
    expect(ctx).toMatch(/1 physical tyres/)
  })
})
