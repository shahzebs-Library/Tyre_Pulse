/**
 * assetDisposalDeck - the PURE engine behind the Asset Disposal deck builder.
 *
 * WHAT THIS IS FOR
 * The disposal committee has to sign off writing 37 machines off the books. The
 * owner asked for a downloadable PowerPoint that is BUILT, not a fixed export:
 * pick the slides, pick the cuts, save the layout, hand the deck round the table.
 *
 * This file owns the decisions (block catalog, presets, layout normalisation and
 * the data resolution for every block). It touches no DOM, no library and no
 * network, so every slide the committee sees is unit testable.
 *
 * THE HONESTY RULES, ENFORCED HERE RATHER THAN REMEMBERED
 *  1. NOBODY HAS VALUED THESE ASSETS. `estimated_value` and `sale_proceeds` are
 *     null on every row today. A "SAR X recovered by scrapping" line would be
 *     invention, so a valuation slot with no valuation prints "Not valued" and
 *     the slide carries the count of assets still unvalued. There is no fallback
 *     estimate, no per-tonne rate, no proxy from spend.
 *  2. The 3 assets that are NOT in the fleet register are shown and LABELLED.
 *     They are never silently dropped from a count.
 *  3. ASCII only. The pptx and the pdf leave the building: no em/en dashes, no
 *     arrows, no curly quotes. "to" for ranges, "N/A" for missing.
 *  4. An empty register says so on the slide. It never renders an empty chart.
 *  5. Every number is a straight aggregation of the rows handed in. No smoothing,
 *     no extrapolation, no projection.
 *
 * Aggregation logic lives in the shared engine (src/lib/assetDisposal.js). Every
 * call into it goes through a guarded reader below so a rename there degrades to
 * a local equivalent instead of blanking a committee slide.
 */
import * as engine from './assetDisposal'

// ── ASCII hygiene ────────────────────────────────────────────────────────────
// Deck output is print/hand-out material. Anything outside plain ASCII is folded
// to its readable equivalent BEFORE it can reach a renderer.
const ASCII_MAP = [
  [/[‐-―−]/g, '-'],   // hyphen/en/em dash, minus
  [/[‘’‛]/g, "'"],    // curly single quotes
  [/[“”‟]/g, '"'],    // curly double quotes
  [/[→←↔⇒]/g, ' to '], // arrows
  [/…/g, '...'],
  [/[   ]/g, ' '],    // non-breaking spaces
  [/[•·]/g, '-'],          // bullets used mid-text
]
/** Fold any string to safe ASCII for slide output. Non-strings become ''. */
export function ascii(v) {
  if (v == null) return ''
  let s = String(v)
  for (const [re, to] of ASCII_MAP) s = s.replace(re, to)
  // Anything still outside printable ASCII is dropped rather than shipped as a
  // box glyph in PowerPoint.
  return s.replace(/[^\x20-\x7E\n]/g, '').replace(/[ \t]+\n/g, '\n')
}

const isNum = (v) => Number.isFinite(Number(v)) && v !== null && v !== '' && v !== true && v !== false
const num = (v) => (isNum(v) ? Number(v) : null)

/** Thousands-separated integer, or "N/A" when there is genuinely no number. */
export function fmtNum(v) {
  const n = num(v)
  if (n == null) return 'N/A'
  return Math.round(n).toLocaleString('en-US')
}

/** Money for a figure the rows actually carry. Null is N/A, never zero. */
export function fmtMoney(v, currency = 'SAR') {
  const n = num(v)
  if (n == null) return 'N/A'
  return `${ascii(currency || 'SAR')} ${Math.round(n).toLocaleString('en-US')}`
}

/**
 * Money for a VALUATION slot (estimated value, sale proceeds). Nobody has valued
 * this fleet, so the honest answer is not "0" and not "N/A" (which reads as a
 * missing field) but "Not valued" - the fact that the valuation has not been done.
 */
export const NOT_VALUED = 'Not valued'
export function fmtValuation(v, currency = 'SAR') {
  const n = num(v)
  if (n == null) return NOT_VALUED
  return `${ascii(currency || 'SAR')} ${Math.round(n).toLocaleString('en-US')}`
}

/** Text cell: blank stays "N/A" so a slide never shows an empty box. */
export function fmtText(v) {
  const s = ascii(v).trim()
  return s === '' ? 'N/A' : s
}

// ── Guarded engine readers ───────────────────────────────────────────────────
// The engine is another agent's file. Read every export through here: a missing
// or renamed one falls back to a local equivalent so the deck still builds.
const eng = (name) => (engine && typeof engine[name] === 'function' ? engine[name] : null)
const engConst = (name) => (engine && engine[name] != null ? engine[name] : null)

export const DISPOSITIONS = engConst('DISPOSITIONS') || ['scrap', 'sell', 'undecided']
export const CONDITIONS = engConst('CONDITIONS')
  || ['Missing Parts', 'Dismantled', 'Major Accident', 'Running', 'complete']

/**
 * Normalise whatever shape a grouping helper returns into ordered
 * [{ label, value }] pairs. Accepts an array of objects with any of the common
 * key/label/name + count/value/total naming, a Map, or a plain object.
 */
export function toPairs(input) {
  if (!input) return []
  if (input instanceof Map) return [...input.entries()].map(([label, value]) => ({ label: fmtText(label), value: num(value) ?? 0 }))
  if (Array.isArray(input)) {
    return input.map((r) => {
      if (r == null) return null
      if (Array.isArray(r)) return { label: fmtText(r[0]), value: num(r[1]) ?? 0 }
      const label = r.label ?? r.key ?? r.name ?? r.group ?? r.band ?? r.id
      const value = r.value ?? r.count ?? r.total ?? r.n ?? r.assets
      if (label == null) return null
      return { label: fmtText(label), value: num(value) ?? 0 }
    }).filter(Boolean)
  }
  if (typeof input === 'object') {
    return Object.entries(input).map(([label, value]) => ({ label: fmtText(label), value: num(value) ?? 0 }))
  }
  return []
}

// ── Local aggregation fallbacks (used only when the engine export is absent) ──
function localByGroup(rows, key) {
  const m = new Map()
  for (const r of rows || []) {
    const k = fmtText(r?.[key])
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([label, value]) => ({ label, value }))
}

/**
 * Age bands from model_year against the current year. A row with no model_year
 * lands in "Year not recorded" - it is NOT guessed into a band.
 */
export function localAgeBands(rows, now = new Date()) {
  const yr = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getFullYear() : new Date().getFullYear()
  const order = ['0 to 5 years', '6 to 10 years', '11 to 15 years', 'Over 15 years', 'Year not recorded']
  const m = new Map(order.map((k) => [k, 0]))
  for (const r of rows || []) {
    const y = num(r?.model_year)
    let band = 'Year not recorded'
    if (y != null && y > 1900 && y <= yr + 1) {
      const age = yr - y
      band = age <= 5 ? '0 to 5 years' : age <= 10 ? '6 to 10 years' : age <= 15 ? '11 to 15 years' : 'Over 15 years'
    }
    m.set(band, (m.get(band) || 0) + 1)
  }
  return order.map((label) => ({ label, value: m.get(label) || 0 })).filter((p) => p.value > 0)
}

