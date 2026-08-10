/**
 * tyreLifeReportPdf - branded A4 landscape PDF for the "Running & Remaining"
 * tyre-life view. Pure renderer: shaped rows + summary in, jsPDF document out.
 *
 * Rules: PDF engine ONLY via loadPdf()/loadAutoTable() from ./pdfEngine (never
 * a direct jspdf-autotable import); ASCII only; every missing value renders
 * 'N/A' - nothing is fabricated. Muted corporate palette: dark ink, grays, one
 * accent; status is conveyed by text plus a small dot, never a loud fill.
 */
import { loadPdf } from './pdfEngine'
import {
  bandFor, BAND_META, basisLabel, fmtNum, lifeDisplay, actionRows,
} from './tyreRunningLife'

// Muted corporate palette (RGB triplets).
const INK = [31, 41, 55]        // near-black text
const GRAY = [107, 114, 128]    // secondary text
const LIGHT = [243, 244, 246]   // tile / header fill
const ZEBRA = [249, 250, 251]   // alternate row fill
const LINE = [229, 231, 235]    // hairlines
const ACCENT = [15, 118, 110]   // single accent (deep teal)

// Small status dots - dark, restrained hues.
const DOT = {
  overdue: [153, 27, 27],
  'due-soon': [180, 83, 9],
  'mid-life': [71, 85, 105],
  healthy: [21, 128, 61],
  unknown: [148, 163, 184],
}

const usedPctText = (r) => {
  const p = r.lifeUsedPct != null ? r.lifeUsedPct : r.hoursUsedPct
  return p == null ? 'N/A' : `${Math.round(p)}%`
}

/**
 * Render (and by default save) the report.
 * @param {object} opts
 * @param {Array}  opts.rows     shaped rows (already filtered to match the screen)
 * @param {object} opts.summary  summarize(rows) result
 * @param {string} opts.country  active country ('All' = all countries)
 * @param {string} opts.company  company name for the title block
 * @param {string} opts.filters  plain-English active-filter description
 * @param {string} [opts.filename]
 * @param {boolean} [opts.save=true]  set false in tests to get the doc back unsaved
 * @returns {Promise<object>} the jsPDF document
 */
