import { describe, it, expect } from 'vitest'
import { compatibility, expandTerms, rankResults, scoreEntry } from '../lib/oemCatalog/search'

const manual = { id: 'm1', manufacturer: 'SANY', model: 'SY412C-8/ST', equipment_no: 'HNGJ1241009596' }
const e = (id, o = {}) => ({ id, manual_id: 'm1', part_no: '60012345', description: 'Water pump assembly', assembly_heading: 'Water Supply System', printed_page: '2-14', index_no: '2', ...o })

describe('compatibility', () => {
  it('distinguishes confirmed, model, unverified and incompatible', () => {
    expect(compatibility(manual, { chassis_no: 'HNGJ 1241009596', make: 'SANY', model: 'SY412C-8/ST' })).toBe('confirmed')
    expect(compatibility(manual, { chassis_no: 'XXXX', make: 'SANY', model: 'SY412C-8/ST' })).toBe('model')
    expect(compatibility(manual, { make: 'SANY', model: 'Other' })).toBe('unverified')
    expect(compatibility(manual, { make: 'Volvo', model: 'SY412C-8/ST' })).toBe('incompatible')
    expect(compatibility(manual, null)).toBe('unverified')
  })
  it('uses the manual serial range', () => {
    const ranged = { manufacturer: 'SANY', model: 'M', chassis_from: 'A1000', chassis_to: 'A2000' }
    expect(compatibility(ranged, { chassis_no: 'A1500', make: 'SANY', model: 'M' })).toBe('confirmed')
    expect(compatibility(ranged, { chassis_no: 'A3000', make: 'SANY', model: 'M' })).toBe('incompatible')
  })
  it('never claims fit from a similar description', () => {
    expect(compatibility({ manufacturer: 'SANY', model: 'SY205' }, { make: 'SANY', model: 'Water pump' })).toBe('unverified')
  })
})

describe('ranking', () => {
  it('ranks an exact part number first and says why', () => {
    const rows = [e('a', { part_no: '60012399', description: 'Seal' }), e('b'), e('c', { part_no: '600123450' })]
    const out = rankResults(rows, '60012345', { manuals: [manual] })
    expect(out[0].id).toBe('b'); expect(out[0]._why).toContain('exact_part_no')
    expect(out.find((x) => x.id === 'c')._why).toContain('part_no_prefix')
  })
  it('matches punctuation variants of the part number', () => {
    expect(scoreEntry(e('a', { part_no: '0060-0123.A' }), '006001 24a').reasons).not.toContain('exact_part_no')
    expect(scoreEntry(e('a', { part_no: '0060-0123.A' }), '0060 0123 A').reasons).toContain('exact_part_no')
  })
  it('finds a part by its old or replacement number', () => {
    expect(scoreEntry(e('a', { remark: 'Replaces 60099999' }), '60099999').reasons).toContain('replacement_number')
  })
  it('expands trade synonyms, and filters by compatibility and manufacturer', () => {
    expect(expandTerms('tyre').synonyms).toEqual(['tire'])
    expect(scoreEntry(e('a', { description: 'Spare tire carrier' }), 'tyre').reasons).toContain('description_synonym')
    const rows = [e('a'), e('b', { manual_id: 'm2' })]
    const manuals = [manual, { id: 'm2', manufacturer: 'Volvo', model: 'X' }]
    const asset = { chassis_no: 'HNGJ1241009596', make: 'SANY', model: 'SY412C-8/ST' }
    expect(rankResults(rows, 'water', { manuals, asset, filters: { compatibility: 'confirmed' } }).map((x) => x.id)).toEqual(['a'])
    expect(rankResults(rows, 'water', { manuals, filters: { manufacturer: 'Volvo' } }).map((x) => x.id)).toEqual(['b'])
  })
})
