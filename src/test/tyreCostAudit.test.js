import { describe, expect, it } from 'vitest'
import {
  lineKind, costBucket, classifyTyre, buildPriceIndex, lookupSameMonth, summarizeFindings,
  validateUploadRows, importReconciliation, costDisplay, COST_PENDING_LABEL, canAutoApprove, specCheck, monthKey,
} from '../lib/tyreCostAudit'

const line = (o = {}) => ({ id: o.id ?? 'L1', country: 'KSA', itemCode: '310100-O', date: '2026-03-10', description: 'TYRE 315/80R22.5 TRIANGLE TR691', value: 1800, qty: 2, ...o })
const tyre = (o = {}) => ({ id: 'T1', country: 'KSA', cost: null, date: '2026-03-12', size: '315/80R22.5', brand: 'TRIANGLE', jobCard: 'GCKR/JC/1', ...o })

describe('line classification keeps tyres, tubes and spares apart', () => {
  it.each([
    ['TYRE 315/80R22.5 20PR TRIANGLE', 'tyre'],
    ['TYRE 1200R20 WITH TUBE & FLAP', 'mixed'],
    ['INNER TUBE 1200-20', 'tube'],
    ['TYRE FLAP 20', 'flap'],
    ['VALVE TR78A', 'valve'],
    ['Repair TIRE 315/80R22.5', 'repair'],
    ['TYRE 315/80 WARRANTY REPLACEMENT', 'warranty'],
    ['TYRE FITTING CHARGES', 'service'],
  ])('%s -> %s', (d, k) => expect(lineKind(d)).toBe(k))

  it('only a tyre line counts as tyre acquisition cost', () => {
    expect(costBucket('tyre')).toBe('tyre')
    for (const k of ['tube', 'flap', 'valve', 'other']) expect(costBucket(k)).toBe('spare')
    expect(costBucket('service')).toBe('service')
  })
})

describe('warranty is never repriced', () => {
  it('warranty wording on its own line excludes it', () => {
    const f = classifyTyre(tyre({ cost: 0 }), { ownLines: [line({ description: 'TYRE 315/80R22.5 WARRANTY', value: 0 })] })
    expect(f.class).toBe('excluded_warranty')
    expect(f.proposed).toBeNull()
  })
  it('a warranty claim record excludes it even with a priced line', () => {
    expect(classifyTyre(tyre(), { ownLines: [line()], warrantyClaim: true }).class).toBe('excluded_warranty')
  })
  it('a zero line WITHOUT warranty evidence is not assumed warranty, and not priced from nothing', () => {
    const f = classifyTyre(tyre({ cost: 0 }), { ownLines: [line({ value: 0 })], priceIndex: new Map() })
    expect(f.class).toBe('zero_line_uncertain')
    expect(f.proposed).toBeNull()
  })
})

describe('exact same-month matching', () => {
  it('own job card line in the same month gives value / qty', () => {
    const f = classifyTyre(tyre(), { ownLines: [line()] })
    expect(f.class).toBe('exact_match')
    expect(f.proposed).toBe(900)
    expect(f.confidence).toBe('high')
    expect(canAutoApprove(f)).toBe(true)
  })
  it('the same tyre code in a different month is NOT accepted', () => {
    const f = classifyTyre(tyre({ date: '2026-04-02' }), { ownLines: [line()] })
    expect(f.class).toBe('month_mismatch')
    expect(f.proposed).toBeNull()
  })
  it('a zero own line borrows only the same item code in the same month', () => {
    const idx = buildPriceIndex([
      line({ id: 'A', itemCode: '310100-O', date: '2026-03-01', value: 950, qty: 1 }),
      line({ id: 'B', itemCode: '310100-O', date: '2026-02-01', value: 700, qty: 1 }),
      line({ id: 'C', itemCode: '310200-O', date: '2026-03-01', value: 400, qty: 1 }),
    ])
    const f = classifyTyre(tyre(), { ownLines: [line({ value: 0 })], priceIndex: idx })
    expect(f.class).toBe('same_month_item_match')
    expect(f.proposed).toBe(950)
    expect(f.source).toMatchObject({ id: 'A', month: '2026-03' })
    expect(canAutoApprove(f)).toBe(false)
  })
  it('different item codes are never the same product just because the size matches', () => {
    const idx = buildPriceIndex([line({ itemCode: '310999-O', value: 500, qty: 1 })])
    expect(lookupSameMonth(idx, 'KSA', '310100-O', '2026-03').status).toBe('none')
    expect(classifyTyre(tyre(), { ownLines: [line({ value: 0 })], priceIndex: idx }).class).toBe('zero_line_uncertain')
  })
  it('a different brand on the source line is a spec mismatch, not a match', () => {
    const f = classifyTyre(tyre({ brand: 'PIRELLI' }), { ownLines: [line()] })
    expect(f.class).toBe('spec_mismatch')
    expect(specCheck({ size: '385/65R22.5' }, 'TYRE 315/80R22.5').ok).toBe(false)
  })
  it('two prices in the same month go to review, never an average', () => {
    const idx = buildPriceIndex([line({ id: 'A', value: 950, qty: 1 }), line({ id: 'B', value: 990, qty: 1 })])
    const f = classifyTyre(tyre(), { ownLines: [line({ value: 0 })], priceIndex: idx })
    expect(f.class).toBe('conflict')
    expect(f.proposed).toBeNull()
  })
  it('a tyre+tube line is never used whole', () => {
    const f = classifyTyre(tyre(), { ownLines: [line({ description: 'TYRE 1200R20 WITH TUBE & FLAP' })] })
    expect(f.class).toBe('mixed_tyre_tube')
  })
  it('a repair line is never a purchase price', () => {
    const f = classifyTyre(tyre(), { ownLines: [line({ description: 'REPAIR TYRE 315/80R22.5', value: 150, qty: 1 })] })
    expect(f.class).toBe('unresolved')
  })
})

