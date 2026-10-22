// AI damage report: findings segregated by supervisor decision, with the original photo.
// Pure row building (testable) + Excel / PDF writers. Reuses the shared export engine.
import { resolveStorageUrlMap } from './storageRefs'

export const DECISIONS = [
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'corrected', label: 'Corrected' },
  { key: 'unreviewed', label: 'Awaiting review' },
]

export function decisionOf(job) {
  const s = String(job?.review_status || 'unreviewed').toLowerCase()
  return DECISIONS.some(d => d.key === s) ? s : 'unreviewed'
}

const defectText = (job) => (job?.analysis?.defects || [])
  .map(d => [d.type, d.description, d.visibleEvidence].filter(Boolean).join(': ')).join(' | ')
const severityText = (job) => [...new Set((job?.analysis?.defects || []).map(d => d.severity).filter(Boolean))].join('; ')

/** One row per completed AI job that reports at least one defect (clean photos are not damage). */
export function buildDamageRows(inspections, jobsByInspection, positionLabel = (_i, p) => p) {
  const rows = []
  for (const insp of inspections || []) {
    for (const job of (jobsByInspection?.[insp.id] || [])) {
      if (job.status !== 'completed') continue
      const finding = defectText(job)
      if (!finding) continue
      rows.push({
        decision: decisionOf(job),
        date: insp.inspection_date || '',
        vehicle: insp.asset_no || '',
        site: insp.site || '',
        position: positionLabel(insp, job.tyre_position),
        finding,
        severity: severityText(job),
        reviewer_note: job.reviewer_note || '',
        reviewed_at: job.reviewed_at ? String(job.reviewed_at).slice(0, 10) : '',
        photo_ref: job.photo_ref || '',
        inspection_id: insp.id,
      })
    }
  }
  return rows
}

export function groupByDecision(rows) {
  const out = Object.fromEntries(DECISIONS.map(d => [d.key, []]))
  rows.forEach(r => out[r.decision].push(r))
  return out
}

export const DAMAGE_COLUMNS = [
  ['date', 'Inspection date'], ['vehicle', 'Vehicle'], ['site', 'Site'], ['position', 'Tyre position'],
  ['finding', 'AI finding'], ['severity', 'Severity'], ['reviewer_note', 'Reviewer note'],
  ['reviewed_at', 'Reviewed on'], ['photo_link', 'Photo link (expires)'],
]

/**
 * Resolve signed photo URLs once per distinct ref.
 * Default: batched createSignedUrls (one request per bucket per 100 photos, no N+1).
 * A custom per-ref `resolve` is still honoured (bounded concurrency) for tests/other storage.
 */
export async function attachPhotoLinks(rows, resolve, concurrency = 6) {
  const refs = [...new Set(rows.map(r => r.photo_ref).filter(Boolean))]
  let urls = {}
  if (typeof resolve === 'function') {
    let i = 0
    await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, async () => {
      while (i < refs.length) {
        const ref = refs[i++]
        try { urls[ref] = await resolve(ref) } catch { urls[ref] = null }
      }
    }))
  } else {
    try { urls = await resolveStorageUrlMap(refs) } catch { urls = {} }
  }
  return rows.map(r => ({ ...r, photo_url: urls[r.photo_ref] || '', photo_link: urls[r.photo_ref] || 'Not available' }))
}

export async function exportDamageExcel(rows, { title = 'AI damage report', dateRange = '' } = {}) {
  const { exportSheetsToExcel, reportFileName, reportDateLabel } = await import('./exportUtils')
  const withLinks = await attachPhotoLinks(rows)
  const groups = groupByDecision(withLinks)
  const cols = DAMAGE_COLUMNS.map(([k]) => k), heads = DAMAGE_COLUMNS.map(([, h]) => h)
  const summary = DECISIONS.map(d => ({ decision: d.label, findings: groups[d.key].length }))
  const sheets = [
    { name: 'Summary', rows: summary, columns: ['decision', 'findings'], headers: ['Supervisor decision', 'Findings'] },
    ...DECISIONS.map(d => ({
      name: d.label, rows: groups[d.key], columns: cols, headers: heads,
      emptyNote: `No ${d.label.toLowerCase()} findings for this selection.`,
    })),
  ]
  return exportSheetsToExcel(sheets, reportFileName('AI damage report', reportDateLabel()), {
    title, dateRange,
    notes: ['Findings are AI observations; only Accepted ones were confirmed by a supervisor.',
      'Photo links are temporary signed links and stop working after they expire.'],
  })
}

async function toThumb(url, max = 360) {
  if (!url) return null
  try {
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    return { data: c.toDataURL('image/jpeg', 0.7), w: c.width, h: c.height }
  } catch { return null }
}

export const PDF_PHOTO_LIMIT = 150

export async function exportDamagePdf(rows, { title = 'AI damage report', dateRange = '' } = {}) {
  const { loadPdf } = await import('./pdfEngine')
  const { reportFileName, reportDateLabel } = await import('./exportUtils')
  const { jsPDF, autoTable } = await loadPdf()
  const withLinks = await attachPhotoLinks(rows)
  const groups = groupByDecision(withLinks)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const PH = doc.internal.pageSize.height
  doc.setFontSize(16); doc.text(title, 14, 16)
  doc.setFontSize(9); doc.setTextColor(90)
  doc.text(`${dateRange ? dateRange + '  |  ' : ''}Generated ${new Date().toISOString().slice(0, 10)}`, 14, 22)
  autoTable(doc, {
    startY: 27, head: [['Supervisor decision', 'Findings']],
    body: DECISIONS.map(d => [d.label, groups[d.key].length]), theme: 'grid',
    styles: { fontSize: 9 }, headStyles: { fillColor: [55, 65, 81] }, tableWidth: 90,
  })
  let photos = 0
  for (const d of DECISIONS) {
    doc.addPage()
    doc.setTextColor(0); doc.setFontSize(13); doc.text(`${d.label} (${groups[d.key].length})`, 14, 14)
    const list = groups[d.key]
    if (!list.length) { doc.setFontSize(10); doc.text('No findings in this group.', 14, 24); continue }
    const thumbs = []
    for (const r of list) thumbs.push(photos++ < PDF_PHOTO_LIMIT ? await toThumb(r.photo_url) : null)
    autoTable(doc, {
      startY: 19, theme: 'grid', styles: { fontSize: 8, minCellHeight: 24, valign: 'middle' },
      headStyles: { fillColor: [55, 65, 81], minCellHeight: 8 },
      head: [['Photo', 'Date', 'Vehicle', 'Site', 'Position', 'AI finding', 'Severity', 'Reviewer note']],
      body: list.map(r => ['', r.date, r.vehicle, r.site, r.position, r.finding, r.severity, r.reviewer_note]),
      columnStyles: { 0: { cellWidth: 34 }, 5: { cellWidth: 80 } },
      didDrawCell: (h) => {
        const t = h.section === 'body' && h.column.index === 0 ? thumbs[h.row.index] : null
        if (!t) return
        const k = Math.min(30 / t.w, 22 / t.h)
        doc.addImage(t.data, 'JPEG', h.cell.x + 2, h.cell.y + 1, t.w * k, t.h * k)
      },
    })
  }
  if (photos > PDF_PHOTO_LIMIT) {
    doc.setPage(doc.getNumberOfPages()); doc.setFontSize(8)
    doc.text(`Photos embedded for the first ${PDF_PHOTO_LIMIT} findings only; the Excel report links all photos.`, 14, PH - 8)
  }
  doc.save(`${reportFileName('AI damage report', reportDateLabel())}.pdf`)
  return true
}
