/**
 * ERP Data Import - pure mapping + intelligence engine (no I/O, unit-tested).
 *
 * The web ERP Data Import feature parses the filled ERP template tabs and SAVES
 * the mapped rows into REVIEW (staging) tables, never straight into the master
 * tables, so a user can cross-check every detail before promotion. This module
 * is the single source for:
 *   - normalising raw cell values (the ERP export writes the literal text
 *     'NULL' for empty cells - that must become a real null),
 *   - mapping a parsed sheet's header-keyed rows onto the typed staging columns
 *     (header matching is case / space / punctuation insensitive),
 *   - the "which tyre is current vs old" derivation for the change log,
 *   - the expense <-> change-log cross-check.
 *
 * Nothing here talks to Supabase. The service layer (src/lib/api/erpImport.js)
 * persists what these functions produce.
 */

/* ── Dataset column definitions ─────────────────────────────────────────────
 * Each column: { key, type, aliases[] }. `aliases` are ADDITIONAL accepted
 * header spellings (normalised); the key itself (normalised) always matches.
 * type in 'text' | 'num' | 'int' | 'date'.
 * -------------------------------------------------------------------------- */

const ASSET_COLUMNS = [
  { key: 'asset_no', type: 'text', aliases: ['assetno', 'asset', 'assetnumber'] },
  { key: 'plate_no', type: 'text', aliases: ['plateno', 'plate', 'platenumber', 'registrationno', 'registration'] },
  { key: 'asset_type', type: 'text', aliases: ['assettype', 'type', 'vehicletype'] },
  { key: 'site', type: 'text', aliases: ['location'] },
  { key: 'make', type: 'text', aliases: ['manufacturer'] },
  { key: 'model_year', type: 'int', aliases: ['modelyear', 'year'] },
  { key: 'current_km', type: 'num', aliases: ['currentkm', 'km', 'odometer', 'odometerkm'] },
  { key: 'hour_meter', type: 'num', aliases: ['hourmeter', 'hours', 'hm', 'enginehours'] },
  { key: 'status', type: 'text', aliases: ['assetstatus'] },
  { key: 'capacity', type: 'text', aliases: [] },
  { key: 'shift', type: 'text', aliases: [] },
  { key: 'operator', type: 'text', aliases: ['driver', 'firstuser'] },
  { key: 'second_user', type: 'text', aliases: ['seconduser', 'secondoperator', 'seconddriver'] },
  { key: 'insurance_name', type: 'text', aliases: ['insurancename', 'insurer', 'insurancecompany'] },
  { key: 'insurance_type', type: 'text', aliases: ['insurancetype'] },
  { key: 'insurance_start', type: 'date', aliases: ['insurancestart', 'insurancestartdate'] },
  { key: 'insurance_end', type: 'date', aliases: ['insuranceend', 'insuranceenddate', 'insuranceexpiry'] },
  { key: 'operating_card_no', type: 'text', aliases: ['operatingcardno', 'operatingcard', 'cardno', 'operatingcardnumber'] },
  { key: 'card_issue_date', type: 'date', aliases: ['cardissuedate', 'operatingcardissue'] },
  { key: 'card_expiry_date', type: 'date', aliases: ['cardexpirydate', 'cardexpiry', 'operatingcardexpiry'] },
  { key: 'licence_issue', type: 'date', aliases: ['licenceissue', 'licenseissue', 'licenceissuedate', 'licenseissuedate'] },
  { key: 'licence_expiry', type: 'date', aliases: ['licenceexpiry', 'licenseexpiry', 'licenceexpirydate', 'licenseexpirydate'] },
  { key: 'purchase_value', type: 'num', aliases: ['purchasevalue', 'purchase', 'purchaseprice', 'cost'] },
  { key: 'net_book_value', type: 'num', aliases: ['netbookvalue', 'nbv'] },
  { key: 'monthly_dep', type: 'num', aliases: ['monthlydep', 'monthlydepreciation', 'depreciation'] },
  { key: 'age_of_asset', type: 'text', aliases: ['ageofasset', 'age'] },
  { key: 'opr_start_date', type: 'date', aliases: ['oprstartdate', 'operationstart', 'oprstart', 'operationstartdate'] },
  { key: 'org_ou', type: 'text', aliases: ['orgou', 'ou', 'org', 'organisationunit', 'organizationunit'] },
  { key: 'finance_asset_no', type: 'text', aliases: ['financeassetno', 'financeasset', 'financeassetnumber'] },
  { key: 'remarks', type: 'text', aliases: ['notes', 'comment', 'comments', 'remark'] },
]

