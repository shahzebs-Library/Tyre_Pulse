import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: a chainable, thenable query builder recording table,
// select cols/opts, eq/not/is/range/order/limit filters and insert/update/
// upsert/delete payloads, resolving to a configurable { data, error, count }.
// DataCleaning uses STRICT country eq (never the null-safe OR), so `or` is never
// expected here.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], not: [], is: [], order: [], range: null, limit: null }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      limit(n) { calls.limit = n; return b },
      range(f, t) { calls.range = [f, t]; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      not(c, op, v) { calls.not.push([c, op, v]); return b },
      is(c, v) { calls.is.push([c, v]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      upsert(v, opts) { calls.upsert = v; calls.upsertOpts = opts; return b },
      delete() { calls.delete = true; return b },
      gte(c, v) { calls.gte = [c, v]; return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, rpc: vi.fn(async () => state.result) } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const dc = await import('../lib/api/dataCleaning')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.supabase.rpc.mockClear()
})

describe('service layer - dataCleaning', () => {
  it('countTyreRecords requests a head exact-count, strict country eq + cleaned', async () => {
    await dc.countTyreRecords({ country: 'KSA', cleaned: false })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.selectOpts).toEqual({ count: 'exact', head: true })
    expect(h.state.last._calls.eq).toContainEqual(['cleaned', false])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
  })

  it('countTyreRecords omits country eq for "All" and omits cleaned when undefined', async () => {
    await dc.countTyreRecords({ country: 'All' })
    expect(h.state.last._calls.eq.find(([c]) => c === 'country')).toBeUndefined()
    expect(h.state.last._calls.eq.find(([c]) => c === 'cleaned')).toBeUndefined()
  })

  it('countTyreRecords surfaces the raw count the page reads', async () => {
    h.state.result = { data: null, error: null, count: 42 }
    const res = await dc.countTyreRecords({ country: 'All', cleaned: true })
    expect(res.count).toBe(42)
  })

  it('listUncleanedSites selects site, excludes null site, cleaned=false, country-scoped', async () => {
    await dc.listUncleanedSites({ country: 'UAE' })
    expect(h.state.last._calls.select).toBe('site')
    expect(h.state.last._calls.not).toContainEqual(['site', 'is', null])
    expect(h.state.last._calls.eq).toContainEqual(['cleaned', false])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'UAE'])
  })

  it('listPendingRecords: cleaned=false, newest-first, ranged, strict country + site eq', async () => {
    await dc.listPendingRecords({ country: 'KSA', site: 'Yard-1', from: 0, to: 49 })
    expect(h.state.last._calls.eq).toContainEqual(['cleaned', false])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(h.state.last._calls.eq).toContainEqual(['site', 'Yard-1'])
    expect(h.state.last._calls.order).toContainEqual(['created_at', { ascending: false }])
    expect(h.state.last._calls.range).toEqual([0, 49])
  })

  it('listPendingRecords requests an exact total count so the pager can size itself', async () => {
    await dc.listPendingRecords({ country: 'All', from: 0, to: 49 })
    expect(h.state.last._calls.selectOpts).toEqual({ count: 'exact' })
  })

  it('listPendingRecords surfaces the raw count the page reads into totalPending', async () => {
    h.state.result = { data: [], error: null, count: 137 }
    const res = await dc.listPendingRecords({ country: 'All', from: 0, to: 49 })
    expect(res.count).toBe(137)
  })

  it('listPendingRecords omits site eq when not provided', async () => {
    await dc.listPendingRecords({ country: 'All', from: 50, to: 99 })
    expect(h.state.last._calls.eq.find(([c]) => c === 'site')).toBeUndefined()
    expect(h.state.last._calls.eq.find(([c]) => c === 'country')).toBeUndefined()
    expect(h.state.last._calls.range).toEqual([50, 99])
  })

  it('listCleanedRecords: scopes the selected country and site', async () => {
    await dc.listCleanedRecords({ country: 'KSA', site: 'A' })
    expect(h.state.last._calls.eq).toEqual(expect.arrayContaining([['cleaned', true], ['country', 'KSA'], ['site', 'A']]))
    expect(h.state.last._calls.limit).toBe(500)
  })

  it('Approve All reads only the selected country/site in a stable order', async () => {
    await dc.listPendingForApproveAll({ country: 'KSA', site: 'S1', from: 0, to: 499 })
    expect(h.state.last._calls.eq).toEqual(expect.arrayContaining([['cleaned', false], ['country', 'KSA'], ['site', 'S1']]))
    expect(h.state.last._calls.select).toContain('cleaned')
    expect(h.state.last._calls.order).toContainEqual(['id', undefined])
    expect(h.state.last._calls.range).toEqual([0, 499])
  })

  it('listActiveSerialRecords filters km_at_removal IS NULL, country-scoped', async () => {
    await dc.listActiveSerialRecords({ country: 'KSA' })
    expect(h.state.last._calls.is).toContainEqual(['km_at_removal', null])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
  })

  it('listPressureRecords excludes null pressure and is country-scoped', async () => {
    await dc.listPressureRecords({ country: 'Oman' })
    expect(h.state.last._calls.select).toContain('pressure_reading')
    expect(h.state.last._calls.not).toContainEqual(['pressure_reading', 'is', null])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'Oman'])
  })

  it('listOdometerRecords requires both fitment + removal km present', async () => {
    await dc.listOdometerRecords({ country: 'All' })
    expect(h.state.last._calls.not).toContainEqual(['km_at_removal', 'is', null])
    expect(h.state.last._calls.not).toContainEqual(['km_at_fitment', 'is', null])
  })

  it('listLifeRecords selects cost_per_tyre and requires both km fields', async () => {
    await dc.listLifeRecords({ country: 'All' })
    expect(h.state.last._calls.select).toContain('cost_per_tyre')
    expect(h.state.last._calls.not).toContainEqual(['km_at_removal', 'is', null])
  })

  it('listAssetNumbers selects asset_no, excludes null, country-scoped', async () => {
    await dc.listAssetNumbers({ country: 'KSA' })
    expect(h.state.last._calls.select).toBe('asset_no')
    expect(h.state.last._calls.not).toContainEqual(['asset_no', 'is', null])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
  })

  it('recent inspections use the same country as the tyre quality check', async () => {
    await dc.listRecentInspections({ cutoff: '2026-06-04', country: 'KSA' })
    expect(h.state.last._table).toBe('inspections')
    expect(h.state.last._calls.gte).toEqual(['inspection_date', '2026-06-04'])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
  })

  const changes = [{ id: 'a', patch: { remarks: 'Reviewed' }, expected: { remarks: null } }]
  it('writes only through the scoped atomic RPC and confirms exact IDs', async () => {
    h.state.result = { data: { ids: ['a'] }, error: null }
    expect(await dc.correctTyreRecords(changes, { country: 'KSA', site: 'S1', action: 'review' })).toEqual(['a'])
    expect(h.supabase.rpc).toHaveBeenCalledWith('admin_clean_tyre_records', { p_changes: changes, p_country: 'KSA', p_site: 'S1', p_action: 'review' })
    expect(h.state.last).toBeNull()
  })

  it('backend failure or missing migration fails closed with no table fallback', async () => {
    h.state.result = { data: null, error: { message: 'Permission denied', code: '42501' } }
    await expect(dc.correctTyreRecords(changes)).rejects.toMatchObject({ code: '42501' })
    expect(h.state.last).toBeNull()
  })

  it.each([null, {ids: []}, {ids: ['other']}, {ids: ['a', 'a']}])('incomplete confirmation fails instead of reporting success: %j', async data => {
    h.state.result = { data, error: null }
    await expect(dc.correctTyreRecords(changes)).rejects.toThrow('confirmation was incomplete')
  })

  it('duplicate IDs are rejected before sending a mutation', async () => {
    await expect(dc.correctTyreRecords([...changes,...changes])).rejects.toThrow('distinct')
    expect(h.supabase.rpc).not.toHaveBeenCalled()
  })

  it('classification and undo carry the original values and reviewed source text', () => {
    const record = { id: 'a', category: 'Puncture', risk_level: 'Medium', remarks_cleaned: 'Puncture', cleaned: true, description: 'puncture', remarks: null }
    const change = dc.classificationChange(record,null,true)
    expect(change.patch).toEqual({ category: null, risk_level: null, remarks_cleaned: null, cleaned: false })
    expect(change.expected).toEqual({ category: 'Puncture', risk_level: 'Medium', remarks_cleaned: 'Puncture', cleaned: true, description: 'puncture', remarks: null })
  })
})
