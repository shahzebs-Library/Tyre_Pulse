// Store hints (sites that already hold stock or locations) and the transfer request list.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ tables: {}, calls: [] }))
const builder = (table) => {
  const call = { table, filters: [] }
  h.calls.push(call)
  const b = {
    select: (cols) => { call.cols = cols; return b },
    eq: (k, v) => { call.filters.push(['eq', k, v]); return b },
    not: (k, op, v) => { call.filters.push(['not', k, op, v]); return b },
    order: () => b,
    range: () => b,
    limit: (n) => { call.limit = n; return b },
    then: (res, rej) => Promise.resolve(h.tables[table] || { data: [], error: null, count: 0 }).then(res, rej),
  }
  return b
}
vi.mock('../lib/api/_client', async (orig) => ({ ...(await orig()), supabase: { from: (t) => builder(t), rpc: vi.fn() } }))

import { listStoreSiteHints, listTransferRequests } from '../lib/api/physicalInventory'

describe('physical inventory store hints', () => {
  beforeEach(() => { h.tables = {}; h.calls = [] })

  it('merges stock and location sites, upper-cased and unique, bounded reads', async () => {
    h.tables.stock_records = { data: [{ site: 'NHC' }, { site: 'nhc ' }, { site: 'DIRIYAH' }], error: null }
    h.tables.inventory_locations = { data: [{ site: 'RIY-MET' }], error: null }
    const r = await listStoreSiteHints('KSA')
    expect(r.sort()).toEqual(['DIRIYAH', 'NHC', 'RIY-MET'])
    expect(h.calls.every((c) => c.limit === 1000 && c.filters.some((f) => f[1] === 'country' && f[2] === 'KSA'))).toBe(true)
  })
  it('a failed read degrades to the other source, no country returns nothing', async () => {
    h.tables.stock_records = { data: null, error: { code: '42501', message: 'denied' } }
    h.tables.inventory_locations = { data: [{ site: 'NHC' }], error: null }
    expect(await listStoreSiteHints('KSA')).toEqual(['NHC'])
    expect(await listStoreSiteHints('')).toEqual([])
  })
  it('transfer requests are filtered by status and country and carry the item', async () => {
    h.tables.inventory_transfer_requests = { data: [{ id: 't1', item: { item_code: 'X1' } }], error: null, count: 1 }
    const r = await listTransferRequests({ status: 'requested', country: 'KSA' })
    expect(r).toMatchObject({ status: 'ok', total: 1 })
    const c = h.calls.at(-1)
    expect(c.cols).toContain('item:material_master(item_code, item_name)')
    expect(c.filters).toEqual(expect.arrayContaining([['eq', 'status', 'requested'], ['eq', 'country', 'KSA']]))
  })
})
