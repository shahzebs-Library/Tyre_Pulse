import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted Supabase mock: a chainable, awaitable query builder plus rpc().
// - from(table) returns a builder whose methods record calls and return `this`;
//   awaiting it resolves to state.tables[table] (or a null/null default).
// - rpc(name, args) records the last call and resolves to state.rpc.
// This mirrors how _client's applyCountry composes onto the builder via .or().
const h = vi.hoisted(() => {
  const state = { tables: {}, rpc: { data: null, error: null }, lastRpc: null, calls: [] }
  const METHODS = [
    'select', 'eq', 'in', 'order', 'limit', 'or', 'range', 'neq',
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
    supabase: {
      from: (t) => makeBuilder(t),
      rpc: (name, args) => { state.lastRpc = { name, args }; return Promise.resolve(state.rpc) },
    },
  }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const pm = await import('./pmPrograms')

const lastCall = (table) => [...h.state.calls].reverse().find((c) => c.table === table)
const opNames = (rec) => (rec ? rec.ops.map((o) => o[0]) : [])

beforeEach(() => {
  h.state.tables = {}
  h.state.rpc = { data: null, error: null }
  h.state.lastRpc = null
  h.state.calls = []
})

describe('pmPrograms.recordPmService', () => {
  it('maps every field into rpc(record_pm_service) and returns { record, program }', async () => {
    const result = { record: { id: 'r1', total_cost: 150 }, program: { id: 'p1', next_due: '2026-10-15' } }
    h.state.rpc = { data: result, error: null }

    const out = await pm.recordPmService('p1', {
      service_date: '2026-07-15',
      meter_reading: '12000',
      performed_by: 'Tech A',
      workshop: 'WS-1',
      site: 'NHC',
      tasks_done: [{ task: 'oil' }],
      parts_used: [{ part: 'filter' }],
      parts_cost: '50',
      labour_cost: 100,
      findings: 'ok',
      outcome: 'completed',
      work_order_no: 'WO-9',
      notes: 'done',
    })

    expect(h.state.lastRpc.name).toBe('record_pm_service')
    expect(h.state.lastRpc.args).toEqual({
      p_program_id: 'p1',
      p_service_date: '2026-07-15',
      p_meter_reading: 12000,
      p_performed_by: 'Tech A',
      p_workshop: 'WS-1',
      p_site: 'NHC',
      p_tasks_done: [{ task: 'oil' }],
      p_parts_used: [{ part: 'filter' }],
      p_parts_cost: 50,
      p_labour_cost: 100,
      p_findings: 'ok',
      p_outcome: 'completed',
      p_work_order_no: 'WO-9',
      p_notes: 'done',
    })
    expect(out).toEqual(result)
  })

  it('applies safe defaults (arrays -> [], nums -> null, outcome -> completed)', async () => {
    h.state.rpc = { data: { record: {}, program: {} }, error: null }
    await pm.recordPmService('p2', {})
    expect(h.state.lastRpc.args).toEqual({
      p_program_id: 'p2',
      p_service_date: null,
      p_meter_reading: null,
      p_performed_by: null,
      p_workshop: null,
      p_site: null,
      p_tasks_done: [],
      p_parts_used: [],
      p_parts_cost: null,
      p_labour_cost: null,
      p_findings: null,
      p_outcome: 'completed',
      p_work_order_no: null,
      p_notes: null,
    })
  })
})

describe('pmPrograms.listPmServiceRecords', () => {
  it('builds select/eq/order/limit and returns the rows', async () => {
    const rows = [{ id: 'sr1', asset_no: 'A1', service_date: '2026-07-10', total_cost: 90 }]
    h.state.tables.pm_service_records = { data: rows, error: null }

    const out = await pm.listPmServiceRecords({ asset_no: 'A1', program_id: 'p1' })
    expect(out).toEqual(rows)

    const rec = lastCall('pm_service_records')
    expect(opNames(rec)).toEqual(['select', 'eq', 'eq', 'order', 'limit'])
    // first select column list, both eq filters present
    expect(rec.ops[0][1][0]).toBe(pm.SERVICE_RECORD_COLS)
    expect(rec.ops[1][1]).toEqual(['asset_no', 'A1'])
    expect(rec.ops[2][1]).toEqual(['pm_program_id', 'p1'])
    expect(rec.ops[3][1]).toEqual(['service_date', { ascending: false }])
  })

  it('returns [] when the table is missing (never throws)', async () => {
    h.state.tables.pm_service_records = {
      data: null,
      error: { message: 'relation "pm_service_records" does not exist', code: '42P01' },
    }
    expect(await pm.listPmServiceRecords({ asset_no: 'A1' })).toEqual([])
  })

  it('applies a country OR filter when a country is active', async () => {
    h.state.tables.pm_service_records = { data: [], error: null }
    await pm.listPmServiceRecords({ country: 'KSA' })
    const rec = lastCall('pm_service_records')
    expect(opNames(rec)).toContain('or')
  })
})

describe('pmPrograms.loadPmDashboard', () => {
  it('reduces kmByAsset and keeps the latest engine_hours per asset', async () => {
    h.state.tables.pm_programs = {
      data: [
        { id: 'p1', asset_no: 'A1' },
        { id: 'p2', asset_no: 'A2' },
        { id: 'p3', asset_no: 'A1' }, // duplicate asset
        { id: 'p4', asset_no: '' },   // empty asset ignored
      ],
      error: null,
    }
    h.state.tables.vehicle_fleet = {
      data: [
        { asset_no: 'A1', current_km: '1000' },
        { asset_no: 'A2', current_km: 2000 },
      ],
      error: null,
    }
    // Pre-sorted desc by reading_date: first row per asset wins.
    h.state.tables.engine_hours_logs = {
      data: [
        { asset_no: 'A1', engine_hours: 500, reading_date: '2026-07-10' },
        { asset_no: 'A1', engine_hours: 400, reading_date: '2026-07-01' },
        { asset_no: 'A2', engine_hours: 300, reading_date: '2026-07-09' },
      ],
      error: null,
    }

    const { plans, kmByAsset, hoursByAsset } = await pm.loadPmDashboard({})
    expect(plans).toHaveLength(4)
    expect(kmByAsset).toEqual({ A1: 1000, A2: 2000 })
    expect(hoursByAsset).toEqual({ A1: 500, A2: 300 })

    // vehicle_fleet queried by an IN over the unique, non-empty asset list
    const fleet = lastCall('vehicle_fleet')
    const inOp = fleet.ops.find((o) => o[0] === 'in')
    expect(inOp[1]).toEqual(['asset_no', ['A1', 'A2']])
  })

  it('survives a missing engine_hours_logs (hoursByAsset -> {})', async () => {
    h.state.tables.pm_programs = { data: [{ id: 'p1', asset_no: 'A1' }], error: null }
    h.state.tables.vehicle_fleet = { data: [{ asset_no: 'A1', current_km: 5 }], error: null }
    h.state.tables.engine_hours_logs = {
      data: null,
      error: { message: 'relation "engine_hours_logs" does not exist', code: '42P01' },
    }

    const { kmByAsset, hoursByAsset } = await pm.loadPmDashboard({})
    expect(kmByAsset).toEqual({ A1: 5 })
    expect(hoursByAsset).toEqual({})
  })

  it('short-circuits to empty meter maps when no assets are referenced', async () => {
    h.state.tables.pm_programs = { data: [{ id: 'p1', asset_no: null }], error: null }
    const { kmByAsset, hoursByAsset } = await pm.loadPmDashboard({})
    expect(kmByAsset).toEqual({})
    expect(hoursByAsset).toEqual({})
    // No fleet query made at all
    expect(lastCall('vehicle_fleet')).toBeUndefined()
  })
})
