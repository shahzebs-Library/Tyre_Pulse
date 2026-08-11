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
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  // Tolerate currency prefixes/suffixes and thousands separators ("SAR 1,234.50").
  const s = String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, '')
  if (!s || s === '-' || s === '.') return null
  const n = Number(s)
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
 * Below this, a per-M3 rate is arithmetic rather than a measurement: one job
 * card's cost swings it by hundreds. A mixer plant clears this in a day or two.
 */
export const MIN_M3_FOR_RATE = 1000

/**
 * Is this row's cost-per-M3 worth reading as a rate?
 *
 * A region can hold real cost while almost none of its production has been
 * assigned to it yet - most sites currently carry no region at all. Dividing a
 * full month of cost by a few hundred stray cubic metres produced a headline of
 * SAR 901 per M3 against a fleet figure of 12, which reads as a catastrophe and
 * is entirely an artifact of the missing denominator. Saying so is the fix;
 * printing the number is not.
 */
export function costPerM3Reliable(productionM3, minM3 = MIN_M3_FOR_RATE) {
  const n = num(productionM3)
  if (n == null) return false
  return n >= minM3
}

/**
 * The rate, or a plain-English reason it cannot be read as one. Never returns a
 * number the reader would have to know to distrust.
 */
export function fmtCostPerM3Guarded(value, productionM3, currency = '', minM3 = MIN_M3_FOR_RATE) {
  if (num(value) == null) return 'N/A'
  if (!costPerM3Reliable(productionM3, minM3)) return 'Too little production to measure'
  return fmtCostPerM3(value, currency)
}

/**
 * Summarize ledger rows (already filtered by country + period by the caller)
 * into a professional summary-first shape: totals + byMonth + bySite.
 * kind: 'sco' | 'sany' | 'production'. Production sums approved m3 (falls back
 * to supplied m3 when approved is blank); the money ledgers sum `amount`.
 * Currency-aware: distinct currencies are reported and `mixedCurrency` is true
 * when more than one appears - the caller must NOT label a blended figure with
 * a single currency. Null-safe; never fabricates a value.
 *
 * @param {Array<object>} rows
 * @param {'sco'|'sany'|'production'} kind
 * @returns {{ totals: object, byMonth: Array<object>, bySite: Array<object> }}
 */
export function summarizeLedger(rows = [], kind = 'sco') {
  const list = Array.isArray(rows) ? rows : []
  const valueOf = (r) => (kind === 'production' ? (num(r?.approved_m3) ?? num(r?.m3)) : num(r?.amount))
  const monthOf = (r) => {
    const s = String(r?.period_date || r?.invoice_date || '').slice(0, 7)
    return /^\d{4}-\d{2}$/.test(s) ? s : 'Unknown'
  }
  const siteOf = (r) => {
    const s = String(r?.site ?? '').trim() || String(r?.region ?? '').trim()
    return s || 'Not stated'
  }

  const byMonthMap = new Map()
  const bySiteMap = new Map()
  const currencies = new Set()
  let value = 0
  let supplied = 0
  let approved = 0
  let rejectedLoads = 0
  let rejectedM3 = 0
  let countedValue = 0 // sany: doc_type <> 'detail' (what feeds Cost/M3)
  let detailRows = 0

  for (const r of list) {
    const v = valueOf(r) ?? 0
    value += v
    const cur = String(r?.currency ?? '').trim()
    if (cur) currencies.add(cur)
    const m = monthOf(r)
    const s = siteOf(r)
    const mo = byMonthMap.get(m) || { month: m, rows: 0, value: 0 }
    mo.rows += 1; mo.value += v; byMonthMap.set(m, mo)
    const si = bySiteMap.get(s) || { site: s, rows: 0, value: 0 }
    si.rows += 1; si.value += v; bySiteMap.set(s, si)
    if (kind === 'production') {
      const sup = num(r?.m3) ?? num(r?.supplied_m3)
      if (sup != null) supplied += sup
      const app = num(r?.approved_m3) ?? num(r?.m3)
      if (app != null) approved += app
      if (r?.rejected === true || r?.rejected === 'true') {
        rejectedLoads += 1
        const gap = (sup ?? 0) - (num(r?.approved_m3) ?? 0)
        if (gap > 0) rejectedM3 += gap
      }
    }
    if (kind === 'sany') {
      if (r?.doc_type === 'detail') detailRows += 1
      else countedValue += v
    }
  }

  const byMonth = Array.from(byMonthMap.values()).sort((a, b) => {
    if (a.month === 'Unknown') return 1
    if (b.month === 'Unknown') return -1
    return a.month < b.month ? 1 : a.month > b.month ? -1 : 0
  })
  const bySite = Array.from(bySiteMap.values()).sort((a, b) => (b.value - a.value) || (b.rows - a.rows))
  const knownMonths = byMonth.filter((m) => m.month !== 'Unknown').map((m) => m.month)

  const totals = {
    rows: list.length,
    value: list.length ? value : null,
    sites: bySiteMap.size,
    months: byMonthMap.size,
    firstMonth: knownMonths.length ? knownMonths[knownMonths.length - 1] : null,
    lastMonth: knownMonths.length ? knownMonths[0] : null,
    currencies: Array.from(currencies).sort(),
    mixedCurrency: currencies.size > 1,
  }
  if (kind === 'production') {
    totals.supplied_m3 = list.length ? supplied : null
    totals.approved_m3 = list.length ? approved : null
    totals.rejected_loads = rejectedLoads
    totals.rejected_m3 = rejectedM3
  }
  if (kind === 'sany') {
    totals.counted_value = list.length ? countedValue : null
    totals.detail_rows = detailRows
  }
  return { totals, byMonth, bySite }
}

