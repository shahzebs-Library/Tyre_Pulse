/**
 * One name for every downloaded tyre inspection report:
 *   "Tyre Inspection Report TM514 NHC 09 Nov 2026.pdf"
 * Asset code, site and the INSPECTION date (not the download date), so the file
 * sorts and searches by vehicle and day. Missing parts are simply left out.
 * No dashes or underscores (report output rule).
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function inspectionDateLabel(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim())
  if (!m) return ''
  const mon = MONTHS[Number(m[2]) - 1]
  return mon ? `${m[3]} ${mon} ${m[1]}` : ''
}

const clean = (v) => String(v ?? '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function inspectionReportFileName({ asset, site, date } = {}) {
  const parts = ['Tyre Inspection Report', clean(asset).toUpperCase(), clean(site).toUpperCase(), inspectionDateLabel(date)]
  return `${parts.filter(Boolean).join(' ')}.pdf`
}

export function inspectionReportFileNameForRow(row = {}) {
  return inspectionReportFileName({
    asset: row.asset_no,
    site: row.site,
    date: row.inspection_date || row.completed_date || row.scheduled_date || row.created_at,
  })
}
