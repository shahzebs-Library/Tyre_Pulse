/**
 * Upload coverage: the "did I forget yesterday's file?" read.
 *
 * The rules worth pinning are the ones that decide whether people trust the
 * panel. It must degrade quietly on an older backend rather than throwing an
 * error page, it must never present an occasional feed as a missed daily
 * upload, and - the defect that prompted the rewrite - it must never let one
 * country's silence hide behind another country's uploads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

const api = await import('../lib/api/uploadCoverage')

beforeEach(() => rpc.mockReset())

const feed = (o = {}) => ({
  src: 'expenses', label: 'Expenses', expect_daily: true, typical_gap_days: 1,
  quiet: false, base_data_days: 168, days_since_last: 1, missing_count: 0,
  missing_days: [], sites: [], ...o,
})

describe('getUploadCoverageDetail', () => {
  it('passes the window and drops the All-countries token', async () => {
    rpc.mockResolvedValue({ data: { ok: true, countries: [], files: [] }, error: null })
    await api.getUploadCoverageDetail({ days: 60, country: 'All' })
    expect(rpc).toHaveBeenCalledWith('get_upload_coverage_detail', { p_days: 60, p_country: null })
    await api.getUploadCoverageDetail({ country: 'KSA' })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_days: 30, p_country: 'KSA' })
  })

  it('degrades quietly on a backend without the view', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function' } })
    await expect(api.getUploadCoverageDetail({}))
      .resolves.toEqual({ ok: false, countries: [], files: [] })
  })

  it('still throws on a real failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } })
    await expect(api.getUploadCoverageDetail({})).rejects.toBeTruthy()
  })

  it('never returns non-array countries or files', async () => {
    rpc.mockResolvedValue({ data: { ok: true, countries: null, files: undefined }, error: null })
    const out = await api.getUploadCoverageDetail({})
    expect(out.countries).toEqual([])
    expect(out.files).toEqual([])
  })
})

describe('feedCadenceLabel', () => {
  it('explains a daily feed from its own history, not the window on screen', () => {
    // measuring cadence over the visible window is what let a stopped feed be
    // demoted out of being watched
    expect(api.feedCadenceLabel(feed({ base_data_days: 168 })))
      .toBe('Arrives daily - data on 168 days in the last 6 months')
  })

  it('describes a batch feed by its own typical gap', () => {
    expect(api.feedCadenceLabel(feed({ expect_daily: false, typical_gap_days: 22 })))
      .toContain('at most 22 days between uploads')
  })

  it('tolerates a missing feed', () => {
    expect(api.feedCadenceLabel(null)).toBe('')
  })
})

describe('feedProblem', () => {
  it('reports missed days for a daily feed', () => {
    expect(api.feedProblem(feed({ missing_count: 3 }))).toBe('3 days with no upload')
  })

  it('reports gone-quiet for a batch feed', () => {
    expect(api.feedProblem(feed({ expect_daily: false, quiet: true, days_since_last: 19 })))
      .toContain('Nothing for 19 days')
  })

  it('says nothing about a healthy feed', () => {
    expect(api.feedProblem(feed())).toBe('')
    expect(api.feedProblem(null)).toBe('')
  })

  it('does not call a batch feed late when it is inside its own normal gap', () => {
    // KSA job cards arrive in bulk: 21 days silent with a 22 day typical gap is
    // normal, and a fixed threshold would have called this broken
    expect(api.feedProblem(feed({
      expect_daily: false, quiet: false, typical_gap_days: 22, days_since_last: 21,
    }))).toBe('')
  })
})

describe('problemAreas', () => {
  const sites = [
    { site: 'NHC-ST', missing_count: 0, dormant: false },
    { site: 'QID-UP-ST', missing_count: 23, dormant: false },
    { site: 'CLOSED-ST', missing_count: 30, dormant: true },
  ]

  it('lists only areas that missed a day the feed actually arrived', () => {
    expect(api.problemAreas(feed({ sites })).map((s) => s.site)).toEqual(['QID-UP-ST'])
  })

  it('never reports a dormant area as missing', () => {
    // a closed site would otherwise alarm every morning forever
    expect(api.problemAreas(feed({ sites })).some((s) => s.dormant)).toBe(false)
  })

  it('tolerates a feed with no sites', () => {
    expect(api.problemAreas(feed())).toEqual([])
    expect(api.problemAreas(null)).toEqual([])
  })
})

describe('sortCountries', () => {
  it('puts the country with the most problems first', () => {
    const out = api.sortCountries([
      { country: 'Egypt', missing_count: 0, quiet_count: 0, total_rows: 900 },
      { country: 'KSA', missing_count: 24, quiet_count: 1, total_rows: 100 },
      { country: 'UAE', missing_count: 2, quiet_count: 0, total_rows: 500 },
    ])
    expect(out.map((c) => c.country)).toEqual(['KSA', 'UAE', 'Egypt'])
  })

  it('falls back to rows at stake when problems tie', () => {
    const out = api.sortCountries([
      { country: 'A', missing_count: 0, quiet_count: 0, total_rows: 10 },
      { country: 'B', missing_count: 0, quiet_count: 0, total_rows: 99 },
    ])
    expect(out[0].country).toBe('B')
  })

  it('does not mutate the input and tolerates junk', () => {
    const src = [{ country: 'A', missing_count: 0 }, { country: 'B', missing_count: 5 }]
    api.sortCountries(src)
    expect(src[0].country).toBe('A')
    expect(api.sortCountries(null)).toEqual([])
  })
})