/** Group rows for a chart source, preferring the shared engine's byGroup. */
function groupPairs(rows, key) {
  const fn = eng('byGroup')
  if (fn) {
    try {
      const pairs = toPairs(fn(rows, key))
      if (pairs.length) return pairs
    } catch { /* fall through to the local equivalent */ }
  }
  return localByGroup(rows, key)
}

function agePairs(rows) {
  const fn = eng('ageBands')
  if (fn) {
    try {
      const pairs = toPairs(fn(rows))
      if (pairs.length) return pairs
    } catch { /* fall through */ }
  }
  return localAgeBands(rows)
}

// ── Row helpers ──────────────────────────────────────────────────────────────
export const isScrap = (r) => String(r?.disposition || '').toLowerCase() === 'scrap'
export const isSell = (r) => String(r?.disposition || '').toLowerCase() === 'sell'
export const notInRegister = (r) => r?.in_register === false
export const stillActive = (r) => String(r?.fleet_status || '').toLowerCase() === 'active'
export const isValued = (r) => num(r?.estimated_value) != null || num(r?.sale_proceeds) != null

/** Remarks are the committee's own words. Split to bullets, keep them verbatim. */
export function remarkLines(row) {
  const raw = ascii(row?.remarks || '')
  return raw
    .split(/\r?\n|(?:^|\s)[-*]\s+/)
    .map((s) => s.replace(/^[\s\-*.]+/, '').trim())
    .filter((s) => s !== '')
}

/** Fitted tyres for one asset, only entries that carry a real serial. */
export function assetTyres(row) {
  const list = Array.isArray(row?.serials) ? row.serials : []
  return list.filter((t) => t && ascii(t.serial).trim() !== '')
}

// ── Filters shared by table / asset_detail / tyre blocks ─────────────────────
export const ROW_FILTERS = [
  { key: 'all', label: 'All assets' },
  { key: 'scrap', label: 'To scrap' },
  { key: 'sell', label: 'To sell' },
  { key: 'undecided', label: 'Undecided' },
  { key: 'not_in_register', label: 'Not in the fleet register' },
  { key: 'still_active', label: 'Still Active in the register' },
  { key: 'approved', label: 'Approved' },
  { key: 'proposed', label: 'Proposed' },
  { key: 'with_tyres', label: 'Has tyres still fitted' },
]
const FILTER_FN = {
  all: () => true,
  scrap: isScrap,
  sell: isSell,
  undecided: (r) => String(r?.disposition || '').toLowerCase() === 'undecided',
  not_in_register: notInRegister,
  still_active: stillActive,
  approved: (r) => String(r?.status || '').toLowerCase() === 'approved',
  proposed: (r) => String(r?.status || '').toLowerCase() === 'proposed',
  with_tyres: (r) => assetTyres(r).length > 0,
}
export function filterRows(rows, filter = 'all') {
  const fn = FILTER_FN[filter] || FILTER_FN.all
  return (Array.isArray(rows) ? rows : []).filter(fn)
}
export function filterLabel(filter) {
  return (ROW_FILTERS.find((f) => f.key === filter) || ROW_FILTERS[0]).label
}

export const SORTS = [
  { key: 'asset_no', label: 'Asset number' },
  { key: 'spend', label: 'Lifetime spend (high to low)' },
  { key: 'job_cards', label: 'Job cards (high to low)' },
  { key: 'model_year', label: 'Model year (oldest first)' },
  { key: 'asset_type', label: 'Asset type' },
]
function sortRows(rows, sort) {
  const list = [...rows]
  const cmpTxt = (a, b) => String(a ?? '').localeCompare(String(b ?? ''))
  switch (sort) {
    case 'spend': return list.sort((a, b) => (num(b?.spend) ?? -1) - (num(a?.spend) ?? -1))
    case 'job_cards': return list.sort((a, b) => (num(b?.job_cards) ?? -1) - (num(a?.job_cards) ?? -1))
    case 'model_year': return list.sort((a, b) => (num(a?.model_year) ?? 9999) - (num(b?.model_year) ?? 9999))
    case 'asset_type': return list.sort((a, b) => cmpTxt(a?.asset_type, b?.asset_type) || cmpTxt(a?.asset_no, b?.asset_no))
    case 'asset_no':
    default: return list.sort((a, b) => cmpTxt(a?.asset_no, b?.asset_no))
  }
}

// ── KPI catalog ──────────────────────────────────────────────────────────────
// Every KPI reads `totals` first (the page computed it) and falls back to a
// straight count over the rows it was handed. `note` states the basis whenever
// the figure needs one to be read correctly.
//
// `tv` reads a total under EITHER naming. The contract hands this component
// snake_case keys, while the shared engine's own disposalSummary uses camelCase;
// a KPI that silently read the wrong key would fall back to recounting the rows
// and quietly disagree with the page it sits under.
const CAMEL = {
  to_scrap: 'toScrap', to_sell: 'toSell', in_register: 'inRegister',
  still_active: 'stillActive', not_in_register: 'notInRegister',
  job_cards: 'jobCards', lifetime_spend: 'lifetimeSpend', active_tyres: 'activeTyres',
  estimated_value: 'estimatedValue', sale_proceeds: 'saleProceeds',
}
// Money keys the shared engine deliberately returns as NULL when the rows carry
// more than one currency. Falling back to a local sum there would add riyals to
// dirhams - the exact blend this codebase has already had to fix in four places.
const MONEY_KEYS = new Set(['lifetime_spend', 'estimated_value', 'sale_proceeds'])

function tv(totals, key) {
  if (!totals || typeof totals !== 'object') return undefined
  const c = CAMEL[key]
  const present = key in totals ? key : (c && c in totals ? c : null)
  if (present == null) return undefined
  const v = totals[present]
  // A key that is PRESENT but null is a refusal, not a gap: honour it and let
  // the formatter print N/A instead of recomputing a figure the engine declined.
  if (v == null) return MONEY_KEYS.has(key) || totals.mixedCurrency === true ? null : undefined
  return v
}

/** Total when the page supplied one (including a deliberate null), else the
 *  local fallback. `??` alone cannot express this: it treats a refusal as a gap. */
function pick(totals, key, fallback) {
  const v = tv(totals, key)
  return v === undefined ? fallback() : v
}

