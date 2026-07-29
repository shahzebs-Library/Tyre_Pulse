/**
 * accidentCasePdf.js — the single pure renderer for a clean, white
 * "Accident Case Summary" PDF.
 *
 * WHAT IT DRAWS (one page, or more when the content overflows):
 *   1. A header band — company eyebrow, the "Accident Case Summary" title, and a
 *      reference + incident date + generated date line.
 *   2. A case snapshot block — Case status, Workflow stage, Severity tiles.
 *   3. A per-workstream completion table — Workstream, Owning team, Status, and the
 *      Completeness percentage of the workstream's dimension. A dimension with
 *      nothing in scope renders "Not in scope", NEVER a fabricated 0.
 *   4. A closure-level line.
 *
 * DESIGN CONTRACT (same discipline as accidentReportPdf.js):
 *   - Owns NO domain logic. Route detection, per-workstream status, the five
 *     completeness percentages and the closure level all come from the committed
 *     brain (accidentCase.js) and its view-model (caseCompletionView.js). This file
 *     only shapes their honest output onto paper.
 *   - Honest empty states. With no canonical workstreams to show it prints a
 *     "No workstream data recorded" note instead of an empty grid; a null
 *     completeness prints "Not in scope", never 0.
 *   - jsPDF is imported lazily (dynamic import) exactly as exportUtils does, so no
 *     page pays the bundle cost until an export actually runs.
 *   - No em/en dashes or curly quotes in any output string; blanks render "N/A".
 */
import {
  WORKSTREAMS,
  DIMENSION_OF,
  workstreamStatus,
  completeness,
  buildCaseRoute,
} from './accidentCase'
import { completionState, closureBadge } from './caseCompletionView'
import { reportFileName, reportDateLabel } from './exportUtils'

// ── tiny helpers ───────────────────────────────────────────────────────────────
const str = (v) => (v == null ? '' : String(v).trim())

/** Prettify an engine token ("not_required") into a label ("Not required").
 *  A blank value becomes "N/A" so a missing field never renders as an empty cell. */
