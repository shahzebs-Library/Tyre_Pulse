/**
 * cpkMetrics.js - THE glossary of cost-per-distance and cost-per-hour metrics.
 *
 * WHY THIS FILE EXISTS (audit finding ENG-1, 2026-11-12). Two screens printed a
 * "cost per km" for the same country and year that differed 12.6 times
 * (KSA, 12 months to 2026-10-31: 0.0235 against 0.296 SAR). Neither was wrong
 * arithmetic. They were four different measurements sharing one name:
 *
 *   0.0168  period tyre spend / lifetime tyre km of the tyres taken off in the period
 *   0.0235  the same, with spares and oil added to the numerator (NOT a valid metric:
 *           maintenance cost over tyre km; a 12 wheel mixer contributes about twelve
 *           times its road distance to the denominator)
 *   0.0287  purchase price of retired tyres / their own validated lifetime km
 *   0.2961  tyres + spares + oil of measured assets / vehicle odometer km
 *
 * One metric, one name, one definition, one source function. Every label on a
 * screen, an export and the metric registry is built from this file. A new
 * cost-per-unit figure gets an entry here first.
 *
 * Pure, no I/O. The SQL side of each metric is named in `source.sql`.
 */

/** Stable metric ids. */
export const CPK_METRIC = Object.freeze({
  TYRE_CPK_LIFETIME: 'tyre_cpk_lifetime',
  TYRE_CPK_FITMENT: 'tyre_cpk_fitment',
  TYRE_SPEND_RATIO: 'tyre_spend_ratio',
  TYRE_COST_PER_VEHICLE_KM: 'tyre_cost_per_vehicle_km',
  MAINTENANCE_COST_PER_VEHICLE_KM: 'maintenance_cost_per_vehicle_km',
  OPERATING_COST_PER_VEHICLE_KM: 'operating_cost_per_vehicle_km',
  TYRE_COST_PER_ENGINE_HOUR: 'tyre_cost_per_engine_hour',
  OPERATING_COST_PER_ENGINE_HOUR: 'operating_cost_per_engine_hour',
})

/**
 * The definitions. `unit` is the denominator in words; `per` is the short
 * suffix printed after a currency ("SAR per tyre km").
 */
