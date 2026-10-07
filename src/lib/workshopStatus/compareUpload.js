/**
 * workshopStatus/compareUpload.js - compare a parsed workshop Excel preview
 * (excelParser.parseWorkshopSheet output) with the vehicles currently active in
 * Workshop Status, and say what a confirmed upload WOULD do. Pure: NO database
 * writes, NO UI. The server-side confirm function is the authority; this is the
 * preview the person reviews before confirming, so its rules must match it.
 *
 * Rules:
 *   - Match ONLY by canonical asset number (upper case, no whitespace) within the
 *     same org + country. Never by row position: the Excel is re-sorted daily.
 *   - Only Excel-owned fields are compared or reported. TyrePulse-owned fields
 *     (stage, delay reason, people, dates the workshop maintains) are never part
 *     of a comparison, even if a preview row somehow carries them.
 *   - A vehicle missing from today's active rows is REMOVED from the current
 *     report. Being listed under "JOB CARD CLOSED DETAILS" is recorded as
 *     evidence only (reason 'listed_as_closed'); the final disposition is always
 *     entered by a person.
 *   - Output is sorted by asset number so the preview and the server agree.
 */

import { normaliseAssetNo, parseWorkshopDate } from './excelParser.js'

/** Fields the daily Excel owns; a confirmed upload refreshes these. */
export const EXCEL_OWNED_FIELDS = Object.freeze([
  'reg_no', 'job_card_ref', 'vehicle_category', 'site', 'department', 'complaint', 'diagnostics',
  'ooc_since', 'excel_down_days', 'excel_expected_release', 'excel_status_note', 'source_remarks',
])

/** Fields maintained in TyrePulse; an upload never reads, compares or writes them. */
export const TYREPULSE_OWNED_FIELDS = Object.freeze([
  'current_stage', 'delay_reason', 'detailed_reason', 'work_done', 'action_taken', 'next_action',
  'parts_status', 'mr_number', 'po_number', 'responsible_user_id', 'supporting_user_id',
  'expected_part_date', 'expected_release_date', 'blocker', 'remarks',
])

/** Human labels for the Excel-owned fields (preview UI). */
export const FIELD_LABELS = Object.freeze({
  reg_no: 'Registration',
  job_card_ref: 'Job card',
  vehicle_category: 'Category',
  site: 'Location',
  department: 'Account',
  complaint: 'Complaint',
  diagnostics: 'Diagnostics',
  ooc_since: 'Breakdown date',
  excel_down_days: 'Down days (file)',
  excel_expected_release: 'Expected release (file)',
  excel_status_note: 'Status note (file)',
  source_remarks: 'Remarks',
})

const DATE_FIELDS = new Set(['ooc_since'])
const NUMBER_FIELDS = new Set(['excel_down_days'])

/**
 * Fields left out of change detection by default. excel_down_days is a formula
 * in the source file (report date minus breakdown date), so it grows by one
 * every day; comparing it would mark every vehicle changed on every upload.
 * It is still stored. The server confirm must use the same list.
 */
export const DEFAULT_IGNORED_FIELDS = Object.freeze(['excel_down_days'])

const collapse = (v) => String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Site as the database will store it. PREVIEW MIRROR ONLY: the DB trigger
 * normalize_site() is the authority. Mirrored here in the same order: upper
 * case, trim, collapse spaces, then the site_aliases table (pass it as a
 * Map alias -> canonical) and, only when no alias matched, strip a trailing
 * "-ST" / "_ST" store suffix. "DIRIYAH-ST2" does not end in ST and is kept.
 * Without the alias map the preview can still show a change the server will
 * not find.
 */
export function normaliseSite(v, aliases) {
  if (v == null) return null
  const s = collapse(v).toUpperCase()
  if (!s) return null
  const canon = aliases && typeof aliases.get === 'function' ? aliases.get(s) : null
  if (canon) return canon
  return s.replace(/[-_]ST$/, '').trim() || null
}

/**
 * Comparable form of one field value: blank -> null, dates -> yyyy-mm-dd,
 * numbers -> number, site -> normalised site, other text -> trimmed, collapsed,
 * lower case (a case-only edit is not a change).
 */
export function normaliseForCompare(field, value, opts = {}) {
  if (value == null) return null
  if (typeof value === 'string' && collapse(value) === '') return null
  if (DATE_FIELDS.has(field)) {
    const p = parseWorkshopDate(value)
    return p.value ?? collapse(value).toLowerCase()
  }
  if (NUMBER_FIELDS.has(field)) {
    const n = typeof value === 'number' ? value : Number(collapse(value).replace(/,/g, ''))
    return Number.isFinite(n) ? n : collapse(value).toLowerCase()
  }
  if (field === 'site') return normaliseSite(value, opts.siteAliases)
  if (value instanceof Date) return parseWorkshopDate(value).value
  return collapse(value).toLowerCase()
}

const shown = (v) => {
  if (v == null) return '(blank)'
  if (v instanceof Date) return parseWorkshopDate(v).value || '(blank)'
  const s = collapse(v)
  return s === '' ? '(blank)' : s
}

/** "Complaint: X -> Y" for the preview list. */
export function describeChange(field, from, to) {
  return `${FIELD_LABELS[field] || field}: ${shown(from)} -> ${shown(to)}`
}

/** Excel-owned fields of a preview row's data, blanks as null. */
function excelData(data) {
  const out = {}
  for (const f of EXCEL_OWNED_FIELDS) {
    const v = data ? data[f] : undefined
    out[f] = v === undefined || (typeof v === 'string' && collapse(v) === '') ? null : v
  }
  return out
}

