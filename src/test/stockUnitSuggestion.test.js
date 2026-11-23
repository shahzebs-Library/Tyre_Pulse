import { describe, it, expect } from 'vitest'
import { stockKind, suggestStockUnit, packSizeFrom, stockDraft, existingStockOptions } from '../lib/stockQuickEntry'

// Real item names from the live MIS / ERP catalogue.
describe('stockKind (mirror of public.stock_item_kind)', () => {
  it('keeps real tyres, rims and tyre accessories', () => {
    expect(stockKind('315/80 R22.5 TRIANGLE TR691')).toBe('tyre')
    expect(stockKind('INNER TUBE 12.00 R24')).toBe('accessory')
    expect(stockKind('TYRE PATCH # 3')).toBe('accessory')
    expect(stockKind('LONG TUBELESS VALVE FOR RIM 22.5"')).toBe('accessory')
    expect(stockKind('WHEEL NUT M22*1.5*32')).toBe('accessory')
  })
  it('no longer reads part numbers with a slash as tyre sizes', () => {
    expect(stockKind('HAND BRAKE VALVE 9617234210/0034305981')).toBe(null)
    expect(stockKind('BRAKE BOOSTER OEM#: 9253240000 / 03280007 / 2410')).toBe(null)
    expect(stockKind('WINDOW REGULATOR RH MANUAL 461923 / 9417200546')).toBe(null)
    expect(stockKind('REPAIR KIT, CLUTCH FORK (REPLACE) 6552540206 / 50829-490843')).toBe(null)
    expect(stockKind('BOLT NUT 12*60 10.9-931')).toBe(null)
  })
})

describe('suggestStockUnit', () => {
  it('prefers the unit recorded on the item, then the unit already in stock', () => {
    expect(suggestStockUnit({ name: 'TYRE GLUE', unit: 'EA' })).toMatchObject({ unit: 'PCS', basis: 'recorded' })
    expect(suggestStockUnit({ name: 'TYRE GLUE', learnedUnit: 'BOX' })).toMatchObject({ unit: 'BOX', basis: 'learned' })
  })
  it('counts tyres and rims per piece', () => {
    expect(suggestStockUnit({ name: '315/80 R22.5 TRIANGLE' })).toMatchObject({ unit: 'PCS', basis: 'rule', reason: 'Tyres are counted one by one.' })
    expect(suggestStockUnit({ name: 'RIM 22.5 X 9.00' })).toMatchObject({ unit: 'PCS' })
  })
  it('reads kits, pairs and boxes from the description', () => {
    expect(suggestStockUnit({ name: 'TIRE REPAIR KIT 818' }).unit).toBe('SET')
    expect(suggestStockUnit({ name: 'TYRE VALVE CAPS PAIR' }).unit).toBe('PAIR')
    expect(suggestStockUnit({ name: 'TYRE PATCH BOX OF 10' }).unit).toBe('BOX')
  })
  it('counts glue and cement per tin and says the pack size', () => {
    const g = suggestStockUnit({ name: 'TIP TOP TYRE CEMENT 260 ML' })
    expect(g).toMatchObject({ unit: 'PCS', pack: '260 ML' })
    expect(g.reason).toContain('260 ML')
    expect(suggestStockUnit({ name: 'TYRE GLUE' }).reason).toMatch(/check it/i)
    expect(suggestStockUnit({ name: 'TYRE PASTE' }).unit).toBe('KG')
  })
  it('reads pack sizes in common spellings', () => {
    expect(packSizeFrom('TIP TOP BLUE TYRE COLD PATCH GLUE 650gm')).toBe('650 G')
    expect(packSizeFrom('TYRE SOAP 5 LTR')).toBe('5 L')
    expect(packSizeFrom('TYRE PATCH # 3')).toBe('')
  })
})

describe('stock entry rows carry the unit and why', () => {
  it('a catalogue item with no unit gets a suggested unit and reason', () => {
    const row = stockDraft({ key: 'k', source: 'material', name: 'TIP TOP TYRE CEMENT 260 ML', kind: 'accessory', unit: null })
    expect(row).toMatchObject({ unit: 'PCS', unitBasis: 'rule', pack: '260 ML' })
    expect(row.unitReason).toMatch(/260 ML/)
  })
  it('existing stock uses the unit saved on the stock record', () => {
    const records = [{ id: 's1', site: 'NHC', description: '315/80 R22.5 TRIANGLE', uom: 'PCS', custom_data: {} }]
    const [opt] = existingStockOptions(records, 'NHC', '315')
    expect(opt.unit).toBe('PCS')
    expect(stockDraft(opt)).toMatchObject({ unit: 'PCS', unitBasis: 'recorded' })
  })
})
