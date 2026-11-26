import { describe, expect, it } from 'vitest'
import {
  parseStoreLedger, postBlockers, isStoreLedger, resolveLocation, suggestMaterialClass, buildNeighbours, shouldRename,
  buildLedgerPlan, buildPostPayload, toNumber, toIsoDate, sha256Hex,
} from '../lib/inventory/erpStoreLedger'

// Rows as the real Ramco export arrives (Qiddiya upper plateau file, plus edge rows).
const SHEET = [
  ['BU name    :', 'Green Concrete CJSC - BU', 'Stores Ledger', '', '', '', '', '', '', ''],
  ['OU name    :', 'Green Concrete ', '', '', '', '', '', 'Report ID  :', 'CSOL-IMS-013-1', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['Currency    :', 'SAR', '', '', '', '', '', '', '', ''],
  ['', '', 'Date from :', '31/12/2015', '', '26/11/2026', '', '', '', ''],
  ['Item code ', 'Item description', '', 'Warehouse', 'Zone', 'Bin', 'CB Qty', 'Rate', '', 'Value'],
  ['221855-O', 'TIRE 385-65R22.5', '', 'QID-UP-ST', 'null', 'null', '1.00', '990.00', '', '990.00'],
  ['223758-o ', 'TIRE 315/80 R22.5', '', 'QID-UP-ST', 'null', 'null', '1,003.00', '723.55', '', '2170.66'],
  ['313582-O', 'COTTON GLOVES', '', 'QID-UP-ST', 'null', 'null', '-2', '0', '', '0'],
  ['313582-O', 'COTTON GLOVES', '', 'QID-UP-ST', 'null', 'null', '5', '', '', ''],
  ['BAD-1', 'BROKEN ROW', '', 'QID-UP-ST', 'null', 'null', 'abc', '', '', ''],
  ['TOTAL', '', '', '', '', '', '1007.000', '  ', '', '3160.66'],
  ['<End Of Report>', '', '', '', '', '', '', '', '', ''],
  ['999999-O', 'AFTER END', '', 'QID-UP-ST', 'null', 'null', '1', '', '', ''],
]

describe('parseStoreLedger', () => {
  const p = parseStoreLedger(SHEET, { filename: 'Qiddiya_upper.xls' })
  it('reads the header block', () => {
    expect(isStoreLedger(SHEET)).toBe(true)
    expect(p.ok).toBe(true)
    expect(p.meta).toMatchObject({ reportId: 'CSOL-IMS-013-1', currency: 'SAR', from: '2015-12-31', to: '2026-11-26', filename: 'Qiddiya_upper.xls', warehouses: ['QID-UP-ST'] })
  })
  it('reads lines, skips totals and stops at the end marker', () => {
    expect(p.lines.map((l) => l.code)).toEqual(['221855-O', '223758-O', '313582-O'])
    expect(p.lines.find((l) => l.code === '223758-O').qty).toBe(1003)
    expect(p.lines.find((l) => l.code === '221855-O')).toMatchObject({ zone: null, bin: null, rate: 990, value: 990 })
  })
  it('adds repeated codes together and keeps a zero rate unvalued, never 0', () => {
    const g = p.lines.find((l) => l.code === '313582-O')
    expect(g.qty).toBe(3)
    expect(g.rate).toBeNull()
    expect(g.rows).toHaveLength(2)
    expect(p.warnings).toContain('repeated_codes')
  })
  it('rejects a row whose quantity is not a number', () => {
    expect(p.rejected).toEqual([{ row: 11, code: 'BAD-1', reason: 'bad_qty' }])
  })
  it('refuses a sheet that is not a stores ledger', () => {
    expect(parseStoreLedger([['Asset', 'Site'], ['TM1', 'NHC']]).ok).toBe(false)
    expect(isStoreLedger(null)).toBe(false)
  })
  it('checks the file is whole and allows posting only when nothing is wrong', () => {
    expect(p.meta.complete).toBe(true)
    expect(p.warnings).not.toContain('total_mismatch')
    // The BAD-1 row could not be read, so this file must not be posted.
    expect(postBlockers(p)).toEqual([expect.stringMatching(/1 rows could not be read/)])
    const clean = parseStoreLedger(SHEET.filter((r) => r[0] !== 'BAD-1'))
    expect(postBlockers(clean)).toEqual([])
  })
  it('blocks a cut-off file, a wrong total, two stores and a row with no store', () => {
    const cut = parseStoreLedger(SHEET.slice(0, 8))
    expect(postBlockers(cut).join(' ')).toMatch(/end of report/)
    const wrongTotal = parseStoreLedger(SHEET.filter((r) => r[0] !== 'BAD-1').map((r) => (r[0] === 'TOTAL' ? ['TOTAL', '', '', '', '', '', '9', '', '', ''] : r)))
    expect(postBlockers(wrongTotal).join(' ')).toMatch(/different total/)
    const two = parseStoreLedger(SHEET.slice(0, 7).concat([['X-1', 'A', '', 'JED-ST', 'null', 'null', '1', '', '', ''], ['<End Of Report>']]))
    expect(postBlockers(two).join(' ')).toMatch(/more than one store/)
    const noWh = parseStoreLedger(SHEET.slice(0, 7).concat([['X-2', 'A', '', '', 'null', 'null', '1', '', '', ''], ['<End Of Report>']]))
    expect(noWh.rejected).toEqual([{ row: 8, code: 'X-2', reason: 'no_warehouse' }])
    expect(postBlockers(parseStoreLedger([['x']]))[0]).toMatch(/not an ERP Stores Ledger/)
  })
  it('marks a repeated code that had a negative line', () => {
    expect(p.lines.find((l) => l.code === '313582-O').hasNegative).toBe(true)
  })
  it('flags negative quantities', () => {
    const neg = parseStoreLedger(SHEET.slice(0, 6).concat([['X-1', 'A', '', 'JED-ST', 'null', 'null', '-2', '5', '', '-10']]))
    expect(neg.warnings).toContain('negative_qty')
  })
})

describe('helpers', () => {
  it('toNumber reads ERP numbers only', () => {
    expect(toNumber('1,234.50')).toBe(1234.5)
    expect(toNumber(' -3 ')).toBe(-3)
    expect(toNumber('')).toBeNull()
    expect(toNumber('1.2.3')).toBeNull()
    expect(toNumber('.5')).toBe(0.5)
    expect(toNumber('5.')).toBe(5)
    expect(toNumber('(3)')).toBe(-3)
  })
  it('toIsoDate reads day first', () => {
    expect(toIsoDate('07/09/2026')).toBe('2026-09-07')
    expect(toIsoDate('32/01/2026')).toBeNull()
  })
  it('shouldRename never replaces a fuller name with a cut-off one', () => {
    expect(shouldRename('TIRE 315/80 R22.5 TECHKING', 'TIRE 315/80 R22.5')).toBe(false)
    expect(shouldRename('TIRE 315/80', 'TIRE 315/80 R22.5 TECHKING')).toBe(true)
    expect(shouldRename('GLOVES', 'COTTON GLOVES')).toBe(true)
    expect(shouldRename('Cotton gloves', 'COTTON GLOVES ')).toBe(false)
    expect(shouldRename(null, 'NEW NAME')).toBe(true)
    expect(shouldRename('X', '')).toBe(false)
  })
  it('sha256Hex fingerprints bytes', async () => {
    const h = await sha256Hex(new TextEncoder().encode('abc').buffer)
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('resolveLocation', () => {
  const locs = [{ id: 'a', code: 'DIRIYAH-ST2', site: 'DIRIYAH' }, { id: 'b', code: 'REDSEA-ST', site: 'RED SEA' }, { id: 'c', code: 'OLD-ST', active: false }]
  it('matches the code exactly or through a checked alias', () => {
    expect(resolveLocation('redsea-st', locs)).toMatchObject({ id: 'b', via: 'exact' })
    expect(resolveLocation('DIRYAH-ST2', locs)).toMatchObject({ id: 'a', via: 'alias' })
  })
  it('never guesses an unknown or inactive store', () => {
    expect(resolveLocation('REDSEA', locs)).toBeNull()
    expect(resolveLocation('OLD-ST', locs)).toBeNull()
    expect(resolveLocation('', locs)).toBeNull()
  })
})

describe('suggestMaterialClass', () => {
  const nb = buildNeighbours([
    ...Array.from({ length: 9 }, (_, i) => ({ item_code: `224${i}00-O`, category: 'spare_part', reviewed: true })),
    { item_code: '224900-O', category: 'lubricant', reviewed: true },
    { item_code: '224999-O', category: 'tyre', reviewed: false },
  ])
  it('uses the ERP code range first', () => {
    expect(suggestMaterialClass('310123-O', 'ANYTHING')).toMatchObject({ category: 'tyre' })
    expect(suggestMaterialClass('150321-O', 'ELEMENT')).toMatchObject({ category: 'filter' })
  })
  it('reads the description', () => {
    expect(suggestMaterialClass('223847-O', 'INLINE FUELFILTER BF 7725/14776901')).toMatchObject({ category: 'filter', subcategory: 'Fuel filter' })
    expect(suggestMaterialClass('223949-O', 'FUEL FILTER HOUSING COVER -9604770002').category).not.toBe('filter')
    expect(suggestMaterialClass('316625-O', 'HSS DRILL BIT 12MM')).toMatchObject({ category: 'consumable' })
    expect(suggestMaterialClass('450099-O', 'GREASE EP2 18KG')).toMatchObject({ category: 'lubricant', subcategory: 'Grease' })
  })
  it('falls back to reviewed neighbours, then to a spare part', () => {
    const s = suggestMaterialClass('224447-O', 'BRAKE FRICTION PAD-DZ9160340068/60147400-SANY TM', { neighbours: nb })
    expect(s).toMatchObject({ category: 'spare_part', subcategory: 'Brake system', reason: 'neighbours:224' })
    expect(suggestMaterialClass('777001-O', 'CLUTCH FORK 60164853').reason).toBe('default')
    expect(suggestMaterialClass('777001-O', 'CLUTCH FORK 60164853').subcategory).toBe('Transmission')
  })
})

describe('buildLedgerPlan', () => {
  const master = [
    { id: 'm1', item_code: '221855-O', item_name: 'TIRE 385-65R22.5', category: 'spare_part', reviewed: true },
    { id: 'm2', item_code: '223758-O', item_name: 'HOSE 315/80', category: 'unclassified', reviewed: false },
    { id: 'm3', item_code: 'GONE-1', item_name: 'OLD PART', category: 'spare_part', reviewed: true },
    { id: 'm4', item_code: 'RES-1', item_name: 'RESERVED', category: 'spare_part', reviewed: true },
    { id: 'm5', item_code: 'TYRE-1', item_name: 'TIRE 315/80 R22.5', category: 'tyre', reviewed: true, serial_tracked: true },
  ]
  const stock = [
    { id: 's1', item_id: 'm1', qty_on_hand: 1, qty_reserved: 0, item_code: '221855-O' },
    { id: 's2', item_id: 'm2', qty_on_hand: 900, qty_reserved: 0, item_code: '223758-O' },
    { id: 's3', item_id: 'm3', qty_on_hand: 4, qty_reserved: 0, item_code: 'GONE-1', description: 'OLD PART' },
    { id: 's4', item_id: 'm4', qty_on_hand: 10, qty_reserved: 6, item_code: 'RES-1' },
  ]
  const lines = [
    { code: '221855-O', description: 'TIRE 385-65R22.5', qty: 1, rate: 990 },
    { code: '223758-O', description: 'HOSE 315/80 EXTRA', qty: 1003, rate: 723.55 },
    { code: 'NEW-1', description: 'BRAKE PAD SANY', qty: 2, rate: null },
    { code: 'NEG-1', description: 'GLOVES', qty: -2, rate: null },
    { code: 'RES-1', description: 'RESERVED', qty: 5, rate: null },
    { code: 'TYRE-1', description: 'TIRE 315/80 R22.5', qty: 4, rate: 700 },
    { code: 'MIX-1', description: 'MIXED LINES', qty: 3, rate: null, hasNegative: true },
  ]
  const plan = buildLedgerPlan({ lines, master, stock })
  it('lists quantity changes against live stock', () => {
    expect(plan.unchanged.map((r) => r.code)).toEqual(['221855-O'])
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: '223758-O', stock_id: 's2', on_hand: 900, delta: 103 }),
      expect.objectContaining({ code: 'NEW-1', item_id: null, stock_id: null, on_hand: null, delta: 2, is_new_item: true }),
    ]))
    expect(plan.totals.increase).toBe(105)
  })
  it('holds back negative quantities and anything below reserved', () => {
    expect(plan.held.map((h) => [h.code, h.reason])).toEqual([['NEG-1', 'negative_qty'], ['RES-1', 'below_reserved'], ['TYRE-1', 'serial_tracked'], ['MIX-1', 'negative_qty']])
  })
  it('finds new codes, names and unclassified items', () => {
    expect(plan.newItems.map((n) => n.code)).toEqual(['NEW-1', 'NEG-1', 'MIX-1'])
    expect(plan.renames).toEqual([{ code: '223758-O', item_id: 'm2', from: 'HOSE 315/80', to: 'HOSE 315/80 EXTRA' }])
    expect(plan.reclassify.map((r) => [r.code, r.category])).toEqual([['223758-O', 'spare_part']])
  })
  it('lists stock the file leaves out', () => {
    expect(plan.missing.map((m) => [m.code, m.keep])).toEqual([['GONE-1', null]])
  })
  it('holds back a new code that is a tyre, and a tyre category item', () => {
    const p2 = buildLedgerPlan({ lines: [{ code: '310999-O', description: 'TIRE 12.00R24', qty: 4 }], master: [], stock: [] })
    expect(p2.held).toEqual([expect.objectContaining({ code: '310999-O', reason: 'serial_tracked' })])
    const p3 = buildLedgerPlan({ lines: [{ code: 'T-2', description: 'X', qty: 1 }], master: [{ id: 't', item_code: 'T-2', category: 'tyre', reviewed: true }], stock: [] })
    expect(p3.held[0].reason).toBe('serial_tracked')
  })
  it('sends only what the owner kept, and the server recomputes quantities', () => {
    const payload = buildPostPayload({
      meta: { filename: 'f.xls', reportId: 'CSOL-IMS-013-1', currency: 'SAR', from: '2015-12-31', to: '2026-11-26' },
      location: { id: 'loc' }, country: 'KSA', lines, plan, sha256: 'a'.repeat(64), idempotencyKey: 'k',
      choices: { renames: new Set(), zeroMissing: true },
    })
    expect(payload).toMatchObject({ location_id: 'loc', country: 'KSA', zero_missing: true, currency: 'SAR', period_to: '2026-11-26' })
    expect(payload.renames).toEqual([])
    expect(payload.new_items).toHaveLength(3)
    expect(payload.lines[0]).toEqual({ code: '221855-O', description: 'TIRE 385-65R22.5', warehouse: undefined, qty: 1, rate: 990, value: undefined, has_negative: false })
    expect(payload.lines.find((l) => l.code === 'MIX-1').has_negative).toBe(true)
    expect(payload.lines.some((l) => 'delta' in l)).toBe(false)
  })
})

