/**
 * accidentCasePdf renderer tests. jsPDF is MOCKED with a recording double (a
 * lightweight canvas of no-op drawing primitives that captures every text() call),
 * so we exercise the block -> document mapping without paying a real render and can
 * assert on exactly what lands on the page. We check: a full case builds without
 * throwing; an empty-workstream case builds without throwing; a null (out of scope)
 * completeness renders "Not in scope" and NEVER a fabricated 0; and the download
 * filename is dash-free (via reportFileName).
 */
import { describe, it, expect, vi } from 'vitest'

// ── jsPDF recording double ───────────────────────────────────────────────────
// The real jsPDF save() creates a Blob + triggers a browser download jsdom cannot
// do, and we want to read back the exact text drawn, so we record every text()
// value and no-op every other primitive the renderer uses.
class MockDoc {
  constructor() {
    this.texts = []
    this._pages = 1
    this.saved = null
    this.internal = {
      pageSize: { width: 210, height: 297 },
      getNumberOfPages: () => this._pages,
    }
  }
  setFont() { return this }
  setFontSize() { return this }
  setTextColor() { return this }
  setFillColor() { return this }
  setDrawColor() { return this }
  setLineWidth() { return this }
  rect() { return this }
  roundedRect() { return this }
  line() { return this }
  text(t) { this.texts.push(String(t)); return this }
  splitTextToSize(t) { return [String(t)] }
  addPage() { this._pages += 1; return this }
  setPage() { return this }
  save(name) { this.saved = name; return this }
}
vi.mock('jspdf', () => ({ default: MockDoc, jsPDF: MockDoc }))

import { renderAccidentCasePdf } from '../lib/accidentCasePdf'

// A standard-route case (no total loss / no injury / no insurer / no claim), so the
// Insurance dimension has nothing required and reads "Not in scope".
const FULL_CASE = {
  id: 'a1',
  reference_no: 'ACC-2026-0001',
  incident_date: '2026-05-02',
  severity: 'Moderate',
  status: 'reported',
  workflow_stage: 'reported',
  case_status: 'under_fleet_validation',
  repair_type: 'internal',
  repair_cost: 4200,
}

describe('renderAccidentCasePdf', () => {
  it('is an async exported function', () => {
    expect(typeof renderAccidentCasePdf).toBe('function')
    expect(renderAccidentCasePdf.constructor.name).toBe('AsyncFunction')
  })

  it('builds a document from a full case without throwing', async () => {
    const res = await renderAccidentCasePdf({
      case: FULL_CASE,
      workstreams: [{ workstream: 'repair', status: 'completed' }],
      company: 'Acme Fleet',
      save: false,
    })
    expect(res.doc).toBeInstanceOf(MockDoc)
    expect(res.doc.texts.length).toBeGreaterThan(0)
    // Header + table + closure are present on the page.
    expect(res.doc.texts).toContain('Accident Case Summary')
    expect(res.doc.texts).toContain('Workstream completion')
    expect(res.doc.texts.some((t) => t.startsWith('Closure level:'))).toBe(true)
    // save:false leaves the file unsaved.
    expect(res.doc.saved).toBeNull()
  })

  it('builds without throwing for an empty-workstream case', async () => {
    const res = await renderAccidentCasePdf({ case: FULL_CASE, workstreams: [], save: false })
    expect(res.doc).toBeInstanceOf(MockDoc)
    expect(res.doc.texts.length).toBeGreaterThan(0)
  })

  it('tolerates a bare / missing case record', async () => {
    await expect(renderAccidentCasePdf({ case: {}, save: false })).resolves.toBeDefined()
    await expect(renderAccidentCasePdf({ save: false })).resolves.toBeDefined()
  })

  it('renders a null (out of scope) completeness as "Not in scope", never 0', async () => {
    // Complete every in-scope standard-route workstream so the only completeness
    // cells are "100%" (in scope) and "Not in scope" (Insurance, out of scope) —
    // proving a null dimension is NEVER fabricated into a 0 / 0% cell.
    const done = [
      'incident_evidence', 'fleet_validation', 'liability',
      'assessment', 'repair', 'workshop_qc', 'handover', 'finance',
    ].map((k) => ({ workstream: k, status: 'completed' }))
    const res = await renderAccidentCasePdf({ case: FULL_CASE, workstreams: done, save: false })
    const texts = res.doc.texts
    // The Insurance dimension has nothing required on the standard route -> null.
    expect(texts).toContain('Not in scope')
    // A null completeness must never be fabricated into a bare zero cell.
    expect(texts).not.toContain('0')
    expect(texts).not.toContain('0%')
  })

  it('produces a clean, dash-free .pdf filename via reportFileName', async () => {
    const res = await renderAccidentCasePdf({ case: FULL_CASE, save: false })
    // reportFileName guarantees ASCII, no underscores/hyphens/en/em dashes.
    expect(res.filename).toMatch(/^[A-Za-z0-9 ()]+\.pdf$/)
    expect(res.filename).not.toMatch(/[_\-–—→]/)
  })

  it('saves the file when save is true (default)', async () => {
    const res = await renderAccidentCasePdf({ case: FULL_CASE })
    expect(res.doc.saved).toBe(res.filename)
  })
})
