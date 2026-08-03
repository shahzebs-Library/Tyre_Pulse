/**
 * cpkReport.js - pure, no-I/O engine for the CUSTOMIZABLE Fleet CPK report.
 *
 * The CPK Intelligence page already loads the fleet data (get_fleet_cpk); the
 * Report panel lets a user pick which SECTIONS and which COLUMNS appear, then this
 * engine turns those choices plus the loaded rows into a normalized, render-ready
 * report object. It is deliberately free of the DOM and the network so the honesty
 * rules (a null CPK is "N/A", never a fabricated 0; money is one country's currency,
 * never blended) are unit-testable here rather than buried in JSX.
 *
 * Every row is one country's data in one currency (passed in); this engine never
 * mixes currencies - it only ever formats/sorts/filters the rows it is given.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** True when a CPK figure has no measured denominator (render "N/A", never 0). */
export function isCpkNull(v) {
  return v == null || !Number.isFinite(Number(v))
}

/**
 * The toggleable report sections. `defaultOn` seeds a first-time layout; the panel
 * persists the user's own choice afterwards.
 */
export const REPORT_SECTIONS = [
  { key: 'fleet_summary', label: 'Fleet summary (KPIs)', defaultOn: true },
  { key: 'by_type', label: 'Cost by asset type', defaultOn: true },
  { key: 'per_vehicle', label: 'Per vehicle', defaultOn: true },
  { key: 'worst_cpk', label: 'Worst CPK (highest cost per unit)', defaultOn: true },
  { key: 'best_value', label: 'Best value (lowest CPK)', defaultOn: false },
  { key: 'km_coverage', label: 'Meter coverage', defaultOn: false },
]

/** Selectable per-vehicle columns. `money` marks a currency amount for formatting. */
export const PER_VEHICLE_COLUMNS = [
  { key: 'asset_no', header: 'Asset' },
  { key: 'vehicle_type', header: 'Type' },
  { key: 'unit', header: 'Unit' },
  { key: 'distance_or_hours', header: 'Km / Hours' },
  { key: 'tyre_cost', header: 'Tyre cost', money: true },
  { key: 'maintenance_cost', header: 'Maintenance cost', money: true },
  { key: 'total_cost', header: 'Total cost', money: true },
  { key: 'cpk_tyre', header: 'CPK tyre' },
  { key: 'cpk_total', header: 'CPK total' },
]

/** Selectable by-type columns (a rolled-up view; no per-asset id). */
export const BY_TYPE_COLUMNS = [
  { key: 'vehicle_type', header: 'Asset type' },
  { key: 'unit', header: 'Unit' },
  { key: 'distance_or_hours', header: 'Km / Hours' },
  { key: 'tyre_cost', header: 'Tyre cost', money: true },
  { key: 'maintenance_cost', header: 'Maintenance cost', money: true },
  { key: 'total_cost', header: 'Total cost', money: true },
  { key: 'cpk_tyre', header: 'CPK tyre' },
  { key: 'cpk_total', header: 'CPK total' },
]

const DEFAULT_SECTIONS = REPORT_SECTIONS.filter((s) => s.defaultOn).map((s) => s.key)
const DEFAULT_PV_COLUMNS = PER_VEHICLE_COLUMNS.map((c) => c.key)
const DEFAULT_BT_COLUMNS = BY_TYPE_COLUMNS.map((c) => c.key)

/** Section keys turned on, in canonical REPORT_SECTIONS order. */
function resolveSections(sections) {
  const on = new Set(Array.isArray(sections) ? sections : DEFAULT_SECTIONS)
  return REPORT_SECTIONS.filter((s) => on.has(s.key)).map((s) => s.key)
}

/** Ordered column definitions the user selected, from a catalog. */
function resolveColumns(selected, catalog, fallback) {
  const on = new Set(Array.isArray(selected) && selected.length ? selected : fallback)
  const cols = catalog.filter((c) => on.has(c.key))
  return cols.length ? cols : catalog.slice()
}

/** Thousands-separated integer; "N/A" for a non-finite money value. */
export function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  return Math.round(Number(v)).toLocaleString('en-US')
}

/** Money = "SAR 12,345"; never blends currency (currency is passed in). */
export function fmtMoney(v, currency) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  return `${currency} ${Math.round(Number(v)).toLocaleString('en-US')}`
}

