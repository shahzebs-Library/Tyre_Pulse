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
 *  6. A RELIABILITY FIGURE THAT WAS NOT MEASURED PRINTS "Not measured". mtbf_days,
 *     failures_per_year, availability_pct, idle_days and the cost-per ratios are
 *     null on plenty of rows. Zero would read as "never fails" or "never idle",
 *     which is the opposite of the truth.
 *  7. TWO CAVEATS TRAVEL WITH EVERY RELIABILITY SLIDE, derived from the rows and
 *     never hard coded:
 *       a) a handful of job cards hold most of the recorded hours because the
 *          machine was PARKED, not under repair. `breakdown_hours` excludes them
 *          and the parked total is stated as its own fact - presenting the
 *          combined figure as downtime would be the most misleading number here.
 *       b) only about half the job cards carry a usable business date, and MTBF,
 *          failures per year, idle days and availability all rest on that half.
 *
 * Aggregation logic lives in the shared engine (src/lib/assetDisposal.js) and the
 * reliability maths in src/lib/assetDisposalReliability.js. Every call into either
 * goes through a guarded reader below so a rename there degrades to a local
 * equivalent instead of blanking a committee slide.
 */
import * as engine from './assetDisposal'
import * as reliabilityEngine from './assetDisposalReliability'
import * as replacementEngine from './assetReplacement'

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

// ── Measured figures ─────────────────────────────────────────────────────────
/**
 * A reliability figure that could not be measured. Deliberately its OWN word,
 * distinct from "N/A" (a field nobody filled in) and "Not valued" (a valuation
 * nobody carried out). "MTBF: Not measured" tells a committee the history was too
 * thin to compute one; "MTBF: 0" would tell them the machine fails constantly.
 */
export const NOT_MEASURED = 'Not measured'

// Grouping is done by hand rather than through toLocaleString so the output is
// byte identical whatever ICU data the environment ships with. This text goes
// into a pptx and a pdf; it cannot vary by host.
const group3 = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
function decStr(n, dp) {
  const neg = n < 0
  const fixed = Math.abs(n).toFixed(dp)
  const [i, f] = fixed.split('.')
  return `${neg ? '-' : ''}${group3(i)}${f ? `.${f}` : ''}`
}

export const METRIC_FORMATS = ['int', 'dec1', 'dec2', 'pct1', 'money', 'money2', 'ratio', 'date', 'text']

/**
 * Format one measured figure. NULL (or anything unparseable) is NOT_MEASURED -
 * never 0, never a dash on its own, never an estimate.
 */
