/**
 * assetHistory.js - THE definition of "everything that ever happened to one
 * machine", on one timeline.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * An asset's record was scattered across sixteen tables and surfaced in four
 * places, each showing a different slice: Vehicle History showed tyre records,
 * Asset Detail showed job cards and PM, Tyre Bay showed fitments, the expense
 * grid showed money. Nobody could answer "what has happened to TM514" without
 * opening four screens and joining them by eye. This module merges every source
 * into ONE chronologically ordered stream with a stable shape.
 *
 * PURE - no I/O, no Supabase, and NO clock. Every function that needs "now"
 * takes it explicitly, so the same inputs always produce the same output. The
 * reader that fetches rows lives in `src/lib/api/assetHistory.js`.
 *
 * THE GOVERNING RULES (settled decisions, encoded here rather than restated)
 * -------------------------------------------------------------------------
 * 1. IDENTITY IS (country, asset_no), NEVER asset_no alone. V376 measured
 *    1,617 fleet rows carrying 1,377 distinct codes, and 239 codes exist in
 *    more than one country - where the same code is usually a DIFFERENT
 *    MACHINE (GN103 is a CATERPILLAR generator in KSA and a Sany one in UAE).
 *    Merging two countries' rows under one code invents a machine.
 * 2. THREE STATES, NEVER TWO. A value, "not recorded" (no row) and "could not
 *    read" (the query failed) are three different claims. Collapsing any pair
 *    is treated as a bug in this codebase, and an empty section that reads as
 *    "this never happened" is the most flattering of the three.
 * 3. NEVER BLEND CURRENCIES. SAR + AED + EGP summed is not a quantity of
 *    anything. Spend is returned per currency; a single scalar only exists
 *    when the scope carries exactly one currency. Delegated to governedCost.
 * 4. A MISSING DENOMINATOR YIELDS null, NOT ZERO. An unmeasurable cost per km
 *    is unknown; zero reads as "free" and has shipped as if it were good news.
 * 5. AN UNMEASURABLE DOWNTIME GAP RENDERS "Not measurable", NEVER 0. A zero
 *    flatters every average it lands in.
 * 6. NOTHING IS INVENTED. An undated event is placed at the END of the stream
 *    and flagged, never given a plausible date so it can be sorted.
 *
 * @module assetHistory
 */

import {
  currencyForCountry,
  money,
  isMoney,
  perUnitCost,
  workOrderMaintenanceAmount,
} from './governedCost'
import { jobCardDurations, jobCardStage } from './jobCard'

/* ------------------------------------------------------------------ *
 * Identity - (country, asset_no), never asset_no alone                 *
 * ------------------------------------------------------------------ */

/**
 * Canonical asset code: UPPER with ALL whitespace stripped.
 *
 * Mirrors the server-side `normalize_asset_no()` (V337 + V490), which strips
 * whitespace rather than trimming it, because the ERP exports fixed-width
 * columns and pads codes internally as well as at the edges. Comparing raw
 * user input against a stored code without this is how "TM 514" fails to find
 * TM514.
 */
export function canonAssetNo(v) {
  if (v === null || v === undefined) return ''
  return String(v).replace(/\s+/g, '').toUpperCase()
}

/** Canonical country token (trimmed, original casing preserved for display). */
export function canonCountry(v) {
  return String(v ?? '').trim()
}

/**
 * The identity key for one physical machine. Two assets are the same machine
 * only when BOTH the country and the canonical code match.
 */
export function assetKey(country, assetNo) {
  return `${canonCountry(country).toUpperCase()}::${canonAssetNo(assetNo)}`
}

/** True when a row belongs to the given (country, asset) identity. */
export function rowIsAsset(row, country, assetNo, assetColumn = 'asset_no') {
  if (!row) return false
  if (canonAssetNo(row[assetColumn]) !== canonAssetNo(assetNo)) return false
  const want = canonCountry(country)
  if (!want || want === 'All') return true
  const got = canonCountry(row.country)
  // A row with no country is not evidence of a DIFFERENT machine, so it stays
  // in scope. This mirrors applyCountry's null-safe convention.
  if (!got) return true
  return got.toUpperCase() === want.toUpperCase()
}

/**
 * The other countries that carry the same asset code. This is what turns the
 * V376 collision from a silent data merge into a stated warning: the page can
 * say plainly that the same code exists elsewhere and is probably a different
 * machine, instead of quietly showing one machine's history under another's.
 *
 * @param {Array<object>} fleetRows  vehicle_fleet rows (any countries)
 * @param {string} country           the country being viewed
 * @param {string} assetNo
 * @returns {Array<{country:string, vehicle_type:string|null, site:string|null,
 *                  make:string|null, model:string|null, status:string|null}>}
 */
export function crossCountryMatches(fleetRows, country, assetNo) {
  const code = canonAssetNo(assetNo)
  const here = canonCountry(country).toUpperCase()
  const out = []
  for (const r of Array.isArray(fleetRows) ? fleetRows : []) {
    if (canonAssetNo(r?.asset_no) !== code) continue
    const c = canonCountry(r?.country)
    if (!c || c.toUpperCase() === here) continue
    out.push({
      country: c,
      vehicle_type: r?.vehicle_type ?? null,
      site: r?.site ?? null,
      make: r?.make ?? null,
      model: r?.model ?? null,
      status: r?.status ?? null,
    })
  }
  // Stable: one row per other country, ordered by name.
  out.sort((a, b) => a.country.localeCompare(b.country))
  return out
}

/* ------------------------------------------------------------------ *
 * Read state - a value / not recorded / could not read                 *
 * ------------------------------------------------------------------ */

/**
 * The three states every source can be in. Rule 2. `NOT_PROVISIONED` is a
 * fourth only in the sense that it is a REASON for EMPTY: the table is not in
 * this database yet (a migration has not run), which is not the same as "the
 * table exists and this asset has nothing in it".
 */
export const READ_STATE = Object.freeze({
  OK: 'ok',                       // rows came back
  EMPTY: 'empty',                 // the read succeeded and returned nothing
  UNREADABLE: 'unreadable',       // the read FAILED - we do NOT know
  NOT_PROVISIONED: 'not_provisioned', // the table does not exist here
  NOT_LOADED: 'not_loaded',       // it was never asked for in this view
})

/**
 * NOT_LOADED exists because "the read failed" and "we did not look" are not the
 * same claim either, and conflating them makes the gaps panel shout about
 * fourteen sources the reader simply filtered out. A source that was never
 * requested is genuinely unknown, but it is unknown for a reason the reader
 * chose, so it is reported that way rather than as a fault.
 */

/** Human sentence for a read state, used wherever a section renders no rows. */
export function readStateLabel(state, sourceLabel = 'This record') {
  switch (state) {
    case READ_STATE.OK: return null
    case READ_STATE.EMPTY: return `${sourceLabel}: not recorded for this asset.`
    case READ_STATE.NOT_PROVISIONED: return `${sourceLabel}: not set up in this system yet.`
    case READ_STATE.UNREADABLE: return `${sourceLabel}: could not be read, so this is unknown.`
    case READ_STATE.NOT_LOADED: return `${sourceLabel}: not included in this view.`
    default: return `${sourceLabel}: unknown.`
  }
}

/**
 * Normalise one service result into a read state.
 * @param {{ok?:boolean, rows?:Array, error?:any, missing?:boolean}} res
 */
export function sourceState(res) {
  if (!res) return READ_STATE.NOT_LOADED
  if (res.missing) return READ_STATE.NOT_PROVISIONED
  if (res.ok === false) return READ_STATE.UNREADABLE
  const rows = Array.isArray(res.rows) ? res.rows : []
  return rows.length ? READ_STATE.OK : READ_STATE.EMPTY
}

