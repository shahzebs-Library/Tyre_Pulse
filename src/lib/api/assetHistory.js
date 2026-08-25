/**
 * Asset History service - the reads behind the unified per-asset timeline.
 *
 * THE THREE RULES THIS FILE EXISTS TO HOLD
 * ----------------------------------------
 * 1. IDENTITY IS (country, asset_no). Every read is country-scoped. V376
 *    measured 239 asset codes existing in more than one country, where the
 *    same code is usually a DIFFERENT machine, so an unscoped read merges two
 *    machines' histories into one and invents a third.
 *
 * 2. ONE FAILING SOURCE MUST NOT TAKE THE PAGE DOWN. Every source is fetched
 *    with Promise.allSettled, and each resolves to its own
 *    { ok, rows, error, missing } envelope. `Promise.all` would reject the
 *    whole load on any single rejection - the exact defect that once left the
 *    accident detail modal spinning forever. A source that fails reports
 *    UNREADABLE, which the engine renders as "could not be read", never as an
 *    empty result.
 *
 * 3. EVERY READ IS BOUNDED SERVER-SIDE. parts_consumption is 209,536 rows and
 *    work_orders 90,535; fetching either whole to filter in the browser is the
 *    class of defect `src/test/rowCapGuard.test.js` fails CI over. Each read is
 *    scoped by asset AND country, paged through fetchAllPages with an explicit
 *    { max } ceiling, and ordered with `id` as a UNIQUE tiebreak - ordering on
 *    a non-unique key drops or repeats rows at a page boundary.
 *
 * A missing table degrades to an honest empty via the SHARED `isMissingRelation`
 * (which checks the error CODE first - 42P01 / PGRST205 / 42883 / PGRST202 -
 * never message text alone, because unwrap() sanitises the message).
 */
import { supabase, fetchAllPages, isMissingRelation } from './_client'
import { fetchableSources, canonAssetNo } from '../assetHistory'

/* ------------------------------------------------------------------ *
 * Read ceilings                                                        *
 * ------------------------------------------------------------------ */

/**
 * Per-source ceilings. These are PER ASSET, so they are generous: the busiest
 * asset in the register carries a few hundred job cards, not thousands. They
 * exist so a data error (an asset code that accidentally matches many rows)
 * cannot pull a hundred thousand rows into the browser, and every one surfaces
 * `truncated` rather than silently clipping.
 */
export const READ_MAX = Object.freeze({
  job_card: 5000,
  parts_line: 20000,
  line_item: 20000,
  tyre_fitment: 3000,
  odometer: 5000,
  engine_hours: 5000,
  inspection: 2000,
  checklist: 2000,
  accident: 1000,
  breakdown: 1000,
  wash: 2000,
  pm_service: 2000,
  tyre_mark: 3000,
  utilization: 2000,
  penalty: 1000,
  disposal: 100,
})

/** Serials fetched per `.in()` chunk when resolving tyre status marks. */
const SERIAL_CHUNK = 150

/* ------------------------------------------------------------------ *
 * Envelope helpers                                                     *
 * ------------------------------------------------------------------ */

const ok = (rows, truncated = false) => ({ ok: true, rows: rows || [], truncated, error: null, missing: false })
const empty = (missing) => ({ ok: true, rows: [], truncated: false, error: null, missing: Boolean(missing) })
const failed = (error) => ({ ok: false, rows: [], truncated: false, error, missing: false })

/**
 * Run one paged read into an envelope. A missing relation is an honest empty;
 * any other failure is UNREADABLE, never an empty list.
 */
async function readPaged(pageFn, max) {
  try {
    const { data, error, truncated } = await fetchAllPages(pageFn, { max })
    if (error) return isMissingRelation(error) ? empty(true) : failed(error)
    return ok(data, truncated)
  } catch (err) {
    return isMissingRelation(err) ? empty(true) : failed(err)
  }
}

/**
 * Country scoping for a per-asset read.
 *
 * STRICT `.eq` when a real country is active - NOT the null-safe `.or` form.
 * That is deliberate and is the identity rule: a row whose country is NULL
 * cannot be proved to belong to THIS machine rather than the same-coded one in
 * another country, and pulling it in is precisely how two machines' histories
 * merge. Under the All-countries scope no filter is applied, and the page
 * states that the timeline may span more than one machine.
 */
