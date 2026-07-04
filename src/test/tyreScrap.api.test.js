import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/dashboard.api.test.js)
// extended with upsert() for the disposal status write.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { range: null }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      range(f, t) { calls.range = [f, t]; return b },
      upsert(v, o) { calls.upsert = v; calls.upsertOpts = o; return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const scrapApi = await import('../lib/api/tyreScrap')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - tyreScrap', () => {
  it('listTyreDisposals reads tyre_record_id/status from tyre_disposals', async () => {
    await scrapApi.listTyreDisposals()
    expect(h.state.last._table).toBe('tyre_disposals')
    expect(h.state.last._calls.select).toBe('tyre_record_id,status')
  })

  it('listScrapTyreRecords selects the scrap column set and pages the range', async () => {
    await scrapApi.listScrapTyreRecords({ from: 0, to: 999 })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toContain('removal_reason')
    expect(h.state.last._calls.select).toContain('removal_date')
    expect(h.state.last._calls.range).toEqual([0, 999])
  })

  it('upsertTyreDisposal upserts with the tyre_record_id conflict target', async () => {
    await scrapApi.upsertTyreDisposal('t1', 'Disposed')
    expect(h.state.last._table).toBe('tyre_disposals')
    expect(h.state.last._calls.upsert).toEqual({ tyre_record_id: 't1', status: 'Disposed' })
    expect(h.state.last._calls.upsertOpts).toEqual({ onConflict: 'tyre_record_id' })
  })

  it('pass-through surfaces the raw { data, error } the page reads', async () => {
    h.state.result = { data: null, error: { message: 'boom' } }
    const res = await scrapApi.upsertTyreDisposal('t1', 'Disposed')
    expect(res).toEqual({ data: null, error: { message: 'boom' } })
  })
})
