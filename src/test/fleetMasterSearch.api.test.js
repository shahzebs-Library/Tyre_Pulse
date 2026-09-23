import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ calls: [] }))
vi.mock('../lib/api/_client', async () => {
  const { fetchAllPages } = await vi.importActual('../lib/fetchAll')
  return {
    fetchAllPages, fetchAllRpcPages: vi.fn(), unwrap: result => result.data,
    ServiceError: class extends Error {},
    applyCountry: (query, country) => country ? query.eq('country', country) : query,
    supabase: { from: () => {
      const calls = { or: [], order: [], eq: [] }
      h.calls.push(calls)
      const query = {
        select: () => query, range: () => query,
        order: column => { calls.order.push(column); return query },
        eq: (column, value) => { calls.eq.push([column, value]); return query },
        or: value => { calls.or.push(value); return query },
        then: resolve => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
      }
      return query
    } },
  }
})
import { listFleetRecords, getFleetSummary, fetchAllFleetRecords } from '../lib/api/assets'
beforeEach(() => { h.calls.length = 0 })

it.each([['list', listFleetRecords], ['summary', getFleetSummary], ['export', fetchAllFleetRecords]])('%s treats punctuation and wildcards literally in all four search fields', async (_name, read) => {
  const search = 'A(1),50%_*\\"'
  await read({ search, country: 'KSA', site: 'NHC', status: 'Active', page: 0, pageSize: 25 })
  const expression = h.calls[0].or[0]
  // Parse each quoted PostgREST operand without splitting embedded commas.
  const conditions = [...expression.matchAll(/(asset_no|fleet_number|make|model)\.imatch\.("(?:\\.|[^"\\])*")/g)]
  expect(conditions).toHaveLength(4)
  for (const [, , quoted] of conditions) {
    const pattern = JSON.parse(quoted)
    const matcher = new RegExp(pattern, 'i')
    expect(matcher.test(`prefix ${search} suffix`)).toBe(true)
    expect(matcher.test('A150X_999')).toBe(false)
  }
  expect(h.calls[0].eq).toContainEqual(['country', 'KSA'])
  expect(h.calls[0].eq).toContainEqual(['site', 'NHC'])
})

it('uses a unique tiebreaker when paginating duplicated asset numbers', async () => {
  await listFleetRecords({ page: 1, pageSize: 25 })
  expect(h.calls[0].order).toEqual(['asset_no', 'id'])
})
