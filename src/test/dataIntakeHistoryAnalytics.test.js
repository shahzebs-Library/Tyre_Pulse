import { describe, it, expect } from 'vitest'
import {
  indexFiles, enrichBatches, repeatFileGroups, summarizeIntake, moduleBreakdown,
  filterBatches, batchExportRows, BATCH_EXPORT_COLS, BATCH_EXPORT_HEADERS,
} from '../lib/dataIntakeHistoryAnalytics'

const NOW = new Date('2026-09-26T12:00:00Z')
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

const FILES = [
  { id: 'f1', original_filename: 'tyres.xlsx', sha256: SHA_A.toUpperCase(), size_bytes: 100 },
  { id: 'f2', original_filename: 'tyres copy.xlsx', sha256: SHA_A },
  { id: 'f3', original_filename: 'fleet.csv', sha256: SHA_B },
  { id: 'f4', original_filename: 'unhashed.csv', sha256: null },
]

const BATCHES = [
  { id: 'b1', file_id: 'f1', module: 'tyre', country: 'KSA', import_status: 'committed', approval_status: 'approved', total_rows: 100, imported_rows: 95, error_rows: 5, duplicate_rows: 0, created_at: '2026-09-20T08:00:00Z' },
  { id: 'b2', file_id: 'f2', module: 'tyre', country: 'KSA', import_status: 'committed', approval_status: 'approved', total_rows: 100, imported_rows: 100, error_rows: 0, duplicate_rows: 0, created_at: '2026-09-21T08:00:00Z' },
  { id: 'b3', file_id: 'f3', module: 'fleet', country: 'UAE', import_status: 'reversed', total_rows: 40, imported_rows: 0, created_at: '2026-09-22T08:00:00Z' },
  { id: 'b4', file_id: 'f4', module: 'fleet', country: 'UAE', import_status: 'staged', approval_status: 'draft', total_rows: 12, imported_rows: 0, created_at: '2026-09-01T08:00:00Z' },
  { id: 'b5', file_id: null, module: 'stock', country: 'KSA', import_status: 'committed', total_rows: 7, imported_rows: 0, error_rows: 7, created_at: '2026-09-25T08:00:00Z' },
]

describe('enrichBatches', () => {
  const rows = enrichBatches(BATCHES, FILES, { now: NOW })

  it('reuses the shared outcome logic for every batch', () => {
    expect(rows.map((r) => r.outcome)).toEqual(['done', 'done', 'undone', 'unfinished', 'nothing'])
    expect(rows[3].outcomeLabel).toBe('Never approved')
  })

  it('matches files by sha256 case-insensitively and counts repeats', () => {
    expect(rows[0].isRepeat).toBe(true)
    expect(rows[0].repeatCount).toBe(2)
    expect(rows[2].isRepeat).toBe(false)
    expect(rows[3].repeatCount).toBeNull()
    expect(rows[4].fileName).toBeNull()
  })

  it('computes age against the injected now', () => {
    expect(rows[3].ageDays).toBe(25)
    expect(enrichBatches([{ id: 'x' }], [], { now: NOW })[0].ageDays).toBeNull()
  })

  it('accepts a prebuilt index', () => {
    expect(enrichBatches(BATCHES, indexFiles(FILES), { now: NOW })[1].fileName).toBe('tyres copy.xlsx')
  })
})

describe('summarizeIntake', () => {
  const rows = enrichBatches(BATCHES, FILES, { now: NOW })

  it('counts batches by outcome and totals rows', () => {
    const s = summarizeIntake(rows)
    expect(s.total).toBe(5)
    expect(s.byOutcome).toEqual({ done: 2, undone: 1, unfinished: 1, nothing: 1, unknown: 0 })
    expect(s.rowsRead).toBe(259)
    expect(s.rowsImported).toBe(195)
    expect(s.rowsFailed).toBe(12)
    expect(s.importRate).toBe(75.3)
  })

  it('reports repeat files and flags content imported twice', () => {
    const s = summarizeIntake(rows)
    expect(s.repeatFiles).toBe(1)
    expect(s.repeatUploads).toBe(2)
    expect(s.importedTwice).toBe(1)
    expect(s.fingerprintCoverage).toBe(60)
  })

  it('counts stale never-approved batches beyond the threshold', () => {
    expect(summarizeIntake(rows, { staleDays: 7 }).staleUnfinished).toBe(1)
    expect(summarizeIntake(rows, { staleDays: 30 }).staleUnfinished).toBe(0)
  })

  it('reports null, not 0, when nothing was recorded', () => {
    const s = summarizeIntake(enrichBatches([{ id: 'x', import_status: 'staged' }], [], { now: NOW }))
    expect(s.rowsRead).toBeNull()
    expect(s.rowsFailed).toBeNull()
    expect(s.importRate).toBeNull()
    expect(summarizeIntake([]).fingerprintCoverage).toBeNull()
  })
})

describe('groups, breakdown, filter, export', () => {
  const rows = enrichBatches(BATCHES, FILES, { now: NOW })

  it('groups repeat uploads oldest first', () => {
    const [g] = repeatFileGroups(rows)
    expect(g.batchIds).toEqual(['b1', 'b2'])
    expect(g.fileName).toBe('tyres.xlsx')
  })

  it('breaks down per module with honest nulls', () => {
    const mods = moduleBreakdown(rows)
    expect(mods[0].module).toBe('fleet')
    const tyre = mods.find((m) => m.module === 'tyre')
    expect(tyre.importRate).toBe(97.5)
    const none = moduleBreakdown(enrichBatches([{ id: 'x', module: 'm' }], [], { now: NOW }))
    expect(none[0].rowsRead).toBeNull()
  })

  it('filters by outcome, module, repeat and search', () => {
    expect(filterBatches(rows, { outcome: 'done' }).length).toBe(2)
    expect(filterBatches(rows, { module: 'fleet' }).length).toBe(2)
    expect(filterBatches(rows, { repeatOnly: true }).map((r) => r.id)).toEqual(['b1', 'b2'])
    expect(filterBatches(rows, { search: 'fleet.csv' }).map((r) => r.id)).toEqual(['b3'])
  })

  it('exports N/A for unrecorded figures', () => {
    const out = batchExportRows(rows)
    expect(BATCH_EXPORT_COLS.length).toBe(BATCH_EXPORT_HEADERS.length)
    expect(out[2].failed).toBe('N/A')
    expect(out[4].file).toBe('N/A')
    expect(out[0].imported).toBe(95)
  })
})