/* ------------------------------------------------------------------ *
 * Small helpers                                                        *
 * ------------------------------------------------------------------ */

const HOUR_MS = 3600000
const DAY_MS = 86400000

/** Number or null - NEVER 0 for a missing value (rule 4). */
function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Epoch ms or null. Accepts ISO strings, dates and 'YYYY-MM-DD'. */
function ts(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  const n = d.getTime()
  return Number.isFinite(n) ? n : null
}

/** The ISO day prefix of a value, or null. String-safe (no timezone shift). */
export function isoDay(v) {
  if (!v) return null
  const s = String(v)
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  if (m) return m[1]
  const t = ts(v)
  if (t === null) return null
  const d = new Date(t)
  const pad = (x) => String(x).padStart(2, '0')
  // Local, not UTC: toISOString() rolls the day back at a positive offset.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function text(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

/** Whole days between two epochs, or null when either is missing. */
function daysBetween(a, b) {
  if (a === null || b === null) return null
  return Math.floor((b - a) / DAY_MS)
}

/* ------------------------------------------------------------------ *
 * THE SOURCE CATALOG                                                   *
 * ------------------------------------------------------------------ */

/**
 * Timeline groups, in the order a reader wants them.
 */
export const HISTORY_GROUPS = Object.freeze([
  { key: 'workshop', label: 'Workshop' },
  { key: 'tyres', label: 'Tyres' },
  { key: 'meters', label: 'Meters' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'cost', label: 'Cost' },
  { key: 'lifecycle', label: 'Lifecycle' },
])

/**
 * THE declarative catalog. Everything downstream derives from this - the
 * service reads it to know what to fetch, the timeline reads it to know how to
 * describe an event, the filter chips read it for their labels, and the gaps
 * panel reads it to say what is missing. Adding a source is ONE entry here,
 * not a new code path in four files.
 *
 * `liveRows` is the row count MEASURED on the live database on `MEASURED_AT`.
 * It is not documentation: it is what lets `historyGaps` distinguish "this
 * asset has nothing" from "nobody has recorded this anywhere yet", which are
 * completely different statements to put in front of an owner. Refresh it when
 * the numbers are re-measured; a stale count makes the gaps panel lie.
 *
 * `assetColumn` null means the link is indirect (checklist submissions carry
 * the asset inside the sheet, work order line items link through the card).
 */
export const MEASURED_AT = '2026-08-24'

export const HISTORY_SOURCES = Object.freeze([
  Object.freeze({
    key: 'job_card',
    label: 'Job cards',
    group: 'workshop',
    table: 'work_orders',
    assetColumn: 'asset_no',
    dateColumn: 'opened_at',
    icon: 'Wrench',
    tone: 'info',
    liveRows: 90535,
    note: 'The workshop record. Expands to its RFR and the store issues raised against it.',
  }),
  Object.freeze({
    key: 'parts_line',
    label: 'Parts and materials issued',
    group: 'cost',
    table: 'parts_consumption',
    assetColumn: 'asset_code',
    dateColumn: 'event_date',
    icon: 'Boxes',
    tone: 'warning',
    liveRows: 209536,
    note: 'The classified expense grid. This is the authoritative spend on the asset.',
  }),
  Object.freeze({
    key: 'tyre_fitment',
    label: 'Tyre fitted',
    group: 'tyres',
    table: 'tyre_records',
    assetColumn: 'asset_no',
    dateColumn: 'issue_date',
    icon: 'CircleDot',
    tone: 'info',
    liveRows: 11205,
    note: 'A tyre going on. Its removal is a separate event on the same record.',
  }),
  Object.freeze({
    key: 'tyre_removal',
    label: 'Tyre removed',
    group: 'tyres',
    table: 'tyre_records',
    assetColumn: 'asset_no',
    dateColumn: 'removal_date',
    icon: 'CircleDot',
    tone: 'quiet',
    liveRows: 11205,
    derivedFrom: 'tyre_fitment',
    note: 'Derived from the same tyre record as the fitment, not a second read.',
  }),
  Object.freeze({
    key: 'odometer',
    label: 'Odometer reading',
    group: 'meters',
    table: 'odometer_logs',
    assetColumn: 'asset_no',
    dateColumn: 'reading_date',
    icon: 'Gauge',
    tone: 'quiet',
    liveRows: 718,
    note: 'Distance meter. A reading BELOW the previous one is flagged as a reset, never smoothed away.',
  }),
  Object.freeze({
    key: 'engine_hours',
    label: 'Hour meter reading',
    group: 'meters',
    table: 'engine_hours_logs',
    assetColumn: 'asset_no',
    dateColumn: 'reading_date',
    icon: 'Timer',
    tone: 'quiet',
    liveRows: 4379,
    note: 'Engine hours. The unit plant is managed by, where km means little.',
  }),
  Object.freeze({
    key: 'inspection',
    label: 'Inspections',
    group: 'compliance',
    table: 'inspections',
    assetColumn: 'asset_no',
    dateColumn: 'inspection_date',
    icon: 'ClipboardCheck',
    tone: 'good',
    liveRows: 506,
  }),
  Object.freeze({
    key: 'checklist',
    label: 'Checklist sheets',
    group: 'compliance',
    table: 'checklist_submissions',
    assetColumn: 'asset_no',
    dateColumn: 'submitted_at',
    icon: 'ClipboardCheck',
    tone: 'good',
    liveRows: 5,
    note: 'Workshop and transit-mixer daily sheets.',
  }),
  Object.freeze({
    key: 'accident',
    label: 'Accidents',
    group: 'incidents',
    table: 'accidents',
    assetColumn: 'asset_no',
    dateColumn: 'incident_date',
    icon: 'ShieldAlert',
    tone: 'danger',
    liveRows: 38,
  }),
  Object.freeze({
    key: 'breakdown',
    label: 'Breakdowns',
    group: 'incidents',
    table: 'asset_breakdowns',
    assetColumn: 'asset_no',
    dateColumn: 'reported_on',
    icon: 'PauseCircle',
    tone: 'danger',
    liveRows: 30,
    note: 'A machine stopped. A breakdown closes only when a return to service is recorded.',
  }),
  Object.freeze({
    key: 'wash',
    label: 'Washes',
    group: 'compliance',
    table: 'wash_records',
    assetColumn: 'asset_no',
    dateColumn: 'wash_date',
    icon: 'Droplets',
    tone: 'quiet',
    liveRows: 1,
    note: 'Washing is done in house and normally carries no charge; a zero cost is a fact, not a gap.',
  }),
  Object.freeze({
    key: 'pm_service',
    label: 'Preventive maintenance',
    group: 'workshop',
    table: 'pm_service_records',
    assetColumn: 'asset_no',
    dateColumn: 'service_date',
    icon: 'Hammer',
    tone: 'good',
    liveRows: 0,
    note: 'No PM service has been recorded anywhere in the system yet.',
  }),
  Object.freeze({
    key: 'tyre_mark',
    label: 'Tyre scrap and return marks',
    group: 'tyres',
    table: 'tyre_status_marks',
    assetColumn: null,
    dateColumn: 'created_at',
    icon: 'Trash2',
    tone: 'warning',
    liveRows: 201,
    note: 'Linked through the serials this asset has carried, not by asset code.',
  }),
  Object.freeze({
    key: 'utilization',
    label: 'Telematics utilisation',
    group: 'meters',
    table: 'asset_utilization',
    assetColumn: 'asset_no',
    dateColumn: 'captured_at',
    icon: 'Activity',
    tone: 'quiet',
    liveRows: 556,
  }),
  Object.freeze({
    key: 'penalty',
    label: 'Repair delay penalties',
    group: 'cost',
    table: 'sany_delay_penalties',
    assetColumn: 'asset_no',
    dateColumn: 'period_date',
    icon: 'Coins',
    tone: 'warning',
    liveRows: null,
    note: 'Charged when a workshop repair ran past the contracted window.',
  }),
  Object.freeze({
    key: 'disposal',
    label: 'Disposal',
    group: 'lifecycle',
    table: 'asset_disposals',
    assetColumn: 'asset_no',
    dateColumn: null,
    icon: 'Package',
    tone: 'danger',
    liveRows: 40,
    note: 'The disposal register carries no decision date, so this is shown as a standing state rather than a dated event.',
  }),
])

const SOURCE_BY_KEY = Object.freeze(
  Object.fromEntries(HISTORY_SOURCES.map((s) => [s.key, s]))
)

/** One catalog entry by key, or null. */
export function historySource(key) {
  return SOURCE_BY_KEY[key] || null
}

/** The sources belonging to a group, in catalog order. */
export function sourcesInGroup(groupKey) {
  return HISTORY_SOURCES.filter((s) => s.group === groupKey)
}

/**
 * The catalog entries the service must actually FETCH. `tyre_removal` is
 * derived from the same tyre_records read as `tyre_fitment`, so fetching it
 * again would double the read for no new rows.
 */
export function fetchableSources() {
  return HISTORY_SOURCES.filter((s) => !s.derivedFrom)
}

/* ------------------------------------------------------------------ *
 * Severity                                                             *
 * ------------------------------------------------------------------ */

/** Timeline severity ladder, most serious first. */
export const EVENT_SEVERITY = Object.freeze(['critical', 'high', 'medium', 'low', 'info'])

const SEVERITY_RANK = Object.freeze(
  Object.fromEntries(EVENT_SEVERITY.map((s, i) => [s, i]))
)

export function severityRank(s) {
  const r = SEVERITY_RANK[String(s || '').toLowerCase()]
  return r === undefined ? EVENT_SEVERITY.length : r
}

/* ------------------------------------------------------------------ *
 * Event builders - one per source                                      *
 * ------------------------------------------------------------------ */

function evt(fields) {
  const at = fields.at ?? null
  return {
    id: fields.id,
    source: fields.source,
    group: SOURCE_BY_KEY[fields.source]?.group ?? 'lifecycle',
    at,
    atMs: ts(at),
    day: isoDay(at),
    undated: ts(at) === null,
    title: fields.title || '',
    detail: fields.detail ?? null,
    value: fields.value ?? null,
    currency: fields.currency ?? null,
    // Rule: only the classified expense grid counts toward lifetime SPEND.
    // Everything else may carry a value for display without being added twice.
    countsToSpend: fields.countsToSpend === true,
    severity: fields.severity || 'info',
    link: fields.link ?? null,
    ref: fields.ref ?? null,
    row: fields.row ?? null,
  }
}

/** Currency for a row: its own column first, then derived from its country. */
function rowCurrency(row, country) {
  return text(row?.currency) || currencyForCountry(row?.country) || currencyForCountry(country) || null
}

function jobCardEvents(rows, country) {
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const no = text(r?.work_order_no) || text(r?.id)
    const type = text(r?.work_type)
    const status = text(r?.status)
    const parts = [type, status].filter(Boolean).join(' - ')
    out.push(evt({
      id: `job_card:${r?.id ?? no}`,
      source: 'job_card',
      at: r?.opened_at || r?.created_at || null,
      title: `Job card ${no || '(no number)'}`,
      detail: [parts, text(r?.description)].filter(Boolean).join(' - ') || null,
      // work_orders cost is NOT added to spend: the grid already counts it
      // (exclusion grid_supersedes_legacy). Shown, never summed here.
      value: num(workOrderMaintenanceAmount(r)) || null,
      currency: currencyForCountry(r?.country) || currencyForCountry(country),
      severity: String(r?.priority || '').toLowerCase() === 'critical' ? 'critical'
        : String(r?.priority || '').toLowerCase() === 'high' ? 'high' : 'info',
      ref: no,
      link: no ? `/work-orders?search=${encodeURIComponent(no)}` : null,
      row: r,
    }))
  }
  return out
}

