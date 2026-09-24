/**
 * Tenant Data Export: pure engine (no I/O).
 *
 * The console page exports ONE organisation's dataset for portability,
 * offboarding or legal hold. The server (admin_tenant_export_* RPCs) owns the
 * table safelist and the org predicate; this module shapes what comes back and,
 * above all, keeps the export HONEST about completeness:
 *
 *   - a table whose read failed is FAILED, never "0 rows";
 *   - a table that stopped at the client ceiling is TRUNCATED and says at how
 *     many of how many;
 *   - a table whose fetched count differs from the manifest count (rows written
 *     during the export) is flagged as drifted;
 *   - the Excel file additionally respects max_export_rows and the per-sheet
 *     limit of Excel itself, and says so when either bites.
 *
 * An export that claims to be complete when it is not is the one failure mode
 * that matters for legal hold, so every summary here errs towards "partial".
 */

export const PAGE_SIZE = 1000
export const DEFAULT_CEILING = 100000
export const CEILING_OPTIONS = [
  { value: '25000', label: '25,000 rows per table' },
  { value: '100000', label: '100,000 rows per table' },
  { value: '250000', label: '250,000 rows per table' },
  { value: '500000', label: '500,000 rows per table' },
]
/** Excel's own per-sheet row limit, minus the header row. */
export const EXCEL_SHEET_MAX = 1048575
export const MIN_REASON = 5

const LABELS = {
  accidents: 'Accidents',
  alerts: 'Alerts',
  asset_breakdowns: 'Asset breakdowns',
  asset_disposals: 'Asset disposals',
  budgets: 'Budgets',
  checklist_submissions: 'Checklist submissions',
  corrective_actions: 'Corrective actions',
  drivers: 'Drivers',
  engine_hours_logs: 'Engine hour readings',
  gate_passes: 'Gate passes',
  goods_receipts: 'Goods receipts',
  inspections: 'Inspections',
  insurance_policies: 'Insurance policies',
  material_issues: 'Material issues',
  material_master: 'Material master',
  odometer_logs: 'Odometer readings',
  parts_consumption: 'Expense lines',
  parts_requests: 'Parts requests',
  pm_programs: 'PM programs',
  pm_service_records: 'PM service records',
  production_logs: 'Production (m3)',
  purchase_orders: 'Purchase orders',
  rca_records: 'Root cause records',
  repair_requests: 'Repair requests',
  sany_invoices: 'SANY invoices',
  sco_costs: 'SCO costs',
  sites: 'Sites',
  stock_records: 'Stock records',
  suppliers: 'Suppliers',
  tyre_records: 'Tyre records',
  tyre_rotations: 'Tyre rotations',
  tyre_status_marks: 'Tyre status marks',
  vehicle_fleet: 'Vehicle fleet',
  warranty_claims: 'Warranty claims',
  wash_records: 'Wash records',
  work_order_line_items: 'Job card lines',
  work_orders: 'Job cards',
}

export function tableLabel(table) {
  if (LABELS[table]) return LABELS[table]
  const s = String(table || '').replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown'
}

