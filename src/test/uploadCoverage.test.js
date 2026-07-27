/**
 * Upload coverage: the "did I forget yesterday's file?" read.
 *
 * The two behaviours worth pinning are the ones that decide whether people
 * trust the panel: it must degrade quietly on an older backend rather than
 * throwing an error page, and it must never present an occasional feed as a
 * missed daily upload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({ supabase: { rpc: (...a) => rpc(...a) } }))

const api = await import('../lib/api/uploadCoverage')

beforeEach(() => rpc.mockReset())

describe('getUploadCoverage', () => {
  it('passes the window and drops the All-countries token', async () => {
    rpc.mockResolvedValue({ data: { ok: true, sources: [], alerts: [] }, error: null })
    await api.getUploadCoverage({ days: 60, country: 'All' })
    expect(rpc).toHaveBeenCalledWith('get_upload_coverage', { p_days: 60, p_country: null })
    await api.getUploadCoverage({ country: 'KSA' })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_days: 30, p_country: 'KSA' })
  })

  it('degrades quietly on a backend without the RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function' } })
    await expect(api.getUploadCoverage({})).resolves.toEqual({ ok: false, sources: [], alerts: [] })
  })

  it('still throws on a real failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } })
    await expect(api.getUploadCoverage({})).rejects.toBeTruthy()
  })

  it('never returns non-array sources or alerts', async () => {
    rpc.mockResolvedValue({ data: { ok: true, sources: null, alerts: undefined }, error: null })
    const out = await api.getUploadCoverage({})
    expect(out.sources).toEqual([])
    expect(out.alerts).toEqual([])
  })
})

describe('cadenceLabel', () => {
  it('explains why a feed IS watched', () => {
    expect(api.cadenceLabel({ expect_daily: true, days_with_data: 25, days_elapsed: 29 }))
      .toBe('Watched daily - arrived on 25 of the last 29 days')
  })

  it('explains why a feed is NOT watched, rather than staying silent', () => {
    // an occasional feed must not look like a missed upload, and the reason has
    // to be visible or the rule reads as arbitrary
    expect(api.cadenceLabel({ expect_daily: false, days_with_data: 5, days_elapsed: 29 }))
      .toContain('not a daily feed')
  })

  it('tolerates a missing source', () => {
    expect(api.cadenceLabel(null)).toBe('')
  })
})

describe('sortByUrgency', () => {
  it('puts watched feeds first, then the most overdue', () => {
    const out = api.sortByUrgency([
      { src: 'occasional', expect_daily: false, days_since_last: 40 },
      { src: 'fresh',      expect_daily: true,  days_since_last: 1 },
      { src: 'stale',      expect_daily: true,  days_since_last: 5 },
    ])
    // the 40-day occasional feed must NOT outrank a genuinely late daily one
    expect(out.map((s) => s.src)).toEqual(['stale', 'fresh', 'occasional'])
  })

  it('handles a never-loaded source without NaN ordering', () => {
    const out = api.sortByUrgency([
      { src: 'never', expect_daily: true, days_since_last: null },
      { src: 'late',  expect_daily: true, days_since_last: 3 },
    ])
    expect(out[0].src).toBe('late')
  })

  it('does not mutate the input', () => {
    const src = [{ src: 'a', expect_daily: false }, { src: 'b', expect_daily: true }]
    api.sortByUrgency(src)
    expect(src[0].src).toBe('a')
  })
})
