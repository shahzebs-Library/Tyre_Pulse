/**
 * Inventory report catalogue (pure).
 *
 * Every export carries a report reference, the filters it was run with and a
 * snapshot timestamp, so a file found weeks later says exactly what it covers.
 * Money columns always sit beside their currency; nothing is blended.
 */

export const REPORTS = [
  {
    key: 'register', titleKey: 'inventory.reports.register', source: 'balances', dated: false,
    columns: [
      ['item_code', 'Item code'], ['description', 'Description'], ['site', 'Site'], ['location_code', 'Location'],
      ['condition', 'Condition'], ['ownership', 'Ownership'], ['qty_on_hand', 'On hand'], ['qty_reserved', 'Reserved'],
      ['avg_unit_cost', 'Average unit cost'], ['currency', 'Currency'],
    ],
  },
  {
    key: 'movements', titleKey: 'inventory.reports.movements', source: 'movements', dated: true,
    columns: [
      ['posted_at', 'Posted'], ['movement_type', 'Type'], ['item_code', 'Item code'], ['site', 'Site'],
      ['location_code', 'Location'], ['qty_change', 'Quantity change'], ['unit_cost', 'Unit cost'],
      ['value_change', 'Value change'], ['currency', 'Currency'], ['source_doc_type', 'Source document'],
      ['source_doc_id', 'Source reference'], ['reason', 'Reason'],
    ],
  },
  {
    key: 'audits', titleKey: 'inventory.reports.audits', source: 'audits', dated: true,
    columns: [
      ['ref', 'Audit reference'], ['audit_type', 'Type'], ['site', 'Site'], ['status', 'Status'],
      ['due_at', 'Due'], ['snapshot_at', 'Snapshot taken'], ['created_at', 'Created'],
    ],
  },
  {
    key: 'discrepancies', titleKey: 'inventory.reports.discrepancies', source: 'discrepancies', dated: true,
    columns: [
      ['audit_ref', 'Audit'], ['item_code', 'Item code'], ['location_code', 'Location'], ['category', 'Category'],
      ['variance_qty', 'Variance quantity'], ['value_impact', 'Value impact'], ['currency', 'Currency'],
      ['status', 'Status'], ['created_at', 'Raised'],
    ],
  },
  {
    key: 'tyres', titleKey: 'inventory.reports.tyres', source: 'tyreItems', dated: false,
    columns: [
      ['serial_no', 'Serial'], ['custody_state', 'Custody state'], ['site', 'Site'], ['location_code', 'Location'],
      ['asset_no', 'Asset'], ['position', 'Position'], ['purchase_cost', 'Purchase cost'], ['currency', 'Currency'],
    ],
  },
  {
    key: 'conflicts', titleKey: 'inventory.reports.conflicts', source: 'conflicts', dated: false,
    columns: [
      ['serial_no', 'Serial'], ['conflict_type', 'Conflict'], ['status', 'Status'], ['detected_at', 'Detected'],
      ['evidence_text', 'Evidence'],
    ],
  },
]

export const reportByKey = (key) => REPORTS.find((r) => r.key === key) || null

const pad = (x) => String(x).padStart(2, '0')

/** INV-REGISTER-202611191430 - stable, sortable, unique to the minute. */
export function makeReportRef(key, now = new Date()) {
  const d = now instanceof Date ? now : new Date(now)
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`
  return `INV-${String(key || 'REPORT').toUpperCase()}-${stamp}`
}

/** "Country: KSA | Site: NHC | From 2026-11-01 to 2026-11-19". Never empty. */
export function describeFilters(f = {}) {
  const parts = []
  parts.push(`Country: ${f.country && f.country !== 'All' ? f.country : 'All countries'}`)
  if (f.site && f.site !== 'all') parts.push(`Site: ${f.site}`)
  if (f.status && f.status !== 'all') parts.push(`Status: ${f.status}`)
  if (f.from || f.to) parts.push(`From ${f.from || 'start'} to ${f.to || 'today'}`)
  return parts.join(' | ')
}

/** Rows -> plain export rows, flattening evidence objects to readable text. */
export function exportRowsFor(report, rows) {
  const keys = (report?.columns || []).map(([k]) => k)
  return (rows || []).map((r) => {
    const o = {}
    for (const k of keys) {
      let v = k === 'evidence_text' ? r.evidence : r[k]
      if (v && typeof v === 'object') v = JSON.stringify(v)
      o[k] = v === null || v === undefined || v === '' ? 'N/A' : v
    }
    return o
  })
}
