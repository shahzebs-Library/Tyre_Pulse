/**
 * importTargets.js — the single reference for "which Supabase table do I import
 * this file into?".
 *
 * Every entry is a real staging table with a BEFORE INSERT trigger that maps,
 * classifies, de-dupes where it can and routes the row into the live table, then
 * returns NULL. That is why the staging tables always look empty after an import:
 * they are pure pipes, not storage. Nothing here is a live table you edit
 * directly.
 *
 * WORKFLOW for each one (Supabase dashboard -> Table Editor -> Import data from CSV):
 *   1. Save the ERP file as CSV.
 *   2. Delete any rows ABOVE the real header row (Ramco exports carry a title band).
 *   3. Add a `country` column with KSA / UAE / Egypt (except the expenses_* tables,
 *      which already know their country from the table name).
 *   4. Import into the table named below and map the columns. Most auto-match.
 *
 * `columns` is copied from the live schema. Headers that must match the ERP export
 * VERBATIM (quoted, spaces preserved) are flagged with `verbatimHeaders: true` -
 * those tables exist precisely so the dashboard CSV importer auto-maps 1:1 with
 * zero clicking.
 *
 * RE-IMPORT SAFETY, verified trigger by trigger (V363). Most paths are now
 * idempotent, but NOT all, so `reimportSafe` on each entry states the real answer:
 *   'safe'      - re-importing the same file changes nothing, or refreshes in place.
 *   'needs-key' - idempotent ONLY when the ERP line number column is mapped.
 *                 Without it a re-run duplicates, because there is nothing to match
 *                 a resent row against.
 * Anything reported here as unsafe is also findable afterwards in
 * Console -> Duplicate Control, which finds, prices and undoes exactly that mistake.
 */

/**
 * @typedef {object} ImportTarget
 * @property {string} table            staging table to import into
 * @property {string} label            what the file is
 * @property {string} feeds            the live table the rows end up in
 * @property {string} sourceFile       which ERP export this is
 * @property {boolean} verbatimHeaders headers must match the ERP export exactly
 * @property {boolean} needsCountry    you must add a `country` column to the CSV
 * @property {'safe'|'needs-key'} reimportSafe what happens if you upload it twice
 * @property {string[]} columns        the staging table's columns, in order
 * @property {string} notes            gotchas worth knowing before you upload
 */

