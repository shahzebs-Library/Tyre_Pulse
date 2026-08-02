/**
 * costPerM3 - pure helpers (no I/O) for the Cost per M3 module.
 *
 * Formatting for the dashboard, plus the import templates + row-mapping for the
 * SCO / SANY / Production ledgers so an uploaded Excel/CSV maps by header name.
 * Money is always shown with its currency; a cost-per-m3 is null -> "N/A" when
 * there is no production denominator (honest, never a fabricated 0).
 */

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Money amount, rounded + thousands-separated, with currency. */
export function fmtMoney(value, currency = '') {
  const n = num(value)
  if (n == null) return 'N/A'
  return `${currency ? currency + ' ' : ''}${Math.round(n).toLocaleString()}`
}

/** Cubic metres, rounded. */
export function fmtM3(value) {
  const n = num(value)
  if (n == null) return 'N/A'
  return `${Math.round(n).toLocaleString()} M3`
}

/** Cost per M3 (4 dp) with currency; null -> "N/A". */
export function fmtCostPerM3(value, currency = '') {
  const n = num(value)
  if (n == null) return 'N/A'
  return `${currency ? currency + ' ' : ''}${n.toFixed(2)}/M3`
}

/**
 * Import templates. `headers` are the exact column names an upload should carry;
 * `map` translates a normalised (lowercased, trimmed) header to a row field.
 * period is a month; accept 'YYYY-MM' or a date and normalise to the 1st.
 */
export const IMPORT_TEMPLATES = {
  sco: {
    label: 'SCO cost',
    headers: ['Country', 'Region', 'Site', 'Month', 'Cost Center', 'Description', 'Amount', 'Currency', 'Ref No'],
    fields: ['country', 'region', 'site', 'period_date', 'cost_center', 'description', 'amount', 'currency', 'ref_no'],
  },
  sany: {
    label: 'SANY workshop invoice',
    headers: ['Country', 'Region', 'Site', 'Asset', 'Invoice No', 'Invoice Date', 'Month', 'Description', 'Amount', 'Currency', 'Status'],
    fields: ['country', 'region', 'site', 'asset_no', 'invoice_no', 'invoice_date', 'period_date', 'description', 'amount', 'currency', 'status'],
  },
  production: {
    label: 'Production (approved M3)',
    headers: ['Country', 'Site', 'Asset', 'Month', 'M3', 'Approved M3'],
    fields: ['country', 'site', 'asset_no', 'period_date', 'm3', 'approved_m3'],
  },
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Header synonyms -> canonical field, per kind (tolerant of common variants). */
const HEADER_SYNONYMS = {
  country: ['country'],
  region: ['region', 'area'],
  site: ['site', 'location', 'plant'],
  asset_no: ['asset', 'asset no', 'asset_no', 'equipment'],
  period_date: ['month', 'period', 'date', 'period date'],
  cost_center: ['cost center', 'cost centre', 'cost_center'],
  description: ['description', 'desc', 'details', 'item'],
  amount: ['amount', 'cost', 'value', 'total', 'sar'],
  currency: ['currency'],
  ref_no: ['ref no', 'ref', 'reference', 'ref_no'],
  invoice_no: ['invoice no', 'invoice', 'invoice_no', 'inv no'],
  invoice_date: ['invoice date', 'invoice_date', 'inv date'],
  status: ['status'],
  m3: ['m3', 'm³', 'quantity', 'qty', 'produced'],
  approved_m3: ['approved m3', 'approved_m3', 'approved', 'approved qty', 'approved quantity'],
}

/** Normalise a month cell to the first day of that month (YYYY-MM-01) or null. */
export function toMonthStart(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  const ym = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (ym) return `${ym[1]}-${String(ym[2]).padStart(2, '0')}-01`
  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-01`
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-01`
  return null
}

/**
 * Map raw import rows (array of objects keyed by header) into ledger rows for a
 * kind ('sco'|'sany'|'production'). Unknown headers are ignored; amount/m3 are
 * coerced; the month cell is normalised to the 1st. Rows missing a country are
 * dropped by the caller/service.
 *
 * @param {'sco'|'sany'|'production'} kind
 * @param {Array<object>} rawRows
 * @returns {Array<object>}
 */
export function mapImportRows(kind, rawRows = []) {
  const tpl = IMPORT_TEMPLATES[kind]
  if (!tpl) return []
  const allow = new Set(tpl.fields)
  return (Array.isArray(rawRows) ? rawRows : []).map((raw) => {
    const out = {}
    for (const [rawKey, rawVal] of Object.entries(raw || {})) {
      const nk = norm(rawKey)
      for (const [field, syns] of Object.entries(HEADER_SYNONYMS)) {
        if (!allow.has(field)) continue
        if (syns.includes(nk)) {
          if (field === 'period_date' || field === 'invoice_date') out[field] = toMonthStart(rawVal) || rawVal
          else if (field === 'amount' || field === 'm3' || field === 'approved_m3') out[field] = num(rawVal)
          else out[field] = rawVal == null ? null : String(rawVal).trim()
          break
        }
      }
    }
    out.source = 'import'
    return out
  }).filter((r) => Object.keys(r).length > 1)
}
