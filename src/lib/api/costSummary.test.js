import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted Supabase mock: a chainable, awaitable builder resolving per table.
// fetchAllPages (real) invokes the page builder and awaits it; applyCountry
// (real) composes onto it via .or(). Small fixtures (< 1000 rows) resolve in a
// single page.
const h = vi.hoisted(() => {
  const state = { tables: {}, calls: [] }
  const METHODS = ['select', 'eq', 'in', 'order', 'limit', 'or', 'range', 'neq']
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
  return { state, supabase: { from: (t) => makeBuilder(t) } }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const { loadCostSplit } = await import('./costSummary')

const NOW = new Date('2026-07-15T00:00:00Z') // window: 2025-08 .. 2026-07
const MISSING = { data: null, error: { message: 'relation "x" does not exist', code: '42P01' } }

beforeEach(() => {
  h.state.tables = {}
  h.state.calls = []
})

describe('costSummary.loadCostSplit', () => {
  it('buckets tyre spend by issue_date (cost_per_tyre x qty, qty defaults to 1)', async () => {
    h.state.tables.tyre_records = {
      data: [
        { cost_per_tyre: 100, qty: 2, issue_date: '2026-07-05' }, // 200 -> 2026-07
        { cost_per_tyre: 50, qty: '', issue_date: '2026-06-10' },  // qty -> 1 => 50 -> 2026-06
        { cost_per_tyre: 999, qty: 1, issue_date: '2024-01-01' },  // out of window, ignored
      ],
      error: null,
    }

    const out = await loadCostSplit({ now: NOW })
    expect(out.tyre).toBe(250)
    expect(out.maintenance).toBe(0)
    const jul = out.byMonth.find((m) => m.month === '2026-07')
    const jun = out.byMonth.find((m) => m.month === '2026-06')
    expect(jul.tyre).toBe(200)
    expect(jun.tyre).toBe(50)
  })

  it('sums maintenance from pm_service_records + work_orders, excluding tyre_cost', async () => {
    h.state.tables.pm_service_records = {
      data: [{ total_cost: 300, service_date: '2026-07-01' }],
      error: null,
    }
    h.state.tables.work_orders = {
      data: [
        // 100+50+20+30 = 200 (tyre_cost 999 excluded), bucket by completed_at
        {
          labour_cost: 100, parts_cost: 50, lubricant_cost: 20, outside_repair_cost: 30,
          tyre_cost: 999, completed_at: '2026-07-02', created_at: '2026-07-01',
        },
        // no completed_at -> falls back to created_at (2026-06)
        { labour_cost: 10, created_at: '2026-06-15' },
      ],
      error: null,
    }

    const out = await loadCostSplit({ now: NOW })
    expect(out.tyre).toBe(0)
    expect(out.maintenance).toBe(510) // 300 + 200 + 10
    const jul = out.byMonth.find((m) => m.month === '2026-07')
    expect(jul.maintenance).toBe(500) // 300 pm + 200 wo
    const jun = out.byMonth.find((m) => m.month === '2026-06')
    expect(jun.maintenance).toBe(10)
  })

  it('degrades each source to 0 on a missing relation (never throws)', async () => {
    h.state.tables.tyre_records = MISSING
    h.state.tables.pm_service_records = MISSING
    h.state.tables.work_orders = MISSING

    const out = await loadCostSplit({ now: NOW })
    expect(out.tyre).toBe(0)
    expect(out.maintenance).toBe(0)
  })

  it('a missing work_orders does not sink pm_service_records maintenance', async () => {
    h.state.tables.pm_service_records = {
      data: [{ total_cost: 120, service_date: '2026-05-01' }],
      error: null,
    }
    h.state.tables.work_orders = MISSING

    const out = await loadCostSplit({ now: NOW })
    expect(out.maintenance).toBe(120)
  })

  it('always returns 12 month buckets, oldest to newest', async () => {
    const out = await loadCostSplit({ now: NOW })
    expect(out.byMonth).toHaveLength(12)
    expect(out.byMonth[0].month).toBe('2025-08')
    expect(out.byMonth[11].month).toBe('2026-07')
    // every bucket zeroed with the tyre/maintenance shape
    expect(out.byMonth.every((m) => m.tyre === 0 && m.maintenance === 0)).toBe(true)
  })
})