function scopeCountry(query, country, column = 'country') {
  if (country && country !== 'All') return query.eq(column, country)
  return query
}

/** Optional server-side date window on a source's own date column. */
function scopeDates(query, column, from, to) {
  let q = query
  if (column && from) q = q.gte(column, from)
  if (column && to) q = q.lte(column, to)
  return q
}

/* ------------------------------------------------------------------ *
 * Column lists - least privilege, and every name verified to exist     *
 * ------------------------------------------------------------------ */

// PostgREST fails the WHOLE request on an unknown column, so each list below
// mirrors the column set an existing service already reads from that table.
const JOB_CARD_COLS =
  'id,work_order_no,rfr_no,mr_no,sco_no,asset_no,status,priority,work_type,description,' +
  'technician_name,workshop_name,site,country,opened_at,started_at,completed_at,' +
  'production_out_at,production_in_at,waiting_parts_hours,waiting_manpower_hours,' +
  'labour_cost,parts_cost,lubricant_cost,outside_repair_cost,tyre_cost,total_cost,' +
  'breakdown_hours,odometer,created_at'

const PARTS_COLS =
  'id,event_date,txn_date,issue_number,work_order_no,asset_code,item_code,item_description,' +
  'qty,unit_cost,line_cost,tyre_cost,spare_cost,oil_cost,site,store_code,currency,country'

const LINE_ITEM_COLS =
  'id,work_order_no,asset_no,task,detail,action,qty,opened_date,country,created_at'

const TYRE_COLS =
  'id,asset_no,serial_no,position,brand,size,cost_per_tyre,issue_date,removal_date,' +
  'km_at_fitment,km_at_removal,total_km,risk_level,removal_reason,status,job_card,site,country'

const ODOMETER_COLS = 'id,country,asset_no,odometer_km,reading_date,source,site,notes'
const HOURS_COLS = 'id,country,asset_no,engine_hours,reading_date,source,site,notes'

const INSPECTION_COLS =
  'id,title,inspection_type,site,asset_no,status,findings,severity,inspection_date,' +
  'completed_date,inspector,country,created_at'

const CHECKLIST_COLS =
  'id,template_name,template_version,country,site,asset_no,title,status,score_pct,' +
  'score_passed,submitted_at,approval_status,created_at'

const ACCIDENT_COLS =
  'id,asset_no,site,country,incident_date,severity,status,accident_type,location,' +
  'repair_cost,estimated_damage_cost,claim_amount,claim_status,created_at'

const BREAKDOWN_COLS =
  'id,country,asset_no,site,reported_on,details,breakdown_days,expected_return,' +
  'returned_to_service,returned_on,repair_location,remark,created_at'

const WASH_COLS =
  'id,country,site,area,asset_no,wash_date,wash_type,bay,washed_by,cost,status,notes,created_at'

const PM_COLS = 'id,country,asset_no,service_date,total_cost,notes,created_at'

const MARK_COLS = 'serial,mark_type,reason,created_at'

const UTILIZATION_COLS =
  'id,country,asset_no,captured_at,working_seconds,driving_seconds,idle_seconds,' +
  'idle_pct,distance_km,max_speed,utilization_pct,odo_end,source,created_at'

const PENALTY_COLS =
  'id,country,site,asset_no,work_order_no,period_date,repair_start,repair_end,' +
  'downtime_hours,penalty_amount,currency,status,created_at'

const DISPOSAL_COLS =
  'id,country,asset_no,register_status,asset_type,condition,disposition,site,remarks,' +
  'meter_km,meter_hours,estimated_value,sale_proceeds,currency,created_at'

/* ------------------------------------------------------------------ *
 * Per-source readers                                                   *
 * ------------------------------------------------------------------ */

function readJobCards(asset, country, from, to) {
  return readPaged((f, t) => scopeDates(
    scopeCountry(
      supabase.from('work_orders').select(JOB_CARD_COLS).eq('asset_no', asset),
      country,
    ), 'opened_at', from, to)
    .order('opened_at', { ascending: false }).order('id').range(f, t),
  READ_MAX.job_card)
}

