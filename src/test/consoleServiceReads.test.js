/**
 * Console service reads: paging past the PostgREST 1,000-row cap, and honest
 * errors (a failed read must never become an empty list).
 *
 * Covers deliveryHealth.listEmailLog / listPushLog, systemLogs.buildLogsByDay
 * and materialMaster.listMaterials. The mock builder honours .range(a, b) over
 * a large in-memory table and CAPS every response at 1,000 rows, exactly as
 * the server does, so an unpaged read would visibly stop at 1,000.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = { tables: {}, error: null, calls: [] }
  function builder(table) {
    const q = { table, orders: [], rangeArgs: null, limitN: null }
    const api = {
      select() { return api },
      gte() { return api },
      lte() { return api },
      eq() { return api },
      or() { return api },
      not() { return api },
      order(col, opts) { q.orders.push([col, opts]); return api },
      range(a, b) { q.rangeArgs = [a, b]; return api },
      limit(n) { q.limitN = n; return api },
      then(res, rej) {
        state.calls.push(q)
        if (state.error) return Promise.resolve({ data: null, error: state.error }).then(res, rej)
        const all = state.tables[table] || []
        let rows = all
        if (q.rangeArgs) rows = all.slice(q.rangeArgs[0], q.rangeArgs[1] + 1)
        else if (q.limitN != null) rows = all.slice(0, q.limitN)
        rows = rows.slice(0, 1000) // the server cap
        return Promise.resolve({ data: rows, error: null }).then(res, rej)
      },
    }
    return api
  }
  return { state, supabase: { from: builder, rpc: () => Promise.resolve({ data: null, error: null }) } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const delivery = await import('../lib/api/deliveryHealth')
const systemLogs = await import('../lib/api/systemLogs')
const materials = await import('../lib/api/materialMaster')

const makeRows = (n, dateCol) =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    status: i % 10 === 0 ? 'failed' : 'sent',
    [dateCol]: `2026-09-${String((i % 14) + 1).padStart(2, '0')}T00:00:00Z`,
  }))

beforeEach(() => {
  h.state.tables = {}
  h.state.error = null
  h.state.calls = []
})

describe('deliveryHealth - paged past the 1,000 cap', () => {
  it('listEmailLog returns every row and orders by sent_at then id', async () => {
    h.state.tables.report_send_log = makeRows(2500, 'sent_at')
    const out = await delivery.listEmailLog({ days: 30 })
    expect(out.rows).toHaveLength(2500)
    expect(out.truncated).toBe(false)
    const cols = h.state.calls[0].orders.map(([c]) => c)
    expect(cols).toEqual(['sent_at', 'id'])
  })

  it('listPushLog returns every row and flags truncation at the ceiling', async () => {
    h.state.tables.workflow_notifications = makeRows(2500, 'created_at')
    const full = await delivery.listPushLog({ days: 30 })
    expect(full.rows).toHaveLength(2500)
    expect(full.truncated).toBe(false)

    const capped = await delivery.listPushLog({ days: 30, max: 1500 })
    expect(capped.rows).toHaveLength(1500)
    expect(capped.truncated).toBe(true)
  })

  it('a missing relation reads as no rows; any other failure THROWS', async () => {
    h.state.error = { code: '42P01', message: 'relation "report_send_log" does not exist' }
    expect(await delivery.listEmailLog()).toEqual({ rows: [], truncated: false })

    h.state.error = { code: '42501', message: 'permission denied' }
    await expect(delivery.listEmailLog()).rejects.toBeTruthy()
    await expect(delivery.listPushLog()).rejects.toBeTruthy()
  })
})

describe('systemLogs.buildLogsByDay - paged past the 1,000 cap', () => {
  it('counts every row, not the first 1,000', async () => {
    h.state.tables.system_logs = makeRows(3200, 'created_at')
    const days = await systemLogs.buildLogsByDay('2026-09-01T00:00:00Z')
    const total = days.reduce((s, d) => s + d.count, 0)
    expect(total).toBe(3200)
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort())
    const q = h.state.calls[0]
    expect(q.orders.map(([c]) => c)).toEqual(['created_at', 'id'])
    expect(q.rangeArgs).toEqual([0, 999])
  })
})

describe('materialMaster.listMaterials - honest errors', () => {
  it('returns rows on success and never asks past the 1,000-row cap', async () => {
    h.state.tables.material_master = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}` }))
    expect(await materials.listMaterials({ country: 'KSA', limit: 5000 })).toHaveLength(5)
    expect(h.state.calls[0].limitN).toBe(materials.MATERIAL_LIST_MAX)
    expect(materials.MATERIAL_LIST_MAX).toBeLessThanOrEqual(1000)
  })

  it('an undeployed table reads as no items (by code only)', async () => {
    h.state.error = { code: '42P01', message: 'relation "material_master" does not exist' }
    expect(await materials.listMaterials({ country: 'KSA' })).toEqual([])
  })

  it('a permission or network failure THROWS instead of returning []', async () => {
    h.state.error = { code: '42501', message: 'permission denied for relation material_master' }
    await expect(materials.listMaterials({ country: 'KSA' })).rejects.toBeTruthy()
    h.state.error = { message: 'Failed to fetch' }
    await expect(materials.listMaterials({ country: 'KSA' })).rejects.toBeTruthy()
  })
})

describe('aiOps.readTokenLogs - paged past the 1,000 cap', async () => {
  const aiOps = await import('../lib/api/aiOps')
  it('returns every token-log row and only flags truncation at the ceiling', async () => {
    h.state.tables.ai_token_logs = makeRows(2300, 'created_at')
    const full = await aiOps.readTokenLogs({ days: 30 })
    expect(full.rows).toHaveLength(2300)
    expect(full.truncated).toBe(false)
    const capped = await aiOps.readTokenLogs({ days: 30, limit: 1200 })
    expect(capped.rows).toHaveLength(1200)
    expect(capped.truncated).toBe(true)
  })

  it('a permission failure throws rather than reading as zero AI usage', async () => {
    h.state.error = { code: '42501', message: 'permission denied' }
    await expect(aiOps.readTokenLogs({ days: 30 })).rejects.toBeTruthy()
  })
})

describe('duplicateControl.listDuplicateBatches - real per-batch row counts', async () => {
  const dup = await import('../lib/api/duplicateControl')
  it('counts every archived row of a batch, not the first page of rows', async () => {
    h.state.tables.dup_resolve_archive = [
      ...Array.from({ length: 1800 }, (_, i) => ({ id: `a${i}`, batch_id: 'B1', tbl: 'parts_consumption', created_at: '2026-09-02' })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, batch_id: 'B0', tbl: 'parts_consumption', created_at: '2026-09-01' })),
    ]
    const batches = await dup.listDuplicateBatches()
    expect(batches.map((b) => [b.batch_id, b.rows])).toEqual([['B1', 1800], ['B0', 30]])
  })

  it('an undeployed archive reads as no batches; a real failure throws', async () => {
    h.state.error = { code: '42P01', message: 'relation does not exist' }
    expect(await dup.listDuplicateBatches()).toEqual([])
    h.state.error = { code: '42501', message: 'permission denied' }
    await expect(dup.listDuplicateBatches()).rejects.toBeTruthy()
  })
})