export const KPI_ITEMS = {
  assets: { label: 'Assets proposed', get: (t, rows) => fmtNum(pick(t, 'assets', () => rows.length)) },
  to_scrap: { label: 'To scrap', get: (t, rows) => fmtNum(pick(t, 'to_scrap', () => rows.filter(isScrap).length)) },
  to_sell: { label: 'To sell', get: (t, rows) => fmtNum(pick(t, 'to_sell', () => rows.filter(isSell).length)) },
  still_active: {
    label: 'Still Active in register',
    get: (t, rows) => fmtNum(pick(t, 'still_active', () => rows.filter(stillActive).length)),
    note: 'These read as working vehicles until the write off is approved.',
  },
  not_in_register: {
    label: 'Not in fleet register',
    get: (t, rows) => fmtNum(pick(t, 'not_in_register', () => rows.filter(notInRegister).length)),
    note: 'No register record exists for these. Listed and labelled, not dropped.',
  },
  in_register: { label: 'In fleet register', get: (t, rows) => fmtNum(pick(t, 'in_register', () => rows.filter((r) => r?.in_register !== false).length)) },
  job_cards: { label: 'Job cards on record', get: (t, rows) => fmtNum(pick(t, 'job_cards', () => sum(rows, 'job_cards'))) },
  lifetime_spend: {
    label: 'Lifetime spend',
    money: true,
    get: (t, rows, cur) => fmtMoney(pick(t, 'lifetime_spend', () => sum(rows, 'spend')), cur),
    note: 'Maintenance and parts booked against these assets to date.',
  },
  active_tyres: {
    label: 'Tyres still fitted',
    get: (t, rows) => fmtNum(pick(t, 'active_tyres', () => rows.reduce((s, r) => s + assetTyres(r).length, 0))),
    note: 'Serial numbered tyres to recover before the machines leave site.',
  },
  approved: { label: 'Approved', get: (t, rows) => fmtNum(pick(t, 'approved', () => rows.filter((r) => String(r?.status).toLowerCase() === 'approved').length)) },
  disposed: { label: 'Disposed', get: (t, rows) => fmtNum(pick(t, 'disposed', () => rows.filter((r) => String(r?.status).toLowerCase() === 'disposed').length)) },
  estimated_value: {
    label: 'Estimated value',
    valuation: true,
    get: (t, rows, cur) => fmtValuation(pick(t, 'estimated_value', () => sumOrNull(rows, 'estimated_value')), cur),
    note: 'No valuation has been carried out on this list.',
  },
  sale_proceeds: {
    label: 'Sale proceeds',
    valuation: true,
    get: (t, rows, cur) => fmtValuation(pick(t, 'sale_proceeds', () => sumOrNull(rows, 'sale_proceeds')), cur),
    note: 'Recorded once a machine is actually sold. Nothing sold yet.',
  },
}
export const KPI_KEYS = Object.keys(KPI_ITEMS)

function sum(rows, key) {
  let total = 0
  for (const r of rows || []) total += num(r?.[key]) ?? 0
  return total
}
/** Sum that stays NULL when not one row carries the figure (valuation columns). */
function sumOrNull(rows, key) {
  let total = null
  for (const r of rows || []) {
    const v = num(r?.[key])
    if (v != null) total = (total ?? 0) + v
  }
  return total
}

// ── Chart catalog ────────────────────────────────────────────────────────────
export const CHART_SOURCES = {
  by_type: { label: 'By asset type', pairs: (rows) => groupPairs(rows, 'asset_type'), field: 'asset_type' },
  by_region: { label: 'By region', pairs: (rows) => groupPairs(rows, 'region'), field: 'region' },
  by_condition: { label: 'By condition', pairs: (rows) => groupPairs(rows, 'condition'), field: 'condition' },
  by_disposition: { label: 'Scrap vs sell', pairs: (rows) => groupPairs(rows, 'disposition'), field: 'disposition' },
  by_status: { label: 'By approval status', pairs: (rows) => groupPairs(rows, 'status'), field: 'status' },
  by_site: { label: 'By site', pairs: (rows) => groupPairs(rows, 'site'), field: 'site' },
  by_age_band: { label: 'By age band', pairs: (rows) => agePairs(rows), field: null },
  by_register: {
    label: 'Fleet register coverage',
    field: null,
    pairs: (rows) => {
      const inReg = rows.filter((r) => r?.in_register !== false).length
      const out = rows.length - inReg
      return [
        { label: 'In fleet register', value: inReg },
        { label: 'Not in fleet register', value: out },
      ].filter((p) => p.value > 0)
    },
  },
}
export const CHART_SOURCE_KEYS = Object.keys(CHART_SOURCES)

export const CHART_METRICS = {
  count: { label: 'Asset count', unit: 'assets' },
  spend: { label: 'Lifetime spend', unit: 'spend', money: true },
  job_cards: { label: 'Job cards', unit: 'job cards' },
  tyres: { label: 'Tyres still fitted', unit: 'tyres' },
}
export const CHART_METRIC_KEYS = Object.keys(CHART_METRICS)

export const CHART_VIZ = {
  bar: { label: 'Column' },
  bar_h: { label: 'Bar' },
  doughnut: { label: 'Doughnut' },
  line: { label: 'Line' },
}
export const CHART_VIZ_KEYS = Object.keys(CHART_VIZ)

/**
 * Aggregate a chart source under a metric. `count` uses the source's own pairs
 * (so the engine's grouping is honoured); every other metric sums the underlying
 * field per group, which needs a groupable field - sources without one (age band,
 * register coverage) stay on counts and SAY SO via the returned basis.
 */
export function chartData(rows, { source = 'by_type', metric = 'count' } = {}) {
  const src = CHART_SOURCES[source] || CHART_SOURCES.by_type
  const met = CHART_METRICS[metric] ? metric : 'count'
  if (met === 'count' || !src.field) {
    const pairs = src.pairs(rows).filter((p) => p.value > 0)
    return {
      labels: pairs.map((p) => p.label),
      values: pairs.map((p) => p.value),
      metric: 'count',
      basis: met === 'count' || !src.field
        ? `Asset count by ${src.label.replace(/^By /i, '').toLowerCase()}.`
        : '',
      forcedCount: met !== 'count' && !src.field,
    }
  }
  const m = new Map()
  for (const r of rows || []) {
    const k = fmtText(r?.[src.field])
    let v = 0
    if (met === 'spend') v = num(r?.spend) ?? 0
    else if (met === 'job_cards') v = num(r?.job_cards) ?? 0
    else if (met === 'tyres') v = assetTyres(r).length
    m.set(k, (m.get(k) || 0) + v)
  }
  const pairs = [...m.entries()].map(([label, value]) => ({ label, value })).filter((p) => p.value > 0)
  pairs.sort((a, b) => b.value - a.value)
  return {
    labels: pairs.map((p) => p.label),
    values: pairs.map((p) => p.value),
    metric: met,
    basis: `${CHART_METRICS[met].label} summed from the rows in this list.`,
    forcedCount: false,
  }
}

