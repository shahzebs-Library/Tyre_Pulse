import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  shapeManifest, defaultSelection, planExport, validateReason, tableOutcome, summarizeResults,
  buildWorkbookSheets, buildJsonBundle, flattenRow, manifestBars, parseCeiling, EXCEL_SHEET_MAX,
} from '../lib/tenantExport'

const rpc = vi.fn()
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a) },
  unwrap: (r) => { if (r.error) throw r.error; return r.data },
}))

const RAW = {
  org_id: 'o1', org_name: 'Company A', generated_at: '2026-09-24T00:00:00Z', total_rows: 1205,
  tables: [
    { table: 'sites', rows: 5 },
    { table: 'work_orders', rows: 1200 },
    { table: 'alerts', rows: 0 },
    { table: 'drivers', rows: null, error: 'count_failed' },
  ],
}

describe('tenantExport engine', () => {
  it('shapes the manifest largest first and keeps unreadable tables as null, not zero', () => {
    const m = shapeManifest(RAW)
    expect(m.tables[0].table).toBe('work_orders')
    expect(m.tables.find((t) => t.table === 'drivers').rows).toBeNull()
    expect(m.unreadable).toBe(1)
    expect(m.nonEmpty).toBe(2)
    expect(m.tables.find((t) => t.table === 'work_orders').label).toBe('Job cards')
  })

  it('selects non-empty tables by default and plans truncation at the ceiling', () => {
    const m = shapeManifest(RAW)
    const sel = defaultSelection(m)
    expect([...sel].sort()).toEqual(['sites', 'work_orders'])
    const plan = planExport(m, sel, 1000)
    expect(plan.truncating).toEqual(['work_orders'])
    expect(plan.fetchRows).toBe(1005)
    expect(plan.expectedRows).toBe(1205)
  })

  it('clamps a nonsense ceiling to the default', () => {
    expect(parseCeiling('abc')).toBe(100000)
    expect(parseCeiling(5)).toBe(100000)
    expect(parseCeiling('25000')).toBe(25000)
  })

  it('requires a real reason', () => {
    expect(validateReason('')).toBeTruthy()
    expect(validateReason('ok')).toBeTruthy()
    expect(validateReason('legal hold request')).toBeNull()
  })

  it('classifies outcomes honestly', () => {
    expect(tableOutcome({ rows: [1, 2], complete: true, expected: 2 }).outcome).toBe('complete')
    expect(tableOutcome({ rows: [1], complete: true, expected: 2 }).outcome).toBe('drifted')
    expect(tableOutcome({ rows: [1], truncated: true, expected: 5 }).outcome).toBe('truncated')
    expect(tableOutcome({ rows: [1], error: 'boom' }).outcome).toBe('failed')
    expect(tableOutcome({ rows: [], complete: false }).outcome).toBe('failed')
  })

  it('never reports completed when any table is partial or failed', () => {
    const ok = summarizeResults([{ table: 'sites', rows: [{}, {}], complete: true, expected: 2 }])
    expect(ok.status).toBe('completed')
    expect(ok.notes).toEqual([])
    const part = summarizeResults([
      { table: 'sites', rows: [{}], complete: true, expected: 1 },
      { table: 'work_orders', rows: [{}], truncated: true, expected: 9 },
    ])
    expect(part.status).toBe('partial')
    expect(part.notes.join(' ')).toMatch(/NOT complete/)
    const bad = summarizeResults([{ table: 'sites', rows: [], error: 'x' }])
    expect(bad.status).toBe('failed')
    expect(summarizeResults([]).status).toBe('failed')
  })

  it('flattens nested values for spreadsheet cells', () => {
    expect(flattenRow({ a: 1, b: null, c: { x: 1 }, d: [1] })).toEqual({ a: 1, b: '', c: '{"x":1}', d: '[1]' })
  })

  it('reports a policy cap inside the workbook instead of cutting silently', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }))
    const wb = buildWorkbookSheets([{ table: 'sites', rows, complete: true, expected: 5 }], { maxExportRows: 3 })
    expect(wb.sheets[0].rows).toHaveLength(3)
    expect(wb.notes.join(' ')).toMatch(/first 3 of 5/)
    const failed = buildWorkbookSheets([{ table: 'drivers', rows: [], error: 'x' }])
    expect(failed.sheets[0].emptyNote).toMatch(/not empty/)
    expect(EXCEL_SHEET_MAX).toBe(1048575)
  })

  it('builds a JSON bundle with completeness per table', () => {
    const m = shapeManifest(RAW)
    const b = buildJsonBundle({ manifest: m, reason: ' offboarding ', jobId: 'j1', results: [
      { table: 'sites', rows: [{ id: 'a' }], complete: true, expected: 5 },
    ] })
    expect(b.organisation.name).toBe('Company A')
    expect(b.reason).toBe('offboarding')
    expect(b.complete).toBe(false)
    expect(b.tables.sites.outcome).toBe('drifted')
    expect(b.data.sites).toHaveLength(1)
  })

  it('charts only non-empty tables', () => {
    expect(manifestBars(shapeManifest(RAW)).map((b) => b.label)).toEqual(['Job cards', 'Sites'])
  })
})

describe('tenantExport service', () => {
  beforeEach(() => rpc.mockReset())

  it('pages by keyset until done', async () => {
    const { exportTableRows } = await import('../lib/api/tenantExport')
    rpc
      .mockResolvedValueOnce({ data: { rows: Array.from({ length: 1000 }, (_, i) => ({ id: i })), count: 1000, done: false, next_after: 'k1' } })
      .mockResolvedValueOnce({ data: { rows: [{ id: 'z' }], count: 1, done: true, next_after: null } })
    const r = await exportTableRows('o1', 'sites', { expected: 1001 })
    expect(r.rows).toHaveLength(1001)
    expect(r.complete).toBe(true)
    expect(rpc.mock.calls[1][1].p_after).toBe('k1')
  })

  it('marks a table truncated only when more rows exist past the ceiling', async () => {
    const { exportTableRows } = await import('../lib/api/tenantExport')
    const page = { rows: Array.from({ length: 1000 }, (_, i) => ({ id: i })), count: 1000, done: false, next_after: 'k1' }
    rpc.mockResolvedValueOnce({ data: page }).mockResolvedValueOnce({ data: { rows: [{ id: 'x' }], count: 1, done: true } })
    const t = await exportTableRows('o1', 'sites', { ceiling: 1000 })
    expect(t.truncated).toBe(true)
    rpc.mockResolvedValueOnce({ data: page }).mockResolvedValueOnce({ data: { rows: [], count: 0, done: true } })
    const exact = await exportTableRows('o1', 'sites', { ceiling: 1000 })
    expect(exact.truncated).toBe(false)
    expect(exact.complete).toBe(true)
  })

  it('returns a failure with rows so far instead of throwing', async () => {
    const { exportTableRows } = await import('../lib/api/tenantExport')
    rpc
      .mockResolvedValueOnce({ data: { rows: Array.from({ length: 1000 }, (_, i) => ({ id: i })), count: 1000, done: false, next_after: 'k1' } })
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } })
    const r = await exportTableRows('o1', 'sites')
    expect(r.rows).toHaveLength(1000)
    expect(r.complete).toBe(false)
    expect(r.error).toBeTruthy()
    expect(r.error).not.toMatch(/permission denied for/)
  })
})
