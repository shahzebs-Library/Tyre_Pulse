/**
 * DVIR — pure helpers (no I/O) for the Driver Vehicle Inspection Reports module.
 *
 * Rolls a list of DVIR records up into an operational summary: total reports,
 * how many logged defects, how many flagged a vehicle unsafe to operate, how
 * many are still open, and how many distinct assets were inspected.
 *
 * Functions are deterministic and take no ambient state so they are fully
 * unit-testable.
 */

export const DVIR_INSPECTION_TYPES = ['pre_trip', 'post_trip']
export const DVIR_STATUSES = ['open', 'resolved', 'closed']

export const DVIR_TYPE_META = {
  pre_trip: { label: 'Pre-Trip', tone: 'blue' },
  post_trip: { label: 'Post-Trip', tone: 'violet' },
}

export const DVIR_STATUS_META = {
  open: { label: 'Open', tone: 'amber' },
  resolved: { label: 'Resolved', tone: 'green' },
  closed: { label: 'Closed', tone: 'slate' },
}

/** Coerce a value to a plain boolean (tolerates DB/string/number truthy forms). */
function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

/**
 * Roll a list of DVIR reports up into
 * { total, withDefects, unsafe, open, distinctAssets }.
 *   - total          : number of reports
 *   - withDefects     : reports where defects_found is truthy
 *   - unsafe          : reports where safe_to_operate is explicitly falsy
 *   - open            : reports whose status is 'open'
 *   - distinctAssets  : count of distinct, non-empty asset numbers inspected
 *
 * Handles null / non-array input safely (returns zeroed counts).
 */
export function summarizeDvir(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let withDefects = 0
  let unsafe = 0
  let open = 0
  const assets = new Set()

  for (const r of list) {
    if (!r) continue
    if (bool(r.defects_found)) withDefects += 1
    // A row is "unsafe" only when it explicitly declares it is not safe to
    // operate. Missing/null is treated as safe (the column defaults to true).
    if (r.safe_to_operate === false || r.safe_to_operate === 'false' || r.safe_to_operate === 0) {
      unsafe += 1
    }
    if (r.status === 'open') open += 1
    const asset = String(r.asset_no || '').trim()
    if (asset) assets.add(asset)
  }

  return {
    total: list.length,
    withDefects,
    unsafe,
    open,
    distinctAssets: assets.size,
  }
}