/** One line of plain numbers under a chart so figures survive greyscale print. */
export function chartDigest(data, currency = 'SAR') {
  if (!data || !data.labels?.length) return ''
  const total = data.values.reduce((a, b) => a + b, 0)
  let top = 0
  for (let i = 1; i < data.values.length; i++) if (data.values[i] > data.values[top]) top = i
  const fv = (v) => (data.metric === 'spend' ? fmtMoney(v, currency) : fmtNum(v))
  return `Total: ${fv(total)} | Largest: ${data.labels[top]} (${fv(data.values[top])})`
}

// ── Table catalog ────────────────────────────────────────────────────────────
export const TABLE_COLUMNS = {
  asset_no: { header: 'Asset', get: (r) => fmtText(r.asset_no), width: 1 },
  sr_no: { header: 'Sr', get: (r) => fmtText(r.sr_no), width: 0.6 },
  asset_type: { header: 'Type', get: (r) => fmtText(r.asset_type), width: 1.2 },
  brand: { header: 'Brand', get: (r) => fmtText(r.brand), width: 1 },
  model_year: { header: 'Year', get: (r) => fmtText(r.model_year), width: 0.7 },
  region: { header: 'Region', get: (r) => fmtText(r.region), width: 1 },
  site: { header: 'Site', get: (r) => fmtText(r.site), width: 1.2 },
  condition: { header: 'Condition', get: (r) => fmtText(r.condition), width: 1.3 },
  disposition: { header: 'Disposition', get: (r) => fmtText(r.disposition), width: 1 },
  status: { header: 'Status', get: (r) => fmtText(r.status), width: 1 },
  register_status: { header: 'Register', get: (r) => fmtText(r.register_status), width: 1 },
  in_register: { header: 'In register', get: (r) => (r.in_register === false ? 'NOT IN REGISTER' : 'Yes'), width: 1.1 },
  fleet_status: { header: 'Fleet status', get: (r) => fmtText(r.fleet_status), width: 1 },
  meter_text: { header: 'Meter', get: (r) => fmtText(r.meter_text), width: 1.2 },
  job_cards: { header: 'Job cards', get: (r) => fmtNum(r.job_cards), width: 0.9, align: 'right' },
  spend: { header: 'Lifetime spend', get: (r, c) => fmtMoney(r.spend, c), width: 1.3, align: 'right' },
  tyres_active: { header: 'Tyres fitted', get: (r) => fmtNum(assetTyres(r).length), width: 0.9, align: 'right' },
  chassis_no: { header: 'Chassis', get: (r) => fmtText(r.chassis_no), width: 1.4 },
  registration_no: { header: 'Plate', get: (r) => fmtText(r.registration_no), width: 1.1 },
  estimated_value: { header: 'Estimated value', get: (r, c) => fmtValuation(r.estimated_value, c), width: 1.3, align: 'right' },
  sale_proceeds: { header: 'Sale proceeds', get: (r, c) => fmtValuation(r.sale_proceeds, c), width: 1.3, align: 'right' },
  remarks: { header: 'Committee remarks', get: (r) => remarkLines(r).join('; ') || 'N/A', width: 2.6 },
}
export const TABLE_COLUMN_KEYS = Object.keys(TABLE_COLUMNS)
const DEFAULT_TABLE_COLUMNS = ['asset_no', 'asset_type', 'model_year', 'site', 'condition', 'disposition', 'job_cards', 'spend', 'tyres_active']

export const TYRE_COLUMNS = {
  asset_no: { header: 'Asset', get: (t) => fmtText(t.asset_no) },
  serial: { header: 'Tyre serial', get: (t) => fmtText(t.serial) },
  position: { header: 'Position', get: (t) => fmtText(t.position) },
  brand: { header: 'Brand', get: (t) => fmtText(t.brand) },
  size: { header: 'Size', get: (t) => fmtText(t.size) },
  fitted: { header: 'Fitted', get: (t) => fmtText(t.fitted) },
  km: { header: 'Km run', get: (t) => fmtNum(t.km) },
  site: { header: 'Site', get: (t) => fmtText(t.site) },
}
export const TYRE_COLUMN_KEYS = Object.keys(TYRE_COLUMNS)
const DEFAULT_TYRE_COLUMNS = ['asset_no', 'serial', 'position', 'brand', 'size', 'km', 'site']

/** Flatten every fitted tyre across the given assets into recovery rows. */
export function tyreRows(rows) {
  const out = []
  for (const r of rows || []) {
    for (const t of assetTyres(r)) {
      out.push({
        asset_no: r.asset_no, site: r.site,
        serial: t.serial, position: t.position, brand: t.brand, size: t.size,
        fitted: t.fitted, km: t.km,
      })
    }
  }
  return out
}

// ── Block catalog ────────────────────────────────────────────────────────────
export const DECK_BLOCKS = {
  title: {
    label: 'Title slide',
    description: 'Cover with the company, the deck title and the date it was produced.',
    defaults: { title: 'Asset Disposal Proposal', subtitle: '', showDate: true },
  },
  summary_kpis: {
    label: 'Headline numbers',
    description: 'The counts the committee decides on. Valuation tiles print "Not valued" until someone values the list.',
    defaults: { title: 'Headline numbers', items: ['assets', 'to_scrap', 'to_sell', 'still_active', 'not_in_register', 'lifetime_spend'] },
  },
  findings: {
    label: 'Key findings',
    description: 'Plain sentences drawn from the list itself. Nothing is inferred.',
    defaults: { title: 'What the list shows' },
  },
  chart: {
    label: 'Chart',
    description: 'One cut of the list per slide: type, region, condition, disposition, age band, site or spend.',
    defaults: { title: '', source: 'by_type', metric: 'count', viz: 'bar', filter: 'all' },
  },
  table: {
    label: 'Register table',
    description: 'The disposal list itself, column selectable and filterable, paginated across slides.',
    defaults: { title: 'Disposal register', columns: [...DEFAULT_TABLE_COLUMNS], filter: 'all', sort: 'asset_no', density: 'normal', rowsPerSlide: 12, limit: 0 },
  },
  asset_detail: {
    label: 'Per asset dossier',
    description: 'One slide per machine: condition, meter, spend, job cards, the committee remarks verbatim, and the tyres still on it.',
    defaults: { title: '', filter: 'all', sort: 'asset_no', limit: 0, showTyres: true, showRemarks: true },
  },
  tyre_recovery: {
    label: 'Tyre recovery list',
    description: 'Every serial numbered tyre still fitted to a machine on this list, so it is recovered before the machine leaves.',
    defaults: { title: 'Tyres to recover', columns: [...DEFAULT_TYRE_COLUMNS], filter: 'all', rowsPerSlide: 14 },
  },
  text: {
    label: 'Text slide',
    description: 'A free note: scope, method, what the committee is being asked to approve.',
    defaults: { title: 'Note', body: '' },
  },
  divider: {
    label: 'Section divider',
    description: 'A labelled break between sections of the deck.',
    defaults: { label: 'Section' },
  },
}
export const DECK_BLOCK_KEYS = Object.keys(DECK_BLOCKS)