const byAsset = (a, b) => (a.asset_no < b.asset_no ? -1 : a.asset_no > b.asset_no ? 1 : 0)
const byAssetThenRow = (a, b) => {
  const k = byAsset({ asset_no: a.asset_no || '' }, { asset_no: b.asset_no || '' })
  return k || (a.rowNumber ?? 0) - (b.rowNumber ?? 0)
}

function snapshot(record) {
  return {
    id: record.id ?? null,
    asset_no: record.asset_no ?? null,
    country: record.country ?? null,
    site: record.site ?? null,
    vehicle_category: record.vehicle_category ?? null,
    job_card_ref: record.job_card_ref ?? null,
    current_stage: record.current_stage ?? null,
    delay_reason: record.delay_reason ?? null,
    responsible_user_id: record.responsible_user_id ?? null,
  }
}

/**
 * Compare a preview with the currently active records of the same org + country.
 * @param {object} preview  parseWorkshopSheet / parseWorkshopWorkbook result
 * @param {Array<object>} currentActiveRecords  workshop_status_records rows (current_active = true)
 * @param {{ country?: string, ignoreFields?: string[] }} [options]
 *   ignoreFields: Excel-owned fields to leave out of the comparison (e.g. a
 *   caller may choose to ignore excel_down_days, which grows by one every day).
 */
export function compareWorkshopUpload(preview, currentActiveRecords, options = {}) {
  const p = preview || {}
  const active = Array.isArray(p.active) ? p.active : []
  const closedRows = Array.isArray(p.closed) ? p.closed : []
  const invalidRecords = (Array.isArray(p.invalid) ? p.invalid : []).slice().sort(byAssetThenRow)
  const duplicateRecords = (Array.isArray(p.duplicates) ? p.duplicates : []).slice().sort(byAssetThenRow)
  const ignore = new Set(options.ignoreFields ?? DEFAULT_IGNORED_FIELDS)
  const cmpOpts = { siteAliases: options.siteAliases || null }
  const fields = EXCEL_OWNED_FIELDS.filter((f) => !ignore.has(f))
  const country = options.country ? String(options.country).trim().toUpperCase() : null

  // Current active records, keyed by canonical asset. The DB allows one active
  // record per org + country + asset; if two arrive anyway the first id wins.
  const current = new Map()
  const records = (Array.isArray(currentActiveRecords) ? currentActiveRecords : [])
    .filter((r) => r && r.current_active !== false)
    .filter((r) => !country || String(r.country ?? '').trim().toUpperCase() === country)
    .slice()
    .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')))
  for (const r of records) {
    const key = normaliseAssetNo(r.asset_no)
    if (key && !current.has(key)) current.set(key, r)
  }

  const activeAssets = new Set()
  const newRecords = []
  const changedRecords = []
  const unchangedRecords = []

  for (const row of active) {
    const asset = normaliseAssetNo(row.asset_no ?? row.data?.asset_no)
    if (!asset || activeAssets.has(asset)) continue
    activeAssets.add(asset)
    const data = excelData(row.data)
    const record = current.get(asset)
    if (!record) {
      newRecords.push({ asset_no: asset, row, data })
      continue
    }
    const changes = {}
    for (const f of fields) {
      if (normaliseForCompare(f, record[f], cmpOpts) !== normaliseForCompare(f, data[f], cmpOpts)) {
        changes[f] = { from: record[f] ?? null, to: data[f] }
      }
    }
    if (Object.keys(changes).length) changedRecords.push({ asset_no: asset, recordId: record.id ?? null, row, changes })
    else unchangedRecords.push({ asset_no: asset, recordId: record.id ?? null, row })
  }

  const closedByAsset = new Map()
  for (const row of closedRows) {
    const asset = normaliseAssetNo(row.asset_no ?? row.data?.asset_no)
    if (asset && !closedByAsset.has(asset)) closedByAsset.set(asset, row)
  }

  const removedRecords = []
  for (const [asset, record] of current) {
    if (activeAssets.has(asset)) continue
    const closedRow = closedByAsset.get(asset)
    const item = {
      asset_no: asset,
      recordId: record.id ?? null,
      record: snapshot(record),
      reason: closedRow ? 'listed_as_closed' : 'missing_from_upload',
    }
    if (closedRow) item.closedRow = closedRow
    removedRecords.push(item)
  }

  const closedRecords = closedRows
    .map((row) => ({ asset_no: normaliseAssetNo(row.asset_no ?? row.data?.asset_no), row }))
    .filter((c) => c.asset_no && !current.has(c.asset_no) && !activeAssets.has(c.asset_no))

  newRecords.sort(byAsset)
  changedRecords.sort(byAsset)
  unchangedRecords.sort(byAsset)
  removedRecords.sort(byAsset)
  closedRecords.sort((a, b) => byAsset(a, b) || (a.row.rowNumber ?? 0) - (b.row.rowNumber ?? 0))

  const removedAlsoListedClosed = removedRecords.filter((r) => r.reason === 'listed_as_closed')

  return {
    newRecords,
    changedRecords,
    unchangedRecords,
    removedRecords,
    closedRecords,
    invalidRecords,
    duplicateRecords,
    removedAlsoListedClosed,
    summary: {
      previousActive: current.size,
      rowsInFile: active.length + invalidRecords.length + duplicateRecords.length + closedRows.length,
      new: newRecords.length,
      changed: changedRecords.length,
      unchanged: unchangedRecords.length,
      removed: removedRecords.length,
      closed: closedRecords.length,
      invalid: invalidRecords.length,
      duplicate: duplicateRecords.length,
    },
  }
}
