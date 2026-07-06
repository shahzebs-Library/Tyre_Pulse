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

/**
 * Every intake module has a downloadable template so an operator can arrange any
 * file to auto-map at 100%. Order mirrors the module picker in the Data Intake
 * Center. Filenames are used for the browser download + the static copies under
 * public/templates/.
 */
export const TEMPLATE_MODULES = Object.freeze([
  { module: 'fleet', label: 'Fleet / Assets', filename: 'fleet_import_template.csv' },
  { module: 'tyre', label: 'Tyre Lifecycle', filename: 'tyre_import_template.csv' },
  { module: 'stock', label: 'Stock', filename: 'stock_import_template.csv' },
  { module: 'accident', label: 'Accidents / Insurance', filename: 'accident_import_template.csv' },
  { module: 'inspection', label: 'Inspections', filename: 'inspection_import_template.csv' },
  { module: 'workorder', label: 'Work Orders', filename: 'workorder_import_template.csv' },
  { module: 'warranty', label: 'Warranty Claims', filename: 'warranty_import_template.csv' },
  { module: 'gatepass', label: 'Gate Pass', filename: 'gatepass_import_template.csv' },
  { module: 'supplier', label: 'Suppliers', filename: 'supplier_import_template.csv' },
  { module: 'driver', label: 'Drivers', filename: 'driver_import_template.csv' },
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
  // accident
  incident_date: ['2021-06-11', '2021-07-03'],
  incident_time: ['14:30', '09:15'],
  location: ['Riyadh Ring Road', 'Dammam Highway'],
  accident_type: ['Collision', 'Tyre burst'],
  severity: ['Major', 'Minor'],
  damage_description: ['Front bumper + axle', 'Rear tyre + rim'],
  driver_name: ['Ahmed K.', 'Yousef M.'],
  police_report_no: ['PR-2021-4471', ''],
  insurer: ['Tawuniya', 'Bupa Arabia'],
  policy_no: ['POL-88231', 'POL-88232'],
  insurance_claim_no: ['CLM-55012', ''],
  claim_status: ['Under review', 'Approved'],
  claim_amount: ['18500', '4200'],
  claim_approved_amount: ['', '4200'],
  recovered_amount: ['', '0'],
  deductible: ['1000', '500'],
  estimated_damage_cost: ['20000', '4500'],
  repair_cost: ['18500', '4200'],
  parts_cost: ['12000', '3000'],
  closure_status: ['Open', 'Closed'],
  // inspection
  inspection_date: ['2021-06-20', '2021-06-21'],
  inspection_type: ['Pre-trip', 'Monthly'],
  inspector: ['Khalid A.', 'Sara N.'],
  tyre_serial: ['SN-100045', 'SN-100046'],
  findings: ['Tread within limit', 'Low pressure — reinflated'],
  odometer_km: ['132000', '98000'],
  // work order
  work_order_no: ['WO-2021-3310', 'WO-2021-3311'],
  tyre_position: ['Drive-L1', 'Steer-R1'],
  work_type: ['Tyre replacement', 'Puncture repair'],
  priority: ['High', 'Normal'],
  technician_name: ['Bilal R.', 'Omar S.'],
  workshop_name: ['Central Workshop', 'Central Workshop'],
  opened_at: ['2021-06-20', '2021-06-22'],
  started_at: ['2021-06-20', '2021-06-22'],
  completed_at: ['2021-06-21', '2021-06-22'],
  target_completion: ['2021-06-22', '2021-06-23'],
  labour_hours: ['3', '1'],
  labour_rate: ['80', '80'],
  labour_cost: ['240', '80'],
  lubricant_cost: ['0', '0'],
  tyre_cost: ['2900', '0'],
  outside_repair_cost: ['0', '0'],
  breakdown_hours: ['4', '1'],
  standard_hours: ['3', '1'],
  odometer: ['132000', '98000'],
  total_cost: ['3140', '160'],
  // warranty
  serial_number: ['SN-100045', 'SN-100046'],
  claim_no: ['WCLM-2021-081', 'WCLM-2021-082'],
  fitment_date: ['2021-03-15', '2021-02-10'],
  failure_type: ['Sidewall crack', 'Tread separation'],
  credit_amount: ['1450', '0'],
  // gate pass
  pass_date: ['2021-06-25', '2021-06-26'],
  denial_reason: ['', 'Open critical defect'],
  // supplier
  supplier_name: ['Al-Jazira Tyres', 'Gulf Tyre Trading'],
  supplier_code: ['SUP-001', 'SUP-002'],
  supplier_type: ['Tyre dealer', 'Retreader'],
  contact_person: ['Faisal H.', 'Nabil T.'],
  phone: ['+966501234567', '+966559876543'],
  email: ['sales@aljazira.example', 'info@gulftyre.example'],
  rating: ['4.5', '3.8'],
  // driver
  driver_id: ['EMP-2201', 'EMP-2202'],
  license_no: ['DL-778812', 'DL-778813'],
  license_expiry: ['2024-12-31', '2025-06-30'],
  nationality: ['Saudi', 'Pakistani'],
  assigned_asset_no: ['TRK-2201', 'TRK-2202'],
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