function toCount(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

/** Shape the manifest RPC payload. Tables sorted largest first; errors kept. */
export function shapeManifest(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const tables = (Array.isArray(r.tables) ? r.tables : [])
    .filter((t) => t && t.table)
    .map((t) => ({
      table: String(t.table),
      label: tableLabel(t.table),
      rows: toCount(t.rows),
      error: t.error || null,
    }))
    .sort((a, b) => (b.rows ?? -1) - (a.rows ?? -1) || a.table.localeCompare(b.table))
  const unreadable = tables.filter((t) => t.rows == null).length
  return {
    orgId: r.org_id || null,
    orgName: r.org_name || '',
    generatedAt: r.generated_at || null,
    totalRows: toCount(r.total_rows) ?? tables.reduce((s, t) => s + (t.rows || 0), 0),
    tables,
    unreadable,
    nonEmpty: tables.filter((t) => (t.rows || 0) > 0).length,
  }
}

/** Default selection: every table that has at least one row. */
export function defaultSelection(manifest) {
  return new Set((manifest?.tables || []).filter((t) => (t.rows || 0) > 0).map((t) => t.table))
}

export function validateReason(reason) {
  const s = String(reason || '').trim()
  if (s.length < MIN_REASON) return `Give a reason of at least ${MIN_REASON} characters. It is recorded with the export.`
  return null
}

export function parseCeiling(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= PAGE_SIZE ? Math.floor(n) : DEFAULT_CEILING
}

/** What the export will do for each selected table, before it runs. */
export function planExport(manifest, selected, ceiling = DEFAULT_CEILING) {
  const sel = selected instanceof Set ? selected : new Set(selected || [])
  const cap = parseCeiling(ceiling)
  const items = (manifest?.tables || [])
    .filter((t) => sel.has(t.table))
    .map((t) => ({
      table: t.table,
      label: t.label,
      expected: t.rows,
      willFetch: t.rows == null ? null : Math.min(t.rows, cap),
      willTruncate: t.rows != null && t.rows > cap,
      pages: t.rows == null ? null : Math.max(1, Math.ceil(Math.min(t.rows, cap) / PAGE_SIZE)),
    }))
  return {
    items,
    tables: items.length,
    expectedRows: items.reduce((s, i) => s + (i.expected || 0), 0),
    fetchRows: items.reduce((s, i) => s + (i.willFetch || 0), 0),
    pages: items.reduce((s, i) => s + (i.pages || 0), 0),
    truncating: items.filter((i) => i.willTruncate).map((i) => i.table),
  }
}

/**
 * Classify one table's result. `result` = { table, expected, rows[], complete,
 * truncated, error }. Outcome is one of complete | truncated | drifted | failed.
 */
export function tableOutcome(result) {
  const fetched = Array.isArray(result?.rows) ? result.rows.length : 0
  if (result?.error) return { outcome: 'failed', fetched }
  if (result?.truncated) return { outcome: 'truncated', fetched }
  if (!result?.complete) return { outcome: 'failed', fetched }
  if (result.expected != null && fetched !== result.expected) return { outcome: 'drifted', fetched }
  return { outcome: 'complete', fetched }
}

/**
 * Roll up every table. Status is 'completed' ONLY when every table is complete;
 * any truncation or drift makes it 'partial'; nothing fetched at all with
 * failures is 'failed'.
 */
export function summarizeResults(results = []) {
  const per = results.map((r) => ({ ...r, ...tableOutcome(r), label: tableLabel(r.table) }))
  const counts = {}
  per.forEach((p) => { counts[p.table] = p.fetched })
  const failed = per.filter((p) => p.outcome === 'failed')
  const truncated = per.filter((p) => p.outcome === 'truncated')
  const drifted = per.filter((p) => p.outcome === 'drifted')
  const totalRows = per.reduce((s, p) => s + p.fetched, 0)
  let status = 'completed'
  if (failed.length || truncated.length || drifted.length) status = 'partial'
  if (per.length && failed.length === per.length) status = 'failed'
  if (!per.length) status = 'failed'
  const notes = []
  failed.forEach((p) => notes.push(`${p.label}: the read failed after ${p.fetched} rows${p.error ? ` (${p.error})` : ''}. This table is NOT complete.`))
  truncated.forEach((p) => notes.push(`${p.label}: stopped at the ceiling, ${p.fetched} of ${p.expected ?? 'an unknown number of'} rows. This table is NOT complete.`))
  drifted.forEach((p) => notes.push(`${p.label}: ${p.fetched} rows exported but the manifest counted ${p.expected}. Rows changed while the export ran.`))
  return { per, counts, status, totalRows, failed, truncated, drifted, notes, complete: status === 'completed' }
}

/** Flatten a row for a spreadsheet cell: objects and arrays become JSON text. */
export function flattenRow(row) {
  const out = {}
  Object.entries(row || {}).forEach(([k, v]) => {
    if (v == null) out[k] = ''
    else if (typeof v === 'object') out[k] = JSON.stringify(v)
    else out[k] = v
  })
  return out
}

/**
 * Sheets for exportSheetsToExcel. `maxExportRows` is the admin policy cap
 * (exportSheetsToExcel applies it silently), so the note says so here.
 */
export function buildWorkbookSheets(results = [], { maxExportRows = 0 } = {}) {
  const summary = summarizeResults(results)
  const policyCap = Number(maxExportRows) > 0 ? Number(maxExportRows) : 0
  const sheetCap = policyCap ? Math.min(policyCap, EXCEL_SHEET_MAX) : EXCEL_SHEET_MAX
  const notes = [...summary.notes]
  const sheets = summary.per.map((p) => {
    const rows = (p.rows || []).map(flattenRow)
    const cut = rows.length > sheetCap
    if (cut) {
      notes.push(`${p.label}: the Excel sheet holds the first ${sheetCap} of ${rows.length} exported rows (${policyCap && sheetCap === policyCap ? 'max export rows policy' : 'Excel sheet limit'}). Use the JSON bundle for the full table.`)
    }
    const flag = p.outcome === 'complete' ? 'complete'
      : p.outcome === 'truncated' ? 'TRUNCATED'
        : p.outcome === 'drifted' ? 'count changed during export' : 'FAILED'
    return {
      name: p.label,
      rows: cut ? rows.slice(0, sheetCap) : rows,
      note: `${p.table}: ${p.fetched} rows exported, manifest ${p.expected ?? 'unknown'}, ${flag}${cut ? ', sheet cut' : ''}`,
      emptyNote: p.outcome === 'failed'
        ? 'This table could not be read. It is not empty; it is missing from this export.'
        : 'This organisation has no rows in this table.',
    }
  })
  return { sheets, notes, status: summary.status, summary }
}

/** The JSON bundle: meta + completeness per table + the rows themselves. */
export function buildJsonBundle({ manifest, results = [], reason, exportedAt, jobId, exportedBy } = {}) {
  const summary = summarizeResults(results)
  return {
    format: 'tyrepulse.tenant-export',
    version: 1,
    organisation: { id: manifest?.orgId || null, name: manifest?.orgName || '' },
    exported_at: exportedAt || new Date().toISOString(),
    exported_by: exportedBy || null,
    job_id: jobId || null,
    reason: String(reason || '').trim(),
    status: summary.status,
    complete: summary.complete,
    notes: summary.notes,
    tables: Object.fromEntries(summary.per.map((p) => [p.table, {
      label: p.label,
      manifest_rows: p.expected ?? null,
      exported_rows: p.fetched,
      outcome: p.outcome,
      error: p.error || null,
    }])),
    data: Object.fromEntries(summary.per.map((p) => [p.table, p.rows || []])),
  }
}

/** Bars for the manifest chart: the largest `limit` non-empty tables. */
export function manifestBars(manifest, limit = 12) {
  return (manifest?.tables || [])
    .filter((t) => (t.rows || 0) > 0)
    .slice(0, limit)
    .map((t) => ({ label: t.label, value: t.rows }))
}

export function safeFileStem(name) {
  const s = String(name || 'Tenant').replace(/[^A-Za-z0-9 ()]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s || 'Tenant'
}
