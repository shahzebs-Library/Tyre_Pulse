import { describe, it, expect } from 'vitest'
import { reconcileBatch } from '../lib/import/reconcile'

describe('import reconciliation — reconcileBatch', () => {
  it('returns a fully structured summary shape', () => {
    const out = reconcileBatch({
      import_status: 'committed',
      total_rows: 10,
      imported_rows: 8,
      skipped_rows: 1,
      error_rows: 1,
      duplicate_rows: 0,
    })
    expect(out).toEqual({
      expected: 10,
      imported: 8,
      skipped: 1,
      errors: 1,
      duplicates: 0,
      accountedFor: 10,
      variance: 0,
      balanced: true,
      state: 'committed',
      indicator: 'balanced',
      discrepancies: [],
    })
  })

  it('balances when imported + skipped + errors === total', () => {
    const out = reconcileBatch({
      import_status: 'committed',
      total_rows: 100,
      imported_rows: 90,
      skipped_rows: 7,
      error_rows: 3,
    })
    expect(out.balanced).toBe(true)
    expect(out.variance).toBe(0)
    expect(out.indicator).toBe('balanced')
    expect(out.discrepancies).toHaveLength(0)
  })

  it('flags unaccounted rows when the identity does not hold', () => {
    const out = reconcileBatch({
      import_status: 'committed',
      total_rows: 100,
      imported_rows: 90,
      skipped_rows: 0,
      error_rows: 0,
    })
    expect(out.balanced).toBe(false)
    expect(out.variance).toBe(10)
    expect(out.indicator).toBe('review')
    expect(out.discrepancies.some((d) => /does not balance/i.test(d))).toBe(true)
  })

  it('flags a committed batch that imported nothing', () => {
    const out = reconcileBatch({
      import_status: 'committed',
      total_rows: 5,
      imported_rows: 0,
      skipped_rows: 0,
      error_rows: 5,
    })
    expect(out.balanced).toBe(false)
    expect(out.discrepancies.some((d) => /no rows were imported/i.test(d))).toBe(true)
  })

  it('flags a committed batch with zero source rows', () => {
    const out = reconcileBatch({ import_status: 'committed', total_rows: 0, imported_rows: 0 })
    expect(out.balanced).toBe(false)
    expect(out.discrepancies.some((d) => /zero source rows/i.test(d))).toBe(true)
  })

  it('treats duplicates as informational, not part of the balance identity', () => {
    // 10 rows: 10 imported (some of which were duplicate lifecycle events), balances.
    const out = reconcileBatch({
      import_status: 'committed',
      total_rows: 10,
      imported_rows: 10,
      skipped_rows: 0,
      error_rows: 0,
      duplicate_rows: 4,
    })
    expect(out.duplicates).toBe(4)
    expect(out.balanced).toBe(true)
  })

  it('flags impossible duplicate/error counts exceeding total', () => {
    const out = reconcileBatch({
      import_status: 'committed',
      total_rows: 3,
      imported_rows: 3,
      duplicate_rows: 9,
      error_rows: 9,
    })
    expect(out.balanced).toBe(false)
    expect(out.discrepancies.some((d) => /Duplicate rows .* exceed/i.test(d))).toBe(true)
    expect(out.discrepancies.some((d) => /Error rows .* exceed/i.test(d))).toBe(true)
  })

  it('marks non-committed batches as pending without raising discrepancies', () => {
    for (const status of ['staged', 'validating', 'ready', 'committing']) {
      const out = reconcileBatch({ import_status: status, total_rows: 50, imported_rows: 0 })
      expect(out.state).toBe('pending')
      expect(out.indicator).toBe('pending')
      expect(out.discrepancies).toHaveLength(0)
      expect(out.balanced).toBe(false)
    }
  })

  it('a clean reversed batch (imported reset to 0) reconciles', () => {
    const out = reconcileBatch({ import_status: 'reversed', total_rows: 10, imported_rows: 0 })
    expect(out.state).toBe('reversed')
    expect(out.indicator).toBe('balanced')
    expect(out.discrepancies).toHaveLength(0)
  })

  it('a reversed batch that still reports imported rows needs review', () => {
    const out = reconcileBatch({ import_status: 'reversed', total_rows: 10, imported_rows: 4 })
    expect(out.indicator).toBe('review')
    expect(out.discrepancies.some((d) => /reversed but still reports/i.test(d))).toBe(true)
  })

  it('is defensive against null / missing / negative counters', () => {
    expect(() => reconcileBatch(null)).not.toThrow()
    expect(() => reconcileBatch(undefined)).not.toThrow()
    const out = reconcileBatch({ import_status: 'committed', total_rows: null, imported_rows: -5, error_rows: undefined })
    expect(out.expected).toBe(0)
    expect(out.imported).toBe(0)
    expect(out.errors).toBe(0)
    expect(out.state).toBe('committed')
  })

  it('coerces string counters and truncates fractional values', () => {
    const out = reconcileBatch({
      import_status: 'committed',
      total_rows: '10',
      imported_rows: '8.9',
      skipped_rows: '1',
      error_rows: '1',
    })
    expect(out.expected).toBe(10)
    expect(out.imported).toBe(8)
  })
})
