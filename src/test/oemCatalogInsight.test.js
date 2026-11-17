import { describe, it, expect } from 'vitest'
import { partInsight, figureSummary, manualCoverage } from '../lib/oemCatalog/insight'

const r = (id, o = {}) => ({ id, part_no: '60012345', description: 'Seal', index_no: '1', quantity: 2, source_pdf_page: 31, printed_page: '2-14', illustration_pdf_page: 30, assembly_heading: 'Water', ...o })

describe('partInsight', () => {
  const rows = [
    r('a'), r('b', { printed_page: '3-2', index_no: '5', quantity: 4, assembly_heading: 'Drum' }),
    r('c', { part_no: '60012399', index_no: '2', remark: 'Replaces 60012345' }),
    r('d', { part_no: '60012400', index_no: '3', remark: 'Superseded by 60012399' }),
  ]
  const figs = { 'F2-14': { geometry: { status: 'verified', score: 1, missing: [], callouts: [{ index: '1' }, { index: '2' }], crop: { x0: 0 } }, hierarchy: { category: 'water_system' } } }
  const i = partInsight(rows[0], rows, figs, { equipment_no: 'HNGJ1', model_code: 'SY412' })
  it('finds where the same number is used in other figures', () => {
    expect(i.whereUsed).toEqual([{ id: 'b', figure: 'F3-2', heading: 'Drum', printed_page: '3-2', callout: '5', quantity: 4 }])
  })
  it('derives the replaced-by chain from other rows remarks', () => {
    expect(i.supersededBy.map((x) => x.no)).toEqual(['60012399'])
    const d = partInsight(rows[3], rows, figs, {})
    expect(d.supersededBy[0]).toMatchObject({ no: '60012399', found: [{ id: 'c' }] })
  })
  it('lists same-assembly parts and evidence, and leaves missing values null', () => {
    expect(i.related.map((x) => x.part_no)).toEqual(['60012399', '60012400'])
    expect(i.evidence).toMatchObject({ status: 'verified', calloutOnDrawing: true, hasCrop: true })
    expect(i.uom).toBeNull()
    expect(i.fitment.chassisFrom).toBeNull()
    expect(i.category).toBe('water_system')
    expect(partInsight(rows[1], rows, figs, {}).evidence).toBeNull()
  })
})

describe('figureSummary and coverage', () => {
  it('counts parts, callouts and gaps from data only', () => {
    const g = { rows: [r('a'), r('b', { index_no: '2' }), r('c', { index_no: '2', part_no: '60012346' })] }
    expect(figureSummary(g, { absent_callouts: ['7'], unmatched_numerals: 3, status: 'estimated' })).toMatchObject({ rows: 3, parts: 2, callouts: 2, absentCallouts: ['7'], unmatchedNumerals: 3 })
    expect(figureSummary(g, null).status).toBeNull()
  })
  it('reports accuracy as unmeasured and flags a truncated legacy queue', () => {
    const c = manualCoverage({ page_count: 100, item_count: 900, import_summary: { parsedPages: [1, 2], imageOnlyPages: [5], pipeline: { published: 900, reviewRows: 800, figuresVerified: 10, figuresAmbiguous: 2 }, reviewQueue: new Array(500).fill(0), figures: { a: { geometry: { status: 'verified' } }, b: { geometry: { status: 'unavailable' } } } } })
    expect(c).toMatchObject({ accuracyMeasured: false, queueTruncated: true, figures: 2, figuresWithGeometry: 1, imageOnlyPages: 1 })
    expect(manualCoverage({}).published).toBeNull()
  })
})