let _uid = 0
/** Stable-enough id for list keys and reordering. */
export function blockId(type) {
  _uid += 1
  return `${type}_${Date.now().toString(36)}_${_uid.toString(36)}`
}

/** A fresh block of the given type with its catalog defaults applied. */
export function makeBlock(type, patch = {}) {
  const def = DECK_BLOCKS[type] || DECK_BLOCKS.text
  const t = DECK_BLOCKS[type] ? type : 'text'
  return { id: blockId(t), type: t, ...JSON.parse(JSON.stringify(def.defaults)), ...patch }
}

// ── Config normalisation ─────────────────────────────────────────────────────
const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, n))
}
const pickFrom = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt)
const strOr = (v, dflt) => (typeof v === 'string' ? ascii(v) : dflt)

/**
 * Clamp and default EVERY field so an old or hand-edited saved layout still
 * opens. An unknown block type is dropped rather than crashing the builder; an
 * empty block list falls back to the committee preset so the user always has
 * something on screen.
 */
export function normalizeDeckConfig(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : {}
  const rawBlocks = Array.isArray(src.blocks) ? src.blocks : []
  const blocks = rawBlocks
    .filter((b) => b && DECK_BLOCKS[b.type])
    .map((b) => normalizeBlock(b))
  return {
    title: strOr(src.title, 'Asset Disposal Proposal'),
    orientation: pickFrom(src.orientation, ['landscape', 'portrait'], 'landscape'),
    currency: strOr(src.currency, 'SAR') || 'SAR',
    blocks: blocks.length ? blocks : DECK_PRESETS.committee.build(),
  }
}

function normalizeBlock(b) {
  const type = b.type
  const base = { id: typeof b.id === 'string' && b.id ? b.id : blockId(type), type }
  switch (type) {
    case 'title':
      return { ...base, title: strOr(b.title, 'Asset Disposal Proposal'), subtitle: strOr(b.subtitle, ''), showDate: b.showDate !== false }
    case 'summary_kpis': {
      const items = (Array.isArray(b.items) ? b.items : []).filter((k) => KPI_ITEMS[k])
      return { ...base, title: strOr(b.title, 'Headline numbers'), items: items.length ? items.slice(0, 9) : [...DECK_BLOCKS.summary_kpis.defaults.items] }
    }
    case 'findings':
      return { ...base, title: strOr(b.title, 'What the list shows') }
    case 'chart':
      return {
        ...base,
        title: strOr(b.title, ''),
        source: pickFrom(b.source, CHART_SOURCE_KEYS, 'by_type'),
        metric: pickFrom(b.metric, CHART_METRIC_KEYS, 'count'),
        viz: pickFrom(b.viz, CHART_VIZ_KEYS, 'bar'),
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
      }
    case 'table': {
      const cols = (Array.isArray(b.columns) ? b.columns : []).filter((c) => TABLE_COLUMNS[c])
      return {
        ...base,
        title: strOr(b.title, 'Disposal register'),
        columns: cols.length ? cols : [...DEFAULT_TABLE_COLUMNS],
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
        sort: pickFrom(b.sort, SORTS.map((s) => s.key), 'asset_no'),
        density: pickFrom(b.density, ['normal', 'compact'], 'normal'),
        rowsPerSlide: clampInt(b.rowsPerSlide, 4, 24, 12),
        limit: clampInt(b.limit, 0, 1000, 0),
      }
    }
    case 'asset_detail':
      return {
        ...base,
        title: strOr(b.title, ''),
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
        sort: pickFrom(b.sort, SORTS.map((s) => s.key), 'asset_no'),
        limit: clampInt(b.limit, 0, 500, 0),
        showTyres: b.showTyres !== false,
        showRemarks: b.showRemarks !== false,
      }
    case 'tyre_recovery': {
      const cols = (Array.isArray(b.columns) ? b.columns : []).filter((c) => TYRE_COLUMNS[c])
      return {
        ...base,
        title: strOr(b.title, 'Tyres to recover'),
        columns: cols.length ? cols : [...DEFAULT_TYRE_COLUMNS],
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
        rowsPerSlide: clampInt(b.rowsPerSlide, 4, 26, 14),
      }
    }
    case 'text':
      return { ...base, title: strOr(b.title, 'Note'), body: strOr(b.body, '') }
    case 'divider':
      return { ...base, label: strOr(b.label, 'Section') }
    default:
      return { ...base, type: 'text', title: 'Note', body: '' }
  }
}