/**
 * Rejected production loads, row-level detail for the rejections report:
 * Date, Site, DN number, Supplied / Approved / Not approved m3, Reason, Remarks.
 * Null-safe; newest first. Never invents a quantity.
 * @param {Array<object>} rows production_logs rows
 */
export function rejectedRowsDetail(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r?.rejected === true || r?.rejected === 'true')
    .map((r) => {
      const sup = num(r?.m3) ?? num(r?.supplied_m3)
      const app = num(r?.approved_m3)
      const gap = sup != null ? Math.max(sup - (app ?? 0), 0) : null
      return {
        id: r?.id ?? null,
        period_date: r?.period_date ?? null,
        site: String(r?.site ?? '').trim() || null,
        dn_number: String(r?.dn_number ?? '').trim() || null,
        supplied_m3: sup,
        approved_m3: app,
        not_approved_m3: gap,
        reason: String(r?.reason ?? '').trim() || null,
        remarks: String(r?.remarks ?? '').trim() || null,
      }
    })
    .sort((a, b) => String(b.period_date || '').localeCompare(String(a.period_date || '')))
}

/**
 * Per-source share of the Cost per M3 grand total, from the get_cost_per_m3
 * `total` object. share is a 0..100 percentage, null when there is no positive
 * grand total or the source value is null (honest N/A, never a fabricated 0%).
 * Tyre is a sub-line of Internal (flagged `sub`) so shares of the top-level
 * sources still add up to ~100.
 */
export function sourceShares(total) {
  if (!total || typeof total !== 'object') return []
  const grand = num(total.grand_total)
  const items = [
    { key: 'internal', label: 'Internal (ERP expenses)', value: num(total.internal_cost), sub: false },
    { key: 'tyre', label: 'Tyre (of Internal)', value: num(total.tyre_cost), sub: true },
    { key: 'sco', label: 'SCO cost', value: num(total.sco_cost), sub: false },
    { key: 'sany', label: 'SANY invoices', value: num(total.sany_cost), sub: false },
  ]
  return items.map((it) => ({
    ...it,
    share: grand != null && grand > 0 && it.value != null ? (it.value / grand) * 100 : null,
  }))
}

/**
 * Import templates. `headers` are the exact column names an upload should carry;
 * `map` translates a normalised (lowercased, trimmed) header to a row field.
 * period is a month; accept 'YYYY-MM' or a date and normalise to the 1st.
 */
