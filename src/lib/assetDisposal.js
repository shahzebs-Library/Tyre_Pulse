/**
 * assetDisposal - PURE engine (zero I/O) behind the Asset Disposal register.
 *
 * THE QUESTION THIS MODULE ANSWERS. A disposal committee has proposed 37 KSA
 * machines for scrap or sale. Before anyone signs that off, three things have
 * to be true and none of them were visible anywhere: is the machine still being
 * treated as live fleet, what has it cost to keep, and is there anything on it
 * worth recovering first.
 *
 * THE RULES EVERY FIGURE HERE OBEYS:
 *
 *  1. NULL IS NOT ZERO. A machine nobody valued has estimatedValue null, so the
 *     screen prints "Not valued". Returning 0 states it is worthless, which is
 *     a claim the data never made. The same holds for an unreadable meter, an
 *     unknown model year, and any rate whose denominator is missing.
 *
 *  2. A RATE IS NEVER DIVIDED BY A METER NOBODY COULD READ. Several rows carry
 *     meter_text like "Km Not working" or "N/A". Cost per km on those would be
 *     an infinite or invented number wearing a decimal point, so it is null and
 *     the basis says why.
 *
 *  3. NOTHING IS INVENTED. There is NO scrap value, NO resale price and NO
 *     "savings if disposed" anywhere in this file, because nothing in the data
 *     supports one. Every derived figure is arithmetic over columns present on
 *     the row, and carries a `basis` sentence naming what it rests on.
 *
 *  4. THE THREE ASSETS THAT ARE NOT IN THE REGISTER STAY VISIBLE. BP022, BP023
 *     and TM192 were never entered in KSA, so they have no history at all.
 *     "We have no record of this machine" and "this machine cost nothing" are
 *     opposite statements; dropping them or zeroing them would tell the second.
 *
 * Deterministic and I/O free: `now` is injected so tests pin real dates. Money
 * is summed through the shared sumMoney, which refuses to blend currencies -
 * the SAR+AED+EGP defect this codebase has already had to fix repeatedly.
 */
import { sumMoney } from './insurancePortfolio'

/** No job card in this long means the machine has not been worked on in a year. */
export const IDLE_JOB_CARD_DAYS = 365

/** Spend per year at or above this multiple of its own class median is heavy. */
export const HEAVY_SPEND_MULTIPLE = 1.5

const txt = (v) => (v == null ? '' : String(v).trim())

const num = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** A strictly positive number, or null. Used for every rate denominator. */
const pos = (v) => {
  const n = num(v)
  return n != null && n > 0 ? n : null
}

const dayMs = (v) => {
  const s = txt(v)
  if (!s) return null
  const t = Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
  return Number.isFinite(t) ? t : null
}

function round(v, dp = 2) {
  if (v == null || !Number.isFinite(v)) return null
  const f = 10 ** dp
  return Math.round(v * f) / f
}

/* ------------------------------------------------------------------ *
 * Vocabulary. Every lookup falls back rather than rendering a blank -
 * an unrecognised token is still a fact somebody typed.
 * ------------------------------------------------------------------ */

export const DISPOSITIONS = {
  scrap: { key: 'scrap', label: 'Scrap', tone: 'danger', note: 'Committee proposes scrapping this machine.' },
  sell: { key: 'sell', label: 'Sell', tone: 'info', note: 'Committee proposes selling this machine.' },
  undecided: { key: 'undecided', label: 'Not decided', tone: 'quiet', note: 'No disposition recorded yet.' },
}

export const DISPOSAL_STATUSES = {
  proposed: { key: 'proposed', label: 'Proposed', tone: 'quiet', note: 'On the committee list, not yet decided.' },
  approved: { key: 'approved', label: 'Approved', tone: 'info', note: 'Approved for disposal, not yet disposed.' },
  rejected: { key: 'rejected', label: 'Rejected', tone: 'warning', note: 'Committee kept the machine in service.' },
  disposed: { key: 'disposed', label: 'Disposed', tone: 'good', note: 'Machine has left the fleet.' },
}

