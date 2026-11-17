import { describe, it, expect } from 'vitest'
import { classifyCategory, classifyFigureHierarchy, applyCorrection, derivedCategories, headingSimilarity } from '../lib/oemCatalog/taxonomy'
import { parseRemark, parseUom, buildRecord, fitmentVariants, conflictingValues, reprocessPreview, sameRecord } from '../lib/oemCatalog/records'
import { dedupeRows, diffRevisions } from '../lib/oemCatalog/dedupe'
import { processExtraction } from '../lib/oemCatalog/pipeline'

describe('taxonomy', () => {
  it('maps chassis and upper-equipment headings to standard categories', () => {
    const cases = {
      'Front Axle Assembly': ['front_axle', 'chassis'], 'Rear axle and differential': ['rear_axle', 'chassis'], 'Air dryer and tanks': ['pneumatic', 'chassis'],
      'Brake chamber': ['braking', 'chassis'], 'Mixing Drum Assembly': ['mixer_drum', 'upper'], 'Hydraulic pump': ['hydraulic_pump_motor', 'upper'],
      'Water Supply System': ['water_system', 'upper'], 'Discharge Chute': ['discharge_chute', 'upper'], 'Platform and ladder': ['platforms_ladders', 'upper'],
    }
    for (const [h, [cat, sys]] of Object.entries(cases)) expect(classifyCategory(h)).toMatchObject({ category: cat, system: sys })
  })
  it('does not force an unclear heading into a category', () => {
    expect(classifyCategory('Miscellaneous items 7')).toBeNull()
    const h = classifyFigureHierarchy({ heading: 'Miscellaneous items 7', chapter: 9, area: 'other' })
    expect(h).toMatchObject({ category: 'uncategorised', derived: true, review: true })
    expect(h.oem_path).toEqual(['Chapter 9', 'Miscellaneous items 7'])
  })
  it('keeps the manufacturer chapter path next to the standard category', () => {
    const h = classifyFigureHierarchy({ heading: 'Water Supply System', chapter: 2, chapterTitle: 'Upper part assembly', area: 'upper', equipment: 'SY412C-8/ST' })
    expect(h.oem_path).toEqual(['Upper part assembly', 'Water Supply System'])
    expect(h).toMatchObject({ category: 'water_system', system: 'upper', review: false })
  })
  it('flags a heading whose category clashes with the page area', () => {
    expect(classifyFigureHierarchy({ heading: 'Rear axle', area: 'upper' })).toMatchObject({ review: true, confidence: 0.5 })
  })
  it('admin corrections win and are reused for similar headings on later imports', () => {
    const rules = [{ heading: 'Miscellaneous items 7', category: 'fasteners_mounting', system: 'chassis', scope: 'all' }]
    expect(classifyFigureHierarchy({ heading: 'Miscellaneous items 7' }, { corrections: rules })).toMatchObject({ category: 'fasteners_mounting', source: 'admin_correction', confidence: 1 })
    expect(applyCorrection('Miscellaneous items 12', rules)).toBeTruthy()
    expect(applyCorrection('Water pump', rules)).toBeNull()
    expect(headingSimilarity('Water Supply System', 'water supply system 3')).toBeGreaterThan(0.7)
  })
  it('lists manual-specific derived categories', () => {
    const d = derivedCategories({ a: { heading: 'Odd 1', hierarchy: { derived: true, derived_category: 'odd #' } }, b: { heading: 'Odd 2', hierarchy: { derived: true, derived_category: 'odd #' } }, c: { hierarchy: { derived: false } } })
    expect(d).toEqual([{ key: 'odd #', heading: 'Odd 1', figures: ['a', 'b'] }])
  })
})