function partsLineEvents(rows, country) {
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const desc = text(r?.item_description) || text(r?.item_code) || 'Store issue'
    const qty = num(r?.qty)
    out.push(evt({
      id: `parts_line:${r?.id}`,
      source: 'parts_line',
      at: r?.event_date || r?.txn_date || null,
      title: desc,
      detail: [
        qty != null ? `Qty ${qty}` : null,
        text(r?.work_order_no) ? `Job card ${r.work_order_no}` : null,
        text(r?.store_code) ? `Store ${r.store_code}` : null,
      ].filter(Boolean).join(' - ') || null,
      value: num(r?.line_cost),
      currency: rowCurrency(r, country),
      countsToSpend: true,
      severity: 'info',
      ref: text(r?.work_order_no),
      row: r,
    }))
  }
  return out
}

function tyreEvents(rows, country) {
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const serial = text(r?.serial_no) || text(r?.serial_number)
    const pos = text(r?.position) || text(r?.tyre_position)
    const label = [text(r?.brand), text(r?.size)].filter(Boolean).join(' ') || 'Tyre'
    const where = pos ? ` at ${pos}` : ''
    out.push(evt({
      id: `tyre_fitment:${r?.id}`,
      source: 'tyre_fitment',
      at: r?.issue_date || null,
      title: `${label} fitted${where}`,
      detail: [serial ? `Serial ${serial}` : null, text(r?.job_card) ? `Job card ${r.job_card}` : null]
        .filter(Boolean).join(' - ') || null,
      // Display only. A tyre-cost TOTAL comes from the grid, never from
      // cost_per_tyre - see governedCost exclusion tyre_total_from_grid.
      value: num(r?.cost_per_tyre),
      currency: currencyForCountry(r?.country) || currencyForCountry(country),
      severity: String(r?.risk_level || '').toLowerCase() === 'critical' ? 'critical'
        : String(r?.risk_level || '').toLowerCase() === 'high' ? 'high' : 'info',
      ref: serial,
      link: serial ? `/tyre-passport/${encodeURIComponent(serial)}` : null,
      row: r,
    }))
    if (r?.removal_date) {
      const life = num(r?.total_km)
      const reason = text(r?.removal_reason)
      out.push(evt({
        id: `tyre_removal:${r?.id}`,
        source: 'tyre_removal',
        at: r.removal_date,
        title: `${label} removed${where}`,
        detail: [
          serial ? `Serial ${serial}` : null,
          life != null ? `${life.toLocaleString('en-US')} km run` : null,
          reason,
        ].filter(Boolean).join(' - ') || null,
        severity: 'info',
        ref: serial,
        link: serial ? `/tyre-passport/${encodeURIComponent(serial)}` : null,
        row: r,
      }))
    }
  }
  return out
}

function meterEvents(odoRows, hourRows) {
  const out = []
  for (const r of Array.isArray(odoRows) ? odoRows : []) {
    const km = num(r?.odometer_km)
    out.push(evt({
      id: `odometer:${r?.id}`,
      source: 'odometer',
      at: r?.reading_date || null,
      title: km != null ? `Odometer ${km.toLocaleString('en-US')} km` : 'Odometer reading (no value)',
      detail: [text(r?.source), text(r?.notes)].filter(Boolean).join(' - ') || null,
      value: km,
      severity: 'info',
      row: r,
    }))
  }
  for (const r of Array.isArray(hourRows) ? hourRows : []) {
    const h = num(r?.engine_hours)
    out.push(evt({
      id: `engine_hours:${r?.id}`,
      source: 'engine_hours',
      at: r?.reading_date || null,
      title: h != null ? `Hour meter ${h.toLocaleString('en-US')} h` : 'Hour meter reading (no value)',
      detail: [text(r?.source), text(r?.notes)].filter(Boolean).join(' - ') || null,
      value: h,
      severity: 'info',
      row: r,
    }))
  }
  return out
}

