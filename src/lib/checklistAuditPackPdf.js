/**
 * Audit pack PDF: cover summary, findings, controlled form register, record
 * register, faults and corrective actions. Same brand and table theme as the
 * checklist sheets so the pack reads as one document set.
 */
import { loadPdf } from './pdfEngine'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme, PDF_COLORS, reportFileName } from './exportUtils'
import { FINDING_COLS, FORM_COLS, RECORD_COLS, FAULT_COLS, summaryRows } from './checklistAuditPack'

async function brandFor(branding) {
  let b = branding
  if (!b?.logo_url) {
    try {
      const { getCompanyLogo } = await import('./api/brandLogo')
      const logo = await getCompanyLogo()
      if (logo) b = { ...(branding || {}), logo_url: logo }
    } catch { /* a missing logo must never cost the pack */ }
  }
  const brand = await resolvePdfBrand(b)
  if (!branding?.primary_color) brand.accent = PDF_COLORS.green
  return brand
}

const cell = (v) => (v == null || v === '' ? '-' : String(v))

export async function renderAuditPackPdf(pack, { company = '', branding = null, save = true } = {}) {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const brand = await brandFor(branding)
  const theme = pdfTableTheme(brand.accent, { headFill: PDF_COLORS.green })
  const s = pack.summary
  const title = `Checklist Audit Pack - ${s.audit_type}`
  const header = () => pdfHeader(doc, title, `${s.period} | ${s.site}`, company, brand, { logoSize: 18, hideEyebrow: true })

  const section = (heading, cols, rows, opts = {}) => {
    doc.addPage()
    header()
    doc.setFontSize(12); doc.setTextColor(30, 41, 59)
    doc.text(heading, 14, 32)
    if (opts.note) { doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text(opts.note, 14, 37) }
    autoTable(doc, {
      ...theme,
      startY: opts.note ? 40 : 36,
      head: [cols.map(([, h]) => h)],
      body: rows.length ? rows.map((r) => cols.map(([k]) => cell(r[k]))) : [[{ content: opts.empty || 'Nothing to report.', colSpan: cols.length }]],
      styles: { ...(theme.styles || {}), fontSize: 7, cellPadding: 1.6, overflow: 'linebreak' },
      margin: { top: 30, left: 14, right: 14 },
      didDrawPage: () => header(),
    })
  }

  // Cover
  header()
  doc.setFontSize(12); doc.setTextColor(30, 41, 59)
  doc.text('Summary', 14, 32)
  autoTable(doc, {
    ...theme,
    startY: 36,
    head: [['Item', 'Value']],
    body: summaryRows(s).map(([k, v]) => [k, cell(v)]),
    styles: { ...(theme.styles || {}), fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: 80, fontStyle: 'bold' } },
    margin: { left: 14, right: 14 },
  })

  section('Findings', FINDING_COLS, pack.findings, { empty: 'No findings: every check passed.' })
  section('Controlled form register (ISO 7.5)', FORM_COLS, pack.forms)
  section('Record register', RECORD_COLS, pack.records, {
    note: 'Each record keeps its document number, the exact form version it was filled on, its signatures and its sign-off.',
    empty: 'No records in this period.',
  })
  section('Faults and corrective actions (ISO 10.2)', FAULT_COLS, pack.faults, { empty: 'No faults recorded in this period.' })

  const total = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total; p++) { doc.setPage(p); pdfFooter(doc, p, total, company, brand) }
  if (save) doc.save(`${reportFileName('Checklist Audit Pack', s.audit_type, s.generated)}.pdf`)
  return doc
}