export const CONDITIONS = {
  'Missing Parts': { key: 'Missing Parts', label: 'Missing parts', tone: 'warning' },
  Dismantled: { key: 'Dismantled', label: 'Dismantled', tone: 'danger' },
  'Major Accident': { key: 'Major Accident', label: 'Major accident', tone: 'danger' },
  Running: { key: 'Running', label: 'Running', tone: 'good' },
  complete: { key: 'complete', label: 'Complete', tone: 'good' },
}

export const REGIONS = {
  'C-REGION': { key: 'C-REGION', label: 'Central region', tone: 'info' },
  'W-REGION': { key: 'W-REGION', label: 'Western region', tone: 'info' },
}

const UNKNOWN_META = { key: '', label: 'Not recorded', tone: 'quiet' }

function metaOf(table, value) {
  const v = txt(value)
  if (!v) return UNKNOWN_META
  return table[v] || { key: v, label: v, tone: 'quiet' }
}

export const dispositionMeta = (v) => metaOf(DISPOSITIONS, v)
export const disposalStatusMeta = (v) => metaOf(DISPOSAL_STATUSES, v)
export const conditionMeta = (v) => metaOf(CONDITIONS, v)
export const regionMeta = (v) => metaOf(REGIONS, v)

/** The verdicts assetEconomics can reach, with the sentence the UI prints. */
export const VERDICTS = {
  'never-registered': {
    key: 'never-registered',
    label: 'Never registered',
    tone: 'warning',
    note: 'This machine is not in the fleet register, so it has no maintenance history here.',
  },
  'no-history': {
    key: 'no-history',
    label: 'No job cards',
    tone: 'warning',
    note: 'In the register but nothing was ever booked against it.',
  },
  idle: {
    key: 'idle',
    label: 'Idle',
    tone: 'info',
    note: 'No job card for a year or more.',
  },
  'heavy-spend': {
    key: 'heavy-spend',
    label: 'Heavy spend',
    tone: 'danger',
    note: 'Costs well above the median for its own asset type.',
  },
  'in-use': {
    key: 'in-use',
    label: 'In use',
    tone: 'good',
    note: 'Worked on recently and costing about what its class costs.',
  },
}

export const verdictMeta = (v) => VERDICTS[txt(v)] || UNKNOWN_META

/* ------------------------------------------------------------------ *
 * 1. Envelope
 * ------------------------------------------------------------------ */

/**
 * Take the get_asset_disposal_register envelope and hand back something a page
 * can render without a try/catch.
 *
 * A FAILED READ IS NOT AN EMPTY REGISTER. `ok:false` with a reason means "we
 * could not look"; ok:true with zero rows means "there is nothing on the list".
 * The caller must be able to tell those apart, so they never collapse here.
 *
 * `totals` is RECOMPUTED from the rows in hand rather than passed through, so a
 * filtered view can never show server-wide totals over a narrowed table. The
 * server's own totals are kept beside them as `serverTotals` for reconciling.
 */
export function shapeDisposalRegister(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, rows: [], totals: disposalSummary([]), serverTotals: null, country: null, reason: 'unavailable' }
  }
  if (payload.ok === false) {
    return {
      ok: false,
      rows: [],
      totals: disposalSummary([]),
      serverTotals: null,
      country: payload.country ?? null,
      reason: txt(payload.reason) || 'unavailable',
    }
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : []
  return {
    ok: true,
    rows,
    totals: disposalSummary(rows),
    serverTotals: normalizeServerTotals(payload.totals),
    country: payload.country ?? null,
    reason: null,
  }
}