function readPartsLines(asset, country, from, to) {
  return readPaged((f, t) => scopeDates(
    scopeCountry(
      supabase.from('parts_consumption').select(PARTS_COLS).eq('asset_code', asset),
      country,
    ), 'event_date', from, to)
    .order('event_date', { ascending: false }).order('id').range(f, t),
  READ_MAX.parts_line)
}

function readLineItems(asset, country) {
  return readPaged((f, t) => scopeCountry(
    supabase.from('work_order_line_items').select(LINE_ITEM_COLS).eq('asset_no', asset),
    country,
  ).order('id').range(f, t), READ_MAX.line_item)
}

function readTyres(asset, country) {
  // Deliberately NOT date-windowed: a tyre fitted before the window is still
  // the tyre on the wheel today, and its removal may fall inside the window.
  return readPaged((f, t) => scopeCountry(
    supabase.from('tyre_records').select(TYRE_COLS).eq('asset_no', asset),
    country,
  ).order('issue_date', { ascending: false }).order('id').range(f, t), READ_MAX.tyre_fitment)
}

function readOdometer(asset, country, from, to) {
  return readPaged((f, t) => scopeDates(
    scopeCountry(
      supabase.from('odometer_logs').select(ODOMETER_COLS).eq('asset_no', asset),
      country,
    ), 'reading_date', from, to)
    .order('reading_date', { ascending: true }).order('id').range(f, t), READ_MAX.odometer)
}

function readEngineHours(asset, country, from, to) {
  return readPaged((f, t) => scopeDates(
    scopeCountry(
      supabase.from('engine_hours_logs').select(HOURS_COLS).eq('asset_no', asset),
      country,
    ), 'reading_date', from, to)
    .order('reading_date', { ascending: true }).order('id').range(f, t), READ_MAX.engine_hours)
}

function readInspections(asset, country, from, to) {
  return readPaged((f, t) => scopeDates(
    scopeCountry(
      supabase.from('inspections').select(INSPECTION_COLS).eq('asset_no', asset),
      country,
    ), 'inspection_date', from, to)
    .order('inspection_date', { ascending: false }).order('id').range(f, t), READ_MAX.inspection)
}

function readChecklists(asset, country, from, to) {
  return readPaged((f, t) => scopeDates(
    scopeCountry(
      supabase.from('checklist_submissions').select(CHECKLIST_COLS).eq('asset_no', asset),
      country,
    ), 'submitted_at', from, to)
    .order('submitted_at', { ascending: false }).order('id').range(f, t), READ_MAX.checklist)
}

function readAccidents(asset, country, from, to) {
  return readPaged((f, t) => scopeDates(
    scopeCountry(
      supabase.from('accidents').select(ACCIDENT_COLS).eq('asset_no', asset),
      country,
    ), 'incident_date', from, to)
    .order('incident_date', { ascending: false }).order('id').range(f, t), READ_MAX.accident)
}

function readBreakdowns(asset, country) {
  // An open breakdown that started before the window is exactly what the page
  // exists to surface, so this is never date-windowed.
  return readPaged((f, t) => scopeCountry(
    supabase.from('asset_breakdowns').select(BREAKDOWN_COLS).eq('asset_no', asset),
    country,
  ).order('reported_on', { ascending: false }).order('id').range(f, t), READ_MAX.breakdown)
}

function readWashes(asset, country, from, to) {
  return readPaged((f, t) => scopeDates(
    scopeCountry(
      supabase.from('wash_records').select(WASH_COLS).eq('asset_no', asset),
      country,
    ), 'wash_date', from, to)
    .order('wash_date', { ascending: false }).order('id').range(f, t), READ_MAX.wash)
}

function readPmServices(asset, country, from, to) {
  return readPaged((f, t) => scopeDates(
    scopeCountry(
      supabase.from('pm_service_records').select(PM_COLS).eq('asset_no', asset),
      country,
    ), 'service_date', from, to)
    .order('service_date', { ascending: false }).order('id').range(f, t), READ_MAX.pm_service)
}

function readUtilization(asset, country) {
  return readPaged((f, t) => scopeCountry(
    supabase.from('asset_utilization').select(UTILIZATION_COLS).eq('asset_no', asset),
    country,
  ).order('captured_at', { ascending: false }).order('id').range(f, t), READ_MAX.utilization)
}

