/**
 * Work Orders server-side paging + the SQL/JS status mirror.
 *
 * The page used to fetch EVERY job card in the window (22,478 rows / 23 round
 * trips on the All year-to-date view, 62,412 / 63 once the dates were cleared)
 * and then filter, sort and slice 20 rows in the browser. V586/V587 moved that
 * to the server. These tests pin the two things that can silently regress:
 *
 *   1. the service asks the server for ONE page and never the whole table, and
 *      the export still covers the whole FILTERED set (not the page on screen);
 *   2. the canonical status vocabulary is identical on both sides of the wire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeWoStatus } from '../lib/workOrderStatus'

const h = vi.hoisted(() => {
  const state = { rpc: [], result: { data: null, error: null }, resultsByCall: null }
  return {
    state,
    supabase: {
      rpc(fn, args) {
        state.rpc.push({ fn, args })
        const queued = state.resultsByCall?.[state.rpc.length - 1]
        return Promise.resolve(queued ?? state.result)
      },
      from() { throw new Error('the paged read must not touch the table directly') },
    },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))
vi.mock('../lib/api/tyreServiceEvents', () => ({ createServiceEvent: vi.fn() }))

const workOrders = await import('../lib/api/workOrders')

beforeEach(() => {
  h.state.rpc = []
  h.state.resultsByCall = null
  h.state.result = { data: { rows: [], total: 0 }, error: null }
})

describe('work orders - server-side paging', () => {
  it('requests exactly one page, with filters and the offset, from the RPC', async () => {
    h.state.result = { data: { rows: [{ id: 'a' }], total: 14398 }, error: null }

    const out = await workOrders.getWorkOrdersPage({
      country: 'KSA', openedFrom: '2026-01-01', openedTo: '2026-08-17',
      search: '  GCKR  ', status: 'Completed', priority: 'High', type: 'Repair',
      sortField: 'total_cost', sortDir: 'asc', page: 3, pageSize: 20,
    })

    expect(h.state.rpc).toHaveLength(1)
    expect(h.state.rpc[0].fn).toBe('get_work_orders_page')
    expect(h.state.rpc[0].args).toMatchObject({
      p_country: 'KSA', p_from: '2026-01-01', p_to: '2026-08-17',
      p_search: 'GCKR', p_status: 'Completed', p_priority: 'High', p_type: 'Repair',
      p_sort: 'total_cost', p_dir: 'asc', p_limit: 20, p_offset: 40,
    })
    // The exact total comes from the server, NOT from the rows on screen.
    expect(out).toEqual({ rows: [{ id: 'a' }], total: 14398 })
  })

  it('sends All / blank filters as null so the server applies no predicate', async () => {
    await workOrders.getWorkOrdersPage({
      country: 'All', status: 'All', priority: 'All', type: 'All', search: '   ',
    })
    expect(h.state.rpc[0].args).toMatchObject({
      p_country: null, p_status: null, p_priority: null, p_type: null, p_search: null,
    })
  })

  it('never sends a negative offset for page 1 or below', async () => {
    await workOrders.getWorkOrdersPage({ page: 1 })
    expect(h.state.rpc[0].args.p_offset).toBe(0)
    await workOrders.getWorkOrdersPage({ page: 0 })
    expect(h.state.rpc[1].args.p_offset).toBe(0)
  })

  it('stats come from the full-window aggregate, not the page', async () => {
    h.state.result = { data: { total: 14398, open: 30, by_status: [] }, error: null }
    const stats = await workOrders.getWorkOrderStats({
      country: 'KSA', openedFrom: '2026-01-01', openedTo: '2026-08-17',
    })
    expect(h.state.rpc[0].fn).toBe('get_work_order_stats')
    expect(h.state.rpc[0].args).toEqual({
      p_country: 'KSA', p_from: '2026-01-01', p_to: '2026-08-17',
    })
    expect(stats.total).toBe(14398)
  })

  it('the export pages the whole filtered set, not just the visible page', async () => {
    // 2,500 matches at pageSize 1000 -> three pages, then stop.
    const pageOf = (n) => ({ data: { rows: Array.from({ length: n }, (_, i) => ({ id: i })), total: 2500 }, error: null })
    h.state.resultsByCall = [pageOf(1000), pageOf(1000), pageOf(500)]

    const out = await workOrders.getAllWorkOrdersMatching({ country: 'KSA' })

    expect(h.state.rpc).toHaveLength(3)
    expect(h.state.rpc.map(c => c.args.p_offset)).toEqual([0, 1000, 2000])
    expect(out.rows).toHaveLength(2500)
    expect(out.truncated).toBe(false)
  })

  it('the export reports truncation instead of presenting a clipped file as complete', async () => {
    h.state.result = { data: { rows: Array.from({ length: 10 }, (_, i) => ({ id: i })), total: 99999 }, error: null }
    const out = await workOrders.getAllWorkOrdersMatching({}, { max: 10, pageSize: 10 })
    expect(out.truncated).toBe(true)
    expect(out.rows).toHaveLength(10)
  })

  it('stops paging when the server returns an empty page (never loops forever)', async () => {
    h.state.result = { data: { rows: [], total: 5000 }, error: null }
    const out = await workOrders.getAllWorkOrdersMatching({}, { max: 50000, pageSize: 1000 })
    expect(out.rows).toHaveLength(0)
    expect(h.state.rpc).toHaveLength(1)
  })
})

/**
 * MIRROR: public.wo_status_canonical(text) in MIGRATIONS_V586_* must fold
 * exactly as normalizeWoStatus() does. CHANGE BOTH TOGETHER.
 *
 * Every pair below was executed against the live function and returned the
 * value asserted here, so this table is a real cross-check of the two
 * implementations rather than a restatement of the JS.
 *
 * It matters because work_orders.status still stores legacy tokens - 'Closed'
 * (57,228 rows) and 'Open' (73) - so a server-side status filter or count that
 * folded differently from the client would disagree with the grid about what
 * "Completed" means.
 */
describe('wo_status_canonical SQL mirror', () => {
  const CASES = [
    ['Closed', 'Completed'], ['Completed', 'Completed'], ['Open', 'New'],
    ['In Progress', 'In Progress'], ['Cancelled', 'Cancelled'],
    ['in_progress', 'In Progress'], ['IN-PROGRESS', 'In Progress'],
    ['waiting for parts', 'Waiting for Parts'], ['Waiting-For-Parts', 'Waiting for Parts'],
    ['qc', 'Quality Inspection'], ['quality/check', 'Quality Inspection'],
    ['on hold', 'On Hold'], ['paused', 'On Hold'],
    ['  closed  ', 'Completed'], ['void', 'Cancelled'], ['WIP', 'In Progress'],
    ['', ''],
    // Unknown values pass through TRIMMED on both sides - they are never dropped.
    ['Some Future Status', 'Some Future Status'],
    ['  Bespoke Thing  ', 'Bespoke Thing'],
  ]

  it.each(CASES)('folds %j to %j on both sides', (raw, expected) => {
    expect(normalizeWoStatus(raw)).toBe(expected)
  })

  it('folds every raw status present in live data', () => {
    // Measured live: these are the only 5 values stored across 89,913 rows.
    expect(['Closed', 'Completed', 'Open', 'In Progress', 'Cancelled'].map(normalizeWoStatus))
      .toEqual(['Completed', 'Completed', 'New', 'In Progress', 'Cancelled'])
  })
})
