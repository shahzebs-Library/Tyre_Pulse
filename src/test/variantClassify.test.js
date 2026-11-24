import { describe, it, expect } from 'vitest'
import {
  brandKey, buildBrandCatalogue, detectBrand, detectPartType, descriptionOf, proposeForItem,
  buildProposals, isBulkEligible, writePlan, filterProposals, RULES, LOCAL_STORABLE,
} from '../lib/inventory/variantClassify'

const ALIASES = [
  { alias: 'bridgestone', canonical: 'Bridgestone' }, { alias: 'bs', canonical: 'Bridgestone' },
  { alias: 'advance', canonical: 'Advance' }, { alias: 'double star', canonical: 'Doublestar' },
]
const cat = buildBrandCatalogue({ aliases: ALIASES, recordedBrands: ['SANY', 'SANY', 'Tata', 'Mercedes-Benz', 'Sany'] })

describe('part type: owner rules', () => {
  it.each([
    'RADAITOR ORIGINAL OEM#:9425001003',
    'GASKET KIT, OIL PAN ( ORIGINAL) 0551351',
    'CLUCTH FORK LEVER (ORG.)SC',
    'FUEL RETURN VALVE ORG (SC)',
    'FAN SHROUD [ORIGINAL] OEM#:9425050955/ 012070',
    'POLY V-BELT 1888468 1800525 8PK-2135 (8PK-2130) ORG',
  ])('"%s" is genuine', (d) => {
    const p = detectPartType(d)
    expect(p.value).toBe('genuine')
    expect(p.rule).toBe(RULES.original)
    expect(p.evidence.toUpperCase()).toMatch(/ORIGINAL|ORG/)
  })

  it('OEM#: alone is a part-number label, not a genuine claim', () => {
    expect(detectPartType('BRAKE BOOSTER ACT OEM#:4231074110')).toBeNull()
    expect(detectPartType('FILTER AS-LU- OEM#:1R-1808')).toBeNull()
  })

  it('the -O company SKU suffix is never evidence', () => {
    const item = { id: 'c1', company_sku: '010120-O', description: 'GASKET, HEAD' }
    expect(proposeForItem(item, { catalogue: cat })).toBeNull()
    expect(detectPartType('010120-O')).toBeNull()
  })

  it('does not read ORG inside another word', () => {
    expect(detectPartType('ORGANIC CLEANER')).toBeNull()
    expect(detectPartType('A/4 PHOTOCOPY PAPER (BOX)')).toBeNull()
  })

  it('LOCAL / CHINA / TAIWAN count only when written', () => {
    expect(detectPartType('BRAKE PAD LOCAL')).toMatchObject({ value: 'local', rule: RULES.local })
    expect(detectPartType('BRAKE PAD CHINA')).toMatchObject({ value: 'aftermarket', country: 'China' })
    expect(detectPartType('BEARING (TAIWAN)')).toMatchObject({ value: 'aftermarket', country: 'Taiwan' })
    expect(detectPartType('BRAKE PAD')).toBeNull()
  })

  it('two contradicting claims are a conflict, not a guess', () => {
    const p = detectPartType('FILTER ORIGINAL CHINA')
    expect(p.value).toBeNull()
    expect(p.rule).toBe(RULES.conflict)
  })
})

describe('brand: existing catalogues only', () => {
  it('collapses spelling variants to one key', () => {
    expect(brandKey('Doublecoin')).toBe(brandKey('Double coin'))
    expect(brandKey('DOUBLE-COIN')).toBe('doublecoin')
  })

  it('finds a tyre brand next to a tyre size, in either spelling', () => {
    const a = detectBrand('TIRE 315/80 R22.5 - RR99 DOUBLECOIN', cat)
    const b = detectBrand('385/65R22.5 Double coin', cat)
    expect(a.value).toBe(b.value)
    expect(a.value).toBe('Double Coin')
    expect(a.evidence.toUpperCase()).toBe('DOUBLECOIN')
  })

  it('ignores tyre-brand words in a non-tyre description', () => {
    expect(detectBrand('ADVANCE CLUTCH PLATE 12345', cat)).toBeNull()
    expect(detectBrand('FORMULA SEAL KIT', cat)).toBeNull()
  })

  it('uses brand_aliases canonical spelling and skips 2-letter aliases', () => {
    expect(detectBrand('TIRE 12.00R24 BRIDGESTONE', cat).value).toBe('Bridgestone')
    expect(detectBrand('TIRE 12.00R24 BS', cat)).toBeNull()
  })

  it('uses brands the company already records, most common spelling', () => {
    expect(detectBrand('FRONT MIRROR 12273572 SANY', cat).value).toBe('SANY')
    expect(detectBrand('MASTER CYL MERCEDES BENZ 123', cat).value).toBe('Mercedes-Benz')
  })

  it('reports two brands as a conflict', () => {
    const c = buildBrandCatalogue({ aliases: ALIASES })
    const r = detectBrand('TIRE 23.5 R 25 TB516 DIAMOND BACK (TRIANGLE)', c)
    expect(r.rule).toBe(RULES.conflict)
    expect(r.value).toBeNull()
  })

  it('does not double count a word inside a longer brand', () => {
    const c = buildBrandCatalogue({ aliases: ALIASES, tyreBrands: ['double star', 'star'] })
    expect(detectBrand('TIRE 315/80R22.5 DOUBLE STAR', c).value).toBe('Doublestar')
  })
})