const CHANGE_COLUMNS = [
  { key: 'asset_no', type: 'text', aliases: ['assetno', 'asset', 'assetnumber'] },
  { key: 'tire_pos', type: 'text', aliases: ['tirepos', 'tyrepos', 'position', 'pos', 'tyreposition', 'tireposition'] },
  { key: 'serial_no', type: 'text', aliases: ['serialno', 'srno', 'serial', 'serialnumber'] },
  { key: 'tyre_size', type: 'text', aliases: ['tyresize', 'tiresize', 'size'] },
  { key: 'tyre_brand', type: 'text', aliases: ['tyrebrand', 'tirebrand', 'brand'] },
  { key: 'fix_date', type: 'date', aliases: ['fixdate', 'fitmentdate', 'fitdate'] },
  { key: 'fix_km', type: 'num', aliases: ['fixkm', 'fitkm'] },
  { key: 'fix_hour', type: 'num', aliases: ['fixhour', 'fixhm', 'fithour'] },
  { key: 'remove_date', type: 'date', aliases: ['removedate', 'removaldate'] },
  { key: 'remove_km', type: 'num', aliases: ['removekm', 'removalkm'] },
  { key: 'remove_hour', type: 'num', aliases: ['removehour', 'removehm', 'removalhour'] },
  { key: 'total_km', type: 'num', aliases: ['totalkm', 'kmrun', 'runkm'] },
  { key: 'old_serial_no', type: 'text', aliases: ['oldserialno', 'oldserialno', 'oldserial', 'oldsrno', 'oldserialnumber'] },
  { key: 'old_tyre_brand', type: 'text', aliases: ['oldtyrebrand', 'oldtyrebrand', 'oldbrand', 'oldtirebrand'] },
  { key: 'job_card', type: 'text', aliases: ['jobcard', 'jobcardno', 'jobcardnumber'] },
  { key: 'version', type: 'text', aliases: ['ver', 'versionno'] },
  { key: 'site', type: 'text', aliases: ['location'] },
]

const EXPENSE_COLUMNS = [
  { key: 'serial_no', type: 'text', aliases: ['serialno', 'srno', 'serial', 'serialnumber'] },
  { key: 'asset_no', type: 'text', aliases: ['assetno', 'asset', 'assetnumber'] },
  { key: 'job_card', type: 'text', aliases: ['jobcard', 'jobcardno', 'jobcardnumber'] },
  { key: 'purchase_date', type: 'date', aliases: ['purchasedate', 'date', 'invoicedate'] },
  { key: 'supplier', type: 'text', aliases: ['vendor', 'suppliername'] },
  { key: 'unit_cost', type: 'num', aliases: ['unitcost', 'cost', 'price', 'unitprice'] },
  { key: 'currency', type: 'text', aliases: ['curr'] },
  { key: 'quantity', type: 'num', aliases: ['qty'] },
  { key: 'invoice_no', type: 'text', aliases: ['invoiceno', 'invoice', 'invoicenumber'] },
  { key: 'po_no', type: 'text', aliases: ['pono', 'po', 'purchaseorder', 'purchaseorderno'] },
  { key: 'tyre_brand', type: 'text', aliases: ['tyrebrand', 'tirebrand', 'brand'] },
  { key: 'tyre_size', type: 'text', aliases: ['tyresize', 'tiresize', 'size'] },
  { key: 'notes', type: 'text', aliases: ['remarks', 'comment', 'comments'] },
]