export function formatMetric(v, fmt = 'int', currency = 'SAR') {
  if (fmt === 'text') {
    const s = ascii(v).trim()
    return s === '' ? NOT_MEASURED : s
  }
  if (fmt === 'date') {
    const s = ascii(v).trim().slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : NOT_MEASURED
  }
  const n = num(v)
  if (n == null) return NOT_MEASURED
  const cur = ascii(currency || 'SAR') || 'SAR'
  switch (fmt) {
    case 'dec1': return decStr(n, 1)
    case 'dec2': return decStr(n, 2)
    case 'pct1': return `${decStr(n, 1)}%`
    case 'money': return `${cur} ${decStr(Math.round(n), 0)}`
    case 'money2': return `${cur} ${decStr(n, 2)}`
    case 'ratio': return `${decStr(n, 1)}x`
    case 'int':
    default: return decStr(Math.round(n), 0)
  }
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

// ═════════════════════════════════════════════════════════════════════════════
// RELIABILITY
// ═════════════════════════════════════════════════════════════════════════════
// The owner's own scrap workbook already carries CPK, breakdowns, MTBF and
// failures per asset, and they asked for the deck to carry the same case. The
// maths lives in src/lib/assetDisposalReliability.js; this section owns only how
// it is PRESENTED and the caveats that must travel with it.
//
// Every call into the reliability engine goes through the same guarded readers
// the disposal engine uses, so a rename there degrades to a local reading of the
// exact same row fields rather than blanking a committee slide.
const rel = (name) => (reliabilityEngine && typeof reliabilityEngine[name] === 'function' ? reliabilityEngine[name] : null)
const relConst = (name) => (reliabilityEngine && reliabilityEngine[name] != null ? reliabilityEngine[name] : null)

/**
 * How each reliability field is shown. `worstHigh` says which end of the scale
 * is bad, which is what ranking and banding need; a metric where neither end is
 * a verdict (dates, coverage, counts of cards) carries null and is never ranked
 * as an offender.
 */
export const RELIABILITY_COLUMNS = {
  asset_no: { header: 'Asset', field: 'asset_no', format: 'text', width: 1, worstHigh: null },
  asset_type: { header: 'Type', field: 'asset_type', format: 'text', width: 1.2, worstHigh: null },
  site: { header: 'Site', field: 'site', format: 'text', width: 1.1, worstHigh: null },
  job_cards: { header: 'Job cards', field: 'job_cards', format: 'int', align: 'right', width: 0.85, worstHigh: true },
  dated_cards: { header: 'Dated cards', field: 'dated_cards', format: 'int', align: 'right', width: 0.9, worstHigh: null },
  date_coverage_pct: { header: 'Date coverage', field: 'date_coverage_pct', format: 'pct1', align: 'right', width: 1, worstHigh: null, note: 'Share of this machine\'s job cards that carry a usable date.' },
  breakdown_hours: {
    header: 'Breakdown hrs', field: 'breakdown_hours', format: 'int', align: 'right', width: 1.05, worstHigh: true,
    note: 'Parked job cards excluded. This is time under repair, not time standing still.',
  },
  breakdown_hours_recorded: {
    header: 'Hrs as recorded', field: 'breakdown_hours_recorded', format: 'int', align: 'right', width: 1.1, worstHigh: null,
    note: 'Everything the ERP holds, parked cards included. Do not read this as downtime.',
  },
  parked_cards: { header: 'Parked cards', field: 'parked_cards', format: 'int', align: 'right', width: 0.95, worstHigh: null },
  parked_hours: {
    header: 'Parked hrs', field: 'parked_hours', format: 'int', align: 'right', width: 0.95, worstHigh: null,
    note: 'Hours on cards left open while the machine sat in a yard.',
  },
  longest_card_hours: { header: 'Longest card hrs', field: 'longest_card_hours', format: 'int', align: 'right', width: 1.1, worstHigh: null },
  failures: { header: 'Failures', field: 'failures', format: 'int', align: 'right', width: 0.85, worstHigh: true },
  dated_failures: { header: 'Dated failures', field: 'dated_failures', format: 'int', align: 'right', width: 1, worstHigh: null },
  emergency_cards: { header: 'Emergency', field: 'emergency_cards', format: 'int', align: 'right', width: 0.95, worstHigh: true },
  repair_cards: { header: 'Repair', field: 'repair_cards', format: 'int', align: 'right', width: 0.8, worstHigh: null },
  preventive_cards: {
    header: 'Planned', field: 'preventive_cards', format: 'int', align: 'right', width: 0.85, worstHigh: false,
    note: 'Planned services. Zero means this machine was never serviced to a schedule.',
  },
  preventive_share_pct: { header: 'Planned share', field: 'preventive_share_pct', format: 'pct1', align: 'right', width: 1, worstHigh: false },
  mtbf_days: {
    header: 'MTBF days', field: 'mtbf_days', format: 'dec1', align: 'right', width: 0.95, worstHigh: false,
    note: 'Mean days between failures. Rests on the dated job cards only.',
  },
  failures_per_year: { header: 'Failures/yr', field: 'failures_per_year', format: 'dec1', align: 'right', width: 0.95, worstHigh: true },
  availability_pct: { header: 'Available', field: 'availability_pct', format: 'pct1', align: 'right', width: 0.95, worstHigh: false },
  idle_days: {
    header: 'Idle days', field: 'idle_days', format: 'int', align: 'right', width: 0.9, worstHigh: true,
    note: 'Days since the last job card of any kind.',
  },
  observed_days: { header: 'Observed days', field: 'observed_days', format: 'int', align: 'right', width: 1, worstHigh: null },
  first_seen: { header: 'First card', field: 'first_seen', format: 'date', width: 1, worstHigh: null },
  last_seen: { header: 'Last card', field: 'last_seen', format: 'date', width: 1, worstHigh: null },
  spend: { header: 'Lifetime spend', field: 'spend', format: 'money', align: 'right', width: 1.3, worstHigh: true },
  cost_per_breakdown_hour: { header: 'Cost / hr down', field: 'cost_per_breakdown_hour', format: 'money2', align: 'right', width: 1.25, worstHigh: true },
  cost_per_failure: { header: 'Cost / failure', field: 'cost_per_failure', format: 'money2', align: 'right', width: 1.2, worstHigh: true },
}
export const RELIABILITY_COLUMN_KEYS = Object.keys(RELIABILITY_COLUMNS)

/**
 * The metrics an offender ranking can be built on: the ones where one end of the
 * scale is genuinely a verdict. Anything else (dates, card counts, coverage) is
 * deliberately not rankable - "worst first card date" is not a finding.
 */
export const RANKABLE_METRICS = RELIABILITY_COLUMN_KEYS.filter((k) => RELIABILITY_COLUMNS[k].worstHigh != null)

const DEFAULT_RELIABILITY_COLUMNS = [
  'asset_no', 'asset_type', 'job_cards', 'failures', 'breakdown_hours',
  'mtbf_days', 'failures_per_year', 'availability_pct', 'idle_days', 'preventive_cards',
]

/**
 * The engine's own metric catalog, when it exposes one, is used to LABEL the
 * columns so the deck and any other reliability surface name a measure
 * identically. Its shape is not assumed: only a usable label is taken, and the
 * deck's own formatting, width and direction always win.
 */
function metricLabel(key) {
  const cat = relConst('RELIABILITY_METRICS')
  const own = RELIABILITY_COLUMNS[key]
  if (!cat || !own) return own ? own.header : fmtText(key)
  try {
    const entry = Array.isArray(cat) ? cat.find((m) => m && (m.key === key || m.field === key)) : cat[key]
    const label = entry && (entry.shortLabel || entry.header || entry.label)
    // Only when it still fits the column. These headers sit in fixed width pptx
    // table cells; a long one overflows rather than wrapping.
    if (typeof label === 'string' && label.trim() && label.trim().length <= 14) return ascii(label.trim())
  } catch { /* the deck's own header is the fallback */ }
  return own.header
}

/**
 * Read one reliability field off a row. The reliability engine's own
 * `metricValue` is used where it exists, because the page may hand rows whose
 * figures are NESTED under `row.reliability` rather than flattened onto the row,
 * and reading `row[field]` directly would silently report every figure as Not
 * measured on that shape.
 */
export function readField(row, key) {
  const col = RELIABILITY_COLUMNS[key]
  const field = col ? col.field : key
  const textish = col && (col.format === 'text' || col.format === 'date')
  if (!textish) {
    const fn = rel('metricValue')
    if (fn) { try { return fn(row, field) } catch { /* fall through to the local read */ } }
  }
  const nested = row && typeof row.reliability === 'object' && row.reliability ? row.reliability : null
  return nested && field in nested ? nested[field] : row?.[field]
}

/**
 * The fields that decide whether a machine has a RELIABILITY record at all.
 * `job_cards` and `spend` are deliberately excluded: the disposal register
 * carries both on its own, so counting them would report every machine as
 * measured while every actual reliability figure came back Not measured.
 */
export const RELIABILITY_FIELDS = RELIABILITY_COLUMN_KEYS
  .filter((k) => !['asset_no', 'asset_type', 'site', 'job_cards', 'spend'].includes(k))
export function hasReliability(row) {
  return RELIABILITY_FIELDS.some((k) => num(readField(row, k)) != null)
}

const median = (list) => {
  const v = list.filter((x) => x != null).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const vals = (rows, key) => (rows || []).map((r) => num(readField(r, key))).filter((v) => v != null)
const countWhere = (rows, fn) => (rows || []).filter((r) => { try { return fn(r) } catch { return false } }).length

/**
 * Thresholds the fleet strip counts against. Stated on the slide, never hidden.
 * The availability floor is the reliability engine's own when it publishes one,
 * so the deck and every other reliability surface count the same machines.
 */
export const AVAILABILITY_FLOOR = num(relConst('BELOW_AVAILABILITY_PCT')) ?? 80
export const LONG_IDLE_DAYS = num(relConst('IDLE_JOB_CARD_DAYS')) ?? num(engConst('IDLE_JOB_CARD_DAYS')) ?? 365

/**
 * Fleet level reliability, read straight off the rows. Used as the base reading
 * and as the fallback when the reliability engine does not expose its own.
 */
export function localFleetReliability(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean)
  const withHistory = list.filter(hasReliability)
  const s = (k) => list.reduce((a, r) => a + (num(readField(r, k)) ?? 0), 0)
  const anyOf = (k) => vals(list, k).length > 0
  const breakdownHours = anyOf('breakdown_hours') ? s('breakdown_hours') : null
  const spend = anyOf('spend') ? s('spend') : null
  const cards = anyOf('job_cards') ? s('job_cards') : null
  const dated = anyOf('dated_cards') ? s('dated_cards') : null
  const preventive = anyOf('preventive_cards') ? s('preventive_cards') : null
  return {
    assets: list.length,
    assets_with_history: withHistory.length,
    job_cards: cards,
    dated_cards: dated,
    // Coverage is recomputed from the totals, not averaged from per asset
    // percentages: a machine with 3 cards must not weigh the same as one with 300.
    date_coverage_pct: cards != null && dated != null && cards > 0 ? (dated / cards) * 100 : null,
    breakdown_hours: breakdownHours,
    breakdown_hours_recorded: anyOf('breakdown_hours_recorded') ? s('breakdown_hours_recorded') : null,
    parked_hours: anyOf('parked_hours') ? s('parked_hours') : null,
    parked_cards: anyOf('parked_cards') ? s('parked_cards') : null,
    longest_card_hours: vals(list, 'longest_card_hours').length ? Math.max(...vals(list, 'longest_card_hours')) : null,
    failures: anyOf('failures') ? s('failures') : null,
    dated_failures: anyOf('dated_failures') ? s('dated_failures') : null,
    emergency_cards: anyOf('emergency_cards') ? s('emergency_cards') : null,
    repair_cards: anyOf('repair_cards') ? s('repair_cards') : null,
    preventive_cards: preventive,
    preventive_share_pct: cards != null && preventive != null && cards > 0 ? (preventive / cards) * 100 : null,
    median_mtbf_days: median(vals(list, 'mtbf_days')),
    median_availability_pct: median(vals(list, 'availability_pct')),
    // A count is only honest over the machines that HAVE the measurement; the
    // ones with none are reported separately rather than counted as healthy.
    availability_floor: AVAILABILITY_FLOOR,
    low_availability: vals(list, 'availability_pct').length
      ? countWhere(list, (r) => (num(readField(r, 'availability_pct')) ?? Infinity) < AVAILABILITY_FLOOR) : null,
    availability_measured: vals(list, 'availability_pct').length || null,
    never_preventive: withHistory.length
      ? countWhere(withHistory, (r) => num(readField(r, 'preventive_cards')) === 0) : null,
    long_idle: vals(list, 'idle_days').length
      ? countWhere(list, (r) => (num(readField(r, 'idle_days')) ?? -1) > LONG_IDLE_DAYS) : null,
    idle_measured: vals(list, 'idle_days').length || null,
    spend,
    cost_per_breakdown_hour: spend != null && breakdownHours ? spend / breakdownHours : null,
  }
}

/**
 * Where the reliability engine's own fleet roll up publishes the same figure
 * under a different name. Each entry is a path into its result. A figure it does
 * not publish (emergency and repair card counts, the longest single card, cost
 * per breakdown hour) stays on the local reading of the same rows.
 */
const FLEET_ALIAS = {
  assets_with_history: ['withHistory'],
  low_availability: ['belowAvailability'],
  availability_measured: ['availabilityMeasured'],
  never_preventive: ['neverPreventive'],
  long_idle: ['idleOverYear'],
  idle_measured: ['idleMeasured'],
  availability_floor: ['belowAvailabilityPct'],
  median_mtbf_days: ['medians', 'mtbf_days'],
  median_availability_pct: ['medians', 'availability_pct'],
}
const dig = (obj, path) => path.reduce((o, k) => (o && typeof o === 'object' && k in o ? o[k] : undefined), obj)

/**
 * Fleet reliability for the rows in scope. The engine's own reading wins per
 * FIELD where it supplies one; anything it does not carry falls back to the
 * local reading of the same rows, so a partial engine never blanks the strip.
 *
 * A key the engine publishes as NULL is honoured as null - that is a refusal
 * (mixed currency, nothing measurable), not a gap to be filled locally.
 */
export function fleetReliabilityFor(rows) {
  const local = localFleetReliability(rows)
  const fn = rel('fleetReliability')
  if (!fn) return local
  let out = null
  try { out = fn(rows) } catch { return local }
  if (!out || typeof out !== 'object') return local
  const merged = { ...local }
  for (const k of Object.keys(local)) {
    const path = FLEET_ALIAS[k] || [k]
    const v = dig(out, path)
    if (v === undefined) continue
    merged[k] = v === null ? null : num(v)
  }
  // Money the engine declined to total because the rows carry more than one
  // currency must stay null; a local sum there would add riyals to dirhams.
  if (out.mixedCurrency === true) {
    merged.spend = null
    merged.cost_per_breakdown_hour = null
    merged.mixedCurrency = true
  }
  return merged
}

// ── The two caveats that travel with every reliability slide ─────────────────
/**
 * Both statements are DERIVED from the rows in scope. Neither is hard coded, so
 * a cleaner data load quietly softens them instead of leaving a stale claim on a
 * committee slide.
 *
 * @param {Array}  rows
 * @param {object} [opts.only] which caveats matter for this slide:
 *                 { hours:true } states the parked exclusion,
 *                 { dated:true } states what the dated half supports.
 */
export function reliabilityBasisNotes(rows, { hours = true, dated = true, fleet = null } = {}) {
  const f = fleet || fleetReliabilityFor(rows)
  const out = []
  if (hours && f.breakdown_hours != null) {
    if (f.parked_hours != null && f.parked_hours > 0) {
      const parts = [
        `Breakdown hours are ${formatMetric(f.breakdown_hours, 'int')} with parked job cards excluded.`,
        `A further ${formatMetric(f.parked_hours, 'int')} hours sit on ${formatMetric(f.parked_cards, 'int')} cards left open while the machine stood in a yard.`,
        'Those are not repair time and are never added in.',
      ]
      if (f.longest_card_hours != null) {
        parts.push(`The single longest card runs ${formatMetric(f.longest_card_hours, 'int')} hours.`)
      }
      out.push(parts.join(' '))
    } else {
      out.push(`Breakdown hours are ${formatMetric(f.breakdown_hours, 'int')}. No parked job cards were separated out of this list.`)
    }
  }
  if (dated) {
    if (f.date_coverage_pct != null) {
      out.push(
        `${formatMetric(f.date_coverage_pct, 'pct1')} of the ${formatMetric(f.job_cards, 'int')} job cards carry a usable date `
        + '(' + formatMetric(f.dated_cards, 'int') + ' cards). '
        + 'MTBF, failures per year, idle days and availability rest on that half and on nothing else.',
      )
    } else {
      out.push('Date coverage on these job cards could not be measured, so MTBF, failures per year, idle days and availability are shown as recorded and not adjusted.')
    }
  }
  return out.map(ascii)
}

/** Every basis statement the deck can make about this list, for the basis slide. */
export function reliabilityBasisLines(rows, currency = 'SAR') {
  const list = Array.isArray(rows) ? rows : []
  const f = fleetReliabilityFor(list)
  const out = [...reliabilityBasisNotes(list, { fleet: f })]
  if (f.assets_with_history != null && f.assets_with_history < list.length) {
    out.push(`${formatMetric(f.assets_with_history, 'int')} of ${formatMetric(list.length, 'int')} machines on this list carry any maintenance history at all. The rest are shown as Not measured rather than as zero.`)
  }
  if (f.availability_measured != null && f.availability_measured < list.length) {
    out.push(`Availability could be measured on ${formatMetric(f.availability_measured, 'int')} machines. The others have no measurable in service window.`)
  }
  out.push('No machine on this list has been valued, so no recovery, resale or saving figure appears anywhere in this deck.')
  out.push(`Every figure is a straight read of the job card and expense history booked against these machines${currency ? ` in ${ascii(currency)}` : ''}. Nothing is projected, smoothed or estimated.`)
  return out.map(ascii)
}

// ── Banding ─────────────────────────────────────────────────────────────────
const BAND_ALIAS = {
  good: 'good', ok: 'good', healthy: 'good', pass: 'good', low: 'good', best: 'good',
  watch: 'watch', warn: 'watch', warning: 'watch', medium: 'watch', mid: 'watch', caution: 'watch',
  bad: 'bad', poor: 'bad', high: 'bad', critical: 'bad', severe: 'bad', worst: 'bad', fail: 'bad',
}
/** Fold whatever the reliability engine calls a band into the deck's three tones. */
export function normalizeBand(v) {
  if (v == null) return ''
  const raw = typeof v === 'string' ? v : (v.band ?? v.tone ?? v.level ?? v.key ?? v.status ?? '')
  return BAND_ALIAS[String(raw).trim().toLowerCase()] || ''
}
/** Band one cell, using the engine's rule when it has one. No rule = no band. */
export function bandFor(key, value, peers) {
  if (num(value) == null) return ''
  const fn = rel('metricBand')
  if (!fn) return ''
  try { return normalizeBand(fn(key, num(value), peers)) } catch { return '' }
}

// ── Ranking ─────────────────────────────────────────────────────────────────
/**
 * The worst N machines on one metric. The engine's ranking is used when it gives
 * back something usable; otherwise the rows are sorted locally on the same field
 * in the direction the column catalog declares.
 */
export function worstBy(rows, key, { limit = 8 } = {}) {
  const col = RELIABILITY_COLUMNS[key]
  if (!col) return []
  const list = (Array.isArray(rows) ? rows : []).filter((r) => num(readField(r, key)) != null)
  const localSort = () => {
    // worstHigh: the bad end is the TOP of the scale, so worst first is
    // descending. A metric where low is bad (availability, MTBF) runs the other
    // way. Getting this backwards silently ranks the healthiest machines.
    const dir = col.worstHigh === false ? -1 : 1
    return [...list].sort((a, b) => (num(readField(b, key)) - num(readField(a, key))) * dir).slice(0, limit)
  }
  const fn = rel('reliabilityRanking')
  if (!fn) return localSort()
  try {
    const res = fn(rows, key, { limit, worst: true })
    if (!Array.isArray(res) || !res.length) return localSort()
    // The engine returns { assetNo, value, band, row }; the deck wants the row.
    const mapped = res
      .map((x) => (x && x.row && typeof x.row === 'object' ? x.row : x))
      .filter((r) => r && typeof r === 'object' && r.asset_no != null && num(readField(r, key)) != null)
    return mapped.length ? mapped.slice(0, limit) : localSort()
  } catch { return localSort() }
}

/**
 * Order a reliability table. A metric sorts worst first (that is what the reader
 * came for); a text column sorts alphabetically. A machine with NO measurement
 * always sinks to the bottom rather than sorting as if it were zero.
 */
export function sortReliabilityRows(rows, key) {
  const col = RELIABILITY_COLUMNS[key] || RELIABILITY_COLUMNS.asset_no
  const list = [...(Array.isArray(rows) ? rows : [])]
  const sortKey = RELIABILITY_COLUMNS[key] ? key : 'asset_no'
  if (col.format === 'text' || col.format === 'date') {
    return list.sort((a, b) => String(readField(a, sortKey) ?? '').localeCompare(String(readField(b, sortKey) ?? ''))
      || String(a?.asset_no ?? '').localeCompare(String(b?.asset_no ?? '')))
  }
  const dir = col.worstHigh === false ? -1 : 1
  return list.sort((a, b) => {
    const x = num(readField(a, sortKey))
    const y = num(readField(b, sortKey))
    if (x == null && y == null) return String(a?.asset_no ?? '').localeCompare(String(b?.asset_no ?? ''))
    if (x == null) return 1
    if (y == null) return -1
    return (y - x) * dir || String(a?.asset_no ?? '').localeCompare(String(b?.asset_no ?? ''))
  })
}

// ── Spend by year ────────────────────────────────────────────────────────────
/**
 * One machine's spend by year as ordered { year, spend } buckets. The
 * reliability engine's own reader is used where it exists (it already handles
 * the nested row shape and the junk year keys); the local read is the fallback.
 */
export function yearBuckets(row) {
  const fn = rel('spendByYear')
  if (fn) {
    try {
      const out = fn(row)
      if (Array.isArray(out)) return out.filter((e) => e && num(e.year) != null && num(e.spend) != null)
    } catch { /* fall through to the local read */ }
  }
  const raw = (row?.reliability && row.reliability.spend_by_year) || row?.spend_by_year
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw)
    .map(([y, v]) => ({ year: num(y), spend: num(v) }))
    .filter((e) => e.year != null && e.year >= 1900 && e.year <= 2200 && e.spend != null)
    .sort((a, b) => a.year - b.year)
}