describe('third review round', () => {
  const head = SHEET.slice(0, 6)
  const line = (code, desc, qty) => [code, desc, '', 'QID-UP-ST', 'null', 'null', String(qty), '10', '', '10']
  const tail = [['TOTAL', '', '', '', '', '', '3', '', '', ''], ['<End Of Report>']]

  it('skips a repeated page header and a sub total row instead of blocking the file', () => {
    const p = parseStoreLedger([...head, line('A-1', 'BOLT', 1), SHEET[5], ['Sub Total', '', '', '', '', '', '1', '', '', ''], line('A-2', 'NUT', 2), ...tail])
    expect(p.rejected).toEqual([])
    expect(p.lines.map((l) => l.code)).toEqual(['A-1', 'A-2'])
    expect(postBlockers(p)).toEqual([])
  })

  it('follows the owner category: a code changed to tyre is held, changed away from tyre is posted', () => {
    const lines = [{ code: 'N-1', description: 'TIRE 315/80 R22.5', qty: 4, rate: null }, { code: 'N-2', description: 'BRAKE PAD', qty: 2, rate: null }]
    const auto = buildLedgerPlan({ lines })
    expect(auto.held.map((h) => h.code)).toEqual(['N-1'])
    const chosen = buildLedgerPlan({ lines, categories: { 'N-1': 'spare_part', 'N-2': 'tyre' } })
    expect(chosen.held.map((h) => h.code)).toEqual(['N-2'])
    expect(chosen.changes.map((c) => c.code)).toEqual(['N-1'])
  })

  it('holds a new code with no name, as the server cannot add it', () => {
    const plan = buildLedgerPlan({ lines: [{ code: 'N-3', description: null, qty: 1, rate: null }] })
    expect(plan.newItems).toEqual([])
    expect(plan.held).toEqual([expect.objectContaining({ code: 'N-3', reason: 'no_item' })])
  })

  it('matches only a warehouse location', () => {
    expect(resolveLocation('QID-UP-ST', [{ id: 'b', code: 'QID-UP-ST', location_type: 'bin', active: true }])).toBeNull()
    expect(resolveLocation('QID-UP-ST', [{ id: 'w', code: 'QID-UP-ST', location_type: 'warehouse', active: true }])).toMatchObject({ id: 'w' })
  })

  it('blocks a file with more than 5000 item codes', () => {
    const many = Array.from({ length: 5001 }, (_, i) => line(`C-${i}`, 'PART', 1))
    const p = parseStoreLedger([...head, ...many, ['TOTAL', '', '', '', '', '', '5001', '', '', ''], ['<End Of Report>']])
    expect(postBlockers(p)).toEqual([expect.stringMatching(/at most 5000/)])
  })
})

describe('ledger refusal text', () => {
  it('shows the upload refusals and still hides duplicate-key internals', async () => {
    const { inventoryRefusalText } = await import('../lib/api/inventory')
    expect(inventoryRefusalText({ code: '23505', message: 'Another upload for QID-UP-ST is not finished. Finish or cancel it first.' })).toMatch(/not finished/)
    expect(inventoryRefusalText({ code: 'P0002', message: 'Upload not found.' })).toBe('Upload not found.')
    expect(inventoryRefusalText({ code: '23505', message: 'duplicate key value violates unique constraint "x"' })).toBeNull()
  })
})