describe('proposals and write plans', () => {
  const genuineItem = { id: 'c1', company_sku: '012070-O', description: 'FAN SHROUD', specs: { original_description: 'RADAITOR ORIGINAL OEM#:9425001003' } }

  it('reads the raw ERP description first', () => {
    expect(descriptionOf(genuineItem)).toBe('RADAITOR ORIGINAL OEM#:9425001003')
  })

  it('corrects an existing unknown variant through a correction request', () => {
    const row = proposeForItem(genuineItem, { variant: { id: 'v1', part_classification: 'unknown', status: 'proposed' }, catalogue: cat })
    expect(row.partType).toMatchObject({ value: 'genuine', writer: 'correction_variant', confidence: 'high' })
    expect(isBulkEligible(row)).toBe(true)
    const plan = writePlan(row, 'partType')
    expect(plan.writer).toBe('correction')
    expect(plan.payload).toMatchObject({ target_kind: 'variant', target_id: 'v1', action: 'field_update', topic: 'classification', new_value: { part_classification: 'genuine' } })
    expect(plan.payload.evidence[0].text).toContain('RADAITOR ORIGINAL')
  })

  it('proposes a new variant when the item has none', () => {
    const row = proposeForItem(genuineItem, { catalogue: cat })
    const plan = writePlan(row, 'partType')
    expect(plan.writer).toBe('propose_variant')
    expect(plan.payload).toMatchObject({ canonical_id: 'c1', part_classification: 'genuine' })
    expect(plan.payload.evidence.length).toBe(1)
  })

  it('skips an item already classified or branded', () => {
    expect(proposeForItem(genuineItem, { variant: { id: 'v1', part_classification: 'genuine' }, catalogue: cat })).toBeNull()
    expect(proposeForItem({ id: 'c2', brand: 'Sailun', description: 'TIRE 315/80 R22.5 - SAILUN' }, { catalogue: cat })).toBeNull()
  })

  it('blocks local (not storable) and pending items', () => {
    expect(LOCAL_STORABLE).toBe(false)
    const local = proposeForItem({ id: 'c3', description: 'BRAKE PAD LOCAL' }, { catalogue: cat })
    expect(local.partType.blocked).toBe('local_not_storable')
    expect(writePlan(local, 'partType')).toBeNull()
    const pend = proposeForItem({ id: 'c4', description: 'TIRE 315/80 R22.5 - SAILUN' }, { catalogue: cat, pending: new Set(['c4']) })
    expect(pend.brand.blocked).toBe('pending')
  })

  it('brand plan is a canonical correction with evidence', () => {
    const row = proposeForItem({ id: 'c5', description: 'TIRE 315/80 R22.5 - SAILUN' }, { catalogue: cat })
    const plan = writePlan(row, 'brand')
    expect(plan.payload).toMatchObject({ target_kind: 'canonical', target_id: 'c5', topic: 'brand', new_value: { brand: 'Sailun' } })
    expect(plan.payload.reason).toContain('SAILUN')
  })

  it('builds counts per rule and filters', () => {
    const items = [genuineItem, { id: 'c5', description: 'TIRE 315/80 R22.5 - SAILUN' }, { id: 'c6', description: 'GASKET' }]
    const { rows, counts } = buildProposals(items, { variants: [{ id: 'v1', canonical_id: 'c1', part_classification: 'unknown' }], catalogue: cat })
    expect(rows).toHaveLength(2)
    expect(counts.partType.original).toBe(1)
    expect(counts.brand.brand_tyre).toBe(1)
    expect(counts.highConfidence).toBe(1)
    expect(filterProposals(rows, { field: 'brand' })).toHaveLength(1)
    expect(filterProposals(rows, { confidence: 'high' })).toHaveLength(1)
    expect(filterProposals(rows, { hidden: new Set(['c1']) })).toHaveLength(1)
    expect(filterProposals(rows, { search: 'radaitor' })).toHaveLength(1)
  })
})
