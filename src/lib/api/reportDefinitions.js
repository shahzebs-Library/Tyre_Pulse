/**
 * Report Definitions service - the V100 Report Builder boundary:
 * `report_definitions` stores saved custom reports (module + column list +
 * filters + sort + optional chart config), and `runReport` compiles a saved
 * definition into a single least-privilege Supabase query. Every identifier
 * (module, columns, filter fields, sort field) is validated against the
 * MODULE_COLUMNS allowlist before it ever reaches the query builder, so a
 * tampered definition can never select or filter arbitrary columns. RLS:
 * owners get full CRUD; `shared` rows are org-readable. Mirrors
 * businessRules.js (explicit column lists, unwrap error surfacing).
 */
import { supabase, unwrap, ServiceError } from './_client'

const REPORT_COLS =
  'id,user_id,organisation_id,name,description,module,columns,filters,sort,chart,shared,created_at,updated_at'

// ─── Module catalog ───────────────────────────────────────────────────────────

/** Module → physical table map (the only tables runReport may touch). */
export const MODULE_TABLES = {
  tyres:           'tyre_records',
  inspections:     'inspections',
  work_orders:     'work_orders',
  accidents:       'accidents',
  stock:           'stock_records',
  fleet:           'vehicle_fleet',
  purchase_orders: 'purchase_orders',
}

/**
 * Per-module column allowlist. `name` is the physical column, `label` the UI
 * caption, `type` drives the filter-value input ('text' | 'number' | 'date').
 * Verified against MASTER_MIGRATION.sql.
 */