function readPenalties(asset, country) {
  return readPaged((f, t) => scopeCountry(
    supabase.from('sany_delay_penalties').select(PENALTY_COLS).eq('asset_no', asset),
    country,
  ).order('period_date', { ascending: false }).order('id').range(f, t), READ_MAX.penalty)
}

function readDisposal(asset, country) {
  return readPaged((f, t) => scopeCountry(
    supabase.from('asset_disposals').select(DISPOSAL_COLS).eq('asset_no', asset),
    country,
  ).order('id').range(f, t), READ_MAX.disposal)
}

/**
 * Tyre scrap / return marks, linked through the SERIALS this asset has carried.
 *
 * `tyre_status_marks` carries no asset column, so this is a dependent read that
 * can only run once the tyre records are back. Serials are chunked because the
 * `.in()` list is caller-supplied and an asset with hundreds of fitments would
 * otherwise build an unbounded filter expression.
 */
async function readTyreMarks(serials) {
  const list = [...new Set((serials || []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean))]
  if (!list.length) return empty(false)
  const rows = []
  for (let i = 0; i < list.length; i += SERIAL_CHUNK) {
    const chunk = list.slice(i, i + SERIAL_CHUNK)
    // `.in()` builds and escapes its own value list, so a serial containing a
    // comma or a quote cannot break out of the filter.
    const res = await readPaged(
      (f, t) => supabase.from('tyre_status_marks').select(MARK_COLS)
        .in('serial', chunk).order('serial').order('mark_type').range(f, t),
      READ_MAX.tyre_mark,
    )
    if (!res.ok) return res            // one failed chunk means we do not know
    if (res.missing) return empty(true)
    rows.push(...res.rows)
  }
  return ok(rows)
}

/* ------------------------------------------------------------------ *
 * The fleet register row + the cross-country collision check           *
 * ------------------------------------------------------------------ */

/**
 * Every vehicle_fleet row carrying this asset code, ACROSS ALL COUNTRIES.
 *
 * Reading every country on purpose: this is what detects the V376 collision.
 * The caller picks the row for the active country and shows the others as a
 * warning that the same code exists elsewhere and is probably a different
 * machine. A join that filtered to one country could never see the clash.
 *
 * The register holds 1,617 rows and one code appears in at most three, so this
 * is bounded by construction - but it is paged anyway, with `id` as a unique
 * tiebreak, because asset_no is unique per COUNTRY and not globally.
 */
export function listFleetRowsForAsset(assetNo) {
  const asset = canonAssetNo(assetNo)
  return readPaged(
    (f, t) => supabase.from('vehicle_fleet')
      .select('id,asset_no,country,site,region,vehicle_type,make,model,model_year,' +
        'registration_no,chassis_no,engine_no,status,ops_status,ops_status_note,' +
        'current_km,fleet_number,capacity,operation_start_date,created_at')
      .eq('asset_no', asset).order('country').order('id').range(f, t),
    100,
  )
}

/**
 * Asset options for the picker, PAGED.
 *
 * The register is 1,617 rows and PostgREST caps a response at 1,000 whatever
 * `.limit()` claims, so an unpaged picker silently hides roughly 600 assets and
 * the user concludes the machine is not in the system. That exact bug has been
 * fixed twice in this repo; it is paged here so it cannot come back a third
 * time.
 */
export function listAssetOptions({ country } = {}) {
  return readPaged(
    (f, t) => scopeCountry(
      supabase.from('vehicle_fleet')
        .select('asset_no,country,site,vehicle_type,make,model,status,registration_no'),
      country,
    ).order('asset_no').order('id').range(f, t),
    20000,
  )
}

/* ------------------------------------------------------------------ *
 * loadAssetHistory - the one entry point                               *
 * ------------------------------------------------------------------ */

/** Map a settled result back to an envelope, so a thrown reader still degrades. */
function settled(result) {
  if (result.status === 'fulfilled') return result.value
  const err = result.reason
  return isMissingRelation(err) ? empty(true) : failed(err)
}

