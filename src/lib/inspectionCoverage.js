/**
 * Completed tyre inspections, grouped by tyre man (inspector) and vehicle type.
 *
 * Feeds the "Inspection Summary" report (Scheduled Reports / on-demand
 * generation) so a day-scoped run - e.g. the "Yesterday" coverage window -
 * answers "who did what, on which vehicle type, and how many" as a single
 * table, instead of a raw per-record list nobody wants to hand-tally.
 *
 * Pure over rows the caller already fetched: nothing here queries the
 * database, and nothing invents a tyre man or a vehicle type - a blank value
 * is reported as "Unassigned" / "Unspecified" rather than silently dropped,
 * so the totals still reconcile to the row count.
 *
 * "Completed" mirrors the definition already used by the Inspection
 * Intelligence activity board (src/lib/inspectorActivity.js): a record with a
 * completed_date, or whose status is 'Done'. An inspection still open is not
 * counted - it has not been "done" yet, so it does not belong in a completed
 * tally.
 */

const UNASSIGNED = 'Unassigned'
const UNSPECIFIED = 'Unspecified'

const txt = (v) => String(v ?? '').trim()

/** Same rule as inspectorActivity.inspectorActivity() - keep both in sync. */
export function isCompletedInspection(row) {
  return !!(row?.completed_date || row?.status === 'Done')
}

/**
 * Build the tyre man x vehicle type pivot over completed inspections.
 *
 * @param {Array} inspections rows carrying at least inspector/vehicle_type/
 *   status/completed_date
 * @returns {{
 *   vehicleTypes: string[],
 *   rows: Array<{inspector:string, total:number, byType:Record<string,number>}>,
 *   totalsByType: Record<string,number>,
 *   grandTotal: number,
 *   totalInspections: number,
 * }}
 */
export function tyreManVehicleTypeSummary(inspections) {
  const all = Array.isArray(inspections) ? inspections : []
  const completed = all.filter(isCompletedInspection)

  const typeSet = new Set()
  const byInspector = new Map()

  for (const r of completed) {
    const inspector = txt(r?.inspector) || UNASSIGNED
    const vehicleType = txt(r?.vehicle_type) || UNSPECIFIED
    typeSet.add(vehicleType)

    let entry = byInspector.get(inspector)
    if (!entry) {
      entry = { inspector, total: 0, byType: {} }
      byInspector.set(inspector, entry)
    }
    entry.total += 1
    entry.byType[vehicleType] = (entry.byType[vehicleType] || 0) + 1
  }

  const vehicleTypes = [...typeSet].sort()
  const rows = [...byInspector.values()].sort(
    (a, b) => b.total - a.total || a.inspector.localeCompare(b.inspector),
  )

  const totalsByType = {}
  for (const vt of vehicleTypes) {
    totalsByType[vt] = rows.reduce((s, r) => s + (r.byType[vt] || 0), 0)
  }

  return {
    vehicleTypes,
    rows,
    totalsByType,
    grandTotal: completed.length,
    totalInspections: all.length,
  }
}

/**
 * Flatten the pivot into export-ready columns/headers/rows (one row per tyre
 * man, one column per vehicle type, a Total column, and a trailing "All Tyre
 * Men" totals row). Column keys are stable slugs derived from the vehicle
 * type label so a name containing spaces/punctuation still round-trips.
 */
export function tyreManVehicleTypeTable(summary) {
  const s = summary || tyreManVehicleTypeSummary([])
  const typeKey = (vt, i) => `vt_${i}`
  const keys = s.vehicleTypes.map((vt, i) => typeKey(vt, i))

  const columns = ['inspector', ...keys, 'total']
  const headers = ['Tyre Man', ...s.vehicleTypes, 'Total Completed']

  const rows = s.rows.map((r) => {
    const row = { inspector: r.inspector, total: r.total }
    s.vehicleTypes.forEach((vt, i) => { row[keys[i]] = r.byType[vt] || 0 })
    return row
  })

  // Always append the totals row, even when nobody has completed anything yet
  // - "0 completed" is an answer, and dropping the row silently omits a
  // window that genuinely had no completions rather than stating it.
  const totalsRow = { inspector: 'All Tyre Men', total: s.grandTotal }
  s.vehicleTypes.forEach((vt, i) => { totalsRow[keys[i]] = s.totalsByType[vt] || 0 })
  rows.push(totalsRow)

  return { columns, headers, rows }
}
