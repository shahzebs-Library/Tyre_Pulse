import { describe, it, expect } from 'vitest'
import { chunkPages, printQrSize, labelGrid } from '../lib/qrLabelLayout'
import { toPrintJobRow, fromPrintJobRow, printJobTotals, MAX_JOB_CODES } from '../lib/qrLabelsView'

describe('print sheet layout', () => {
  it('chunks a run into A4 pages of the grid size', () => {
    const g = labelGrid('md')
    const pages = chunkPages(Array.from({ length: g.perPage + 1 }, (_, i) => i), g.perPage)
    expect(pages.map((p) => p.length)).toEqual([g.perPage, 1])
    expect(chunkPages([], 5)).toEqual([])
    expect(chunkPages([1, 2], 0)).toEqual([[1], [2]])
  })
  it('keeps the QR inside the label and scannable', () => {
    for (const k of ['sm', 'md', 'lg']) {
      const g = labelGrid(k)
      const q = printQrSize(g, { logo: true, lines: 2, idLines: 2 })
      expect(q).toBeGreaterThanOrEqual(10)
      expect(q).toBeLessThanOrEqual(g.w - 6)
    }
    expect(printQrSize(labelGrid('md'), { logo: false })).toBeGreaterThan(printQrSize(labelGrid('md'), { logo: true }))
  })
})

describe('saved print history mapping', () => {
  const batch = { batchNo: 'QR-20260929-004', action: 'printed', items: 2, labels: 4, by: 'You', type: 'tyres' }
  it('stores codes only, deduped, with the db type token', () => {
    const row = toPrintJobRow(batch, [
      { type: 'tyres', val: 'A1', qr: 'data:x' }, { type: 'tyres', val: 'A1', qr: 'data:x' }, { type: 'tyres', val: ' B2 ' },
    ], { country: 'All', labelSize: 'md' })
    expect(row).toMatchObject({ batch_no: 'QR-20260929-004', label_type: 'tyre', action: 'printed', items: 2, labels: 4, codes: ['A1', 'B2'], country: null, created_by_name: null })
    expect(JSON.stringify(row)).not.toContain('data:x')
  })
  it('marks mixed runs and caps the code list', () => {
    const many = Array.from({ length: MAX_JOB_CODES + 5 }, (_, i) => ({ type: i % 2 ? 'vehicles' : 'equipment', val: `C${i}` }))
    const row = toPrintJobRow(batch, many, { country: 'KSA' })
    expect(row.label_type).toBe('mixed')
    expect(row.codes).toHaveLength(MAX_JOB_CODES)
    expect(row.country).toBe('KSA')
  })
  it('round trips to the batch shape with N/A for an unknown maker', () => {
    const b = fromPrintJobRow({ id: 'x', batch_no: 'QR-1', label_type: 'vehicle', action: 'pdf', items: 1, labels: 3, codes: ['TM514'], created_by_name: null, created_at: '2026-09-29T10:00:00Z' })
    expect(b).toMatchObject({ id: 'x', type: 'vehicles', by: 'N/A', saved: true, labels: 3 })
    expect(b.entries[0]).toMatchObject({ val: 'TM514', qr: null, lines: [] })
  })
  it('totals by action and returns null when unread', () => {
    expect(printJobTotals(null)).toBeNull()
    expect(printJobTotals([{ action: 'generated', labels: 5 }, { action: 'printed', labels: 2 }, { action: 'pdf', labels: 3 }, { action: 'excel', labels: 9 }]))
      .toEqual({ generated: 5, printed: 2, exported: 3, jobs: 4 })
  })
})
