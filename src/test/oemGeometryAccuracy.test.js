// @vitest-environment node
// Measured accuracy of the figure-separation and table-association engine.
// Ground truth is built into synthetic multi-drawing PDFs (no real OEM manual is
// available in the repo). Each page is rendered to a real PDF, read back with
// pdf.js (operator list + text layer) and compared with what was drawn.
import { describe, it, expect } from 'vitest'
import { jsPDF } from 'jspdf'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { processExtraction } from '../lib/oemCatalog/pipeline'
import { analyzePageGeometry, pageInfo, iou, matchTableToFigure, reconcileCallouts, repeatedMargins, textBoxes, figureSignature } from '../lib/oemCatalog/pageGeometry'

const W = 600; const H = 800
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

/** Draw one exploded-style drawing: many parts, callouts just outside. Returns truth in PDF user space (y up). */
function drawFigure(doc, r, x, y, w, h, indexes) {
  for (let i = 0; i < 12; i += 1) {
    const sx = x + 8 + r() * (w - 60); const sy = y + 8 + r() * (h - 50)
    const sw = 20 + r() * 30; const sh = 15 + r() * 25
    const kind = i % 3
    if (kind === 0) doc.rect(sx, sy, Math.min(sw, x + w - sx), Math.min(sh, y + h - sy))
    else if (kind === 1) doc.circle(Math.min(sx + 12, x + w - 14), Math.min(sy + 12, y + h - 14), 10)
    else doc.line(sx, sy, Math.min(sx + sw, x + w), Math.min(sy + sh, y + h))
  }
  doc.rect(x, y, w, h) // artwork envelope so extents are known exactly
  const callouts = indexes.map((idx, k) => {
    const cx = x + (k % 4) * (w / 4) + 10; const cy = y - 8 // just above the drawing
    doc.setFontSize(9); doc.text(String(idx), cx, cy)
    return { index: String(idx), x: cx, y: H - cy }
  })
  // jsPDF y is top-down; PDF user space is bottom-up
  return { bbox: { x0: x, y0: H - (y + h), x1: x + w, y1: H - y }, callouts }
}

