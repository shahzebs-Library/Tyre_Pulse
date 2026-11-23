import { describe, it, expect } from 'vitest'
import {
  partTypeKey, partTypesOf, partTypeOf, partTypeTone, brandOf, brandLine, keySpecs, oemNumbers,
  postedStock, pendingOpening, enrichMaterials, catalogFacets, quoteFilterValue, skuKey,
} from '../lib/inventory/materialCatalogView'

describe('material catalogue part type', () => {
  it('maps stored classifications to badges and never invents a class', () => {
    expect(partTypeKey('genuine')).toBe('genuine')
    expect(partTypeKey('OES')).toBe('oes')
    expect(partTypeKey('aftermarket')).toBe('aftermarket')
    expect(partTypeKey('local')).toBe('local')
    expect(partTypeKey('unknown')).toBe('not_stated')
    expect(partTypeKey(null)).toBe('not_stated')
    expect(partTypeKey('')).toBe('not_stated')
    expect(partTypeKey('counterfeit')).toBe('not_stated')
  })

  it('picks the strongest live variant and ignores rejected / retired ones', () => {
    const vs = [
      { part_classification: 'aftermarket', status: 'proposed' },
      { part_classification: 'genuine', status: 'rejected' },
      { part_classification: 'oes', status: 'active' },
      { part_classification: 'unknown', status: 'proposed' },
    ]
    expect(partTypesOf(vs)).toEqual(['oes', 'aftermarket'])
    expect(partTypeOf(vs)).toBe('oes')
    expect(partTypeOf([{ part_classification: 'unknown', status: 'proposed' }])).toBe('not_stated')
    expect(partTypeOf([])).toBe('not_stated')
    expect(partTypeOf(undefined)).toBe('not_stated')
    expect(partTypeOf([{ classification: 'genuine', status: 'active' }])).toBe('genuine')
  })

  it('tones', () => {
    expect(partTypeTone('genuine')).toBe('good')
    expect(partTypeTone('aftermarket')).toBe('warn')
    expect(partTypeTone('not_stated')).toBe('muted')
  })
})

describe('material catalogue brand and specs', () => {
  it('reads brand from the column, specs, then manufacturer; null when none', () => {
    expect(brandOf({ brand: 'SANY', manufacturer: 'SANY' })).toBe('SANY')
    expect(brandOf({ brand: null, specs: { brand: 'Bosch' } })).toBe('Bosch')
    expect(brandOf({ manufacturer: 'Cummins' })).toBe('Cummins')
    expect(brandOf({ brand: '  ', manufacturer: null, specs: {} })).toBeNull()
    expect(brandOf({ brand: 'undefined' })).toBeNull()
    expect(brandOf(null)).toBeNull()
  })

  it('adds the manufacturer only when it differs', () => {
    expect(brandLine({ brand: 'Fleetguard', manufacturer: 'Cummins' })).toBe('Fleetguard (Cummins)')
    expect(brandLine({ brand: 'SANY', manufacturer: 'sany' })).toBe('SANY')
    expect(brandLine({ manufacturer: 'Cummins' })).toBe('Cummins')
    expect(brandLine({})).toBeNull()
  })

  it('lists only present key specs in a fixed order', () => {
    const m = { specs: { material: 'PVC', size: '4"', colour: '', side: null, pack: ['10', 'box'], source: 'x' } }
    expect(keySpecs(m)).toEqual([['size', '4"'], ['pack', '10, box'], ['material', 'PVC']])
    expect(keySpecs({ specs: 'bad' })).toEqual([])
  })

  it('collects distinct OEM numbers from aliases and genuine variants', () => {
    const aliases = [{ alias_type: 'oem', value: 'A-1' }, { alias_type: 'oem', value: 'a-1' }, { alias_type: 'oem', value: 'OLD', ref_status: 'historical' }]
    const variants = [{ part_classification: 'genuine', status: 'proposed', part_number: 'B-2' }, { part_classification: 'aftermarket', status: 'active', part_number: 'C-3' }]
    expect(oemNumbers(aliases, variants)).toEqual(['A-1', 'B-2'])
  })
})