/** CPK to 4dp; null denominator -> "N/A" (never 0). */
export function fmtCpk(v, currency) {
  if (isCpkNull(v)) return 'N/A'
  return `${currency} ${Number(v).toFixed(4)}`
}

const UNIT_WORD = (u) => (u === 'engine_hours' ? 'hour' : 'km')

/** Format one cell of a table row for display, honoring money/cpk/unit columns. */
function formatCell(row, col, currency) {
  const raw = row?.[col.key]
  if (col.key === 'cpk_tyre' || col.key === 'cpk_total') return fmtCpk(raw, currency)
  if (col.key === 'unit') return UNIT_WORD(raw)
  if (col.money) return fmtMoney(raw, currency)
  // A 0 (or absent) distance/hours means "no measured denominator" -> N/A, not "0",
  // matching the app's fmtDistance honesty (a 0 km reads as measured, which it is not).
  if (col.key === 'distance_or_hours') return num(raw) > 0 ? fmtInt(raw) : 'N/A'
  return raw == null || raw === '' ? 'N/A' : String(raw)
}

/** Raw export value for a cell (numbers stay numbers; cpk keeps "N/A"). */
function exportCell(row, col) {
  const raw = row?.[col.key]
  if (col.key === 'cpk_tyre' || col.key === 'cpk_total') {
    return isCpkNull(raw) ? 'N/A' : Number(Number(raw).toFixed(4))
  }
  if (col.key === 'unit') return UNIT_WORD(raw)
  if (col.money || col.key === 'distance_or_hours') {
    return Number.isFinite(Number(raw)) ? Math.round(Number(raw)) : 'N/A'
  }
  return raw == null ? '' : raw
}

/** Build a table section {kind:'table'} from rows + resolved columns. */
function tableSection(key, label, rows, cols, currency) {
  return {
    key,
    label,
    kind: 'table',
    columns: cols.map((c) => ({ key: c.key, header: c.header, money: !!c.money })),
    rows: rows.map((r) => ({
      raw: r,
      cells: cols.map((c) => ({ key: c.key, display: formatCell(r, c, currency), value: exportCell(r, c) })),
    })),
  }
}

/**
 * Per-vehicle rows that have a real cpk_total, sorted. Rows with a null CPK are
 * EXCLUDED (a missing denominator is neither the worst nor the best).
 * @param {Array} perVehicle
 * @param {'desc'|'asc'} dir  desc = worst (highest) first; asc = best (lowest) first
 * @param {number} topN
 */
export function rankByCpkTotal(perVehicle = [], dir = 'desc', topN = 10) {
  const rated = (Array.isArray(perVehicle) ? perVehicle : []).filter((r) => !isCpkNull(r?.cpk_total))
  rated.sort((a, b) => {
    const d = Number(a.cpk_total) - Number(b.cpk_total)
    if (d !== 0) return dir === 'asc' ? d : -d
    // stable-ish tiebreak: larger total_cost first
    return num(b.total_cost) - num(a.total_cost)
  })
  const n = Number.isFinite(topN) && topN > 0 ? topN : rated.length
  return rated.slice(0, n)
}

/** Meter-coverage KPI/counts from the fleet[] row + per-vehicle rows. */
export function coverageSummary(fleet = [], perVehicle = []) {
  const row = (Array.isArray(fleet) ? fleet : [])[0] || null
  const pv = Array.isArray(perVehicle) ? perVehicle : []
  const measured = pv.filter((r) => num(r?.distance_or_hours) > 0).length
  const pct = row && Number.isFinite(Number(row.coverage_pct)) ? Number(row.coverage_pct) : null
  return {
    coverage_pct: pct,
    measured_assets: measured,
    unmeasured_assets: Math.max(0, pv.length - measured),
    total_assets: pv.length,
    unregistered_cost: row ? num(row.unregistered_cost) : 0,
  }
}