// ── Presets ──────────────────────────────────────────────────────────────────
export const DECK_PRESETS = {
  committee: {
    key: 'committee',
    label: 'Committee pack',
    description: 'The full case: headline numbers, findings, the cuts, and the whole register.',
    build: () => [
      makeBlock('title', { title: 'Asset Disposal Proposal', subtitle: 'For disposal committee approval' }),
      makeBlock('summary_kpis'),
      makeBlock('findings'),
      makeBlock('chart', { source: 'by_type', metric: 'count', viz: 'bar' }),
      makeBlock('chart', { source: 'by_condition', metric: 'count', viz: 'doughnut' }),
      makeBlock('chart', { source: 'by_type', metric: 'spend', viz: 'bar_h', title: 'Lifetime spend by asset type' }),
      makeBlock('divider', { label: 'The register' }),
      makeBlock('table'),
      makeBlock('tyre_recovery'),
    ],
  },
  board: {
    key: 'board',
    label: 'Board summary',
    description: 'Headline only. Four slides for a board that wants the ask, not the detail.',
    build: () => [
      makeBlock('title', { title: 'Asset Disposal Summary', subtitle: 'Board briefing' }),
      makeBlock('summary_kpis', { items: ['assets', 'to_scrap', 'to_sell', 'lifetime_spend', 'still_active', 'estimated_value'] }),
      makeBlock('findings'),
      makeBlock('chart', { source: 'by_disposition', metric: 'count', viz: 'doughnut', title: 'Scrap vs sell' }),
    ],
  },
  scrap_only: {
    key: 'scrap_only',
    label: 'Scrap only',
    description: 'Just the machines proposed for scrap, with their condition and the tyres to strip first.',
    build: () => [
      makeBlock('title', { title: 'Assets Proposed for Scrap', subtitle: 'Scrap list' }),
      makeBlock('summary_kpis', { items: ['to_scrap', 'still_active', 'not_in_register', 'job_cards', 'lifetime_spend', 'active_tyres'] }),
      makeBlock('chart', { source: 'by_condition', metric: 'count', viz: 'bar', filter: 'scrap', title: 'Condition of the scrap list' }),
      makeBlock('table', { title: 'Scrap register', filter: 'scrap', sort: 'asset_type' }),
      makeBlock('tyre_recovery', { filter: 'scrap', title: 'Tyres to recover from the scrap list' }),
    ],
  },
  sale_candidates: {
    key: 'sale_candidates',
    label: 'Sale candidates',
    description: 'The machines worth selling, one dossier slide each for a buyer or a valuer.',
    build: () => [
      makeBlock('title', { title: 'Assets Proposed for Sale', subtitle: 'Sale candidates' }),
      makeBlock('summary_kpis', { items: ['to_sell', 'estimated_value', 'sale_proceeds', 'lifetime_spend'] }),
      makeBlock('table', { title: 'Sale register', filter: 'sell', sort: 'model_year', columns: ['asset_no', 'asset_type', 'brand', 'model_year', 'meter_text', 'condition', 'site', 'estimated_value'] }),
      makeBlock('asset_detail', { filter: 'sell' }),
    ],
  },
  dossier: {
    key: 'dossier',
    label: 'Per asset dossier',
    description: 'One slide per machine. The evidence pack behind the ask.',
    build: () => [
      makeBlock('title', { title: 'Asset Disposal Dossier', subtitle: 'One slide per machine' }),
      makeBlock('summary_kpis', { items: ['assets', 'to_scrap', 'to_sell', 'active_tyres'] }),
      makeBlock('asset_detail', { filter: 'all', sort: 'asset_no' }),
    ],
  },
  register_gaps: {
    key: 'register_gaps',
    label: 'Register clean up',
    description: 'The data problems the write off has to settle: machines still Active, and machines with no register record at all.',
    build: () => [
      makeBlock('title', { title: 'Fleet Register Clean Up', subtitle: 'Assets to correct at write off' }),
      makeBlock('summary_kpis', { items: ['assets', 'still_active', 'not_in_register', 'in_register'] }),
      makeBlock('chart', { source: 'by_register', metric: 'count', viz: 'doughnut', title: 'Fleet register coverage' }),
      makeBlock('table', { title: 'Not in the fleet register', filter: 'not_in_register', columns: ['asset_no', 'sr_no', 'asset_type', 'brand', 'model_year', 'site', 'condition', 'disposition'] }),
      makeBlock('table', { title: 'Still Active in the register', filter: 'still_active', columns: ['asset_no', 'asset_type', 'fleet_status', 'fleet_site', 'condition', 'disposition', 'job_cards', 'spend'] }),
    ],
  },
}
export const DECK_PRESET_KEYS = Object.keys(DECK_PRESETS)

/** A full config for a preset key (falls back to the committee pack). */
export function presetConfig(key, patch = {}) {
  const p = DECK_PRESETS[key] || DECK_PRESETS.committee
  return normalizeDeckConfig({ title: p.label, ...patch, blocks: p.build() })
}

// ── Findings ─────────────────────────────────────────────────────────────────
/**
 * Local findings used when the engine does not supply them. Every sentence is a
 * straight read of the rows; nothing is projected and no value is invented.
 */
export function localFindings(rows, totals, currency = 'SAR') {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []
  const out = []
  const t = totals || {}
  const n = t.assets ?? list.length
  const scrap = t.to_scrap ?? list.filter(isScrap).length
  const sell = t.to_sell ?? list.filter(isSell).length
  out.push(`${fmtNum(n)} assets are proposed for disposal: ${fmtNum(scrap)} to scrap and ${fmtNum(sell)} to sell.`)

  const spend = t.lifetime_spend ?? sum(list, 'spend')
  const jc = t.job_cards ?? sum(list, 'job_cards')
  if (spend > 0) out.push(`These machines have absorbed ${fmtMoney(spend, currency)} across ${fmtNum(jc)} job cards to date.`)

  const active = t.still_active ?? list.filter(stillActive).length
  if (active > 0) out.push(`${fmtNum(active)} are still marked Active in the fleet register and will keep reading as working vehicles until the write off is approved.`)

  const missing = t.not_in_register ?? list.filter(notInRegister).length
  if (missing > 0) {
    const codes = list.filter(notInRegister).map((r) => fmtText(r.asset_no)).join(', ')
    out.push(`${fmtNum(missing)} have no fleet register record at all (${codes}). They are on this list and need a register decision as well as a disposal decision.`)
  }

  const tyres = t.active_tyres ?? list.reduce((s, r) => s + assetTyres(r).length, 0)
  if (tyres > 0) out.push(`${fmtNum(tyres)} serial numbered tyres are still fitted to these machines and should be recovered before anything leaves site.`)

  const unvalued = list.filter((r) => !isValued(r)).length
  if (unvalued > 0) out.push(`${fmtNum(unvalued)} of ${fmtNum(list.length)} assets carry no valuation. No recovery figure can be quoted until they are valued.`)

  const worst = [...list].sort((a, b) => (num(b?.spend) ?? -1) - (num(a?.spend) ?? -1))[0]
  if (worst && num(worst.spend) != null && num(worst.spend) > 0) {
    out.push(`Highest lifetime spend on the list is ${fmtText(worst.asset_no)} (${fmtText(worst.asset_type)}) at ${fmtMoney(worst.spend, currency)}.`)
  }
  return out.map(ascii)
}

/**
 * The shared engine's findings read totals under its OWN camelCase names. This
 * component is handed snake_case totals by the page, and passing those straight
 * through made the engine read `undefined` for stillActive / notInRegister and
 * silently DROP the two findings that matter most on this deck. So the totals are
 * only forwarded when they carry the engine's naming; otherwise it is handed null
 * and recomputes from the rows, which is what it does by design.
 */
function engineTotals(totals) {
  if (!totals || typeof totals !== 'object') return null
  return ('stillActive' in totals || 'notInRegister' in totals) ? totals : null
}

function findingsFor(rows, totals, currency) {
  const fn = eng('disposalFindings')
  if (fn) {
    try {
      const res = fn(rows, engineTotals(totals))
      const lines = Array.isArray(res)
        ? res.map((f) => (typeof f === 'string' ? f : (f?.text ?? f?.message ?? f?.title ?? '')))
        : []
      const clean = lines.map((s) => ascii(s).trim()).filter(Boolean)
      if (clean.length) return clean
    } catch { /* fall through to the local reading */ }
  }
  return localFindings(rows, totals, currency)
}

// ── Block resolution ─────────────────────────────────────────────────────────
/**
 * Turn one block into render-ready data. Pure. Never throws on odd input: an
 * unknown block resolves to an honest text slide rather than blanking the deck.
 *
 * @param {object} block  a normalised block
 * @param {object} ctx    { rows, totals, currency, company, country, now }
 * @returns {object} { kind, ...payload } or { kind, slides:[...] } for the
 *                   block types that expand across several slides.
 */
