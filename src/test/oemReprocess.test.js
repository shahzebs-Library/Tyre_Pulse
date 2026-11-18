import { describe, it, expect } from 'vitest'
import { reprocessAgainstStored } from '../lib/oemCatalog/reprocess'
import { unionCrop, splitCrop, mergeProblem, splitProblem, reassignProblem } from '../lib/oemCatalog/figureTools'

const entry = (o) => ({ id: 'e' + o.part_no, source_pdf_page: 5, printed_page: '2-3', index_no: '1', description: 'Bolt', quantity: 2, remark: '', assembly_heading: 'Water pump', ...o })
const row = (o) => ({ source_pdf_page: 5, printed_page: '2-3', index_no: '1', description: 'Bolt', quantity: 2, part_no: 'A1', figure_id: 'F2-3', assembly_heading: 'Water pump', ...o })
const pipeline = (rows) => ({ publish: rows, review: [], figures: { 'F2-3': { hierarchy: { category: 'water_system' } } } })

describe('reprocess against stored', () => {
  it('reports new parts and leaves unchanged ones alone', () => {
    const p = reprocessAgainstStored({ entries: [entry({ part_no: 'A1' })], pipeline: pipeline([row({}), row({ part_no: 'B2', index_no: '2' })]), manual: {} })
    expect(p.newParts.map((r) => r.part_no)).toEqual(['B2'])
    expect(p.unchanged).toBe(1)
  })
  it('protects admin corrected and work-order referenced records from overwrite', () => {
    const entries = [entry({ part_no: 'A1', admin_corrected: true, description: 'Corrected' }), entry({ part_no: 'C3', index_no: '3', description: 'Old' })]
    const p = reprocessAgainstStored({ entries, pipeline: pipeline([row({}), row({ part_no: 'C3', index_no: '3', description: 'New' })]), manual: {}, referencedIds: new Set(['eC3']) })
    expect(p.protectedRecords.map((x) => x.reason).sort()).toEqual(['admin corrected', 'referenced by a work order'])
    expect(p.changed).toHaveLength(0)
  })
  it('lists stored parts that are missing from the new run without deleting them', () => {
    const p = reprocessAgainstStored({ entries: [entry({ part_no: 'Z9', index_no: '9' })], pipeline: pipeline([]), manual: {} })
    expect(p.missingNow).toHaveLength(1)
  })
})

describe('figure tools', () => {
  const crop = { x0: 0, y0: 0, x1: 100, y1: 50 }
  it('unions and splits crops without overlap', () => {
    expect(unionCrop(crop, { x0: 50, y0: -10, x1: 150, y1: 40 })).toEqual({ x0: 0, y0: -10, x1: 150, y1: 50 })
    const [a, b] = splitCrop(crop, 'x', 0.4)
    expect(a.x1).toBe(b.x0); expect(a.x1).toBe(40)
    expect(splitCrop({ x0: 1, y0: 1, x1: 1, y1: 5 })).toBeNull()
  })
  it('validates merge, split and reassign requests', () => {
    const figs = { A: { geometry: { pdf_page: 4 } }, B: { geometry: { pdf_page: 4 } }, C: { geometry: { pdf_page: 9 } } }
    expect(mergeProblem(figs, 'A', 'B')).toBeNull()
    expect(mergeProblem(figs, 'A', 'C')).toMatch(/different PDF pages/)
    expect(mergeProblem(figs, 'A', 'A')).toMatch(/different/)
    expect(splitProblem(figs, 'A', 'B', ['x'])).toMatch(/already used/)
    expect(splitProblem(figs, 'A', 'D', [])).toMatch(/at least one/)
    expect(splitProblem(figs, 'A', 'D', ['x'])).toBeNull()
    expect(reassignProblem(figs, 'Q', ['x'])).toMatch(/Choose/)
    expect(reassignProblem(figs, 'B', ['x'])).toBeNull()
  })
})
