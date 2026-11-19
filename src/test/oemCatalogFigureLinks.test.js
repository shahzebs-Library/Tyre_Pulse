import { describe, it, expect } from 'vitest'
import { entryGroupKey, figureFromRow, groupFigureId, legacyGroupKey, resolveFigures } from '../lib/oemCatalog/figureLinks'
import { importSaveCounts, importSavedNotice } from '../lib/oemCatalog/importSave'

const savedRow = {
  figure_id: 'F2-14', pdf_page: 4, caption: '2-14', page_info: { width: 595 }, crop: { x0: 1, y0: 2, x1: 3, y1: 4 },
  callouts: [{ index: '1' }], match: { score: 0.9, reason: 'ok' }, match_status: 'verified', admin_adjusted: true,
  hierarchy: { area: 'chassis', heading: 'Water Supply', area_confidence: 0.95, system: 'water' },
}

describe('figure links', () => {
  it('groups a row by its saved figure, otherwise by page and heading', () => {
    expect(entryGroupKey({ figure_id: 'F2-14', illustration_pdf_page: 4 })).toBe('fig:F2-14')
    expect(entryGroupKey({ illustration_pdf_page: 4, assembly_heading: 'Water  Supply' })).toBe(legacyGroupKey({ illustration_pdf_page: 4, assembly_heading: 'Water Supply' }))
  })
  it('names a group by its saved figure before its printed page', () => {
    expect(groupFigureId({ figureId: 'F2-14b', printedPages: ['2-14'] })).toBe('F2-14b')
    expect(groupFigureId({ printedPages: ['2-14'] })).toBe('F2-14')
    expect(groupFigureId({ printedPages: [] })).toBe(null)
  })
  it('maps a saved figure row to the viewer shape, keeping the admin crop', () => {
    const f = figureFromRow(savedRow)
    expect(f).toMatchObject({ area: 'chassis', heading: 'Water Supply', confidence: 0.95, admin_adjusted: true })
    expect(f.geometry).toMatchObject({ status: 'verified', crop: savedRow.crop, pdf_page: 4, score: 0.9, callouts: [{ index: '1' }] })
  })
  it('an unknown system falls back to other, and no confidence never flags review', () => {
    const f = figureFromRow({ figure_id: 'F1', hierarchy: { system: 'engine' } })
    expect(f.area).toBe('other')
    expect(f.confidence).toBeUndefined()
  })
  it('saved figures replace the import snapshot; the snapshot is used only when none exist', () => {
    const snapshot = { 'F2-14': { area: 'upper', geometry: { crop: { x0: 9 } } }, F9: { area: 'upper' } }
    const resolved = resolveFigures([savedRow], snapshot)
    expect(Object.keys(resolved)).toEqual(['F2-14'])
    expect(resolved['F2-14'].geometry.crop).toEqual(savedRow.crop)
    expect(resolveFigures([], snapshot)).toBe(snapshot)
    expect(resolveFigures(null, undefined)).toEqual({})
  })
})

describe('import save', () => {
  it('allows saving a manual whose every row needs review', () => {
    expect(importSaveCounts({ publish: [], review: [{}, {}] })).toEqual({ publish: 0, review: 2, canSave: true, reviewOnly: true })
    expect(importSaveCounts({ publish: [], review: [] }).canSave).toBe(false)
    expect(importSaveCounts(null).canSave).toBe(false)
    expect(importSaveCounts({ publish: [{}], review: [] })).toMatchObject({ canSave: true, reviewOnly: false })
  })
  it('says honestly that nothing was published for a review-only manual', () => {
    const msg = importSavedNotice({ manufacturer: 'SANY', model: 'SY412C', item_count: 0 }, { reviewOnly: true, review: 12 })
    expect(msg).toMatch(/no parts were published yet/)
    expect(msg).toMatch(/12 rows need review/)
    expect(importSavedNotice({ manufacturer: 'SANY', model: 'SY412C', item_count: 40 }, { reviewOnly: false })).toMatch(/40 parts and variants saved/)
  })
})