function inspectionEvents(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => evt({
    id: `inspection:${r?.id}`,
    source: 'inspection',
    at: r?.inspection_date || r?.completed_date || r?.created_at || null,
    title: text(r?.title) || text(r?.inspection_type) || 'Inspection',
    detail: [text(r?.status), text(r?.inspector), text(r?.findings)].filter(Boolean).join(' - ') || null,
    severity: String(r?.severity || '').toLowerCase() || 'info',
    link: '/inspections',
    row: r,
  }))
}

function checklistEvents(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const score = num(r?.score_pct)
    return evt({
      id: `checklist:${r?.id}`,
      source: 'checklist',
      at: r?.submitted_at || r?.created_at || null,
      title: text(r?.template_name) || text(r?.title) || 'Checklist sheet',
      detail: [
        text(r?.approval_status),
        score != null ? `Score ${score}%` : null,
      ].filter(Boolean).join(' - ') || null,
      severity: r?.score_passed === false ? 'high' : 'info',
      link: '/checklists',
      row: r,
    })
  })
}

function accidentEvents(rows, country) {
  return (Array.isArray(rows) ? rows : []).map((r) => evt({
    id: `accident:${r?.id}`,
    source: 'accident',
    at: r?.incident_date || r?.created_at || null,
    title: `Accident - ${text(r?.accident_type) || 'incident'}`,
    detail: [text(r?.severity), text(r?.status), text(r?.location)].filter(Boolean).join(' - ') || null,
    value: num(r?.repair_cost) ?? num(r?.estimated_damage_cost),
    currency: currencyForCountry(r?.country) || currencyForCountry(country),
    severity: String(r?.severity || '').toLowerCase() === 'severe' ? 'critical'
      : String(r?.severity || '').toLowerCase() === 'moderate' ? 'high' : 'medium',
    link: '/accidents',
    row: r,
  }))
}

function breakdownEvents(rows, now) {
  const out = []
  const nowMs = ts(now)
  for (const r of Array.isArray(rows) ? rows : []) {
    const start = ts(r?.reported_on)
    const end = ts(r?.returned_on)
    const returned = r?.returned_to_service === true
    // Days down is measured, or null. Never zero for an unknown.
    let days = null
    if (start !== null && end !== null) days = daysBetween(start, end)
    else if (start !== null && !returned && nowMs !== null) days = daysBetween(start, nowMs)
    out.push(evt({
      id: `breakdown:${r?.id}`,
      source: 'breakdown',
      at: r?.reported_on || null,
      title: returned ? 'Breakdown (returned to service)' : 'Breakdown (still down)',
      detail: [
        text(r?.details),
        days != null ? `${days} days down${returned ? '' : ' so far'}` : 'Days down not measurable',
        text(r?.repair_location),
      ].filter(Boolean).join(' - ') || null,
      severity: returned ? 'medium' : 'critical',
      link: '/asset-breakdowns',
      row: r,
    }))
    if (returned && r?.returned_on) {
      out.push(evt({
        id: `breakdown_return:${r?.id}`,
        source: 'breakdown',
        at: r.returned_on,
        title: 'Returned to service',
        detail: days != null ? `${days} days down` : null,
        severity: 'low',
        link: '/asset-breakdowns',
        row: r,
      }))
    }
  }
  return out
}

function washEvents(rows, country) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const cost = num(r?.cost)
    return evt({
      id: `wash:${r?.id}`,
      source: 'wash',
      at: r?.wash_date || null,
      title: `Wash${text(r?.wash_type) ? ` - ${r.wash_type}` : ''}`,
      detail: [
        text(r?.washed_by),
        text(r?.bay),
        // Zero is a DELIBERATE fact here (in-house washing carries no charge),
        // not a missing value, so it is stated rather than blanked.
        cost === 0 ? 'No charge' : cost != null ? null : 'Cost not recorded',
      ].filter(Boolean).join(' - ') || null,
      value: cost,
      currency: currencyForCountry(r?.country) || currencyForCountry(country),
      severity: 'info',
      link: '/vehicle-washing',
      row: r,
    })
  })
}

function pmEvents(rows, country) {
  return (Array.isArray(rows) ? rows : []).map((r) => evt({
    id: `pm_service:${r?.id}`,
    source: 'pm_service',
    at: r?.service_date || r?.created_at || null,
    title: text(r?.program_name) || 'Preventive maintenance service',
    detail: [text(r?.outcome), text(r?.notes)].filter(Boolean).join(' - ') || null,
    value: num(r?.total_cost),
    currency: currencyForCountry(r?.country) || currencyForCountry(country),
    severity: 'info',
    link: '/pm-programs',
    row: r,
  }))
}

function tyreMarkEvents(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => evt({
    id: `tyre_mark:${r?.serial}:${r?.mark_type}`,
    source: 'tyre_mark',
    at: r?.created_at || null,
    title: `Tyre ${text(r?.mark_type) || 'marked'} - ${text(r?.serial) || 'unknown serial'}`,
    detail: text(r?.reason),
    severity: String(r?.mark_type || '') === 'scrap' ? 'high' : 'info',
    ref: text(r?.serial),
    link: r?.serial ? `/tyre-passport/${encodeURIComponent(r.serial)}` : null,
    row: r,
  }))
}

function utilizationEvents(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const util = num(r?.utilization_pct)
    const dist = num(r?.distance_km)
    return evt({
      id: `utilization:${r?.id}`,
      source: 'utilization',
      at: r?.captured_at || r?.created_at || null,
      title: 'Telematics utilisation',
      detail: [
        util != null ? `${util}% utilised` : 'Utilisation not recorded',
        dist != null ? `${dist.toLocaleString('en-US')} km` : null,
      ].filter(Boolean).join(' - ') || null,
      value: util,
      severity: 'info',
      link: '/fleet-utilization',
      row: r,
    })
  })
}

function penaltyEvents(rows, country) {
  return (Array.isArray(rows) ? rows : []).map((r) => evt({
    id: `penalty:${r?.id}`,
    source: 'penalty',
    at: r?.period_date || r?.repair_start || null,
    title: 'Repair delay penalty',
    detail: [
      num(r?.downtime_hours) != null ? `${num(r.downtime_hours)} h downtime` : null,
      text(r?.status),
      text(r?.work_order_no) ? `Job card ${r.work_order_no}` : null,
    ].filter(Boolean).join(' - ') || null,
    value: num(r?.penalty_amount),
    currency: rowCurrency(r, country),
    severity: 'medium',
    link: '/sany-delay-penalty',
    row: r,
  }))
}

function disposalEvents(rows, country) {
  return (Array.isArray(rows) ? rows : []).map((r) => evt({
    id: `disposal:${r?.id}`,
    source: 'disposal',
    // The register carries no decision date. Rule 6: it is left undated and
    // flagged rather than being given created_at as if that were the decision.
    at: null,
    title: `Proposed for disposal - ${text(r?.disposition) || 'no disposition recorded'}`,
    detail: [text(r?.condition), text(r?.remarks)].filter(Boolean).join(' - ') || null,
    value: num(r?.estimated_value),
    currency: currencyForCountry(r?.country) || currencyForCountry(country),
    severity: 'high',
    link: '/asset-disposals',
    row: r,
  }))
}

