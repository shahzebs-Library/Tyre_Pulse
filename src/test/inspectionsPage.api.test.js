import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors src/test/api.test.js) extended with
// the builders the Inspections-page functions use: select (records columns),
// order (records column + options), range, delete. Records the table queried
// and the eq/or/insert/update filters applied, and resolves to a configurable
// { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], select: [], order: [], range: null, delete: false }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select.push(cols); return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      range(from, to) { calls.range = [from, to]; return b },
      limit() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const inspectionsApi = await import('../lib/api/inspections')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('inspections page service — listInspectionsForPage', () => {
  it('selects wide PAGE_COLS, orders scheduled_date desc, ranges, and scopes', async () => {
    await inspectionsApi.listInspectionsForPage({ from: 0, to: 999, country: 'Oman', createdBy: 'u1' })
    const c = h.state.last._calls
    expect(h.state.last._table).toBe('inspections')
    // wide column set (superset fields the page renders)
    const cols = c.select[0]
    expect(cols).toContain('tyre_conditions')
    expect(cols).toContain('linked_action_id')
    expect(cols).toContain('approval_status')
    expect(cols).toContain('vehicle_type')
    expect(cols).toContain('odometer_km')
    expect(cols).toContain('approver_signature')
    expect(cols).toContain('locked_at')
    expect(cols).not.toContain('organisation_id')
    // order + paging + scoping mirror the page's fetchAllPages callback
    expect(c.order).toContainEqual(['scheduled_date', { ascending: false }])
    expect(c.range).toEqual([0, 999])
    expect(c.eq).toContainEqual(['country', 'Oman'])
    expect(c.eq).toContainEqual(['created_by', 'u1'])
  })

  it('does NOT filter country for "All" and omits created_by when absent', async () => {
    await inspectionsApi.listInspectionsForPage({ from: 0, to: 999, country: 'All' })
    expect(h.state.last._calls.eq).toHaveLength(0)
  })

  it('returns the raw { data, error } result (drop-in for fetchAllPages, no throw)', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    const res = await inspectionsApi.listInspectionsForPage({ from: 0, to: 999, country: 'All' })
    expect(res).toEqual({ data: null, error: { message: 'boom', code: '42501' } })
  })
})

describe('inspections page service — getInspectionForPage', () => {
  it('looks up by id via single() and unwraps data', async () => {
    h.state.result = { data: { id: 'i1', tyre_conditions: [] }, error: null }
    const row = await inspectionsApi.getInspectionForPage('i1')
    expect(h.state.last._table).toBe('inspections')
    expect(h.state.last._calls.eq).toContainEqual(['id', 'i1'])
    expect(row).toEqual({ id: 'i1', tyre_conditions: [] })
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(inspectionsApi.getInspectionForPage('i1')).rejects.toBeInstanceOf(ServiceError)
    await expect(inspectionsApi.getInspectionForPage('i1')).rejects.toMatchObject({ code: '42501' })
  })
})

describe('inspections page service — patchInspection', () => {
  it('passes the patch and scopes by id, without a returning select', async () => {
    await inspectionsApi.patchInspection('i1', { status: 'Done', linked_action_id: 'ca1' })
    expect(h.state.last._calls.update).toEqual({ status: 'Done', linked_action_id: 'ca1' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'i1'])
    expect(h.state.last._calls.select).toHaveLength(0)
  })
})

describe('inspections page service — insert/delete', () => {
  it('insertInspection inserts without a returning select', async () => {
    await inspectionsApi.insertInspection({ title: 'T' })
    expect(h.state.last._calls.insert).toEqual({ title: 'T' })
    expect(h.state.last._calls.select).toHaveLength(0)
  })

  it('insertInspectionReturning inserts and returns the row via select().single()', async () => {
    h.state.result = { data: { id: 'i9' }, error: null }
    const row = await inspectionsApi.insertInspectionReturning({ title: 'T' })
    expect(h.state.last._calls.insert).toEqual({ title: 'T' })
    expect(h.state.last._calls.select).toHaveLength(1)
    expect(row).toEqual({ id: 'i9' })
  })

  it('deleteInspection deletes by id', async () => {
    await inspectionsApi.deleteInspection('i1')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'i1'])
  })
})

describe('inspections page service — vehicle_fleet helpers', () => {
  it('listInspectionVehicles reads site/asset_no/vehicle_type from vehicle_fleet', async () => {
    h.state.result = { data: [{ site: 'S1', asset_no: 'A1', vehicle_type: 'Bus' }], error: null }
    const rows = await inspectionsApi.listInspectionVehicles()
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(h.state.last._calls.select[0]).toBe('site,asset_no,vehicle_type')
    expect(rows).toEqual([{ site: 'S1', asset_no: 'A1', vehicle_type: 'Bus' }])
  })

  it('findVehicleByAsset looks up asset_no via maybeSingle', async () => {
    h.state.result = { data: { asset_no: 'A1', vehicle_type: 'Bus', site: 'S1' }, error: null }
    const v = await inspectionsApi.findVehicleByAsset('A1')
    expect(h.state.last._table).toBe('vehicle_fleet')
    expect(h.state.last._calls.eq).toContainEqual(['asset_no', 'A1'])
    expect(v).toEqual({ asset_no: 'A1', vehicle_type: 'Bus', site: 'S1' })
  })
})
