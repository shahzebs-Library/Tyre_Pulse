import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: chainable, thenable query builder recording table,
// select cols, order/eq/or/limit filters and range (for the paged fleet feed
// via the real fetchAllPages).
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], order: [], range: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols, opts) { calls.select = cols; calls.selectOpts = opts; return b },
      order(c, o) { calls.order.push([c, o]); return b },
      limit(n) { calls.limit = n; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      range(f, t) { calls.range.push([f, t]); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const vh = await import('../lib/api/vehicleHistory')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('service layer - vehicleHistory', () => {
  it('listFleetTyreRecords pages, oldest first, STRICT eq country scope', async () => {
    await vh.listFleetTyreRecords({ country: 'KSA' })
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toBe('*')
    expect(h.state.last._calls.order).toContainEqual(['issue_date', { ascending: true }])
    expect(h.state.last._calls.eq).toContainEqual(['country', 'KSA'])
    expect(h.state.last._calls.range.length).toBeGreaterThan(0)
  })

  it('listFleetTyreRecords applies no country eq for "All"', async () => {
    await vh.listFleetTyreRecords({ country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('getVehicleFleet reads vehicle_fleet', async () => {
    await vh.getVehicleFleet()
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(h.state.last._calls.select).toBe('*')
  })

  it('listAssetActions requires exact asset identity and pages all history', async () => {
    await vh.listAssetActions('A1')
    expect(h.state.last._table).toBe('corrective_actions')
    expect(h.state.last._calls.eq).toContainEqual(['asset_no', 'A1'])
    expect(h.state.last._calls.or).toHaveLength(0)
    expect(h.state.last._calls.range.length).toBeGreaterThan(0)
  })

  it('listAssetRca filters by asset_no and pages history', async () => {
    await vh.listAssetRca('A1')
    expect(h.state.last._table).toBe('rca_records')
    expect(h.state.last._calls.eq).toContainEqual(['asset_no', 'A1'])
    expect(h.state.last._calls.range.length).toBeGreaterThan(0)
  })

  it('listAssetInspections filters by asset_no and pages history', async () => {
    await vh.listAssetInspections('A1')
    expect(h.state.last._table).toBe('inspections')
    expect(h.state.last._calls.eq).toContainEqual(['asset_no', 'A1'])
    expect(h.state.last._calls.range.length).toBeGreaterThan(0)
  })

  it('listAssetTyreRecords filters by asset_no, newest issue_date first', async () => {
    await vh.listAssetTyreRecords('A1')
    expect(h.state.last._table).toBe('tyre_records')
    expect(h.state.last._calls.select).toBe('position,risk_level,brand,serial_no,issue_date')
    expect(h.state.last._calls.eq).toContainEqual(['asset_no', 'A1'])
    expect(h.state.last._calls.order).toContainEqual(['issue_date', { ascending: false }])
  })
})
