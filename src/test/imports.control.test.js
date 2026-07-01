import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable Supabase mock resolving to a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table, _calls: calls,
      select() { return b }, order() { return b }, limit() { return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, auth: { getUser: () => Promise.resolve({ data: { user: null } }) } } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { importControlStats } = await import('../lib/api/imports')

beforeEach(() => { h.state.result = { data: [], error: null }; h.state.last = null })

const B = (o) => ({
  id: o.id, country: 'country' in o ? o.country : 'KSA', module: o.module ?? 'tyre',
  source_system: o.source_system ?? null, approval_status: o.approval_status ?? 'approved',
  import_status: o.import_status ?? 'committed', total_rows: o.total_rows ?? 0,
  warning_rows: o.warning_rows ?? 0, error_rows: o.error_rows ?? 0,
  duplicate_rows: o.duplicate_rows ?? 0, conflict_rows: o.conflict_rows ?? 0,
  imported_rows: o.imported_rows ?? 0, skipped_rows: o.skipped_rows ?? 0,
  uploader: o.uploader ?? null, created_at: o.created_at ?? '2026-01-01T00:00:00Z',
  approved_at: o.approved_at ?? null,
})

describe('importControlStats', () => {
  it('computes success rate (committed / total)', async () => {
    h.state.result = { data: [B({ id: '1', import_status: 'committed' }), B({ id: '2', import_status: 'staged' }), B({ id: '3', import_status: 'staged' }), B({ id: '4', import_status: 'staged' })], error: null }
    const s = await importControlStats({})
    expect(s.total).toBe(4)
    expect(s.successRate).toBe(25)
  })

  it('guards every rate against divide-by-zero on empty input', async () => {
    h.state.result = { data: [], error: null }
    const s = await importControlStats({})
    expect(s).toMatchObject({ total: 0, successRate: 0, validationErrorRate: 0, duplicateRate: 0, conflictRate: 0, avgApprovalHours: null })
    expect(s.topUploaders).toEqual([])
    expect(s.latest).toEqual([])
  })

  it('computes row-rate math', async () => {
    h.state.result = { data: [B({ id: '1', total_rows: 200, error_rows: 10, duplicate_rows: 20, conflict_rows: 4 })], error: null }
    const s = await importControlStats({})
    expect(s.validationErrorRate).toBe(5)
    expect(s.duplicateRate).toBe(10)
    expect(s.conflictRate).toBe(2)
  })

  it('averages approval time only over approved batches', async () => {
    h.state.result = { data: [
      B({ id: '1', created_at: '2026-01-01T00:00:00Z', approved_at: '2026-01-01T02:00:00Z' }),
      B({ id: '2', created_at: '2026-01-01T00:00:00Z', approved_at: '2026-01-01T04:00:00Z' }),
      B({ id: '3', created_at: '2026-01-01T00:00:00Z', approved_at: null }),
    ], error: null }
    const s = await importControlStats({})
    expect(s.avgApprovalHours).toBe(3)
  })

  it('buckets null country/source and ranks uploaders (top 5)', async () => {
    const data = [B({ id: '0', country: null, source_system: null, uploader: 'z' })]
    for (let i = 1; i <= 6; i++) for (let j = 0; j < i; j++) data.push(B({ id: `${i}-${j}`, uploader: `u${i}` }))
    h.state.result = { data, error: null }
    const s = await importControlStats({})
    expect(s.byCountry.Unassigned).toBe(1)
    expect(s.bySource.Unknown).toBeGreaterThanOrEqual(1)
    expect(s.topUploaders).toHaveLength(5)
    expect(s.topUploaders[0]).toEqual({ uploader: 'u6', count: 6 })
  })

  it('caps latest at 8 and applies the country filter', async () => {
    h.state.result = { data: Array.from({ length: 10 }, (_, i) => B({ id: `${i}` })), error: null }
    const s = await importControlStats({ country: 'UAE' })
    expect(s.latest).toHaveLength(8)
    expect(h.state.last._calls.or.some((e) => e.includes('country.eq.UAE'))).toBe(true)
  })
})