export const CPK_METRICS = Object.freeze({
  [CPK_METRIC.TYRE_CPK_LIFETIME]: {
    id: CPK_METRIC.TYRE_CPK_LIFETIME,
    name: 'Tyre CPK (lifetime)',
    short: 'Tyre CPK',
    per: 'per tyre km',
    definition:
      'Purchase price of each physical tyre, counted once, divided by the validated km that tyre ran over all of its fitments. Weighted: total price over total km of tyres that have both. Final figures use tyres no longer fitted.',
    formula: 'sum(purchase price of measurable tyres) / sum(their validated lifetime km)',
    numerator: 'tyre purchase price, one price per physical tyre',
    denominator: 'tyre km by the single km rule (placeholder, factory zero and class cap applied)',
    source: { js: 'tyreLifetime.weightedCpk, kpiEngine.computeCpkFleet', sql: 'get_tyre_lifetime_cpk, get_brand_size_cpk' },
  },
  [CPK_METRIC.TYRE_CPK_FITMENT]: {
    id: CPK_METRIC.TYRE_CPK_FITMENT,
    name: 'Tyre CPK (one fitment)',
    short: 'Fitment CPK',
    per: 'per tyre km',
    definition: 'Price of the tyre divided by the km of one fitment on one wheel. A refitted tyre has several; use the lifetime figure to judge the tyre.',
    formula: 'tyre price / fitment km',
    numerator: 'tyre purchase price',
    denominator: 'km of that fitment by the single km rule',
    source: { js: 'tyreLifetime.fitmentCpk', sql: 'calc_cpk (draft 20261113122000 routes it through tyre_km_life)' },
  },
  [CPK_METRIC.TYRE_SPEND_RATIO]: {
    id: CPK_METRIC.TYRE_SPEND_RATIO,
    name: 'Tyre spend ratio (period spend over lifetime tyre km)',
    short: 'Tyre spend ratio',
    per: 'per tyre km',
    definition:
      'Tyre spend booked in the period, on assets that have tyre km, divided by the whole lifetime km of the tyres taken off (or fitted and not yet removed) in the period. Those km were run over earlier months and years, so this is not the cost of a km driven in the period and it is not a tyre CPK.',
    formula: 'period tyre spend of matched assets / lifetime km of tyres whose removal (or issue) date is in the period',
    numerator: 'expense grid tyre bucket, dated in the period',
    denominator: 'lifetime tyre km of tyres removed or issued in the period',
    source: { js: 'cpkMetrics.sanitizeFleetCpk over api/fleetCpk.getFleetCpk', sql: 'get_fleet_cpk (fleet.km.cpk_tyre), fleet_tyre_km_by_asset' },
  },
  [CPK_METRIC.TYRE_COST_PER_VEHICLE_KM]: {
    id: CPK_METRIC.TYRE_COST_PER_VEHICLE_KM,
    name: 'Tyre cost per vehicle km',
    short: 'Tyre cost per vehicle km',
    per: 'per vehicle km',
    definition: 'Tyre spend in the period on assets with a measured distance, divided by the km those vehicles drove in the period.',
    formula: 'period tyre spend of measured assets / their odometer km in the period',
    numerator: 'expense grid tyre bucket',
    denominator: 'vehicle odometer span in the period',
    source: { js: 'costCpk.cpkWindow', sql: 'get_cost_cpk_overview (cpk.*.cpk_tyre, draft 20261113120000)' },
  },
  [CPK_METRIC.MAINTENANCE_COST_PER_VEHICLE_KM]: {
    id: CPK_METRIC.MAINTENANCE_COST_PER_VEHICLE_KM,
    name: 'Maintenance cost per vehicle km',
    short: 'Maintenance cost per vehicle km',
    per: 'per vehicle km',
    definition: 'Spare parts and oil spend in the period on assets with a measured distance, divided by the km those vehicles drove in the period. Parts and materials only; labour is not in the expense grid.',
    formula: 'period (spares + oil) of measured assets / their odometer km in the period',
    numerator: 'expense grid spare and oil buckets',
    denominator: 'vehicle odometer span in the period',
    source: { js: 'costCpk.cpkWindow', sql: 'get_cost_cpk_overview (cpk.*.cpk_maintenance, draft 20261113120000)' },
  },
  [CPK_METRIC.OPERATING_COST_PER_VEHICLE_KM]: {
    id: CPK_METRIC.OPERATING_COST_PER_VEHICLE_KM,
    name: 'Operating cost per vehicle km (parts and materials)',
    short: 'Operating cost per vehicle km',
    per: 'per vehicle km',
    definition: 'Tyres, spare parts and oil in the period on assets with a measured distance, divided by the km those vehicles drove in the period. It is the sum of the tyre and maintenance figures. Labour, fuel and depreciation are not included.',
    formula: 'period (tyres + spares + oil) of measured assets / their odometer km in the period',
    numerator: 'expense grid line cost',
    denominator: 'vehicle odometer span in the period',
    source: { js: 'costCpk.cpkWindow', sql: 'get_cost_cpk_overview (cpk.*.cpk), _cost_cpk, fleet_km_by_asset' },
  },
  [CPK_METRIC.TYRE_COST_PER_ENGINE_HOUR]: {
    id: CPK_METRIC.TYRE_COST_PER_ENGINE_HOUR,
    name: 'Tyre cost per engine hour',
    short: 'Tyre cost per hour',
    per: 'per engine hour',
    definition: 'Tyre spend in the period on hour-measured plant with meter readings, divided by the engine hours those machines ran in the period.',
    formula: 'period tyre spend of measured plant / their engine hour span in the period',
    numerator: 'expense grid tyre bucket',
    denominator: 'machine engine hours in the period',
    source: { js: 'cpkMetrics.sanitizeFleetCpk', sql: 'get_fleet_cpk (fleet.hours.cpk_tyre), fleet_hours_by_asset' },
  },
  [CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR]: {
    id: CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR,
    name: 'Operating cost per engine hour (parts and materials)',
    short: 'Operating cost per hour',
    per: 'per engine hour',
    definition: 'Tyres, spare parts and oil in the period on hour-measured plant with meter readings, divided by the engine hours those machines ran in the period.',
    formula: 'period (tyres + spares + oil) of measured plant / their engine hour span in the period',
    numerator: 'expense grid line cost',
    denominator: 'machine engine hours in the period',
    source: { js: 'cpkMetrics.sanitizeFleetCpk', sql: 'get_fleet_cpk (fleet.hours.cpk_total), fleet_hours_by_asset' },
  },
})

/** Why a "total cost per km" on the tyre-km basis is never shown. */
export const TOTAL_PER_TYRE_KM_WITHHELD =
  'Not shown: spare parts and oil cannot be divided by tyre km. See operating cost per vehicle km on Expenses and CPK.'

