import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted Supabase mock: a chainable, awaitable query builder. Mirrors the
// pmPrograms.test pattern; adds gte/lte used by the wash date-range filter.
const h = vi.hoisted(() => {
  const state = { tables: {}, calls: [] }
  const METHODS = [
    'select', 'eq', 'in', 'order', 'limit', 'or', 'range', 'neq', 'gte', 'lte',
    'maybeSingle', 'single', 'insert', 'update', 'delete',
  ]
  function makeBuilder(table) {
    const rec = { table, ops: [] }
    state.calls.push(rec)
    const builder = {}
    for (const m of METHODS) {
      builder[m] = (...args) => { rec.ops.push([m, args]); return builder }
    }
    builder.then = (resolve, reject) =>
      Promise.resolve(state.tables[table] || { data: null, error: null }).then(resolve, reject)
    return builder
  }
  return {
    state,
    supabase: { from: (t) => makeBuilder(t) },
  }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const api = await import('./washRecords')

const lastCall = (table) => [...h.state.calls].reverse().find((c) => c.table === table)
const opNames = (rec) => (rec ? rec.ops.map((o) => o[0]) : [])
const opArgs = (rec, name) => (rec ? rec.ops.filter((o) => o[0] === name).map((o) => o[1]) : [])

beforeEach(() => {
  h.state.tables = {}
  h.state.calls = []
})

describe('listWashRecords', () => {
  it('builds a scoped, ordered, paged query and returns rows', async () => {
    h.state.tables.wash_records = { data: [{ id: 'w1', asset_no: 'A1' }], error: null }
    const rows = await api.listWashRecords({
      country: 'KSA', from: '2026-07-01', to: '2026-07-31', site: 'NHC', type: 'Full',
    })
    expect(rows).toEqual([{ id: 'w1', asset_no: 'A1' }])
    const rec = lastCall('wash_records')
    const names = opNames(rec)
    expect(names).toContain('select')
    expect(names).toContain('gte')
    expect(names).toContain('lte')
    expect(names).toContain('eq') // site + type
    expect(names).toContain('or') // applyCountry null-safe scoping
    expect(names).toContain('order')
    expect(names).toContain('range')
    // date bounds forwarded as YYYY-MM-DD
    expect(opArgs(rec, 'gte')[0]).toEqual(['wash_date', '2026-07-01'])
    expect(opArgs(rec, 'lte')[0]).toEqual(['wash_date', '2026-07-31'])
  })

  it('degrades to [] when the relation is missing (pre-migration)', async () => {
    h.state.tables.wash_records = {
      data: null,
      error: { message: 'relation "public.wash_records" does not exist' },
    }
    const rows = await api.listWashRecords({ country: 'All' })
    expect(rows).toEqual([])
  })
})

describe('createWashRecord', () => {
  it('maps and coerces fields, validates vocab, requires asset_no', async () => {
    h.state.tables.wash_records = { data: { id: 'w2' }, error: null }
    const out = await api.createWashRecord({
      asset_no: '  A9  ',
      wash_type: 'Full',
      status: 'Completed',
      cost: '75.5',
      water_liters: '',
      duration_min: 'nope',
      bogus_field: 'DROP',
      wash_date: '2026-07-18',
    })
    expect(out).toEqual({ id: 'w2' })
    const rec = lastCall('wash_records')
    const [payload] = opArgs(rec, 'insert')[0]
    expect(payload.asset_no).toBe('A9')
    expect(payload.wash_type).toBe('Full')
    expect(payload.status).toBe('Completed')
    // cost / water_liters / duration_min are DELIBERATELY not written from the app
    // (removed per field-feedback); the columns remain in the DB for legacy rows only.
    expect(payload).not.toHaveProperty('cost')
    expect(payload).not.toHaveProperty('water_liters')
    expect(payload).not.toHaveProperty('duration_min')
    expect(payload).not.toHaveProperty('bogus_field')
  })

  it('coerces an invalid wash_type to null and an invalid status to the Completed default', async () => {
    h.state.tables.wash_records = { data: { id: 'w3' }, error: null }
    await api.createWashRecord({ asset_no: 'A1', wash_type: 'Wax', status: 'Weird' })
    const rec = lastCall('wash_records')
    const [payload] = opArgs(rec, 'insert')[0]
    expect(payload.wash_type).toBeNull()
    expect(payload.status).toBe('Completed')
  })

  // 'In Progress' was retired by V534: the CHECK now allows exactly
  // Completed | Scheduled | Missed | Cancelled, so writing it would fail the
  // insert. It must fall back to the default, never reach the database.
  it('preserves In Progress rather than promoting it to Completed', async () => {
    h.state.tables.wash_records = { data: { id: 'w4' }, error: null }
    await api.createWashRecord({ asset_no: 'A1', status: 'In Progress' })
    const [payload] = opArgs(lastCall('wash_records'), 'insert')[0]
    // Promoting it would report a wash still in the bay as work done.
    expect(payload.status).toBe('In Progress')
    expect(api.WASH_STATUSES).toContain('In Progress')
  })

  it('writes a schedule as a plan with no time or operator', async () => {
    h.state.tables.wash_records = { data: { id: 'w5' }, error: null }
    await api.scheduleWash({ asset_no: 'A1', wash_date: '2026-09-01', wash_time: '08:00', washed_by: 'Sam' })
    const [payload] = opArgs(lastCall('wash_records'), 'insert')[0]
    expect(payload.status).toBe('Scheduled')
    // A wash that has not happened has no time of day and nobody performed it.
    expect(payload.wash_time).toBeNull()
    expect(payload.washed_by).toBeNull()
  })

  it('refuses to schedule without a date', async () => {
    await expect(api.scheduleWash({ asset_no: 'A1' })).rejects.toThrow(/date/i)
  })

  it('throws when asset_no is missing', async () => {
    await expect(api.createWashRecord({ wash_type: 'Full' })).rejects.toThrow(/asset number/i)
  })
})

describe('distinctSites / distinctAreas', () => {
  it('returns sorted distinct non-empty values', () => {
    const rows = [
      { site: 'METRO', area: 'South' },
      { site: 'NHC', area: '' },
      { site: 'NHC', area: 'North' },
      { site: '', area: null },
    ]
    expect(api.distinctSites(rows)).toEqual(['METRO', 'NHC'])
    expect(api.distinctAreas(rows)).toEqual(['North', 'South'])
  })
})
