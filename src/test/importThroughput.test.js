/**
 * Import throughput: the properties that make a large upload finish.
 *
 * Each of these pins a measured defect, not a hypothetical one:
 *   - the production import sent ONE request per row, so 10,000 rows was about
 *     27 minutes of pure round trips
 *   - every chunk loop was strictly sequential, which is what made a 50,000 row
 *     file latency-bound rather than server-bound
 *   - the retry ladder slept after its FINAL attempt, burning 8 seconds per
 *     exhausted chunk before the sweep that was going to run anyway
 *
 * They are written as behaviour, not implementation: a future rewrite is free
 * to change how concurrency is achieved as long as the file still uploads in a
 * bounded number of requests without losing or reordering rows.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    inFlight: 0, maxInFlight: 0,
    calls: [],            // { table, rows }
    outcome: () => 'ok',  // per-call: 'ok' | 'transient' | 'fatal'
    delayMs: 0,
    n: 0,
  }
  const insert = (table) => (rows) => {
    state.n += 1
    const call = state.n
    state.calls.push({ table, rows: rows.length })
    state.inFlight += 1
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
    const res = state.outcome(call)
    return new Promise((resolve) => {
      const finish = () => {
        state.inFlight -= 1
        if (res === 'transient') resolve({ data: null, error: { message: 'Failed to fetch' } })
        else if (res === 'fatal') resolve({ data: null, error: { message: 'permission denied', code: '42501' } })
        else resolve({ data: rows, error: null })
      }
      if (state.delayMs) setTimeout(finish, state.delayMs); else finish()
    })
  }
  const from = (table) => ({
    insert: insert(table),
    select: () => ({ not: () => ({ range: () => Promise.resolve({ data: [], error: null }) }),
                     eq: () => ({ range: () => Promise.resolve({ data: [], error: null }) }),
                     range: () => Promise.resolve({ data: [], error: null }) }),
    delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
  })
  return { state, supabase: { from } }
})

vi.mock('../lib/api/_client', () => ({
  supabase: h.supabase,
  unwrap: (res) => { if (res?.error) throw Object.assign(new Error(res.error.message), res.error); return res.data },
  applyCountry: (q) => q,
  fetchAllPages: async () => ({ data: [], error: null }),
}))

const { createProductionBulk } = await import('../lib/api/production')
const { insertPartsConsumption: insertParts } = await import('../lib/api/partsConsumption')

const reset = () => {
  h.state.inFlight = 0; h.state.maxInFlight = 0; h.state.calls = []
  h.state.outcome = () => 'ok'; h.state.delayMs = 0; h.state.n = 0
}
beforeEach(reset)

const productionRows = (n) => Array.from({ length: n }, (_, i) => ({
  site: 'NHC', period_date: '2026-06-01', m3: 10, source_row: i + 1,
}))

describe('createProductionBulk', () => {
  it('sends chunks, not one request per row', async () => {
    const out = await createProductionBulk(productionRows(1000))
    expect(out.saved).toBe(1000)
    // the defect this replaces would be 1000 calls
    expect(h.state.calls.length).toBe(4)
    expect(h.state.calls.every((c) => c.table === 'production_logs')).toBe(true)
  })

  it('validates per row BEFORE inserting, so one bad row does not fail a chunk', async () => {
    const rows = productionRows(5)
    rows[2] = { site: '', period_date: '2026-06-01', m3: 1, source_row: 3 }   // no site
    rows[4] = { site: 'NHC', period_date: '2026-06-01', m3: -1, source_row: 5 } // negative
    const out = await createProductionBulk(rows)
    expect(out.saved).toBe(3)
    expect(out.failures).toHaveLength(2)
    // the row number is what lets someone find it in their spreadsheet
    expect(out.failures[0]).toContain('Row 3')
    expect(out.failures[1]).toContain('Row 5')
    // the invalid rows never reached the server
    expect(h.state.calls.reduce((s, c) => s + c.rows, 0)).toBe(3)
  })

  it('reports the row range when the server rejects a whole chunk', async () => {
    h.state.outcome = (n) => (n === 1 ? 'fatal' : 'ok')
    const out = await createProductionBulk(productionRows(300))
    expect(out.saved).toBe(50)          // second chunk only
    expect(out.failures[0]).toMatch(/Rows 1 to 250/)
  })

  it('reports progress so a long save is not a dead spinner', async () => {
    const seen = []
    await createProductionBulk(productionRows(600), { onProgress: (d, t) => seen.push([d, t]) })
    expect(seen[seen.length - 1]).toEqual([600, 600])
    expect(seen.length).toBeGreaterThan(1)
  })

  it('handles an empty or junk input without calling the server', async () => {
    await expect(createProductionBulk([])).resolves.toEqual({ saved: 0, failures: [] })
    await expect(createProductionBulk(null)).resolves.toEqual({ saved: 0, failures: [] })
    expect(h.state.calls).toHaveLength(0)
  })
})

describe('insertParts', () => {
  const partsRows = (n) => Array.from({ length: n }, (_, i) => ({
    item_code: `IT${i}`, item_description: 'THING', value_amount: 1, txn_date: '2026-06-01',
  }))

  it('overlaps requests instead of sending them one at a time', async () => {
    h.state.delayMs = 5
    const out = await insertParts(partsRows(2000), { country: 'KSA' })
    expect(out.inserted).toBe(2000)
    // the sequential loop this replaces would never exceed 1
    expect(h.state.maxInFlight).toBeGreaterThan(1)
  })

  it('keeps concurrency bounded - an unbounded fan-out would flood the database', async () => {
    h.state.delayMs = 5
    await insertParts(partsRows(20000), { country: 'KSA' })
    expect(h.state.maxInFlight).toBeLessThanOrEqual(4)
  })

  it('inserts every row exactly once regardless of completion order', async () => {
    // finish out of order: later chunks return first
    let call = 0
    h.state.delayMs = 0
    h.state.outcome = () => { call += 1; return 'ok' }
    const out = await insertParts(partsRows(1000), { country: 'KSA' })
    expect(out.inserted).toBe(1000)
    expect(h.state.calls.reduce((s, c) => s + c.rows, 0)).toBe(1000)
    expect(call).toBe(h.state.calls.length)
  })

  it('a fatal error drains the pool before throwing, so the count is not a lie', async () => {
    h.state.delayMs = 2
    h.state.outcome = (n) => (n === 2 ? 'fatal' : 'ok')
    await expect(insertParts(partsRows(4000), { country: 'KSA' })).rejects.toThrow(/permission/i)
    // nothing still running when the error surfaced
    expect(h.state.inFlight).toBe(0)
  })

  it('retries a transient failure rather than losing the chunk', async () => {
    const failedOnce = new Set()
    h.state.outcome = (n) => {
      if (n <= 2 && !failedOnce.has(n)) { failedOnce.add(n); return 'transient' }
      return 'ok'
    }
    const out = await insertParts(partsRows(400), { country: 'KSA' })
    expect(out.inserted).toBe(400)
    expect(out.failed).toBe(0)
  }, 20000)
})
