import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock that records the table, select columns,
// eq/or/gte/lte filters and resolves to a configurable { data, error }.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], gte: [], lte: [], select: null, order: null, limit: null }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      order(col, opts) { calls.order = [col, opts]; return b },
      limit(n) { calls.limit = n; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      gte(c, v) { calls.gte.push([c, v]); return b },
      lte(c, v) { calls.lte.push([c, v]); return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const sched = await import('../lib/api/scheduledReports')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

describe('scheduledReports - claims report type', () => {
  it('registers the Insurance Claims Summary type', () => {
    const claims = sched.REPORT_TYPES.find((r) => r.value === 'claims')
    expect(claims).toBeTruthy()
    expect(claims.label).toMatch(/claim/i)
  })

  it('claims dataset targets the accidents table with claim/liability columns', () => {
    const ds = sched.datasetFor('claims')
    expect(ds.table).toBe('accidents')
    expect(ds.dateCol).toBe('incident_date')
    expect(ds.cols).toContain('claim_amount')
    expect(ds.cols).toContain('claim_approved_amount')
    expect(ds.cols).toContain('insurer')
    expect(ds.cols).toContain('gcc_liability_ratio')
    // Column/header lists stay aligned so the export never mislabels a column.
    expect(ds.cols.length).toBe(ds.headers.length)
    expect(ds.orFilter).toContain('claim_amount.gt.0')
  })

  it('fetchReportRows applies the claims orFilter, country scope and date window', async () => {
    h.state.result = { data: [{ asset_no: 'V-1', claim_amount: 500 }], error: null }
    const { rows, dataset } = await sched.fetchReportRows('claims', {
      from: '2026-01-01', to: '2026-01-31', country: 'KSA',
    })
    const b = h.state.last
    expect(b._table).toBe('accidents')
    // claims-only OR + null-safe country OR are both applied.
    expect(b._calls.or).toContain(dataset.orFilter)
    expect(b._calls.or).toContain('country.eq.KSA,country.is.null')
    expect(b._calls.gte).toContainEqual(['incident_date', '2026-01-01'])
    expect(b._calls.lte).toContainEqual(['incident_date', '2026-01-31'])
    expect(rows).toEqual([{ asset_no: 'V-1', claim_amount: 500 }])
  })

  it('non-claims datasets carry no orFilter (regression guard)', async () => {
    await sched.fetchReportRows('inspection', { country: 'All' })
    const b = h.state.last
    expect(b._table).toBe('inspections')
    // Only country would add an or(); 'All' adds none, so no stray claims filter.
    expect(b._calls.or).toHaveLength(0)
  })
})
