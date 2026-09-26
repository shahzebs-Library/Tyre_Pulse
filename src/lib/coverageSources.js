/**
 * coverageSources.js - joins a coverage gap to the file that closes it.
 *
 * The coverage panel says "KSA job cards missed 23 days". That is only half an
 * answer: the person then has to work out which export that is, which table it
 * goes into, and what the headers must say. Both halves already exist in the
 * codebase - the gap comes from `get_upload_coverage_detail`, the file details
 * from IMPORT_TARGETS - and this is the join between them.
 *
 * NO SECOND REGISTRY. Everything here is derived from IMPORT_TARGETS by the
 * `feeds` field, so adding an import target makes it appear on the coverage
 * panel automatically and the two cannot drift apart.
 */
import { IMPORT_TARGETS } from './importTargets'

/**
 * Which table each coverage source counts rows in. This is the ONLY hand-written
 * mapping, and it is small on purpose: the coverage RPC names its sources, and
 * those names have to be tied to something.
 */
export const SOURCE_FEEDS = Object.freeze({
  expenses: 'parts_consumption',
  job_cards: 'work_orders',
  tyre_records: 'tyre_records',
  production_m3: 'production_logs',
  wo_line_items: 'work_order_line_items',
  open_work_orders: 'open_work_orders',
  odometer: 'odometer_logs (and vehicle_fleet.current_km)',
})

/**
 * Where a module's rows come from when there is NO upload file for it: the
 * screen (web or phone) where people record them. A gap on one of these means
 * nobody recorded anything on those days, not that a file was forgotten.
 */
export const ENTERED_IN = Object.freeze({
  production_m3: 'Production (m3) page, or the Production tab in Data Intake',
  sco_costs: 'SCO Costs page, or the SCO Cost tab in Data Intake',
  sany_invoices: 'SANY Invoices page (Excel or PDF proforma), or the SANY tab in Data Intake',
  inspections: 'Inspections, on the web or the phone app',
  engine_hours: 'Meter Log on the phone app, or the Engine Hours page',
  wash_records: 'Vehicle Washing, on the web or the phone app',
  accidents: 'Accidents register, on the web or the phone app',
  checklists: 'Checklists, filled on the phone app or the web',
  asset_breakdowns: 'Breakdown Register page',
  telematics: 'Telematics export loaded into asset utilization (GPS provider file, loaded by the admin)',
  asset_disposals: 'Asset Disposals page',
  insurance_claims: 'Insurance Policies page, Claims register tab (from the insurer file)',
  gate_passes: 'Gate Pass page',
  corrective_actions: 'Corrective Actions page (also raised from inspections)',
  pm_services: 'Preventive Maintenance, Record service (web or phone)',
  tyre_service_events: 'Tyre Bay on the asset page, or Tyre Service Events',
  material_issues: 'Store Material Issue / Return page',
  repair_requests: 'Repair Requests page',
  parts_requests: 'Parts Requests page',
  incident_reports: 'Incident Reports page',
  breakdown_callouts: 'Breakdown callouts (service requests)',
  dvir_reports: 'Driver vehicle checks on the phone app',
  driver_expenses: 'Driver Expenses page',
  fuel_deliveries: 'Fuel Delivery page',
  warranty_claims: 'Warranty Tracker page',
  purchase_orders: 'Procurement, Purchase orders',
  goods_receipts: 'Goods Receipt page',
  tpms_readings: 'TPMS page (sensor readings)',
  journeys: 'Journeys page',
})

/** Plain-language name for a coverage source. */
export const SOURCE_LABEL = Object.freeze({
  expenses: 'Expenses',
  job_cards: 'Job cards',
  tyre_records: 'Tyre records',
  production_m3: 'Production (m3)',
  wo_line_items: 'Job card line items',
  open_work_orders: 'Open job cards snapshot',
  odometer: 'Meter readings (km)',
})

/**
 * The import target that fills a coverage source, or null when there is not one.
 *
 * `production_m3` deliberately returns null: production_logs has NO staging
 * table, so there is genuinely no file to upload for it - those rows are entered
 * in the app. Inventing a target here would send someone looking for an export
 * that does not exist.
 */
export function targetForSource(src) {
  const feeds = SOURCE_FEEDS[src]
  if (!feeds) return null
  return IMPORT_TARGETS.find((t) => t.feeds === feeds) || null
}

/** Every country-specific table name for a target, split from its combined label. */
export function tablesFor(target) {
  if (!target?.table) return []
  return String(target.table).split('/').map((s) => s.trim()).filter(Boolean)
}

/**
 * The table to use for one country, or null when the target is not per country.
 * Matching on the suffix rather than position, because a positional guess breaks
 * the moment a country is added in a different order.
 */
export function tableForCountry(target, country) {
  const tables = tablesFor(target)
  if (tables.length <= 1) return tables[0] || null
  const suffix = String(country || '').trim().toLowerCase()
  if (!suffix) return null
  return tables.find((t) => t.toLowerCase().endsWith(`_${suffix}`)) || null
}

/**
 * What a person needs to know to close this gap, in the order they need it.
 *
 * Returns `available: false` with a reason rather than an empty shell, because
 * "there is no file for this" and "we could not look it up" are different
 * answers and must not render the same way.
 */
export function howToFill(src, country) {
  const label = SOURCE_LABEL[src] || src
  const target = targetForSource(src)

  if (!target) {
    return {
      available: false,
      label,
      reason: ENTERED_IN[src]
        ? `No upload file for this one. It is recorded in: ${ENTERED_IN[src]}. `
          + 'A gap here means nobody recorded anything on those days.'
        : 'No import file is registered for this feed.',
    }
  }

  return {
    available: true,
    label,
    sourceFile: target.sourceFile,
    intoTable: tableForCountry(target, country),
    allTables: tablesFor(target),
    feeds: target.feeds,
    columns: target.columns || [],
    verbatimHeaders: !!target.verbatimHeaders,
    needsCountry: !!target.needsCountry,
    reimportSafe: target.reimportSafe,
    notes: target.notes,
  }
}

/**
 * The one-line warning about uploading the same file twice.
 *
 * `needs-key` is the dangerous case and says exactly which column prevents it -
 * this is the path that actually produced 8,248 duplicate expense rows, so the
 * wording names the consequence rather than being polite about it.
 */
export function reimportWarning(target) {
  const safe = typeof target === 'string' ? target : target?.reimportSafe
  if (safe === 'safe') {
    return { tone: 'good', text: 'Uploading this file again is safe - it refreshes the rows in place.' }
  }
  if (safe === 'needs-key') {
    return {
      tone: 'danger',
      text: 'Map the line-number column. With it, uploading the same file again changes nothing. '
        + 'Without it, every row is added a second time and your spend goes up.',
    }
  }
  return { tone: 'default', text: 'Check the notes before uploading this file a second time.' }
}

/** Coverage sources that do have a file, for a "what can I upload" list. */
export function uploadableSources() {
  return Object.keys(SOURCE_FEEDS).filter((s) => targetForSource(s) !== null)
}
