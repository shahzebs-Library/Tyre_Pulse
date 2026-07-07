import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Supabase mock: a chainable, thenable query builder that records every table
// touched and the operation + modifiers applied, and resolves to a queued
// { data, error }. Results are queued per-call in FIFO order so a single test
// can script a sequence of reads/writes across tables. Mirrors the chainable
// pattern in notifications.test.js, extended with upsert/update/delete/eq and
// an auth.getUser() stub.
// ─────────────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    queue: [],            // FIFO of { data, error } consumed by each awaited builder
    calls: [],            // recorded operations
    user: { id: 'user-1' },
  }
  const nextResult = () => (state.queue.length ? state.queue.shift() : { data: [], error: null })

  function from(table) {
    const rec = { table, op: null, payload: undefined, filters: [] }
    state.calls.push(rec)
    const result = () => Promise.resolve(nextResult())
    const b = {
      _rec: rec,
      select(cols) { rec.op = rec.op || 'select'; rec.select = cols; return b },
      order(col, opts) { rec.order = [col, opts]; return b },
      upsert(payload, opts) { rec.op = 'upsert'; rec.payload = payload; rec.opts = opts; return result() },
      update(payload) { rec.op = 'update'; rec.payload = payload; return b },
      delete() { rec.op = 'delete'; return b },
      eq(col, val) { rec.filters.push([col, val]); return b },
      maybeSingle() { return result() },
      then(onF, onR) { return result().then(onF, onR) },
    }
    return b
  }
  const auth = { getUser: () => Promise.resolve({ data: { user: state.user }, error: null }) }
  return { state, supabase: { from, auth } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const {
  listReports, saveReport, deleteReport, renameReport,
  listDashboards, saveDashboard, deleteDashboard, setDefaultDashboard, shareDashboard,
  reportSaveTarget, isMissingTableError, REPORT_TABLE_MODULES,
  __resetSavedViewsSession,
} = await import('../lib/api/savedViews')

const MISSING = { code: '42P01', message: 'relation "public.report_definitions" does not exist' }
const PGRST = { code: 'PGRST205', message: "Could not find the table 'public.user_dashboards' in the schema cache" }

/** Queue a sequence of { data, error } results consumed FIFO by awaited builders. */
function queue(...results) { h.state.queue.push(...results) }
function lastCallTo(table) { return [...h.state.calls].reverse().find(c => c.table === table) }

beforeEach(() => {
  h.state.queue = []
  h.state.calls = []
  h.state.user = { id: 'user-1' }
  __resetSavedViewsSession()
})

// ─────────────────────────────────────────────────────────────────────────────
// Error-code detection
// ─────────────────────────────────────────────────────────────────────────────
describe('isMissingTableError', () => {
  it('detects Postgres 42P01 and PostgREST PGRST205', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true)
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true)
  })
  it('detects the message-text forms', () => {
    expect(isMissingTableError({ message: 'relation "public.foo" does not exist' })).toBe(true)
    expect(isMissingTableError({ message: "Could not find the table 'x' in the schema cache" })).toBe(true)
  })
  it('does not treat real errors as missing-table', () => {
    expect(isMissingTableError({ code: '23514', message: 'check constraint' })).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
    expect(isMissingTableError(undefined)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Module mismatch
// ─────────────────────────────────────────────────────────────────────────────
describe('reportSaveTarget (module mismatch)', () => {
  it('routes the 7 allowed modules to the table', () => {
    for (const key of ['tyres', 'inspections', 'work_orders', 'accidents', 'fleet']) {
      const t = reportSaveTarget(key)
      expect(t.table).toBe(true)
      expect(REPORT_TABLE_MODULES).toContain(t.module)
    }
  })
  it('keeps unsupported datasets (gate_passes/suppliers/warranty) in app_settings with a reason', () => {
    for (const key of ['gate_passes', 'suppliers', 'warranty']) {
      const t = reportSaveTarget(key)
      expect(t.table).toBe(false)
      expect(t.module).toBeNull()
      expect(t.reason).toBeTruthy()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Reports — table-first read + fallback + migration
// ─────────────────────────────────────────────────────────────────────────────
describe('listReports', () => {
  it('reads report_definitions first and maps rows', async () => {
    // 1) table select succeeds; 2) legacy blob read (for merge); 3+) migration upsert
    queue(
      { data: [{ id: 'r1', user_id: 'user-1', name: 'R1', module: 'tyres', columns: ['asset_no'], filters: [], sort: null, shared: false }], error: null },
      { data: { value: '[]' }, error: null }, // legacy app_settings for merge
    )
    const reports = await listReports()
    expect(lastCallTo('report_definitions').op).toBe('select')
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ id: 'r1', name: 'R1' })
    expect(reports[0].config.dataset).toBe('tyres')
  })

  it('falls back to app_settings when the table is missing (42P01) and never throws', async () => {
    // table select → 42P01, then legacy app_settings read returns a saved report
    const legacyBlob = JSON.stringify([{ id: 'leg1', name: 'Legacy', config: { dataset: 'suppliers', columns: ['x'] } }])
    queue(
      { data: null, error: MISSING },
      { data: { value: legacyBlob }, error: null },
    )
    const reports = await listReports()
    expect(reports).toHaveLength(1)
    expect(reports[0].id).toBe('leg1')
    // fallback read went to app_settings
    expect(lastCallTo('app_settings')).toBeTruthy()
  })

  it('propagates non-missing-table errors', async () => {
    queue({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(listReports()).rejects.toThrow('permission denied')
  })

  it('runs the one-time legacy→table migration only once per session', async () => {
    const legacyBlob = JSON.stringify([{ id: 'leg-mig', name: 'Mig', config: { dataset: 'tyres', columns: ['asset_no'] } }])
    // read#1: table select ok (empty), legacy read (has migratable row), migration upsert ok
    queue(
      { data: [], error: null },
      { data: { value: legacyBlob }, error: null },
      { data: null, error: null }, // migration upsert
    )
    await listReports()
    const migrated = h.state.calls.filter(c => c.table === 'report_definitions' && c.op === 'upsert')
    expect(migrated).toHaveLength(1)
    expect(migrated[0].payload[0]).toMatchObject({ id: 'leg-mig', user_id: 'user-1', module: 'tyres' })

    // read#2 in same session: table ok, legacy read — but NO second migration upsert
    h.state.calls = []
    queue({ data: [], error: null }, { data: { value: legacyBlob }, error: null })
    await listReports()
    expect(h.state.calls.filter(c => c.op === 'upsert')).toHaveLength(0)
  })
})

describe('saveReport (write routing)', () => {
  it('writes an allowed-module report to the table (per-user row)', async () => {
    queue({ data: null, error: null }) // upsert ok
    const rec = { id: 'r9', name: 'Spend', config: { dataset: 'tyres', columns: ['asset_no', 'cost_per_tyre'] } }
    await saveReport(rec, [])
    const call = lastCallTo('report_definitions')
    expect(call.op).toBe('upsert')
    expect(call.payload).toMatchObject({ id: 'r9', user_id: 'user-1', module: 'tyres' })
    expect(call.payload.columns).toEqual(['asset_no', 'cost_per_tyre'])
  })

  it('keeps a module-mismatch report in app_settings (never hits the table)', async () => {
    queue({ data: null, error: null }) // legacy upsert
    const rec = { id: 'w1', name: 'Warranty', config: { dataset: 'warranty', columns: ['removal_date'] } }
    await saveReport(rec, [])
    expect(lastCallTo('report_definitions')).toBeUndefined()
    const app = lastCallTo('app_settings')
    expect(app.op).toBe('upsert')
  })

  it('falls back to app_settings when the table is missing', async () => {
    queue(
      { data: null, error: MISSING }, // table upsert fails missing
      { data: null, error: null },    // legacy upsert
    )
    const rec = { id: 'r10', name: 'X', config: { dataset: 'fleet', columns: ['asset_no'] } }
    await saveReport(rec, [])
    expect(lastCallTo('app_settings').op).toBe('upsert')
  })
})

describe('deleteReport / renameReport', () => {
  it('deletes from the table then reconciles app_settings', async () => {
    queue({ data: null, error: null }, { data: null, error: null })
    await deleteReport('r1', [{ id: 'r1', name: 'x', config: { dataset: 'tyres', columns: ['a'] } }])
    const del = h.state.calls.find(c => c.table === 'report_definitions' && c.op === 'delete')
    expect(del.filters).toContainEqual(['id', 'r1'])
  })

  it('renames in the table and returns the updated list', async () => {
    queue({ data: null, error: null }, { data: null, error: null })
    const next = await renameReport('r1', 'New Name', [{ id: 'r1', name: 'Old', config: { dataset: 'tyres', columns: ['a'] } }])
    expect(next[0].name).toBe('New Name')
    const upd = h.state.calls.find(c => c.table === 'report_definitions' && c.op === 'update')
    expect(upd.payload).toMatchObject({ name: 'New Name' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dashboards
// ─────────────────────────────────────────────────────────────────────────────
describe('listDashboards', () => {
  it('reads user_dashboards first and maps layout rows', async () => {
    queue(
      { data: [{ id: 'd1', user_id: 'user-1', name: 'Mine', layout: { widgets: [{ widgetId: 'total-vehicles', w: 1, h: 'sm' }] }, is_default: true, shared: false }], error: null },
      { data: { value: '[]' }, error: null }, // legacy read inside migration
    )
    const layouts = await listDashboards()
    expect(lastCallTo('user_dashboards').op).toBe('select')
    expect(layouts).toHaveLength(1)
    expect(layouts[0]).toMatchObject({ id: 'd1', name: 'Mine', is_default: true })
    expect(layouts[0].widgets[0].widgetId).toBe('total-vehicles')
  })

  it('falls back to app_settings when user_dashboards is missing (PGRST205)', async () => {
    const legacyBlob = JSON.stringify([{ id: 'ld1', name: 'Legacy', widgets: [], created_by: 'user-1' }])
    queue(
      { data: null, error: PGRST },
      { data: { value: legacyBlob }, error: null },
    )
    const layouts = await listDashboards()
    expect(layouts.map(l => l.id)).toContain('ld1')
    expect(lastCallTo('app_settings')).toBeTruthy()
  })
})

describe('saveDashboard / deleteDashboard write routing', () => {
  it('upserts a single per-user row to the table', async () => {
    queue({ data: null, error: null })
    const layout = { id: 'd5', name: 'L', widgets: [], created_by: 'user-1', shared: false, is_default: false }
    await saveDashboard(layout, [])
    const call = lastCallTo('user_dashboards')
    expect(call.op).toBe('upsert')
    expect(call.payload).toMatchObject({ id: 'd5', user_id: 'user-1' })
    expect(call.payload.layout).toEqual({ widgets: [] })
  })

  it('falls back to app_settings when the table is missing', async () => {
    queue({ data: null, error: MISSING }, { data: null, error: null })
    const layout = { id: 'd6', name: 'L', widgets: [], created_by: 'user-1' }
    await saveDashboard(layout, [])
    expect(lastCallTo('app_settings').op).toBe('upsert')
  })

  it('deletes a layout row by id from the table', async () => {
    queue({ data: null, error: null })
    await deleteDashboard('d1', [])
    const del = lastCallTo('user_dashboards')
    expect(del.op).toBe('delete')
    expect(del.filters).toContainEqual(['id', 'd1'])
  })
})

describe('setDefaultDashboard / shareDashboard', () => {
  it('clears then sets is_default on the user rows', async () => {
    queue({ data: null, error: null }, { data: null, error: null })
    const list = [
      { id: 'd1', name: 'A', created_by: 'user-1', is_default: true, widgets: [] },
      { id: 'd2', name: 'B', created_by: 'user-1', is_default: false, widgets: [] },
    ]
    const next = await setDefaultDashboard('d2', list, 'user-1')
    expect(next.find(l => l.id === 'd2').is_default).toBe(true)
    expect(next.find(l => l.id === 'd1').is_default).toBe(false)
    const updates = h.state.calls.filter(c => c.table === 'user_dashboards' && c.op === 'update')
    expect(updates).toHaveLength(2)
  })

  it('toggles the shared flag via a single-row update', async () => {
    queue({ data: null, error: null })
    const next = await shareDashboard('d1', true, [{ id: 'd1', name: 'A', created_by: 'user-1', widgets: [], shared: false }])
    expect(next[0].shared).toBe(true)
    const upd = lastCallTo('user_dashboards')
    expect(upd.op).toBe('update')
    expect(upd.payload).toMatchObject({ shared: true })
  })

  it('falls back to app_settings for sharing when the table is missing', async () => {
    queue({ data: null, error: PGRST }, { data: null, error: null })
    await shareDashboard('d1', true, [{ id: 'd1', name: 'A', created_by: 'user-1', widgets: [], shared: false }])
    expect(lastCallTo('app_settings').op).toBe('upsert')
  })
})