export function resolveBlock(block, ctx = {}) {
  const rows = Array.isArray(ctx.rows) ? ctx.rows : []
  const totals = ctx.totals || null
  const currency = ascii(ctx.currency || 'SAR') || 'SAR'
  const company = ascii(ctx.company || 'TyrePulse')
  const country = ascii(ctx.country || '')
  const b = normalizeBlock(block && DECK_BLOCKS[block.type] ? block : { type: 'text' })

  switch (b.type) {
    case 'title':
      return {
        kind: 'title', id: b.id,
        title: fmtText(b.title), subtitle: ascii(b.subtitle),
        company, country, showDate: b.showDate !== false,
        assetCount: rows.length,
      }

    case 'summary_kpis': {
      const items = b.items.map((k) => {
        const def = KPI_ITEMS[k]
        return {
          key: k,
          label: ascii(def.label),
          value: ascii(def.get(totals, rows, currency)),
          note: def.note ? ascii(def.note) : '',
          valuation: !!def.valuation,
        }
      })
      return {
        kind: 'kpis', id: b.id, title: fmtText(b.title), items,
        empty: rows.length === 0,
        emptyNote: 'No assets are on the disposal list, so there are no numbers to report.',
      }
    }

    case 'findings': {
      const bullets = findingsFor(rows, totals, currency)
      return {
        kind: 'findings', id: b.id, title: fmtText(b.title),
        bullets, empty: bullets.length === 0,
        emptyNote: rows.length === 0
          ? 'No assets are on the disposal list. Nothing to report.'
          : 'Nothing stands out in this list beyond the figures already shown.',
      }
    }

    case 'chart': {
      const scoped = filterRows(rows, b.filter)
      const data = chartData(scoped, { source: b.source, metric: b.metric })
      const src = CHART_SOURCES[b.source] || CHART_SOURCES.by_type
      const met = CHART_METRICS[data.metric] || CHART_METRICS.count
      const autoTitle = data.metric === 'count' ? src.label : `${met.label} ${src.label.replace(/^By /i, 'by ')}`
      const notes = []
      if (b.filter !== 'all') notes.push(`Filter: ${filterLabel(b.filter)}.`)
      if (data.basis) notes.push(data.basis)
      if (data.forcedCount) notes.push(`${met.label} cannot be split this way, so this shows asset counts.`)
      return {
        kind: 'chart', id: b.id,
        title: fmtText(b.title || autoTitle),
        viz: b.viz, source: b.source, metric: data.metric,
        labels: data.labels, values: data.values,
        digest: chartDigest(data, currency),
        note: ascii(notes.join(' ')),
        money: data.metric === 'spend', currency,
        empty: data.labels.length === 0,
        emptyNote: scoped.length === 0
          ? `No assets match ${filterLabel(b.filter).toLowerCase()}, so this chart has nothing to draw.`
          : 'Every asset in this cut reads as zero, so there is nothing to chart.',
      }
    }

    case 'table': {
      let scoped = sortRows(filterRows(rows, b.filter), b.sort)
      const matched = scoped.length
      if (b.limit > 0) scoped = scoped.slice(0, b.limit)
      const columns = b.columns.map((c) => ({ key: c, header: TABLE_COLUMNS[c].header, align: TABLE_COLUMNS[c].align || 'left', width: TABLE_COLUMNS[c].width || 1 }))
      const body = scoped.map((r) => columns.map((c) => ascii(TABLE_COLUMNS[c.key].get(r, currency))))
      const per = b.rowsPerSlide
      const pages = Math.max(1, Math.ceil(body.length / per))
      const notes = [`Showing ${fmtNum(body.length)} of ${fmtNum(rows.length)} assets`]
      if (b.filter !== 'all') notes.push(`filter: ${filterLabel(b.filter)}`)
      if (b.limit > 0 && matched > b.limit) notes.push(`top ${fmtNum(b.limit)} by ${(SORTS.find((s) => s.key === b.sort) || SORTS[0]).label.toLowerCase()}`)
      const caption = ascii(notes.join(' | '))
      const slides = []
      for (let p = 0; p < pages; p++) {
        slides.push({
          kind: 'table', id: `${b.id}_p${p}`,
          title: fmtText(b.title) + (pages > 1 ? ` (${p + 1} of ${pages})` : ''),
          columns, rows: body.slice(p * per, (p + 1) * per),
          caption, density: b.density, page: p + 1, pages,
          empty: body.length === 0,
          emptyNote: `No assets match ${filterLabel(b.filter).toLowerCase()}.`,
        })
      }
      return { kind: 'multi', id: b.id, slides }
    }

    case 'tyre_recovery': {
      const scoped = filterRows(rows, b.filter)
      const all = tyreRows(scoped)
      const columns = b.columns.map((c) => ({ key: c, header: TYRE_COLUMNS[c].header, align: c === 'km' ? 'right' : 'left', width: 1 }))
      const body = all.map((t) => columns.map((c) => ascii(TYRE_COLUMNS[c.key].get(t))))
      const per = b.rowsPerSlide
      const pages = Math.max(1, Math.ceil(body.length / per))
      const assetsWithTyres = new Set(all.map((t) => t.asset_no)).size
      const caption = ascii(`${fmtNum(all.length)} tyres still fitted across ${fmtNum(assetsWithTyres)} assets${b.filter !== 'all' ? ` | filter: ${filterLabel(b.filter)}` : ''}`)
      const slides = []
      for (let p = 0; p < pages; p++) {
        slides.push({
          kind: 'table', id: `${b.id}_p${p}`,
          title: fmtText(b.title) + (pages > 1 ? ` (${p + 1} of ${pages})` : ''),
          columns, rows: body.slice(p * per, (p + 1) * per),
          caption, density: 'compact', page: p + 1, pages,
          empty: body.length === 0,
          emptyNote: 'No tyres with a serial number are recorded as still fitted to these assets.',
        })
      }
      return { kind: 'multi', id: b.id, slides }
    }

    case 'asset_detail': {
      let scoped = sortRows(filterRows(rows, b.filter), b.sort)
      if (b.limit > 0) scoped = scoped.slice(0, b.limit)
      if (!scoped.length) {
        return {
          kind: 'multi', id: b.id,
          slides: [{
            kind: 'text', id: `${b.id}_empty`, title: fmtText(b.title || 'Asset detail'),
            body: `No assets match ${filterLabel(b.filter).toLowerCase()}, so there are no asset slides to show.`,
            empty: true,
          }],
        }
      }
      const slides = scoped.map((r, i) => resolveAssetSlide(r, {
        id: `${b.id}_a${i}`, currency, showTyres: b.showTyres, showRemarks: b.showRemarks,
        index: i + 1, count: scoped.length, titleOverride: b.title,
      }))
      return { kind: 'multi', id: b.id, slides }
    }

    case 'divider':
      return { kind: 'divider', id: b.id, label: fmtText(b.label) }

    case 'text':
    default:
      return { kind: 'text', id: b.id, title: fmtText(b.title), body: ascii(b.body) || 'N/A' }
  }
}

