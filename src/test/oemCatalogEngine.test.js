import { describe, it, expect } from 'vitest'
import { extractOemPartsPage, extractOemPartsDocument } from '../lib/oemPartsExtractor'
import { classifyHeading, classifyFigures, breadcrumbFor } from '../lib/oemCatalog/classifier'
import { validateRow } from '../lib/oemCatalog/validate'
import { dedupeRows, diffRevisions, rowsFingerprint } from '../lib/oemCatalog/dedupe'
import { processExtraction, reviewQueueForStorage } from '../lib/oemCatalog/pipeline'
import { parsePrintedPage, figureId } from '../lib/oemCatalog/pageNumbering'

// Synthetic pdf.js text items: { str, transform:[a,b,c,d,x,y] }
const tx = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 5 })

function listPage({ printed, heading, rows }) {
  const items = [
    tx('INDEX', 64, 700), tx('PART NO', 99, 700), tx('DESCRIPTION', 198, 700), tx('Remark', 455, 700), tx('QTY', 494, 700), tx('SEE', 537, 700),
    tx(printed, 560, 40), tx(heading, 400, 790),
  ]
  rows.forEach(([index, pn, desc, qty], i) => {
    const y = 680 - i * 14
    if (index) items.push(tx(String(index), 64, y))
    items.push(tx(pn, 99, y), tx(desc, 198, y))
    if (qty != null) items.push(tx(String(qty), 494, y))
  })
  return items
}

describe('page numbering', () => {
  it('parses chapter and page', () => {
    expect(parsePrintedPage('2-14')).toEqual({ chapter: 2, page: 14, label: '2-14' })
    expect(parsePrintedPage('x')).toBeNull()
    expect(figureId('2-14', 9)).toBe('F2-14')
    expect(figureId('', 9)).toBe('P9')
  })
})

describe('extractor on synthetic pages', () => {
  it('reads index, part number, description and quantity', () => {
    const page = extractOemPartsPage(listPage({
      printed: '2-14', heading: 'Water Supply System',
      rows: [[1, '60012345', 'Water tank', 1], [2, '60012346', 'Water pump assembly', 2]],
    }), 5)
    expect(page.rows).toHaveLength(2)
    expect(page.rows[1]).toMatchObject({ index_no: '2', part_no: '60012346', quantity: 2 })
    expect(page.printedPage).toBe('2-14')
  })
})

describe('classifier', () => {
  it('assigns area from explicit words and from system words', () => {
    expect(classifyHeading('Water Supply System')).toMatchObject({ group: 'water_system', area: 'upper' })
    expect(classifyHeading('Mixing Drum Assembly').area).toBe('upper')
    expect(classifyHeading('Chassis Frame').area).toBe('chassis')
    expect(classifyHeading('Engine and Turbocharger').area).toBe('chassis')
    expect(classifyHeading('Upper Hydraulic System')).toMatchObject({ group: 'hydraulic', area: 'upper' })
  })
  it('leaves generic systems unassigned with low confidence', () => {
    const c = classifyHeading('Electrical System')
    expect(c.area).toBe('other')
    expect(c.confidence).toBeLessThan(0.7)
  })
  it('does not match inside other words', () => {
    expect(classifyHeading('Cabinet of tools').group).not.toBe('cab')
  })
  it('uses chapter consensus to settle generic figures and flag conflicts', () => {
    const out = classifyFigures([
      { id: 'a', chapter: 3, heading: 'Mixing Drum', descriptions: [] },
      { id: 'b', chapter: 3, heading: 'Water Supply System', descriptions: [] },
      { id: 'c', chapter: 3, heading: 'Upper frame', descriptions: [] },
      { id: 'd', chapter: 3, heading: 'Electrical System', descriptions: [] },
      { id: 'e', chapter: 3, heading: 'Engine', descriptions: [] },
    ])
    const by = Object.fromEntries(out.map((f) => [f.id, f]))
    expect(by.d.area).toBe('upper')
    expect(by.d.reason).toMatch(/chapter 3/)
    expect(by.e.conflict).toBe(true)
    expect(by.e.confidence).toBeLessThanOrEqual(0.65)
  })
  it('builds a breadcrumb', () => {
    expect(breadcrumbFor({ model: 'SY412C-8/ST', area: 'upper', heading: 'Water Supply System' })).toEqual(['SY412C-8/ST', 'Upper part assembly', 'Water Supply System'])
  })
})

describe('validation', () => {
  const ok = { part_no: '60012345', description: 'Water tank', quantity: 1, illustration_pdf_page: 4, index_no: '1' }
  it('passes a clean row', () => expect(validateRow(ok)).toEqual([]))
  it('flags bad part numbers, quantities and descriptions', () => {
    expect(validateRow({ ...ok, part_no: 'ABCDEFG' }).map((i) => i.code)).toContain('part_no_shape')
    expect(validateRow({ ...ok, quantity: 0 }).map((i) => i.code)).toContain('qty_range')
    expect(validateRow({ ...ok, description: '' }).map((i) => i.code)).toContain('desc_short')
    expect(validateRow({ ...ok, quantity: null })[0].severity).toBe('warn')
  })
  it('flags callouts missing from the figure', () => {
    expect(validateRow(ok, { calloutIndexes: new Set(['2']) }).map((i) => i.code)).toContain('orphan_index')
  })
})