/** Ordered numeric years present across every row in scope. */
export function spendYearsOf(rows) {
  const set = new Set()
  for (const r of rows || []) for (const e of yearBuckets(r)) set.add(Math.round(e.year))
  return [...set].sort((a, b) => a - b)
}
/** One machine's spend in one year, or null when it has no entry for it. */
export function spendIn(row, year) {
  const hit = yearBuckets(row).find((e) => Math.round(e.year) === Math.round(year))
  return hit ? hit.spend : null
}

/**
 * The latest year the whole of which has actually happened. A part year still in
 * progress must never be compared against a full one, and must never be the year
 * a committee is told a machine "still cost money" in without that being said.
 */
export function latestFullYear(rows, now = new Date()) {
  const years = spendYearsOf(rows)
  if (!years.length) return null
  const nowYear = (now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()).getFullYear()
  const candidates = years.filter((y) => y < nowYear)
  return candidates.length ? candidates[candidates.length - 1] : null
}

export function spendTrendData(rows, { years = 0, now = new Date() } = {}) {
  const all = spendYearsOf(rows)
  const shown = years > 0 ? all.slice(-years) : all
  const values = shown.map((y) => (rows || []).reduce((a, r) => a + (spendIn(r, y) ?? 0), 0))
  return { years: shown, values, allYears: all, latestFull: latestFullYear(rows, now) }
}

// ── Maintenance mix ──────────────────────────────────────────────────────────
export const MIX_PARTS = [
  { key: 'emergency_cards', label: 'Emergency' },
  { key: 'repair_cards', label: 'Repair' },
  { key: 'preventive_cards', label: 'Planned service' },
]

// ── Board recommendations ────────────────────────────────────────────────────
// The reliability engine's four level ladder, kept verbatim rather than folded
// into three: collapsing "act now" into "high" throws away the one distinction a
// committee actually acts on.
export const RECOMMENDATION_PRIORITIES = (() => {
  const p = relConst('PRIORITIES')
  const keys = p && typeof p === 'object' ? Object.keys(p) : []
  return keys.length ? keys : ['critical', 'high', 'medium', 'info']
})()
const PRIORITY_ALIAS = {
  critical: 'critical', urgent: 'critical', act_now: 'critical', p1: 'critical', '1': 'critical',
  high: 'high', p2: 'high', '2': 'high',
  medium: 'medium', med: 'medium', normal: 'medium', p3: 'medium', '3': 'medium',
  info: 'info', low: 'info', minor: 'info', p4: 'info', '4': 'info',
}
export function normPriority(v) {
  const k = PRIORITY_ALIAS[String(v ?? '').trim().toLowerCase()]
  if (k && RECOMMENDATION_PRIORITIES.includes(k)) return k
  return RECOMMENDATION_PRIORITIES.includes('medium') ? 'medium' : RECOMMENDATION_PRIORITIES[0]
}
/** The engine's own label for a priority, so the deck cannot rename its ladder. */
export function priorityLabel(p) {
  const fn = rel('priorityMeta')
  if (fn) {
    try {
      const meta = fn(p)
      if (meta && typeof meta.label === 'string' && meta.label.trim()) return ascii(meta.label.trim())
    } catch { /* fall through */ }
  }
  return fmtText(p)
}

/**
 * Fold whatever the reliability engine returns into the deck's shape. Its own
 * recommendations carry { headline, detail, evidence:[lines], assets:[codes] };
 * every reasonable alternative naming is accepted too. A recommendation with no
 * text at all is dropped rather than shown as an empty bullet.
 */
function shapeRecommendations(list) {
  if (!Array.isArray(list)) return []
  const lines = (v) => {
    if (Array.isArray(v)) return v.map((x) => ascii(typeof x === 'string' ? x : (x?.text ?? '')).trim()).filter(Boolean)
    const s = ascii(v ?? '').trim()
    return s ? [s] : []
  }
  return list.map((r) => {
    if (r == null) return null
    if (typeof r === 'string') return { priority: normPriority(null), title: ascii(r), detail: '', evidence: [], assets: [] }
    const title = ascii(r.headline ?? r.title ?? r.text ?? r.message ?? r.label ?? r.action ?? '').trim()
    if (!title) return null
    const assets = Array.isArray(r.assets)
      ? r.assets.map((a) => fmtText(typeof a === 'object' ? a?.asset_no : a)).filter((a) => a !== 'N/A')
      : []
    return {
      priority: normPriority(r.priority ?? r.severity ?? r.level),
      title,
      detail: ascii(r.detail ?? r.body ?? r.because ?? '').trim(),
      evidence: lines(r.evidence ?? r.basis ?? r.note),
      assets,
    }
  }).filter(Boolean)
}

/**
 * FALLBACK ONLY. Used when the reliability engine's boardRecommendations is not
 * available. Every line is a straight read of figures already on the rows, and
 * every one names them - a recommendation a committee cannot check is worse than
 * no recommendation. Nothing here quantifies a saving: this list carries no
 * valuation, so a saving would be invented.
 */
