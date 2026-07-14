/**
 * Report Builder — pure, unit-testable logic behind the self-service report
 * composer (src/pages/ReportBuilder.jsx).
 *
 * Responsibilities:
 *   - DATASETS registry: every queryable dataset with its REAL table + columns.
 *     Column lists are derived from the import adapters' canonical field
 *     dictionaries (src/lib/import/synonyms.js), which are guaranteed to map to
 *     real destination-table columns — the live DB drifts from migration files,
 *     so this is the single source of truth the app already trusts for writes.
 *   - OPERATORS per logical type (text/number/date/enum).
 *   - validateConfig(config): strict allow-list validation. Unknown datasets,
 *     columns, operators or aggregate functions are rejected — user input is
 *     NEVER interpolated into a query as an identifier.
 *   - buildQuery(supabase, config): applies select/filters/sort/limit onto a
 *     Supabase query builder (values go through the builder's parameterised
 *     methods only).
 *   - applyAggregations(rows, config): client-side group-by with
 *     count/sum/avg/min/max metrics.
 *   - fetchSavedReports / persistSavedReports: org-scoped persistence in
 *     app_settings under `saved_reports` (same pattern as lib/api/erp.js).
 *
 * @module reportBuilder
 */
import { MODULE_FIELDS } from './import/synonyms.js'

// ── Types ─────────────────────────────────────────────────────────────────────
/**
 * @typedef {'text'|'number'|'date'|'enum'} ColumnType
 * @typedef {{ key:string, label:string, type:ColumnType }} DatasetColumn
 * @typedef {{ col:string, op:string, value?:* }} ReportFilter
 * @typedef {{ col:string, fn:'sum'|'avg'|'min'|'max' }} ReportMetric
 * @typedef {Object} ReportConfig
 * @property {string} dataset
 * @property {string[]} columns
 * @property {ReportFilter[]} [filters]
 * @property {{ col:string, dir:'asc'|'desc' }} [sort]
 * @property {number} [limit]
 * @property {{ by:string, metrics?:ReportMetric[] }} [group]
 */

// ── Limits ────────────────────────────────────────────────────────────────────
export const DEFAULT_LIMIT = 500
export const MAX_LIMIT = 5000
export const MAX_FILTERS = 12
export const MAX_SAVED_REPORTS = 200

// ── Dataset registry ──────────────────────────────────────────────────────────
/** Map import-adapter field types to report-builder logical types. */
const TYPE_MAP = {
  string: 'text',
  number: 'number',
  integer: 'number',
  currency: 'number',
  pressure: 'number',
  distance: 'number',
  mass: 'number',
  date: 'date',
}

/** @param {string} module @returns {DatasetColumn[]} */
function columnsFromModule(module) {
  return (MODULE_FIELDS[module] || []).map(f => ({
    key: f.key,
    label: f.label,
    type: TYPE_MAP[f.type] || 'text',
  }))
}

/**
 * Every dataset the builder can query. `table` and `columns` are real DB
 * identifiers sourced from the import adapters (never from user input).
 * @type {Record<string, { key:string, label:string, table:string, columns:DatasetColumn[], defaultSort:{col:string, dir:'asc'|'desc'} }>}
 */