/** Source key -> the builder that turns its rows into events. */
const BUILDERS = Object.freeze({
  job_card: (rows, ctx) => jobCardEvents(rows, ctx.country),
  parts_line: (rows, ctx) => partsLineEvents(rows, ctx.country),
  tyre_fitment: (rows, ctx) => tyreEvents(rows, ctx.country),
  odometer: (rows, ctx) => meterEvents(rows, []),
  engine_hours: (rows, ctx) => meterEvents([], rows),
  inspection: (rows) => inspectionEvents(rows),
  checklist: (rows) => checklistEvents(rows),
  accident: (rows, ctx) => accidentEvents(rows, ctx.country),
  breakdown: (rows, ctx) => breakdownEvents(rows, ctx.now),
  wash: (rows, ctx) => washEvents(rows, ctx.country),
  pm_service: (rows, ctx) => pmEvents(rows, ctx.country),
  tyre_mark: (rows) => tyreMarkEvents(rows),
  utilization: (rows) => utilizationEvents(rows),
  penalty: (rows, ctx) => penaltyEvents(rows, ctx.country),
  disposal: (rows, ctx) => disposalEvents(rows, ctx.country),
})

/* ------------------------------------------------------------------ *
 * buildTimeline                                                        *
 * ------------------------------------------------------------------ */

/**
 * Merge every source into ONE chronologically ordered stream.
 *
 * SORT IS STABLE AND TOTAL, deliberately. Ordering on the date alone leaves
 * same-day events in whatever order the network returned them, so the timeline
 * visibly reshuffles between two loads of the same asset. Order is:
 *   1. dated before undated (an undated event cannot be placed in time)
 *   2. date DESC (newest first)
 *   3. source key ASC
 *   4. event id ASC  - unique, so the comparison never falls through
 *
 * @param {Record<string, {ok?:boolean, rows?:Array, error?:any, missing?:boolean}>} sources
 *        keyed by HISTORY_SOURCES key, exactly as the service returns them
 * @param {{now?:number|string|Date, country?:string}} [opts]
 * @returns {{events:Array, states:Record<string,string>, counts:Record<string,number>,
 *            unreadable:string[], undatedCount:number}}
 */
export function buildTimeline(sources, { now, country } = {}) {
  const src = sources || {}
  const ctx = { now, country }
  const events = []
  const states = {}
  const counts = {}
  const unreadable = []

  for (const s of HISTORY_SOURCES) {
    // A derived source shares its parent's read result and read state.
    const readKey = s.derivedFrom || s.key
    const res = src[readKey]
    const state = sourceState(res)
    states[s.key] = state
    if (state === READ_STATE.UNREADABLE && !unreadable.includes(s.key)) unreadable.push(s.key)
  }

  for (const s of fetchableSources()) {
    const res = src[s.key]
    if (sourceState(res) !== READ_STATE.OK) continue
    const build = BUILDERS[s.key]
    if (!build) continue
    for (const e of build(res.rows, ctx)) events.push(e)
  }

  for (const e of events) counts[e.source] = (counts[e.source] || 0) + 1

  events.sort((a, b) => {
    if (a.undated !== b.undated) return a.undated ? 1 : -1
    if (!a.undated && a.atMs !== b.atMs) return b.atMs - a.atMs
    if (a.source !== b.source) return a.source < b.source ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return {
    events,
    states,
    counts,
    unreadable,
    undatedCount: events.filter((e) => e.undated).length,
  }
}

/* ------------------------------------------------------------------ *
 * Grouping                                                             *
 * ------------------------------------------------------------------ */

/** The period key of an event at a grain, or null when it is undated. */
export function periodKey(event, grain = 'month') {
  const day = event?.day
  if (!day) return null
  if (grain === 'day') return day
  if (grain === 'year') return day.slice(0, 4)
  return day.slice(0, 7)
}

/**
 * Group a sorted timeline into periods, preserving order. Undated events land
 * in their own trailing bucket, labelled as undated rather than being folded
 * into whichever period happens to be last.
 *
 * @returns {Array<{key:string|null, label:string, undated:boolean, events:Array}>}
 */
export function groupTimelineByPeriod(events, grain = 'month') {
  const list = Array.isArray(events) ? events : []
  const buckets = []
  const index = new Map()
  const undatedBucket = { key: null, label: 'Date not recorded', undated: true, events: [] }

  for (const e of list) {
    if (e.undated) { undatedBucket.events.push(e); continue }
    const key = periodKey(e, grain)
    if (!index.has(key)) {
      const b = { key, label: periodLabel(key, grain), undated: false, events: [] }
      index.set(key, b)
      buckets.push(b)
    }
    index.get(key).events.push(e)
  }
  if (undatedBucket.events.length) buckets.push(undatedBucket)
  return buckets
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Readable label for a period key. */
export function periodLabel(key, grain = 'month') {
  if (!key) return 'Date not recorded'
  if (grain === 'year') return key
  if (grain === 'month') {
    const [y, m] = key.split('-')
    const i = Number(m) - 1
    return MONTHS[i] ? `${MONTHS[i]} ${y}` : key
  }
  const [y, m, d] = key.split('-')
  const i = Number(m) - 1
  return MONTHS[i] ? `${Number(d)} ${MONTHS[i]} ${y}` : key
}

/* ------------------------------------------------------------------ *
 * Meter history - reset aware                                          *
 * ------------------------------------------------------------------ */

/**
 * A clean meter series that FLAGS a reset rather than clamping it away.
 *
 * A reading BELOW the previous one means the meter was replaced or rolled
 * back. It is NOT distance travelled, so it must never be added into a
 * lifetime figure - the same reset-aware rule the server applies in
 * cpk_asset_meter (V469/V470), which measured resets on 96% of KSA assets
 * (TM634 goes 75,399 -> 7,174). Silently taking max - min there would have
 * overstated distance on nearly every machine.
 *
 * `distance` sums only the POSITIVE deltas, so a reset breaks the series into
 * segments rather than poisoning it, and `resets` states how many times that
 * happened so a reader can judge the figure.
 *
 * @param {Array} odometerRows rows with { reading_date, odometer_km }
 * @param {Array} hoursRows    rows with { reading_date, engine_hours }
 */
export function meterHistory(odometerRows, hoursRows) {
  return {
    km: meterSeries(odometerRows, 'odometer_km', 'km'),
    hours: meterSeries(hoursRows, 'engine_hours', 'hours'),
  }
}

function meterSeries(rows, valueColumn, unit) {
  const points = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      at: r?.reading_date ?? null,
      atMs: ts(r?.reading_date),
      value: num(r?.[valueColumn]),
      source: text(r?.source),
      row: r,
    }))
    .filter((p) => p.value !== null)
    .sort((a, b) => {
      if (a.atMs === b.atMs) return 0
      if (a.atMs === null) return 1
      if (b.atMs === null) return -1
      return a.atMs - b.atMs
    })

  let distance = null
  let resets = 0
  const flagged = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const prev = i > 0 ? points[i - 1] : null
    let delta = null
    let reset = false
    if (prev) {
      delta = p.value - prev.value
      if (delta < 0) {
        reset = true
        resets += 1
        delta = null // a reset is not a negative distance
      } else {
        distance = (distance === null ? 0 : distance) + delta
      }
    }
    flagged.push({ ...p, delta, reset })
  }

  const first = points.length ? points[0] : null
  const last = points.length ? points[points.length - 1] : null
  return {
    unit,
    points: flagged,
    readings: points.length,
    resets,
    // null, not 0, when there is nothing to measure (rule 4).
    first: first ? first.value : null,
    last: last ? last.value : null,
    firstAt: first ? first.at : null,
    lastAt: last ? last.at : null,
    // Sum of positive deltas only. Needs at least two readings to exist.
    distance: points.length > 1 ? distance : null,
    // Stated so a reader knows the figure is segmented, not continuous.
    reliable: points.length > 1 && resets === 0,
  }
}