describe('records', () => {
  it('keeps the callout index apart from the part number and preserves the printed number', () => {
    const rec = buildRecord({ part_no: '0060-0123.A', index_no: '17', description: 'Seal ring  ,  big', quantity: 2, source_pdf_page: 31, printed_page: '2-14', remark: 'Replaces 0060-0100.A. From SN 1000 to 2000' }, { manufacturer: 'SANY', model: 'SY412C-8/ST' })
    expect(rec.part_no).toBe('0060-0123.A')
    expect(rec.part_no_normalized).toBe('00600123A')
    expect(rec.callout).toBe('17')
    expect(rec.description_normalized).toBe('seal ring, big')
    expect(rec.supersedes).toEqual(['0060-0100.A'])
    expect(rec.serial_from).toBe('1000')
  })
  it('parses replacement numbers and units', () => {
    expect(parseRemark('Superseded by 60012999').superseded_by).toEqual(['60012999'])
    expect(parseRemark('Left side').supersedes).toEqual([])
    expect(parseUom('2 SET')).toBe('SET')
    expect(parseUom('4')).toBeNull()
  })
  it('does not merge records that differ in quantity or serial note', () => {
    const a = { printed_page: '2-14', index_no: '3', part_no: '60012345', description: 'Seal', quantity: 2, remark: 'to SN 1000' }
    const b = { ...a, quantity: 4, remark: 'from SN 1001' }
    expect(dedupeRows([a, b]).rows).toHaveLength(2)
    expect(dedupeRows([a, { ...a }]).rows).toHaveLength(1)
    expect(sameRecord(a, b)).toBe(false)
    const recs = [a, b].map((r) => buildRecord({ ...r, source_pdf_page: 1 }))
    expect(fitmentVariants(recs)).toHaveLength(1)
  })
  it('detects conflicting descriptions for one number but not wording variants', () => {
    const mk = (d) => buildRecord({ part_no: '60012345', description: d, source_pdf_page: 1 })
    expect(conflictingValues([mk('Water pump assembly'), mk('Drum bearing')])).toHaveLength(1)
    expect(conflictingValues([mk('Water pump assembly'), mk('Water pump assembly kit')])).toHaveLength(0)
  })
  it('revision diff keys on the figure line, so a changed quantity is "changed" not new', () => {
    const a = { printed_page: '2-14', index_no: '3', part_no: '60012345', description: 'Seal', quantity: 2 }
    const d = diffRevisions([a], [{ ...a, quantity: 4 }])
    expect(d.changed).toHaveLength(1); expect(d.added).toHaveLength(0)
  })
})

describe('reprocess preview', () => {
  const rec = (o) => ({ id: o.id, figure_id: 'F2-14', callout: '1', part_no: '60012345', description_original: 'Seal', quantity_per_assembly: 1, remark: null, assembly: 'Water', category: 'water_system', uom: null, confidence: 0.9, ...o })
  it('shows new, changed, protected, missing and uncertain records without overwriting corrected ones', () => {
    const existing = [rec({ id: 'a' }), rec({ id: 'b', callout: '2', part_no: '60012346', admin_corrected: true, description_original: 'Pump (corrected)' }), rec({ id: 'c', callout: '3', part_no: '60012347' }), rec({ id: 'd', callout: '9', part_no: '60099999' })]
    const proposed = [rec({ id: 'x', category: 'mixer_drum' }), rec({ callout: '2', part_no: '60012346', description_original: 'Pump' }), rec({ callout: '3', part_no: '60012347', quantity_per_assembly: 2 }), rec({ callout: '4', part_no: '60012348', confidence: 0.4 })]
    const p = reprocessPreview(existing, proposed, { referencedIds: new Set(['c']) })
    expect(p.newParts.map((x) => x.part_no)).toEqual(['60012348'])
    expect(p.protectedRecords.map((x) => x.id).sort()).toEqual(['b', 'c'])
    expect(p.changed.map((x) => x.id)).toEqual(['a'])
    expect(p.categoryChanges).toEqual([{ id: 'a', from: 'water_system', to: 'mixer_drum' }])
    expect(p.missingNow.map((x) => x.id)).toEqual(['d'])
    expect(p.uncertain).toHaveLength(1)
  })
})

describe('pipeline carries the hierarchy', () => {
  it('adds hierarchy and derived-category counts to the summary', () => {
    const rows = [{ source_pdf_page: 5, row_order: 1, assembly_heading: 'Water Supply System', printed_page: '2-14', index_no: '1', part_no: '60012345', description: 'Water tank', quantity: 1, illustration_pdf_page: 4 },
      { source_pdf_page: 6, row_order: 1, assembly_heading: 'Miscellaneous', printed_page: '2-15', index_no: '1', part_no: '60012399', description: 'Thing', quantity: 1, illustration_pdf_page: 4 }]
    const out = processExtraction({ rows }, { model: 'SY412C-8/ST', manufacturer: 'SANY' })
    expect(out.figures['F2-14'].hierarchy.category).toBe('water_system')
    expect(out.figures['F2-15'].hierarchy.category).toBe('uncategorised')
    expect(out.summary.derivedCategories).toHaveLength(1)
  })
})