export const DATASETS = Object.freeze({
  tyres: {
    key: 'tyres', label: 'Tyre Records', table: 'tyre_records',
    columns: columnsFromModule('tyre'),
    defaultSort: { col: 'issue_date', dir: 'desc' },
  },
  fleet: {
    key: 'fleet', label: 'Vehicle Fleet', table: 'vehicle_fleet',
    columns: columnsFromModule('fleet'),
    defaultSort: { col: 'asset_no', dir: 'asc' },
  },
  inspections: {
    key: 'inspections', label: 'Inspections', table: 'inspections',
    columns: columnsFromModule('inspection'),
    defaultSort: { col: 'inspection_date', dir: 'desc' },
  },
  work_orders: {
    key: 'work_orders', label: 'Work Orders', table: 'work_orders',
    columns: columnsFromModule('workorder'),
    defaultSort: { col: 'opened_at', dir: 'desc' },
  },
  accidents: {
    key: 'accidents', label: 'Accidents & Insurance', table: 'accidents',
    columns: columnsFromModule('accident'),
    defaultSort: { col: 'incident_date', dir: 'desc' },
  },
  gate_passes: {
    key: 'gate_passes', label: 'Gate Passes', table: 'gate_passes',
    columns: columnsFromModule('gatepass'),
    defaultSort: { col: 'pass_date', dir: 'desc' },
  },
  suppliers: {
    key: 'suppliers', label: 'Suppliers', table: 'suppliers',
    columns: columnsFromModule('supplier'),
    defaultSort: { col: 'supplier_name', dir: 'asc' },
  },
  warranty: {
    key: 'warranty', label: 'Warranty Claims', table: 'warranty_claims',
    columns: columnsFromModule('warranty'),
    defaultSort: { col: 'removal_date', dir: 'desc' },
  },
})

/** Ordered list for pickers. */
export const DATASET_LIST = Object.freeze(Object.values(DATASETS))

/** @param {string} datasetKey @param {string} col @returns {DatasetColumn|null} */
export function getColumn(datasetKey, col) {
  const ds = DATASETS[datasetKey]
  if (!ds) return null
  return ds.columns.find(c => c.key === col) || null
}

// ── Operators ─────────────────────────────────────────────────────────────────
export const OPERATORS = Object.freeze({
  text:   ['equals', 'not_equals', 'contains', 'in', 'is_empty', 'not_empty'],
  enum:   ['equals', 'not_equals', 'in', 'is_empty', 'not_empty'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'not_empty'],
  date:   ['equals', 'gte', 'lte', 'gt', 'lt', 'between', 'is_empty', 'not_empty'],
})

export const OPERATOR_LABELS = Object.freeze({
  equals: 'equals',
  not_equals: 'not equal to',
  contains: 'contains',
  gt: 'greater than',
  gte: 'on or after / ≥',
  lt: 'less than',
  lte: 'on or before / ≤',
  between: 'between',
  in: 'is one of',
  is_empty: 'is empty',
  not_empty: 'is not empty',
})

/** Operators that take no value input. */
export const VALUELESS_OPS = Object.freeze(['is_empty', 'not_empty'])
/** Operators that take two value inputs. */
export const RANGE_OPS = Object.freeze(['between'])
/** Operators that take a list value (comma separated in the UI). */
export const LIST_OPS = Object.freeze(['in'])

export const AGG_FNS = Object.freeze(['sum', 'avg', 'min', 'max'])

// ── Chart visualization ────────────────────────────────────────────────────────
/**
 * Chart types offered for a grouped + aggregated report. Each plots the grouped
 * rows: the group value on the category axis, one chosen metric as the series.
 * `pie` maps to a doughnut/pie in the UI; `hbar` is a horizontal bar.
 */
export const CHART_TYPES = Object.freeze([
  { key: 'bar', label: 'Bar' },
  { key: 'line', label: 'Line' },
  { key: 'pie', label: 'Pie / Doughnut' },
  { key: 'hbar', label: 'Horizontal Bar' },
])
export const CHART_TYPE_KEYS = Object.freeze(CHART_TYPES.map(c => c.key))

/** Cap plotted points so a chart stays legible (rows are pre-sorted by count). */
export const MAX_CHART_POINTS = 30

/** Fixed, theme-independent categorical palette (legible on dark and white). */
export const CHART_PALETTE = Object.freeze([
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7',
  '#ec4899', '#14b8a6', '#eab308', '#3b82f6', '#f97316', '#84cc16',
])

// ── Value helpers ─────────────────────────────────────────────────────────────
/** Escape PostgREST/SQL LIKE wildcards in a user-supplied search term. */
export function escapeLike(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null || String(v).trim() === '') return null
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/
function toDateStr(v) {
  const s = String(v ?? '').trim()
  return ISO_DATE_RE.test(s) ? s.slice(0, 10) : null
}

