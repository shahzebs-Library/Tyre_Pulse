/**
 * ERP report intake engine - pure detection + mapping for the multi-file Data Intake.
 *
 * The customer's ERP (Ramco) exports several report types that all cover the SAME
 * periods and must be MERGED (never flagged as duplicates): the parts/expense grid,
 * the monthly tyre-consumption report, the vehicle-complaints history, and an
 * open-job-card follow-up list. These exports are messy: the header is often on the
 * 3rd row (a title + date-range band sits above it), values carry trailing spaces/
 * tabs, and the last rows are noise (GRAND TOTAL, "Printed By"/employee id, "Applied
 * filters"). This engine detects the report type, locates the real header row, strips
 * the footer noise, and maps each row to its destination table.
 *
 * COST RULE (from the customer): cost is taken ONLY from the parts/expense grid
 * (parts_consumption). Every other report's cost columns are ignored - the mappers
 * here never emit a cost for tyre_records or work_orders; tyre prices are linked from
 * the grid afterwards by job card + asset.
 *
 * @module erpIntake
 */

const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase()
const clean = (v) => String(v == null ? '' : v).replace(/["\r\n\t]/g, ' ').replace(/&#[0-9]+;/g, ' ').replace(/ {2,}/g, ' ').trim()

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** Parse a Ramco date cell to ISO 'YYYY-MM-DD', or '' when not a date. Handles
 * YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY and DD-Mon-YY / DD-Mon-YYYY. */
export function parseDate(v) {
  const s = clean(v)
  if (!s) return ''
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)          // DD-MM-YYYY
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})/)     // DD-Mon-YY
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()]
    if (!mo) return ''
    let y = Number(m[3]); if (y < 100) y += 2000
    return `${y}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
  }
  return ''
}

const numStr = (v) => {
  const s = clean(v).replace(/,/g, '')
  return /^-?\d+(\.\d+)?$/.test(s) ? s : ''
}

/** Report types this engine recognises. */
export const REPORT_TYPES = Object.freeze({
  GRID: 'grid',
  MONTHLY_TYRES: 'monthly_tyres',
  COMPLAINTS: 'complaints',
  OPEN_WO: 'open_wo',
  ASSETS: 'assets',
})

/** Header signatures: a set of tokens that must all be present on the header row. */
const SIGNATURES = [
  { type: REPORT_TYPES.GRID, need: ['work order number', 'item description', 'values', 'spare parts'], target: 'parts_consumption' },
  { type: REPORT_TYPES.MONTHLY_TYRES, need: ['tyre position', 'tyre fix date', 'removed km', 'reason'], target: 'tyre_records' },
  { type: REPORT_TYPES.COMPLAINTS, need: ['complaints', 'job done description', 'vehicle in date'], target: 'work_orders' },
  { type: REPORT_TYPES.OPEN_WO, need: ['job card no', 'j c status', 'no of days jc open'], target: 'open_work_orders' },
  { type: REPORT_TYPES.ASSETS, need: ['asset desc', 'plate no', 'chassis no'], target: 'vehicle_fleet' },
]

/**
 * Find the header row + report type by scanning the first `scan` rows for a known
 * signature. Returns { type, target, headerRow, headerIndex } or null.
 * @param {Array<Array<any>>} aoa @param {{ scan?:number }} [opts]
 */
export function detectReport(aoa = [], { scan = 8 } = {}) {
  const rows = Array.isArray(aoa) ? aoa : []
  for (let i = 0; i < Math.min(scan, rows.length); i += 1) {
    const cells = (rows[i] || []).map(norm)
    const joined = ' ' + cells.join(' | ') + ' '
    for (const sig of SIGNATURES) {
      if (sig.need.every((tok) => joined.includes(tok))) {
        return { type: sig.type, target: sig.target, headerRow: rows[i], headerIndex: i }
      }
    }
  }
  return null
}

/** A row is footer noise: empty, a totals line, a print/employee stamp, or a filter note. */
export function isFooterRow(cells = []) {
  const joined = norm(cells.join(' '))
  if (!joined) return true
  if (/(grand total|sub total|subtotal)/.test(joined)) return true
  if (/(printed by|printed date|printed on|employee (id|code)|applied filters)/.test(joined)) return true
  // a row whose only content is a bare 6+ digit id (an employee code echoed alone)
  const nonEmpty = cells.filter((c) => String(c).trim() !== '')
  if (nonEmpty.length === 1 && /^\d{5,}$/.test(String(nonEmpty[0]).trim())) return true
  return false
}

/** Build a header -> column-index map from the detected header row. */
function indexByToken(headerRow = []) {
  const idx = {}
  headerRow.forEach((h, i) => { const n = norm(h); if (n && !(n in idx)) idx[n] = i })
  const find = (...tokens) => {
    for (const t of tokens) { if (t in idx) return idx[t] }
    // fallback: contains-match
    for (const [k, v] of Object.entries(idx)) { if (tokens.some((t) => k.includes(t))) return v }
    return -1
  }
  return { find }
}

const cellAt = (row, i) => (i >= 0 && row ? clean(row[i]) : '')

/** Full raw row as { header: value } for every non-empty cell - kept in a jsonb column
 * so no field is ever lost and any future report can read it. */
function rawObject(headerRow, row) {
  const out = {}
  ;(headerRow || []).forEach((h, i) => {
    const key = clean(h)
    const val = clean(row ? row[i] : '')
    if (key && val) out[key] = val
  })
  return out
}
const intVal = (v) => { const s = numStr(v); return s ? String(parseInt(s, 10)) : '' }

/** Map a monthly tyre-consumption sheet to tyre_records rows. Cost is NOT taken. */
function mapMonthlyTyres(dataRows, headerRow, country) {
  const h = indexByToken(headerRow)
  const c = {
    job: h.find('job card no.', 'job card no', 'job card'), veh: h.find('veh.no', 'veh no', 'veh no.'),
    vtype: h.find('veh type/category', 'veh type', 'category'), item: h.find('item/tyre', 'item tyre', 'item'),
    pos: h.find('tyre position', 'position'), serial: h.find('tyre no.', 'tyre no'),
    fixd: h.find('tyre fix date', 'fix date'), fixkm: h.find('fixed km'), fixhr: h.find('fixed hrs'),
    remd: h.find('tyre removed date', 'removed date'), remkm: h.find('removed km'), remhr: h.find('removed hrs'),
    reason: h.find('reason'), tkm: h.find('total km'), thr: h.find('total hrs'),
  }
  const out = []
  for (const r of dataRows) {
    const serial = cellAt(r, c.serial)
    const asset = cellAt(r, c.veh)
    if (!serial && !asset) continue
    const removal_date = parseDate(cellAt(r, c.remd))
    out.push({
      serial_no: serial, asset_no: asset, job_card: cellAt(r, c.job),
      vehicle_type: cellAt(r, c.vtype), size: cellAt(r, c.item),
      position: cellAt(r, c.pos), tyre_position: cellAt(r, c.pos),
      issue_date: parseDate(cellAt(r, c.fixd)) || null,
      km_at_fitment: numStr(cellAt(r, c.fixkm)) || null, hrs_at_fitment: numStr(cellAt(r, c.fixhr)) || null,
      removal_date: removal_date || null,
      km_at_removal: numStr(cellAt(r, c.remkm)) || null, hrs_at_removal: numStr(cellAt(r, c.remhr)) || null,
      total_km: numStr(cellAt(r, c.tkm)) || null, total_hrs: numStr(cellAt(r, c.thr)) || null,
      removal_reason: cellAt(r, c.reason) || null,
      status: removal_date ? 'Removed' : 'Active',
      extra_fields: rawObject(headerRow, r),
      country,
    })
  }
  return out
}

/** Map a vehicle-complaints history sheet to work_orders rows. Cost is NOT taken. */
function mapComplaints(dataRows, headerRow, country) {
  const h = indexByToken(headerRow)
  const c = {
    veh: h.find('veh no.', 'veh no'), driver: h.find('driver name'), loc: h.find('location'),
    wshop: h.find('workshop location'), jc: h.find('jc no.', 'jc no'), kmhr: h.find('km/hr', 'km hr'),
    comp: h.find('complaints'), qc: h.find('qc remarks'), done: h.find('job done description'),
    indt: h.find('vehicle in date'), outdt: h.find('vehicle out date'), reason: h.find('reason of repair'),
  }
  const out = []
  for (const r of dataRows) {
    const wo = cellAt(r, c.jc)
    const asset = cellAt(r, c.veh)
    if (!wo && !asset) continue
    const outDate = parseDate(cellAt(r, c.outdt))
    const notes = [cellAt(r, c.done), cellAt(r, c.qc)].filter(Boolean).join(' | ').slice(0, 1500)
    out.push({
      work_order_no: wo || null, asset_no: asset || null,
      work_type: 'Repair', status: outDate ? 'Completed' : 'In Progress',
      priority: 'Medium', vor: 'false',
      description: (cellAt(r, c.comp) || cellAt(r, c.reason) || '').slice(0, 1000),
      notes: notes || null, site: cellAt(r, c.loc) || null, workshop_name: cellAt(r, c.wshop) || null,
      technician_name: cellAt(r, c.driver) || null,
      odometer: numStr(cellAt(r, c.kmhr)) || null,
      opened_at: parseDate(cellAt(r, c.indt)) || null, completed_at: outDate || null,
      custom_data: { source: 'Vehicle Complaints History', ...rawObject(headerRow, r) },
      country,
    })
  }
  return out
}

/** Map an open-job-card follow-up sheet to open_work_orders rows (a replaceable snapshot). */
function mapOpenWo(dataRows, headerRow, country) {
  const h = indexByToken(headerRow)
  const c = {
    loc: h.find('location'), jtype: h.find('job card type'), jc: h.find('job card no'),
    status: h.find('j c status', 'jc status'), jdate: h.find('job card date'), jtime: h.find('jc open time'),
    atype: h.find('asset type'), asset: h.find('asset no'), days: h.find('no of days jc open'),
    comp: h.find('complaint'),
  }
  const out = []
  for (const r of dataRows) {
    const jc = cellAt(r, c.jc)
    if (!jc) continue
    out.push({
      job_card_no: jc, location: cellAt(r, c.loc) || null, job_card_type: cellAt(r, c.jtype) || null,
      jc_status: cellAt(r, c.status) || null, job_card_date: parseDate(cellAt(r, c.jdate)) || null,
      open_time: cellAt(r, c.jtime) || null, asset_type: cellAt(r, c.atype) || null,
      asset_no: cellAt(r, c.asset) || null, days_open: numStr(cellAt(r, c.days)) || null,
      complaint: (cellAt(r, c.comp) || '').slice(0, 1000), country,
    })
  }
  return out
}

/** Map an asset master (equipment grid) to vehicle_fleet rows. Only the fleet fields
 * the app uses are taken; ERP finance/insurance/driver-licence extras are ignored. */
function mapAssets(dataRows, headerRow, country) {
  const h = indexByToken(headerRow)
  const c = {
    asset: h.find('asset no.', 'asset no'), desc: h.find('asset desc.', 'asset desc'),
    plate: h.find('plate no.', 'plate no'), chassis: h.find('chassis no.', 'chassis no'),
    serial: h.find('serial no'), atype: h.find('asset type'), loc: h.find('asset location', 'location'),
    arloc: h.find('arabic location'), status: h.find('asset status', 'status'), shift: h.find('asset shift'),
    km: h.find('km'), brand: h.find('brand'), hour: h.find('hour'),
    dli: h.find('driver issue date'), dle: h.find('driver expiry date'),
    mvi: h.find('mvip issue date'), mve: h.find('mvip expiry date'),
    u1c: h.find('user 1 - code', 'user 1 code'), u1n: h.find('user 1 - name', 'user 1 name'),
    u2c: h.find('user 2 - code', 'user 2 code'), u2n: h.find('user 2 - name', 'user 2 name'),
    itype: h.find('insurance type 1', 'insurance type'), iname: h.find('insurance name'),
    istart: h.find('insurance start date'), iexp: h.find('insurance expire date', 'insurance expiry date'),
    ival: h.find('insurance value'), ocno: h.find('operating card no.', 'operating card no'),
    oci: h.find('operating card issue date'), oce: h.find('operating card expiry date'),
    myear: h.find('model year'), ulife: h.find('useful life'), ostart: h.find('operation start date'),
    pval: h.find('purchase value'), nbv: h.find('net book value'), dep: h.find('monthly depreciation value'),
    fano: h.find('fa asset number'), remarks: h.find('remarks'),
  }
  const out = []
  for (const r of dataRows) {
    const asset = cellAt(r, c.asset)
    if (!asset) continue
    out.push({
      asset_no: asset,
      model: cellAt(r, c.desc) || null, make: cellAt(r, c.brand) || null,
      registration_no: cellAt(r, c.plate) || null, chassis_no: cellAt(r, c.chassis) || null,
      serial_no: cellAt(r, c.serial) || null, vehicle_type: cellAt(r, c.atype) || null,
      site: cellAt(r, c.loc) || null, arabic_location: cellAt(r, c.arloc) || null,
      status: cellAt(r, c.status) || null, asset_shift: cellAt(r, c.shift) || null,
      current_km: numStr(cellAt(r, c.km)) || null, current_hours: numStr(cellAt(r, c.hour)) || null,
      driver_licence_issue: parseDate(cellAt(r, c.dli)) || null, driver_licence_expiry: parseDate(cellAt(r, c.dle)) || null,
      mvip_issue: parseDate(cellAt(r, c.mvi)) || null, mvip_expiry: parseDate(cellAt(r, c.mve)) || null,
      user1_code: cellAt(r, c.u1c) || null, user1_name: cellAt(r, c.u1n) || null,
      user2_code: cellAt(r, c.u2c) || null, user2_name: cellAt(r, c.u2n) || null,
      insurance_type: cellAt(r, c.itype) || null, insurance_name: cellAt(r, c.iname) || null,
      insurance_start: parseDate(cellAt(r, c.istart)) || null, insurance_expiry: parseDate(cellAt(r, c.iexp)) || null,
      insurance_value: numStr(cellAt(r, c.ival)) || null,
      operating_card_no: cellAt(r, c.ocno) || null, operating_card_issue: parseDate(cellAt(r, c.oci)) || null,
      operating_card_expiry: parseDate(cellAt(r, c.oce)) || null,
      model_year: intVal(cellAt(r, c.myear)) || null, useful_life: cellAt(r, c.ulife) || null,
      operation_start_date: parseDate(cellAt(r, c.ostart)) || null,
      purchase_value: numStr(cellAt(r, c.pval)) || null, net_book_value: numStr(cellAt(r, c.nbv)) || null,
      monthly_depreciation: numStr(cellAt(r, c.dep)) || null, fa_asset_number: cellAt(r, c.fano) || null,
      asset_remarks: cellAt(r, c.remarks) || null,
      asset_extra: rawObject(headerRow, r),
      country,
    })
  }
  return out
}

/**
 * Full intake: detect the report, drop the pre-header band + footer noise, and map
 * every data row to its destination table. Returns null when no type is recognised.
 * @param {Array<Array<any>>} aoa
 * @param {{ country?:string }} [opts]
 * @returns {{ type:string, target:string, rows:Array<Object>, dropped:number }|null}
 */
export function intakeSheet(aoa = [], { country = 'KSA' } = {}) {
  const det = detectReport(aoa)
  if (!det) return null
  const body = aoa.slice(det.headerIndex + 1)
  const kept = []
  let blankRows = 0
  let footerRows = 0
  for (const r of body) {
    if (!r || r.every((c) => c == null || String(c).trim() === '')) { blankRows += 1; continue }
    if (isFooterRow(r)) { footerRows += 1; continue }
    kept.push(r)
  }
  let rows = []
  if (det.type === REPORT_TYPES.MONTHLY_TYRES) rows = mapMonthlyTyres(kept, det.headerRow, country)
  else if (det.type === REPORT_TYPES.COMPLAINTS) rows = mapComplaints(kept, det.headerRow, country)
  else if (det.type === REPORT_TYPES.OPEN_WO) rows = mapOpenWo(kept, det.headerRow, country)
  else if (det.type === REPORT_TYPES.ASSETS) rows = mapAssets(kept, det.headerRow, country)
  // GRID rows are handled by the parts-expense engine (cost source) - the importer
  // routes type === 'grid' there; intakeSheet returns the detection so the caller knows.
  // FULL ROW ACCOUNTING so nothing is ever silently lost:
  //   read (content rows) = mapped (rows.length) + noKey (had content but no identifier)
  //   total file body     = read + footerRows + blankRows
  const read = kept.length
  const noKey = Math.max(0, read - rows.length)
  const dropped = footerRows + blankRows // back-compat (footer/blank only)
  return { type: det.type, target: det.target, rows, dropped, read, footerRows, blankRows, noKey }
}