export function localRecommendations(rows, totals, { currency = 'SAR', now = new Date() } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean)
  if (!list.length) return []
  const f = fleetReliabilityFor(list)
  const out = []
  const P = (k) => (RECOMMENDATION_PRIORITIES.includes(k) ? k : RECOMMENDATION_PRIORITIES[0])
  const names = (arr, n = 4) => {
    const codes = arr.slice(0, n).map((r) => fmtText(r.asset_no))
    return codes.join(', ') + (arr.length > n ? ` and ${arr.length - n} more` : '')
  }
  const add = (priority, title, detail, assets = []) => out.push({
    priority: P(priority), title: ascii(title), detail: ascii(detail), evidence: [], assets,
  })

  const active = list.filter(stillActive)
  if (active.length) {
    add('critical',
      'Approve the write off so the register stops reporting these as working machines.',
      `${formatMetric(active.length, 'int')} of ${formatMetric(list.length, 'int')} are still marked Active in the fleet register: ${names(active)}.`,
      active.map((r) => fmtText(r.asset_no)))
  }

  const noReg = list.filter(notInRegister)
  if (noReg.length) {
    add('high',
      'Settle the register records that do not exist, alongside the disposal decision.',
      `${formatMetric(noReg.length, 'int')} machines have no fleet register record at all: ${names(noReg, 6)}.`,
      noReg.map((r) => fmtText(r.asset_no)))
  }

  const latest = latestFullYear(list, now)
  if (latest != null) {
    const stillSpending = list
      .filter((r) => (spendIn(r, latest) ?? 0) > 0)
      .sort((a, b) => (spendIn(b, latest) ?? 0) - (spendIn(a, latest) ?? 0))
    if (stillSpending.length) {
      const totalLatest = stillSpending.reduce((a, r) => a + (spendIn(r, latest) ?? 0), 0)
      add('critical',
        `Stop spending on machines proposed for write off. ${formatMetric(stillSpending.length, 'int')} still absorbed money in ${latest}.`,
        `${formatMetric(totalLatest, 'money', currency)} was booked against them in ${latest}, the latest full year, led by ${fmtText(stillSpending[0].asset_no)} at ${formatMetric(spendIn(stillSpending[0], latest), 'money', currency)}.`,
        stillSpending.map((r) => fmtText(r.asset_no)))
    }
  }

  if (f.preventive_share_pct != null && f.preventive_share_pct < 10 && f.job_cards) {
    add('high',
      'Treat the planned maintenance share as a management finding, not an asset finding.',
      `Planned services are ${formatMetric(f.preventive_share_pct, 'pct1')} of ${formatMetric(f.job_cards, 'int')} job cards (${formatMetric(f.preventive_cards, 'int')} of them). Maintenance on these machines was almost entirely reactive, and that is a decision about the whole fleet rather than about these machines.`)
  }

  const neverPlanned = list.filter((r) => hasReliability(r) && num(readField(r, 'preventive_cards')) === 0)
  if (neverPlanned.length) {
    add('medium',
      'Put every retained machine of these classes on a service schedule.',
      `${formatMetric(neverPlanned.length, 'int')} machines on this list were never serviced to a schedule: ${names(neverPlanned)}.`,
      neverPlanned.map((r) => fmtText(r.asset_no)))
  }

  const idle = list.filter((r) => (num(readField(r, 'idle_days')) ?? -1) > LONG_IDLE_DAYS)
    .sort((a, b) => (num(readField(b, 'idle_days')) ?? 0) - (num(readField(a, 'idle_days')) ?? 0))
  if (idle.length) {
    add('medium',
      'Release the yard space and the standing costs on machines nothing has touched for over a year.',
      `${formatMetric(idle.length, 'int')} have had no job card of any kind for more than ${LONG_IDLE_DAYS} days, the longest ${fmtText(idle[0].asset_no)} at ${formatMetric(readField(idle[0], 'idle_days'), 'int')} days.`,
      idle.map((r) => fmtText(r.asset_no)))
  }

  const worstHours = worstBy(list, 'breakdown_hours', { limit: 3 })
  if (worstHours.length && (num(readField(worstHours[0], 'breakdown_hours')) ?? 0) > 0) {
    add('medium',
      'Take the heaviest repair burden off the workshop first.',
      `${fmtText(worstHours[0].asset_no)} alone carries ${formatMetric(readField(worstHours[0], 'breakdown_hours'), 'int')} breakdown hours across ${formatMetric(readField(worstHours[0], 'failures'), 'int')} failures, parked cards excluded.`,
      worstHours.map((r) => fmtText(r.asset_no)))
  }

  const tyres = list.reduce((a, r) => a + assetTyres(r).length, 0)
  if (tyres > 0) {
    add('medium',
      'Recover the fitted tyres before any machine leaves site.',
      `${formatMetric(tyres, 'int')} serial numbered tyres are still fitted across ${formatMetric(countWhere(list, (r) => assetTyres(r).length > 0), 'int')} machines.`)
  }

  if (f.date_coverage_pct != null && f.date_coverage_pct < 90) {
    add('info',
      'Fix the job card dating in the ERP before the next disposal round.',
      `Only ${formatMetric(f.date_coverage_pct, 'pct1')} of job cards carry a usable date, so MTBF, availability and idle days rest on that half of the history.`)
  }

  const unvalued = list.filter((r) => !isValued(r)).length
  if (unvalued > 0) {
    add('info',
      'Commission a valuation before any resale figure is quoted.',
      `${formatMetric(unvalued, 'int')} of ${formatMetric(list.length, 'int')} machines carry no valuation, so this deck quotes no recovery figure at all.`)
  }
  return out
}

/** Recommendations for the deck: the engine's when it has them, else the local read. */
export function recommendationsFor(rows, totals, { currency = 'SAR', now = new Date(), fleetBaseline = null } = {}) {
  const fn = rel('boardRecommendations')
  if (fn) {
    try {
      // `totals` is deliberately NOT forwarded: the engine expects its own fleet
      // roll up there, not the disposal register's totals, and handing it the
      // wrong shape would have it read every figure as missing. Passing null
      // makes it recompute from the same rows. `now` goes over as epoch ms,
      // which is what its own default is.
      const shaped = shapeRecommendations(fn(rows, null, {
        now: now instanceof Date ? now.getTime() : Date.now(),
        currency,
        fleetBaseline,
      }))
      if (shaped.length) return shaped
    } catch { /* fall through to the local reading */ }
  }
  return localRecommendations(rows, totals, { currency, now })
}

// ── Fleet baseline comparison ────────────────────────────────────────────────
/**
 * The comparison against the machines that are STAYING in service. Optional: the
 * page supplies it from get_asset_disposal_fleet_baseline, and every other block
 * renders unchanged when it is absent.
 *
 * The slide has to say two things at once, because either alone misleads a
 * committee: the list is justified, AND writing it off barely dents the bill.
 */
const BASELINE_ROWS = [
  { key: 'assets', label: 'Machines', format: 'int', ratio: false },
  { key: 'breakdown_hours_per_asset', label: 'Breakdown hours per machine', format: 'int', ratio: true, trust: true },
  { key: 'spend_per_asset', label: 'Spend per machine', format: 'money', ratio: true, trust: true },
  { key: 'preventive_share_pct', label: 'Planned maintenance share', format: 'pct1', ratio: false },
  { key: 'avg_availability_pct', label: 'Availability', format: 'pct1', ratio: false },
  { key: 'avg_failures_per_year', label: 'Failures per machine per year', format: 'dec1', ratio: true, confounded: true },
  { key: 'spend', label: 'Total spend', format: 'money', ratio: false },
]

/**
 * Both sides of the comparison. The reliability engine's own `baselineComparison`
 * is used where it exists, so its ratios, shares, the metric it names as
 * trustworthy and its confound wording are the SAME ones every other reliability
 * surface shows. The local read below is only a fallback for a partial engine.
 */
function baselineSides(baseline) {
  const fn = rel('baselineComparison')
  if (fn) {
    try {
      const cmp = fn(baseline)
      if (cmp && cmp.onList && cmp.rest) return { on: cmp.onList, rest: cmp.rest, engine: cmp }
    } catch { /* fall through to the local read */ }
  }
  const b = baseline && typeof baseline === 'object' && baseline.ok !== false ? baseline : {}
  const on = b.on_list ?? b.onList
  const rest = b.rest_of_fleet ?? b.restOfFleet
  if (!on || typeof on !== 'object' || !rest || typeof rest !== 'object') return null
  return { on, rest, engine: null }
}

/**
 * Shape the baseline for a slide. Returns null when there is nothing usable, so
 * the block can say it could not be produced instead of drawing a blank table.
 */
export function fleetComparison(baseline, currency = 'SAR') {
  const sides = baselineSides(baseline)
  if (!sides) return null
  const { on, rest, engine: cmp } = sides
  // The engine names the one measure idleness cannot flatter. The deck must not
  // pick a different one, or two surfaces argue from different numbers.
  const trustKey = (cmp && typeof cmp.trust === 'string' && cmp.trust) || 'breakdown_hours_per_asset'
  const metrics = BASELINE_ROWS.map((m) => {
    const a = num(on[m.key])
    const b = num(rest[m.key])
    const engineRatio = cmp && cmp.ratios ? num(cmp.ratios[m.key]) : null
    const ratio = m.ratio ? (engineRatio ?? (a != null && b != null && b !== 0 ? a / b : null)) : null
    return {
      key: m.key, label: m.label,
      onList: formatMetric(a, m.format, currency),
      rest: formatMetric(b, m.format, currency),
      ratio: ratio == null ? '' : formatMetric(ratio, 'ratio'),
      trust: m.key === trustKey, confounded: !!m.confounded,
      onNum: a, restNum: b, ratioNum: ratio,
    }
  })
  const by = Object.fromEntries(metrics.map((m) => [m.key, m]))
  const totalSpend = (num(on.spend) ?? 0) + (num(rest.spend) ?? 0)
  const engineShare = cmp && cmp.shares ? num(cmp.shares.spend) : null
  const share = engineShare ?? (totalSpend > 0 && num(on.spend) != null ? (num(on.spend) / totalSpend) * 100 : null)

  const headlines = []
  const justif = []
  if (by.spend_per_asset?.ratioNum != null) justif.push(`${by.spend_per_asset.onList} per machine against ${by.spend_per_asset.rest} across the rest of the fleet (${by.spend_per_asset.ratio})`)
  if (by.breakdown_hours_per_asset?.ratioNum != null) justif.push(`${by.breakdown_hours_per_asset.onList} breakdown hours per machine against ${by.breakdown_hours_per_asset.rest} (${by.breakdown_hours_per_asset.ratio})`)
  if (justif.length) headlines.push({ tone: 'case', text: ascii(`The list is justified: ${justif.join(', and ')}.`) })

  if (share != null) {
    const rest2 = []
    if (num(rest.assets) != null) rest2.push(`${formatMetric(rest.assets, 'int')} machines stay in service`)
    if (num(rest.avg_failures_per_year) != null) rest2.push(`averaging ${formatMetric(rest.avg_failures_per_year, 'dec1')} failures a year`)
    if (num(rest.avg_availability_pct) != null) rest2.push(`at ${formatMetric(rest.avg_availability_pct, 'pct1')} availability`)
    if (num(rest.preventive_share_pct) != null) rest2.push(`on ${formatMetric(rest.preventive_share_pct, 'pct1')} planned maintenance`)
    headlines.push({
      tone: 'limit',
      text: ascii(`And it barely dents the bill: ${formatMetric(on.spend, 'money', currency)} of ${formatMetric(totalSpend, 'money', currency)}, about ${formatMetric(share, 'pct1')} of maintenance spend. ${rest2.join(', ')}.`),
    })
  }

  // The confound is stated, never corrected. An adjustment nobody can check is
  // worse than a caveat everybody can read. The engine's own wording wins where
  // it has one, so the deck and the page make the identical caveat.
  const fewerFailures = by.avg_failures_per_year?.onNum != null && by.avg_failures_per_year?.restNum != null
    && by.avg_failures_per_year.onNum < by.avg_failures_per_year.restNum
  const engineConfound = cmp && typeof cmp.confoundNote === 'string' ? ascii(cmp.confoundNote).trim() : ''
  const confound = engineConfound || ascii(
    (fewerFailures
      ? 'Machines on this list average FEWER failures a year than the rest of the fleet. That reads backwards until you notice how many are parked, and a machine standing still cannot fail. '
      : 'Many machines on this list are parked, and a machine standing still cannot fail, so any per year rate on this list is flattered by idleness. ')
    + 'Breakdown hours per machine is the measure idleness does not flatter, so read that one. Neither figure has been adjusted: a correction nobody can check is worse than a stated confound.',
  )

  return {
    metrics, headlines, confound,
    share, totalSpend,
    country: fmtText(baseline?.country),
    note: ascii((cmp && cmp.note) || baseline?.note || ''),
    onLabel: 'On this list', restLabel: 'Rest of the fleet',
  }
}