/** Coerce + validate a scalar filter value for a column type. Returns null when invalid. */
function coerceScalar(type, v) {
  if (type === 'number') return toNumber(v)
  if (type === 'date') return toDateStr(v)
  const s = String(v ?? '').trim()
  return s === '' ? null : s.slice(0, 300)
}

function toList(v) {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(',')
  const clean = arr.map(x => String(x ?? '').trim()).filter(Boolean).slice(0, 50)
  return clean.length ? clean : null
}

// ── validateConfig ────────────────────────────────────────────────────────────
/**
 * Strict allow-list validation + normalisation of a report config. Never trusts
 * user-supplied identifiers: dataset, columns, filter columns/operators, sort
 * column, group column and metric columns must all exist in the registry.
 *
 * @param {ReportConfig} config
 * @returns {{ valid:boolean, errors:string[], config:ReportConfig|null }}
 */
export function validateConfig(config) {
  const errors = []
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Report config is required.'], config: null }
  }

  const ds = DATASETS[config.dataset]
  if (!ds) {
    return { valid: false, errors: [`Unknown dataset "${String(config.dataset)}".`], config: null }
  }
  const colByKey = new Map(ds.columns.map(c => [c.key, c]))

  // Columns — deduped, order-preserving, must all exist.
  const rawCols = Array.isArray(config.columns) ? config.columns : []
  const columns = []
  for (const c of rawCols) {
    if (!colByKey.has(c)) { errors.push(`Unknown column "${String(c)}".`); continue }
    if (!columns.includes(c)) columns.push(c)
  }
  if (columns.length === 0) errors.push('Select at least one column.')

  // Filters
  const filters = []
  const rawFilters = Array.isArray(config.filters) ? config.filters : []
  if (rawFilters.length > MAX_FILTERS) errors.push(`Too many filters (max ${MAX_FILTERS}).`)
  for (const f of rawFilters.slice(0, MAX_FILTERS)) {
    if (!f || typeof f !== 'object') { errors.push('Invalid filter entry.'); continue }
    const col = colByKey.get(f.col)
    if (!col) { errors.push(`Unknown filter column "${String(f?.col)}".`); continue }
    const allowed = OPERATORS[col.type] || OPERATORS.text
    if (!allowed.includes(f.op)) {
      errors.push(`Operator "${String(f.op)}" is not valid for ${col.label}.`)
      continue
    }
    if (VALUELESS_OPS.includes(f.op)) {
      filters.push({ col: col.key, op: f.op })
    } else if (RANGE_OPS.includes(f.op)) {
      const pair = Array.isArray(f.value) ? f.value : []
      const lo = coerceScalar(col.type, pair[0])
      const hi = coerceScalar(col.type, pair[1])
      if (lo == null || hi == null) { errors.push(`"${col.label}" between requires two valid values.`); continue }
      filters.push({ col: col.key, op: f.op, value: [lo, hi] })
    } else if (LIST_OPS.includes(f.op)) {
      const list = toList(f.value)
      if (!list) { errors.push(`"${col.label}" is-one-of requires at least one value.`); continue }
      filters.push({ col: col.key, op: f.op, value: list })
    } else {
      const v = coerceScalar(col.type, f.value)
      if (v == null) { errors.push(`"${col.label}" filter needs a valid ${col.type} value.`); continue }
      filters.push({ col: col.key, op: f.op, value: v })
    }
  }

  // Sort
  let sort = ds.defaultSort
  if (config.sort && config.sort.col != null && config.sort.col !== '') {
    if (!colByKey.has(config.sort.col)) {
      errors.push(`Unknown sort column "${String(config.sort.col)}".`)
    } else {
      sort = { col: config.sort.col, dir: config.sort.dir === 'asc' ? 'asc' : 'desc' }
    }
  }

  // Limit
  const rawLimit = toNumber(config.limit)
  const limit = rawLimit != null
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT

  // Group / aggregations (optional)
  let group = null
  if (config.group && config.group.by != null && config.group.by !== '') {
    const gcol = colByKey.get(config.group.by)
    if (!gcol) {
      errors.push(`Unknown group column "${String(config.group.by)}".`)
    } else {
      const metrics = []
      for (const m of Array.isArray(config.group.metrics) ? config.group.metrics : []) {
        const mcol = colByKey.get(m?.col)
        if (!mcol) { errors.push(`Unknown aggregate column "${String(m?.col)}".`); continue }
        if (mcol.type !== 'number') { errors.push(`"${mcol.label}" is not numeric and cannot be aggregated.`); continue }
        if (!AGG_FNS.includes(m.fn)) { errors.push(`Unknown aggregate function "${String(m?.fn)}".`); continue }
        metrics.push({ col: mcol.key, fn: m.fn })
      }
      group = { by: gcol.key, metrics }
    }
  }

  // Chart (optional visualization of the grouped rows). Default null = table only.
  let chart = null
  if (config.chart && config.chart.type != null && config.chart.type !== '') {
    if (!group) {
      errors.push('A chart requires a group-by column.')
    } else if (!CHART_TYPE_KEYS.includes(config.chart.type)) {
      errors.push(`Unknown chart type "${String(config.chart.type)}".`)
    } else {
      const validMetrics = new Set(['count', ...group.metrics.map(m => `${m.fn}_${m.col}`)])
      const metric = validMetrics.has(config.chart.metric) ? config.chart.metric : 'count'
      chart = { type: config.chart.type, metric }
    }
  }

  if (errors.length) return { valid: false, errors, config: null }
  return { valid: true, errors: [], config: { dataset: ds.key, columns, filters, sort, limit, group, chart } }
}

