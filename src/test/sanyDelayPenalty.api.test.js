import { describe, it, expect, vi, beforeEach } from 'vitest'

let pages = []
const calls = []
vi.mock('../lib/api/_client', async (orig) => {
  const real = await orig()
  const builder = () => {
    const b = {
      select: () => b, order: (...a) => { calls.push(['order', ...a]); return b }, eq: () => b, gte: () => b, lte: () => b,
      range: () => Promise.resolve(pages.shift() ?? { data: [], error: null }),
    }
    return b
  }
  return { ...real, supabase: { from: () => builder() } }
})

import { listDelayPenalties } from '../lib/api/sanyDelayPenalty'

beforeEach(() => { pages = []; calls.length = 0 })

describe('listDelayPenalties', () => {
  it('returns rows and orders by a unique id tiebreak', async () => {
    pages = [{ data: [{ id: 'a' }], error: null }]
    expect(await listDelayPenalties({ country: 'KSA' })).toEqual([{ id: 'a' }])
    expect(calls.some((c) => c[1] === 'id')).toBe(true)
  })
  it('degrades to [] only when the table is not provisioned', async () => {
    pages = [{ data: null, error: { code: '42P01', message: 'relation missing' } }]
    expect(await listDelayPenalties()).toEqual([])
  })
  it('throws on a real error instead of showing an empty ledger', async () => {
    pages = [{ data: null, error: { code: '42501', message: 'permission denied for table x' } }]
    await expect(listDelayPenalties()).rejects.toThrow()
  })
})