// Production loads into the EXISTING production_logs table (no staging table).
const PRODUCTION_COLUMNS = [
  { key: 'site', type: 'text', aliases: ['location'] },
  { key: 'period_date', type: 'date', aliases: ['period', 'perioddate', 'month', 'date'] },
  { key: 'm3', type: 'num', aliases: ['cubicmeters', 'cubicmetres', 'volume', 'production'] },
  { key: 'source', type: 'text', aliases: [] },
  { key: 'notes', type: 'text', aliases: ['remarks', 'comment', 'comments'] },
  { key: 'asset_no', type: 'text', aliases: ['assetno', 'asset', 'assetnumber'] },
]

/**
 * Dataset registry. `table` is the destination (a staging table, or the live
 * production_logs for m3). `tabAliases` are normalised template-tab names used
 * to auto-detect the right sheet in a multi-tab workbook.
 */
export const DATASETS = {
  asset: {
    key: 'asset',
    label: 'Asset Master',
    table: 'erp_asset_import',
    columns: ASSET_COLUMNS,
    keyField: 'asset_no',
    tabAliases: ['assetmastererpextended', 'assetmaster', 'asseterpextended', 'assets'],
  },
  change: {
    key: 'change',
    label: 'Tyre Change Log',
    table: 'erp_tyre_change_import',
    columns: CHANGE_COLUMNS,
    keyField: 'serial_no',
    tabAliases: ['tyrechangelog', 'tirechangelog', 'tyrechange', 'changelog'],
  },
  expense: {
    key: 'expense',
    label: 'Tyre Expense',
    table: 'erp_tyre_expense_import',
    columns: EXPENSE_COLUMNS,
    keyField: 'serial_no',
    tabAliases: ['tyreexpensepurchase', 'tyreexpense', 'tireexpensepurchase', 'tyrepurchase', 'expense'],
  },
  production: {
    key: 'production',
    label: 'Production m3',
    table: 'production_logs',
    columns: PRODUCTION_COLUMNS,
    keyField: 'site',
    tabAliases: ['productionm3locationwise', 'productionm3', 'production', 'm3'],
  },
}

/** Ordered list for UI pickers. */
export const DATASET_LIST = [DATASETS.asset, DATASETS.change, DATASETS.expense, DATASETS.production]

/* ── Cell coercion ──────────────────────────────────────────────────────── */

/**
 * Normalise one raw cell. The ERP export uses the literal text 'NULL' for empty
 * cells - that (and '', undefined) becomes a real null. Everything else is
 * trimmed. Dates already parsed to Date objects by the workbook parser are
 * returned unchanged for the date coercer to format.
 * @param {*} v
 * @returns {*} null or the cleaned value
 */
export function normalizeCell(v) {
  if (v === undefined || v === null) return null
  if (v instanceof Date) return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '' || s.toUpperCase() === 'NULL' || s === '#N/A' || s.toUpperCase() === 'N/A') return null
  return s
}