/** @type {ReadonlyArray<ImportTarget>} */
export const IMPORT_TARGETS = Object.freeze([
  {
    table: 'expenses_ksa / expenses_uae / expenses_egypt',
    label: 'Expense grid (parts / tyre / oil costs)',
    feeds: 'parts_consumption',
    sourceFile: 'Ramco "grid details" parts consumption export',
    verbatimHeaders: true,
    needsCountry: false,
    reimportSafe: 'needs-key',
    columns: ['#', 'Issue Number', 'Work Order Number', 'Transaction Type', 'Asset Code',
      'Asset Description', 'Asset Type', 'Store Code', 'Cost Center', 'Itemcode', 'Qty',
      'Item Description', 'Values', 'Spare Parts', 'Trye', 'Oil', 'Total Parts Consumption'],
    notes: 'THE authoritative cost source. Pick the table for the country - the country '
      + 'comes from the table name, not a column. Headers must match the export exactly '
      + '(including the misspelled "Trye"). Cost is taken from "Values"; the item '
      + 'DESCRIPTION decides whether a line is tyre, spare or oil, not the ERP column. '
      + 'ALWAYS MAP THE "#" COLUMN (the ERP line number). With it, re-uploading the same '
      + 'file changes nothing, because each source line is recognised and skipped; '
      + 'without it a re-run duplicates every row and inflates your spend. This is the '
      + 'exact path that produced the duplicate expense rows. Big files stall the '
      + 'dashboard importer because of the embedded inch marks in item descriptions - '
      + 'use the in-app Data Intake page for those.',
  },
  {
    table: 'stg_monthly_tyres',
    label: 'Monthly tyre consumption / tyre changes',
    feeds: 'tyre_records',
    sourceFile: 'Monthly Tyres Consumption export',
    verbatimHeaders: false,
    needsCountry: true,
    reimportSafe: 'safe',
    columns: ['country', 'job_card_no', 'job_card_date', 'veh_no', 'veh_type', 'item_tyre',
      'tyre_position', 'tyre_no', 'tyre_fix_date', 'fixed_km', 'fixed_hrs',
      'tyre_removed_date', 'removed_km', 'removed_hrs', 'reason', 'total_km', 'total_hrs',
      'brand'],
    notes: 'Carries NO cost - price comes from the expense grid. Map `brand` if the source '
      + 'has it: unmapped brand is the single biggest blank-column gap in the system. '
      + 'Reversed fix/remove dates are auto-corrected on load.',
  },
  {
    table: 'stg_wo_lines',
    label: 'Work order task lines',
    feeds: 'work_order_line_items',
    sourceFile: 'Job card task/line detail export',
    verbatimHeaders: false,
    needsCountry: true,
    reimportSafe: 'safe',
    columns: ['country', 'work_order_no', 'asset_no', 'site', 'opened_date', 'work_type',
      'task', 'detail', 'action', 'qty', 'source_row'],
    notes: 'Always map `source_row` (the file\'s own line number). It is what lets the '
      + 'system tell a genuinely repeated task line apart from an accidental double '
      + 'import - without it, real lines look like duplicates.',
  },
  {
    table: 'stg_complaints',
    label: 'Vehicle complaints / job card history',
    feeds: 'work_orders',
    sourceFile: 'Vehicle Complaints History export',
    verbatimHeaders: false,
    needsCountry: true,
    reimportSafe: 'safe',
    columns: ['country', 'veh_no', 'driver_name', 'tracking_category', 'location',
      'workshop_location', 'make', 'capacity', 'jc_no', 'km_hr', 'complaints', 'qc_remarks',
      'job_done_description', 'std_hrs', 'manpow_hrs', 'vehicle_in_date', 'vehicle_out_date',
      'total_bd_hrs', 'reason_of_repair'],
    notes: 'De-duplicates on job card number per country, so the same JC number can exist '
      + 'independently in KSA, UAE and Egypt. Carries no cost.',
  },
  {
    table: 'stg_assets',
    label: 'Asset master (the vehicle register)',
    feeds: 'vehicle_fleet',
    sourceFile: 'aeqp equipment grid / asset_details export',
    verbatimHeaders: false,
    needsCountry: true,
    reimportSafe: 'safe',
    columns: ['country', 'asset_no', 'asset_desc', 'plate_no', 'chassis_no', 'serial_no',
      'asset_type', 'asset_location', 'arabic_location', 'asset_status', 'asset_shift', 'km',
      'brand', 'hour', 'driver_issue_date', 'driver_expiry_date', 'mvip_issue_date',
      'mvip_expiry_date', 'insurance_type', 'insurance_name', 'insurance_start_date',
      'insurance_expire_date', 'insurance_value', 'operating_card_no',
      'operating_card_issue_date', 'operating_card_expiry_date', 'model_year', 'useful_life',
      'operation_start_date', 'purchase_value', 'net_book_value',
      'monthly_depreciation_value', 'fa_asset_number', 'remarks'],
    notes: 'Inserts NEW assets only - it does not refresh an existing asset. The finance '
      + 'and expiry columns (purchase value, net book value, insurance, operating card, '
      + 'licence dates) are what the fleet-value and compliance reports read, so map them.',
  },
  {
    table: 'stg_open_wo',
    label: 'Open job cards (current snapshot)',
    feeds: 'open_work_orders',
    sourceFile: 'Open Job Cards export',
    verbatimHeaders: false,
    needsCountry: true,
    reimportSafe: 'safe',
    columns: ['country', 'location', 'job_card_type', 'job_card_no', 'jc_status',
      'job_card_date', 'jc_open_time', 'asset_type', 'asset_no', 'no_of_days_jc_open',
      'complaint'],
    notes: 'A live picture of what is open, not history. Each job card number is matched '
      + 'per country and REFRESHED in place, so re-uploading the export as often as you '
      + 'like updates status and days-open without ever stacking copies.',
  },
  {
    table: 'daily_km',
    label: 'Daily kilometre / meter readings',
    feeds: 'odometer_logs (and vehicle_fleet.current_km)',
    sourceFile: 'Your own asset-code vs KM sheet',
    verbatimHeaders: false,
    needsCountry: true,
    reimportSafe: 'safe',
    columns: ['asset_code', 'asset_no', 'asset', 'equipment_no', 'kms', 'km', 'odometer',
      'odometer_km', 'reading', 'date', 'reading_date', 'txn_date', 'country', 'site',
      'notes'],
    notes: 'Deliberately forgiving: fill in ANY ONE of the asset columns (asset_code / '
      + 'asset_no / asset / equipment_no), ANY ONE of the km columns (kms / km / odometer / '
      + 'odometer_km / reading) and ANY ONE of the date columns. Leave the rest empty. '
      + 'A reading below the asset\'s last reading is accepted but flagged, never silently '
      + 'dropped. Advancing the odometer also updates the vehicle\'s current km.',
  },
  {
    table: 'stg_tyre_brand',
    label: 'Tyre brand backfill',
    feeds: 'tyre_records.brand',
    sourceFile: 'Serial-to-brand list (fill sheet)',
    verbatimHeaders: false,
    needsCountry: true,
    reimportSafe: 'safe',
    columns: ['country', 'serial', 'brand'],
    notes: 'Only fills a brand that is currently blank; it never overwrites one that is '
      + 'already set. Prefer re-importing the original tyre file with brand mapped - the '
      + 'source files do carry brand, it simply was not mapped on the original load.',
  },
])

