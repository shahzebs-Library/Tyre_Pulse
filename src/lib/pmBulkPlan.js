/**
 * Bulk PM plans from a service template.
 *
 * Pure planner behind "Create plans from a template": picks the active vehicles a template fits, skips
 * assets that already have the same active plan, and returns ready-to-insert payloads. Nothing is written here.
 *
 * The first due date is ONE INTERVAL FROM TODAY. No real last-service date exists for these assets, so this is a
 * starting point the planner must replace by recording a service (record_pm_service advances it). The note on each
 * plan says so. No meter due value is invented: it stays empty until a reading is recorded.
 */
import { applyTemplate } from './pmTemplates'
import { pmVehicleProfile } from './pmVehicleSetup'
import { addTimeInterval } from './pmSchedule'

const norm = (v) => String(v ?? '').trim().toUpperCase()
const isActive = (v) => String(v?.status ?? 'Active').toLowerCase() === 'active' && v?.is_active !== false

export const BULK_NOTE = 'Created in bulk. First due date is one interval from creation until a real service is recorded.'

/**
 * @param {object} template  an entry of PM_TEMPLATES
 * @param {object[]} vehicles vehicle_fleet rows
 * @param {{today:string, existing?:object[]}} ctx  today as YYYY-MM-DD; existing pm_programs rows
 * @returns {{rows:object[], skippedExisting:number, skippedNoFit:number}}
 */
export function planPmFromTemplate(template, vehicles, { today, existing = [] } = {}) {
  const have = new Set(
    (existing || [])
      .filter((p) => String(p?.status ?? 'active').toLowerCase() === 'active')
      .map((p) => `${norm(p.country)}|${norm(p.asset_no)}|${norm(p.name)}`),
  )
  const rows = []
  let skippedExisting = 0
  let skippedNoFit = 0
  const nextDue = addTimeInterval(today, template?.interval_type, template?.interval_value)
  for (const v of vehicles || []) {
    if (!isActive(v) || !v?.asset_no) { skippedNoFit++; continue }
    const profile = pmVehicleProfile(v)
    if (!profile || profile.category !== template?.asset_category) { skippedNoFit++; continue }
    if (have.has(`${norm(v.country)}|${norm(v.asset_no)}|${norm(template.label)}`)) { skippedExisting++; continue }
    const meterOk = profile.sources.includes(template.meter_source)
    rows.push(applyTemplate(template, {
      asset_no: v.asset_no,
      asset_type: v.vehicle_type || null,
      site: v.site || null,
      country: v.country || null,
      status: 'active',
      last_done: null,
      next_due: nextDue,
      meter_source: meterOk ? template.meter_source : 'none',
      meter_interval: meterOk ? template.meter_interval : null,
      notes: [template.notes, BULK_NOTE].filter(Boolean).join(' '),
    }))
  }
  return { rows, skippedExisting, skippedNoFit }
}
