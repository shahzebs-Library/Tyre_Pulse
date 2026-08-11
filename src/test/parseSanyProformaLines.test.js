import { describe, it, expect } from 'vitest'
import { parseSanyProformaLineItems, parseSanyProformaPdf, pdfItemsToLines } from '../lib/import/parsePdf'

/**
 * The fixtures below reproduce the geometry of the real SANY proformas (the x/y
 * coordinates are taken from the Jan-Apr 2026 pair), including every trap:
 *   - an amount split across three text items ("$161" "," "916.31")
 *   - ordinal superscripts on their own baseline ("3" / "rd" / "Year")
 *   - a Machinery + Charge Standard cell MERGED across two contract-year rows
 *   - a $0.00 line for an "Excavator" (a bare /vat/ match would cut the table)
 *   - a totals block with a negative deduction that must never become a line
 */
const it_ = (x, y, str) => ({ page: 1, x, y, str })

function buildItems({ totalStr = '$ 180,429.77' } = {}) {
  return [
    // ---- document preamble (above the table header) ----
    it_(124, 660, 'SANY AUTOMOBILE MANUFACTURING CO., LTD.'),
    it_(177, 630, 'Proforma Invoice of Service Contract'),
    it_(444, 615, 'Ref. No.'), it_(483, 615, 'SYDU20250415'),
    it_(33, 526, 'PI Duration : 2026 - Jan - 15th --- 2026 - Apr - 15th'),
    it_(33, 512, 'Currency: USD'),
    // "Involved Equipment" summary sits above the header and must be ignored
    it_(57, 441, 'Quantity'), it_(142, 441, '232'), it_(226, 441, '2'),

    // ---- table header (defines the column boundaries) ----
    it_(73, 417, 'Machinery'), it_(198, 423, 'Charge'), it_(194, 411, 'Standard'),
    it_(270, 423, 'Activation'), it_(283, 411, 'Date'), it_(342, 417, 'Units'),
    it_(423, 417, 'Details'), it_(509, 423, 'Total Amount'), it_(527, 411, '(USD)'),

    // ---- line 1: per-kilometre mixer, amount split across three items ----
    it_(33, 388, 'SANY Concrete Mixer'), it_(33, 372, 'SY412C-8'),
    it_(192, 375, '0.0587 USD'), it_(189, 364, 'Per Kilometer'),
    it_(290, 369, '--'), it_(347, 369, '232'), it_(408, 369, '2,758,370 KM'),
    it_(514, 369, '$161'), it_(535, 369, ','), it_(538, 369, '916.31'),

    // ---- lines 2 and 3: ONE merged machinery + charge cell, two rows ----
    it_(33, 302, 'SANY Truck-mounted concrete'), it_(33, 291, 'pump'), it_(33, 275, 'SYG5370THB 47 Benz'),
    it_(204, 317, 'rd'), it_(200, 314, '3'), it_(212, 314, 'Year'), it_(190, 304, 'Annually 6%'),
    it_(210, 296, 'th'), it_(194, 293, '4&5'), it_(217, 293, 'Year'), it_(190, 283, 'Annually 7%'),
    it_(181, 273, 'Of 264,478 USD'),
    it_(269, 314, '1st-Feb-2021'), it_(351, 314, '2'),
    it_(390, 319, '15'), it_(399, 322, 'th'), it_(404, 319, 'Jan 2026-15'), it_(448, 322, 'th'), it_(453, 319, 'Apr 2026'),
    it_(429, 309, '(7%)'), it_(520, 313, '$9,256.73'),
    it_(271, 263, '1st-Jul-2021'), it_(351, 263, '2'),
    it_(390, 268, '15'), it_(399, 271, 'th'), it_(404, 268, 'Jan 2026-15'), it_(448, 271, 'th'), it_(453, 268, 'Apr 2026'),
    it_(429, 258, '(7%)'), it_(517, 262, '$9,256.73'),

    // ---- line 4: a zero-amount Excavator (the /vat/ regression) ----
    it_(74, 212, 'Excavator'), it_(71, 198, 'SY215HD'),
    it_(204, 218, 'nd'), it_(199, 215, '2'), it_(212, 215, 'Year'), it_(190, 205, 'Annually 8%'),
    it_(270, 212, '1st-Jan-2025'), it_(351, 212, '0'), it_(429, 207, '(8%)'), it_(529, 212, '$0.00'),

    // ---- totals block (never a line) ----
    it_(218, 180, 'Total Amount (USD)'), it_(510, 180, totalStr),
    it_(403, 160, 'Deduction of Penalty'), it_(506, 158, '-$ 18,042.98'),
    it_(369, 140, 'Total Net Amount (USD)'), it_(508, 137, '$162,386.79'),
    it_(33, 120, 'SELLER’S BANK INFORMATION:'), it_(143, 120, 'INDUSTRIAL AND COMMERCIAL BANK OF CHINA'),
  ]
}

const LINE_SUM = 161916.31 + 9256.73 + 9256.73

