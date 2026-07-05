/**
 * Import CSV templates — generated from the canonical MODULE_FIELDS registry so
 * the downloadable template can never drift from what the intake mapper accepts.
 *
 * Each template uses the field's canonical `label` as the column header. Every
 * label is registered as an exact alias in synonyms.js, so a file built from
 * this template auto-maps 100% of its columns with zero manual mapping — which
 * is exactly what "arrange my file to get 100% data" needs.
 */
import { MODULE_FIELDS } from './synonyms.js'

/** Modules that have a real live target table + a meaningful template. */
export const TEMPLATE_MODULES = Object.freeze([
  { module: 'tyre', label: 'Tyre records', filename: 'tyre_import_template.csv' },
  { module: 'fleet', label: 'Fleet / vehicles', filename: 'fleet_import_template.csv' },
  { module: 'stock', label: 'Stock', filename: 'stock_import_template.csv' },
])

/** A realistic sample value per field, so the template shows the expected shape. */
const SAMPLE = {
  // tyre
  serial_no: ['SN-100045', 'SN-100046'],
  asset_no: ['TRK-2201', 'TRK-2201'],
  brand: ['Michelin', 'Bridgestone'],
  size: ['315/80R22.5', '315/80R22.5'],
  position: ['Drive-L1', 'Steer-R1'],
  pressure_reading: ['120', '118'],
  tread_depth: ['14', '9'],
  site: ['Riyadh', 'Riyadh'],
  country: ['KSA', 'KSA'],
  cost_per_tyre: ['1450', '1600'],
  qty: ['2', '1'],
  total_amount: ['2900', '1600'],
  km_at_fitment: ['84000', '91000'],
  km_at_removal: ['132000', ''],
  removal_reason: ['Regular wear', ''],
  supplier: ['Al-Jazira Tyres', 'Al-Jazira Tyres'],
  issue_date: ['2021-03-15', '2021-04-02'],
  removal_date: ['2021-09-20', ''],
  job_card: ['JC-55021', 'JC-55088'],
  vehicle_type: ['Prime Mover', 'Prime Mover'],
  hrs_at_fitment: ['', ''],
  hrs_at_removal: ['', ''],
  total_km: ['48000', ''],
  total_hrs: ['', ''],
  // fleet
  fleet_number: ['FL-2201', 'FL-2202'],
  make: ['Mercedes', 'Volvo'],
  model: ['Actros 3345', 'FH16'],
  year: ['2019', '2020'],
  department: ['Logistics', 'Logistics'],
  operator_name: ['Ahmed K.', 'Yousef M.'],
  region: ['Central', 'Central'],
  tyre_size: ['315/80R22.5', '315/80R22.5'],
  status: ['Active', 'Active'],
  current_km: ['132000', '98000'],
  registration_no: ['RUH-8842', 'RUH-8843'],
  notes: ['', ''],
  // stock
  description: ['315/80R22.5 Michelin XDA', 'Valve stem TR414'],
  stock_qty: ['24', '300'],
  min_level: ['6', '50'],
  critical_level: ['3', '20'],
  reorder_qty: ['20', '200'],
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Build a UTF-8 CSV template string for a module: a header row of canonical
 * labels (auto-mapping) followed by 2 example rows.
 * @param {'tyre'|'fleet'|'stock'} module
 * @returns {string}
 */
export function buildTemplateCsv(module) {
  const fields = MODULE_FIELDS[module]
  if (!fields) throw new Error(`No template for module "${module}"`)
  const headers = fields.map((f) => f.label)
  const rows = [0, 1].map((i) =>
    fields.map((f) => csvCell(SAMPLE[f.key]?.[i] ?? '')).join(','),
  )
  // Prepend a UTF-8 BOM so Excel opens Arabic/site names in the right encoding.
  return '﻿' + [headers.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n'
}

/**
 * A short, human-readable field reference for a module: which columns exist,
 * whether they're required, and what they power. Rendered in the intake UI so
 * the operator knows how to arrange the file for 100% completeness.
 * @param {'tyre'|'fleet'|'stock'} module
 */
export function templateFieldGuide(module) {
  const fields = MODULE_FIELDS[module] || []
  return fields.map((f) => ({
    label: f.label,
    key: f.key,
    required: !!f.required,
    type: f.type,
    derived: !!f.derived,
  }))
}

/** Trigger a browser download of the module's CSV template. */
export function downloadTemplateCsv(module) {
  const tpl = TEMPLATE_MODULES.find((m) => m.module === module)
  const csv = buildTemplateCsv(module)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = tpl?.filename || `${module}_import_template.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