/* ------------------------------------------------------------------ *
 * Downtime - the availability flow, split by cause                     *
 * ------------------------------------------------------------------ */

/**
 * Downtime episodes, split into the THREE gaps the job card can prove.
 *
 * This is the flow already defined in jobCard.js and it is the whole point of
 * the split: Production Out -> Workshop In is a SCHEDULING gap (the asset is
 * down and nobody has started), Workshop In -> Out is WORKSHOP time, and
 * Workshop Out -> Production In is a RELEASE gap (repaired but not handed
 * back). One blended "downtime" number hides which of the three is actually
 * costing availability, which is the only thing a manager can act on.
 *
 * Every gap is null when it cannot be measured. Rule 5: an unmeasurable gap
 * renders "Not measurable", never 0, because a 0 flatters every average.
 *
 * @param {Array} workOrders work_orders rows
 * @param {Array} breakdowns asset_breakdowns rows
 * @param {{now?:number|string|Date}} [opts]
 */
export function downtimeEpisodes(workOrders, breakdowns, { now } = {}) {
  const cards = Array.isArray(workOrders) ? workOrders : []
  const episodes = []
  const totals = { scheduling: null, workshop: null, release: null, total: null }
  let measurable = 0
  let unmeasurable = 0

  const add = (key, hours) => {
    if (hours === null || hours === undefined) return
    totals[key] = (totals[key] === null ? 0 : totals[key]) + hours
  }

  for (const r of cards) {
    const d = jobCardDurations(r, now)
    const stage = jobCardStage(r)
    const g = (x) => (x && x.hours !== null ? x.hours : null)
    const scheduling = g(d.awaitingWorkshop)
    const workshop = g(d.inWorkshop)
    const release = g(d.awaitingRelease)
    const total = g(d.totalDown)
    const anyMeasured = [scheduling, workshop, release, total].some((v) => v !== null)
    if (anyMeasured) measurable += 1
    else unmeasurable += 1

    add('scheduling', scheduling)
    add('workshop', workshop)
    add('release', release)
    add('total', total)

    episodes.push({
      id: r?.id ?? null,
      ref: text(r?.work_order_no),
      at: r?.production_out_at || r?.opened_at || null,
      stage: stage.label,
      closed: stage.closed,
      scheduling,
      workshop,
      release,
      total,
      running: Boolean(
        (d.awaitingWorkshop && d.awaitingWorkshop.running) ||
        (d.inWorkshop && d.inWorkshop.running) ||
        (d.awaitingRelease && d.awaitingRelease.running)
      ),
      row: r,
    })
  }

  // Breakdown days are a SEPARATE record of a machine stopping, kept beside
  // the job-card flow rather than added into it: the same stoppage may carry
  // both a breakdown row and a job card, so summing them would double count.
  const breakdownRows = Array.isArray(breakdowns) ? breakdowns : []
  const nowMs = ts(now)
  let breakdownDays = null
  let openBreakdowns = 0
  for (const b of breakdownRows) {
    const start = ts(b?.reported_on)
    const end = ts(b?.returned_on)
    const returned = b?.returned_to_service === true
    if (!returned) openBreakdowns += 1
    let days = null
    if (start !== null && end !== null) days = daysBetween(start, end)
    else if (start !== null && !returned && nowMs !== null) days = daysBetween(start, nowMs)
    if (days !== null) breakdownDays = (breakdownDays === null ? 0 : breakdownDays) + days
  }

  episodes.sort((a, b) => {
    const x = ts(a.at)
    const y = ts(b.at)
    if (x === y) return String(a.id) < String(b.id) ? -1 : 1
    if (x === null) return 1
    if (y === null) return -1
    return y - x
  })

  return {
    episodes,
    totals,
    // How much of the record can actually be measured. Stated, so a small
    // total is read as thin evidence rather than a healthy machine.
    measurableCards: measurable,
    unmeasurableCards: unmeasurable,
    breakdownDays,
    openBreakdowns,
    breakdownCount: breakdownRows.length,
  }
}

/** Format an hours figure, or the honest refusal. Never renders 0 for unknown. */
export function formatHours(hours, { maximumFractionDigits = 1 } = {}) {
  if (hours === null || hours === undefined || !Number.isFinite(Number(hours))) return 'Not measurable'
  const h = Number(hours)
  if (h >= 48) return `${(h / 24).toFixed(1)} days`
  return `${h.toFixed(maximumFractionDigits)} h`
}

/* ------------------------------------------------------------------ *
 * The document chain: RFR -> job card -> store issue -> parts line     *
 * ------------------------------------------------------------------ */

/**
 * Walk the chain the ERP actually records, so a job card on the timeline can
 * be expanded into what was DONE and what it COST.
 *
 * The chain, proven on live data:
 *   RFR (work_orders.rfr_no, 57,192 cards)
 *     -> Job card (work_orders.work_order_no)
 *       -> MIS store issue (parts_consumption.issue_number, 83,580 slips,
 *          each mapping to exactly ONE job card)
 *         -> parts lines (parts_consumption / work_order_line_items)
 *
 * Nobody had surfaced this link, so "what was this job card for" could only be
 * answered from its free-text description.
 *
 * @param {Array} workOrders  work_orders rows for the asset
 * @param {Array} partsLines  parts_consumption rows for the asset
 * @param {Array} lineItems   work_order_line_items rows for the asset's cards
 * @returns {{byCard:Map, orphanLines:Array, orphanItems:Array}}
 */
export function documentChain(workOrders, partsLines, lineItems) {
  const cards = Array.isArray(workOrders) ? workOrders : []
  const lines = Array.isArray(partsLines) ? partsLines : []
  const items = Array.isArray(lineItems) ? lineItems : []

  const key = (v) => canonAssetNo(v) // same normalisation: upper, no whitespace
  const byCard = new Map()
  for (const c of cards) {
    const no = key(c?.work_order_no)
    if (!no) continue
    byCard.set(no, {
      card: c,
      workOrderNo: text(c?.work_order_no),
      rfrNo: text(c?.rfr_no),
      mrNo: text(c?.mr_no),
      scoNo: text(c?.sco_no),
      issues: new Map(),   // issue_number -> { issueNumber, lines: [] }
      lines: [],
      items: [],
      lineTotal: null,
      currency: null,
    })
  }

  const orphanLines = []
  for (const l of lines) {
    const no = key(l?.work_order_no)
    const entry = no ? byCard.get(no) : null
    if (!entry) { orphanLines.push(l); continue }
    entry.lines.push(l)
    const issueNumber = text(l?.issue_number) || null
    const bucketKey = issueNumber || '(no slip number)'
    if (!entry.issues.has(bucketKey)) {
      entry.issues.set(bucketKey, { issueNumber, lines: [] })
    }
    entry.issues.get(bucketKey).lines.push(l)
    const amount = num(l?.line_cost)
    if (amount !== null) entry.lineTotal = (entry.lineTotal === null ? 0 : entry.lineTotal) + amount
    const cur = text(l?.currency)
    if (cur) {
      // Never blend: a card whose slips span currencies reports MIXED rather
      // than one plausible-looking wrong number (rule 3).
      if (entry.currency === null) entry.currency = cur
      else if (entry.currency !== cur) entry.currency = 'MIXED'
    }
  }

  const orphanItems = []
  for (const it of items) {
    const no = key(it?.work_order_no)
    const entry = no ? byCard.get(no) : null
    if (!entry) { orphanItems.push(it); continue }
    entry.items.push(it)
  }

  // Materialise the issue map into a stable ordered array per card.
  for (const entry of byCard.values()) {
    entry.issueList = [...entry.issues.values()].sort((a, b) =>
      String(a.issueNumber || '').localeCompare(String(b.issueNumber || '')))
  }

  return { byCard, orphanLines, orphanItems }
}

