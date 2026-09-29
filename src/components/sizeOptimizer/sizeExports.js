/**
 * Size Optimizer exports. Same PDF and Excel the page always produced (size
 * distribution, size x brand matrix, position compliance, consolidation),
 * plus the per-asset recommendations. Each throws on failure; the page shows
 * the sanitised message.
 */
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../../lib/exportUtils'
import { loadAutoTable } from '../../lib/pdfEngine'
import { normalizePosition } from '../../lib/tyrePositions'
import {
  sizeMetrics as buildSizeMetrics, bySizeCount, sizeKpis, sizeBrandMatrix,
  positionCompliance, consolidationOps as buildConsolidationOps,
} from '../../lib/tyreSizeAnalytics'
import { fmtKm, fmtPct, fmtMoney, opDesc } from './sizeFormat'

function analyses(filtered, label) {
  const metrics = buildSizeMetrics(filtered, label)
  const sorted = bySizeCount(metrics)
  const kpis = sizeKpis(filtered, metrics)
  return {
    sorted,
    kpis,
    matrix: sizeBrandMatrix(filtered, metrics, label),
    pos: positionCompliance(filtered, label, normalizePosition),
    ops: buildConsolidationOps(filtered, metrics, label, kpis.fleetAvgCpk),
  }
}

export async function exportSizePdf({ filtered, label, currency, company, branding, fileBase, recommendations = [] }) {
  const { sorted, kpis, ops } = analyses(filtered, label)
  const { default: jsPDF } = await import('jspdf')
  const autoTable = await loadAutoTable()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const brand = await resolvePdfBrand(branding)
  const filename = `${fileBase}.pdf`
  pdfHeader(doc, 'Size Optimizer', `Fleet: ${kpis.total} tyres, ${kpis.uniqueSz} unique sizes`, company, brand)
  if (sorted.length === 0) {
    pdfEmptyState(doc, 'No tyre size records for the selected filters', 'Adjust the date range, country or brand filter and export again.')
    pdfFooter(doc, 1, 1, company, brand)
    doc.save(filename)
    return
  }
  const heading = (text, y) => { doc.setFontSize(11); doc.setTextColor(22, 163, 74); doc.setFont('helvetica', 'bold'); doc.text(text, 14, y) }
  let y = 28
  heading('Size Distribution Analysis', y); y += 4
  autoTable(doc, {
    ...pdfTableTheme(brand.accent),
    startY: y,
    head: [['Size', 'Count', '% Fleet', 'Avg CPK', 'Avg Life', 'Fail Rate', 'Brands', 'Flag']],
    body: sorted.map((m) => [
      m.size, m.count, fmtPct(m.pct),
      m.avgCpk != null ? `${currency} ${m.avgCpk.toFixed(4)}` : 'N/A',
      fmtKm(m.avgLife), fmtPct(m.failRate), m.brands.slice(0, 3).join(', ') || 'N/A', m.flag,
    ]),
    margin: { left: 14, right: 14 },
  })
  const next = () => { y = doc.lastAutoTable.finalY + 8; if (y > 170) { doc.addPage(); y = 14 } }
  const recs = recommendations.filter((r) => r.status === 'Recommended' || r.status === 'Under Review')
  if (recs.length) {
    next(); heading('Size Recommendations', y); y += 4
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: y,
      head: [['Asset', 'Vehicle type', 'Current size', 'Recommended size', 'Life change', 'Est. saving', 'Status']],
      body: recs.map((r) => [
        r.asset_no, r.vehicle_type || 'N/A', r.currentSize || 'N/A', r.recommendedSize || 'N/A',
        r.lifeDeltaPct == null ? 'N/A' : `${r.lifeDeltaPct.toFixed(1)}%`,
        r.saving == null || !r.currency ? 'N/A' : fmtMoney(r.saving, r.currency), r.status,
      ]),
      margin: { left: 14, right: 14 },
    })
  }
  next(); heading('Consolidation Recommendations', y); y += 4
  autoTable(doc, {
    ...pdfTableTheme(brand.accent),
    startY: y,
    head: [['Size', 'Type', 'Recommendation', 'Impact', 'Est. Saving (one tyre life)']],
    body: ops.map((op) => [
      op.size, op.type === 'eliminate' ? 'Eliminate' : op.type === 'standardize' ? 'Standardize' : 'Review',
      opDesc(op, currency).slice(0, 110), op.impact, fmtMoney(op.savings, currency),
    ]),
    margin: { left: 14, right: 14 },
  })
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
  doc.save(filename)
}

export async function exportSizeExcel({ filtered, label, currency, fileBase, recommendations = [] }) {
  const { sorted, matrix, pos, ops } = analyses(filtered, label)
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recommendations.map((r) => ({
    Asset: r.asset_no, Country: r.country || '', Site: r.site || '', 'Vehicle type': r.vehicle_type || '',
    'Application (derived)': r.application || '', 'Current size': r.currentSize || '', 'Recommended size': r.recommendedSize || '',
    'Current CPK': r.currentCpk != null ? Number(r.currentCpk.toFixed(4)) : null,
    'Recommended CPK': r.recommendedCpk != null ? Number(r.recommendedCpk.toFixed(4)) : null,
    'Life change %': r.lifeDeltaPct != null ? Number(r.lifeDeltaPct.toFixed(1)) : null,
    'Recorded tyre km': r.tyreKm != null ? Math.round(r.tyreKm) : null,
    'Est. saving': r.saving != null ? Math.round(r.saving) : null, Currency: r.currency || '', Status: r.status,
  }))), 'Recommendations')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sorted.map((m) => ({
    Size: m.size, Count: m.count, 'Fleet %': fmtPct(m.pct),
    [`Avg CPK (${currency}/km)`]: m.avgCpk != null ? parseFloat(m.avgCpk.toFixed(4)) : null,
    'Avg Life (km)': m.avgLife != null ? Math.round(m.avgLife) : null,
    'Failure Rate %': m.failRate != null ? parseFloat(m.failRate.toFixed(1)) : null,
    'Rated tyres': m.ratedCount, Brands: m.brands.join(', '), Sites: m.sites.join(', '), 'Standardization Flag': m.flag,
  }))), 'Size Distribution')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matrix.sizes.flatMap((sz) => matrix.brands.map((br) => ({
    Size: sz, Brand: br,
    [`Avg CPK (${currency}/km)`]: matrix.matrix[sz]?.[br] != null ? parseFloat(matrix.matrix[sz][br].toFixed(4)) : null,
  })))), 'Size-Brand Matrix')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pos.map((p) => ({
    Position: p.pos, 'Total Tyres': p.total, 'Required Sizes': p.required.join(', '),
    'Non-Standard Count': p.nonStd, 'Compliance %': p.compliance != null ? parseFloat(p.compliance.toFixed(1)) : null,
  }))), 'Position Compliance')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ops.map((op) => ({
    Size: op.size, Type: op.type, Recommendation: opDesc(op, currency), Impact: op.impact,
    'Est. Saving (one tyre life)': op.savings != null ? Math.round(op.savings) : null,
  }))), 'Consolidation Ops')
  XLSX.writeFile(wb, `${fileBase}.xlsx`)
}
