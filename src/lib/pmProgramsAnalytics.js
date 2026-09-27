/**
 * pmProgramsAnalytics.js - pure engine behind the Preventive Maintenance page
 * (/pm-programs) Plans and Service History registers.
 *
 * The due-status maths stays in pmSchedule.js and the service-cost analytics in
 * pmAnalytics.js; this module only holds what the page used to compute inline:
 * interval text, register filters, due-order sorting, the export row shapes and
 * the service-history summary strip.
 *
 * Honest nulls: a cost nobody recorded is null (rendered N/A), never 0.
 */
import { ASSET_CATEGORY_LABELS, PM_PRIORITY_META, PM_OUTCOME_META, meterUnit } from './pmVocab'
import { PM_STATUS_META, PM_DUE_META } from './pmPrograms'

export const INTERVAL_TYPE_LABEL = { days: 'days', months: 'months', km: 'km', hours: 'h' }

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const fmt = (v) => (num(v) === null ? 'N/A' : num(v).toLocaleString())

/** Parts cost from a parts_used list: qty (default 1) x unit cost, 2dp. */
export function sumPartsCost(parts) {
  if (!Array.isArray(parts)) return 0
  const total = parts.reduce((s, p) => {
    const qty = num(p?.qty)
    const cost = num(p?.cost)
    return s + (qty && qty > 0 ? qty : 1) * (cost ?? 0)
  }, 0)
  return Math.round(total * 100) / 100
}

/** Time + meter interval parts for one plan, e.g. ['6 months', 'every 10,000 km']. */
export function intervalSummary(p = {}) {
  const parts = []
  if (p.interval_value != null && p.interval_value !== '') {
    parts.push({ key: 'time', text: `${p.interval_value} ${INTERVAL_TYPE_LABEL[p.interval_type] || p.interval_type || ''}`.trim() })
  }
  const mu = meterUnit(p.meter_source)
  if (mu && p.meter_interval != null && p.meter_interval !== '') {
    parts.push({ key: 'meter', text: `every ${fmt(p.meter_interval)} ${mu}` })
  }
  return parts
}

export function planSearchText(p = {}) {
  return `${p.name || ''} ${p.asset_no || ''} ${ASSET_CATEGORY_LABELS[p.asset_category] || ''} ${p.site || ''} ${p.assigned_to || ''}`.toLowerCase()
}

/** Plans register filters. Plans carry `_st` from pmAssetDueStatus. */
export function filterPlans(plans = [], { search = '', status = 'all', category = 'all', dueOnly = false } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return plans.filter((p) => {
    if (status !== 'all' && p.status !== status) return false
    if (category !== 'all' && (p.asset_category || '') !== category) return false
    if (dueOnly && !(p._st?.band === 'overdue' || p._st?.band === 'due_soon')) return false
    if (q && !planSearchText(p).includes(q)) return false
    return true
  })
}

const BAND_RANK = { overdue: 0, due_soon: 1, scheduled: 2, none: 3 }

/**
 * Sort key for the Next due column: overdue first, then soonest by days, then
 * plans with no due date. Lower sorts first.
 */
export function dueSortValue(st = {}) {
  const rank = BAND_RANK[st.band] ?? 3
  const days = num(st.daysToDue)
  return rank * 1e6 + (days === null ? 99999 : days)
}

export function filterHistory(history = [], { asset = '', program = 'all', outcome = 'all', from = '', to = '' } = {}) {
  const a = String(asset || '').trim().toLowerCase()
  return history.filter((r) => {
    if (a && !String(r.asset_no || '').toLowerCase().includes(a)) return false
    if (program !== 'all' && String(r.pm_program_id) !== String(program)) return false
    if (outcome !== 'all' && r.outcome !== outcome) return false
    const d = r.service_date ? String(r.service_date).slice(0, 10) : ''
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    return true
  })
}

/** KPI strip for the (filtered) service history. */
export function historySummary(rows = []) {
  const costed = rows.map(r => num(r.total_cost)).filter(v => v !== null)
  const total = costed.length ? costed.reduce((s, v) => s + v, 0) : null
  const assets = new Set(rows.map(r => r.asset_no).filter(Boolean))
  const outcomes = {}
  rows.forEach(r => { const k = r.outcome || 'unknown'; outcomes[k] = (outcomes[k] || 0) + 1 })
  return {
    services: rows.length,
    assets: assets.size,
    totalCost: total,
    avgCost: costed.length ? total / costed.length : null,
    costedShare: rows.length ? costed.length / rows.length : null,
    withWorkOrder: rows.filter(r => r.work_order_no).length,
    outcomes,
  }
}

export const PLAN_EXPORT_COLS = ['name', 'asset_no', 'asset_category', 'interval', 'meter_interval', 'next_due', 'next_due_meter', 'priority', 'assigned_to', 'status', 'due']
export const PLAN_EXPORT_HEADERS = ['Plan', 'Asset', 'Category', 'Time interval', 'Meter interval', 'Next due', 'Next due meter', 'Priority', 'Assigned', 'Status', 'Due']

export function planExportRows(plans = []) {
  return plans.map((p) => {
    const mu = meterUnit(p.meter_source)
    return {
      name: p.name || '',
      asset_no: p.asset_no || '',
      asset_category: ASSET_CATEGORY_LABELS[p.asset_category] || '',
      interval: (p.interval_value != null && p.interval_value !== '') ? `${p.interval_value} ${INTERVAL_TYPE_LABEL[p.interval_type] || p.interval_type}` : '',
      meter_interval: (mu && p.meter_interval != null) ? `${p.meter_interval} ${mu}` : '',
      next_due: p.next_due || '',
      next_due_meter: (p.next_due_meter != null && mu) ? `${p.next_due_meter} ${mu}` : '',
      priority: PM_PRIORITY_META[p.priority]?.label || p.priority || '',
      assigned_to: p.assigned_to || '',
      status: PM_STATUS_META[p.status]?.label || p.status || '',
      due: PM_DUE_META[p._st?.band]?.label || p._st?.band || '',
    }
  })
}

export const HIST_EXPORT_COLS = ['service_date', 'asset_no', 'plan', 'meter', 'performed_by', 'outcome', 'parts_cost', 'labour_cost', 'total_cost', 'next_due', 'work_order_no']
export const HIST_EXPORT_HEADERS = ['Date', 'Asset', 'Plan', 'Meter reading', 'Performed by', 'Outcome', 'Parts', 'Labour', 'Total', 'Next due', 'WO no']

export function historyExportRows(rows = [], planNameById = new Map()) {
  return rows.map((r) => {
    const unit = meterUnit(r.meter_type)
    return {
      service_date: r.service_date ? String(r.service_date).slice(0, 10) : '',
      asset_no: r.asset_no || '',
      plan: planNameById.get(String(r.pm_program_id)) || '',
      meter: r.meter_reading != null ? (unit ? `${r.meter_reading} ${unit}` : String(r.meter_reading)) : '',
      performed_by: r.performed_by || '',
      outcome: PM_OUTCOME_META[r.outcome]?.label || r.outcome || '',
      parts_cost: r.parts_cost ?? '',
      labour_cost: r.labour_cost ?? '',
      total_cost: r.total_cost ?? '',
      next_due: r.next_due || '',
      work_order_no: r.work_order_no || '',
    }
  })
}