// ── Reliability KPI catalog ──────────────────────────────────────────────────
/**
 * The fleet strip. Every tile reads the fleet aggregate computed above, so the
 * strip, the table and the recommendations cannot disagree. A tile with no
 * measurement prints "Not measured" and says why in its note.
 */
export const RELIABILITY_KPI_ITEMS = {
  breakdown_hours: {
    label: 'Breakdown hours',
    get: (f) => formatMetric(f.breakdown_hours, 'int'),
    note: (f) => (f.parked_hours ? `Parked cards excluded. A further ${formatMetric(f.parked_hours, 'int')} parked hours sit outside this.` : 'Time under repair, from the job card history.'),
  },
  parked_hours: {
    label: 'Parked hours (not downtime)',
    get: (f) => formatMetric(f.parked_hours, 'int'),
    note: (f) => `On ${formatMetric(f.parked_cards, 'int')} cards left open while the machine stood still. Never counted as repair time.`,
  },
  failures: {
    label: 'Failures on record',
    get: (f) => formatMetric(f.failures, 'int'),
    note: () => 'Job cards raised against a breakdown rather than a planned service.',
  },
  job_cards: {
    label: 'Job cards',
    get: (f) => formatMetric(f.job_cards, 'int'),
    note: (f) => `${formatMetric(f.dated_cards, 'int')} of them carry a usable date.`,
  },
  median_mtbf: {
    label: 'Median MTBF',
    get: (f) => (f.median_mtbf_days == null ? NOT_MEASURED : `${formatMetric(f.median_mtbf_days, 'dec1')} days`),
    note: () => 'Half the machines fail more often than this. Measured on the dated job cards.',
  },
  low_availability: {
    label: `Under ${AVAILABILITY_FLOOR}% available`,
    get: (f) => (f.low_availability == null ? NOT_MEASURED : formatMetric(f.low_availability, 'int')),
    note: (f) => `Of ${formatMetric(f.availability_measured, 'int')} machines where availability could be measured.`,
  },
  never_preventive: {
    label: 'Never planned serviced',
    get: (f) => (f.never_preventive == null ? NOT_MEASURED : formatMetric(f.never_preventive, 'int')),
    note: (f) => `Of ${formatMetric(f.assets_with_history, 'int')} machines that carry any history. Not one planned service on record.`,
  },
  long_idle: {
    label: `Idle over ${LONG_IDLE_DAYS} days`,
    get: (f) => (f.long_idle == null ? NOT_MEASURED : formatMetric(f.long_idle, 'int')),
    note: () => 'No job card of any kind in more than a year.',
  },
  preventive_share: {
    label: 'Planned maintenance share',
    get: (f) => formatMetric(f.preventive_share_pct, 'pct1'),
    note: (f) => `${formatMetric(f.preventive_cards, 'int')} planned services out of ${formatMetric(f.job_cards, 'int')} job cards. A management finding, not an asset one.`,
  },
  date_coverage: {
    label: 'Job card date coverage',
    get: (f) => formatMetric(f.date_coverage_pct, 'pct1'),
    note: () => 'MTBF, failure rate, idle days and availability rest on this share of the history.',
  },
  cost_per_breakdown_hour: {
    label: 'Cost per breakdown hour',
    get: (f, cur) => formatMetric(f.cost_per_breakdown_hour, 'money2', cur),
    note: () => 'Lifetime spend over breakdown hours, parked cards excluded.',
  },
  reliability_spend: {
    label: 'Lifetime spend',
    money: true,
    get: (f, cur) => formatMetric(f.spend, 'money', cur),
    note: () => 'Maintenance and parts booked against these machines to date.',
  },
}
export const RELIABILITY_KPI_KEYS = Object.keys(RELIABILITY_KPI_ITEMS)
const DEFAULT_RELIABILITY_KPIS = ['breakdown_hours', 'parked_hours', 'failures', 'median_mtbf', 'low_availability', 'never_preventive', 'long_idle', 'preventive_share', 'date_coverage']

// ═════════════════════════════════════════════════════════════════════════════
// REPLACEMENT COST
// ═════════════════════════════════════════════════════════════════════════════
// A supplier quotation is the first hard price this fleet has, and it is what
// turns "this machine has cost us a lot" into "this machine has cost us N% of a
// new one" - the sentence a committee can vote on.
//
// The maths is the pure `assetReplacement` engine. This section owns only how it
// is PRESENTED, and the two statements that must travel with it:
//   a) the exposure figure covers the PRICED machines and nothing else. The
//      unpriced count and the classes they sit in are on the same slide, or a
//      partial total reads as the cost of replacing the list.
//   b) a quotation past its validity date is shown WITH its lapsed label. It is
//      the last price the supplier put in writing, which beats no price at all,
//      but it is not today's price and the slide must not imply that it is.
//
// Nothing here annualises the replacement over an assumed service life, and no
// depreciation, resale or scrap figure appears anywhere: none of those exists in
// this data, and the assumed life would be the largest term in all of them.
const repl = (name) => (replacementEngine && typeof replacementEngine[name] === 'function' ? replacementEngine[name] : null)

/** The status label the engine publishes, so both surfaces say the same word. */
function benchmarkStatusLabel(status) {
  const fn = repl('benchmarkStatusMeta')
  if (!fn) return ''
  try {
    const meta = fn(status)
    return meta && typeof meta.label === 'string' ? ascii(meta.label) : ''
  } catch { return '' }
}

/**
 * Replacement economics for the rows in scope, or NULL when it cannot be
 * produced (no engine, no benchmarks, or not one machine priced). Null is what
 * lets the block say so instead of drawing a table of blanks.
 */