describe('already priced tyres', () => {
  it('a comparable-median estimate is flagged as not verified', () => {
    const f = classifyTyre(tyre({ cost: 870 }), { ownLines: [], backfillSource: 'comparable' })
    expect(f.class).toBe('priced_estimate_not_verified')
  })
  it('matching its own line is verified; differing is unreconciled', () => {
    expect(classifyTyre(tyre({ cost: 900 }), { ownLines: [line()] }).class).toBe('priced_verified')
    expect(classifyTyre(tyre({ cost: 1200 }), { ownLines: [line()] }).class).toBe('priced_unreconciled')
  })
  it('the same physical tyre priced twice is a duplicate', () => {
    expect(classifyTyre(tyre({ cost: 900 }), { ownLines: [line()], duplicatePrice: true }).class).toBe('duplicate_price')
  })
  it('negative cost is invalid', () => {
    expect(classifyTyre(tyre({ cost: -5 }), {}).class).toBe('invalid_cost')
  })
})

describe('reporting', () => {
  it('unknown cost shows Cost Pending Verification, never 0', () => {
    expect(costDisplay(null)).toBe(COST_PENDING_LABEL)
    expect(costDisplay(0)).toBe('0')
  })
  it('summary keeps currencies apart and counts classes', () => {
    const s = summarizeFindings([
      { class: 'exact_match', proposed: 900, currency: 'SAR' },
      { class: 'same_month_item_match', proposed: 700, currency: 'AED' },
      { class: 'excluded_warranty' }, { class: 'unresolved' }, { class: 'conflict' },
    ])
    expect(s).toMatchObject({ checked: 5, recoverable: 2, warrantyExcluded: 1, conflicts: 1, proposedByCurrency: { SAR: 900, AED: 700 } })
  })
  it('monthKey is strict', () => {
    expect(monthKey('2026-03-31')).toBe('2026-03')
    expect(monthKey('31/03/2026')).toBeNull()
  })
})

describe('import validation', () => {
  const idx = buildPriceIndex([line({ id: 'A', value: 950, qty: 1 })])
  it('proposes a same-month price for a zero tyre line and flags duplicates per row', () => {
    const out = validateUploadRows([
      { line: 2, description: 'TYRE 315/80R22.5 TRIANGLE', itemCode: '310100-O', date: '2026-03-05', qty: 1, value: 0 },
      { line: 3, description: 'TYRE 315/80R22.5 TRIANGLE', itemCode: '310100-O', date: '2026-03-05', qty: 1, value: 0 },
      { line: 4, description: 'INNER TUBE 1200-20', itemCode: '450001', date: '2026-03-05', qty: 1, value: 40 },
      { line: 5, description: 'TYRE 315/80R22.5', itemCode: '', date: 'bad', qty: 0, value: 10 },
    ], { priceIndex: idx, country: 'KSA' })
    expect(out[0]).toMatchObject({ result: 'price_proposed', proposed: 950, uploaded: 0 })
    expect(out[1]).toMatchObject({ result: 'duplicate' })
    expect(out[2]).toMatchObject({ bucket: 'spare', result: 'valid' })
    expect(out[3].result).toBe('invalid')
    expect(out[3].issues.length).toBeGreaterThanOrEqual(3)
  })
  it('a mixed tyre+tube invoice reconciles to the file total with no double count', () => {
    const r = importReconciliation([
      { description: 'TYRE 1200R20', value: 1000 },
      { description: 'INNER TUBE 1200-20', value: 60 },
      { description: 'TYRE FLAP 20', value: 20 },
      { description: 'TYRE FITTING CHARGES', value: 30 },
    ])
    expect(r.totals).toMatchObject({ tyre: 1000, spare: 80, service: 30 })
    expect(r.fileTotal).toBe(1110)
    expect(r.reconciles).toBe(true)
  })
})