/** The RPC speaks snake_case; the app speaks camelCase. One place to translate. */
export function normalizeServerTotals(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    assets: num(raw.assets),
    toScrap: num(raw.to_scrap),
    toSell: num(raw.to_sell),
    inRegister: num(raw.in_register),
    stillActive: num(raw.still_active),
    notInRegister: num(raw.not_in_register),
    approved: num(raw.approved),
    disposed: num(raw.disposed),
    jobCards: num(raw.job_cards),
    lifetimeSpend: num(raw.lifetime_spend),
    activeTyres: num(raw.active_tyres),
    estimatedValue: num(raw.estimated_value),
    saleProceeds: num(raw.sale_proceeds),
  }
}

/* ------------------------------------------------------------------ *
 * 2. Meters and age - the two things half these rows cannot supply
 * ------------------------------------------------------------------ */

/**
 * What this machine is measured in, and whether the meter was actually read.
 *
 * meter_text is kept VERBATIM on the row ("Km Not working", "N/A", "23019 H /
 * KM 120140") because it is the committee's own evidence. The decision here is
 * only whether a NUMBER came out of it: no positive number means no rate, ever.
 * One machine (MP049) carries both a km and an hour reading, so 'both' is a
 * real state and not a data error.
 */
export function meterBasis(row) {
  const km = pos(row?.meter_km)
  const hours = pos(row?.meter_hours)
  if (km != null && hours != null) return 'both'
  if (km != null) return 'km'
  if (hours != null) return 'hours'
  return 'none'
}

/** True when the committee wrote something in the meter box but no number came out. */
export function meterUnread(row) {
  return meterBasis(row) === 'none'
}

/**
 * Age in whole years from the model year.
 *
 * The committee's own model_year wins over the register's, because the sheet is
 * the more recent statement about the machine. Neither one present means age is
 * null - not 0, which would read as "brand new".
 */
export function assetAge(row, { now = Date.now() } = {}) {
  const committee = num(row?.model_year)
  const register = num(row?.fleet_model_year)
  const year = committee ?? register
  if (year == null || year < 1900) return { ageYears: null, modelYear: null, basis: null }
  const nowYear = new Date(now).getUTCFullYear()
  const age = nowYear - year
  return {
    ageYears: age >= 0 ? age : null,
    modelYear: year,
    basis: committee != null ? 'committee' : 'register',
  }
}

/* ------------------------------------------------------------------ *
 * 3. Per-asset economics
 * ------------------------------------------------------------------ */

/**
 * Median spend per year for each asset type, used as the ONLY yardstick for
 * calling an asset heavy-spending.
 *
 * A median, not a mean: one dismantled machine that swallowed a rebuild would
 * drag a mean up and make every one of its siblings look cheap. Types with
 * fewer than two measurable members return null - a class of one has no median
 * and comparing a machine against itself is not a finding.
 */
export function spendBaselines(rows, { now = Date.now(), minSample = 2 } = {}) {
  const buckets = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const type = txt(r?.asset_type) || 'Unknown'
    const spend = num(r?.spend)
    const { ageYears } = assetAge(r, { now })
    if (spend == null || ageYears == null || ageYears <= 0) continue
    if (!buckets.has(type)) buckets.set(type, [])
    buckets.get(type).push(spend / ageYears)
  }
  const out = {}
  for (const [type, list] of buckets) {
    if (list.length < minSample) { out[type] = null; continue }
    const sorted = [...list].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    out[type] = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  return out
}

/**
 * The case for disposing of ONE machine, built only from what its row carries.
 *
 * `peerSpendPerYear` is optional. Without it the verdict can never be
 * 'heavy-spend', because "heavy" is meaningless without something to be heavy
 * against - an absolute riyal threshold here would be a number I made up.
 * Pass spendBaselines()[row.asset_type] to enable it.
 */