describe('material catalogue stock', () => {
  it('sums posted stock per store', () => {
    const s = postedStock([
      { site: 'NHC', qty_on_hand: 4, qty_reserved: 1, uom: 'EA' },
      { site: 'NHC', qty_on_hand: '2', qty_reserved: null, uom: 'EA' },
      { site: 'JED', qty_on_hand: 3, uom: 'EA' },
    ])
    expect(s.onHand).toBe(9)
    expect(s.reserved).toBe(1)
    expect(s.sites.map((x) => [x.site, x.onHand])).toEqual([['JED', 3], ['NHC', 6]])
    expect(s.uom).toBe('EA')
    expect(postedStock([]).onHand).toBe(0)
  })

  it('counts only draft / submitted opening lines as pending', () => {
    const p = pendingOpening([
      { batch_id: 'b1', qty: 5, uom: 'PC', batch: { status: 'draft', site: 'NHC', country: 'KSA' } },
      { batch_id: 'b2', qty: 2, uom: 'PC', batch: { status: 'submitted', site: 'NHC', country: 'KSA' } },
      { batch_id: 'b3', qty: 100, batch: { status: 'approved', site: 'NHC' } },
      { batch_id: 'b4', qty: 9, batch: { status: 'cancelled', site: 'JED' } },
    ])
    expect(p.qty).toBe(7)
    expect(p.lines).toBe(2)
    expect(p.batches).toBe(2)
    expect(p.sites).toHaveLength(1)
    expect(p.sites[0].statuses).toEqual(['draft', 'submitted'])
    expect(p.statuses).toEqual(['draft', 'submitted'])
  })

  it('joins a page and keeps an unreadable lookup as null, not zero', () => {
    const mats = [{ id: 'c1', company_sku: '223218-o', brand: null, specs: { sub_category: 'Hoses', fits_vehicle: 'SANY' } }]
    const ok = enrichMaterials(mats, {
      variants: [{ canonical_id: 'c1', part_classification: 'unknown', status: 'proposed' }],
      aliases: [{ canonical_id: 'c1', alias_type: 'oem', value: 'X9' }],
      balances: [{ item_code: '223218-O', site: 'NHC', qty_on_hand: 2 }],
      openingLines: [{ item_code_raw: ' 223218-O ', qty: 3, batch_id: 'b', batch: { status: 'draft', site: 'NHC' } }],
    })[0]
    expect(ok.partType).toBe('not_stated')
    expect(ok.oem).toEqual(['X9'])
    expect(ok.posted.onHand).toBe(2)
    expect(ok.pending.qty).toBe(3)
    expect(ok.subCategory).toBe('Hoses')
    expect(ok.fitsVehicle).toBe('SANY')
    expect(ok.brandLine).toBeNull()

    const failed = enrichMaterials(mats, { variants: null, aliases: [], balances: null, openingLines: [] })[0]
    expect(failed.partType).toBeNull()
    expect(failed.oem).toBeNull()
    expect(failed.posted).toBeNull()
    expect(failed.pending.qty).toBe(0)
  })
})

describe('material catalogue facets and filters', () => {
  it('builds distinct sorted facets', () => {
    expect(catalogFacets([
      { category: 'Filters', brand: 'SANY', manufacturer: 'SANY' },
      { category: 'Body', brand: null, spec_brand: 'Bosch' },
      { category: null, manufacturer: 'Cummins' },
    ])).toEqual({ brands: ['Bosch', 'Cummins', 'SANY'], categories: ['Body', 'Filters'] })
  })

  it('quotes filter values safely and normalises SKUs', () => {
    expect(quoteFilterValue('A, "B"')).toBe('"A, \\"B\\""')
    expect(skuKey(' 223218-o ')).toBe('223218-O')
    expect(skuKey(null)).toBe('')
  })
})

describe('posted stock through canonical -> ERP item links', () => {
  it('counts a balance linked by canonical_id even when its ERP code differs, without double counting', () => {
    const [m] = enrichMaterials([{ id: 'c1', company_sku: 'SKU-1' }], {
      variants: [], aliases: [], openingLines: [],
      balances: [
        { id: 'b1', item_code: 'SKU-1', site: 'NHC', qty_on_hand: 2, qty_reserved: 0 },
        { id: 'b2', item_code: 'ERP-77', canonical_id: 'c1', site: 'NHC', qty_on_hand: 3, qty_reserved: 0 },
        { id: 'b1', item_code: 'SKU-1', canonical_id: 'c1', site: 'NHC', qty_on_hand: 2, qty_reserved: 0 },
      ],
    })
    expect(m.posted.onHand).toBe(5)
  })
})
