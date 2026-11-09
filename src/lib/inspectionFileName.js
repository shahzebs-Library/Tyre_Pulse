/**
 * One short name for every downloaded tyre inspection report:
 *   "Tyre Insp TM514 NHC 09Nov26 No5.pdf"
 * Asset, site, the INSPECTION date (not the download date) and, when known,
 * which inspection of that vehicle this is. Missing parts are left out.
 * No dashes or underscores (report output rule).
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const ymd = (value) => /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim())

/** "09Nov26" for the file name. */
export function inspectionDateShort(value) {
  const m = ymd(value)
  const mon = m && MONTHS[Number(m[2]) - 1]
  return mon ? `${m[3]}${mon}${m[1].slice(2)}` : ''
}

/** "09 Nov 2026" for text. */
export function inspectionDateLabel(value) {
  const m = ymd(value)
  const mon = m && MONTHS[Number(m[2]) - 1]
  return mon ? `${m[3]} ${mon} ${m[1]}` : ''
}

/** "1st", "2nd", "11th", "23rd". */
export function ordinal(n) {
  const v = Math.trunc(Number(n))
  if (!Number.isFinite(v) || v < 1) return ''
  const t = v % 100
  const s = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')
  return `${v}${s}`
}

const clean = (v) => String(v ?? '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()

export function inspectionReportFileName({ asset, site, date, number } = {}) {
  const no = Number(number) >= 1 ? `No${Math.trunc(Number(number))}` : ''
  return `${['Tyre Insp', clean(asset), clean(site), inspectionDateShort(date), no].filter(Boolean).join(' ')}.pdf`
}

export const inspectionRowDate = (row = {}) =>
  row.inspection_date || row.completed_date || row.scheduled_date || row.created_at

export function inspectionReportFileNameForRow(row = {}, number) {
  return inspectionReportFileName({ asset: row.asset_no, site: row.site, date: inspectionRowDate(row), number })
}
