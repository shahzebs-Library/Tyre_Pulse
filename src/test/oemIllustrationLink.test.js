import { describe, it, expect } from 'vitest'
import { linkIllustrationPages } from '../lib/oemPartsExtractor'

// Printed page -> PDF page, as the SANY SY412 book lays it out.
const map = new Map([['2-2', 16], ['2-3', 17], ['2-4', 18], ['2-5', 19]])

describe('linkIllustrationPages', () => {
  it('files a main part with a see page on the drawing it is numbered on, keeping its own drawing as a drill-down', () => {
    const [row] = linkIllustrationPages([{ printed_page: '2-3', see_page: '2-4', index_no: '1' }], map)
    expect(row.illustration_pdf_page).toBe(16)
    expect(row.subassembly_pdf_page).toBe(18)
  })

  it('keeps variants and plain parts on the assembly drawing with no drill-down', () => {
    const rows = linkIllustrationPages([
      { printed_page: '2-3', parent_index: '1' },
      { printed_page: '2-3', index_no: '22' },
    ], map)
    expect(rows.map((r) => r.illustration_pdf_page)).toEqual([16, 16])
    expect(rows.every((r) => r.subassembly_pdf_page === undefined)).toBe(true)
  })

  it('falls back to the see page only when the assembly drawing cannot be found', () => {
    const [row] = linkIllustrationPages([{ printed_page: '2-1', see_page: '2-4' }], map)
    expect(row.illustration_pdf_page).toBe(18)
    expect(row.subassembly_pdf_page).toBeUndefined()
  })
})
