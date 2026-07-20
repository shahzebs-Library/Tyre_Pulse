/**
 * Scheduled Reports service — the single data seam for the /scheduled-reports
 * scheduler and its on-demand report generation.
 *
 * Persists to the existing `report_schedules` table (org-isolated RESTRICTIVE
 * RLS + Admin/Manager/Director write gate + set_updated_at trigger already in
 * place). The professional, configurable columns (run_at, start_date, period,
 * period_from/to, output_formats, last_status) are added additively by
 * MIGRATIONS_V218 — apply it before the richer scheduler can save.
 *
 * The cron delivery (edge fn `send-scheduled-reports`) reads the base columns
 * and e-mails an executive digest; period/output-format honouring in that
 * function is a follow-up. On-demand generation here is fully live: it reads the
 * real operational tables (honest empty states, never fabricated) and renders
 * branded PDF / Excel via the shared exportUtils.
 */
import { supabase } from '../supabase'
import { applyCountry } from '../countryFilter'
import { listTemplates as listAccidentReportTemplates } from './accidentReportTemplates'

// Select every column so the page keeps listing schedules even before V218 is
// applied (the new fields simply read back undefined until the migration lands).
const SELECT = '*'

/* ── Registry (single source of truth for report types / cadence / coverage) ── */

// Each report type is backed by a REAL operational table. Icons/colours are a
// React concern and live in the page; here we keep only data + labels.
export const REPORT_TYPES = [
  { value: 'executive',  label: 'Executive Summary' },
  { value: 'kpi',        label: 'Tyre KPI / CPK' },
  { value: 'fleet',      label: 'Fleet Analytics' },
  { value: 'cost',       label: 'Cost Analysis' },
  { value: 'inspection', label: 'Inspection Summary' },
  { value: 'accidents',  label: 'Accident & Incident' },
  { value: 'claims',     label: 'Insurance Claims Summary' },
  { value: 'stock',      label: 'Stock & Receipts' },
  { value: 'vendor',     label: 'Vendor / Procurement' },
  { value: 'pm',         label: 'Preventive Maintenance' },
  { value: 'workshop',   label: 'Workshop Summary' },
]