function buildCase(seed) {
  const r = rng(seed)
  const doc = new jsPDF({ unit: 'pt', format: [W, H] })
  doc.setFontSize(9); doc.text('SANY Parts Book', 40, 20); doc.text('Page ' + seed, 520, 780)
  doc.setLineWidth(0.5); doc.line(30, 30, 570, 30) // header rule
  const layout = seed % 4
  const figs = []
  const mk = (x, y, w, h, idx) => figs.push(drawFigure(doc, r, x, y, w, h, idx))
  if (layout === 0) { mk(70, 100, 440, 260, [1, 2, 3, 4, 5, 6, 7, 8]); mk(70, 430, 440, 260, [9, 10, 11, 12, 13, 14, 15, 16]) }
  else if (layout === 1) { mk(40, 120, 220, 300, [1, 2, 3, 4]); mk(330, 120, 220, 300, [5, 6, 7, 8]) }
  else if (layout === 2) { mk(60, 90, 480, 170, [1, 2, 3, 4]); mk(60, 320, 480, 170, [5, 6, 7, 8]); mk(60, 550, 480, 170, [9, 10, 11, 12]) }
  else { mk(80, 150, 440, 500, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }
  return { buf: new Uint8Array(doc.output('arraybuffer')), figs, layout }
}

async function analyse(buf) {
  const pdf = await pdfjs.getDocument({ data: buf, verbosity: 0 }).promise
  const page = await pdf.getPage(1)
  return analyzePageGeometry({ opList: await page.getOperatorList(), OPS: pdfjs.OPS, items: (await page.getTextContent()).items, info: pageInfo(page) })
}

describe('geometry engine accuracy (synthetic ground truth)', () => {
  const results = { ious: [], tp: 0, fp: 0, fn: 0, figTruth: 0, figFound: 0, assoc: 0, assocTotal: 0, ambiguousWrongly: 0 }

  it('separates drawings, assigns callouts and associates tables over 24 pages', async () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const c = buildCase(seed)
      const out = await analyse(c.buf)
      results.figTruth += c.figs.length; results.figFound += out.figures.length
      c.figs.forEach((truth) => {
        // the found figure with best IoU
        const found = out.figures.map((f) => ({ f, v: iou(f.bbox, truth.bbox) })).sort((a, b) => b.v - a.v)[0]
        results.ious.push(found ? found.v : 0)
        if (found?.f.ambiguous) results.ambiguousWrongly += 1
        const got = new Set((found?.f.callouts || []).map((x) => x.index)); const want = new Set(truth.callouts.map((x) => x.index))
        results.tp += [...got].filter((v) => want.has(v)).length
        results.fp += [...got].filter((v) => !want.has(v)).length
        results.fn += [...want].filter((v) => !got.has(v)).length
      })
      // table association: the table lists the indexes of drawing k; engine must pick that drawing
      c.figs.forEach((truth, k) => {
        const tableIdx = truth.callouts.map((x) => x.index)
        const m = matchTableToFigure(tableIdx, out.figures.map((f) => f.callouts))
        results.assocTotal += 1
        const picked = out.figures[m.figure]
        if (picked && iou(picked.bbox, truth.bbox) > 0.8 && m.status === 'verified') results.assoc += 1
      })
    }
    const meanIou = results.ious.reduce((a, b) => a + b, 0) / results.ious.length
    const precision = results.tp / (results.tp + results.fp); const recall = results.tp / (results.tp + results.fn)
    console.log(`GEOMETRY ACCURACY pages=24 figures=${results.figTruth} found=${results.figFound} meanCropIoU=${meanIou.toFixed(3)} minIoU=${Math.min(...results.ious).toFixed(3)} calloutPrecision=${precision.toFixed(3)} calloutRecall=${recall.toFixed(3)} tableToFigure=${results.assoc}/${results.assocTotal} wronglyAmbiguous=${results.ambiguousWrongly}`)
    expect(results.figFound).toBe(results.figTruth)
    expect(meanIou).toBeGreaterThan(0.9)
    expect(precision).toBeGreaterThan(0.95)
    expect(recall).toBeGreaterThan(0.95)
    expect(results.assoc / results.assocTotal).toBeGreaterThan(0.95)
  }, 60000)

  it('reproduces the owner case: a table listing 17, 1, 2 against a drawing with callouts 1 and 2 is NOT verified', () => {
    const m = matchTableToFigure(['17', '1', '2'], [[{ index: '1' }, { index: '2' }]])
    expect(m.status).not.toBe('verified')
    expect(m.missing).toEqual(['17'])
  })

  it('flags two touching drawings as ambiguous instead of cutting them', async () => {
    const doc = new jsPDF({ unit: 'pt', format: [W, H] })
    const r = rng(99)
    drawFigure(doc, r, 60, 100, 230, 250, [1, 2]); drawFigure(doc, r, 292, 100, 230, 250, [3, 4])
    const out = await analyse(new Uint8Array(doc.output('arraybuffer')))
    expect(out.figures.length).toBe(1)
    expect(out.figures[0].ambiguous).toBe(true)
  })

  it('does not let a crop reach into a neighbouring drawing', async () => {
    const c = buildCase(1) // two side-by-side drawings, gutter 70pt
    const out = await analyse(c.buf)
    const [a, b] = out.figures
    expect(a.crop.x1).toBeLessThanOrEqual(b.bbox.x0)
    expect(b.crop.x0).toBeGreaterThanOrEqual(a.bbox.x1)
    for (const f of [a, b]) for (const c of f.callouts) expect(c.y + 8).toBeLessThanOrEqual(f.crop.y1)
  })
})

describe('noisy drawings (dimension numbers inside the art)', () => {
  it('raw callout precision drops, table reconciliation restores it', async () => {
    let tp = 0; let fp = 0; let fn = 0; let rtp = 0; let rfp = 0
    for (let seed = 1; seed <= 12; seed += 1) {
      const r = rng(seed * 7)
      const doc = new jsPDF({ unit: 'pt', format: [W, H] })
      const f1 = drawFigure(doc, r, 40, 120, 220, 300, [1, 2, 3, 4]); const f2 = drawFigure(doc, r, 330, 120, 220, 300, [5, 6, 7, 8])
      doc.setFontSize(9); ;[['45', 100, 250], ['120', 150, 300], ['300', 400, 250], ['75', 460, 330]].forEach(([t, x, y]) => doc.text(t, x, y))
      const out = await analyse(new Uint8Array(doc.output('arraybuffer')))
      ;[f1, f2].forEach((truth) => {
        const found = out.figures.map((f) => ({ f, v: iou(f.bbox, truth.bbox) })).sort((a, b) => b.v - a.v)[0].f
        const want = new Set(truth.callouts.map((x) => x.index)); const got = new Set(found.callouts.map((x) => x.index))
        tp += [...got].filter((v) => want.has(v)).length; fp += [...got].filter((v) => !want.has(v)).length; fn += [...want].filter((v) => !got.has(v)).length
        const rec = reconcileCallouts(found.callouts, [...want])
        rtp += rec.matched.filter((m) => want.has(m.index)).length; rfp += rec.matched.filter((m) => !want.has(m.index)).length
      })
    }
    console.log(`NOISY CALLOUTS rawPrecision=${(tp / (tp + fp)).toFixed(3)} rawRecall=${(tp / (tp + fn)).toFixed(3)} reconciledPrecision=${(rtp / (rtp + rfp)).toFixed(3)}`)
    expect(fp).toBeGreaterThan(0)
    expect(rfp).toBe(0)
    expect(tp / (tp + fn)).toBeGreaterThan(0.95)
  }, 60000)
})

