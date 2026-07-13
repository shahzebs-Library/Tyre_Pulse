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
  { value: 'stock',      label: 'Stock & Receipts' },
  { value: 'vendor',     label: 'Vendor / Procurement' },
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
}

export function datasetFor(reportType) {
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
        label: `${customFrom || '…'} → ${customTo || '…'}`,
      }
    case 'last_30':
    default:        from.setDate(to.getDate() - 30); break
  }
  return { from: iso(from), to: iso(to), label: `${iso(from)} → ${iso(to)}` }
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
  q = q.order(ds.dateCol, { ascending: false }).limit(5000)
  const { data, error } = await q
  if (error) throw error
  return { rows: data ?? [], dataset: ds }
}