describe('dedupe and revisions', () => {
  const r = (o) => ({ printed_page: '2-14', index_no: '1', part_no: '60012345', description: 'Tank', quantity: 1, ...o })
  it('drops repeats and keeps the fuller description', () => {
    const { rows, dropped } = dedupeRows([r(), r({ description: 'Water tank' })])
    expect(rows).toHaveLength(1)
    expect(dropped).toHaveLength(1)
    expect(rows[0].description).toBe('Water tank')
  })
  it('diffs revisions', () => {
    const d = diffRevisions([r(), r({ index_no: '2', part_no: '60099999' })], [r({ quantity: 2 }), r({ index_no: '3', part_no: '60088888' })])
    expect(d.added).toHaveLength(1)
    expect(d.removed).toHaveLength(1)
    expect(d.changed).toHaveLength(1)
  })
  it('fingerprint is stable and order independent', async () => {
    const a = await rowsFingerprint([r(), r({ index_no: '2', part_no: '60099999' })])
    const b = await rowsFingerprint([r({ index_no: '2', part_no: '60099999' }), r()])
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })
})

describe('pipeline on a synthetic 3-chapter book', () => {
  const mk = (printed, heading, pdf, rows) => rows.map(([index, pn, desc, qty], i) => ({
    source_pdf_page: pdf, row_order: i + 1, assembly_heading: heading, printed_page: printed, index_no: index ? String(index) : null,
    parent_index: index ? null : '1', part_no: pn, description: desc, quantity: qty, illustration_pdf_page: pdf - 1,
  }))
  const rows = [
    ...mk('1-5', 'Chassis Frame', 12, [[1, '70010001', 'Frame rail left', 1], [2, '70010002', 'Frame rail right', 1]]),
    ...mk('1-7', 'Engine', 14, [[1, '70020001', 'Engine assembly', 1]]),
    ...mk('2-3', 'Mixing Drum', 20, [[1, '80010001', 'Drum body', 1], [2, '80010002', 'Drum blade', 4], [3, 'BAD', 'x', 0]]),
    ...mk('2-4', 'Water Supply System', 22, [[1, '80020001', 'Water tank', 1], [1, '80020009', 'Dup index part', 1]]),
    ...mk('2-6', 'Upper frame', 24, [[1, '80030001', 'Subframe', 1]]),
    ...mk('2-9', 'Electrical System', 26, [[1, '80040001', 'Harness', 1]]),
    ...mk('1-5', 'Chassis Frame', 12, [[1, '70010001', 'Frame rail left', 1]]),
  ]
  const out = processExtraction({ rows, calloutsByPage: { 19: ['1', '2', '3', '9'] } }, { model: 'SY412C-8/ST' })

  it('dedupes, groups and classifies figures by area', () => {
    expect(out.summary.duplicatesDropped).toBe(1)
    expect(out.figures['F1-5'].area).toBe('chassis')
    expect(out.figures['F2-3'].area).toBe('upper')
    expect(out.figures['F2-9'].area).toBe('upper')
    expect(out.summary.areaCounts).toEqual({ chassis: 2, upper: 4 })
  })
  it('publishes clean rows and queues bad ones with reasons', () => {
    expect(out.review.map((r) => r.part_no)).toContain('BAD')
    expect(out.publish.map((r) => r.part_no)).toContain('70010001')
    expect(out.publish.every((r) => r.assembly_area)).toBe(true)
    const q = reviewQueueForStorage(out.review)
    expect(q.find((x) => x.part_no === 'BAD').reasons.length).toBeGreaterThan(0)
    expect(out.summary.published + out.summary.reviewRows).toBe(out.summary.rowsIn - out.summary.duplicatesDropped)
  })
  it('reports duplicate indexes and orphan callouts', () => {
    const dup = [...out.publish, ...out.review].filter((r) => r.figure_id === 'F2-4')
    expect(dup.every((r) => r.issues.some((i) => i.code === 'duplicate_index'))).toBe(true)
    expect(out.orphanCallouts).toEqual([{ pdfPage: 19, indexes: ['9'] }])
  })
  it('is deterministic', () => {
    expect(JSON.stringify(processExtraction({ rows }).summary)).toBe(JSON.stringify(processExtraction({ rows }).summary))
  })
  it('extractOemPartsDocument gathers callouts from figure pages', async () => {
    const pages = {
      1: { items: [tx('1', 100, 100), tx('2', 120, 140), tx('Figure', 50, 50)] },
      2: { items: listPage({ printed: '2-2', heading: 'Water Supply System', rows: [[1, '60012345', 'Water tank', 1]] }) },
    }
    const doc = { numPages: 2, getPage: async (n) => ({ getTextContent: async () => pages[n] }) }
    pages[1].items.push(tx('2-1', 560, 40))
    const res = await extractOemPartsDocument(doc)
    expect(res.rows).toHaveLength(1)
    expect(res.calloutsByPage[res.rows[0].illustration_pdf_page]).toEqual(['1', '2'])
  })
})