/** The chain entry for one job card number, or null. */
export function chainForCard(chain, workOrderNo) {
  if (!chain || !chain.byCard) return null
  return chain.byCard.get(canonAssetNo(workOrderNo)) || null
}

/* ------------------------------------------------------------------ *
 * Lifetime summary                                                     *
 * ------------------------------------------------------------------ */

/**
 * Lifetime totals for one asset.
 *
 * SPEND IS PER CURRENCY AND NEVER BLENDED (rule 3). `spendByCurrency` is the
 * authoritative shape; `spend` is a single Money ONLY when exactly one
 * currency is present, and null otherwise, so a template physically cannot
 * render a blend. Only classified grid lines count toward spend - job card and
 * tyre_records amounts are shown per event but never added, because the grid
 * already counts that money (governedCost exclusions grid_supersedes_legacy
 * and tyre_total_from_grid).
 *
 * EVERY AVERAGE IS null WHEN UNMEASURABLE (rule 4).
 *
 * @param {ReturnType<typeof buildTimeline>} timeline
 * @param {object|null} fleetRow  the vehicle_fleet master row
 * @param {{now?:number|string|Date, meters?:object, downtime?:object, country?:string}} [opts]
 */
export function summarizeAssetHistory(timeline, fleetRow, opts = {}) {
  const { now, meters, downtime, country } = opts
  const events = Array.isArray(timeline?.events) ? timeline.events : []
  const counts = timeline?.counts || {}
  const states = timeline?.states || {}

  // --- Spend, per currency, from the classified grid alone. ---
  const spendByCurrency = {}
  for (const e of events) {
    if (!e.countsToSpend) continue
    const v = num(e.value)
    if (v === null) continue
    const cur = e.currency || currencyForCountry(country)
    if (!cur) continue
    spendByCurrency[cur] = (spendByCurrency[cur] || 0) + v
  }
  const currencies = Object.keys(spendByCurrency).sort()
  const mixedCurrency = currencies.length > 1
  const spend = currencies.length === 1
    ? money(spendByCurrency[currencies[0]], currencies[0])
    : null
  // A grid read that FAILED is not zero spend. Say so.
  const spendKnown = states.parts_line === READ_STATE.OK || states.parts_line === READ_STATE.EMPTY

  // --- Dated span. ---
  const dated = events.filter((e) => !e.undated)
  const firstMs = dated.length ? Math.min(...dated.map((e) => e.atMs)) : null
  const lastMs = dated.length ? Math.max(...dated.map((e) => e.atMs)) : null
  const nowMs = ts(now)

  // --- Tyres. ---
  const tyreEventsList = events.filter((e) => e.source === 'tyre_fitment')
  const removals = events.filter((e) => e.source === 'tyre_removal')
  const lives = removals
    .map((e) => num(e.row?.total_km))
    .filter((v) => v !== null && v > 0)
  const avgTyreLifeKm = lives.length
    ? Math.round(lives.reduce((s, v) => s + v, 0) / lives.length)
    : null

  // --- Days in service: measured from the register, never guessed. ---
  const inServiceFrom = fleetRow?.operation_start_date || fleetRow?.created_at || null
  const daysInService = daysBetween(ts(inServiceFrom), nowMs)

  // --- Running units, from the reset-aware meter series. ---
  const km = meters?.km?.distance ?? null
  const hours = meters?.hours?.distance ?? null

  // --- Per-unit cost. null denominator yields null, never 0 (rule 4). ---
  const costPerKm = spend && km !== null && km > 0 ? perUnitCost(spend, km, 'km') : null
  const costPerHour = spend && hours !== null && hours > 0 ? perUnitCost(spend, hours, 'hour') : null

  return {
    // Identity
    assetNo: text(fleetRow?.asset_no) || null,
    country: text(fleetRow?.country) || canonCountry(country) || null,

    // Volume
    totalEvents: events.length,
    undatedEvents: timeline?.undatedCount ?? 0,
    counts,

    // Money - per currency, never blended
    spendByCurrency,
    spend,
    mixedCurrency,
    spendKnown,
    currencies,

    // Span
    firstEventAt: firstMs === null ? null : new Date(firstMs).toISOString(),
    lastEventAt: lastMs === null ? null : new Date(lastMs).toISOString(),
    spanDays: daysBetween(firstMs, lastMs),
    daysInService,
    inServiceFrom,

    // Workshop
    jobCards: counts.job_card || 0,
    schedulingHours: downtime?.totals?.scheduling ?? null,
    workshopHours: downtime?.totals?.workshop ?? null,
    releaseHours: downtime?.totals?.release ?? null,
    downtimeHours: downtime?.totals?.total ?? null,
    breakdownDays: downtime?.breakdownDays ?? null,
    openBreakdowns: downtime?.openBreakdowns ?? 0,

    // Tyres
    tyresFitted: tyreEventsList.length,
    tyresRemoved: removals.length,
    avgTyreLifeKm,

    // Compliance / incidents
    inspections: counts.inspection || 0,
    checklists: counts.checklist || 0,
    accidents: counts.accident || 0,
    washes: counts.wash || 0,

    // Meters
    km,
    hours,
    meterResets: (meters?.km?.resets ?? 0) + (meters?.hours?.resets ?? 0),

    // Per unit
    costPerKm,
    costPerHour,
  }
}

/* ------------------------------------------------------------------ *
 * Lifecycle stages                                                     *
 * ------------------------------------------------------------------ */

/**
 * The asset's life as stages, built ONLY from rows that exist. A stage with no
 * evidence is returned with `known: false` rather than being omitted, so the
 * reader can see that the system does not know when the machine entered
 * service - which is itself the finding.
 */
export function assetLifecycleStages(fleetRow, timeline, { now } = {}) {
  const events = Array.isArray(timeline?.events) ? timeline.events : []
  const dated = events.filter((e) => !e.undated)
  const oldest = dated.length ? dated[dated.length - 1] : null
  const newest = dated.length ? dated[0] : null
  const nowMs = ts(now)

  const acquired = fleetRow?.operation_start_date || null
  const disposalEvent = events.find((e) => e.source === 'disposal') || null
  const openBreakdown = events.find(
    (e) => e.source === 'breakdown' && e.row?.returned_to_service !== true
  ) || null

  const stages = [
    {
      key: 'acquired',
      label: 'Entered service',
      at: acquired,
      known: Boolean(acquired),
      detail: acquired
        ? null
        : 'The register carries no operation start date, so the in-service date is unknown.',
    },
    {
      key: 'first_record',
      label: 'First recorded activity',
      at: oldest ? oldest.at : null,
      known: Boolean(oldest),
      detail: oldest ? oldest.title : 'Nothing has been recorded against this asset.',
    },
    {
      key: 'latest_record',
      label: 'Latest recorded activity',
      at: newest ? newest.at : null,
      known: Boolean(newest),
      detail: newest ? newest.title : null,
    },
    {
      key: 'breakdown',
      label: 'Currently down',
      at: openBreakdown ? openBreakdown.at : null,
      known: Boolean(openBreakdown),
      detail: openBreakdown
        ? 'An open breakdown has no return to service recorded.'
        : 'No open breakdown recorded.',
      tone: openBreakdown ? 'danger' : 'good',
    },
    {
      key: 'disposal',
      label: 'Proposed for disposal',
      at: null,
      known: Boolean(disposalEvent),
      detail: disposalEvent
        ? `${disposalEvent.detail || 'On the disposal register'} (the register carries no decision date)`
        : 'Not on the disposal register.',
      tone: disposalEvent ? 'danger' : 'quiet',
    },
  ]

  // How long since anything at all was recorded. Silence is a finding.
  const silentDays = daysBetween(newest ? newest.atMs : null, nowMs)

  return {
    stages,
    status: text(fleetRow?.status) || null,
    opsStatus: text(fleetRow?.ops_status) || null,
    silentDays,
  }
}