export function assetEconomics(row, { now = Date.now(), peerSpendPerYear = null, idleDays = IDLE_JOB_CARD_DAYS } = {}) {
  const r = row || {}
  const { ageYears, modelYear, basis: ageBasis } = assetAge(r, { now })
  const spend = num(r.spend)
  const jobCards = num(r.job_cards) ?? 0
  const inRegister = r.in_register === true
  const mBasis = meterBasis(r)
  const km = pos(r.meter_km)
  const hours = pos(r.meter_hours)

  const lastJobCard = txt(r.last_job_card) || null
  const lastMs = dayMs(lastJobCard)
  const daysSinceJobCard = lastMs == null ? null : Math.floor((now - lastMs) / 86400000)

  const spendPerYear = spend != null && ageYears != null && ageYears > 0 ? spend / ageYears : null
  // Only for a machine measured in that unit AND whose meter produced a number.
  const spendPerKm = spend != null && km != null ? spend / km : null
  const spendPerHour = spend != null && hours != null ? spend / hours : null

  const serials = Array.isArray(r.serials) ? r.serials : []
  const tyresActive = num(r.tyres_active) ?? 0
  const withSerial = serials.filter((s) => txt(s?.serial)).length

  const flags = []
  if (!inRegister) flags.push('never-registered')
  if (inRegister && jobCards === 0) flags.push('no-history')
  if (daysSinceJobCard != null && daysSinceJobCard > idleDays) flags.push('idle')
  const peer = pos(peerSpendPerYear)
  const heavy = peer != null && spendPerYear != null && spendPerYear >= peer * HEAVY_SPEND_MULTIPLE
  if (heavy) flags.push('heavy-spend')

  // Precedence: an asset the register has never heard of cannot also be judged
  // idle or heavy, because both of those read its history and it has none.
  let verdict = 'in-use'
  if (!inRegister) verdict = 'never-registered'
  else if (jobCards === 0) verdict = 'no-history'
  else if (heavy) verdict = 'heavy-spend'
  else if (flags.includes('idle')) verdict = 'idle'

  return {
    assetNo: txt(r.asset_no),
    assetType: txt(r.asset_type),
    inRegister,
    fleetStatus: txt(r.fleet_status) || null,

    modelYear,
    ageYears,
    ageBasis,

    spend,
    currency: txt(r.currency) || 'SAR',
    spendPerYear: round(spendPerYear),
    spendPerKm: round(spendPerKm, 3),
    spendPerHour: round(spendPerHour, 2),

    meterBasis: mBasis,
    meterKm: km,
    meterHours: hours,
    meterText: txt(r.meter_text) || null,
    meterUnread: mBasis === 'none',

    jobCards,
    firstJobCard: txt(r.first_job_card) || null,
    lastJobCard,
    daysSinceJobCard,

    tyresActive,
    tyresTotal: num(r.tyres_total) ?? 0,
    serials,
    costRecoveryNote: recoveryNote(tyresActive, withSerial),

    // Passed through, never derived. A machine with no figure is unvalued, and
    // the page must say so rather than print a zero nobody wrote.
    estimatedValue: num(r.estimated_value),
    saleProceeds: num(r.sale_proceeds),

    flags,
    verdict,
    verdictLabel: VERDICTS[verdict].label,
    verdictTone: VERDICTS[verdict].tone,
    basis: economicsBasis({ ageYears, spend, mBasis, jobCards, inRegister, peer }),
  }
}

/** Plain English on what is still bolted to the machine and worth taking off. */
function recoveryNote(tyresActive, withSerial) {
  if (!tyresActive) return null
  const tyres = `${tyresActive} tyre${tyresActive === 1 ? '' : 's'} still fitted`
  if (!withSerial) return `${tyres}. No serial recorded, so check them on the machine before it leaves.`
  return `${tyres}, ${withSerial} with a recorded serial. Remove and return them to stock before disposal.`
}