/** Coerce to a finite number, or null. Strips thousands separators + currency. */
export function coerceNum(v) {
  const c = normalizeCell(v)
  if (c === null) return null
  if (typeof c === 'number') return Number.isFinite(c) ? c : null
  if (c instanceof Date) return null
  const cleaned = String(c).replace(/[,\s]/g, '').replace(/[^0-9.+-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '+' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Coerce to an integer, or null. */
export function coerceInt(v) {
  const n = coerceNum(v)
  if (n === null) return null
  return Math.trunc(n)
}

/**
 * Coerce to a YYYY-MM-DD date string, or null. Accepts Date objects, ISO
 * strings, YYYY-MM (period) which becomes the 1st, and common D/M/Y or M/D/Y
 * separators. Ambiguous D/M vs M/D is resolved by preferring day-first only
 * when the first part is > 12 (otherwise ISO / month-first is assumed).
 * @param {*} v
 * @returns {string|null}
 */
export function coerceDate(v) {
  const c = normalizeCell(v)
  if (c === null) return null
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : toIso(c)
  const s = String(c).trim()
  // YYYY-MM-DD or YYYY-MM-DDThh...
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return clampIso(+m[1], +m[2], +m[3])
  // YYYY-MM (period) -> first of month
  m = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m) return clampIso(+m[1], +m[2], 1)
  // D/M/Y or M/D/Y with / . or -
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/)
  if (m) {
    let a = +m[1]
    let b = +m[2]
    let y = +m[3]
    if (y < 100) y += y >= 70 ? 1900 : 2000
    // If first part cannot be a month, treat it as the day (day-first export).
    let day
    let month
    if (a > 12) { day = a; month = b } else { month = a; day = b }
    return clampIso(y, month, day)
  }
  // Last resort: let Date try, but only accept a real parse.
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : toIso(d)
}

function toIso(d) {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function clampIso(y, mo, da) {
  if (!(y >= 1900 && y <= 2999)) return null
  if (!(mo >= 1 && mo <= 12)) return null
  if (!(da >= 1 && da <= 31)) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`
}

/* ── Header matching ────────────────────────────────────────────────────── */

/** Normalise a header/label: lowercase, strip everything but a-z0-9. */
export function normHeader(h) {
  return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Build a { normalizedAlias -> columnKey } map for a dataset's columns. */
function aliasIndex(columns) {
  const idx = new Map()
  for (const col of columns) {
    idx.set(normHeader(col.key), col.key)
    for (const a of col.aliases || []) idx.set(normHeader(a), col.key)
  }
  return idx
}

const COERCERS = { text: (v) => normalizeCell(v), num: coerceNum, int: coerceInt, date: coerceDate }

function coerceByType(type, v) {
  const fn = COERCERS[type] || COERCERS.text
  const out = fn(v)
  // text values that came back as Date/number should stringify for a text column
  if (type === 'text' && out != null && typeof out !== 'string') return String(out)
  return out === undefined ? null : out
}

/**
 * Map a parsed sheet (array of header-keyed row objects) onto typed row objects
 * keyed to the dataset's table columns. Unmatched headers are ignored; blanks
 * and the literal ERP 'NULL' become real nulls. Each output row carries a
 * 1-based `source_row`.
 *
 * @param {string} datasetKey  one of DATASETS keys
 * @param {Array<Record<string,*>>} sheetJson
 * @returns {Array<Record<string,*>>}
 */
export function mapSheetToRows(datasetKey, sheetJson) {
  const ds = DATASETS[datasetKey]
  if (!ds || !Array.isArray(sheetJson)) return []
  const idx = aliasIndex(ds.columns)
  const typeByKey = new Map(ds.columns.map((c) => [c.key, c.type]))

  return sheetJson.map((raw, i) => {
    const out = { source_row: i + 1 }
    for (const col of ds.columns) out[col.key] = null
    if (raw && typeof raw === 'object') {
      for (const [header, value] of Object.entries(raw)) {
        const colKey = idx.get(normHeader(header))
        if (!colKey) continue
        if (out[colKey] != null) continue // first non-null header wins
        const coerced = coerceByType(typeByKey.get(colKey), value)
        if (coerced != null) out[colKey] = coerced
      }
    }
    return out
  })
}

/** True when every mapped column of a row is null (an all-blank source line). */
export function isEmptyMappedRow(datasetKey, row) {
  const ds = DATASETS[datasetKey]
  if (!ds || !row) return true
  return ds.columns.every((c) => row[c.key] == null)
}

/* ── Tyre activity intelligence (current vs old) ────────────────────────── */

function serialEq(a, b) {
  if (a == null || b == null) return false
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

/**
 * Derive which tyre fitment is CURRENT vs OLD for tyre-change rows.
 *
 * Group by (asset_no, tire_pos); within each group sort by fix_date ascending
 * (rows missing a fix_date sort first, so they can never be "latest" unless the
 * whole group lacks dates). The row with the LATEST fix_date is marked
 * is_active=true, all earlier rows is_active=false - REGARDLESS of remove_date
 * (old rows in the ERP export often have a blank remove_date). Also validates
 * the chain: each row's old_serial_no should equal the previous fitment's
 * serial_no; a mismatch sets chain_ok=false and adds a warning. Missing
 * fix_date / serial_no are flagged too. Display only - nothing is deleted.
 *
 * @param {Array<Record<string,*>>} changeRows
 * @returns {Array<Record<string,*>>} same rows, each augmented with
 *   { is_active:boolean, chain_ok:boolean, warnings:string[] }
 */
export function deriveTyreActivity(changeRows) {
  const rows = Array.isArray(changeRows) ? changeRows : []
  // Preserve input order in the output; compute flags via a per-row result map.
  const result = rows.map((r) => ({ ...r, is_active: false, chain_ok: true, warnings: [] }))

  const groups = new Map()
  result.forEach((r, i) => {
    const asset = r.asset_no == null ? '' : String(r.asset_no).trim().toLowerCase()
    const pos = r.tire_pos == null ? '' : String(r.tire_pos).trim().toLowerCase()
    const gk = `${asset}||${pos}`
    if (!groups.has(gk)) groups.set(gk, [])
    groups.get(gk).push(i)
  })

  for (const indices of groups.values()) {
    // Sort a COPY of the index list by fix_date ascending (blank sorts first),
    // tie-break by original order so the later source row wins as active.
    const order = [...indices].sort((ia, ib) => {
      const da = result[ia].fix_date || ''
      const db = result[ib].fix_date || ''
      if (da < db) return -1
      if (da > db) return 1
      return ia - ib
    })
    // The last in ascending order = latest fix_date = active.
    const activeIdx = order[order.length - 1]
    result[activeIdx].is_active = true

    // Chain validation along the sorted order.
    for (let k = 0; k < order.length; k++) {
      const r = result[order[k]]
      if (!r.fix_date) r.warnings.push('Missing fix date')
      if (!r.serial_no) r.warnings.push('Missing serial number')
      if (k > 0) {
        const prev = result[order[k - 1]]
        if (r.old_serial_no != null && prev.serial_no != null && !serialEq(r.old_serial_no, prev.serial_no)) {
          r.chain_ok = false
          r.warnings.push('Old serial does not match the previous fitment')
        }
      }
    }
  }
  return result
}

/* ── Expense <-> change cross-check ─────────────────────────────────────── */

function serialKey(v) {
  return v == null ? '' : String(v).trim().toLowerCase()
}

/**
 * Cross-check expense (purchase/cost) rows against the tyre change set.
 *
 * Flags:
 *   - expense rows whose serial is NOT present in the change set (a cost with no
 *     matching fitment), and
 *   - change serials that have NO expense row (a fitment with no cost = CPK gap).
 *
 * @param {Array<Record<string,*>>} expenseRows
 * @param {Array<string>|Set<string>} changeSerials serials from the change set
 * @returns {{ rows:Array, orphanSerials:string[], missingExpenseSerials:string[] }}
 */
export function validateExpense(expenseRows, changeSerials) {
  const exp = Array.isArray(expenseRows) ? expenseRows : []
  const changeSet = new Set()
  const src = changeSerials instanceof Set ? [...changeSerials] : Array.isArray(changeSerials) ? changeSerials : []
  for (const s of src) {
    const k = serialKey(s)
    if (k) changeSet.add(k)
  }

  const expenseSet = new Set()
  const orphanSerials = []
  const rows = exp.map((r) => {
    const k = serialKey(r.serial_no)
    if (k) expenseSet.add(k)
    const inChange = k !== '' && changeSet.has(k)
    const warnings = []
    if (k === '') warnings.push('Missing serial number')
    else if (!inChange) { warnings.push('Serial not found in the tyre change set'); orphanSerials.push(String(r.serial_no).trim()) }
    return { ...r, serial_in_change: inChange, warnings }
  })

  const missingExpenseSerials = []
  for (const k of changeSet) {
    if (!expenseSet.has(k)) missingExpenseSerials.push(k)
  }

  return { rows, orphanSerials, missingExpenseSerials }
}
