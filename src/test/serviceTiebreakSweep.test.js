import { describe, it, expect, vi, beforeEach } from 'vitest'

// Service-layer paging sweep (2026-09-27). Each read below is paged through the
// CONCURRENT fetchAllPages (or a UI pager) and ordered on a non-unique column,
// so it needs an `id` tiebreak or a page boundary drops/repeats rows. Also pins
// that a failed read THROWS a sanitised ServiceError instead of reading as [].
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, builders: [] }
  function from(table) {
    const calls = { order: [], eq: [], or: [], range: null }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order(c, o) { calls.order.push([c, o]); return b },
      range(f, t) { calls.range = [f, t]; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      in() { return b },
      is() { return b },
      gte() { return b },
      lte() { return b },
      not() { return b },
      limit() { return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.builders.push(b)
    return b
  }
  return { state, supabase: { from, rpc: () => Promise.resolve({ data: [], error: null }) } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const stock = await import('../lib/api/stock')
const assetUtilization = await import('../lib/api/assetUtilization')
const tyreRecords = await import('../lib/api/tyreRecords')
const accidentWorkflow = await import('../lib/api/accidentWorkflow')
const importDiagnostics = await import('../lib/api/importDiagnostics')
const workshopAbsence = await import('../lib/api/workshopAbsence')
const { ServiceError, fetchAllOrThrow } = await import('../lib/api/_client')

const orderCols = (b) => b._calls.order.map(([c]) => c)

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.builders = []
})

describe('service paging tiebreak sweep', () => {
  it('stock.listTyreIssuesSince orders by id and THROWS on error (was a silent [])', async () => {
    await stock.listTyreIssuesSince('2026-06-01')
    expect(orderCols(h.state.builders[0])).toContain('id')
    h.state.result = { data: null, error: { message: 'permission denied for table tyre_records', code: '42501' } }
    const err = await stock.listTyreIssuesSince('2026-06-01').catch((e) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect(err.message).not.toMatch(/tyre_records/)
  })

  it('assetUtilization.listAssetUtilization ends its order on the unique id', async () => {
    await assetUtilization.listAssetUtilization({ country: 'KSA' }).catch(() => {})
    const b = h.state.builders.find((x) => x._table === 'asset_utilization')
    expect(orderCols(b)).toEqual(['utilization_pct', 'asset_no', 'id'])
  })

  it('tyreRecords.listRecords (grid pager) orders issue_date then id', async () => {
    await tyreRecords.listRecords({ page: 1, pageSize: 50 })
    const b = h.state.builders[0]
    expect(orderCols(b)).toEqual(['issue_date', 'id'])
    expect(b._calls.range).toEqual([50, 99])
  })

  it('accidentWorkflow.listRoutingProfiles pages profiles with an id order', async () => {
    h.state.result = { data: [{ id: 'p1' }], error: null }
    const rows = await accidentWorkflow.listRoutingProfiles()
    const b = h.state.builders[0]
    expect(b._table).toBe('profiles')
    expect(orderCols(b)).toEqual(['id'])
    expect(b._calls.range).toEqual([0, 999])
    expect(rows).toEqual([{ id: 'p1' }])
  })

  it('workshopAbsence staff read is paged (the old .limit(5000) was capped at 1,000)', async () => {
    await workshopAbsence.loadAbsenceData({}).catch(() => {})
    const b = h.state.builders.find((x) => x._table === 'profiles')
    expect(b._calls.range).toEqual([0, 999])
    expect(orderCols(b)).toContain('id')
  })
})

describe('raw error leaks', () => {
  it('importDiagnostics.listBatchIssues throws a sanitised ServiceError, not the raw PostgREST error', async () => {
    h.state.result = { data: null, error: { message: 'permission denied for table import_rows', code: '42501' } }
    const err = await importDiagnostics.listBatchIssues('b1').catch((e) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect(err.code).toBe('42501')
    expect(err.message).not.toMatch(/import_rows/)
  })
})

describe('fetchAllOrThrow', () => {
  it('returns rows, flags truncation, and throws a sanitised ServiceError', async () => {
    const full = Array.from({ length: 2 }, (_, i) => ({ id: i }))
    const rows = await fetchAllOrThrow(() => Promise.resolve({ data: full, error: null }), { pageSize: 2, max: 2 })
    expect(rows).toHaveLength(2)
    expect(rows.truncated).toBe(true)
    const err = await fetchAllOrThrow(() => Promise.resolve({
      data: null, error: { message: 'relation "public.secret" does not exist', code: '42P01' },
    })).catch((e) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect(err.code).toBe('42P01')
    expect(err.message).not.toMatch(/secret/)
  })
})
