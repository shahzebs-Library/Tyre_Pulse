// Real jsPDF + autotable (no mocks): proves the evidence pack table fits the page and that no
// control id or evidence id is split across lines.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CONTROLS, PDF_MARGIN_MM, PDF_PRINTABLE_MM, PDF_CONTROL_WIDTHS, PDF_ATTESTATION_WIDTHS, pdfEvidenceCell,
} from '../lib/complianceControls'
import { loadPdf } from '../lib/pdfEngine'

const PADDING_MM = 1.5

describe('compliance evidence pack PDF layout', () => {
  it('column widths add up to exactly the printable width', () => {
    const sum = (a) => a.reduce((s, n) => s + n, 0)
    expect(PDF_PRINTABLE_MM).toBe(297 - 2 * PDF_MARGIN_MM)
    expect(sum(PDF_CONTROL_WIDTHS)).toBe(PDF_PRINTABLE_MM)
    expect(sum(PDF_ATTESTATION_WIDTHS)).toBe(PDF_PRINTABLE_MM)
  })

  it('every control id fits on one line of the Control column', async () => {
    const { jsPDF } = await loadPdf()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    doc.setFontSize(7)
    const room = PDF_CONTROL_WIDTHS[0] - 2 * PADDING_MM
    for (const c of CONTROLS) expect(doc.getTextWidth(c.id), c.id).toBeLessThanOrEqual(room)
  })

  it('evidence cell puts one source per line and shortens uuids', () => {
    expect(pdfEvidenceCell('backups.snapshots: 0b7eef2f-538e-499d-940e-d2ec5291e5ad; system_config: backup_enabled'))
      .toBe('backups.snapshots: 0b7eef2f\nsystem_config: backup_enabled')
    expect(pdfEvidenceCell('N/A')).toBe('N/A')
    expect(pdfEvidenceCell('')).toBe('N/A')
  })

  it('no evidence word is wider than the Evidence column (no mid-word breaks)', async () => {
    const { jsPDF } = await loadPdf()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    doc.setFontSize(7)
    const room = PDF_CONTROL_WIDTHS[7] - 2 * PADDING_MM
    const src = readFileSync(resolve(__dirname, '../lib/complianceControls.js'), 'utf8')
    const refs = [...src.matchAll(/'([a-z_.]+: [a-z_=${}]+)'/gi)].map((m) => m[1])
    refs.push('admin_security_posture: anon_definer_functions', 'admin_security_posture: definer_search_path',
      'backups.snapshots: 0b7eef2f-538e-499d-940e-d2ec5291e5ad', 'security_scan_runs: 3601c73c-5293-460a-9715-5917ed12d81e')
    expect(refs.length).toBeGreaterThan(5)
    for (const line of pdfEvidenceCell(refs.join('; ')).split('\n')) {
      for (const word of line.split(' ')) expect(doc.getTextWidth(word), word).toBeLessThanOrEqual(room)
    }
  })

  it('a rendered table stays inside the page margins', async () => {
    const { jsPDF, autoTable } = await loadPdf()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    autoTable(doc, {
      head: [['Control', 'Domain', 'SOC 2', 'ISO 27001', 'Title', 'Status', 'Detail', 'Evidence']],
      body: CONTROLS.map((c) => [c.id, c.domain, 'CC6.1, CC6.6', 'A.8.3, A.8.20', c.title, 'Needs attestation',
        'x '.repeat(80), pdfEvidenceCell('admin_security_posture: anon_table_grants; admin_security_posture: anon_definer_functions')]),
      styles: { fontSize: 7, cellPadding: PADDING_MM, overflow: 'linebreak', valign: 'top' },
      columnStyles: Object.fromEntries(PDF_CONTROL_WIDTHS.map((w, i) => [i, { cellWidth: w }])),
      tableWidth: PDF_PRINTABLE_MM,
      rowPageBreak: 'avoid',
      margin: { left: PDF_MARGIN_MM, right: PDF_MARGIN_MM, bottom: 14 },
    })
    const t = doc.lastAutoTable
    const width = t.columns.reduce((s, col) => s + col.width, 0)
    expect(Math.abs(width - PDF_PRINTABLE_MM)).toBeLessThan(0.01)
    expect(t.settings.margin.left).toBe(PDF_MARGIN_MM)
    expect(t.settings.margin.left + width).toBeLessThanOrEqual(297 - PDF_MARGIN_MM + 0.01)
  })
})