export async function renderTyreLifeReportPdf({
  rows = [], summary = {}, country = '', company = '', filters = '',
  filename, save = true,
} = {}) {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const M = 12

  // ── Title block ────────────────────────────────────────────────────────────
  doc.setTextColor(...INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Tyre Life - Running & Remaining', M, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  const metaBits = []
  if (company) metaBits.push(String(company))
  if (country) metaBits.push(country === 'All' ? 'All countries' : String(country))
  metaBits.push(`Generated ${new Date().toISOString().slice(0, 10)}`)
  doc.text(metaBits.join('   |   '), M, 22)
  doc.text(`Filters: ${filters || 'All active tyres'}`, M, 27)
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.8)
  doc.line(M, 30, pageW - M, 30)

  // ── Summary tiles (text, not charts) ───────────────────────────────────────
  const tiles = [
    ['Active tyres', fmtNum(summary.total)],
    ['Measured vs km', fmtNum(summary.measurableKm)],
    ['Measured vs hours', fmtNum(summary.measurableHours)],
    ['Past expected life', fmtNum(summary.overdue)],
    ['Due soon', fmtNum(summary.dueSoon)],
    ['Avg life used', summary.avgUsedPct == null ? 'N/A' : `${summary.avgUsedPct}%`],
  ]
  const gap = 4
  const tileW = (pageW - 2 * M - (tiles.length - 1) * gap) / tiles.length
  const tileY = 34
  let x = M
  for (const [label, value] of tiles) {
    doc.setFillColor(...LIGHT)
    doc.roundedRect(x, tileY, tileW, 16, 1.5, 1.5, 'F')
    doc.setTextColor(...INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(String(value), x + 3, tileY + 7)
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(label, x + 3, tileY + 12.5)
    x += tileW + gap
  }

  // Shared table styling.
  const baseStyles = {
    font: 'helvetica', fontSize: 7, textColor: INK,
    lineColor: LINE, lineWidth: 0.15, cellPadding: 1.6,
  }
  const headStyles = {
    fillColor: LIGHT, textColor: INK, fontStyle: 'bold', fontSize: 7,
    lineColor: LINE, lineWidth: 0.15,
  }

  // ── Action needed (overdue + due-soon first) ───────────────────────────────
  let cursorY = tileY + 24
  doc.setTextColor(...INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Action needed', M, cursorY)
  const action = actionRows(rows)
  if (!action.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GRAY)
    doc.text('No tyres are past their expected life or due soon in this view.', M, cursorY + 6)
    cursorY += 14
  } else {
    autoTable(doc, {
      startY: cursorY + 2,
      margin: { left: M, right: M },
      showHead: 'everyPage',
      head: [['State', 'Serial', 'Asset', 'Pos', 'Vehicle type', 'Site', 'Expected life', 'Remaining', 'Life used']],
      body: action.map((r) => [
        BAND_META[bandFor(r)].label,
        r.serial || 'N/A',
        r.asset || 'N/A',
        r.position || 'N/A',
        r.vehicleType || 'N/A',
        r.site || 'N/A',
        lifeDisplay(r.expectedLifeKm, r.expectedLifeHours),
        lifeDisplay(r.remainingKm, r.remainingHours),
        usedPctText(r),
      ]),
      styles: baseStyles,
      headStyles,
      alternateRowStyles: { fillColor: ZEBRA },
      columnStyles: {
        0: { cellPadding: { top: 1.6, bottom: 1.6, left: 5.5, right: 1.6 } },
        6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
      },
      didDrawCell: (d) => {
        if (d.section === 'body' && d.column.index === 0) {
          const r = action[d.row.index]
          if (!r) return
          const c = DOT[bandFor(r)] || DOT.unknown
          doc.setFillColor(c[0], c[1], c[2])
          doc.circle(d.cell.x + 2.8, d.cell.y + d.cell.height / 2, 1.1, 'F')
        }
      },
    })
    cursorY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : cursorY) + 10
  }

  // ── Full filtered table ────────────────────────────────────────────────────
  if (cursorY > pageH - 40) {
    doc.addPage()
    cursorY = 16
  }
  doc.setTextColor(...INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(`All tyres in this view (${rows.length})`, M, cursorY)
  autoTable(doc, {
    startY: cursorY + 2,
    margin: { left: M, right: M },
    showHead: 'everyPage',
    head: [[
      'Serial', 'Asset', 'Brand', 'Pos', 'Type', 'Site', 'Size', 'Days on',
      'Km run', 'Hours run', 'Expected life', 'Remaining', 'Rem. days', 'Used', 'Basis',
    ]],
    body: rows.map((r) => [
      r.serial || 'N/A',
      r.asset || 'N/A',
      r.brand || 'N/A',
      r.position || 'N/A',
      r.vehicleType || 'N/A',
      r.site || 'N/A',
      r.size || 'N/A',
      fmtNum(r.daysOn),
      fmtNum(r.kmRun),
      fmtNum(r.hoursRun),
      lifeDisplay(r.expectedLifeKm, r.expectedLifeHours),
      lifeDisplay(r.remainingKm, r.remainingHours),
      fmtNum(r.remainingDays),
      usedPctText(r),
      basisLabel(r),
    ]),
    styles: { ...baseStyles, fontSize: 6.5, cellPadding: 1.4 },
    headStyles: { ...headStyles, fontSize: 6.5 },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: {
      7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' },
      10: { halign: 'right' }, 11: { halign: 'right' }, 12: { halign: 'right' },
      13: { halign: 'right' },
    },
  })

  // ── Footer on every page ───────────────────────────────────────────────────
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text(
      'Remaining figures are a guide from measured fleet life or set targets, not a promise. N/A = no meter reading or baseline.',
      M, pageH - 7,
    )
    doc.text(`Page ${p} of ${pages}`, pageW - M, pageH - 7, { align: 'right' })
  }

  if (save) {
    const name = filename || `Tyre Life Report ${new Date().toISOString().slice(0, 10)}.pdf`
    doc.save(name)
  }
  return doc
}
