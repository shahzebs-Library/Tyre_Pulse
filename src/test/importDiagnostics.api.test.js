import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable Supabase mock. Each from(table) returns a builder that records the
// filter calls (eq/in) it received and resolves — via .single(), .limit() or a
// thenable — to the per-table { data, error } configured on state.results.
// state.calls collects every builder so a test can assert which filters ran.
const h = vi.hoisted(() => {
  const state = { results: {}, calls: [] }
  function resultFor(table) {
    return state.results[table] ?? { data: [], error: null }
  }
  function from(table) {
    const calls = { table, eq: [], in: [], order: [], limit: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      in(c, v) { calls.in.push([c, v]); return b },
      order(c) { calls.order.push(c); return b },
      limit(n) { calls.limit.push(n); return b },
      single() { return Promise.resolve(resultFor(table)) },
      maybeSingle() { return Promise.resolve(resultFor(table)) },
      then(onF, onR) { return Promise.resolve(resultFor(table)).then(onF, onR) },
    }
    state.calls.push(b)
    return b
  }
  return { state, supabase: { from } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const mod = await import('../lib/api/importDiagnostics')

beforeEach(() => { h.state.results = {}; h.state.calls = [] })

// Find recorded builders for a table (a table may be queried more than once).
const buildersFor = (table) => h.state.calls.filter((b) => b._table === table)

describe('getBatch', () => {
  it('returns the single import_batches row', async () => {
    const batch = { id: 'b1', module: 'tyre', import_status: 'committed' }
    h.state.results.import_batches = { data: batch, error: null }
    const out = await mod.getBatch('b1')
    expect(out).toEqual(batch)
    const b = buildersFor('import_batches')[0]
    expect(b._calls.eq).toContainEqual(['id', 'b1'])
  })

  it('throws when Supabase returns an error', async () => {
    h.state.results.import_batches = { data: null, error: { message: 'boom' } }
    await expect(mod.getBatch('b1')).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('listBatchRows', () => {
  it('filters by batch and orders by source_row_no', async () => {
    h.state.results.import_rows = { data: [{ id: 'r1', source_row_no: 1 }], error: null }
    const rows = await mod.listBatchRows('b1')
    expect(rows).toHaveLength(1)
    const b = buildersFor('import_rows')[0]
    expect(b._calls.eq).toContainEqual(['batch_id', 'b1'])
    expect(b._calls.order).toContain('source_row_no')
    // onlyErrors defaults off — no validation_status filter applied.
    expect(b._calls.eq).not.toContainEqual(['validation_status', 'error'])
  })

  it('applies the validation_status=error filter when onlyErrors is set', async () => {
    h.state.results.import_rows = { data: [], error: null }
    await mod.listBatchRows('b1', { onlyErrors: true, limit: 50 })
    const b = buildersFor('import_rows')[0]
    expect(b._calls.eq).toContainEqual(['validation_status', 'error'])
    expect(b._calls.limit).toContain(50)
  })
})

describe('listBatchIssues', () => {
  it('returns [] without querying import_row_issues when the batch has no rows', async () => {
    h.state.results.import_rows = { data: [], error: null }
    const issues = await mod.listBatchIssues('b1')
    expect(issues).toEqual([])
    expect(buildersFor('import_row_issues')).toHaveLength(0)
  })

  it('enriches each issue with its row source_row_no via the row map', async () => {
    h.state.results.import_rows = { data: [{ id: 'r1', source_row_no: 7 }, { id: 'r2', source_row_no: 9 }], error: null }
    h.state.results.import_row_issues = {
      data: [
        { row_id: 'r1', severity: 'error', issue_code: 'COMMIT_FAILED', message: 'x' },
        { row_id: 'r2', severity: 'error', issue_code: 'COMMIT_FAILED', message: 'y' },
      ],
      error: null,
    }
    const issues = await mod.listBatchIssues('b1', { onlyErrors: true })
    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatchObject({ row_id: 'r1', source_row_no: 7 })
    expect(issues[1]).toMatchObject({ row_id: 'r2', source_row_no: 9 })
    const ib = buildersFor('import_row_issues')[0]
    expect(ib._calls.in).toContainEqual(['row_id', ['r1', 'r2']])
    expect(ib._calls.eq).toContainEqual(['severity', 'error'])
  })
})

describe('getBatchDiagnostics', () => {
  it('composes batch, rows and issues and computes failedRows', async () => {
    h.state.results.import_batches = { data: { id: 'b1', import_status: 'committed' }, error: null }
    h.state.results.import_rows = {
      data: [
        { id: 'r1', source_row_no: 1, validation_status: 'error', action: 'insert', target_record_id: null, processed_at: null },
        { id: 'r2', source_row_no: 2, validation_status: 'ready', action: 'insert', target_record_id: null, processed_at: '2026-01-01T00:00:00Z' },
        { id: 'r3', source_row_no: 3, validation_status: 'ready', action: 'insert', target_record_id: 'live-1', processed_at: '2026-01-01T00:00:00Z' },
        { id: 'r4', source_row_no: 4, validation_status: 'ready', action: 'skip', target_record_id: null, processed_at: '2026-01-01T00:00:00Z' },
      ],
      error: null,
    }
    h.state.results.import_row_issues = {
      data: [{ row_id: 'r1', severity: 'error', issue_code: 'COMMIT_FAILED', message: 'nope' }],
      error: null,
    }
    const out = await mod.getBatchDiagnostics('b1')
    expect(out.batch).toMatchObject({ id: 'b1' })
    expect(out.rows).toHaveLength(4)
    expect(out.issues).toHaveLength(1)
    expect(out.issues[0]).toMatchObject({ source_row_no: 1 })
    // r1 (validation error) and r2 (processed, insert, no target) are failures.
    // r3 landed live, r4 was intentionally skipped — neither counts.
    expect(out.failedRows.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
  })
})
