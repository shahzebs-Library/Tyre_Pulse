/**
 * Metric Registry / "Explain This Number" - pure display engine (V473).
 *
 * NO I/O here (no supabase import). This module normalises the json returned by
 * the explain_metric RPC into a stable camelCase display object, and provides the
 * small pure helpers the UI needs (freshness age, list formatting, panel order).
 *
 * Every mapped field is guarded with a safe default (null / [] , never undefined)
 * so a partially-populated registry row can never crash a panel. ASCII only.
 */

/** A metric with no fresh data arrival within this many hours is flagged stale. */
export const STALE_HOURS = 48

/** Ordered panel groups for the Explain-This-Number UI. */
export const EXPLAIN_SECTIONS = [
  { key: 'definition', label: 'Definition' },
  { key: 'formula', label: 'Formula & version' },
  { key: 'source', label: 'Source & lineage' },
  { key: 'filters', label: 'Filters & rules' },
  { key: 'freshness', label: 'Freshness' },
  { key: 'provenance', label: 'Records' },
]

/** Coerce a value to a finite number, else null (0 is preserved and honest). */
export function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Coerce a value to an array (never undefined). */
function arr(v) {
  return Array.isArray(v) ? v : []
}

/** Coerce a value to a display string or null (never undefined). */
function str(v) {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s.length ? s : null
}

/**
 * Format a list as 'a, b, c'. Returns 'N/A' for an empty/absent list.
 * Non-empty entries only (blank tokens are dropped).
 */
export function fmtList(list) {
  const items = arr(list)
    .map((x) => (x === null || x === undefined ? '' : String(x).trim()))
    .filter((x) => x.length > 0)
  return items.length ? items.join(', ') : 'N/A'
}

/**
 * Hours elapsed since the last source update. Pure, no clock of its own - the
 * caller passes `nowMs` (defaults to Date.now() only when omitted). Returns null
 * when the input is missing or unparseable.
 */
export function freshnessAge(lastSourceUpdate, nowMs = Date.now()) {
  if (lastSourceUpdate === null || lastSourceUpdate === undefined || lastSourceUpdate === '') {
    return null
  }
  const t = new Date(lastSourceUpdate).getTime()
  if (!Number.isFinite(t)) return null
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  const hours = (now - t) / 3_600_000
  return Number.isFinite(hours) ? hours : null
}

/**
 * Normalise the explain_metric json into a display object, or null when the
 * payload is absent or reports failure ({ ok:false }).
 *
 * @param {object|null} json  the explain_metric RPC payload
 * @param {number} [nowMs]    current epoch ms (for freshness; testable)
 */
export function shapeExplain(json, nowMs = Date.now()) {
  if (!json || json.ok !== true) return null

  const m = json.metric || {}
  const v = json.version || null
  const f = json.freshness || {}

  const lastSourceUpdate = str(f.last_source_update)
  const ageHours = freshnessAge(lastSourceUpdate, nowMs)
  const stale = ageHours === null ? null : ageHours > STALE_HOURS

  return {
    metric: {
      id: str(m.metric_id),
      name: str(m.name),
      description: str(m.description),
      owner: str(m.business_owner),
      sourceModule: str(m.source_module),
      sourceTable: str(m.source_table),
      sourceColumns: arr(m.source_columns),
      dateField: str(m.date_field),
      dateLogic: str(m.date_logic),
      unit: str(m.unit),
      currencyHandling: str(m.currency_handling),
      nullHandling: str(m.null_handling),
      duplicateHandling: str(m.duplicate_handling),
      included: arr(m.included_statuses),
      excluded: arr(m.excluded_statuses),
      joins: str(m.joins),
      transformations: str(m.transformations),
      refreshSla: str(m.refresh_sla),
      calcRef: str(m.calc_ref),
      dashboards: arr(m.dashboards),
    },
    version: v
      ? {
          version: num(v.version),
          formula: str(v.formula),
          formulaRef: str(v.formula_ref),
          numerator: str(v.numerator),
          denominator: str(v.denominator),
          rounding: str(v.rounding),
          effectiveFrom: str(v.effective_from),
          owner: str(v.owner),
          approver: str(v.approver),
          approvedAt: str(v.approved_at),
          changeNote: str(v.change_note),
        }
      : null,
    freshness: {
      sourceTable: str(f.source_table),
      rowCount: num(f.source_row_count),
      lastSourceUpdate,
      lastCalculation: str(f.last_calculation),
      refreshSla: str(f.refresh_sla),
      ageHours,
      stale,
    },
    lineage: json.lineage ?? null,
  }
}