export const FREQUENCIES = [
  { value: 'once',    label: 'Once (specific date)' },
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

export const PERIODS = [
  { value: 'last_7',  label: 'Last 7 days',   days: 7 },
  { value: 'last_30', label: 'Last 30 days',  days: 30 },
  { value: 'last_90', label: 'Last 90 days',  days: 90 },
  { value: 'mtd',     label: 'Month to date' },
  { value: 'ytd',     label: 'Year to date' },
  { value: 'custom',  label: 'Custom range' },
]

export const OUTPUT_FORMATS = [
  { value: 'pdf',   label: 'PDF' },
  { value: 'excel', label: 'Excel' },
]

// reportType -> { table, dateCol, title, cols[], headers[] }.
// Columns are a least-privilege, human-meaningful projection of each table.
const DATASETS = {
  executive: {
    table: 'tyre_records', dateCol: 'issue_date', title: 'Executive Fleet Report',
    cols:    ['issue_date', 'asset_no', 'brand', 'site', 'category', 'position', 'risk_level', 'total_km', 'cost_per_tyre'],
    headers: ['Date', 'Asset', 'Brand', 'Site', 'Category', 'Position', 'Risk', 'Total KM', 'Cost'],
  },
  kpi: {
    table: 'tyre_records', dateCol: 'issue_date', title: 'Tyre KPI & CPK Scorecard',
    cols:    ['issue_date', 'asset_no', 'brand', 'category', 'risk_level', 'km_at_fitment', 'km_at_removal', 'total_km', 'cost_per_tyre'],
    headers: ['Date', 'Asset', 'Brand', 'Category', 'Risk', 'KM Fitment', 'KM Removal', 'Total KM', 'Cost'],
  },
  fleet: {
    table: 'tyre_records', dateCol: 'issue_date', title: 'Fleet Analytics Report',
    cols:    ['issue_date', 'asset_no', 'vehicle_type', 'brand', 'site', 'position', 'status', 'risk_level'],
    headers: ['Date', 'Asset', 'Vehicle Type', 'Brand', 'Site', 'Position', 'Status', 'Risk'],
  },
  cost: {
    table: 'tyre_records', dateCol: 'issue_date', title: 'Tyre Cost Analysis',
    cols:    ['issue_date', 'asset_no', 'brand', 'site', 'category', 'supplier', 'qty', 'cost_per_tyre'],
    headers: ['Date', 'Asset', 'Brand', 'Site', 'Category', 'Supplier', 'Qty', 'Cost'],
  },
  inspection: {
    table: 'inspections', dateCol: 'inspection_date', title: 'Inspection Summary',
    cols:    ['inspection_date', 'inspection_type', 'site', 'asset_no', 'inspector', 'status', 'severity', 'pressure_reading'],
    headers: ['Date', 'Type', 'Site', 'Asset', 'Inspector', 'Status', 'Severity', 'Pressure'],
  },
  accidents: {
    table: 'accidents', dateCol: 'incident_date', title: 'Accident & Incident Report',
    cols:    ['incident_date', 'site', 'asset_no', 'accident_type', 'severity', 'status', 'estimated_damage_cost', 'claim_amount'],
    headers: ['Date', 'Site', 'Asset', 'Type', 'Severity', 'Status', 'Est. Damage', 'Claim'],
  },
  claims: {
    table: 'accidents', dateCol: 'incident_date', title: 'Insurance Claims Summary',
    // Claims-desk projection of the accident record: only incidents carrying an
    // insurance claim (orFilter below), with the money + liability + release detail
    // that matters for tracking a claim to closure.
    cols:    ['incident_date', 'asset_no', 'site', 'driver_name', 'status', 'claim_status', 'insurer', 'policy_no', 'gcc_liability_ratio', 'fault_status', 'claim_amount', 'claim_approved_amount', 'deductible', 'recovered_amount', 'expected_release_date'],
    headers: ['Date', 'Asset', 'Site', 'Driver', 'Status', 'Claim Status', 'Insurer', 'Policy/Claim No', 'GCC Liab %', 'Fault', 'Claim Amount', 'Approved', 'Deductible', 'Recovered', 'Expected Release'],
    // Only rows that actually represent a claim (amount/approved > 0, a claim
    // status, or a named insurer). PostgREST OR over the accidents table.
    orFilter: 'claim_amount.gt.0,claim_approved_amount.gt.0,claim_status.not.is.null,insurer.not.is.null',
  },
  stock: {
    table: 'goods_receipts', dateCol: 'received_date', title: 'Stock & Goods Receipts',
    cols:    ['received_date', 'grn_no', 'po_ref', 'supplier', 'item', 'qty_ordered', 'qty_received', 'condition', 'status'],
    headers: ['Received', 'GRN', 'PO Ref', 'Supplier', 'Item', 'Ordered', 'Received', 'Condition', 'Status'],
  },
  vendor: {
    table: 'purchase_orders', dateCol: 'order_date', title: 'Vendor / Procurement Report',
    cols:    ['order_date', 'po_number', 'vendor_name', 'status', 'priority', 'site', 'total_amount', 'expected_delivery'],
    headers: ['Order Date', 'PO No', 'Vendor', 'Status', 'Priority', 'Site', 'Amount', 'Expected'],
  },
  pm: {
    table: 'pm_programs', dateCol: 'next_due', title: 'Preventive Maintenance Due',
    // Active PM programs surfaced soonest-due first (overdue at the top), so the
    // report is a real "what needs servicing" work list, not a transaction log.
    cols:    ['next_due', 'name', 'asset_no', 'asset_category', 'site', 'priority', 'status', 'interval_type', 'interval_value', 'estimated_cost', 'assigned_to'],
    headers: ['Next Due', 'Program', 'Asset', 'Category', 'Site', 'Priority', 'Status', 'Interval', 'Every', 'Est. Cost', 'Assigned'],
    // Only live programs; paused/completed plans are not "due".
    eqFilter: { status: 'active' },
    // next_due is forward-looking, so soonest-first (overdue -> upcoming).
    orderAscending: true,
  },
  workshop: {
    table: 'work_orders', dateCol: 'opened_at', title: 'Workshop Summary',
    // Workshop activity work list: the job cards, who owns them, their status /
    // priority and whether the vehicle is off road, most-recent first. This is
    // the tabular backbone; the technician-productivity KPIs (utilization,
    // lost hours) live on the live board / dashboard tile, computed by the
    // shared workshopLive engine.
    cols:    ['opened_at', 'work_order_no', 'asset_no', 'site', 'work_type', 'status', 'priority', 'technician_name', 'target_completion', 'vor'],
    headers: ['Opened', 'WO No', 'Asset', 'Site', 'Work Type', 'Status', 'Priority', 'Technician', 'Target', 'VOR'],
  },
}

/* ── Custom report layouts (Accident Report Builder) ─────────────────────────
 *
 * Any layout saved in the Accident Report Builder (accident_report_templates,
 * V221) is schedulable app-wide. Builder schedules are stored in the SAME
 * report_schedules table with report_type = 'builder:<template-id>' — no schema
 * change needed, and the edge-fn digest treats the prefix as the claims-desk
 * accident digest. On-demand generation renders the template's exact block
 * layout via src/lib/accidentReportPdf.js.
 */
export const BUILDER_TYPE_PREFIX = 'builder:'

export const isBuilderType = (reportType) =>
  typeof reportType === 'string' && reportType.startsWith(BUILDER_TYPE_PREFIX)

export const builderReportType = (templateId) => `${BUILDER_TYPE_PREFIX}${templateId}`

export const builderTemplateId = (reportType) =>
  (isBuilderType(reportType) ? reportType.slice(BUILDER_TYPE_PREFIX.length) : null)

/** Saved builder layouts, as schedulable report-type options. Missing table → []. */
export async function listSchedulableLayouts() {
  const rows = await listAccidentReportTemplates()
  return rows.map((r) => ({
    value: builderReportType(r.id),
    label: r.name,
    templateId: r.id,
    config: r.config,
    updated_at: r.updated_at,
  }))
}

// Full accident projection a builder layout may reference (KPIs, charts and
// every TABLE_COLS column). Used for the tabular fallback (Excel / digest) and
// as the row source for the block-based PDF.
const BUILDER_DATASET = {
  table: 'accidents', dateCol: 'incident_date', title: 'Custom Accident Report',
  cols: [
    'id', 'incident_date', 'asset_no', 'site', 'driver_name', 'severity', 'status',
    'accident_type', 'fault_status', 'gcc_liability_ratio', 'insurer', 'policy_no',
    'claim_status', 'closure_status', 'claim_amount', 'claim_approved_amount',
    'deductible', 'recovered_amount', 'repair_cost', 'parts_cost',
    'expected_release_date', 'release_date',
  ],
  headers: [
    'ID', 'Date', 'Asset', 'Site', 'Driver', 'Severity', 'Status',
    'Type', 'Fault', 'GCC Liab %', 'Insurer', 'Policy/Claim No',
    'Claim Status', 'Closure', 'Claim Amount', 'Approved',
    'Deductible', 'Recovered', 'Repair Cost', 'Parts Cost',
    'Expected Release', 'Release Date',
  ],
}

export function datasetFor(reportType) {
  if (isBuilderType(reportType)) return BUILDER_DATASET
  return DATASETS[reportType] || DATASETS.executive
}

/* ── CRUD ─────────────────────────────────────────────────────────────────── */

export async function listSchedules() {
  const { data, error } = await supabase
    .from('report_schedules')
    .select(SELECT)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createSchedule(row) {
  const { data, error } = await supabase.from('report_schedules').insert(row).select(SELECT).single()
  if (error) throw error
  return data
}

export async function updateSchedule(id, patch) {
  const { data, error } = await supabase.from('report_schedules').update(patch).eq('id', id).select(SELECT).single()
  if (error) throw error
  return data
}

export async function deleteSchedule(id) {
  const { error } = await supabase.from('report_schedules').delete().eq('id', id)
  if (error) throw error
}

/* ── Scheduling maths ─────────────────────────────────────────────────────── */

/**
 * Next run strictly after now, honouring the cadence.
 * - once:    the exact chosen datetime (run_at)
 * - daily:   next occurrence of time_of_day (>= start_date if set)
 * - weekly:  next day_of_week at time_of_day
 * - monthly: next day_of_month (clamped to 28) at time_of_day
 */
export function computeNextRun(form) {
  const { frequency, time_of_day = '07:00' } = form
  if (frequency === 'once') return form.run_at ? new Date(form.run_at).toISOString() : null

  const [h, m] = String(time_of_day).split(':').map((n) => parseInt(n, 10) || 0)
  const now = new Date()
  const startAnchor = form.start_date ? new Date(`${form.start_date}T00:00:00`) : now
  const next = new Date(Math.max(startAnchor.getTime(), now.getTime()))
  next.setHours(h, m, 0, 0)

  if (frequency === 'daily') {
    if (next <= now) next.setDate(next.getDate() + 1)
  } else if (frequency === 'weekly') {
    const dow = Number.isFinite(form.day_of_week) ? form.day_of_week : 1
    let diff = (dow - next.getDay() + 7) % 7
    if (diff === 0 && next <= now) diff = 7
    next.setDate(next.getDate() + diff)
  } else if (frequency === 'monthly') {
    const dom = Math.min(Math.max(form.day_of_month ?? 1, 1), 28)
    next.setDate(dom)
    if (next <= now) { next.setMonth(next.getMonth() + 1); next.setDate(dom) }
  }
  return next.toISOString()
}

const iso = (d) => d.toISOString().slice(0, 10)

/** Resolve a coverage period to a concrete {from,to,label} (YYYY-MM-DD). */
export function resolvePeriod(period, customFrom, customTo) {
  const to = new Date()
  const from = new Date()
  switch (period) {
    case 'last_7':  from.setDate(to.getDate() - 7); break
    case 'last_90': from.setDate(to.getDate() - 90); break
    case 'mtd':     from.setDate(1); break
    case 'ytd':     from.setMonth(0, 1); break
    case 'custom':
      return {
        from: customFrom || null,
        to: customTo || null,
        label: `${customFrom || '...'} to ${customTo || '...'}`,
      }
    case 'last_30':
    default:        from.setDate(to.getDate() - 30); break
  }
  return { from: iso(from), to: iso(to), label: `${iso(from)} to ${iso(to)}` }
}

/* ── Live report data (honest empty states, never fabricated) ─────────────── */

/**
 * Fetch the rows that back a report type, scoped by coverage window + country.
 * Returns { rows, dataset } — dataset carries cols/headers/title for the export.
 */
export async function fetchReportRows(reportType, { from, to, country } = {}) {
  const ds = datasetFor(reportType)
  let q = supabase.from(ds.table).select(ds.cols.join(','))
  q = applyCountry(q, country)
  if (from) q = q.gte(ds.dateCol, from)
  if (to)   q = q.lte(ds.dateCol, to)
  if (ds.eqFilter) for (const [col, val] of Object.entries(ds.eqFilter)) q = q.eq(col, val)
  if (ds.orFilter) q = q.or(ds.orFilter)
  q = q.order(ds.dateCol, { ascending: ds.orderAscending === true, nullsFirst: false }).limit(5000)
  const { data, error } = await q
  if (error) throw error
  return { rows: data ?? [], dataset: ds }
}
