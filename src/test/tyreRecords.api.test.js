import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: chainable, thenable query builder recording table,
// select cols/opts, order/eq/or/not/in/range filters and insert/update/delete
// payloads, resolving to a configurable { data, error, count }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], not: [], in: [], order: [], range: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      not(c, op, v) { calls.not.push([c, op, v]); return b },
      in(c, v) { calls.in.push([c, v]); return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      range(f, t) { calls.range.push([f, t]); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const tyreRecords = await import('../lib/api/tyreRecords')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - tyreRecords', () => {
  it('listSiteOptions / listBrandOptions read distinct non-null values', async () => {
    await tyreRecords.listSiteOptions()
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toBe('site')
    expect(h.state.last._calls.not).toContainEqual(['site', 'is', null])

    await tyreRecords.listBrandOptions()
    expect(h.state.last._calls.select).toBe('brand')
    expect(h.state.last._calls.not).toContainEqual(['brand', 'is', null])
  })

  it('listRecords requests exact count, paged range, filters + NULL-safe country', async () => {
    await tyreRecords.listRecords({
      page: 2, pageSize: 50, search: 'ABC', siteFilter: 'Riyadh',
      brandFilter: 'Bridgestone', riskFilter: 'High', country: 'KSA',
    })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.selectOpts).toEqual({ count: 'exact' })
    expect(h.state.last._calls.order).toContainEqual(['issue_date', { ascending: false }])
    expect(h.state.last._calls.range).toContainEqual([100, 149])
    expect(h.state.last._calls.or[0]).toContain('asset_no.ilike.%ABC%')
    expect(h.state.last._calls.eq).toContainEqual(['site', 'Riyadh'])
    expect(h.state.last._calls.eq).toContainEqual(['brand', 'Bridgestone'])
    expect(h.state.last._calls.eq).toContainEqual(['risk_level', 'High'])
    // NULL-inclusive country scope (OR filter), not a strict eq on country.
    expect(h.state.last._calls.or).toContain('country.eq.KSA,country.is.null')
  })

  it('listRecords omits filters/country when not provided', async () => {
    await tyreRecords.listRecords({ page: 0, pageSize: 50, country: 'All' })
    expect(h.state.last._calls.or).toHaveLength(0)
    expect(h.state.last._calls.eq).toHaveLength(0)
    expect(h.state.last._calls.range).toContainEqual([0, 49])
  })

  it('listAllRecords selects all rows with the same filters, no count/range', async () => {
    await tyreRecords.listAllRecords({ search: 'X', country: 'UAE' })
    expect(h.state.last._calls.select).toBe('*')
    expect(h.state.last._calls.selectOpts).toBeUndefined()
    expect(h.state.last._calls.or).toContain('country.eq.UAE,country.is.null')
    expect(h.state.last._calls.range).toHaveLength(0)
  })

  it('updateRecord / insertRecord target tyre_records', async () => {
    await tyreRecords.updateRecord('r1', { site: 'X' })
    expect(h.state.last._calls.update).toEqual({ site: 'X' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'r1'])

    await tyreRecords.insertRecord({ asset_no: 'A1' })
    expect(h.state.last._calls.insert).toEqual({ asset_no: 'A1' })
  })

  it('updateRecordsByIds updates a batch via in()', async () => {
    await tyreRecords.updateRecordsByIds(['a', 'b'], { status: 'Scrapped' })
    expect(h.state.last._calls.update).toEqual({ status: 'Scrapped' })
    expect(h.state.last._calls.in).toContainEqual(['id', ['a', 'b']])
  })

  it('deleteRecordsByIds deletes a batch and returns ids for verification', async () => {
    await tyreRecords.deleteRecordsByIds(['a', 'b'])
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.in).toContainEqual(['id', ['a', 'b']])
    expect(h.state.last._calls.select).toBe('id')
  })
})