export function replacementView(rows, benchmarks, { currency = 'SAR', now = new Date() } = {}) {
  const fn = repl('replacementTotals')
  if (!fn) return null
  const list = Array.isArray(rows) ? rows : []
  const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now()
  let totals = null
  try { totals = fn(list, benchmarks, { now: at }) } catch { return null }
  if (!totals || !totals.coveredCount) return null

  const headlines = []
  const exposure = totals.exposure || {}
  if (exposure.mixedCurrency) {
    const parts = Object.entries(exposure.byCurrency || {})
      .map(([cur, amt]) => `${formatMetric(amt, 'money', cur)}`)
    headlines.push({
      tone: 'case',
      text: ascii(`Replacing the ${formatMetric(totals.coveredCount, 'int')} priced machines: ${parts.join(' and ')}. These are different currencies and are never added together.`),
    })
  } else {
    headlines.push({
      tone: 'case',
      text: ascii(`Replacing the ${formatMetric(totals.coveredCount, 'int')} machines a quotation covers would cost ${formatMetric(exposure.total, 'money', exposure.currency || currency)} ex-VAT. VAT is recoverable and is not a cost to the business.`),
    })
  }
  // The limit statement is a headline, not a footnote. A partial exposure read
  // as the whole bill is the single worst misreading this slide can produce.
  headlines.push({
    tone: 'limit',
    text: ascii(totals.unpricedNote
      || 'Every machine on this list carries a supplier quotation, so the figure above covers all of them.'),
  })

  const covered = [...totals.covered].sort(
    (a, b) => (num(b.spendPctOfNew) ?? -1) - (num(a.spendPctOfNew) ?? -1),
  )
  const notes = []
  if (totals.expiredCount) {
    notes.push(ascii(`${formatMetric(totals.expiredCount, 'int')} of these prices rest on a quotation whose validity has lapsed. That is the last price the supplier put in writing and is still the best evidence available, but it is not today's price: requote before committing to a purchase.`))
  }
  notes.push('No service life is assumed anywhere on this slide. The replacement cost is not spread over a life, and no depreciation, resale or scrap value is quoted, because none of those figures exists in this data.')

  return { totals, covered, headlines, notes: notes.map(ascii) }
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
    description: 'One slide per machine: condition, meter, spend, job cards, its reliability record, the committee remarks verbatim, and the tyres still on it.',
    defaults: { title: '', filter: 'all', sort: 'asset_no', limit: 0, showTyres: true, showRemarks: true, showReliability: true },
  },
  reliability_kpis: {
    label: 'Reliability headline',
    description: 'The fleet strip: breakdown hours with the parked hours stated beside them, failures, MTBF, and how many machines are under target, never planned serviced or long idle.',
    defaults: { title: 'What these machines cost in downtime', items: [...DEFAULT_RELIABILITY_KPIS], filter: 'all' },
  },
  reliability_table: {
    label: 'Reliability by machine',
    description: 'Every machine against the measures the scrap workbook already uses: breakdowns, MTBF, failure rate, availability and idle days. Column selectable, paginated across slides.',
    defaults: { title: 'Reliability by machine', columns: [...DEFAULT_RELIABILITY_COLUMNS], filter: 'all', sort: 'breakdown_hours', density: 'compact', rowsPerSlide: 14, limit: 0 },
  },
  worst_offenders: {
    label: 'Worst offenders',
    description: 'The worst machines on one measure, with the figure and what it rests on. The slide a committee argues from.',
    defaults: { title: '', metric: 'breakdown_hours', limit: 8, filter: 'all' },
  },
  spend_trend: {
    label: 'Spend by year',
    description: 'What these machines cost per year. A machine still absorbing money in the latest full year while being proposed for write off is the strongest slide in the pack.',
    defaults: { title: '', scope: 'fleet', years: 6, viz: 'bar', filter: 'all', limit: 12 },
  },
  maintenance_mix: {
    label: 'Emergency vs planned',
    description: 'Emergency, repair and planned services. A planned share this low is a management finding, not an asset finding.',
    defaults: { title: '', scope: 'fleet', viz: 'doughnut', filter: 'all', limit: 14 },
  },
  replacement: {
    label: 'What a new machine costs',
    description: 'What has been spent on each machine against the price of a new one, from the supplier quotation on file. Says which machines are not priced rather than pricing them from the nearest thing.',
    defaults: { title: 'Spend against the cost of a new machine', filter: 'all', limit: 12 },
  },
  fleet_comparison: {
    label: 'Against the rest of the fleet',
    description: 'This list beside the machines staying in service. Says both things at once: the write off is justified, and it barely dents the bill.',
    defaults: { title: 'This list against the rest of the fleet' },
  },
  recommendations: {
    label: 'Recommendations',
    description: 'What the committee is being asked to do, grouped by priority, each line carrying the figures it rests on.',
    defaults: { title: 'Recommendations', priorities: [...RECOMMENDATION_PRIORITIES], limit: 0, perSlide: 3, showEvidence: true },
  },
  basis: {
    label: 'What these figures rest on',
    description: 'The parked job card exclusion and the job card date coverage, in plain English. Every reliability slide rests on both.',
    defaults: { title: 'What these figures rest on' },
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
        showReliability: b.showReliability !== false,
      }
    case 'reliability_kpis': {
      const items = (Array.isArray(b.items) ? b.items : []).filter((k) => RELIABILITY_KPI_ITEMS[k])
      return {
        ...base,
        title: strOr(b.title, 'What these machines cost in downtime'),
        items: items.length ? items.slice(0, 9) : [...DEFAULT_RELIABILITY_KPIS].slice(0, 9),
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
      }
    }
    case 'reliability_table': {
      const cols = (Array.isArray(b.columns) ? b.columns : []).filter((c) => RELIABILITY_COLUMNS[c])
      return {
        ...base,
        title: strOr(b.title, 'Reliability by machine'),
        columns: cols.length ? cols : [...DEFAULT_RELIABILITY_COLUMNS],
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
        sort: pickFrom(b.sort, RELIABILITY_COLUMN_KEYS, 'breakdown_hours'),
        density: pickFrom(b.density, ['normal', 'compact'], 'compact'),
        rowsPerSlide: clampInt(b.rowsPerSlide, 4, 24, 14),
        limit: clampInt(b.limit, 0, 1000, 0),
      }
    }
    case 'worst_offenders':
      return {
        ...base,
        title: strOr(b.title, ''),
        metric: pickFrom(b.metric, RANKABLE_METRICS, 'breakdown_hours'),
        limit: clampInt(b.limit, 3, 20, 8),
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
      }
    case 'spend_trend':
      return {
        ...base,
        title: strOr(b.title, ''),
        scope: pickFrom(b.scope, ['fleet', 'per_asset'], 'fleet'),
        years: clampInt(b.years, 0, 20, 6),
        viz: pickFrom(b.viz, ['bar', 'line'], 'bar'),
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
        limit: clampInt(b.limit, 0, 200, 12),
      }
    case 'maintenance_mix':
      return {
        ...base,
        title: strOr(b.title, ''),
        scope: pickFrom(b.scope, ['fleet', 'per_asset'], 'fleet'),
        viz: pickFrom(b.viz, ['doughnut', 'bar', 'bar_h'], 'doughnut'),
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
        limit: clampInt(b.limit, 0, 200, 14),
      }
    case 'replacement':
      return {
        ...base,
        title: strOr(b.title, 'Spend against the cost of a new machine'),
        filter: pickFrom(b.filter, ROW_FILTERS.map((f) => f.key), 'all'),
        limit: clampInt(b.limit, 0, 200, 12),
      }
    case 'fleet_comparison':
      return { ...base, title: strOr(b.title, 'This list against the rest of the fleet') }
    case 'recommendations': {
      const pr = (Array.isArray(b.priorities) ? b.priorities : []).filter((p) => RECOMMENDATION_PRIORITIES.includes(p))
      return {
        ...base,
        title: strOr(b.title, 'Recommendations'),
        priorities: pr.length ? pr : [...RECOMMENDATION_PRIORITIES],
        limit: clampInt(b.limit, 0, 40, 0),
        perSlide: clampInt(b.perSlide, 1, 8, 3),
        showEvidence: b.showEvidence !== false,
      }
    }
    case 'basis':
      return { ...base, title: strOr(b.title, 'What these figures rest on') }
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
  ceo_briefing: {
    key: 'ceo_briefing',
    label: 'CEO briefing',
    description: 'The short version for the top of the table: what these machines cost in downtime, what to do about it, the worst of them, the money still going in, and what the figures rest on.',
    build: () => [
      makeBlock('title', { title: 'Asset Disposal Briefing', subtitle: 'What these machines cost, and what to do about it' }),
      makeBlock('reliability_kpis'),
      makeBlock('recommendations'),
      makeBlock('fleet_comparison'),
      makeBlock('replacement'),
      makeBlock('worst_offenders', { metric: 'breakdown_hours', limit: 8 }),
      makeBlock('spend_trend', { scope: 'fleet', viz: 'bar' }),
      makeBlock('maintenance_mix', { scope: 'fleet', viz: 'doughnut' }),
      makeBlock('basis'),
    ],
  },
  reliability_case: {
    key: 'reliability_case',
    label: 'Reliability case',
    description: 'The full engineering argument for the write off: downtime, failure rate, availability, idle time, the money still going in, and every machine measured against the rest.',
    build: () => [
      makeBlock('title', { title: 'The Case for Write Off', subtitle: 'Reliability and cost evidence' }),
      makeBlock('reliability_kpis'),
      makeBlock('findings'),
      makeBlock('fleet_comparison'),
      makeBlock('divider', { label: 'Machine by machine' }),
      makeBlock('reliability_table'),
      makeBlock('worst_offenders', { metric: 'failures_per_year', limit: 10 }),
      makeBlock('worst_offenders', { metric: 'availability_pct', limit: 10 }),
      makeBlock('worst_offenders', { metric: 'idle_days', limit: 10 }),
      makeBlock('divider', { label: 'The money' }),
      makeBlock('spend_trend', { scope: 'fleet', viz: 'bar' }),
      makeBlock('spend_trend', { scope: 'per_asset', limit: 14 }),
      makeBlock('maintenance_mix', { scope: 'per_asset', limit: 14 }),
      makeBlock('recommendations'),
      makeBlock('basis'),
    ],
  },
  board: {
    key: 'board',
    label: 'Board summary',
    description: 'Headline only, for a board that wants the ask and not the detail: the counts, what the list shows, and what a new machine costs.',
    build: () => [
      makeBlock('title', { title: 'Asset Disposal Summary', subtitle: 'Board briefing' }),
      makeBlock('summary_kpis', { items: ['assets', 'to_scrap', 'to_sell', 'lifetime_spend', 'still_active', 'estimated_value'] }),
      makeBlock('findings'),
      makeBlock('replacement', { limit: 10 }),
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
        showReliability: b.showReliability, index: i + 1, count: scoped.length, titleOverride: b.title,
      }))
      return { kind: 'multi', id: b.id, slides }
    }

    // ── Reliability ────────────────────────────────────────────────────────
    case 'reliability_kpis': {
      const scoped = filterRows(rows, b.filter)
      const f = fleetReliabilityFor(scoped)
      const items = b.items.map((k) => {
        const def = RELIABILITY_KPI_ITEMS[k]
        const value = ascii(def.get(f, currency))
        return {
          key: k, label: ascii(def.label), value,
          note: ascii(typeof def.note === 'function' ? def.note(f, currency) : (def.note || '')),
          // A tile that could not be measured is toned like a caveat, not like a
          // reading, so nobody takes "Not measured" for a low score.
          unmeasured: value === NOT_MEASURED,
        }
      })
      return {
        kind: 'kpis', id: b.id, title: fmtText(b.title), items,
        notes: reliabilityBasisNotes(scoped, { fleet: f }),
        empty: scoped.length === 0 || !hasAnyReliability(scoped),
        emptyNote: scoped.length === 0
          ? `No assets match ${filterLabel(b.filter).toLowerCase()}, so there is no reliability record to report.`
          : 'No maintenance history is recorded against these machines, so nothing here can be measured.',
      }
    }

    case 'reliability_table': {
      let scoped = sortReliabilityRows(filterRows(rows, b.filter), b.sort)
      const matched = scoped.length
      if (b.limit > 0) scoped = scoped.slice(0, b.limit)
      const columns = b.columns.map((c) => ({
        key: c, header: metricLabel(c),
        align: RELIABILITY_COLUMNS[c].align || 'left',
        width: RELIABILITY_COLUMNS[c].width || 1,
      }))
      // Peers for banding are the WHOLE filtered set, not the page, or the same
      // machine would band differently depending on which slide it landed on.
      const peers = Object.fromEntries(b.columns.map((c) => [c, vals(filterRows(rows, b.filter), c)]))
      const body = scoped.map((r) => columns.map((c) => ascii(formatMetric(readField(r, c.key), RELIABILITY_COLUMNS[c.key].format, currency))))
      const bands = scoped.map((r) => columns.map((c) => bandFor(c.key, readField(r, c.key), peers[c.key])))
      const per = b.rowsPerSlide
      const pages = Math.max(1, Math.ceil(body.length / per))
      const sortCol = RELIABILITY_COLUMNS[b.sort] || RELIABILITY_COLUMNS.asset_no
      const notes = [`Showing ${fmtNum(body.length)} of ${fmtNum(rows.length)} machines, worst ${sortCol.header.toLowerCase()} first`]
      if (b.filter !== 'all') notes.push(`filter: ${filterLabel(b.filter)}`)
      if (b.limit > 0 && matched > b.limit) notes.push(`top ${fmtNum(b.limit)}`)
      const caption = ascii(notes.join(' | '))
      const basis = reliabilityBasisNotes(filterRows(rows, b.filter))
      const slides = []
      for (let p = 0; p < pages; p++) {
        slides.push({
          kind: 'table', id: `${b.id}_p${p}`,
          title: fmtText(b.title) + (pages > 1 ? ` (${p + 1} of ${pages})` : ''),
          columns,
          rows: body.slice(p * per, (p + 1) * per),
          cellBands: bands.slice(p * per, (p + 1) * per),
          caption, density: b.density, page: p + 1, pages,
          // Both caveats ride on the slide itself. A reliability table forwarded
          // without them is the misreading this deck exists to prevent.
          notes: basis,
          empty: body.length === 0,
          emptyNote: `No assets match ${filterLabel(b.filter).toLowerCase()}.`,
        })
      }
      return { kind: 'multi', id: b.id, slides }
    }

    case 'worst_offenders': {
      const scoped = filterRows(rows, b.filter)
      const col = RELIABILITY_COLUMNS[b.metric]
      const ranked = worstBy(scoped, b.metric, { limit: b.limit })
      const worstLow = col.worstHigh === false
      const columns = [
        { key: 'rank', header: '#', align: 'right', width: 0.4 },
        { key: 'asset_no', header: 'Asset', align: 'left', width: 1 },
        { key: 'asset_type', header: 'Type', align: 'left', width: 1.4 },
        { key: 'metric', header: col.header, align: 'right', width: 1.1 },
        { key: 'basis', header: 'What it rests on', align: 'left', width: 3.2 },
      ]
      const basisFor = (r) => {
        const bits = []
        const g = (k) => readField(r, k)
        if (num(g('failures')) != null) bits.push(`${formatMetric(g('failures'), 'int')} failures`)
        if (num(g('job_cards')) != null) bits.push(`${formatMetric(g('job_cards'), 'int')} job cards`)
        if (num(g('dated_cards')) != null && num(g('job_cards'))) bits.push(`${formatMetric(g('dated_cards'), 'int')} dated`)
        if (num(g('spend')) != null) bits.push(formatMetric(g('spend'), 'money', currency))
        if (num(g('parked_hours')) != null && num(g('parked_hours')) > 0) bits.push(`${formatMetric(g('parked_hours'), 'int')} parked hrs excluded`)
        return bits.length ? bits.join(', ') : 'No supporting history recorded'
      }
      const body = ranked.map((r, i) => [
        String(i + 1), fmtText(r.asset_no), fmtText(r.asset_type),
        ascii(formatMetric(readField(r, b.metric), col.format, currency)),
        ascii(basisFor(r)),
      ])
      const title = b.title || `Worst ${col.header.toLowerCase()}`
      const measured = scoped.filter((r) => num(readField(r, b.metric)) != null).length
      const caption = ascii(
        `${worstLow ? 'Lowest' : 'Highest'} ${col.header.toLowerCase()} first. `
        + `Measured on ${fmtNum(measured)} of ${fmtNum(scoped.length)} machines; the rest carry no figure and are left out rather than ranked as zero.`,
      )
      return {
        kind: 'table', id: b.id, title: fmtText(title), columns, rows: body,
        caption, density: 'normal', page: 1, pages: 1,
        notes: [col.note ? ascii(col.note) : '', ...reliabilityBasisNotes(scoped, {
          hours: b.metric === 'breakdown_hours' || b.metric === 'cost_per_breakdown_hour',
          dated: ['mtbf_days', 'failures_per_year', 'availability_pct', 'idle_days'].includes(b.metric),
        })].filter(Boolean),
        empty: body.length === 0,
        emptyNote: scoped.length === 0
          ? `No assets match ${filterLabel(b.filter).toLowerCase()}.`
          : `${col.header} is not measured on any machine in this cut, so there is nothing to rank.`,
      }
    }

    case 'spend_trend': {
      const scoped = filterRows(rows, b.filter)
      const now = ctx.now instanceof Date ? ctx.now : new Date()
      const t = spendTrendData(scoped, { years: b.years, now })
      const latestNote = t.latestFull == null
        ? 'No completed year of spend is recorded against these machines.'
        : (() => {
          const still = scoped.filter((r) => (spendIn(r, t.latestFull) ?? 0) > 0)
          const amt = still.reduce((a, r) => a + (spendIn(r, t.latestFull) ?? 0), 0)
          return still.length
            ? `${fmtNum(still.length)} of these machines were still absorbing money in ${t.latestFull}, the latest full year: ${formatMetric(amt, 'money', currency)}.`
            : `Nothing was booked against these machines in ${t.latestFull}, the latest full year.`
        })()

      if (b.scope === 'fleet') {
        return {
          kind: 'chart', id: b.id,
          title: fmtText(b.title || 'Spend by year'),
          viz: b.viz, source: 'spend_trend', metric: 'spend',
          labels: t.years.map((y) => String(y)),
          values: t.values,
          digest: t.years.length ? `Total: ${formatMetric(t.values.reduce((a, v) => a + v, 0), 'money', currency)} | Latest full year: ${t.latestFull == null ? NOT_MEASURED : `${t.latestFull} ${formatMetric(t.values[t.years.indexOf(t.latestFull)] ?? null, 'money', currency)}`}` : '',
          note: ascii(latestNote),
          money: true, currency,
          empty: t.years.length === 0,
          emptyNote: scoped.length === 0
            ? `No assets match ${filterLabel(b.filter).toLowerCase()}.`
            : 'No year by year spend is recorded against these machines.',
        }
      }

      // Per machine: a table reads far better than a wall of small charts, and it
      // puts the latest full year in its own column where it can be argued from.
      const years = t.years
      const withSpend = scoped
        .map((r) => ({ row: r, latest: t.latestFull == null ? null : (spendIn(r, t.latestFull) ?? 0) }))
        .sort((a, b2) => (b2.latest ?? -1) - (a.latest ?? -1)
          || (num(b2.row?.spend) ?? 0) - (num(a.row?.spend) ?? 0))
      const shown = b.limit > 0 ? withSpend.slice(0, b.limit) : withSpend
      const columns = [
        { key: 'asset_no', header: 'Asset', align: 'left', width: 1 },
        { key: 'asset_type', header: 'Type', align: 'left', width: 1.4 },
        ...years.map((y) => ({ key: `y${y}`, header: String(y), align: 'right', width: 0.85 })),
        { key: 'total', header: 'Total', align: 'right', width: 1.1 },
      ]
      const body = shown.map(({ row }) => [
        fmtText(row.asset_no), fmtText(row.asset_type),
        ...years.map((y) => {
          const v = spendIn(row, y)
          // A year with no entry is left blank rather than printed as SAR 0: the
          // machine may simply not have been on the books that year.
          return v == null ? '' : ascii(formatMetric(v, 'money', currency))
        }),
        ascii(formatMetric(num(row.spend), 'money', currency)),
      ])
      return {
        kind: 'table', id: b.id,
        title: fmtText(b.title || 'Spend by year, machine by machine'),
        columns, rows: body, density: 'compact', page: 1, pages: 1,
        caption: ascii(`Ordered by ${t.latestFull == null ? 'lifetime spend' : `${t.latestFull} spend`}. Showing ${fmtNum(body.length)} of ${fmtNum(scoped.length)} machines. A blank year means nothing was booked, not a zero cost year.`),
        notes: [ascii(latestNote)],
        empty: body.length === 0 || years.length === 0,
        emptyNote: scoped.length === 0
          ? `No assets match ${filterLabel(b.filter).toLowerCase()}.`
          : 'No year by year spend is recorded against these machines.',
      }
    }

    case 'maintenance_mix': {
      const scoped = filterRows(rows, b.filter)
      const f = fleetReliabilityFor(scoped)
      const base = fleetComparison(ctx.fleetBaseline, currency)
      const restShare = base ? base.metrics.find((m) => m.key === 'preventive_share_pct') : null
      const mgmt = f.preventive_share_pct == null
        ? 'The planned maintenance share could not be measured on this list.'
        : `Planned services are ${formatMetric(f.preventive_share_pct, 'pct1')} of ${formatMetric(f.job_cards, 'int')} job cards`
          + (restShare && restShare.restNum != null ? `, against ${restShare.rest} across the machines staying in service` : '')
          + '. At that level it is not an observation about these machines, it is the reason the next batch will end up here. That is a management decision, not a disposal one.'

      if (b.scope === 'fleet') {
        const parts = MIX_PARTS.map((p) => ({ label: p.label, value: num(f[p.key]) }))
        const known = parts.filter((p) => p.value != null)
        return {
          kind: 'chart', id: b.id,
          title: fmtText(b.title || 'Emergency, repair and planned work'),
          viz: b.viz, source: 'maintenance_mix', metric: 'count',
          labels: known.map((p) => p.label), values: known.map((p) => p.value),
          digest: known.length ? `Total: ${formatMetric(known.reduce((a, p) => a + p.value, 0), 'int')} job cards | Planned: ${formatMetric(f.preventive_share_pct, 'pct1')}` : '',
          note: ascii(mgmt),
          money: false, currency,
          empty: known.length === 0 || known.every((p) => p.value === 0),
          emptyNote: scoped.length === 0
            ? `No assets match ${filterLabel(b.filter).toLowerCase()}.`
            : 'No job cards are classified by work type on these machines, so the mix cannot be shown.',
        }
      }

      const list = [...scoped].sort((a, b2) => (num(readField(a, 'preventive_share_pct')) ?? 999) - (num(readField(b2, 'preventive_share_pct')) ?? 999)
        || (num(readField(b2, 'job_cards')) ?? 0) - (num(readField(a, 'job_cards')) ?? 0))
      const shown = b.limit > 0 ? list.slice(0, b.limit) : list
      const columns = [
        { key: 'asset_no', header: 'Asset', align: 'left', width: 1 },
        { key: 'asset_type', header: 'Type', align: 'left', width: 1.4 },
        { key: 'job_cards', header: 'Job cards', align: 'right', width: 0.9 },
        { key: 'emergency_cards', header: 'Emergency', align: 'right', width: 0.9 },
        { key: 'repair_cards', header: 'Repair', align: 'right', width: 0.8 },
        { key: 'preventive_cards', header: 'Planned', align: 'right', width: 0.8 },
        { key: 'preventive_share_pct', header: 'Planned share', align: 'right', width: 1 },
        { key: 'flag', header: 'Note', align: 'left', width: 1.6 },
      ]
      const body = shown.map((r) => [
        fmtText(r.asset_no), fmtText(r.asset_type),
        ascii(formatMetric(readField(r, 'job_cards'), 'int')), ascii(formatMetric(readField(r, 'emergency_cards'), 'int')),
        ascii(formatMetric(readField(r, 'repair_cards'), 'int')), ascii(formatMetric(readField(r, 'preventive_cards'), 'int')),
        ascii(formatMetric(readField(r, 'preventive_share_pct'), 'pct1')),
        num(readField(r, 'preventive_cards')) === 0 ? 'NEVER PLANNED SERVICED' : '',
      ])
      return {
        kind: 'table', id: b.id,
        title: fmtText(b.title || 'Emergency, repair and planned work by machine'),
        columns, rows: body, density: 'compact', page: 1, pages: 1,
        caption: ascii(`Lowest planned share first. Showing ${fmtNum(body.length)} of ${fmtNum(scoped.length)} machines.`),
        notes: [ascii(mgmt)],
        empty: body.length === 0,
        emptyNote: `No assets match ${filterLabel(b.filter).toLowerCase()}.`,
      }
    }

    case 'replacement': {
      const scoped = filterRows(rows, b.filter)
      const view = replacementView(scoped, ctx.benchmarks, {
        currency, now: ctx.now instanceof Date ? ctx.now : new Date(),
      })
      // No quotation on file is a STATE, not an error, and it is stated in
      // words. An empty table here would read as machines that cost nothing to
      // replace, which is the opposite of the truth.
      if (!view) {
        return {
          kind: 'text', id: b.id, title: fmtText(b.title),
          body: scoped.length === 0
            ? `No assets match ${filterLabel(b.filter).toLowerCase()}, so there is nothing to price.`
            : 'No supplier quotation is on file for any asset class on this list, so no machine here can be measured against the cost of a new one. Nothing is estimated in its place.',
          empty: true,
        }
      }
      const shown = b.limit > 0 ? view.covered.slice(0, b.limit) : view.covered
      const columns = [
        { key: 'asset_no', header: 'Asset', align: 'left', width: 1 },
        { key: 'asset_type', header: 'Class', align: 'left', width: 1.3 },
        { key: 'spend', header: 'Maintenance spend', align: 'right', width: 1.3 },
        { key: 'replacement', header: 'New machine', align: 'right', width: 1.3 },
        { key: 'pct', header: 'Spend vs new', align: 'right', width: 1 },
        { key: 'years', header: 'Years of spend per new', align: 'right', width: 1.2 },
        { key: 'quote', header: 'Quotation', align: 'left', width: 1.3 },
      ]
      const body = shown.map((p) => [
        fmtText(p.assetNo),
        fmtText(p.assetType),
        ascii(formatMetric(p.lifetimeSpend, 'money', p.currency || currency)),
        ascii(formatMetric(p.replacementCost, 'money', p.currency || currency)),
        ascii(formatMetric(p.spendPctOfNew, 'pct1')),
        // A machine with no complete year of spend has no ratio, and a blank
        // says so. Printing 0 would read as a machine that costs nothing to run.
        p.yearsOfSpendPerNewMachine == null ? '' : ascii(formatMetric(p.yearsOfSpendPerNewMachine, 'dec1')),
        ascii(benchmarkStatusLabel(p.status)),
      ])
      const t = view.totals
      const caption = ascii(
        `Showing ${fmtNum(body.length)} of ${fmtNum(t.coveredCount)} priced machines`
        + (b.filter !== 'all' ? ` | filter: ${filterLabel(b.filter)}` : '')
        + ` | ${fmtNum(t.uncoveredCount)} machines carry no quotation and are not listed here`
        + '. Prices are ex-VAT.',
      )
      return {
        kind: 'replacement', id: b.id, title: fmtText(b.title),
        headlines: view.headlines, columns, rows: body,
        notes: view.notes, caption,
        empty: false, emptyNote: '',
      }
    }

    case 'fleet_comparison': {
      const cmp = fleetComparison(ctx.fleetBaseline, currency)
      if (!cmp) {
        return {
          kind: 'text', id: b.id, title: fmtText(b.title),
          body: 'The comparison against the rest of the fleet could not be produced. The fleet baseline was not supplied to this deck, and it is not derivable from the disposal list alone.',
          empty: true,
        }
      }
      return {
        kind: 'comparison', id: b.id, title: fmtText(b.title),
        headlines: cmp.headlines, metrics: cmp.metrics, confound: cmp.confound,
        onLabel: cmp.onLabel, restLabel: cmp.restLabel,
        note: cmp.note, country: cmp.country,
        empty: false,
      }
    }

    case 'recommendations': {
      const all = recommendationsFor(rows, totals, { currency, now: ctx.now instanceof Date ? ctx.now : new Date(), fleetBaseline: ctx.fleetBaseline })
      let items = all.filter((r) => b.priorities.includes(r.priority))
      if (b.limit > 0) items = items.slice(0, b.limit)
      // Ordered by priority, then paginated. A recommendation squeezed off the
      // bottom of a slide is a recommendation the committee never reads.
      const order = RECOMMENDATION_PRIORITIES.filter((p) => b.priorities.includes(p))
      const ordered = order.flatMap((p) => items.filter((r) => r.priority === p))
      const groupsOf = (list) => order
        .map((p) => ({ priority: p, label: ascii(priorityLabel(p)).toUpperCase(), items: list.filter((r) => r.priority === p) }))
        .filter((g) => g.items.length)
      if (!ordered.length) {
        return {
          kind: 'recommendations', id: b.id, title: fmtText(b.title),
          groups: [], showEvidence: b.showEvidence !== false, count: 0,
          page: 1, pages: 1,
          empty: true,
          emptyNote: rows.length === 0
            ? 'No assets are on the disposal list, so there is nothing to recommend.'
            : 'Nothing in this list supports a recommendation beyond the figures already shown.',
        }
      }
      const per = b.perSlide
      const pages = Math.max(1, Math.ceil(ordered.length / per))
      const slides = []
      for (let p = 0; p < pages; p++) {
        const chunk = ordered.slice(p * per, (p + 1) * per)
        slides.push({
          kind: 'recommendations', id: `${b.id}_p${p}`,
          title: fmtText(b.title) + (pages > 1 ? ` (${p + 1} of ${pages})` : ''),
          groups: groupsOf(chunk), showEvidence: b.showEvidence !== false,
          count: ordered.length, page: p + 1, pages,
          empty: false, emptyNote: '',
        })
      }
      return pages === 1 ? slides[0] : { kind: 'multi', id: b.id, slides }
    }

    case 'basis': {
      const bullets = reliabilityBasisLines(rows, currency)
      return {
        kind: 'findings', id: b.id, title: fmtText(b.title),
        bullets, empty: bullets.length === 0 || rows.length === 0,
        emptyNote: 'No assets are on the disposal list, so there are no figures to explain.',
      }
    }

    case 'divider':
      return { kind: 'divider', id: b.id, label: fmtText(b.label) }

    case 'text':
    default:
      return { kind: 'text', id: b.id, title: fmtText(b.title), body: ascii(b.body) || 'N/A' }
  }
}