// ── buildQuery ────────────────────────────────────────────────────────────────
/**
 * Build a Supabase query from a report config. The config is validated first;
 * throws on any invalid input. Column identifiers come only from the registry;
 * user values are passed exclusively through parameterised builder methods.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {ReportConfig} config
 * @returns query builder (thenable)
 */
export function buildQuery(supabase, config) {
  const { valid, errors, config: cfg } = validateConfig(config)
  if (!valid) throw new Error(errors.join(' '))

  const ds = DATASETS[cfg.dataset]
  // Ensure the group-by / metric columns are fetched even if not displayed.
  const selectCols = [...cfg.columns]
  if (cfg.group) {
    for (const extra of [cfg.group.by, ...cfg.group.metrics.map(m => m.col)]) {
      if (!selectCols.includes(extra)) selectCols.push(extra)
    }
  }

  let q = supabase.from(ds.table).select(selectCols.join(','))

  for (const f of cfg.filters) {
    switch (f.op) {
      case 'equals':     q = q.eq(f.col, f.value); break
      case 'not_equals': q = q.neq(f.col, f.value); break
      case 'contains':   q = q.ilike(f.col, `%${escapeLike(f.value)}%`); break
      case 'gt':         q = q.gt(f.col, f.value); break
      case 'gte':        q = q.gte(f.col, f.value); break
      case 'lt':         q = q.lt(f.col, f.value); break
      case 'lte':        q = q.lte(f.col, f.value); break
      case 'between':    q = q.gte(f.col, f.value[0]).lte(f.col, f.value[1]); break
      case 'in':         q = q.in(f.col, f.value); break
      case 'is_empty':   q = q.is(f.col, null); break
      case 'not_empty':  q = q.not(f.col, 'is', null); break
      default:           throw new Error(`Unhandled operator "${f.op}".`) // unreachable post-validation
    }
  }

  q = q.order(cfg.sort.col, { ascending: cfg.sort.dir === 'asc' }).limit(cfg.limit)
  return q
}

// ── applyAggregations ─────────────────────────────────────────────────────────
/**
 * Client-side group-by. Returns null when the config has no group clause so the
 * caller can fall through to raw rows.
 *
 * @param {Object[]} rows
 * @param {ReportConfig} config  (validated or raw — group is re-checked defensively)
 * @returns {{ rows:Object[], columns:{key:string,label:string,type:ColumnType}[] }|null}
 */