/** One sentence naming what the numbers above rest on, and what is missing. */
function economicsBasis({ ageYears, spend, mBasis, jobCards, inRegister, peer }) {
  const parts = []
  if (!inRegister) parts.push('Not in the fleet register, so there is no maintenance history to read')
  else parts.push(`${jobCards} job card${jobCards === 1 ? '' : 's'} on the ledger`)
  if (spend == null) parts.push('no spend recorded')
  if (ageYears == null) parts.push('model year not recorded, so cost per year cannot be worked out')
  if (mBasis === 'none') parts.push('meter could not be read, so cost per km or hour cannot be worked out')
  if (peer == null) parts.push('no class median available, so spend is not judged high or low')
  return `${parts.join('. ')}.`
}

/* ------------------------------------------------------------------ *
 * 4. Filtering and totals
 * ------------------------------------------------------------------ */

/** inRegister is tri-state: 'all' | 'yes' | 'no'. */
export function filterDisposals(rows, {
  search = '',
  disposition = '',
  region = '',
  assetType = '',
  status = '',
  condition = '',
  site = '',
  inRegister = 'all',
  downtime = '',
} = {}) {
  const q = txt(search).toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (disposition && txt(r?.disposition) !== disposition) return false
    if (region && txt(r?.region) !== region) return false
    if (assetType && txt(r?.asset_type) !== assetType) return false
    if (status && txt(r?.status) !== status) return false
    if (condition && txt(r?.condition) !== condition) return false
    if (site && txt(r?.site) !== site) return false
    if (inRegister === 'yes' && r?.in_register !== true) return false
    if (inRegister === 'no' && r?.in_register === true) return false
    // Downtime is merged on from the breakdown register. 'unknown' is its own
    // choice rather than being folded into "never broken down": a machine we
    // have no breakdown record for is not a machine that has never stopped.
    if (downtime === 'down' && !(r?.breakdown?.open > 0)) return false
    if (downtime === 'long' && !(r?.breakdown?.open > 0 && (r?.breakdown?.currentDays ?? 0) >= 30)) return false
    if (downtime === 'unknown' && r?.breakdown) return false
    if (q) {
      const serials = (Array.isArray(r?.serials) ? r.serials : []).map((s) => txt(s?.serial)).join(' ')
      const hay = [r?.asset_no, r?.brand, r?.asset_type, r?.site, serials].map(txt).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Totals for whatever rows are on screen.
 *
 * Recomputed rather than read from the server so a filtered table never shows
 * register-wide figures. Money goes through sumMoney, so a register that ever
 * carries two currencies reports null plus a per-currency breakdown instead of
 * adding riyals to dirhams.
 */
export function disposalSummary(rows) {
  const list = Array.isArray(rows) ? rows : []
  const count = (fn) => list.filter(fn).length

  const spendMoney = sumMoney(list, 'spend')
  const valueMoney = sumMoney(list, 'estimated_value')
  const proceedsMoney = sumMoney(list, 'sale_proceeds')

  const ages = list
    .map((r) => assetAge(r).ageYears)
    .filter((a) => a != null)

  const currencies = new Set(list.map((r) => txt(r?.currency) || 'SAR'))
  const mixedCurrency = currencies.size > 1

  return {
    assets: list.length,

    toScrap: count((r) => txt(r?.disposition) === 'scrap'),
    toSell: count((r) => txt(r?.disposition) === 'sell'),
    undecided: count((r) => {
      const d = txt(r?.disposition)
      return !d || d === 'undecided'
    }),

    inRegister: count((r) => r?.in_register === true),
    notInRegister: count((r) => r?.in_register !== true),
    // The headline finding: machines the committee has written off that the
    // register still counts as live fleet.
    stillActive: count((r) => txt(r?.fleet_status) === 'Active'),

    approved: count((r) => txt(r?.status) === 'approved'),
    disposed: count((r) => txt(r?.status) === 'disposed'),
    rejected: count((r) => txt(r?.status) === 'rejected'),

    jobCards: list.reduce((s, r) => s + (num(r?.job_cards) ?? 0), 0),
    activeTyres: list.reduce((s, r) => s + (num(r?.tyres_active) ?? 0), 0),
    tyresTotal: list.reduce((s, r) => s + (num(r?.tyres_total) ?? 0), 0),
    meterUnreadable: count(meterUnread),

    // null, never 0, when not one row carries a model year.
    avgAgeYears: ages.length ? round(ages.reduce((s, a) => s + a, 0) / ages.length, 1) : null,
    agedKnown: ages.length,

    lifetimeSpend: spendMoney.total,
    estimatedValue: valueMoney.total,
    saleProceeds: proceedsMoney.total,
    valued: valueMoney.counted,
    notValued: valueMoney.missing,

    currency: mixedCurrency ? null : (currencies.values().next().value ?? null),
    mixedCurrency,
    money: { spend: spendMoney, estimatedValue: valueMoney, saleProceeds: proceedsMoney },
  }
}

/* ------------------------------------------------------------------ *
 * 5. Grouping for charts
 * ------------------------------------------------------------------ */

export const GROUP_KEYS = ['asset_type', 'region', 'site', 'disposition', 'condition', 'brand', 'fleet_status']

/** Group and total. An empty value becomes an explicit "Not recorded" bucket. */
export function byGroup(rows, key) {
  const list = Array.isArray(rows) ? rows : []
  if (!GROUP_KEYS.includes(key)) return []
  const buckets = new Map()
  for (const r of list) {
    const k = txt(r?.[key]) || 'Not recorded'
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(r)
  }
  return [...buckets.entries()]
    .map(([k, members]) => {
      const money = sumMoney(members, 'spend')
      return {
        key: k,
        label: labelForGroup(key, k),
        count: members.length,
        spend: money.total,
        mixedCurrency: money.mixedCurrency,
        jobCards: members.reduce((s, r) => s + (num(r?.job_cards) ?? 0), 0),
        activeTyres: members.reduce((s, r) => s + (num(r?.tyres_active) ?? 0), 0),
      }
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

function labelForGroup(key, value) {
  if (key === 'region') return regionMeta(value).label
  if (key === 'disposition') return dispositionMeta(value).label
  if (key === 'condition') return conditionMeta(value).label
  return value
}

/* ------------------------------------------------------------------ *
 * 6. Age bands
 * ------------------------------------------------------------------ */

export const AGE_BANDS = [
  { key: '0-3', label: '0 to 3 years', min: 0, max: 3 },
  { key: '4-6', label: '4 to 6 years', min: 4, max: 6 },
  { key: '7-10', label: '7 to 10 years', min: 7, max: 10 },
  { key: '10+', label: 'Over 10 years', min: 11, max: Infinity },
  // Its own band on purpose. Folding unknown ages into "0 to 3" would make a
  // machine with no recorded year look new.
  { key: 'unknown', label: 'Year not recorded', min: null, max: null },
]

export function ageBands(rows, { now = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const counts = new Map(AGE_BANDS.map((b) => [b.key, 0]))
  for (const r of list) {
    const { ageYears } = assetAge(r, { now })
    const band = ageYears == null
      ? 'unknown'
      : (AGE_BANDS.find((b) => b.min != null && ageYears >= b.min && ageYears <= b.max)?.key ?? 'unknown')
    counts.set(band, counts.get(band) + 1)
  }
  return AGE_BANDS.map((b) => ({ key: b.key, label: b.label, count: counts.get(b.key) }))
}

/* ------------------------------------------------------------------ *
 * 7. Export
 * ------------------------------------------------------------------ */

const EXPORT_COLUMNS = [
  ['asset_no', 'Asset'],
  ['asset_type', 'Type'],
  ['brand', 'Brand'],
  ['model_year', 'Model year'],
  ['age_years', 'Age (years)'],
  ['region', 'Region'],
  ['site', 'Site'],
  ['disposition', 'Disposition'],
  ['status', 'Status'],
  ['condition', 'Condition'],
  ['in_register', 'In fleet register'],
  ['fleet_status', 'Fleet status'],
  ['meter_text', 'Meter as written'],
  ['meter_km', 'Meter km'],
  ['meter_hours', 'Meter hours'],
  ['job_cards', 'Job cards'],
  ['last_job_card', 'Last job card'],
  ['spend', 'Lifetime spend'],
  ['spend_per_year', 'Spend per year'],
  ['spend_per_km', 'Spend per km'],
  ['currency', 'Currency'],
  ['estimated_value', 'Estimated value'],
  ['sale_proceeds', 'Sale proceeds'],
  ['tyres_active', 'Tyres still fitted'],
  ['downtime', 'Downtime'],
  ['down_days', 'Days down now'],
  ['current_fault', 'Current fault'],
  ['serials', 'Fitted tyre serials'],
  ['verdict', 'Verdict'],
  ['remarks', 'Remarks'],
]

/**
 * Rows for the download.
 *
 * The fitted serials are joined into one cell rather than dropped: the whole
 * point of the recovery note is that somebody has to go and find those tyres,
 * and the person doing it works from the printout.
 *
 * Returns head/body for autoTable AND columns/rows for exportToExcel, so both
 * existing exporters can be fed from one call.
 */
export function disposalExportRows(rows, { now = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const baselines = spendBaselines(list, { now })
  const objects = list.map((r) => {
    const e = assetEconomics(r, { now, peerSpendPerYear: baselines[txt(r?.asset_type)] })
    return {
      asset_no: e.assetNo,
      asset_type: e.assetType,
      brand: txt(r?.brand) || 'N/A',
      model_year: e.modelYear ?? 'N/A',
      age_years: e.ageYears ?? 'N/A',
      region: regionMeta(r?.region).label,
      site: txt(r?.site) || 'N/A',
      disposition: dispositionMeta(r?.disposition).label,
      status: disposalStatusMeta(r?.status).label,
      condition: conditionMeta(r?.condition).label,
      in_register: e.inRegister ? 'Yes' : 'No',
      fleet_status: e.fleetStatus || 'Not in register',
      meter_text: e.meterText || 'N/A',
      meter_km: e.meterKm ?? 'N/A',
      meter_hours: e.meterHours ?? 'N/A',
      job_cards: e.jobCards,
      last_job_card: e.lastJobCard || 'N/A',
      spend: e.spend ?? 'N/A',
      spend_per_year: e.spendPerYear ?? 'N/A',
      spend_per_km: e.spendPerKm ?? 'N/A',
      currency: e.currency,
      estimated_value: e.estimatedValue ?? 'Not valued',
      sale_proceeds: e.saleProceeds ?? 'N/A',
      tyres_active: e.tyresActive,
      serials: e.serials.map((s) => txt(s?.serial)).filter(Boolean).join(' | ') || 'None',
      // From the breakdown register. "Not recorded" rather than 0, because the
      // register began this month and an absent row is a gap in what we were
      // told, not a machine that has never stopped.
      downtime: r?.breakdown
        ? (r.breakdown.open > 0 ? 'Down now' : 'Back in service')
        : 'Not recorded',
      down_days: r?.breakdown?.open > 0 ? (r.breakdown.currentDays ?? 'N/A') : 'N/A',
      current_fault: (r?.breakdown?.open > 0 ? txt(r.breakdown.fault) : '') || 'N/A',
      verdict: e.verdictLabel,
      remarks: txt(r?.remarks) || '',
    }
  })
  const columns = EXPORT_COLUMNS.map(([k]) => k)
  return {
    head: EXPORT_COLUMNS.map(([, h]) => h),
    body: objects.map((o) => columns.map((k) => o[k])),
    columns,
    rows: objects,
  }
}

/* ------------------------------------------------------------------ *
 * 8. Findings
 * ------------------------------------------------------------------ */

/**
 * The observations a reader should not have to work out for themselves.
 *
 * Returns [] when there is genuinely nothing to say. A findings panel that
 * always prints something teaches people to stop reading it.
 */
export function disposalFindings(rows, totals = null, { now = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []
  const t = totals && typeof totals === 'object' ? totals : disposalSummary(list)
  const out = []

  if (t.stillActive > 0) {
    out.push({
      key: 'still-active',
      tone: 'danger',
      text: `${t.stillActive} of ${t.assets} machines proposed for disposal are still marked Active in the fleet register. Until that is changed they are counted as available fleet.`,
    })
  }

  if (t.notInRegister > 0) {
    const names = list.filter((r) => r?.in_register !== true).map((r) => txt(r?.asset_no)).filter(Boolean)
    out.push({
      key: 'not-in-register',
      tone: 'warning',
      text: `${t.notInRegister} machines are not in the fleet register at all (${names.join(', ')}). They have no job cards and no spend here, which means no history was ever recorded rather than that they cost nothing.`,
    })
  }

  // Downtime, when the breakdown register has something to say about these
  // machines. Silent when it does not - the register only started this month,
  // so most of the fleet legitimately has nothing on record.
  const down = list.filter((r) => r?.breakdown?.open > 0)
  if (down.length) {
    const worst = down.reduce((a, b) => (
      (b?.breakdown?.currentDays ?? -1) > (a?.breakdown?.currentDays ?? -1) ? b : a
    ))
    const d = worst?.breakdown?.currentDays
    out.push({
      key: 'down-now',
      tone: 'warning',
      text: `${down.length} of these machines ${down.length === 1 ? 'is' : 'are'} down right now`
        + (d != null ? `, the longest being ${txt(worst.asset_no)} at ${d} days` : '')
        + '. A machine that is already standing still costs nothing to withdraw.',
    })
  }

  const spender = topSpender(list)
  if (spender) {
    out.push({
      key: 'top-spend',
      tone: 'info',
      text: `${spender.asset} carries the most maintenance spend on the list at ${Math.round(spender.spend).toLocaleString()} ${spender.currency}, across ${spender.jobCards} job cards.`,
    })
  }

  if (t.activeTyres > 0) {
    const assets = list.filter((r) => (num(r?.tyres_active) ?? 0) > 0).length
    out.push({
      key: 'tyres-fitted',
      tone: 'warning',
      text: `${t.activeTyres} tyres are still fitted to ${assets} of these machines. Recover them before disposal or they leave with the asset.`,
    })
  }

  if (t.meterUnreadable > 0) {
    out.push({
      key: 'meter-unreadable',
      tone: 'quiet',
      text: `${t.meterUnreadable} machines have no readable meter, so cost per km or per hour cannot be worked out for them. Their totals are still real; only the rate is missing.`,
    })
  }

  if (t.notValued > 0) {
    out.push({
      key: 'not-valued',
      tone: 'quiet',
      text: `${t.notValued} of ${t.assets} machines carry no estimated value. Nothing here guesses one, so the value total covers ${t.valued} machines only.`,
    })
  }

  const idle = list.filter((r) => {
    const ms = dayMs(r?.last_job_card)
    return ms != null && Math.floor((now - ms) / 86400000) > IDLE_JOB_CARD_DAYS
  }).length
  if (idle > 0) {
    out.push({
      key: 'idle',
      tone: 'info',
      text: `${idle} machines have had no job card for over a year, which supports the case that they are no longer working.`,
    })
  }

  return out
}

function topSpender(rows) {
  let best = null
  for (const r of rows) {
    const spend = num(r?.spend)
    if (spend == null || spend <= 0) continue
    if (!best || spend > best.spend) {
      best = {
        asset: txt(r?.asset_no),
        spend,
        currency: txt(r?.currency) || 'SAR',
        jobCards: num(r?.job_cards) ?? 0,
      }
    }
  }
  return best
}