/** True when at least one machine in scope carries any reliability measurement. */
export function hasAnyReliability(rows) {
  return (Array.isArray(rows) ? rows : []).some(hasReliability)
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
  // The machine's own reliability record. Kept as its own strip rather than
  // folded into the facts grid: these figures carry caveats the facts do not,
  // and a reader has to see them together with the note that qualifies them.
  const RELIABILITY_FACT_KEYS = [
    'job_cards', 'failures', 'breakdown_hours', 'mtbf_days', 'failures_per_year',
    'availability_pct', 'idle_days', 'preventive_cards', 'cost_per_breakdown_hour', 'last_seen',
  ]
  const reliability = opts.showReliability === false ? [] : RELIABILITY_FACT_KEYS.map((k) => {
    const col = RELIABILITY_COLUMNS[k]
    return { label: ascii(col.header), value: ascii(formatMetric(readField(r, k), col.format, currency)) }
  })
  const anyReliability = hasReliability(r)
  const parked = num(readField(r, 'parked_hours'))
  const relNotes = []
  if (anyReliability) {
    relNotes.push(parked != null && parked > 0
      ? `Breakdown hours exclude ${formatMetric(parked, 'int')} hours on ${formatMetric(readField(r, 'parked_cards'), 'int')} parked job cards.`
      : 'Breakdown hours are repair time from the job card history.')
    if (num(readField(r, 'date_coverage_pct')) != null) {
      relNotes.push(`${formatMetric(readField(r, 'date_coverage_pct'), 'pct1')} of this machine's job cards carry a usable date; MTBF, failure rate, availability and idle days rest on those.`)
    }
  }
  const head = fmtText(r?.asset_no)
  const title = opts.titleOverride ? `${ascii(opts.titleOverride)}: ${head}` : head
  return {
    kind: 'asset', id: opts.id || `asset_${head}`,
    title, assetNo: head, srNo: fmtText(r?.sr_no),
    subtitle: ascii([fmtText(r?.asset_type), fmtText(r?.brand), fmtText(r?.model_year)].filter((v) => v !== 'N/A').join(' | ')),
    flags, facts, tyres, remarks,
    reliability: anyReliability ? reliability : [],
    reliabilityNotes: relNotes.map(ascii),
    reliabilityNote: anyReliability
      ? ''
      : 'No maintenance history is recorded against this machine, so its reliability cannot be measured.',
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
