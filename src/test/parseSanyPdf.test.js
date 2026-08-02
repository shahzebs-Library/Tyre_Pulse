import { describe, it, expect } from 'vitest'
import { parseSanyPdfRows } from '../lib/import/parsePdf'

describe('parseSanyPdfRows', () => {
  it('parses one-record-per-line layout (pdf.js style)', () => {
    const lines = [
      'NO. REGION DATE QUOTATION NO. AMOUNT (SAR)',
      '1 Western Region 06/09/2025 20250906-16Y 1142.41',
      '9 Western Region 04/10/2025 GCC 10 710.36',
      '20 Western Region 30/10/2025 2025010-70R 6910',
      'TOTAL (SAR) 65271.72',
    ]
    const rows = parseSanyPdfRows(lines)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ Region: 'Western Region', Date: '06/09/2025', 'Quotation No': '20250906-16Y', 'Amount (SAR)': '1142.41' })
    // "GCC 10" is the quotation number, not the amount
    expect(rows[1]).toMatchObject({ 'Quotation No': 'GCC 10', 'Amount (SAR)': '710.36' })
    // integer amount
    expect(rows[2]).toMatchObject({ 'Quotation No': '2025010-70R', 'Amount (SAR)': '6910' })
  })

  it('parses field-per-line layout and keeps GCC-style quots intact', () => {
    const lines = [
      'Western Region', '06/09/2025', '20250906-16Y', '1142.41',
      'Western Region', '04/10/2025', 'GCC 10', '710.36',
      'Western Region', '30/10/2025', '2025010-70R', '6910',
      'TOTAL (SAR)', '65271.72',
    ]
    const rows = parseSanyPdfRows(lines)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toMatchObject({ 'Quotation No': 'GCC 10', 'Amount (SAR)': '710.36' })
    expect(rows[2]).toMatchObject({ 'Amount (SAR)': '6910' })
  })

  it('total of parsed amounts is sane and excludes the TOTAL row', () => {
    const lines = [
      '1 Western Region 06/09/2025 A 100.00',
      '2 Western Region 07/09/2025 B 200.50',
      'TOTAL (SAR) 300.50',
    ]
    const rows = parseSanyPdfRows(lines)
    const sum = rows.reduce((s, r) => s + Number(String(r['Amount (SAR)']).replace(/,/g, '')), 0)
    expect(rows).toHaveLength(2)
    expect(sum).toBeCloseTo(300.5, 2)
  })

  it('is safe on empty / junk input', () => {
    expect(parseSanyPdfRows('')).toEqual([])
    expect(parseSanyPdfRows(['header only', 'no data'])).toEqual([])
  })
})
