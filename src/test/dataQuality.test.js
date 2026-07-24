import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal Supabase mock exposing only rpc (getDataQualitySummary uses it).
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, calls: [] }
  const supabase = {
    rpc: (fn, args) => {
      state.calls.push([fn, args])
      return Promise.resolve(state.result)
    },
  }
  return { state, supabase }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { getDataQualitySummary, gradeFor } = await import('../lib/api/dataQuality')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.calls = []
})

describe('service layer - getDataQualitySummary', () => {
  it('calls the recon_data_quality_summary RPC and returns its array payload', async () => {
    const payload = [{ country: 'KSA', tyres: 6016, tyres_no_brand: 149, tyres_linked: 6016, wo_linked: 59446, wo_total: 59446, fleet: 1019 }]
    h.state.result = { data: payload, error: null }
    const rows = await getDataQualitySummary()
    expect(rows).toEqual(payload)
    expect(h.state.calls[0][0]).toBe('recon_data_quality_summary')
  })

  it('returns [] on an RPC error', async () => {
    h.state.result = { data: null, error: { message: 'nope' } }
    const rows = await getDataQualitySummary()
    expect(rows).toEqual([])
  })

  it('returns [] when the payload is not an array', async () => {
    h.state.result = { data: { not: 'array' }, error: null }
    const rows = await getDataQualitySummary()
    expect(rows).toEqual([])
  })
})

describe('pure gradeFor', () => {
  it('grades a fully linked, fully branded country as A / 100', () => {
    const g = gradeFor({ tyres: 1000, tyres_no_brand: 0, tyres_linked: 1000, wo_linked: 500, wo_total: 500 })
    expect(g).toEqual({ score: 100, grade: 'A' })
  })

  it('drops the grade when linkage and brand completeness are poor', () => {
    // tyre linkage 0, wo linkage 0, brand complete 0 -> score 0 -> F
    const g = gradeFor({ tyres: 1000, tyres_no_brand: 1000, tyres_linked: 0, wo_linked: 0, wo_total: 1000 })
    expect(g).toEqual({ score: 0, grade: 'F' })
  })

  it('treats empty denominators as perfect (no fault) so they never drag the grade', () => {
    const g = gradeFor({ tyres: 0, tyres_no_brand: 0, tyres_linked: 0, wo_linked: 0, wo_total: 0 })
    expect(g).toEqual({ score: 100, grade: 'A' })
  })

  it('blends the three weighted ratios (0.4 tyre-link / 0.3 wo-link / 0.3 brand)', () => {
    // tyre linkage 1 (0.4) + wo linkage 0 (0) + brand complete 1 (0.3) = 0.7 -> 70 -> C
    const g = gradeFor({ tyres: 100, tyres_no_brand: 0, tyres_linked: 100, wo_linked: 0, wo_total: 100 })
    expect(g).toEqual({ score: 70, grade: 'C' })
  })

  it('is safe on missing / undefined input', () => {
    expect(gradeFor()).toEqual({ score: 100, grade: 'A' })
  })
})