/** One-line basis printed beside the tyre spend ratio wherever it appears. */
export const TYRE_SPEND_RATIO_BASIS =
  'Tyre spend in the period over the lifetime km of the tyres taken off in the period. Not a tyre CPK.'

/** Definition of a metric, or null for an unknown id. */
export function metricDef(id) {
  return CPK_METRICS[id] || null
}

/** "Tyre CPK (lifetime), SAR per tyre km". Currency optional. */
export function metricLabel(id, currency) {
  const m = metricDef(id)
  if (!m) return ''
  return currency ? `${m.name}, ${currency} ${m.per}` : m.name
}

/** Short label for a tile or a column header. */
export function metricShort(id, currency) {
  const m = metricDef(id)
  if (!m) return ''
  return currency ? `${m.short} (${currency} ${m.per})` : m.short
}

const isHours = (unit) => unit === 'engine_hours' || unit === 'hours'

/** The metric a get_fleet_cpk row's tyre rate is, by its unit. */
export function tyreRateMetric(unit) {
  return isHours(unit) ? CPK_METRIC.TYRE_COST_PER_ENGINE_HOUR : CPK_METRIC.TYRE_SPEND_RATIO
}

/**
 * The metric a get_fleet_cpk row's TOTAL rate is, by its unit. Null for km:
 * the km side divides by tyre km, so a total (with spares and oil) is not a
 * measurement and is withheld.
 */
export function totalRateMetric(unit) {
  return isHours(unit) ? CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR : null
}

const fin = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * The one rate a row may be ranked or charted by: operating cost per engine
 * hour for hour-measured plant, the tyre spend ratio for km assets. Null when
 * the row has no denominator.
 */
export function rowRate(row) {
  if (!row) return null
  return isHours(row.unit) ? fin(row.cpk_total) : fin(row.cpk_tyre)
}

/** Metric id of `rowRate(row)`. */
export function rowRateMetric(row) {
  return isHours(row?.unit) ? CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR : CPK_METRIC.TYRE_SPEND_RATIO
}

function sanitizeRow(row) {
  if (!row || typeof row !== 'object') return row
  if (isHours(row.unit)) return { ...row, rate: fin(row.cpk_total), rate_metric: CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR }
  // km side: the denominator is tyre km. The total (tyres + spares + oil) over
  // tyre km is withheld; the raw server value is kept only for traceability.
  const { cpk_total: legacy, ...rest } = row
  return {
    ...rest,
    cpk_total: null,
    cpk_total_withheld: true,
    legacy_total_per_tyre_km: fin(legacy) ?? row.legacy_total_per_tyre_km ?? null,
    rate: fin(row.cpk_tyre),
    rate_metric: CPK_METRIC.TYRE_SPEND_RATIO,
  }
}

function sanitizeFleetRow(f) {
  if (!f || typeof f !== 'object') return f
  const km = f.km && typeof f.km === 'object'
    ? { ...f.km, cpk_total: null, cpk_total_withheld: true, legacy_total_per_tyre_km: fin(f.km.cpk_total) ?? f.km.legacy_total_per_tyre_km ?? null, metric: CPK_METRIC.TYRE_SPEND_RATIO }
    : f.km
  const hours = f.hours && typeof f.hours === 'object'
    ? { ...f.hours, metric: CPK_METRIC.TYRE_COST_PER_ENGINE_HOUR, total_metric: CPK_METRIC.OPERATING_COST_PER_ENGINE_HOUR }
    : f.hours
  return { ...f, km, hours }
}

/**
 * THE GATE. Every get_fleet_cpk payload passes through here before any screen
 * or export sees it (api/fleetCpk.getFleetCpk). On km rows it removes the
 * "total cost per km" (maintenance over tyre km) and names what the remaining
 * tyre rate really is; hour rows are valid per machine engine hour and pass.
 * Idempotent.
 *
 * @param {{ perVehicle?:Array, byType?:Array, fleet?:Array }} payload
 */
export function sanitizeFleetCpk(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  return {
    ...p,
    perVehicle: (Array.isArray(p.perVehicle) ? p.perVehicle : []).map(sanitizeRow),
    byType: (Array.isArray(p.byType) ? p.byType : []).map(sanitizeRow),
    fleet: (Array.isArray(p.fleet) ? p.fleet : []).map(sanitizeFleetRow),
  }
}

/** Rows for a glossary table (docs, an "About these figures" panel, an export sheet). */
export function glossaryRows() {
  return Object.values(CPK_METRICS).map((m) => ({
    metric: m.name,
    definition: m.definition,
    formula: m.formula,
    source: `JS ${m.source.js}; SQL ${m.source.sql}`,
  }))
}