/**
 * Load EVERY history source for one (country, asset_no) identity.
 *
 * Sources are fetched CONCURRENTLY and settled INDEPENDENTLY, so a table that
 * is missing, denied by RLS or simply broken degrades to its own honest state
 * and every other section still renders.
 *
 * @param {string} assetNo
 * @param {{country?:string, from?:string, to?:string, sources?:string[]}} [opts]
 *   sources: restrict the load to these catalog keys (the page uses it to skip
 *   sources the reader has filtered out). Omit for everything.
 * @returns {Promise<{asset:string, country:string|null, fleet:object|null,
 *   fleetRows:Array, crossCountry:boolean, sources:Record<string,object>,
 *   truncated:string[]}>}
 */
export async function loadAssetHistory(assetNo, { country, from, to, sources } = {}) {
  const asset = canonAssetNo(assetNo)
  if (!asset) {
    return {
      asset: '', country: country || null, fleet: null, fleetRows: [],
      crossCountry: false, sources: {}, truncated: [],
    }
  }

  const wanted = Array.isArray(sources) && sources.length ? new Set(sources) : null
  const want = (key) => !wanted || wanted.has(key)

  // The register read runs alongside everything else; it is never a gate.
  const fleetPromise = listFleetRowsForAsset(asset)

  const plan = [
    ['job_card', () => readJobCards(asset, country, from, to)],
    ['parts_line', () => readPartsLines(asset, country, from, to)],
    ['line_item', () => readLineItems(asset, country)],
    ['tyre_fitment', () => readTyres(asset, country)],
    ['odometer', () => readOdometer(asset, country, from, to)],
    ['engine_hours', () => readEngineHours(asset, country, from, to)],
    ['inspection', () => readInspections(asset, country, from, to)],
    ['checklist', () => readChecklists(asset, country, from, to)],
    ['accident', () => readAccidents(asset, country, from, to)],
    ['breakdown', () => readBreakdowns(asset, country)],
    ['wash', () => readWashes(asset, country, from, to)],
    ['pm_service', () => readPmServices(asset, country, from, to)],
    ['utilization', () => readUtilization(asset, country)],
    ['penalty', () => readPenalties(asset, country)],
    ['disposal', () => readDisposal(asset, country)],
  ].filter(([key]) => key === 'line_item' ? want('job_card') : want(key))

  const settledResults = await Promise.allSettled(plan.map(([, run]) => run()))
  const out = {}
  plan.forEach(([key], i) => { out[key] = settled(settledResults[i]) })

  // Dependent read: tyre marks are keyed on serial, so they can only be
  // resolved once the tyre records are back. It is settled on its own, so a
  // failure here never disturbs anything already fetched.
  if (want('tyre_mark')) {
    const tyreRes = out.tyre_fitment
    if (tyreRes && tyreRes.ok && tyreRes.rows.length) {
      const serials = tyreRes.rows.map((r) => r?.serial_no).filter(Boolean)
      const marks = await Promise.allSettled([readTyreMarks(serials)])
      out.tyre_mark = settled(marks[0])
    } else {
      // No serials to look up is not a failure and not evidence of anything.
      out.tyre_mark = tyreRes && tyreRes.ok === false ? failed(tyreRes.error) : empty(false)
    }
  }

  const fleetRes = settled(await Promise.allSettled([fleetPromise]).then((r) => r[0]))
  const fleetRows = fleetRes.ok ? fleetRes.rows : []
  const here = String(country || '').trim().toUpperCase()
  const fleet =
    fleetRows.find((r) => String(r?.country || '').trim().toUpperCase() === here) ||
    // Under the All scope, or when the register has no row for this country,
    // fall back to the single row only when there is exactly one - picking one
    // of several would be choosing a machine on the reader's behalf.
    (fleetRows.length === 1 ? fleetRows[0] : null)

  return {
    asset,
    country: country || null,
    fleet,
    fleetRows,
    fleetReadable: fleetRes.ok,
    crossCountry: fleetRows.length > 1,
    sources: out,
    truncated: Object.entries(out).filter(([, v]) => v && v.truncated).map(([k]) => k),
  }
}

/**
 * The catalog keys this service can actually fetch, so the page's filter chips
 * cannot offer a source nothing reads.
 */
export function loadableSourceKeys() {
  return fetchableSources().map((s) => s.key)
}
