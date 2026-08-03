import { describe, it, expect } from 'vitest'
import { parseSanyPdfRows, parseSanyProformaPdf } from '../lib/import/parsePdf'

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

describe('parseSanyProformaPdf (SANY service-contract proforma, USD)', () => {
  // Fixture reproduces the real PDF's quirks: digits split across text items,
  // the word "Deduction" broken ("Deduct ion" / "D eduction"), negative "-$"
  // deductions, and YYYY-Mon-DD dates with fragmented year digits.
  const lines = [
    'SANY AUTOMOBILE MANUFACTURING CO., LTD.',
    'Proforma Invoice of Service Contract',
    'Ref. No. SYDU202 504 15',
    'Service Contract NO.: SYCAM202110',
    'PI Duration : 202 6 - Apr - 1 6 th -- 202 6 - Jul - 15th',
    'Currency: USD',
    'Total Amount (USD) $ 5 34 , 641 . 02',
    'Deduction of Penalty - $ 51,690.90',
    'Deduct ion of Green Concrete purchased items (Currency rate:1 USD=3.75 SAR) - $ 87 , 803 . 47',
    'D eduction of SANY 11 labor food and accommodation - $ 1 3 , 2 00.00',
    'Total Net Amount (USD) $ 3 81 , 946 . 65',
    'Date: 202 6 - Jul - 15th',
  ]

  it('extracts gross, net, fx and the SAR amount that feeds Cost/M3', () => {
    const r = parseSanyProformaPdf(lines)
    expect(r).not.toBeNull()
    expect(r['Gross Amount (USD)']).toBeCloseTo(534641.02, 2)
    expect(r['Net Amount (USD)']).toBeCloseTo(381946.65, 2)
    expect(r['FX Rate']).toBe(3.75)
    // Cost/M3 uses gross converted to SAR (user decision).
    expect(r['Amount (SAR) / Cost']).toBeCloseTo(534641.02 * 3.75, 2)
    expect(r['Doc Type']).toBe('proforma')
    expect(r.Country).toBe('KSA')
    expect(r.Currency).toBe('USD')
    expect(r['Quotation No']).toBe('SYDU20250415')
  })

  it('captures all three deductions (broken "Deduction" word) summing to gross - net', () => {
    const r = parseSanyProformaPdf(lines)
    expect(r.Deductions).toHaveLength(3)
    const labels = r.Deductions.map((d) => d.label)
    expect(labels[0]).toBe('Penalty')
    expect(labels[1]).toMatch(/Green Concrete/)
    expect(labels[2]).toMatch(/labor food and accommodation/)
    const sum = r.Deductions.reduce((s, d) => s + d.amount_usd, 0)
    expect(sum).toBeCloseTo(534641.02 - 381946.65, 2)
  })

  it('derives the invoice date and period month', () => {
    const r = parseSanyProformaPdf(lines)
    expect(r.Date).toBe('2026-07-15')
    expect(r.__period_month).toBe('2026-07-01')
    expect(r['Parts Description']).toMatch(/2026-04-16 to 2026-07-15/)
  })

  it('returns null for a non-proforma PDF (so the summary parser runs)', () => {
    expect(parseSanyProformaPdf(['1 Western Region 06/09/2025 A 100.00'])).toBeNull()
    expect(parseSanyProformaPdf('')).toBeNull()
  })
})
