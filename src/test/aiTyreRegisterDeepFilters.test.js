import { describe, it, expect, vi } from 'vitest'

function chain(result) {
  const q = {}
  for (const m of ['select', 'order', 'range', 'eq', 'gte', 'lt', 'or', 'in', 'limit']) q[m] = () => q
  q.then = (res, rej) => Promise.resolve(result).then(res, rej)
  return q
}
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => chain({ data: [], error: null, count: 0 })),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  },
}))

const { supabase } = await import('../lib/supabase')
const { listAiRegisterFiltered, hasDeepRegisterFilters } = await import('../lib/api/inspections')

describe('whole-register deep filters (server side)', () => {
  it('detects which filters need the database RPC', () => {
    expect(hasDeepRegisterFilters({})).toBe(false)
    expect(hasDeepRegisterFilters({ condition: 'all', aiStatus: 'all', review: 'all', photos: false })).toBe(false)
    expect(hasDeepRegisterFilters({ condition: 'Worn' })).toBe(true)
    expect(hasDeepRegisterFilters({ photos: true })).toBe(true)
    expect(hasDeepRegisterFilters({ aiStatus: 'none' })).toBe(true)
    expect(hasDeepRegisterFilters({ review: 'accepted' })).toBe(true)
  })

  it('without a deep filter uses the plain query (no RPC)', async () => {
    supabase.rpc.mockClear()
    await listAiRegisterFiltered({ condition: 'all', aiStatus: 'all', review: 'all', photos: false })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('sends every deep filter to ai_tyre_register_page and returns rows in RPC order with the exact total', async () => {
    supabase.rpc.mockImplementationOnce(async () => ({ data: [{ id: 'b', total: 7 }, { id: 'a', total: 7 }], error: null }))
    supabase.from.mockImplementationOnce(() => chain({ data: [{ id: 'a' }, { id: 'b' }], error: null }))
    const out = await listAiRegisterFiltered({
      page: 1, pageSize: 2, country: 'KSA', dateFrom: '2026-10-01', site: 'NHC', search: 'tm%1',
      condition: 'Worn', photos: true, aiStatus: 'failed', review: 'unreviewed',
    })
    const [name, args] = supabase.rpc.mock.calls.at(-1)
    expect(name).toBe('ai_tyre_register_page')
    expect(args).toMatchObject({
      p_country: 'KSA', p_from: '2026-10-01', p_to: null, p_site: 'NHC', p_search: 'tm1', p_condition: 'Worn',
      p_photos: true, p_ai_status: 'failed', p_review: 'unreviewed', p_offset: 2, p_limit: 2,
    })
    expect(out.data.map(r => r.id)).toEqual(['b', 'a'])
    expect(out.count).toBe(7)
  })

  it('surfaces an RPC error, and an empty page needs no second query', async () => {
    supabase.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'denied' } }))
    expect((await listAiRegisterFiltered({ review: 'accepted' })).error.message).toBe('denied')
    supabase.from.mockClear()
    supabase.rpc.mockImplementationOnce(async () => ({ data: [], error: null }))
    const empty = await listAiRegisterFiltered({ review: 'accepted' })
    expect(empty).toMatchObject({ data: [], count: 0, error: null })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('clamps page size and keeps injection characters out of the search term', async () => {
    supabase.rpc.mockImplementationOnce(async () => ({ data: [], error: null }))
    await listAiRegisterFiltered({ pageSize: 9999, page: -5, search: "a,b(c)*\\", condition: 'Worn' })
    const args = supabase.rpc.mock.calls.at(-1)[1]
    expect(args.p_limit).toBe(200)
    expect(args.p_offset).toBe(0)
    expect(args.p_search).toBe('abc')
  })
})