describe('page facts', () => {
  it('reports rotation and landscape as the reader sees it', () => {
    expect(pageInfo({ view: [0, 0, 600, 800], rotate: 0 }).landscape).toBe(false)
    expect(pageInfo({ view: [0, 0, 600, 800], rotate: 90 })).toMatchObject({ landscape: true, displayWidth: 800 })
    expect(pageInfo({ view: [0, 0, 800, 600], rotate: 270 }).landscape).toBe(false)
  })
  it('finds headers and footers that repeat across pages', () => {
    const t = (str, y) => ({ str, x0: 10, x1: 50, y0: y, y1: y + 8 })
    const infos = [1, 2, 3, 4].map(() => ({ height: 800 }))
    const pages = [1, 2, 3, 4].map((n) => [t('SANY Parts Book', 780), t(`Page ${n}`, 12), t('Water tank', 400)])
    const rep = repeatedMargins(pages, infos)
    expect(rep.has('SANY Parts Book')).toBe(true)
    expect(rep.has('Page #')).toBe(true)
    expect(rep.has('Water tank')).toBe(false)
  })
  it('gives repeated figures the same signature', () => {
    const f = { caption: { figureNo: '2-14' }, bbox: { x0: 0, y0: 0, x1: 200, y1: 100 }, callouts: [{ index: '1' }, { index: '2' }] }
    expect(figureSignature(f)).toBe(figureSignature({ ...f, bbox: { x0: 5, y0: 5, x1: 205, y1: 105 } }))
  })
  it('textBoxes keeps only non-empty strings', () => {
    expect(textBoxes([{ str: ' ', transform: [1, 0, 0, 1, 0, 0] }, { str: '7', transform: [1, 0, 0, 1, 5, 6], width: 4, height: 9 }])).toHaveLength(1)
  })
})

describe('pipeline: tables paired with their own drawing', () => {
  const row = (page, printed, heading, idx, pn) => ({ source_pdf_page: page, row_order: Number(idx), assembly_heading: heading, printed_page: printed, index_no: String(idx), parent_index: null, part_no: pn, description: `Part ${pn}`, quantity: 1, illustration_pdf_page: 1 })
  it('pairs two tables with the two drawings and sends a mismatching table to review', async () => {
    const c = buildCase(1) // left drawing callouts 1-4, right drawing 5-8, one PDF page
    const geo = await analyse(c.buf)
    const rows = [
      ...[1, 2, 3, 4].map((i) => row(2, '3-1', 'Water Supply System', i, `6001000${i}`)),
      ...[5, 6, 7, 8].map((i) => row(3, '3-2', 'Mixing Drum Assembly', i, `6002000${i}`)),
      // owner's case: indexes 17, 1, 2 against a drawing that only has callouts 1 and 2 region
      ...[17, 1, 2].map((i, k) => ({ ...row(4, '3-3', 'Discharge Chute', i, `6003000${k}`), row_order: k + 1 })),
    ]
    const out = processExtraction({ rows, geometryByPage: { 1: geo } })
    const a = out.figures['F3-1'].geometry; const b = out.figures['F3-2'].geometry
    expect(a.status).toBe('verified'); expect(b.status).toBe('verified')
    expect(a.bbox.x0).toBeLessThan(b.bbox.x0)
    expect(out.figures['F3-3'].geometry.status).not.toBe('verified')
    expect(out.review.some((r) => r.figure_id === 'F3-3')).toBe(true)
    expect(out.publish.filter((r) => r.figure_id === 'F3-1')).toHaveLength(4)
    expect(out.summary.figuresVerified).toBe(2)
  })
})