describe('parseSanyProformaLineItems', () => {
  const { lines, total_usd: total } = parseSanyProformaLineItems(buildItems())

  it('finds exactly one line per amount and ignores the totals block', () => {
    expect(lines).toHaveLength(4)
    expect(lines.map((l) => l.line_no)).toEqual([1, 2, 3, 4])
    expect(lines.map((l) => l.amount_usd)).toEqual([161916.31, 9256.73, 9256.73, 0])
    expect(total).toBeCloseTo(LINE_SUM, 2)
  })

  it('reassembles an amount split across several text items', () => {
    expect(lines[0].amount_usd).toBe(161916.31)
  })

  it('reads the units count that sits just left of the amount', () => {
    expect(lines.map((l) => l.units)).toEqual([232, 2, 2, 0])
  })

  it('keeps the per-kilometre usage figure and leaves it null on flat-rate lines', () => {
    expect(lines[0].usage_detail).toBe('2,758,370 KM')
    expect(lines[1].usage_detail).toBeNull()
    expect(lines[3].usage_detail).toBeNull()
  })

  it('normalises the activation date and never invents one', () => {
    expect(lines[0].activation_date).toBeNull() // the source cell is "--"
    expect(lines[1].activation_date).toBe('2021-02-01')
    expect(lines[2].activation_date).toBe('2021-07-01')
    expect(lines[3].activation_date).toBe('2025-01-01')
  })

  it('carries a MERGED machinery cell across every row it spans', () => {
    expect(lines[1].machinery).toBe('SANY Truck-mounted concrete pump SYG5370THB 47 Benz')
    expect(lines[2].machinery).toBe(lines[1].machinery)
    expect(lines[0].machinery).toBe('SANY Concrete Mixer')
    expect(lines[3].machinery).toBe('Excavator')
  })

  it('claims a model only when the cell holds exactly one code line', () => {
    expect(lines[0].model).toBe('SY412C-8')
    expect(lines[3].model).toBe('SY215HD')
    // "SYG5370THB 47 Benz" is not an unambiguous code line, so model stays null
    expect(lines[1].model).toBeNull()
  })

  it('rebuilds the charge standard with its superscripts closed up', () => {
    expect(lines[0].charge_standard).toBe('0.0587 USD Per Kilometer')
    expect(lines[1].charge_standard).toBe('3rd Year Annually 6% 4&5th Year Annually 7% Of 264,478 USD')
  })

  it('picks the contract year matching the rate shown on that row', () => {
    expect(lines[1].contract_year).toBe('4&5th Year') // the row shows (7%)
    expect(lines[3].contract_year).toBe('2nd Year')
    expect(lines[0].contract_year).toBeNull() // per-kilometre, no year term
  })

  it('does not cut the table short on an "Excavator" (bare /vat/ regression)', () => {
    expect(lines[3].machinery).toBe('Excavator')
    expect(lines[3].amount_usd).toBe(0)
  })

  it('is safe on empty / junk input', () => {
    expect(parseSanyProformaLineItems([])).toEqual({ lines: [], total_usd: null })
    expect(parseSanyProformaLineItems(null)).toEqual({ lines: [], total_usd: null })
    expect(parseSanyProformaLineItems([{ x: 1, y: 1, str: 'hello' }]).lines).toEqual([])
  })
})

describe('parseSanyProformaPdf line-table reconciliation', () => {
  it('reports reconcile TRUE when the line sum equals the stated gross', () => {
    const items = buildItems()
    const r = parseSanyProformaPdf(pdfItemsToLines(items), { items })
    expect(r).not.toBeNull()
    expect(r['Gross Amount (USD)']).toBeCloseTo(LINE_SUM, 2)
    expect(r.lines).toHaveLength(4)
    expect(r.lines_total_usd).toBeCloseTo(LINE_SUM, 2)
    expect(r.lines_reconcile).toBe(true)
  })

  it('reports reconcile FALSE when the line sum misses the stated gross', () => {
    // A machine line the parser failed to see would look exactly like this.
    const items = buildItems({ totalStr: '$ 190,429.77' })
    const r = parseSanyProformaPdf(pdfItemsToLines(items), { items })
    expect(r['Gross Amount (USD)']).toBeCloseTo(190429.77, 2)
    expect(r.lines_total_usd).toBeCloseTo(LINE_SUM, 2)
    expect(r.lines_reconcile).toBe(false)
  })

  it('returns an empty, non-reconciling line table when no positions are supplied', () => {
    const r = parseSanyProformaPdf(pdfItemsToLines(buildItems()))
    expect(r.lines).toEqual([])
    expect(r.lines_total_usd).toBeNull()
    expect(r.lines_reconcile).toBe(false)
  })

  it('leaves the existing totals and deductions untouched', () => {
    const items = buildItems()
    const r = parseSanyProformaPdf(pdfItemsToLines(items), { items })
    expect(r['Net Amount (USD)']).toBeCloseTo(162386.79, 2)
    expect(r.Deductions).toHaveLength(1)
    expect(r.Deductions[0]).toMatchObject({ label: 'Penalty', amount_usd: 18042.98 })
    expect(r['Quotation No']).toBe('SYDU20250415')
    expect(r.Date).toBe('2026-04-15')
  })
})

describe('pdfItemsToLines', () => {
  it('groups items into visual lines, top to bottom, left to right', () => {
    expect(pdfItemsToLines([
      { page: 1, x: 50, y: 100, str: 'world' },
      { page: 1, x: 10, y: 100, str: 'hello' },
      { page: 1, x: 10, y: 200, str: 'first' },
      { page: 2, x: 10, y: 900, str: 'second page' },
    ])).toEqual(['first', 'hello world', 'second page'])
  })
})