/* ------------------------------------------------------------------ *
 * Gaps - the honest read-out                                           *
 * ------------------------------------------------------------------ */

/**
 * What we do NOT have on this asset, and what each absence actually means.
 *
 * This is what stops the page flattering the data. THREE different absences
 * are separated, because they support opposite conclusions:
 *   'not_recorded'    - the table has rows, this asset has none. A real gap
 *                       in this machine's record.
 *   'not_in_use'      - the table is empty across the whole system, so its
 *                       silence says NOTHING about this asset.
 *   'unreadable'      - the read failed. We do not know either way, and must
 *                       not present that as an empty result.
 *   'not_provisioned' - the table does not exist in this database yet.
 *
 * @param {ReturnType<typeof buildTimeline>} timeline
 * @param {object|null} fleetRow
 */
export function historyGaps(timeline, fleetRow) {
  const states = timeline?.states || {}
  const counts = timeline?.counts || {}
  const gaps = []

  for (const s of HISTORY_SOURCES) {
    const state = states[s.key]
    const n = counts[s.key] || 0
    if (state === READ_STATE.OK && n > 0) continue

    let kind = 'not_recorded'
    let message = `No ${s.label.toLowerCase()} recorded for this asset.`

    if (state === READ_STATE.UNREADABLE) {
      kind = 'unreadable'
      message = `${s.label} could not be read, so this is unknown rather than empty.`
    } else if (state === READ_STATE.NOT_LOADED) {
      kind = 'not_loaded'
      message = `${s.label} was not included in this view, so nothing is claimed about it.`
    } else if (state === READ_STATE.NOT_PROVISIONED) {
      kind = 'not_provisioned'
      message = `${s.label} is not set up in this system yet.`
    } else if (s.liveRows === 0) {
      kind = 'not_in_use'
      message = `${s.label} holds no rows anywhere in the system, so its silence says nothing about this asset.`
    }

    gaps.push({
      key: s.key,
      label: s.label,
      group: s.group,
      table: s.table,
      kind,
      message,
      liveRows: s.liveRows,
      measuredAt: MEASURED_AT,
    })
  }

  // Register-level gaps: fields the whole page leans on.
  const registerGaps = []
  if (!fleetRow) {
    registerGaps.push('This asset has no row in the fleet register, so make, model, type and site are unknown.')
  } else {
    if (!text(fleetRow.vehicle_type)) registerGaps.push('No vehicle type on the register, so the tyre layout cannot be resolved.')
    if (!text(fleetRow.operation_start_date)) registerGaps.push('No operation start date, so days in service cannot be measured.')
    if (!text(fleetRow.registration_no)) registerGaps.push('No plate number on the register.')
  }

  return {
    gaps,
    registerGaps,
    unreadableCount: gaps.filter((g) => g.kind === 'unreadable').length,
    notRecordedCount: gaps.filter((g) => g.kind === 'not_recorded').length,
    notInUseCount: gaps.filter((g) => g.kind === 'not_in_use').length,
    notLoadedCount: gaps.filter((g) => g.kind === 'not_loaded').length,
    // A source that returned rows is COVERED. Stated as a fraction so the
    // reader sees how much of the record is actually populated.
    covered: HISTORY_SOURCES.filter((s) => (counts[s.key] || 0) > 0).length,
    total: HISTORY_SOURCES.length,
  }
}

/* ------------------------------------------------------------------ *
 * Export                                                               *
 * ------------------------------------------------------------------ */

/** The export column set, shared by the Excel and PDF paths. */
export const HISTORY_EXPORT_COLUMNS = Object.freeze([
  { key: 'date', header: 'Date' },
  { key: 'source', header: 'Record type' },
  { key: 'group', header: 'Area' },
  { key: 'title', header: 'What happened' },
  { key: 'detail', header: 'Detail' },
  { key: 'reference', header: 'Reference' },
  { key: 'value', header: 'Value' },
  { key: 'currency', header: 'Currency' },
  { key: 'severity', header: 'Severity' },
])

/**
 * Timeline events as flat export rows. A blank renders 'N/A' - never a dash
 * (the repo bans dash punctuation in report output) and never 0, which would
 * read as a measured zero.
 */
export function historyExportRows(events) {
  const na = (v) => (v === null || v === undefined || v === '' ? 'N/A' : v)
  return (Array.isArray(events) ? events : []).map((e) => ({
    date: e.undated ? 'Not recorded' : na(e.day),
    source: SOURCE_BY_KEY[e.source]?.label || e.source,
    group: HISTORY_GROUPS.find((g) => g.key === e.group)?.label || e.group,
    title: na(e.title),
    detail: na(e.detail),
    reference: na(e.ref),
    value: e.value === null || e.value === undefined ? 'N/A' : e.value,
    currency: na(e.currency),
    severity: na(e.severity),
  }))
}

/**
 * Filter a timeline for the on-screen controls. Pure, so the page never has to
 * restate what a filter means.
 *
 * @param {Array} events
 * @param {{sources?:string[], groups?:string[], search?:string,
 *          from?:string, to?:string, severity?:string}} [f]
 */
export function filterTimeline(events, f = {}) {
  const list = Array.isArray(events) ? events : []
  const sources = Array.isArray(f.sources) && f.sources.length ? new Set(f.sources) : null
  const groups = Array.isArray(f.groups) && f.groups.length ? new Set(f.groups) : null
  const q = String(f.search || '').trim().toLowerCase()
  const from = f.from ? String(f.from).slice(0, 10) : null
  const to = f.to ? String(f.to).slice(0, 10) : null

  return list.filter((e) => {
    if (sources && !sources.has(e.source)) return false
    if (groups && !groups.has(e.group)) return false
    if (f.severity && e.severity !== f.severity) return false
    if (from || to) {
      // An undated event cannot satisfy a date window, and must not be quietly
      // swept into one either.
      if (!e.day) return false
      if (from && e.day < from) return false
      if (to && e.day > to) return false
    }
    if (q) {
      const hay = `${e.title} ${e.detail || ''} ${e.ref || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Money display for a summary, never blending currencies. */
export function formatSpend(summary) {
  if (!summary) return 'N/A'
  if (!summary.spendKnown) return 'Could not be read'
  const cur = summary.currencies || []
  if (!cur.length) return 'Not recorded'
  return cur
    .map((c) => `${c} ${Math.round(summary.spendByCurrency[c]).toLocaleString('en-US')}`)
    .join(' | ')
}

/** Per-unit display. Renders the honest refusal rather than 0. */
export function formatPerUnitValue(pu, { maximumFractionDigits = 2 } = {}) {
  if (!pu || pu.value == null) return 'Not measurable'
  if (!isMoney({ amount: pu.value, currency: pu.currency })) return 'Not measurable'
  const n = new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(pu.value)
  return `${pu.currency} ${n} / ${pu.unit}`
}
