import { describe, it, expect, vi, beforeEach } from 'vitest'

// Table-routing Supabase mock: reads resolve to state.tables[name]; inserts are
// recorded in state.inserts[name] and resolve to a configurable error.
const h = vi.hoisted(() => {
  const state = { tables: {}, inserts: {}, insertErr: {} }
  function from(table) {
    const result = () => Promise.resolve(state.tables[table] ?? { data: [], error: null })
    const b = {
      _table: table,
      select() { return b }, order() { return b }, limit() { return b },
      eq() { return b }, in() { return b }, or() { return b },
      maybeSingle() { return result() }, single() { return result() },
      insert(payload) {
        ;(state.inserts[table] ??= []).push(payload)
        return { then: (f, r) => Promise.resolve({ error: state.insertErr[table] ?? null }).then(f, r) }
      },
      then(f, r) { return result().then(f, r) },
    }
    return b
  }
  return { state, supabase: { from, auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) } } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { runPostImportAutomation } = await import('../lib/api/imports')

const row = (o) => ({ target_record_id: o.live === false ? null : 'live-1', transformed_data: o.t })

beforeEach(() => {
  h.state.tables = { import_batches: { data: { id: 'b1', country: 'KSA' }, error: null } }
  h.state.inserts = {}
  h.state.insertErr = {}
})

describe('runPostImportAutomation', () => {
  it('creates a high-severity tyre_risk alert for low tread; payload omits organisation_id', async () => {
    h.state.tables.import_rows = { data: [row({ t: { asset_no: 'A1', serial_no: 'S1', tread_depth: 2, site: 'Riyadh' } })], error: null }
    const res = await runPostImportAutomation('b1', 'tyre', { country: 'KSA' })
    expect(res.alerts).toBe(1)
    const a = h.state.inserts.alerts[0][0]
    expect(a).toMatchObject({ asset_no: 'A1', alert_type: 'tyre_risk', severity: 'high', country: 'KSA', is_active: true })
    expect('organisation_id' in a).toBe(false)
  })

  it('uses critical severity for a Critical risk_level row', async () => {
    h.state.tables.import_rows = { data: [row({ t: { asset_no: 'A2', risk_level: 'Critical' } })], error: null }
    const res = await runPostImportAutomation('b1', 'tyre', {})
    expect(res.alerts).toBe(1)
    expect(h.state.inserts.alerts[0][0].severity).toBe('critical')
  })

  it('ignores rows that never became live records', async () => {
    h.state.tables.import_rows = { data: [row({ live: false, t: { asset_no: 'A3', tread_depth: 1 } })], error: null }
    const res = await runPostImportAutomation('b1', 'tyre', {})
    expect(res.alerts).toBe(0)
    expect(h.state.inserts.alerts).toBeUndefined()
  })

  it('is idempotent — skips an asset that already has an active alert', async () => {
    h.state.tables.import_rows = { data: [row({ t: { asset_no: 'A1', tread_depth: 2 } })], error: null }
    h.state.tables.alerts = { data: [{ asset_no: 'A1' }], error: null }
    const res = await runPostImportAutomation('b1', 'tyre', {})
    expect(res.alerts).toBe(0)
    expect(res.skipped).toBe(1)
    expect(h.state.inserts.alerts).toBeUndefined()
  })

  it('raises exactly one corrective action for repeated low pressure on an asset', async () => {
    h.state.tables.import_rows = { data: [
      row({ t: { asset_no: 'A9', pressure_reading: 70, serial_no: 'S1', site: 'Jeddah' } }),
      row({ t: { asset_no: 'A9', pressure_reading: 60, serial_no: 'S2' } }),
    ], error: null }
    const res = await runPostImportAutomation('b1', 'tyre', {})
    expect(res.actions).toBe(1)
    const c = h.state.inserts.corrective_actions[0][0]
    expect(c).toMatchObject({ asset_no: 'A9', status: 'open', root_cause: 'Under-inflation', country: 'KSA' })
  })

  it('does not raise an action for a single low-pressure row', async () => {
    h.state.tables.import_rows = { data: [row({ t: { asset_no: 'A9', pressure_reading: 70 } })], error: null }
    const res = await runPostImportAutomation('b1', 'tyre', {})
    expect(res.actions).toBe(0)
  })

  it('is a no-op for non-tyre modules', async () => {
    const res = await runPostImportAutomation('b1', 'stock', {})
    expect(res).toEqual({ alerts: 0, actions: 0, skipped: 0 })
    expect(h.state.inserts).toEqual({})
  })

  it('never throws when an insert fails (best-effort)', async () => {
    h.state.tables.import_rows = { data: [row({ t: { asset_no: 'A1', tread_depth: 2 } })], error: null }
    h.state.insertErr.alerts = { message: 'boom' }
    const res = await runPostImportAutomation('b1', 'tyre', {})
    expect(res.alerts).toBe(0) // insert failed but swallowed
  })
})
