import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { results: {}, calls: [] }
  return { state, supabase: { from(table) {
    const calls = { table }
    state.calls.push(calls)
    const query = {
      select(columns, options) { calls.select = { columns, options }; return query },
      order() { return query }, or(value) { calls.country = value; return query },
      ilike(column, value) { calls.search = [column, value]; return query },
      limit(value) { calls.limit = value; return query },
      then(resolve, reject) { return Promise.resolve(state.results[table] ?? { data: [], count: 0, error: null }).then(resolve, reject) },
    }
    return query
  } } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))
import { runGlobalSearch, listSavedSearches } from '../lib/api/advancedSearch'
beforeEach(() => { h.state.results = {}; h.state.calls = [] })

describe('global search completeness', () => {
  it('keeps successful groups and reports an unavailable source explicitly', async () => {
    h.state.results.vehicle_fleet = { data: [{ id: 'a' }], count: 1, error: null }
    h.state.results.inspections = { data: null, error: { code: '42P01', message: 'relation missing' } }
    const out = await runGlobalSearch({ term: 'TR', country: 'KSA' })
    expect(out.assets).toEqual([{ id: 'a' }])
    expect(out.errors.inspections).toBeTruthy()
    expect(out.complete).toBe(false)
    expect(out.totalMatches).toBeNull()
    expect(out.coverage.inspections.status).toBe('error')
  })
  it('denied requests do not become a successful zero-match search', async () => {
    h.state.results.vehicle_fleet = { data: null, error: { code: '42501', message: 'denied' } }
    const out = await runGlobalSearch({ term: 'TR', entity: 'assets' })
    expect(out.errors.assets).toBeTruthy()
    expect(out.complete).toBe(false)
    expect(out.totalMatches).toBeNull()
  })
  it('distinguishes returned rows from exact matches beyond the display limit', async () => {
    h.state.results.vehicle_fleet = { data: Array.from({ length: 25 }, (_, id) => ({ id })), count: 137, error: null }
    const out = await runGlobalSearch({ term: 'TR', entity: 'assets', country: 'KSA' })
    expect(out.total).toBe(25)
    expect(out.totalMatches).toBe(137)
    expect(out.complete).toBe(true)
    expect(out.coverage.assets.truncated).toBe(true)
    expect(h.state.calls[0].select.options).toEqual({ count: 'exact' })
  })
  it('missing count metadata cannot be saved as an exact total', async () => {
    h.state.results.vehicle_fleet = { data: [{ id: 'a' }], error: null }
    const out = await runGlobalSearch({ term: 'TR', entity: 'assets' })
    expect(out.total).toBe(1)
    expect(out.complete).toBe(false)
    expect(out.totalMatches).toBeNull()
  })
  it('a successful zero count is distinguishable from an unavailable query', async () => {
    const out = await runGlobalSearch({ term: 'TR', entity: 'assets' })
    expect(out.errors).toEqual({})
    expect(out.totalMatches).toBe(0)
    expect(out.complete).toBe(true)
  })
  it('saved-search storage errors are surfaced rather than an empty library', async () => {
    h.state.results.saved_searches = { data: null, error: { code: '42P01', message: 'relation missing' } }
    await expect(listSavedSearches()).rejects.toMatchObject({ code: '42P01' })
  })
})