export const IMPORT_TEMPLATES = {
  sco: {
    label: 'SCO cost',
    // Also accepts the ERP SCO issue grid export ("bj_griddetails"): Issue Number ->
    // Ref No, Transaction Type -> date, Store Code -> Site, Item Description ->
    // Description, Values -> Amount; Work Order / Asset Code land in Notes.
    headers: ['Country', 'Region', 'Site', 'Month', 'Cost Center', 'Description', 'Amount', 'Currency', 'Ref No', 'Notes'],
    fields: ['country', 'region', 'site', 'period_date', 'cost_center', 'description', 'amount', 'currency', 'ref_no', 'notes'],
  },
  sany: {
    label: 'SANY invoice (summary, detail or PDF proforma)',
    // Accepts BOTH SANY spreadsheet formats. Summary: Region | Date | Quotation No |
    // Amount (SAR). Detail: Location | Asset Code | Asset No | Parts Description |
    // Quot. No | Cost | Remarks | Fleet Remarks | Maintenance Remarks (link by
    // Quotation No). The PDF service-contract PROFORMA (USD, one net-of-deductions
    // total) is parsed in parsePdf.js into a row carrying the gross/net/fx/deduction
    // columns below; its `amount` = gross converted to SAR (the Cost/M3 figure).
    headers: ['Country', 'Region', 'Location / Site', 'Asset Code', 'Asset No', 'Quotation No',
      'Date', 'Parts Description', 'Amount (SAR) / Cost', 'Remarks', 'Fleet Remarks', 'Maintenance Remarks',
      'Doc Type', 'Currency', 'Gross Amount (USD)', 'Net Amount (USD)', 'FX Rate', 'Deductions'],
    fields: ['country', 'region', 'site', 'asset_code', 'asset_no', 'invoice_no',
      'invoice_date', 'description', 'amount', 'notes', 'fleet_remarks', 'maintenance_remarks',
      'doc_type', 'currency', 'gross_amount', 'net_amount', 'fx_rate', 'deductions'],
  },
  sites: {
    label: 'Sites (region map)',
    // One company -> countries -> sites; each KSA site belongs to a Region
    // (Central / Western). Region drives the Cost per M3 split.
    headers: ['Country', 'Site Name', 'Site Code', 'Region', 'City', 'Site Type', 'Active', 'Notes'],
    fields: ['country', 'name', 'site_code', 'region', 'city', 'site_type', 'active', 'notes'],
  },
  production: {
    label: 'Production (concrete batching)',
    // Matches the real batching export. Station = site; Supplied Qty = produced;
    // Approved/Signed Qty = the counted quantity (cost/m3 denominator); Rejection
    // Type / Reason / Remarks drive the not-approved (rejection) analytics.
    headers: ['Station', 'Batching Time', 'Truck Number', 'Pump Number', 'DN Number', 'Order Number',
      'Mix Code', 'Mix Description', 'Customer Name', 'Project Name',
      'Supplied Qty', 'Approved/Signed Qty', 'Rejection Type', 'Reason', 'Remarks'],
    fields: ['site', 'period_date', 'asset_no', 'pump_no', 'dn_number', 'order_number',
      'mix_code', 'mix_description', 'customer_name', 'project_name',
      'm3', 'approved_m3', 'rejected', 'reason', 'remarks'],
  },
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Header synonyms -> canonical field, per kind (tolerant of common variants). */
const HEADER_SYNONYMS = {
  country: ['country'],
  region: ['region', 'area'],
  site: ['site', 'location', 'plant', 'station', 'store code', 'store'],
  asset_no: ['asset', 'asset no', 'asset_no', 'equipment', 'truck number', 'truck no', 'truck'],
  pump_no: ['pump number', 'pump no', 'pump'],
  // 'transaction type' is the (mislabelled) DATE column of the SCO issue grid export.
  period_date: ['month', 'period', 'date', 'period date', 'batching time', 'batch time', 'batching date', 'transaction', 'transaction date', 'transaction type', 'txn date'],
  cost_center: ['cost center', 'cost centre', 'cost_center'],
  description: ['description', 'desc', 'details', 'item', 'parts description', 'part description', 'item desc', 'item description'],
  // 'values' (the ERP/SCO grid cost column) maps to the cost amount.
  amount: ['amount', 'cost', 'value', 'values', 'total', 'sar', 'amount (sar)', 'amount sar', 'amount (sar) / cost'],
  currency: ['currency'],
  doc_type: ['doc type', 'doc_type', 'document type'],
  gross_amount: ['gross amount (usd)', 'gross amount', 'gross', 'gross (usd)'],
  net_amount: ['net amount (usd)', 'net amount', 'net', 'net (usd)'],
  fx_rate: ['fx rate', 'fx_rate', 'currency rate', 'fx'],
  deductions: ['deductions', 'deduction'],
  ref_no: ['ref no', 'ref', 'reference', 'ref_no', 'issue number', 'issue no'],
  invoice_no: ['invoice no', 'invoice', 'invoice_no', 'inv no', 'quotation no', 'quot no', 'quot. no', 'quotation', 'quot no.'],
  invoice_date: ['invoice date', 'invoice_date', 'inv date', 'date'],
  status: ['status'],
  asset_code: ['asset code', 'asset_code'],
  name: ['site name', 'name'],
  site_code: ['site code', 'site_code', 'code'],
  city: ['city'],
  site_type: ['site type', 'type'],
  active: ['active', 'is active'],
  notes: ['remarks', 'remark', 'note', 'notes'],
  fleet_remarks: ['fleet remarks', 'fleet remark'],
  maintenance_remarks: ['maintenance remarks', 'maintenance remark', 'maint remarks'],
  m3: ['m3', 'm³', 'produced', 'supplied qty', 'supplied', 'qty', 'quantity'],
  approved_m3: ['approved m3', 'approved_m3', 'approved', 'approved qty', 'approved quantity', 'approved/signed qty', 'approved signed qty', 'signed qty'],
  rejected: ['rejection type', 'rejected', 'rejection'],
  reason: ['reason'],
  remarks: ['remarks', 'remark'],
  dn_number: ['dn number', 'dn no', 'dn', 'delivery note'],
  order_number: ['order number', 'order no', 'order'],
  mix_code: ['mix code'],
  mix_description: ['mix description', 'mix desc'],
  customer_name: ['customer name', 'customer'],
  project_name: ['project name', 'project'],
}

/** Normalise a region label so imports group with tagged sites: "Western Region" -> "Western". */
export function normalizeRegion(v) {
  const s = String(v ?? '').trim().replace(/\s+region\s*$/i, '').trim()
  if (!s) return null
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Parse an asset id out of a truck/pump cell like "TM505     9772 BSA" -> "TM505". */
export function assetFromTruck(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  const first = s.split(/\s+/)[0]
  return first ? first.toUpperCase() : null
}

/** Yes/No (or true/1) -> boolean. Blank/No -> false. */
export function toRejectedBool(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'yes' || s === 'true' || s === '1' || s === 'y' || s === 'rejected'
}

/** A date cell (Date, 'YYYY-MM-DD[ HH:MM]', DD/MM/YYYY) -> YYYY-MM-DD (day) or null. */
export function toDateDay(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  const s = String(v).trim()
  // Excel serial date keeps its DAY precision here (toMonthStart floors to the 1st).
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000)
      const p = (x) => String(x).padStart(2, '0')
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
    }
  }
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`
  return toMonthStart(s)
}

const MONTH_TOKENS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Normalise a month cell to the first day of that month (YYYY-MM-01) or null.
 * Real ERP exports carry every shape at once: Date objects (xlsx cellDates),
 * Excel serial numbers, 'YYYY-MM', full dates with a time suffix, day-first
 * 'DD/MM/YYYY', and month-name forms ('01-Jul-26', 'Jul-26', 'July 2026').
 * Returning null on junk is deliberate — the import service SKIPS the row with
 * a counted reason instead of sending garbage into a date column, where one
 * bad cell aborts the whole insert chunk (the "uploaded but nothing shows" bug).
 */
export function toMonthStart(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-01`
  }
  const s = String(v).trim()
  // Excel serial date (days since 1899-12-30); plausible window ~1954..2119.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
    }
  }
  const ym = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (ym) return `${ym[1]}-${String(ym[2]).padStart(2, '0')}-01`
  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-01`
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-01`
  // Month-name forms: '01-Jul-26', 'Jul-26', 'July 2026', '01 July 2026'.
  const mn = s.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[^0-9]*(\d{4}|\d{2})(?!\d)/)
  if (mn) {
    const month = MONTH_TOKENS.indexOf(mn[1]) + 1
    const year = mn[2].length === 4 ? Number(mn[2]) : 2000 + Number(mn[2])
    if (month >= 1 && year > 1999 && year < 2120) return `${year}-${String(month).padStart(2, '0')}-01`
  }
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
          if (field === 'period_date') {
            // A cell that cannot be read as a date stays NULL (the service skips
            // the row and says why) - the old raw-value fallback pushed junk into
            // a date column and one bad cell aborted the entire insert chunk.
            out[field] = (kind === 'production' ? toDateDay(rawVal) : toMonthStart(rawVal)) || null
          } else if (field === 'invoice_date') {
            out[field] = toMonthStart(rawVal) || null
          } else if (field === 'amount' || field === 'm3' || field === 'approved_m3'
            || field === 'gross_amount' || field === 'net_amount' || field === 'fx_rate') {
            out[field] = num(rawVal)
          } else if (field === 'deductions') {
            // A proforma carries an array of {label, amount}; keep it as-is for the
            // jsonb column. A string (rare) is parsed if it is JSON, else dropped.
            if (Array.isArray(rawVal) || (rawVal && typeof rawVal === 'object')) out[field] = rawVal
            else if (typeof rawVal === 'string' && rawVal.trim().startsWith('[')) {
              try { out[field] = JSON.parse(rawVal) } catch { /* leave unset */ }
            }
          } else if (field === 'rejected') {
            out[field] = toRejectedBool(rawVal)
          } else if (field === 'asset_no' && kind === 'production') {
            out[field] = assetFromTruck(rawVal)
          } else {
            out[field] = rawVal == null ? null : String(rawVal).trim()
          }
          break
        }
      }
    }
    if (kind === 'sco' || kind === 'sany' || kind === 'sites') {
      if ('region' in out) out.region = normalizeRegion(out.region)
    }
    if (kind === 'sco' && !out.notes) {
      // The SCO issue grid has no Notes column but carries Work Order + Asset -
      // keep both as provenance (sco_costs has no asset column of its own).
      const pick = (names) => {
        for (const [k, v] of Object.entries(raw || {})) {
          if (names.includes(norm(k)) && v != null && String(v).trim()) return String(v).trim()
        }
        return null
      }
      const wo = pick(['work order number', 'work order no', 'work order', 'wo number', 'wo no'])
      const asset = pick(['asset code', 'asset no', 'asset'])
      const bits = []
      if (wo) bits.push(`WO ${wo}`)
      if (asset) bits.push(`Asset ${asset}`)
      if (bits.length) out.notes = bits.join(' / ')
    }
    if (kind === 'sany') {
      // An explicit Doc Type (e.g. the PDF proforma) wins; otherwise a row carrying
      // an asset/parts line is a detail, else a summary. A proforma feeds Cost/M3
      // (get_cost_per_m3 counts doc_type <> 'detail'), a detail does not.
      if (!out.doc_type) out.doc_type = (out.description || out.asset_code || out.asset_no) ? 'detail' : 'summary'
      if (!out.period_date && out.invoice_date) out.period_date = toMonthStart(out.invoice_date)
    }
    out.source = 'import'
    return out
  }).filter((r) => Object.keys(r).length > 1)
}
