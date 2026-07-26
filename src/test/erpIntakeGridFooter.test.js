/**
 * Grid (parts_consumption) intake must drop the Ramco report footer.
 *
 * The grid is the ONLY authoritative cost source, and its export ends in the same footer
 * band as every other Ramco report: a GRAND TOTAL line, a "Printed By" + employee-id
 * stamp, and an "Applied filters:" note. The GRAND TOTAL line carries the file's OWN
 * total in the Values column, so importing it as a normal line counts every amount a
 * second time and doubles the expense. The tyre / complaints / open-job-card branches
 * already drop the footer through erpIntake.isFooterRow; these lock the same behaviour
 * into the grid branch (partsExpense.rowsFromSheet) and prove real lines survive.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { rowsFromSheet, summarizeRows } from '../lib/partsExpense'
import { detectReport } from '../lib/erpIntake'
import { parseWorkbookRaw } from '../lib/import/parseWorkbook'

const HEADER = [
  '#', 'Issue Number', 'Work Order Number', 'Transaction Type', 'Asset Code',
  'Asset Description', 'Asset Type', 'Store Code', 'Cost Center', 'Itemcode', 'Qty',
  'Item Description', 'Values', 'Spare Parts', 'Trye', 'Oil', 'Total Parts Consumptio',
]

// Header on row 3 under the title band, two real lines (860 tyre + 140 oil = 1000),
// then the footer band the ERP appends.
const GRID_AOA = [
  ['', '', '', '', '', 'WORK ORDER DETAILS', '', '', ''],
  ['', 'DATE FROM', ': 01 July 2026', '', '', '', '', '', ''],
  HEADER,
  ['1', 'GC/MIS/1005/0726', 'GCKR/JC/2266/0726', '2026-07-21', 'MP075', 'x', 'PUMPS',
    'DIRIYAH-ST', '100067', '223707-O', '1', 'TIRE 315/80 R22.5', '860', '', '860', '', '860'],
  ['2', 'GC/MIS/1006/0726', 'GCKR/JC/2267/0726', '2026-07-22', 'MP076', 'x', 'PUMPS',
    'DIRIYAH-ST', '100067', '9911', '1', 'ENGINE OIL 15W40', '140', '', '', '140', '140'],
  ['GRAND TOTAL ', '', '', '', '', '', '', '', '', '', '', '', '1000', '', '860', '140', '1000'],
  ['', 'Printed By', '10014067', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['Applied filters: rfr_category is not GENERATOR', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
]

const gridRows = () => {
  const det = detectReport(GRID_AOA)
  expect(det.type).toBe('grid')
  return rowsFromSheet(GRID_AOA.slice(det.headerIndex), { country: 'KSA' })
}

describe('grid intake drops the Ramco footer', () => {
  it('never imports the GRAND TOTAL line as an expense row', () => {
    const { rows } = gridRows()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.item_description)).toEqual(['TIRE 315/80 R22.5', 'ENGINE OIL 15W40'])
    expect(rows.some((r) => /grand total/i.test(Object.values(r).join(' ')))).toBe(false)
  })

  it('keeps the total honest - the footer would otherwise double it', () => {
    const s = summarizeRows(gridRows().rows)
    expect(s.total).toBe(1000)      // 2000 when the GRAND TOTAL line is imported
    expect(s.tyre).toBe(860)
    expect(s.oil).toBe(140)
    expect(s.spare).toBe(0)         // the footer used to land here as a 1000 spare line
    expect(s.reassignedFromTyre).toBe(0) // and used to distort the intelligence counters
  })

  it('drops the printed-by stamp instead of importing a bogus work order number', () => {
    const { rows } = gridRows()
    expect(rows.some((r) => r.work_order_no === '10014067')).toBe(false)
  })

  it('accounts for every body row (body = read + footer + blank; read = mapped + noKey)', () => {
    const { rows, read, footerRows, blankRows, noKey } = gridRows()
    // body below the header = 2 data + 3 footer + 1 blank
    expect(read + footerRows + blankRows).toBe(6)
    expect(footerRows).toBe(3)
    expect(blankRows).toBe(1)
    expect(read).toBe(rows.length + noKey)
    expect(noKey).toBe(0)
  })

  it('does not mistake a real expense line for a footer', () => {
    const aoa = [HEADER, GRID_AOA[3], GRID_AOA[4]]
    const { rows, footerRows } = rowsFromSheet(aoa, { country: 'KSA' })
    expect(footerRows).toBe(0)
    expect(rows).toHaveLength(2)
    expect(summarizeRows(rows).total).toBe(1000)
  })
})

// The dangerous direction is the other one: a footer filter that eats real expense
// lines would UNDER-state the only authoritative cost source. The customer's actual
// grid export is committed under docs/imports (it is a raw grid-view dump and carries
// no footer band, unlike the report-style exports), so it proves the filter is inert
// on real data. Skipped gracefully if the folder is removed.
const GRID_FILE = join(process.cwd(), 'docs', 'imports', 'Work Order Details.xls')

describe('real Work Order Details export (docs/imports)', () => {
  it.skipIf(!existsSync(GRID_FILE))('drops nothing from the real grid export', async () => {
    const buf = readFileSync(GRID_FILE)
    const parsed = await parseWorkbookRaw(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      { fileName: 'Work Order Details.xls' },
    )
    const sheet = parsed.sheets.find((s) => detectReport(s.aoa)?.type === 'grid')
    expect(sheet).toBeTruthy()
    const det = detectReport(sheet.aoa)
    const g = rowsFromSheet(sheet.aoa.slice(det.headerIndex), { country: 'KSA' })
    expect(g.footerRows).toBe(0)        // this export has no footer band
    expect(g.rows.length).toBe(g.read)  // every content row still maps
    expect(g.rows.length).toBeGreaterThan(0)
    expect(g.rows.every((r) => r.item_description)).toBe(true)
    expect(summarizeRows(g.rows).total).toBeGreaterThan(0)
  })
})