export const MODULE_COLUMNS = {
  tyres: [
    { name: 'asset_no',       label: 'Asset No',        type: 'text' },
    { name: 'site',           label: 'Site',            type: 'text' },
    { name: 'country',        label: 'Country',         type: 'text' },
    { name: 'region',         label: 'Region',          type: 'text' },
    { name: 'brand',          label: 'Brand',           type: 'text' },
    { name: 'serial_no',      label: 'Serial No',       type: 'text' },
    { name: 'position',       label: 'Position',        type: 'text' },
    { name: 'category',       label: 'Category',        type: 'text' },
    { name: 'risk_level',     label: 'Risk Level',      type: 'text' },
    { name: 'description',    label: 'Description',     type: 'text' },
    { name: 'qty',            label: 'Quantity',        type: 'number' },
    { name: 'cost_per_tyre',  label: 'Cost / Tyre',     type: 'number' },
    { name: 'km_at_fitment',  label: 'KM at Fitment',   type: 'number' },
    { name: 'km_at_removal',  label: 'KM at Removal',   type: 'number' },
    { name: 'issue_date',     label: 'Issue Date',      type: 'date' },
    { name: 'created_at',     label: 'Created At',      type: 'date' },
  ],
  inspections: [
    { name: 'asset_no',        label: 'Asset No',        type: 'text' },
    { name: 'inspection_type', label: 'Type',            type: 'text' },
    { name: 'status',          label: 'Status',          type: 'text' },
    { name: 'severity',        label: 'Severity',        type: 'text' },
    { name: 'site',            label: 'Site',            type: 'text' },
    { name: 'country',         label: 'Country',         type: 'text' },
    { name: 'region',          label: 'Region',          type: 'text' },
    { name: 'inspector_name',  label: 'Inspector',       type: 'text' },
    { name: 'vehicle_type',    label: 'Vehicle Type',    type: 'text' },
    { name: 'findings',        label: 'Findings',        type: 'text' },
    { name: 'scheduled_date',  label: 'Scheduled Date',  type: 'date' },
    { name: 'completed_date',  label: 'Completed Date',  type: 'date' },
    { name: 'created_at',      label: 'Created At',      type: 'date' },
  ],
  work_orders: [
    { name: 'work_order_no',   label: 'Work Order No',   type: 'text' },
    { name: 'asset_no',        label: 'Asset No',        type: 'text' },
    { name: 'tyre_serial',     label: 'Tyre Serial',     type: 'text' },
    { name: 'tyre_position',   label: 'Tyre Position',   type: 'text' },
    { name: 'status',          label: 'Status',          type: 'text' },
    { name: 'priority',        label: 'Priority',        type: 'text' },
    { name: 'work_type',       label: 'Work Type',       type: 'text' },
    { name: 'technician_name', label: 'Technician',      type: 'text' },
    { name: 'workshop_name',   label: 'Workshop',        type: 'text' },
    { name: 'site',            label: 'Site',            type: 'text' },
    { name: 'country',         label: 'Country',         type: 'text' },
    { name: 'labour_cost',     label: 'Labour Cost',     type: 'number' },
    { name: 'parts_cost',      label: 'Parts Cost',      type: 'number' },
    { name: 'total_cost',      label: 'Total Cost',      type: 'number' },
    { name: 'opened_at',       label: 'Opened At',       type: 'date' },
    { name: 'completed_at',    label: 'Completed At',    type: 'date' },
  ],
  accidents: [
    { name: 'asset_no',           label: 'Asset No',       type: 'text' },
    { name: 'site',               label: 'Site',           type: 'text' },
    { name: 'country',            label: 'Country',        type: 'text' },
    { name: 'severity',           label: 'Severity',       type: 'text' },
    { name: 'status',             label: 'Status',         type: 'text' },
    { name: 'description',        label: 'Description',    type: 'text' },
    { name: 'inspector',          label: 'Inspector',      type: 'text' },
    { name: 'insurance_claim_no', label: 'Claim No',       type: 'text' },
    { name: 'repair_cost',        label: 'Repair Cost',    type: 'number' },
    { name: 'incident_date',      label: 'Incident Date',  type: 'date' },
    { name: 'created_at',         label: 'Created At',     type: 'date' },
  ],
  stock: [
    { name: 'site',              label: 'Site',              type: 'text' },
    { name: 'description',       label: 'Description',       type: 'text' },
    { name: 'stock_status',      label: 'Stock Status',      type: 'text' },
    { name: 'management_action', label: 'Management Action', type: 'text' },
    { name: 'region',            label: 'Region',            type: 'text' },
    { name: 'country',           label: 'Country',           type: 'text' },
    { name: 'stock_qty',         label: 'Stock Qty',         type: 'number' },
    { name: 'min_level',         label: 'Min Level',         type: 'number' },
    { name: 'critical_level',    label: 'Critical Level',    type: 'number' },
    { name: 'reorder_qty',       label: 'Reorder Qty',       type: 'number' },
    { name: 'updated_at',        label: 'Updated At',        type: 'date' },
  ],
  fleet: [
    { name: 'asset_no',             label: 'Asset No',           type: 'text' },
    { name: 'fleet_number',         label: 'Fleet Number',       type: 'text' },
    { name: 'make',                 label: 'Make',               type: 'text' },
    { name: 'model',                label: 'Model',              type: 'text' },
    { name: 'vehicle_type',         label: 'Vehicle Type',       type: 'text' },
    { name: 'status',               label: 'Status',             type: 'text' },
    { name: 'department',           label: 'Department',         type: 'text' },
    { name: 'operator_name',        label: 'Operator',           type: 'text' },
    { name: 'site',                 label: 'Site',               type: 'text' },
    { name: 'country',              label: 'Country',            type: 'text' },
    { name: 'tyre_size',            label: 'Tyre Size',          type: 'text' },
    { name: 'tyre_brand_preferred', label: 'Preferred Brand',    type: 'text' },
    { name: 'year',                 label: 'Year',               type: 'number' },
    { name: 'expected_km_per_tyre', label: 'Expected KM/Tyre',   type: 'number' },
    { name: 'monthly_tyre_budget',  label: 'Monthly Budget',     type: 'number' },
    { name: 'created_at',           label: 'Created At',         type: 'date' },
  ],
  purchase_orders: [
    { name: 'po_number',         label: 'PO Number',          type: 'text' },
    { name: 'vendor_name',       label: 'Vendor',             type: 'text' },
    { name: 'status',            label: 'Status',             type: 'text' },
    { name: 'priority',          label: 'Priority',           type: 'text' },
    { name: 'budget_code',       label: 'Budget Code',        type: 'text' },
    { name: 'site',              label: 'Site',               type: 'text' },
    { name: 'country',           label: 'Country',            type: 'text' },
    { name: 'requested_by',      label: 'Requested By',       type: 'text' },
    { name: 'approved_by',       label: 'Approved By',        type: 'text' },
    { name: 'subtotal',          label: 'Subtotal',           type: 'number' },
    { name: 'tax_amount',        label: 'Tax',                type: 'number' },
    { name: 'total_amount',      label: 'Total Amount',       type: 'number' },
    { name: 'order_date',        label: 'Order Date',         type: 'date' },
    { name: 'expected_delivery', label: 'Expected Delivery',  type: 'date' },
    { name: 'actual_delivery',   label: 'Actual Delivery',    type: 'date' },
    { name: 'created_at',        label: 'Created At',         type: 'date' },
  ],
}

/** Filter operators the builder understands (values match saved definitions). */
export const FILTER_OPERATORS = [
  { value: 'eq',       label: 'equals' },
  { value: 'neq',      label: 'not equals' },
  { value: 'gt',       label: 'greater than' },
  { value: 'gte',      label: 'greater or equal' },
  { value: 'lt',       label: 'less than' },
  { value: 'lte',      label: 'less or equal' },
  { value: 'contains', label: 'contains' },
  { value: 'is_null',  label: 'is empty' },
  { value: 'not_null', label: 'is not empty' },
]