export function applyAggregations(rows, config) {
  const group = config?.group
  const ds = DATASETS[config?.dataset]
  if (!group || !group.by || !ds) return null
  const gcol = ds.columns.find(c => c.key === group.by)
  if (!gcol) return null

  const metrics = (group.metrics || []).filter(
    m => AGG_FNS.includes(m?.fn) && ds.columns.some(c => c.key === m.col && c.type === 'number'),
  )

  /** @type {Map<string, { count:number, acc:Record<string,{sum:number,n:number,min:number|null,max:number|null}> }>} */
  const buckets = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = row?.[group.by]
    const key = raw == null || String(raw).trim() === '' ? '(blank)' : String(raw).trim()
    let b = buckets.get(key)
    if (!b) {
      b = { count: 0, acc: {} }
      for (const m of metrics) b.acc[`${m.fn}:${m.col}`] = { sum: 0, n: 0, min: null, max: null }
      buckets.set(key, b)
    }
    b.count++
    for (const m of metrics) {
      const v = toNumber(row?.[m.col])
      if (v == null) continue
      const a = b.acc[`${m.fn}:${m.col}`]
      a.sum += v
      a.n++
      a.min = a.min == null ? v : Math.min(a.min, v)
      a.max = a.max == null ? v : Math.max(a.max, v)
    }
  }

  const round2 = n => Math.round(n * 100) / 100
  const metricKey = m => `${m.fn}_${m.col}`
  const outRows = [...buckets.entries()].map(([key, b]) => {
    const row = { [group.by]: key, count: b.count }
    for (const m of metrics) {
      const a = b.acc[`${m.fn}:${m.col}`]
      let v = null
      if (a.n > 0) {
        if (m.fn === 'sum') v = round2(a.sum)
        else if (m.fn === 'avg') v = round2(a.sum / a.n)
        else if (m.fn === 'min') v = a.min
        else if (m.fn === 'max') v = a.max
      }
      row[metricKey(m)] = v
    }
    return row
  }).sort((a, b) => b.count - a.count)

  const columns = [
    { key: group.by, label: gcol.label, type: gcol.type },
    { key: 'count', label: 'Count', type: 'number' },
    ...metrics.map(m => {
      const c = ds.columns.find(x => x.key === m.col)
      return { key: metricKey(m), label: `${m.fn.toUpperCase()} ${c?.label || m.col}`, type: 'number' }
    }),
  ]
  return { rows: outRows, columns }
}

// ── Chart data shaping ──────────────────────────────────────────────────────────
/**
 * The metric series a chart can plot for a given aggregation result: always the
 * Count column plus every numeric aggregate produced by applyAggregations.
 *
 * @param {{ rows:Object[], columns:{key:string,label:string,type:ColumnType}[] }|null} aggregated
 * @returns {{ key:string, label:string }[]}
 */
export function chartMetricOptions(aggregated) {
  if (!aggregated || !Array.isArray(aggregated.columns)) return []
  return aggregated.columns
    .filter(c => c.type === 'number')
    .map(c => ({ key: c.key, label: c.label }))
}

/**
 * Turn an aggregation result (from applyAggregations) into a Chart.js data
 * object for the chosen chart type + metric series. Pure and side-effect free so
 * it can be unit tested without a DOM. Returns null when there is nothing to
 * plot (no aggregation, no rows, or no numeric series).
 *
 * The category axis is the group-by value (always the first aggregated column);
 * the series is the requested metric ('count' or a `${fn}_${col}` key), falling
 * back to 'count' when the requested metric is unavailable. Rows are already
 * sorted by count desc; only the first MAX_CHART_POINTS are plotted.
 *
 * @param {{ rows:Object[], columns:{key:string,label:string,type:ColumnType}[] }|null} aggregated
 * @param {{ type?:string, metric?:string }|null} chart
 * @returns {{ type:string, metricKey:string, seriesLabel:string, groupLabel:string, data:{ labels:string[], datasets:Object[] } }|null}
 */