function humanize(v) {
  const s = str(v).replace(/_/g, ' ')
  if (!s) return 'N/A'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A hyphen-free incident date label, tolerant of a bare string or an ISO date. */
function incidentDateLabel(v) {
  const s = str(v)
  if (!s) return 'N/A'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : reportDateLabel(d)
}

// ── palette (clean corporate light theme) ───────────────────────────────────────
const INK = [15, 23, 42]
const SLATE = [30, 41, 59]
const BODY = [51, 65, 85]
const MUTED = [100, 116, 139]
const FAINT = [148, 163, 184]
const LINE = [226, 232, 240]
const ZEBRA = [248, 250, 252]
const ACCENT = [79, 70, 229]

/**
 * Build (and by default save) the Accident Case Summary PDF.
 *
 * @param {object}   opts
 * @param {object}   opts.case         the accidents row for the case
 * @param {object[]} [opts.workstreams] explicit accident_case_workstreams rows (refine
 *                                      the derived per-workstream status where present)
 * @param {string}   [opts.company]    company name for the header/footer
 * @param {string}   [opts.filename]   file name without extension
 * @param {boolean}  [opts.save]       save() when true (default), else just return
 * @returns {Promise<{ doc: object, filename: string }>}
 */
export async function renderAccidentCasePdf({
  case: caseRecord,
  workstreams = [],
  company = 'TyrePulse',
  filename = null,
  save = true,
} = {}) {
  const record = caseRecord && typeof caseRecord === 'object' ? caseRecord : {}
  const wsRows = Array.isArray(workstreams) ? workstreams : []
  // Route drives which dimensions are in scope. Prefer an explicit route on the
  // record, else classify from the record's own attributes (never stalls).
  const route = record.route ?? record.route_key ?? buildCaseRoute(record)
  const dims = completeness(record, wsRows, route)

  const { default: JsPDF } = await import('jspdf')
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.width
  const PH = doc.internal.pageSize.height
  const MX = 14
  const stamp = reportDateLabel()
  let y = 16

  const ensure = (h, onBreak) => {
    if (y + h > PH - 14) {
      doc.addPage()
      y = 16
      if (typeof onBreak === 'function') onBreak()
    }
  }

  // ── 1. Header ─────────────────────────────────────────────────────────────────
  doc.setFillColor(...ACCENT)
  doc.rect(0, 0, PW, 2.4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  doc.text((str(company) || 'FLEET OPERATIONS').toUpperCase(), MX, y)
  y += 7
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...INK)
  doc.text('Accident Case Summary', MX, y)
  y += 7
  const ref = str(record.reference_no) || str(record.case_no) || str(record.id) || 'N/A'
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...BODY)
  doc.text(
    `Reference ${ref}  |  Incident ${incidentDateLabel(record.incident_date)}  |  Generated ${stamp}`,
    MX,
    y,
  )
  y += 5
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.4)
  doc.line(MX, y, PW - MX, y)
  y += 8

  // ── 2. Case snapshot tiles ───────────────────────────────────────────────────
  const tiles = [
    { label: 'Case status', value: humanize(record.case_status || record.status) },
    { label: 'Workflow stage', value: humanize(record.workflow_stage) },
    { label: 'Severity', value: humanize(record.severity) },
  ]
  const tileGap = 4
  const tileW = (PW - MX * 2 - tileGap * (tiles.length - 1)) / tiles.length
  const tileH = 18
  ensure(tileH + 6)
  tiles.forEach((t, i) => {
    const x = MX + i * (tileW + tileGap)
    doc.setFillColor(...ZEBRA)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, y, tileW, tileH, 1.5, 1.5, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...MUTED)
    doc.text(t.label.toUpperCase(), x + 4, y + 6)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(t.value, tileW - 8)[0], x + 4, y + 13)
  })
  y += tileH + 10

  // ── 3. Workstream completion table ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  doc.setTextColor(...INK)
  doc.text('Workstream completion', MX, y)
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.8)
  doc.line(MX, y + 2.4, MX + 18, y + 2.4)
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.25)
  doc.line(MX + 18, y + 2.4, PW - MX, y + 2.4)
  y += 8

  // One row per canonical workstream. Status is the engine's derived (or explicit)
  // status; Completeness is the workstream's dimension percentage — "Not in scope"
  // (never 0) when that dimension has nothing required for this route.
  const rows = WORKSTREAMS.map((w) => {
    const status = workstreamStatus(record, w.key, wsRows)
    const pct = dims[DIMENSION_OF[w.key]]
    const state = completionState(pct)
    return {
      name: w.name,
      team: w.team,
      status: humanize(status),
      // inScope: a real percentage; otherwise the honest "Not in scope" token.
      completeness: state.inScope ? `${pct}%` : state.status,
    }
  })

  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...FAINT)
    doc.text('No workstream data recorded for this case.', MX, y + 4)
    y += 10
  } else {
    const cols = [
      { key: 'name', header: 'Workstream', w: 60 },
      { key: 'team', header: 'Owning team', w: 56 },
      { key: 'status', header: 'Status', w: 36 },
      { key: 'completeness', header: 'Completeness', w: 30 },
    ]
    const rowH = 8
    const drawHeader = () => {
      doc.setFillColor(...SLATE)
      doc.rect(MX, y, PW - MX * 2, rowH, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(255, 255, 255)
      let cx = MX + 3
      cols.forEach((c) => {
        doc.text(c.header, cx, y + rowH * 0.65)
        cx += c.w
      })
      y += rowH
    }
    drawHeader()
    rows.forEach((r, i) => {
      ensure(rowH, drawHeader)
      if (i % 2 === 1) {
        doc.setFillColor(...ZEBRA)
        doc.rect(MX, y, PW - MX * 2, rowH, 'F')
      }
      let cx = MX + 3
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...BODY)
      cols.forEach((c) => {
        const val = String(r[c.key] ?? '')
        doc.text(doc.splitTextToSize(val, c.w - 3)[0], cx, y + rowH * 0.65)
        cx += c.w
      })
      y += rowH
    })
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.25)
    doc.line(MX, y, PW - MX, y)
    y += 8
  }

  // ── 4. Closure level ─────────────────────────────────────────────────────────
  const badge = closureBadge({ record, workstreams: wsRows, route })
  ensure(12)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK)
  doc.text(`Closure level: ${badge.label}`, MX, y + 4)
  y += 8

  // ── Footer page numbers ──────────────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...FAINT)
    doc.text(`${str(company) || 'TyrePulse'}  |  Accident Case Summary`, MX, PH - 8)
    doc.text(`Page ${p} / ${pages}`, PW - MX, PH - 8, { align: 'right' })
  }

  const base = filename
    ? reportFileName(filename)
    : reportFileName('TyrePulse Accident Case Summary', ref === 'N/A' ? '' : ref, stamp)
  const fname = `${base}.pdf`
  if (save) doc.save(fname)
  return { doc, filename: fname }
}
