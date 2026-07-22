import { describe, it, expect } from 'vitest'
import {
  fieldForHeader, buildHeaderMap, toNum, classifyLine, summarizeRows,
  rowsFromSheet, rowsFromParsedSheet, PARTS_FIELDS,
} from '../lib/partsExpense'

describe('fieldForHeader', () => {
  it('maps the Ramco grid headers (incl. truncated / misspelt)', () => {
    expect(fieldForHeader('Issue Number')).toBe('issue_number')
    expect(fieldForHeader('Work Order Number')).toBe('work_order_no')
    expect(fieldForHeader('Transaction Type')).toBe('txn_date')
    expect(fieldForHeader('Asset Code')).toBe('asset_code')
    expect(fieldForHeader('Itemcode')).toBe('item_code')
    expect(fieldForHeader('Item Description')).toBe('item_description')
    expect(fieldForHeader('Values')).toBe('value_amount')
    expect(fieldForHeader('Spare Parts')).toBe('spare_parts_amount')
    expect(fieldForHeader('Trye')).toBe('tyre_amount')
    expect(fieldForHeader('Oil')).toBe('oil_amount')
    expect(fieldForHeader('Total Parts Consumptio')).toBe('total_amount')
  })
  it('returns null for unknown headers', () => {
    expect(fieldForHeader('')).toBeNull()
    expect(fieldForHeader('random column')).toBeNull()
  })
})

describe('toNum', () => {
  it('parses numbers, strips commas, blank/NULL -> null', () => {
    expect(toNum('1,200.50')).toBe(1200.5)
    expect(toNum('860')).toBe(860)
    expect(toNum('')).toBeNull()
    expect(toNum('NULL')).toBeNull()
    expect(toNum(null)).toBeNull()
  })
})

describe('classifyLine - the intelligence', () => {
  it('keeps a real tyre correctly filed in the tyre column', () => {
    const r = classifyLine({ description: 'TIRE 315/80 R22.5 - RR99', value: '860', tyre: '860', total: '860' })
    expect(r.category).toBe('tyre'); expect(r.tyreCost).toBe(860); expect(r.lineCost).toBe(860)
  })
  it('moves a tyre amount misfiled in Spare Parts into tyres', () => {
    const r = classifyLine({ description: 'TIRE 315/80 R22.5 replacement', value: '900', spare: '900', total: '900' })
    expect(r.category).toBe('tyre'); expect(r.tyreCost).toBe(900); expect(r.spareCost).toBe(0)
  })
  it('pulls a non-tyre amount out of the tyre column (ERP glitch)', () => {
    const r = classifyLine({ description: 'PNEUMATIC AIR HOSE', value: '37', spare: '37', tyre: '37', total: '74' })
    expect(r.category).toBe('spare'); expect(r.tyreCost).toBe(0); expect(r.spareCost).toBe(37)
  })
  it('keeps tyre consumables (no size) as spare', () => {
    expect(classifyLine({ description: 'TYRE PUNCH GLUE', value: '125', spare: '125' }).category).toBe('spare')
    expect(classifyLine({ description: 'TIRE VALVE PIN', value: '1.8', spare: '1.8' }).category).toBe('spare')
  })
  it('classifies oil by keyword even when filed under spare', () => {
    expect(classifyLine({ description: 'ENGINE OIL -15W40', value: '65.7', spare: '65.7' }).category).toBe('oil')
    expect(classifyLine({ description: 'ENGINE OIL 15W40', value: '210', oil: '210' }).oilCost).toBe(210)
  })
  it('line cost uses Values, falling through a zero to Total then split', () => {
    expect(classifyLine({ description: 'X', value: '0', total: '50' }).lineCost).toBe(50)
    expect(classifyLine({ description: 'X', value: '', total: '', spare: '12' }).lineCost).toBe(12)
  })
})

describe('summarizeRows', () => {
  const rows = [
    { item_description: 'TIRE 315/80 R22.5', value_amount: '860', tyre_amount: '860', total_amount: '860' },
    { item_description: 'TIRE 315/80 R22.5 repl', value_amount: '900', spare_parts_amount: '900', total_amount: '900' },
    { item_description: 'PNEUMATIC AIR HOSE', value_amount: '37', spare_parts_amount: '37', tyre_amount: '37', total_amount: '74' },
    { item_description: 'ENGINE OIL 15W40', value_amount: '210', oil_amount: '210', total_amount: '210' },
    { item_description: 'TYRE PUNCH GLUE', value_amount: '125', spare_parts_amount: '125', total_amount: '125' },
  ]
  it('totals + reassignment counts are correct and non-double-counted', () => {
    const s = summarizeRows(rows)
    expect(s.rows).toBe(5)
    expect(s.total).toBe(2132)
    expect(s.tyre).toBe(1760)
    expect(s.spare).toBe(162)
    expect(s.oil).toBe(210)
    expect(s.reassignedToTyre).toBe(1) // the 900 tyre filed in spare
    expect(s.reassignedFromTyre).toBe(1) // the air hose 37 in the tyre column
  })
  it('empty input yields zeroes', () => {
    expect(summarizeRows([])).toMatchObject({ rows: 0, total: 0, tyre: 0 })
  })
})

describe('rowsFromSheet / rowsFromParsedSheet', () => {
  const aoa = [
    ['#', 'Issue Number', 'Work Order Number', 'Transaction Type', 'Asset Code', 'Asset Description', 'Asset Type', 'Store Code', 'Cost Center', 'Itemcode', 'Qty', 'Item Description', 'Values', 'Spare Parts', 'Trye', 'Oil', 'Total Parts Consumptio'],
    ['108', 'GC/MIS/1005/0726', 'GCKR/JC/2266/0726', '2026-07-21', 'MP075', 'x', 'PUMPS', 'DIRIYAH-ST', '100067', '223707-O', '1', 'TIRE 315/80 R22.5', '860', '', '860', '', '860'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]
  it('projects an array-of-arrays sheet to PARTS_FIELDS rows, dropping empties + keeping dates/codes', () => {
    const { rows, missing } = rowsFromSheet(aoa, { country: 'KSA' })
    expect(missing).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0].txn_date).toBe('2026-07-21')
    expect(rows[0].item_code).toBe('223707-O')
    expect(rows[0].tyre_amount).toBe('860')
    expect(rows[0].country).toBe('KSA')
    for (const f of PARTS_FIELDS) expect(f in rows[0]).toBe(true)
  })
  it('adapts a parseWorkbook sheet (header-keyed rows)', () => {
    const sheet = {
      columns: [{ index: 0, header: 'Item Description' }, { index: 1, header: 'Values' }, { index: 2, header: 'Spare Parts' }],
      rows: [{ 'Item Description': 'TIRE 315/80 R22.5', Values: '900', 'Spare Parts': '900' }],
    }
    const { rows, missing } = rowsFromParsedSheet(sheet, { country: 'KSA' })
    expect(missing).toEqual([])
    expect(rows[0].item_description).toBe('TIRE 315/80 R22.5')
    expect(rows[0].value_amount).toBe('900')
    expect(summarizeRows(rows).tyre).toBe(900)
  })
})

describe('buildHeaderMap', () => {
  it('flags missing required columns', () => {
    expect(buildHeaderMap(['Asset Code', 'Qty']).missing).toContain('item_description')
    expect(buildHeaderMap(['Item Description', 'Values']).missing).toEqual([])
  })
})
