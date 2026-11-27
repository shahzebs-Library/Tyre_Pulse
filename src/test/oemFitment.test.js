import { describe, it, expect } from 'vitest'
import {
  normalizeMake, modelTokens, modelFamily, buildManualFitment, fitmentSentence, evidenceFieldLabel,
  stockBySite, catalogueStockRows, linkStockRows, summarizeStockRows,
  existingAlternatives, buildAlternativeRequest,
  significantWords, buildCandidateIndex, candidatesForEntry, buildUnmatchedRows, filterUnmatched, summarizeUnmatched, BROAD_LIMIT,
} from '../lib/inventory/oemFitment'

describe('fitment', () => {
  it('derives the model family as the first code token', () => {
    expect(modelFamily('SY412C-8/ST')).toBe('SY412C')
    expect(modelFamily('SY412C-8S (V)/ST2')).toBe('SY412C')
    expect(modelFamily('SYL956H5')).toBe('SYL956H5')
    expect(modelFamily('Transit Mixer')).toBeNull()
    expect(modelFamily(null)).toBeNull()
    expect(modelTokens('SY412C Transit Mixer')).toEqual(['SY412C', 'TRANSIT', 'MIXER'])
    expect(normalizeMake('  sany ')).toBe('SANY')
  })

  const fleet = [
    { id: 1, asset_no: 'TM1', make: 'SANY', model: 'SY412C Transit Mixer', vehicle_type: 'TR-MIXER', country: 'KSA' },
    { id: 2, asset_no: 'TM2', make: 'Sany', model: null, vehicle_type: 'TR-MIXER', country: 'KSA' },
    { id: 3, asset_no: 'TM3', make: 'SANY', model: 'SY412CX', vehicle_type: 'TR-MIXER', country: 'KSA' },
    { id: 4, asset_no: 'WL1', make: 'SANY', model: '', vehicle_type: null, country: 'UAE' },
    { id: 5, asset_no: 'X1', make: 'VOLVO', model: 'SY412C', vehicle_type: 'TRUCK', country: 'KSA' },
  ]

  it('counts make, recorded models and exact model-family matches only', () => {
    const [f] = buildManualFitment({ manuals: [{ id: 'm1', manufacturer: 'SANY', model: 'SY412C-8/ST' }], fleet })
    expect(f.makeAssets).toBe(4)
    expect(f.modelRecorded).toBe(2)
    expect(f.modelMatches).toBe(1) // SY412CX is NOT a match: no prefix matching
    expect(f.matchedAssets.map((a) => a.asset_no)).toEqual(['TM1'])
    expect(f.byType).toEqual({ 'TR-MIXER': 3, 'Not recorded': 1 })
    expect(f.byCountry).toEqual({ KSA: 3, UAE: 1 })
    expect(fitmentSentence(f)).toMatch(/Manual says SANY SY412C-8\/ST\. 4 fleet assets carry the make SANY; 2 of them record a model; 1 record the model SY412C\./)
  })

  it('does not guess when the manual has no model or no make', () => {
    const [noModel, noMake] = buildManualFitment({ manuals: [{ id: 'a', manufacturer: 'SANY', model: null }, { id: 'b', manufacturer: '', model: 'X1' }], fleet })
    expect(noModel.basis).toBe('no_model')
    expect(noModel.modelMatches).toBe(0)
    expect(fitmentSentence(noModel)).toMatch(/names no model code/)
    expect(noMake.basis).toBe('no_make')
    expect(noMake.makeAssets).toBe(0)
  })
})