/**
 * Targets where re-importing the same file CANNOT create duplicates, verified
 * against each staging trigger in V363. Derived from the declared flag rather than
 * by matching prose, so it can never drift from what each entry actually says.
 */
export const SAFE_TO_REIMPORT = Object.freeze(
  IMPORT_TARGETS.filter((t) => t.reimportSafe === 'safe').map((t) => t.table),
)

/** Targets that are only idempotent once the ERP line-number column is mapped. */
export const REIMPORT_NEEDS_KEY = Object.freeze(
  IMPORT_TARGETS.filter((t) => t.reimportSafe === 'needs-key').map((t) => t.table),
)

/**
 * Pure: look up a target by its staging table name (case-insensitive, and tolerant
 * of the combined `expenses_ksa / expenses_uae / expenses_egypt` entry).
 * @param {string} table
 * @returns {ImportTarget|null}
 */
export function importTargetFor(table) {
  const needle = String(table || '').trim().toLowerCase()
  if (!needle) return null
  return (
    IMPORT_TARGETS.find((t) => t.table.toLowerCase() === needle)
    || IMPORT_TARGETS.find((t) => t.table.toLowerCase().split(' / ').includes(needle))
    || null
  )
}

/**
 * Pure: flat rows for an Excel/CSV export of this reference, so the reference can
 * leave the app and sit next to the files being prepared.
 * @returns {Array<object>}
 */
export function importTargetRows() {
  return IMPORT_TARGETS.map((t) => ({
    import_into_table: t.table,
    what_it_is: t.label,
    ends_up_in: t.feeds,
    source_file: t.sourceFile,
    add_country_column: t.needsCountry ? 'Yes' : 'No (country comes from the table name)',
    headers_must_match_exactly: t.verbatimHeaders ? 'Yes' : 'No',
    safe_to_upload_twice: t.reimportSafe === 'safe'
      ? 'Yes'
      : 'Only if the ERP line number column is mapped',
    columns: t.columns.join(', '),
    notes: t.notes,
  }))
}
