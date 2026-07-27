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
    table: 'stg_job_cards',
    label: 'Job cards (the full workshop cycle)',
    feeds: 'work_orders',
    sourceFile: 'Format job card export',
    verbatimHeaders: true,
    needsCountry: true,
    reimportSafe: 'safe',
    columns: ['country', '#', 'RFR Number', 'Job Card No', 'MR NO', 'SCO NO', 'Location',
      'Status', 'Type', 'Work Location', 'Production Complaint', 'Job Repair Description',
      'Asset Code', 'Asset Description', 'Plate No', 'Truck Category', 'Head/Tail', 'Scope',
      'Asset Category', 'Excepted Job Date/Time', 'Production Out', 'Workshop In',
      'Workshop Out', 'Production In', 'Total Breakdown hours', 'STD. Hours',
      'Spare Parts', 'Tyre', 'Oil', 'Others'],
    notes: 'Upload this DAILY. Each job card is matched on its number and REFRESHED in '
      + 'place, so re-uploading the same export as often as you like never stacks a copy, '
      + 'and a card that closed since yesterday simply updates. It drives the "Job cards '
      + 'today" panel on the front page. The four time columns are what make that panel '
      + 'work: Production Out to Workshop In is how long the asset waited before anyone '
      + 'started, Workshop In to Workshop Out is the actual repair. "Total Breakdown '
      + 'hours" is only kept when the card has closed, because the export counts it up to '
      + 'today for a card that never closed, which is why an asset down since 2022 reads '
      + '40,000 hours. The Spare Parts, Tyre, Oil and Others columns are stored for '
      + 'reference only: cost still comes from the expense grid, never from here.',
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
 * The three per-country expense tables share one column list, so the combined
 * entry above is expanded into a sheet each. Everything else is one to one.
 * @type {ReadonlyArray<{sheet:string, table:string}>}
 */
export const UPLOAD_SHEETS = Object.freeze([
  { sheet: '0 Job cards', table: 'stg_job_cards' },
  { sheet: '1 Expenses KSA', table: 'expenses_ksa' },
  { sheet: '1 Expenses UAE', table: 'expenses_uae' },
  { sheet: '1 Expenses Egypt', table: 'expenses_egypt' },
  { sheet: '2 Tyre changes', table: 'stg_monthly_tyres' },
  { sheet: '3 Job card task lines', table: 'stg_wo_lines' },
  { sheet: '4 Job card history', table: 'stg_complaints' },
  { sheet: '5 Asset master', table: 'stg_assets' },
  { sheet: '6 Open job cards', table: 'stg_open_wo' },
  { sheet: '7 Daily km', table: 'daily_km' },
  { sheet: '8 Tyre brand fill', table: 'stg_tyre_brand' },
])

/**
 * Pure: the blank upload workbook, as sheets of rows-of-cells.
 *
 * Each sheet is named for the table it is imported into and its header row is
 * the table's real column list, so the Supabase Table Editor CSV import maps
 * every column by itself. Three banner lines sit above the header carrying the
 * destination table and the re-import warning, because that warning is useless
 * if it only lives in a README nobody opens.
 *
 * Derived from IMPORT_TARGETS, so adding a target here puts it in the workbook.
 * @returns {Array<{name:string, rows:Array<Array<string>>}>}
 */
export function uploadWorkbookSheets() {
  const readme = [
    ['TYRE PULSE - DATA UPLOAD WORKBOOK'],
    [],
    ['HOW TO USE'],
    ['1', 'Open the sheet for the data you have. Do not rename or reorder the headers.'],
    ['2', 'Paste your rows under the headers. Leave a column blank if you do not have it.'],
    ['3', 'Save that ONE sheet as CSV.'],
    ['4', 'Supabase, Table Editor, open the table named on the sheet, Import data from CSV.'],
    ['5', 'The columns match the table exactly, so every one maps itself.'],
    [],
    ['THE ONE RULE THAT MATTERS'],
    ['', 'On the Expenses sheets, always fill the "#" column with the ERP line number.'],
    ['', 'It is how the system recognises a line it has already loaded. With it, uploading'],
    ['', 'the same file twice changes nothing. Without it every row loads again and your'],
    ['', 'spend is overstated.'],
    [],
    ['Sheet', 'Import into', 'What it is', 'Ends up in', 'Upload twice?'],
  ]
  for (const { sheet, table } of UPLOAD_SHEETS) {
    const t = importTargetFor(table)
    readme.push([sheet, table, t?.label || '', t?.feeds || '',
      t?.reimportSafe === 'safe' ? 'Safe, nothing duplicates' : 'Only safe when "#" is filled'])
  }
  readme.push([], ['NOTES PER SHEET'])
  for (const { sheet, table } of UPLOAD_SHEETS) {
    const t = importTargetFor(table)
    if (t) readme.push([sheet, t.notes])
  }
  readme.push([], ['IF YOU UPLOAD SOMETHING TWICE BY MISTAKE'],
    ['', 'Console, Duplicate Control finds it, prices it and undoes it in one click.'],
    ['', 'Console, Import History lists every file already loaded, matched on content.'])

  const sheets = [{ name: 'READ ME', rows: readme }]
  for (const { sheet, table } of UPLOAD_SHEETS) {
    const t = importTargetFor(table)
    if (!t) continue
    sheets.push({
      name: sheet.slice(0, 31),
      rows: [
        [`Import into: ${table}`],
        [t.label],
        [t.reimportSafe === 'safe'
          ? 'Uploading this file twice is safe.'
          : 'Fill the "#" column, or a second upload duplicates every row.'],
        [],
        [...t.columns],
      ],
    })
  }
  return sheets
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
