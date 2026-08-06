/**
 * PDF exports broke app-wide and NOTHING caught it: the build was clean, lint
 * was clean, and 6,500 tests were green, because every PDF test mocks jspdf.
 * The real failure only appeared when a user clicked Download.
 *
 * Root cause: jspdf-autotable@3.8.4 declares peer jsPDF ^2.5.1 while the app
 * runs jsPDF 4.2.1, and under that pairing the package's ESM `default` export
 * is an OBJECT - so `autoTable(doc, opts)` threw "autoTable is not a function"
 * on inspections, job cards, reports and ~24 other surfaces.
 *
 * These tests use the REAL libraries (no mocks) so the contract is verified
 * against whatever versions are actually installed.
 */
import { describe, it, expect } from 'vitest'
import { loadAutoTable, loadPdf } from '../lib/pdfEngine'

describe('pdfEngine - real libraries, no mocks', () => {
  it('always resolves autoTable to something CALLABLE', async () => {
    // The exact assertion that would have caught the outage: the raw
    // `(await import('jspdf-autotable')).default` is not callable here.
    const autoTable = await loadAutoTable()
    expect(typeof autoTable).toBe('function')
  })

  it('actually renders a table into a real PDF', async () => {
    const { jsPDF, autoTable } = await loadPdf()
    expect(typeof jsPDF).toBe('function')

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    autoTable(doc, {
      head: [['Asset', 'Site', 'Result']],
      body: [['TM001', 'NHC', 'Pass'], ['TM002', 'JED', 'Fail']],
      startY: 20,
    })

    // finalY is what nearly every caller reads to stack the next section;
    // a stub that "works" but never draws would fail here.
    expect(doc.lastAutoTable).toBeTruthy()
    expect(doc.lastAutoTable.finalY).toBeGreaterThan(20)

    const bytes = doc.output('arraybuffer')
    expect(bytes.byteLength).toBeGreaterThan(1000)
  })

  it('reuses one resolved engine rather than re-importing per export', async () => {
    expect(await loadAutoTable()).toBe(await loadAutoTable())
  })
})
