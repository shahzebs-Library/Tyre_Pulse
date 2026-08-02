/**
 * controlCenterExport.js - report export for the super-admin Data Trust &
 * Control Center.
 *
 * Turns the three live control-center payloads (trust report, diagnostics
 * summary, figure lineage) into a downloadable Excel workbook or a PDF snapshot.
 *
 * DESIGN
 *   - The three `*ExportRows` builders are PURE (no I/O): they only reshape the
 *     payloads into flat, ASCII-only rows, so they are unit testable and can be
 *     reused by the page.
 *   - `exportControlCenter` is the only side-effecting entry point. It calls the
 *     shared exportUtils savers and NEVER throws because a section is absent or
 *     `ok:false` - it simply omits that section.
 *   - No em/en dashes or arrows anywhere. Missing values render "N/A"; separators
 *     are "|" or ":".
 */

import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from './exportUtils.js'
import { DOMAIN_KEYS, trustBand } from './dataTrust.js'
import { rankIssues } from './api/controlCenter.js'

const NA = 'N/A'

/** Coerce a value to a clean count number, or 0 when it is not a finite number. */
function count(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Trust snapshot rows: one row per KPI domain from the cross-country roll-up.
 *
 * The overall roll-up carries the score and band but not the reasons (those live
 * per country), so the distinct reason labels are gathered from every country's
 * copy of that domain and joined with " | ".
 *
 * @param {object} trustReport output of buildTrustReport(payload)
 * @returns {Array<{domain:string, score:number|string, band:string, reasons:string}>}
 */
export function trustExportRows(trustReport) {
  if (!trustReport || trustReport.ok !== true) return []
  const overall = trustReport.overall || {}
  const countries = Array.isArray(trustReport.countries) ? trustReport.countries : []

  return DOMAIN_KEYS
    .map((k) => overall[k])
    .filter(Boolean)
    .map((d) => {
      // Gather distinct reason labels across every country for this domain.
      const seen = new Set()
      for (const c of countries) {
        const cd = c && c.domains ? c.domains[d.key] : null
        if (!cd || !Array.isArray(cd.reasons)) continue
        for (const r of cd.reasons) {
          if (r && r.label) seen.add(r.label)
        }
      }
      const band = d.band || trustBand(d.score)
      return {
        domain: d.label,
        score: d.score == null ? NA : d.score,
        band: band && band.label ? band.label : NA,
        reasons: seen.size ? [...seen].join(' | ') : 'None',
      }
    })
}

/**
 * Diagnostics rows, most-severe first (reusing rankIssues).
 * @param {object} summary getControlCenterSummary() result
 * @returns {Array<{issue:string, severity:string, count:number}>}
 */
export function diagnosticsExportRows(summary) {
  if (!summary || summary.ok !== true || !Array.isArray(summary.issues)) return []
  return rankIssues(summary.issues).map((i) => ({
    issue: i.label || i.key || 'Issue',
    severity: i.severity || 'info',
    count: count(i.count),
  }))
}

/**
 * Lineage rows flattened from the recent import activity behind a figure.
 * @param {object} lineage getFigureLineage() result
 * @returns {Array<{module,file,rows,imported,duplicates,status,date,repeat}>}
 */
export function lineageExportRows(lineage) {
  if (!lineage || lineage.ok !== true || !Array.isArray(lineage.recent_imports)) return []
  return lineage.recent_imports.map((r) => ({
    module: r.module || NA,
    file: r.file || NA,
    rows: count(r.rows),
    imported: count(r.imported),
    duplicates: count(r.duplicates),
    status: r.status || NA,
    date: r.at || NA,
    repeat: r.repeat_file ? 'Yes' : 'No',
  }))
}

// ── Combined workbook shaping ────────────────────────────────────────────────
// A single flat table (one `section` column) is the most robust Excel output for
// the shared exportToExcel helper: every section becomes uniform rows. A section
// whose payload is absent contributes nothing rather than an empty band.

const COMBINED_COLS = ['section', 'item', 'value', 'status', 'detail']
const COMBINED_HEADERS = ['Section', 'Item', 'Value', 'Status', 'Detail']

function combinedRows({ trustReport, summary, lineage }) {
  const rows = []

  for (const t of trustExportRows(trustReport)) {
    rows.push({
      section: 'Data Trust',
      item: t.domain,
      value: t.score,
      status: t.band,
      detail: t.reasons,
    })
  }

  for (const d of diagnosticsExportRows(summary)) {
    rows.push({
      section: 'Diagnostics',
      item: d.issue,
      value: d.count,
      status: d.severity,
      detail: '',
    })
  }

  for (const l of lineageExportRows(lineage)) {
    rows.push({
      section: 'Recent Imports',
      item: `${l.module}: ${l.file}`,
      value: l.rows,
      status: l.status,
      detail: `Imported ${l.imported} | Duplicates ${l.duplicates}${l.repeat === 'Yes' ? ' | Repeat file' : ''}`,
    })
  }

  return rows
}

/**
 * Build a filename and write ONE Excel workbook (default) or a PDF of the
 * control-center snapshot. Never throws on a missing / ok:false section.
 *
 * @param {object}  args
 * @param {'excel'|'pdf'} [args.format='excel']
 * @param {string}  [args.country]
 * @param {object}  [args.trustReport]
 * @param {object}  [args.summary]
 * @param {object}  [args.lineage]
 * @returns {Promise<{ok:boolean, rows:number, format:string, filename:string}>}
 */
export async function exportControlCenter({ format = 'excel', country, trustReport, summary, lineage } = {}) {
  const label = country || 'All'
  const base = reportFileName('TyrePulse Data Trust', label)
  const title = `Data Trust Snapshot | ${label} | ${reportDateLabel()}`

  if (format === 'pdf') {
    const rows = diagnosticsExportRows(summary)
    const cols = [
      { key: 'issue', header: 'Issue' },
      { key: 'severity', header: 'Severity' },
      { key: 'count', header: 'Count' },
    ]
    await exportToPdf(rows, cols, title, base, 'landscape')
    return { ok: true, rows: rows.length, format: 'pdf', filename: `${base}.pdf` }
  }

  const rows = combinedRows({ trustReport, summary, lineage })
  await exportToExcel(rows, COMBINED_COLS, COMBINED_HEADERS, base, 'Data Trust')
  return { ok: true, rows: rows.length, format: 'excel', filename: `${base}.xlsx` }
}