describe('stock', () => {
  const balances = [
    { item_id: 'i1', site: 'NHC', country: 'KSA', qty_on_hand: 2 },
    { item_id: 'i1', site: 'NHC', country: 'KSA', qty_on_hand: 3 },
    { item_id: 'i1', site: 'JED', country: 'KSA', qty_on_hand: 0 },
    { item_id: 'i2', site: 'AMAALA', country: 'KSA', qty_on_hand: 4 },
  ]
  it('sums per site and drops zero balances', () => {
    expect(stockBySite(balances).get('i1')).toEqual([{ site: 'NHC', country: 'KSA', qty: 5, uom: null }])
  })
  it('reaches catalogue stock only through the catalogue to ERP link', () => {
    const rows = catalogueStockRows({
      canonicals: [{ id: 'c1', company_sku: '100-O' }, { id: 'c2', company_sku: '200-O' }, { id: 'c3', company_sku: '300-O' }],
      oemAliases: [{ canonical_id: 'c1', alias_type: 'oem', value: 'A1' }, { canonical_id: 'c2', alias_type: 'oem', value: 'B1' }],
      links: [{ canonical_id: 'c1', item_id: 'i1' }],
      balances,
    })
    expect(rows.map((r) => r.canonical.id)).toEqual(['c1', 'c2']) // c3 has no OEM number
    expect(rows[0].total).toBe(5)
    expect(rows[1].linked).toBe(false)
    expect(summarizeStockRows(rows)).toEqual({ items: 2, linked: 1, inStock: 1, sites: 1 })
  })
  it('shows stock for proposed and approved links, approved first', () => {
    const rows = linkStockRows({
      references: [
        { id: 'r1', status: 'proposed', item_id: 'i2', oem_part_no: 'A' },
        { id: 'r2', status: 'approved', item_id: 'i1', oem_part_no: 'B' },
        { id: 'r3', status: 'rejected', item_id: 'i1', oem_part_no: 'C' },
      ],
      erpItems: [{ id: 'i1', item_code: '100-O' }],
      balances,
    })
    expect(rows.map((r) => r.reference.id)).toEqual(['r2', 'r1'])
    expect(rows[0].total).toBe(5)
    expect(rows[1].item).toBeNull()
  })
})

describe('alternatives', () => {
  const target = { id: 'c1', company_sku: '100-O' }
  it('builds an add_reference correction on B', () => {
    const p = buildAlternativeRequest({ target, replacement: { value: ' 60211864 ', canonicalId: 'c9', sku: '900-O' }, relation: 'alternative', reason: 'Manual page 12' })
    expect(p).toMatchObject({ target_kind: 'canonical', target_id: 'c1', action: 'add_reference', new_value: { alias_type: 'alternative', value: '60211864' }, reason: 'Manual page 12' })
    expect(p.evidence[0]).toMatchObject({ type: 'alternative_proposal', replacement_canonical_id: 'c9' })
  })
  it('refuses incomplete or self-referencing requests', () => {
    expect(() => buildAlternativeRequest({ replacement: { value: 'X' }, reason: 'r' })).toThrow(/replaced/)
    expect(() => buildAlternativeRequest({ target, replacement: { value: '' }, reason: 'r' })).toThrow(/part number/)
    expect(() => buildAlternativeRequest({ target, replacement: { value: 'X' }, reason: ' ' })).toThrow(/reason/)
    expect(() => buildAlternativeRequest({ target, replacement: { value: '100 O' }, reason: 'r' })).toThrow(/itself/)
    expect(() => buildAlternativeRequest({ target, replacement: { value: 'X', canonicalId: 'c1' }, reason: 'r' })).toThrow(/itself/)
    expect(() => buildAlternativeRequest({ target, replacement: { value: 'X' }, relation: 'fuzzy', reason: 'r' })).toThrow(/Relation/)
  })
  it('lists only alternative and superseded references', () => {
    const m = existingAlternatives([
      { canonical_id: 'c1', alias_type: 'oem', value: 'A' },
      { canonical_id: 'c1', alias_type: 'alternative', value: 'B' },
      { canonical_id: 'c2', alias_type: 'superseded', value: 'C' },
    ])
    expect([...m.keys()]).toEqual(['c1', 'c2'])
    expect(m.get('c1').map((a) => a.value)).toEqual(['B'])
  })
})