const OPERATOR_SET = new Set(FILTER_OPERATORS.map(o => o.value))

// Lazily-built per-module Set of allowed column names.
const COLUMN_SETS = Object.fromEntries(
  Object.entries(MODULE_COLUMNS).map(([m, cols]) => [m, new Set(cols.map(c => c.name))])
)

function invalid(message) {
  return new ServiceError(message, 'invalid_report_definition')
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * List report definitions visible to the current user (own + org-shared via
 * RLS), most recently updated first.
 * @returns {Promise<Array<object>>}
 */
export async function listReportDefinitions() {
  return unwrap(
    await supabase
      .from('report_definitions')
      .select(REPORT_COLS)
      .order('updated_at', { ascending: false })
  )
}

/**
 * Create a report definition; returns the inserted row.
 * @param {{user_id:string, name:string, description?:string, module:string,
 *   columns:string[], filters?:Array<{field:string,operator:string,value:*}>,
 *   sort?:{field:string,dir:'asc'|'desc'}|null,
 *   chart?:{type:string,groupBy:string,aggregate:string,field?:string}|null,
 *   shared?:boolean}} values
 * @returns {Promise<object>}
 */
export async function createReportDefinition(values) {
  return unwrap(
    await supabase.from('report_definitions').insert(values).select(REPORT_COLS).single()
  )
}

/**
 * Update a report definition by id (owner only via RLS).
 * @param {string} id
 * @param {object} patch
 */
export async function updateReportDefinition(id, patch) {
  return unwrap(await supabase.from('report_definitions').update(patch).eq('id', id))
}

/**
 * Delete a report definition by id (owner only via RLS).
 * @param {string} id
 */
export async function deleteReportDefinition(id) {
  return unwrap(await supabase.from('report_definitions').delete().eq('id', id))
}

// ─── Query compiler ───────────────────────────────────────────────────────────

/**
 * Execute a report definition as a single Supabase query. Defensive: the
 * module, every selected column, every filter field/operator and the sort
 * field must appear in the MODULE_COLUMNS allowlist or a ServiceError
 * ('invalid_report_definition') is thrown before any request is made.
 *
 * @param {{module:string, columns:string[],
 *   filters?:Array<{field:string,operator:string,value:*}>,
 *   sort?:{field:string,dir:'asc'|'desc'}|null}} definition
 * @param {object} [opts]
 * @param {number} [opts.limit=1000] row cap (clamped to 1..1000)
 * @returns {Promise<Array<object>>}
 */
export async function runReport(definition, { limit = 1000 } = {}) {
  const { module, columns, filters = [], sort = null } = definition || {}

  const table = MODULE_TABLES[module]
  if (!table) throw invalid(`Unknown report module: ${String(module)}`)

  const allowed = COLUMN_SETS[module]
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 30) {
    throw invalid('Report must select between 1 and 30 columns')
  }
  for (const col of columns) {
    if (!allowed.has(col)) throw invalid(`Unknown column for ${module}: ${String(col)}`)
  }

  let q = supabase.from(table).select(columns.join(','))

  for (const f of Array.isArray(filters) ? filters : []) {
    const { field, operator, value } = f || {}
    if (!allowed.has(field)) throw invalid(`Unknown filter field for ${module}: ${String(field)}`)
    if (!OPERATOR_SET.has(operator)) throw invalid(`Unknown filter operator: ${String(operator)}`)
    switch (operator) {
      case 'eq':       q = q.eq(field, value); break
      case 'neq':      q = q.neq(field, value); break
      case 'gt':       q = q.gt(field, value); break
      case 'gte':      q = q.gte(field, value); break
      case 'lt':       q = q.lt(field, value); break
      case 'lte':      q = q.lte(field, value); break
      case 'contains': q = q.ilike(field, `%${value ?? ''}%`); break
      case 'is_null':  q = q.is(field, null); break
      case 'not_null': q = q.not(field, 'is', null); break
      /* c8 ignore next */
      default: throw invalid(`Unknown filter operator: ${operator}`)
    }
  }

  if (sort && sort.field) {
    if (!allowed.has(sort.field)) throw invalid(`Unknown sort field for ${module}: ${String(sort.field)}`)
    q = q.order(sort.field, { ascending: sort.dir !== 'desc' })
  }

  const cap = Math.min(Math.max(1, Number(limit) || 1000), 1000)
  return unwrap(await q.limit(cap))
}