/** One machine's dossier slide. Remarks stay in the committee's own words. */
export function resolveAssetSlide(r, opts = {}) {
  const currency = opts.currency || 'SAR'
  const flags = []
  if (r?.in_register === false) flags.push('NOT IN THE FLEET REGISTER')
  if (stillActive(r)) flags.push('Still Active in the register')
  if (!isValued(r)) flags.push(NOT_VALUED)
  const facts = [
    { label: 'Asset type', value: fmtText(r?.asset_type) },
    { label: 'Brand', value: fmtText(r?.brand) },
    { label: 'Model year', value: fmtText(r?.model_year) },
    { label: 'Region', value: fmtText(r?.region) },
    { label: 'Site', value: fmtText(r?.site) },
    { label: 'Condition', value: fmtText(r?.condition) },
    { label: 'Disposition', value: fmtText(r?.disposition) },
    { label: 'Status', value: fmtText(r?.status) },
    // The meter reading is printed exactly as it was recorded. It is a mix of
    // km, hours and free text on this list, so re-deriving it would change it.
    { label: 'Meter (as recorded)', value: fmtText(r?.meter_text) },
    { label: 'Fleet register', value: r?.in_register === false ? 'No record' : fmtText(r?.fleet_status) },
    { label: 'Chassis', value: fmtText(r?.chassis_no) },
    { label: 'Plate', value: fmtText(r?.registration_no) },
    { label: 'Job cards', value: fmtNum(r?.job_cards) },
    { label: 'Lifetime spend', value: fmtMoney(r?.spend, currency) },
    { label: 'Estimated value', value: fmtValuation(r?.estimated_value, currency) },
    { label: 'Sale proceeds', value: fmtValuation(r?.sale_proceeds, currency) },
  ]
  const tyres = opts.showTyres === false ? [] : assetTyres(r).map((t) => ({
    serial: fmtText(t.serial), position: fmtText(t.position), brand: fmtText(t.brand),
    size: fmtText(t.size), km: fmtNum(t.km), fitted: fmtText(t.fitted),
  }))
  const remarks = opts.showRemarks === false ? [] : remarkLines(r)
  const head = fmtText(r?.asset_no)
  const title = opts.titleOverride ? `${ascii(opts.titleOverride)}: ${head}` : head
  return {
    kind: 'asset', id: opts.id || `asset_${head}`,
    title, assetNo: head, srNo: fmtText(r?.sr_no),
    subtitle: ascii([fmtText(r?.asset_type), fmtText(r?.brand), fmtText(r?.model_year)].filter((v) => v !== 'N/A').join(' | ')),
    flags, facts, tyres, remarks,
    tyreNote: tyres.length ? `${fmtNum(tyres.length)} tyres still fitted. Recover before the machine leaves site.` : 'No tyres recorded as still fitted.',
    remarkNote: remarks.length ? 'Committee remarks, recorded verbatim.' : 'No remarks were recorded for this asset.',
    index: opts.index || 1, count: opts.count || 1,
  }
}

/**
 * The whole deck: an ordered array of resolved slides, ready for a renderer.
 * Blocks that span several slides (table, tyre recovery, asset dossier) are
 * already expanded here, so both renderers and the preview walk one flat list
 * and can never disagree about pagination.
 */
export function buildDeck(config, ctx = {}) {
  const cfg = normalizeDeckConfig(config)
  const rows = Array.isArray(ctx.rows) ? ctx.rows : []
  const currency = cfg.currency || ctx.currency || 'SAR'
  const scope = { ...ctx, rows, currency }
  const slides = []
  for (const b of cfg.blocks) {
    const res = resolveBlock(b, scope)
    if (res.kind === 'multi') slides.push(...res.slides)
    else slides.push(res)
  }
  if (!slides.length) {
    slides.push({
      kind: 'text', id: 'empty_deck', title: ascii(cfg.title),
      body: 'No slides are configured for this deck.', empty: true,
    })
  }
  return {
    title: ascii(cfg.title),
    orientation: cfg.orientation,
    currency,
    company: ascii(ctx.company || 'TyrePulse'),
    country: ascii(ctx.country || ''),
    assetCount: rows.length,
    unvaluedCount: rows.filter((r) => !isValued(r)).length,
    notInRegister: rows.filter(notInRegister).map((r) => fmtText(r.asset_no)),
    slides,
  }
}

// ── Saved layouts (localStorage, versioned key, same shape as cpkReport) ─────
export const DECK_LAYOUT_KEY = 'assetDisposalDeck.layout.v1'
export const DECK_SAVED_KEY = 'assetDisposalDeck.saved.v1'

const safeParse = (raw, dflt) => {
  try {
    const v = JSON.parse(raw || 'null')
    return v == null ? dflt : v
  } catch { return dflt }
}
const store = () => (typeof localStorage === 'undefined' ? null : localStorage)

/** The working layout (the one the builder reopens on). */
export function loadDeckLayout() {
  const ls = store()
  if (!ls) return presetConfig('committee')
  return normalizeDeckConfig(safeParse(ls.getItem(DECK_LAYOUT_KEY), null))
}
export function saveDeckLayout(config) {
  const ls = store()
  const cfg = normalizeDeckConfig(config)
  if (ls) { try { ls.setItem(DECK_LAYOUT_KEY, JSON.stringify(cfg)) } catch { /* quota */ } }
  return cfg
}

/** Named layouts the owner can keep and reopen. */
export function listSavedDecks() {
  const ls = store()
  if (!ls) return []
  const arr = safeParse(ls.getItem(DECK_SAVED_KEY), [])
  if (!Array.isArray(arr)) return []
  return arr
    .filter((d) => d && typeof d.name === 'string')
    .map((d) => ({ name: ascii(d.name), savedAt: typeof d.savedAt === 'string' ? d.savedAt : '', config: normalizeDeckConfig(d.config) }))
}
export function saveNamedDeck(name, config) {
  const ls = store()
  const clean = ascii(name).trim()
  if (!clean) return listSavedDecks()
  const next = listSavedDecks().filter((d) => d.name !== clean)
  next.unshift({ name: clean, savedAt: new Date().toISOString(), config: normalizeDeckConfig(config) })
  const capped = next.slice(0, 25)
  if (ls) { try { ls.setItem(DECK_SAVED_KEY, JSON.stringify(capped)) } catch { /* quota */ } }
  return capped
}
export function deleteNamedDeck(name) {
  const ls = store()
  const next = listSavedDecks().filter((d) => d.name !== ascii(name).trim())
  if (ls) { try { ls.setItem(DECK_SAVED_KEY, JSON.stringify(next)) } catch { /* quota */ } }
  return next
}

export default buildDeck