describe('unmatched manual rows', () => {
  const canonicals = [
    { id: 'c1', company_sku: '100-O', description: 'FILTER ELEMENT HYDRAULIC', status: 'active' },
    { id: 'c2', company_sku: '200-O', description: 'FILTER ELEMENT', status: 'active' },
    { id: 'c3', company_sku: '300-O', description: 'TENSION SPRING 12MM', status: 'active' },
    { id: 'c4', company_sku: '400-O', description: 'BRAKE PAD', status: 'active', original_description: 'BRAKE PAD OEM# 60211864' },
    { id: 'c5', company_sku: '500-O', description: 'FILTER ELEMENTS', status: 'active' },
  ]
  const aliases = [{ canonical_id: 'c3', alias_type: 'erp_legacy', value: 'A82030-1030051' }]
  const index = buildCandidateIndex({ canonicals, aliases, variants: [] })

  it('keeps significant whole words only', () => {
    expect(significantWords('Left Side Connecting Plate of 12 assy')).toEqual(['LEFT', 'SIDE', 'CONNECTING', 'PLATE'])
  })
  it('offers an equal part number from any reference type or a description token', () => {
    const r = candidatesForEntry({ part_no: 'A820301030051', description: 'Tension Spring' }, index)
    expect(r.rule).toBe('part_number')
    expect(r.candidates[0].canonical.id).toBe('c3')
    expect(candidatesForEntry({ part_no: '60211864', description: 'x' }, index).candidates[0].canonical.id).toBe('c4')
  })
  it('requires every word, whole-word only, most specific first', () => {
    const r = candidatesForEntry({ part_no: 'Z9999999', description: 'Filter element' }, index)
    expect(r.rule).toBe('words')
    expect(r.candidates.map((c) => c.canonical.id)).toEqual(['c2', 'c1']) // c5 "ELEMENTS" is not ELEMENT
    expect(candidatesForEntry({ part_no: 'Z9999999', description: 'Filter Housing' }, index).rule).toBe('none')
  })
  it('marks a too-general description as broad instead of listing hundreds', () => {
    const many = Array.from({ length: BROAD_LIMIT + 1 }, (_, i) => ({ id: `n${i}`, company_sku: `N${i}`, description: `NUT M${i}`, status: 'active' }))
    const r = candidatesForEntry({ part_no: 'Q1234567', description: 'Nut' }, buildCandidateIndex({ canonicals: many }))
    expect(r.rule).toBe('broad')
    expect(r.candidates).toEqual([])
    expect(r.broadCount).toBe(BROAD_LIMIT + 1)
  })
  it('skips rows that already have a proposal and filters / summarises the rest', () => {
    const entries = [
      { id: 'e1', country: 'KSA', part_no: 'A820301030051', description: 'Tension Spring' },
      { id: 'e2', country: 'KSA', part_no: 'Z9999999', description: 'Filter element' },
      { id: 'e3', country: 'KSA', part_no: '12345678', description: 'Gizmo' },
    ]
    const rows = buildUnmatchedRows({ entries, matchedKeys: new Set(['ksa|12345678']), index })
    expect(rows.map((r) => r.entry.id)).toEqual(['e1', 'e2'])
    expect(summarizeUnmatched(rows)).toEqual({ total: 2, part_number: 1, words: 1, broad: 0, none: 0 })
    expect(filterUnmatched(rows, { rule: 'words' }).map((r) => r.entry.id)).toEqual(['e2'])
    expect(filterUnmatched(rows, { search: 'spring' }).map((r) => r.entry.id)).toEqual(['e1'])
    expect(filterUnmatched(rows, { search: 'A8203' }).map((r) => r.entry.id)).toEqual(['e1'])
  })
})

describe('fitment text translation', () => {
  const fakeT = (k, v) => (v ? `${k}|${JSON.stringify(v)}` : k)
  const [f] = buildManualFitment({
    manuals: [{ id: 'm1', manufacturer: 'SANY', model: 'SY412C-8/ST' }],
    fleet: [{ make: 'Sany', model: 'SY412C' }, { make: 'SANY', model: '' }],
  })
  it('keeps the English sentence without t', () => {
    expect(fitmentSentence(f)).toBe('Manual says SANY SY412C-8/ST. 2 fleet assets carry the make SANY; 1 of them record a model; 1 record the model SY412C.')
  })
  it('uses the given t', () => {
    expect(fitmentSentence({ basis: 'no_make' }, fakeT)).toBe('wmsmsgparts.fitment.noMake')
    expect(fitmentSentence(f, fakeT)).toMatch(/^wmsmsgparts\.fitment\.full\|/)
  })
  it('labels evidence fields', () => {
    expect(evidenceFieldLabel('reference_oem')).toBe('reference oem')
    expect(evidenceFieldLabel('reference_oem', fakeT)).toBe('wmsmsgparts.evidence.reference_oem')
    expect(evidenceFieldLabel('reference_mystery', fakeT)).toBe('reference mystery')
  })
})