export function buildReportChartData(aggregated, chart) {
  if (!aggregated || !Array.isArray(aggregated.rows) || aggregated.rows.length === 0) return null
  const numericCols = (aggregated.columns || []).filter(c => c.type === 'number')
  if (numericCols.length === 0) return null
  const groupCol = aggregated.columns[0]
  if (!groupCol) return null

  const type = CHART_TYPE_KEYS.includes(chart?.type) ? chart.type : 'bar'
  const metricCol = numericCols.find(c => c.key === chart?.metric) || numericCols[0]

  const plotted = aggregated.rows.slice(0, MAX_CHART_POINTS)
  const labels = plotted.map(r => {
    const v = r[groupCol.key]
    return v == null || String(v).trim() === '' ? '(blank)' : String(v)
  })
  const values = plotted.map(r => {
    const n = Number(r[metricCol.key])
    return Number.isFinite(n) ? n : 0
  })

  let dataset
  if (type === 'pie') {
    dataset = {
      label: metricCol.label,
      data: values,
      backgroundColor: labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
      borderColor: '#ffffff',
      borderWidth: 1,
    }
  } else if (type === 'line') {
    dataset = {
      label: metricCol.label,
      data: values,
      backgroundColor: 'rgba(99,102,241,0.20)',
      borderColor: CHART_PALETTE[0],
      borderWidth: 2,
      fill: true,
      tension: 0.3,
      pointRadius: 3,
    }
  } else {
    // bar + hbar share one styled dataset (orientation handled by chart options).
    dataset = {
      label: metricCol.label,
      data: values,
      backgroundColor: CHART_PALETTE[0],
      borderColor: CHART_PALETTE[0],
      borderWidth: 1,
      borderRadius: 4,
    }
  }

  return {
    type,
    metricKey: metricCol.key,
    seriesLabel: metricCol.label,
    groupLabel: groupCol.label,
    data: { labels, datasets: [dataset] },
  }
}

// ── Saved reports persistence ────────────────────────────────────────────────
// The canonical persistence entry points live in lib/api/savedViews.js, which
// prefers the V102 `report_definitions` table (per-user rows) and falls back to
// the legacy app_settings blob below when that table is not yet applied.
// Pages import listReports/saveReport/deleteReport/renameReport from there.
// The functions below remain the LEGACY (app_settings) primitives that
// savedViews consumes as its fallback path — do not call them directly from UI.
export const SAVED_REPORTS_KEY = 'saved_reports'

function parseSavedValue(value) {
  try {
    const v = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(v)) return []
    return v.filter(r => r && typeof r === 'object' && typeof r.name === 'string' && r.config)
  } catch {
    return []
  }
}

/**
 * Read the org's saved reports from app_settings (RLS-scoped).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Object[]>}
 */
export async function fetchSavedReports(supabase) {
  const { data, error } = await supabase
    .from('app_settings').select('value').eq('key', SAVED_REPORTS_KEY).maybeSingle()
  if (error) throw new Error(error.message || 'Could not load saved reports.')
  return parseSavedValue(data?.value)
}

/**
 * Persist the full saved-reports array (upsert on key, capped).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object[]} reports
 */
export async function persistSavedReports(supabase, reports) {
  const clean = (Array.isArray(reports) ? reports : []).slice(0, MAX_SAVED_REPORTS)
  const { error } = await supabase.from('app_settings').upsert(
    { key: SAVED_REPORTS_KEY, value: JSON.stringify(clean) },
    { onConflict: 'key' },
  )
  if (error) throw new Error(error.message || 'Could not save reports.')
  return clean
}

/**
 * Build a saved-report record with identity + audit metadata.
 * @param {{ name:string, description?:string, config:ReportConfig, createdBy?:string }} input
 */
export function makeSavedReport({ name, description = '', config, createdBy = null }) {
  const now = new Date().toISOString()
  return {
    id: (globalThis.crypto?.randomUUID?.() || `rpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    name: String(name || '').trim().slice(0, 120),
    description: String(description || '').trim().slice(0, 500),
    config,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
  }
}