/**
 * Build the normalized, render-ready report object honoring the section + column
 * toggles. Pure: no DOM, no network. Money is `currency` throughout (one country).
 *
 * @param {object} args
 * @param {Array}  args.perVehicle  [{ asset_no, vehicle_type, unit, distance_or_hours, tyre_cost, maintenance_cost, total_cost, cpk_tyre, cpk_total }]
 * @param {Array}  args.byType      same shape rolled up per vehicle_type
 * @param {Array}  args.fleet       [{ country, currency, cpk_tyre, cpk_total, coverage_pct, unregistered_cost, ... }]
 * @param {string[]} [args.sections] section keys turned on
 * @param {object} [args.columns]   { perVehicle:string[], byType:string[] } selected column keys
 * @param {number} [args.topN=10]   size of worst/best subsets
 * @param {string} [args.currency]  currency label (falls back to fleet[0].currency)
 * @returns {{ currency:string, sections:Array }}
 */
export function buildCpkReport({
  perVehicle = [], byType = [], fleet = [],
  sections, columns = {}, topN = 10, currency,
} = {}) {
  const fleetRow = (Array.isArray(fleet) ? fleet : [])[0] || null
  const curr = currency || fleetRow?.currency || fleetRow?.country || ''
  const wantedSections = resolveSections(sections)
  const pvCols = resolveColumns(columns.perVehicle, PER_VEHICLE_COLUMNS, DEFAULT_PV_COLUMNS)
  const btCols = resolveColumns(columns.byType, BY_TYPE_COLUMNS, DEFAULT_BT_COLUMNS)

  const pv = Array.isArray(perVehicle) ? perVehicle : []
  const bt = Array.isArray(byType) ? byType : []
  const out = []

  for (const key of wantedSections) {
    if (key === 'fleet_summary') {
      const tiles = [
        { label: 'Fleet CPK (tyre)', value: fmtCpk(fleetRow?.cpk_tyre, curr) },
        { label: 'Fleet CPK (total)', value: fmtCpk(fleetRow?.cpk_total, curr) },
        {
          label: 'Meter coverage',
          value: fleetRow && Number.isFinite(Number(fleetRow.coverage_pct))
            ? `${Number(fleetRow.coverage_pct).toFixed(0)}%`
            : 'N/A',
        },
        { label: 'Vehicles measured', value: fmtInt(pv.filter((r) => num(r?.distance_or_hours) > 0).length) },
      ]
      out.push({ key, label: 'Fleet summary', kind: 'kpis', tiles })
    } else if (key === 'by_type') {
      out.push(tableSection(key, 'Cost by asset type', bt, btCols, curr))
    } else if (key === 'per_vehicle') {
      out.push(tableSection(key, 'Per vehicle', pv, pvCols, curr))
    } else if (key === 'worst_cpk') {
      out.push(tableSection(key, `Worst CPK (top ${topN})`, rankByCpkTotal(pv, 'desc', topN), pvCols, curr))
    } else if (key === 'best_value') {
      out.push(tableSection(key, `Best value (lowest CPK, top ${topN})`, rankByCpkTotal(pv, 'asc', topN), pvCols, curr))
    } else if (key === 'km_coverage') {
      const c = coverageSummary(fleet, pv)
      out.push({
        key,
        label: 'Meter coverage',
        kind: 'kpis',
        tiles: [
          { label: 'Coverage', value: c.coverage_pct == null ? 'N/A' : `${c.coverage_pct.toFixed(0)}%` },
          { label: 'Assets with measured km/hours', value: fmtInt(c.measured_assets) },
          { label: 'Assets without a meter', value: fmtInt(c.unmeasured_assets) },
          { label: 'Unregistered cost', value: fmtMoney(c.unregistered_cost, curr) },
        ],
      })
    }
  }

  return { currency: curr, sections: out }
}

/**
 * Flatten a built report into rows for Excel. Each row carries a `section` column
 * plus the report's own columns; KPI sections emit label/value pairs. Pure.
 * @returns {Array<object>}
 */
export function cpkReportExportRows(report) {
  const rows = []
  for (const s of report?.sections || []) {
    if (s.kind === 'kpis') {
      for (const t of s.tiles || []) {
        rows.push({ section: s.label, metric: t.label, value: t.value })
      }
    } else if (s.kind === 'table') {
      for (const r of s.rows || []) {
        const obj = { section: s.label }
        for (const cell of r.cells) obj[cell.key] = cell.value
        rows.push(obj)
      }
    }
  }
  return rows
}
