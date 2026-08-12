/**
 * assetDisposalReliability - PURE engine (zero I/O) for the reliability history
 * and board recommendations behind the Asset Disposal module.
 *
 * THE QUESTION THIS ANSWERS. The committee's list says WHAT each machine cost.
 * It does not say how often it broke, how long it sat in the workshop, how much
 * of that was planned work, or whether it is still absorbing money in the year
 * it is being written off in. The owner computes those by hand today (their own
 * scrap workbook carries CPK, Breakdowns, MTBF and failures per asset). This is
 * that analysis, done from the job card history, with its limits stated.
 *
 * TWO MEASURED FACTS ABOUT THIS DATA SHAPE EVERY DECISION BELOW:
 *
 *  1. PARKED MACHINES ARE NOT BREAKDOWNS. 21 of 1,782 job cards each run longer
 *     than 90 days and between them hold 51.7% of all recorded breakdown hours;
 *     the longest is over two years on ONE card. Those are machines parked in a
 *     yard while the card stayed open and the ERP kept counting. The server
 *     splits them out: `breakdown_hours` excludes them, `breakdown_hours_recorded`
 *     keeps everything as the ERP holds it. Both travel together here and the
 *     parked figure is a finding in its own right, never folded into a
 *     reliability rate and never quietly dropped.
 *
 *  2. HALF THE JOB CARDS HAVE NO USABLE DATE. Only 51.4% carry a business date
 *     (1,040 sit in year 0022 to 0026, a dropped century the owner is fixing by
 *     re-upload). So MTBF, failures per year, idle days and availability rest on
 *     the dated half ONLY. `date_coverage_pct` rides on every asset and every
 *     time based metric declares it through `basisKey`, so a screen or a slide
 *     cannot print one of those numbers without the reader being told what it
 *     rests on.
 *
 * THE RULES, same as the economics engine next door:
 *  - NULL IS NOT ZERO. One failure gives no MTBF. No dated card gives no idle
 *    days. Those print as "Not measured", never as 0, which would read as
 *    perfect.
 *  - NOTHING IS INVENTED. There is no scrap value, no resale price and no
 *    "saving if disposed" in this file. Every recommendation quantifies itself
 *    only from figures present on the rows, and names them in `evidence`.
 *  - A BAND IS JUDGED AGAINST THIS FLEET, not against a threshold made up here.
 *    Below three comparable machines, or with no spread between them, nothing is
 *    called good or bad.
 *  - ASCII only. This output reaches a PowerPoint and a PDF.
 *  - Deterministic: `now` is injected, nothing calls the clock inside a sum.
 */
import { sumMoney } from './insurancePortfolio'
import { IDLE_JOB_CARD_DAYS } from './assetDisposal'

/**
 * A job card open longer than this is treated as a parked machine, not a
 * breakdown. Mirrors the server's `parked_threshold_hours` (90 days). Kept here
 * so a client side note can name the rule without waiting for a payload.
 */
export const PARKED_CARD_HOURS = 2160

/** Below this many comparable machines nothing is banded. Three is the minimum. */
export const MIN_BAND_PEERS = 3

/**
 * The availability line the fleet is COUNTED against in the roll up.
 *
 * This is a reporting line the owner can move, not an industry standard and not
 * a verdict: it only answers "how many machines sit below it". Nothing is called
 * good or bad because of it. Judgement is left to metricBand, which compares a
 * machine with its own fleet.
 */
export const BELOW_AVAILABILITY_PCT = 90

/**
 * When planned work is below this share of all job cards, the fleet is doing
 * more unplanned work than planned. That is arithmetic about a majority, not an
 * invented preventive maintenance target.
 */
export const PREVENTIVE_MAJORITY_PCT = 50

/** Spend share used only to size the phrase "a few machines carry most of it". */
export const CONCENTRATION_SHARE = 0.6

const txt = (v) => (v == null ? '' : String(v).trim())

const num = (v) => {
  if (v === '' || v == null || typeof v === 'boolean') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const key = (v) => txt(v).toUpperCase()

function round(v, dp = 2) {
  if (v == null || !Number.isFinite(v)) return null
  const f = 10 ** dp
  return Math.round(v * f) / f
}

/** Fixed locale so a test, a slide and a screen never disagree on a number. */
function fmtInt(v) {
  const n = num(v)
  return n == null ? 'N/A' : Math.round(n).toLocaleString('en-US')
}

function fmt1(v) {
  const n = num(v)
  return n == null ? 'N/A' : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function fmtMoney(v, currency = 'SAR') {
  const n = num(v)
  return n == null ? 'N/A' : `${currency} ${fmtInt(n)}`
}

function median(list) {
  const vals = (Array.isArray(list) ? list : []).map(num).filter((v) => v != null).sort((a, b) => a - b)
  if (!vals.length) return null
  const mid = Math.floor(vals.length / 2)
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
}

/** Linear interpolated quantile over an ALREADY sorted numeric array. */
function quantile(sorted, q) {
  if (!sorted.length) return null
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/* ------------------------------------------------------------------ *
 * 1. The metric catalog
 * ------------------------------------------------------------------ */

/**
 * Every reliability measure this module will publish, declared ONCE.
 *
 * The page, the deck and the export all render from this list, so a metric
 * cannot be labelled two different ways on two screens, and a time based figure
 * cannot escape onto a slide without its coverage caveat.
 *
 *  key           matches the server field exactly, so there is one vocabulary
 *  higherIsBetter drives banding and ranking direction
 *  explain       one line a non technical reader can act on
 *  basisKey      the field that QUALIFIES this number and must be shown beside
 *                it (null when the number stands on its own)
 *  timeBased     true when the figure rests on the dated half of the job cards
 */
export const RELIABILITY_METRICS = [
  {
    key: 'failures',
    label: 'Failures',
    unit: 'count',
    higherIsBetter: false,
    timeBased: false,
    basisKey: 'job_cards',
    explain: 'How many times the machine was booked in for an unplanned repair.',
  },
  {
    key: 'failures_per_year',
    label: 'Failures per year',
    unit: 'per year',
    higherIsBetter: false,
    timeBased: true,
    basisKey: 'date_coverage_pct',
    explain: 'Unplanned repairs a year, worked out over the days we have dated records for.',
  },
  {
    key: 'mtbf_days',
    label: 'Mean days between failures',
    unit: 'days',
    higherIsBetter: true,
    timeBased: true,
    basisKey: 'date_coverage_pct',
    explain: 'Average run between one unplanned repair and the next. Longer is better.',
  },
  {
    key: 'availability_pct',
    label: 'Availability',
    unit: '%',
    higherIsBetter: true,
    timeBased: true,
    basisKey: 'date_coverage_pct',
    explain: 'Share of the days we have records for when the machine was not sitting on an open job card.',
  },
  {
    key: 'breakdown_hours',
    label: 'Breakdown hours',
    unit: 'hours',
    higherIsBetter: false,
    timeBased: false,
    basisKey: 'parked_hours',
    explain: 'Hours the machine spent in the workshop, with parked machines left out.',
  },
  {
    key: 'breakdown_hours_recorded',
    label: 'Breakdown hours as recorded',
    unit: 'hours',
    higherIsBetter: false,
    timeBased: false,
    basisKey: 'parked_hours',
    explain: 'Every hour the ERP holds, including cards left open on parked machines.',
  },
  {
    key: 'parked_hours',
    label: 'Parked hours',
    unit: 'hours',
    higherIsBetter: false,
    timeBased: false,
    basisKey: 'parked_cards',
    explain: 'Hours sitting on job cards open longer than 90 days. This is a machine standing still, not a repair.',
  },
  {
    key: 'idle_days',
    label: 'Days since last job card',
    unit: 'days',
    higherIsBetter: false,
    timeBased: true,
    basisKey: 'date_coverage_pct',
    explain: 'How long since anyone booked work on this machine.',
  },
  {
    key: 'preventive_share_pct',
    label: 'Planned work share',
    unit: '%',
    higherIsBetter: true,
    timeBased: false,
    basisKey: 'job_cards',
    explain: 'Share of job cards that were planned servicing rather than a breakdown.',
  },
  {
    key: 'cost_per_failure',
    label: 'Cost per failure',
    unit: 'money',
    higherIsBetter: false,
    timeBased: false,
    basisKey: 'failures',
    explain: 'Maintenance spend divided by the number of unplanned repairs.',
  },
  {
    key: 'cost_per_breakdown_hour',
    label: 'Cost per breakdown hour',
    unit: 'money',
    higherIsBetter: false,
    timeBased: false,
    basisKey: 'breakdown_hours',
    explain: 'Spend divided by workshop hours. A machine with big bills and little recorded downtime reads high here.',
  },
  {
    key: 'spend',
    label: 'Maintenance spend',
    unit: 'money',
    higherIsBetter: false,
    timeBased: false,
    basisKey: 'job_cards',
    explain: 'Everything booked against this machine over its whole history.',
  },
  {
    key: 'job_cards',
    label: 'Job cards',
    unit: 'count',
    higherIsBetter: false,
    timeBased: false,
    basisKey: 'date_coverage_pct',
    explain: 'Every visit to the workshop, planned or not.',
  },
  {
    key: 'date_coverage_pct',
    label: 'Job cards with a usable date',
    unit: '%',
    higherIsBetter: true,
    timeBased: false,
    basisKey: null,
    explain: 'How much of this machine history can be placed in time. Everything measured per year rests on this share.',
  },
]

const METRIC_BY_KEY = new Map(RELIABILITY_METRICS.map((m) => [m.key, m]))

export const metricMeta = (k) => METRIC_BY_KEY.get(txt(k)) || null

/** Metric keys whose value only means something beside date_coverage_pct. */
export const TIME_BASED_METRICS = RELIABILITY_METRICS.filter((m) => m.timeBased).map((m) => m.key)

/**
 * Read a metric off either a bare reliability asset or a merged register row.
 *
 * mergeReliability NESTS history under `reliability` rather than spreading it,
 * because both sides carry `spend` and `job_cards` and a spread would silently
 * overwrite the committee's own figure with a different one.
 */
export function metricValue(row, k) {
  if (!row || typeof row !== 'object') return null
  const nested = row.reliability && typeof row.reliability === 'object' ? row.reliability : null
  const raw = nested && k in nested ? nested[k] : row[k]
  return num(raw)
}

/* ------------------------------------------------------------------ *
 * 2. Envelope
 * ------------------------------------------------------------------ */

/**
 * Take the get_asset_disposal_reliability envelope and hand back something a
 * page can render without a try/catch.
 *
 * A FAILED READ IS NOT AN EMPTY FLEET. ok:false with a reason means "we could
 * not look"; ok:true with no assets means "no machine on this list has any
 * history". Those never collapse into each other.
 *
 * `totals` is RECOMPUTED from the assets in hand so a filtered view can never
 * show fleet wide figures over a narrowed table. The server's own totals are
 * kept beside them as `serverTotals` for reconciling, and the one field only the
 * server can state (its parked threshold) is carried across.
 */
export function shapeReliability(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, assets: [], totals: fleetReliability([]), serverTotals: null, country: null, reason: 'unavailable' }
  }
  if (payload.ok === false) {
    return {
      ok: false,
      assets: [],
      totals: fleetReliability([]),
      serverTotals: null,
      country: payload.country ?? null,
      reason: txt(payload.reason) || 'unavailable',
    }
  }
  const assets = Array.isArray(payload.assets) ? payload.assets : []
  const serverTotals = payload.totals && typeof payload.totals === 'object' ? payload.totals : null
  const totals = fleetReliability(assets)
  totals.parkedThresholdHours = num(serverTotals?.parked_threshold_hours) ?? PARKED_CARD_HOURS
  return {
    ok: true,
    assets,
    totals,
    serverTotals,
    country: payload.country ?? null,
    reason: null,
  }
}

/* ------------------------------------------------------------------ *
 * 3. Joining history to the committee list
 * ------------------------------------------------------------------ */

/**
 * One row per machine on the committee list, carrying its history beside the
 * committee's own facts.
 *
 * A MACHINE WITH NO HISTORY KEEPS ITS ROW. Three of these assets were never
 * entered in the register at all, so they have no job cards anywhere. Dropping
 * them from the merged table would turn "we have no record of this machine"
 * into "this machine is fine", which is the opposite statement.
 *
 * History is NESTED, not spread, so the committee's `spend` and `job_cards` can
 * never be overwritten by the history engine's versions of the same names.
 */
export function mergeReliability(disposalRows, reliabilityAssets) {
  const hist = new Map()
  for (const a of Array.isArray(reliabilityAssets) ? reliabilityAssets : []) {
    const k = key(a?.asset_no)
    if (k) hist.set(k, a)
  }
  return (Array.isArray(disposalRows) ? disposalRows : []).map((r) => {
    const found = hist.get(key(r?.asset_no)) || null
    return { ...r, reliability: found, hasHistory: found != null }
  })
}

/**
 * Asset codes that have a maintenance history but are NOT on the committee list.
 *
 * Silently dropping them would hide a machine the workshop is still spending on
 * that nobody has put in front of the committee.
 */
export function unmatchedHistory(disposalRows, reliabilityAssets) {
  const listed = new Set((Array.isArray(disposalRows) ? disposalRows : []).map((r) => key(r?.asset_no)).filter(Boolean))
  return (Array.isArray(reliabilityAssets) ? reliabilityAssets : [])
    .map((a) => txt(a?.asset_no))
    .filter((a) => a && !listed.has(a.toUpperCase()))
    .sort()
}

/* ------------------------------------------------------------------ *
 * 4. Banding, against this fleet and nothing else
 * ------------------------------------------------------------------ */

/**
 * Is this value good, worth watching, or bad for THIS fleet.
 *
 * Judged against the quartiles of the machines handed in, never against a
 * threshold invented in this file. An absolute "MTBF under 30 days is bad" would
 * be a number I made up and a concrete fleet is not a haulage fleet.
 *
 * Returns 'unknown' when the value is missing, the metric is not one we publish,
 * or there are fewer than MIN_BAND_PEERS comparable machines. Returns 'watch'
 * when every peer holds the same value: nothing distinguishes this machine, so
 * calling it good or bad would be dressing up a tie.
 */
export function metricBand(k, value, peers) {
  const meta = metricMeta(k)
  const v = num(value)
  if (!meta || v == null) return 'unknown'

  const vals = (Array.isArray(peers) ? peers : [])
    .map((p) => (p != null && typeof p === 'object' ? metricValue(p, k) : num(p)))
    .filter((n) => n != null)
    .sort((a, b) => a - b)

  if (vals.length < MIN_BAND_PEERS) return 'unknown'
  const p25 = quantile(vals, 0.25)
  const p75 = quantile(vals, 0.75)
  if (p25 == null || p75 == null || p75 <= p25) return 'watch'

  if (meta.higherIsBetter) {
    if (v >= p75) return 'good'
    if (v <= p25) return 'bad'
    return 'watch'
  }
  if (v >= p75) return 'bad'
  if (v <= p25) return 'good'
  return 'watch'
}

export const BAND_META = {
  good: { key: 'good', label: 'Good', tone: 'good' },
  watch: { key: 'watch', label: 'Watch', tone: 'warning' },
  bad: { key: 'bad', label: 'Poor', tone: 'danger' },
  unknown: { key: 'unknown', label: 'Not measured', tone: 'quiet' },
}

export const bandMeta = (b) => BAND_META[txt(b)] || BAND_META.unknown

/**
 * Worst (default) or best machines by any published metric.
 *
 * Machines with no value for the metric are EXCLUDED, never sorted to one end.
 * A machine with no MTBF is not the most reliable machine on the list and it is
 * not the least reliable either; it is unmeasured, and it belongs in neither
 * ranking.
 */
export function reliabilityRanking(rows, k, { limit = 5, worst = true } = {}) {
  const meta = metricMeta(k)
  if (!meta) return []
  const list = Array.isArray(rows) ? rows : []
  const scored = list
    .map((r) => ({ row: r, assetNo: txt(r?.asset_no), value: metricValue(r, k) }))
    .filter((x) => x.value != null && x.assetNo)

  // "Worst" means the bad end of THIS metric's own direction.
  const badFirst = meta.higherIsBetter
    ? (a, b) => a.value - b.value
    : (a, b) => b.value - a.value
  const cmp = worst ? badFirst : (a, b) => badFirst(b, a)

  return scored
    .sort((a, b) => cmp(a, b) || a.assetNo.localeCompare(b.assetNo))
    .slice(0, Math.max(0, limit))
    .map((x) => ({
      assetNo: x.assetNo,
      value: x.value,
      band: metricBand(k, x.value, scored.map((s) => s.value)),
      row: x.row,
    }))
}

/* ------------------------------------------------------------------ *
 * 5. Fleet roll up
 * ------------------------------------------------------------------ */

/**
 * The fleet wide picture, recomputed from whatever rows are on screen.
 *
 * Every count that cannot be measured comes back NULL rather than 0. "No machine
 * is below 90% available" and "no machine has an availability figure at all" are
 * opposite statements and a zero would tell the flattering one.
 */
export function fleetReliability(rows, { belowAvailabilityPct = BELOW_AVAILABILITY_PCT } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object')
  const vals = (k) => list.map((r) => metricValue(r, k)).filter((v) => v != null)

  const sum = (k) => {
    const v = vals(k)
    return v.length ? v.reduce((s, n) => s + n, 0) : null
  }

  // Money goes through the shared summer so a register that ever carries two
  // currencies reports null and a per currency breakdown, never riyals plus
  // dirhams under one heading.
  const spendMoney = sumMoney(
    list.map((r) => ({ spend: metricValue(r, 'spend'), currency: txt(r?.currency) || txt(r?.reliability?.currency) || 'SAR' })),
    'spend',
  )

  const jobCards = sum('job_cards')
  const datedCards = sum('dated_cards')
  const preventive = sum('preventive_cards')

  const availability = vals('availability_pct')
  const withHistory = list.filter((r) => (metricValue(r, 'job_cards') ?? 0) > 0).length

  // Only machines that HAVE job cards can be said to have never had a planned
  // service. A machine with no cards at all has no maintenance story either way.
  const withCards = list.filter((r) => (metricValue(r, 'job_cards') ?? 0) > 0)
  const neverPreventive = withCards.length
    ? withCards.filter((r) => (metricValue(r, 'preventive_cards') ?? 0) === 0).length
    : null

  const idleVals = list.map((r) => metricValue(r, 'idle_days')).filter((v) => v != null)

  return {
    assets: list.length,
    withHistory,

    job_cards: jobCards,
    dated_cards: datedCards,
    date_coverage_pct: jobCards ? round((datedCards ?? 0) / jobCards * 100, 1) : null,

    failures: sum('failures'),
    breakdown_hours: sum('breakdown_hours'),
    breakdown_hours_recorded: sum('breakdown_hours_recorded'),
    parked_cards: sum('parked_cards'),
    parked_hours: sum('parked_hours'),
    parkedThresholdHours: PARKED_CARD_HOURS,

    preventive_cards: preventive,
    preventive_share_pct: jobCards ? round((preventive ?? 0) / jobCards * 100, 1) : null,

    spend: spendMoney.total,
    currency: spendMoney.currency,
    mixedCurrency: spendMoney.mixedCurrency,
    money: { spend: spendMoney },

    medians: {
      mtbf_days: round(median(vals('mtbf_days')), 1),
      failures_per_year: round(median(vals('failures_per_year')), 1),
      availability_pct: round(median(availability), 1),
      breakdown_hours: round(median(vals('breakdown_hours')), 1),
      cost_per_failure: round(median(vals('cost_per_failure')), 2),
      idle_days: round(median(idleVals), 0),
    },

    belowAvailabilityPct,
    // null, not 0, when nothing carries an availability figure to compare.
    belowAvailability: availability.length ? availability.filter((v) => v < belowAvailabilityPct).length : null,
    availabilityMeasured: availability.length,

    neverPreventive,
    idleOverYear: idleVals.length ? idleVals.filter((v) => v > IDLE_JOB_CARD_DAYS).length : null,
    idleMeasured: idleVals.length,
  }
}

/* ------------------------------------------------------------------ *
 * 6. Spend by year
 * ------------------------------------------------------------------ */

/** The server's spend_by_year map, normalised to sorted numeric year buckets. */
export function spendByYear(row) {
  const raw = (row?.reliability && row.reliability.spend_by_year) || row?.spend_by_year
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw)
    .map(([y, v]) => ({ year: num(y), spend: num(v) }))
    .filter((e) => e.year != null && e.spend != null)
    .sort((a, b) => a.year - b.year)
}

/**
 * Is this machine still absorbing money.
 *
 * Compares the last COMPLETE calendar year with the one before it. The year in
 * progress is deliberately excluded: eight months of 2026 against twelve of 2025
 * would report a fall on every machine in the fleet, which is an artefact of the
 * calendar rather than a change in spending.
 *
 * Returns null when there are not two complete years to compare.
 */
export function spendTrend(row, { now = Date.now() } = {}) {
  const years = spendByYear(row)
  if (!years.length) return null
  const currentYear = new Date(now).getUTCFullYear()
  const complete = years.filter((e) => e.year < currentYear)
  if (complete.length < 2) return null
  const latest = complete[complete.length - 1]
  const prior = complete[complete.length - 2]
  const delta = latest.spend - prior.spend
  return {
    latestYear: latest.year,
    latestSpend: latest.spend,
    priorYear: prior.year,
    priorSpend: prior.spend,
    delta: round(delta, 2),
    changePct: prior.spend > 0 ? round((delta / prior.spend) * 100, 1) : null,
    rising: delta > 0 && latest.spend > 0,
  }
}

/* ------------------------------------------------------------------ *
 * 7. The rest of the fleet
 * ------------------------------------------------------------------ */

/**
 * Take the get_asset_disposal_fleet_baseline envelope. Same rule as everywhere
 * else: ok:false is "we could not look", not "the fleet is fine".
 */
export function shapeFleetBaseline(payload) {
  if (!payload || typeof payload !== 'object' || payload.ok === false) {
    return {
      ok: false,
      onList: null,
      restOfFleet: null,
      idleConfound: false,
      note: null,
      country: payload?.country ?? null,
      reason: txt(payload?.reason) || 'unavailable',
    }
  }
  const side = (raw) => (raw && typeof raw === 'object' ? raw : null)
  return {
    ok: true,
    onList: side(payload.on_list),
    restOfFleet: side(payload.rest_of_fleet),
    idleConfound: payload.idle_confound === true,
    note: txt(payload.note) || null,
    country: payload.country ?? null,
    reason: null,
  }
}

/**
 * The committee's 37 machines set against the 969 staying in service.
 *
 * TWO MEASURES ARE RETURNED FOR THE SAME QUESTION AND THAT IS DELIBERATE.
 * Machines on the list record FEWER failures a year than the rest of the fleet,
 * which reads backwards until you notice that many of them are parked, and a
 * machine standing still cannot fail. Breakdown hours per asset is the measure
 * idleness does not flatter, and it runs the other way.
 *
 * NEITHER FIGURE IS ADJUSTED. Correcting failures per year for idleness would
 * need an assumption about how long each machine was genuinely available, which
 * this data does not carry; an adjustment nobody can check is worse than a
 * confound stated in plain words. So both are published, `trust` names the one
 * that survives the confound, and the caller must print the warning.
 */
export function baselineComparison(fleetBaseline) {
  const b = fleetBaseline && fleetBaseline.ok !== false && (fleetBaseline.onList || fleetBaseline.on_list)
    ? {
      onList: fleetBaseline.onList || fleetBaseline.on_list,
      rest: fleetBaseline.restOfFleet || fleetBaseline.rest_of_fleet,
      idleConfound: fleetBaseline.idleConfound === true || fleetBaseline.idle_confound === true,
      note: txt(fleetBaseline.note) || null,
    }
    : null
  if (!b || !b.onList || !b.rest) return null

  const ratio = (field) => {
    const a = num(b.onList[field])
    const c = num(b.rest[field])
    return a != null && c != null && c > 0 ? round(a / c, 2) : null
  }
  const share = (field) => {
    const a = num(b.onList[field])
    const c = num(b.rest[field])
    return a != null && c != null && a + c > 0 ? round((a / (a + c)) * 100, 1) : null
  }

  return {
    onList: b.onList,
    rest: b.rest,
    idleConfound: b.idleConfound,
    note: b.note,
    ratios: {
      spend_per_asset: ratio('spend_per_asset'),
      breakdown_hours_per_asset: ratio('breakdown_hours_per_asset'),
      avg_failures_per_year: ratio('avg_failures_per_year'),
      preventive_share_pct: ratio('preventive_share_pct'),
    },
    shares: {
      spend: share('spend'),
      assets: share('assets'),
      breakdown_hours: share('breakdown_hours'),
    },
    // The measure that idleness cannot flatter, named once so the page, the
    // deck and the recommendation cannot each pick a different one.
    trust: 'breakdown_hours_per_asset',
    confoundNote: b.idleConfound
      ? 'Machines on the list record fewer failures a year than the rest of the fleet because many of them are parked, and a machine standing still cannot fail. Breakdown hours per asset is the measure that idleness does not flatter. Neither figure has been adjusted.'
      : null,
  }
}

/* ------------------------------------------------------------------ *
 * 8. Board recommendations
 * ------------------------------------------------------------------ */

export const PRIORITIES = {
  critical: { key: 'critical', label: 'Act now', tone: 'danger', rank: 0 },
  high: { key: 'high', label: 'High', tone: 'warning', rank: 1 },
  medium: { key: 'medium', label: 'Medium', tone: 'info', rank: 2 },
  info: { key: 'info', label: 'For information', tone: 'quiet', rank: 3 },
}

export const priorityMeta = (p) => PRIORITIES[txt(p)] || PRIORITIES.info

/** The caveat every time based point has to carry, or none if coverage is full. */
function coverageCaveat(t) {
  const pct = num(t?.date_coverage_pct)
  if (pct == null || pct >= 100) return null
  return `Time based figures rest on the ${fmt1(pct)}% of job cards that carry a usable date.`
}

function assetsWithBadBand(rows, k) {
  const values = rows.map((r) => metricValue(r, k)).filter((v) => v != null)
  if (values.length < MIN_BAND_PEERS) return []
  return reliabilityRanking(rows, k, { limit: rows.length, worst: true }).filter((x) => x.band === 'bad')
}

/**
 * The points a chief executive should not have to work out from the table.
 *
 * Ordered, each one naming the figures it rests on. Returns [] when there is
 * genuinely nothing to say: a recommendations panel that always prints something
 * teaches the board to stop reading it.
 *
 * NOTHING HERE QUANTIFIES A SAVING. No scrap value, resale price or "SAR X if
 * disposed" appears anywhere, because the data carries none. Where a point
 * carries a number, that number is arithmetic over the rows handed in and
 * `evidence` says which figures it came from.
 */
export function boardRecommendations(rows, totals = null, {
  now = Date.now(),
  currency = 'SAR',
  limit = 3,
  belowAvailabilityPct = BELOW_AVAILABILITY_PCT,
  fleetBaseline = null,
} = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object')
  if (!list.length) return []
  const t = totals && typeof totals === 'object' ? totals : fleetReliability(list, { belowAvailabilityPct })
  const cur = txt(currency) || txt(t?.currency) || 'SAR'
  const caveat = coverageCaveat(t)
  const out = []
  const take = Math.max(1, limit)

  // Optional. Everything below works without it; with it the list can be set
  // against the fleet it is being taken out of.
  const cmp = baselineComparison(fleetBaseline)

  /* 0a. Does the list stand up against the fleet it comes out of. ---- */
  if (cmp) {
    const onSpend = num(cmp.onList.spend_per_asset)
    const restSpend = num(cmp.rest.spend_per_asset)
    const onHours = num(cmp.onList.breakdown_hours_per_asset)
    const restHours = num(cmp.rest.breakdown_hours_per_asset)
    const rSpend = cmp.ratios.spend_per_asset
    const rHours = cmp.ratios.breakdown_hours_per_asset

    if (onSpend != null && restSpend != null && onHours != null && restHours != null) {
      out.push({
        id: 'list-justified',
        priority: 'high',
        headline: `The machines on this list cost ${rSpend != null ? `${fmt1(rSpend)} times` : 'more than'} the average machine and spend ${rHours != null ? `${fmt1(rHours)} times` : 'more'} as long in the workshop`,
        detail: `Each machine on the list has taken ${fmtMoney(onSpend, cur)} in maintenance against ${fmtMoney(restSpend, cur)} for the ${fmtInt(cmp.rest.assets)} machines staying in service, and carries ${fmtInt(onHours)} breakdown hours each against ${fmtInt(restHours)}. On both measures the committee has picked the right machines, and the case for writing them off is made by their own history rather than by anyone's opinion of them.`,
        evidence: [
          `On the list: ${fmtInt(cmp.onList.assets)} machines, ${fmtMoney(cmp.onList.spend, cur)}, ${fmtInt(cmp.onList.breakdown_hours)} breakdown hours`,
          `Rest of the fleet: ${fmtInt(cmp.rest.assets)} machines, ${fmtMoney(cmp.rest.spend, cur)}, ${fmtInt(cmp.rest.breakdown_hours)} breakdown hours`,
          cmp.confoundNote
            ? `Read breakdown hours per asset, not failures a year: the list averages ${fmt1(cmp.onList.avg_failures_per_year)} failures a year against ${fmt1(cmp.rest.avg_failures_per_year)} for the rest, which looks better only because a parked machine cannot fail. ${cmp.confoundNote}`
            : null,
        ].filter(Boolean),
        assets: [],
        measure: rHours ?? rSpend ?? 0,
      })
    }

    /* 0b. And what it does NOT fix. --------------------------------- */
    const shareSpend = cmp.shares.spend
    if (shareSpend != null) {
      const restPrev = num(cmp.rest.preventive_share_pct)
      out.push({
        id: 'beyond-the-list',
        priority: 'critical',
        headline: `Writing these machines off removes about ${fmt1(shareSpend)}% of the maintenance bill, and leaves the other ${fmt1(100 - shareSpend)}% exactly where it is`,
        detail: `The list is ${fmtMoney(cmp.onList.spend, cur)} of ${fmtMoney(num(cmp.onList.spend) + num(cmp.rest.spend), cur)}. The ${fmtInt(cmp.rest.assets)} machines staying in service average ${fmt1(cmp.rest.avg_failures_per_year)} failures a year at ${fmt1(cmp.rest.avg_availability_pct)}% availability on ${fmt1(restPrev)}% planned maintenance. Approving this write off does not touch any of that. Treat the disposal as housekeeping and the maintenance regime on the remaining fleet as the separate decision it is.`,
        evidence: [
          `List ${fmtMoney(cmp.onList.spend, cur)} of ${fmtMoney(num(cmp.onList.spend) + num(cmp.rest.spend), cur)} total, which is ${fmt1(shareSpend)}%`,
          `Rest of fleet: ${fmt1(cmp.rest.avg_failures_per_year)} failures a year, ${fmt1(cmp.rest.avg_availability_pct)}% available, ${fmt1(restPrev)}% planned work`,
        ],
        assets: [],
        measure: 100 - shareSpend,
      })
    }
  }

  /* 1. The machines that break most often. -------------------------- */
  const breakers = assetsWithBadBand(list, 'failures_per_year').slice(0, take)
  if (breakers.length) {
    const lines = breakers.map((x) => {
      const r = x.row
      const mtbf = metricValue(r, 'mtbf_days')
      const cpf = metricValue(r, 'cost_per_failure')
      const fails = metricValue(r, 'failures')
      return `${x.assetNo} breaks ${fmt1(x.value)} times a year (${fmtInt(fails)} recorded failures, one every ${fmt1(mtbf)} days on average)${cpf != null ? `, at ${fmtMoney(cpf, cur)} a failure` : ''}`
    })
    out.push({
      id: 'frequent-failures',
      priority: 'critical',
      headline: breakers.length === 1
        ? `${breakers[0].assetNo} is the least reliable machine on the list`
        : `${breakers.length} machines break far more often than the rest of the list`,
      detail: `${lines.join('. ')}. Each of these is in the worst quarter of the list for unplanned repairs a year.`,
      evidence: [
        ...breakers.map((x) => `${x.assetNo}: ${fmtInt(metricValue(x.row, 'failures'))} failures over ${fmtInt(metricValue(x.row, 'observed_days'))} observed days`),
        caveat,
      ].filter(Boolean),
      assets: breakers.map((x) => x.assetNo),
      measure: breakers[0].value,
    })
  }

  /* 2. Availability. ------------------------------------------------ */
  const availValues = list.map((r) => metricValue(r, 'availability_pct')).filter((v) => v != null)
  const lowAvail = reliabilityRanking(list, 'availability_pct', { limit: list.length, worst: true })
    .filter((x) => x.band === 'bad' || x.value < belowAvailabilityPct)
    .slice(0, take)
  if (lowAvail.length && availValues.length) {
    const lines = lowAvail.map((x) => `${x.assetNo} was available ${fmt1(x.value)}% of the days we have records for`)
    out.push({
      id: 'low-availability',
      priority: 'critical',
      headline: `${lowAvail.length} machine${lowAvail.length === 1 ? '' : 's'} spent a large share of the period off the road`,
      detail: `${lines.join('. ')}. Work these machines were meant to cover had to be done by something else, or was not done. Availability here counts only the days their own job cards can be placed in time.`,
      evidence: [
        ...lowAvail.map((x) => `${x.assetNo}: ${fmt1(x.value)}% available, ${fmtInt(metricValue(x.row, 'breakdown_hours'))} breakdown hours over ${fmtInt(metricValue(x.row, 'observed_days'))} observed days`),
        `Counted against a reporting line of ${belowAvailabilityPct}%, which is a line to report against and not a standard.`,
        caveat,
      ].filter(Boolean),
      assets: lowAvail.map((x) => x.assetNo),
      measure: 100 - lowAvail[0].value,
    })
  }

  /* 3. Spend still rising on a machine being written off. ------------ */
  const rising = list
    .map((r) => ({ assetNo: txt(r?.asset_no), trend: spendTrend(r, { now }) }))
    .filter((x) => x.assetNo && x.trend?.rising)
    .sort((a, b) => b.trend.delta - a.trend.delta)
    .slice(0, take)
  if (rising.length) {
    const lines = rising.map((x) => {
      const tr = x.trend
      const pct = tr.changePct != null ? ` (${fmt1(tr.changePct)}% more)` : ''
      return `${x.assetNo} took ${fmtMoney(tr.latestSpend, cur)} in ${tr.latestYear} against ${fmtMoney(tr.priorSpend, cur)} in ${tr.priorYear}${pct}`
    })
    out.push({
      id: 'spend-still-rising',
      priority: 'critical',
      headline: `${rising.length} machine${rising.length === 1 ? '' : 's'} proposed for disposal cost MORE in the last full year than the year before`,
      detail: `${lines.join('. ')}. A machine on its way off the books should not still be absorbing a rising budget. Either the disposal is overdue or the spend needs explaining.`,
      evidence: [
        ...rising.map((x) => `${x.assetNo}: ${x.trend.priorYear} ${fmtMoney(x.trend.priorSpend, cur)}, ${x.trend.latestYear} ${fmtMoney(x.trend.latestSpend, cur)}`),
        `The year in progress is left out of this comparison, so a part year is never read as a fall.`,
      ],
      assets: rising.map((x) => x.assetNo),
      measure: rising[0].trend.delta,
    })
  }

  /* 4. Cards left open on parked machines. --------------------------- */
  const parkedCards = num(t?.parked_cards)
  const parkedHours = num(t?.parked_hours)
  const recorded = num(t?.breakdown_hours_recorded)
  if (parkedCards != null && parkedCards > 0 && parkedHours != null && parkedHours > 0) {
    const share = recorded && recorded > 0 ? round((parkedHours / recorded) * 100, 1) : null
    const parkedAssets = list
      .filter((r) => (metricValue(r, 'parked_cards') ?? 0) > 0)
      .sort((a, b) => (metricValue(b, 'parked_hours') ?? 0) - (metricValue(a, 'parked_hours') ?? 0))
      .map((r) => txt(r?.asset_no))
      .filter(Boolean)
    out.push({
      id: 'parked-cards',
      priority: 'high',
      headline: `${fmtInt(parkedCards)} job cards have been open longer than 90 days and are still counting hours`,
      detail: `Those cards hold ${fmtInt(parkedHours)} hours${share != null ? `, which is ${fmt1(share)}% of every breakdown hour on record` : ''}. These are machines standing still with a card nobody closed, not machines under repair, so they are excluded from the reliability figures on this page. Closing them is a workshop administration job, and until it is done the downtime numbers in the ERP overstate repairs by roughly that amount.`,
      evidence: [
        `${fmtInt(parkedCards)} cards over the ${fmtInt(t?.parkedThresholdHours ?? PARKED_CARD_HOURS)} hour (90 day) mark`,
        `Parked ${fmtInt(parkedHours)} hours against ${fmtInt(t?.breakdown_hours)} hours of real breakdown time`,
      ],
      assets: parkedAssets,
      measure: parkedHours,
    })
  }

  /* 5. Planned versus unplanned work. -------------------------------- */
  const prevShare = num(t?.preventive_share_pct)
  if (prevShare != null && prevShare < PREVENTIVE_MAJORITY_PCT) {
    const neverPrev = num(t?.neverPreventive)
    const neverList = list
      .filter((r) => (metricValue(r, 'job_cards') ?? 0) > 0 && (metricValue(r, 'preventive_cards') ?? 0) === 0)
      .map((r) => txt(r?.asset_no))
      .filter(Boolean)
    // Fleet wide, planned work is 1.6% of all job cards. That is not an
    // observation about these 37 machines, it is the reason the next 37 will
    // end up on a list like this one, so the point is raised accordingly.
    const restPrev = cmp ? num(cmp.rest.preventive_share_pct) : null
    const fleetWide = restPrev != null && restPrev < PREVENTIVE_MAJORITY_PCT
    out.push({
      id: 'preventive-share',
      priority: fleetWide ? 'critical' : 'high',
      headline: fleetWide
        ? `Planned servicing is ${fmt1(restPrev)}% of job cards across the whole fleet, and ${fmt1(prevShare)}% on these machines`
        : `Only ${fmt1(prevShare)}% of job cards on these machines were planned servicing`,
      detail: `${fmtInt(t?.preventive_cards)} of ${fmtInt(t?.job_cards)} cards on the list were preventive work. The rest were breakdowns and repairs, which means these machines were run to failure rather than serviced to a plan${neverPrev ? `, and ${fmtInt(neverPrev)} of them have never had a single planned service recorded` : ''}.${fleetWide ? ` The ${fmtInt(cmp.rest.assets)} machines staying in service are on ${fmt1(restPrev)}%, which is lower still. This is the finding that outlives the disposal: nothing about scrapping these machines changes how the rest are maintained, and on that ratio they will arrive at the same place.` : ' That is a management finding about how the workshop is scheduled, not a fault of any one machine.'}`,
      evidence: [
        `${fmtInt(t?.preventive_cards)} preventive of ${fmtInt(t?.job_cards)} job cards on the list`,
        fleetWide ? `Rest of the fleet: ${fmt1(restPrev)}% planned work over ${fmtInt(cmp.rest.cards)} job cards` : null,
        neverList.length ? `Never serviced to a plan: ${neverList.slice(0, 8).join(', ')}${neverList.length > 8 ? ` and ${neverList.length - 8} more` : ''}` : null,
      ].filter(Boolean),
      assets: neverList,
      measure: PREVENTIVE_MAJORITY_PCT - (fleetWide ? Math.min(prevShare, restPrev) : prevShare),
    })
  }

  /* 6. Expensive repairs. -------------------------------------------- */
  const costly = assetsWithBadBand(list, 'cost_per_failure').slice(0, take)
  if (costly.length) {
    out.push({
      id: 'repair-cost-intensity',
      priority: 'medium',
      headline: `${costly.length} machine${costly.length === 1 ? '' : 's'} cost far more per repair than the rest of the list`,
      detail: `${costly.map((x) => `${x.assetNo} averages ${fmtMoney(x.value, cur)} per unplanned repair`).join('. ')}. Compare that with a list median of ${fmtMoney(t?.medians?.cost_per_failure, cur)}. Big bills on a few machines are worth reading before the next one is approved.`,
      evidence: costly.map((x) => `${x.assetNo}: ${fmtMoney(metricValue(x.row, 'spend'), cur)} over ${fmtInt(metricValue(x.row, 'failures'))} failures`),
      assets: costly.map((x) => x.assetNo),
      measure: costly[0].value,
    })
  }

  /* 7. Idle but still counted as live fleet. -------------------------- */
  const idleActive = list
    .filter((r) => {
      const idle = metricValue(r, 'idle_days')
      return idle != null && idle > IDLE_JOB_CARD_DAYS
    })
    .map((r) => ({
      assetNo: txt(r?.asset_no),
      idle: metricValue(r, 'idle_days'),
      active: txt(r?.fleet_status) === 'Active',
      lastSeen: txt(r?.reliability?.last_seen) || txt(r?.last_seen) || null,
    }))
    .filter((x) => x.assetNo)
    .sort((a, b) => b.idle - a.idle)
  if (idleActive.length) {
    const stillActive = idleActive.filter((x) => x.active)
    const shown = (stillActive.length ? stillActive : idleActive).slice(0, take)
    out.push({
      id: 'idle-machines',
      priority: stillActive.length ? 'high' : 'medium',
      headline: stillActive.length
        ? `${stillActive.length} machines have had no work booked for over a year and are still marked Active`
        : `${idleActive.length} machines have had no work booked for over a year`,
      detail: `${shown.map((x) => `${x.assetNo} last saw a job card ${fmtInt(x.idle)} days ago${x.lastSeen ? ` (${x.lastSeen})` : ''}`).join('. ')}. ${stillActive.length ? 'While the register still calls them Active they are counted as available fleet, so availability and utilisation reporting is flattered by machines nobody is using.' : 'That supports the case that they are no longer working.'}`,
      evidence: idleActive.slice(0, 8).map((x) => `${x.assetNo}: idle ${fmtInt(x.idle)} days${x.active ? ', fleet status Active' : ''}`),
      assets: (stillActive.length ? stillActive : idleActive).map((x) => x.assetNo),
      measure: idleActive[0].idle,
    })
  }

  /* 8. Where the money actually went. --------------------------------- */
  const spendTotal = num(t?.spend)
  if (spendTotal != null && spendTotal > 0 && !t?.mixedCurrency) {
    const spenders = list
      .map((r) => ({ assetNo: txt(r?.asset_no), spend: metricValue(r, 'spend') }))
      .filter((x) => x.assetNo && x.spend != null && x.spend > 0)
      .sort((a, b) => b.spend - a.spend)
    let running = 0
    const head = []
    for (const s of spenders) {
      if (running / spendTotal >= CONCENTRATION_SHARE) break
      head.push(s)
      running += s.spend
    }
    // Only a finding when the money really is concentrated in a minority.
    if (head.length && spenders.length >= MIN_BAND_PEERS && head.length < spenders.length / 2) {
      out.push({
        id: 'spend-concentration',
        priority: 'medium',
        headline: `${head.length} of ${spenders.length} machines carry ${fmt1((running / spendTotal) * 100)}% of the maintenance spend`,
        detail: `${fmtMoney(running, cur)} of ${fmtMoney(spendTotal, cur)} was spent on ${head.map((s) => s.assetNo).join(', ')}. Whatever is decided about the rest of the list, these are the machines the money is going to.`,
        evidence: head.map((s) => `${s.assetNo}: ${fmtMoney(s.spend, cur)}`),
        assets: head.map((s) => s.assetNo),
        measure: round((running / spendTotal) * 100, 1),
      })
    }
  }

  /* 9. Tyres still on the machines. ----------------------------------- */
  const tyreRows = list.filter((r) => (num(r?.tyres_active) ?? 0) > 0)
  const tyres = tyreRows.reduce((s, r) => s + (num(r?.tyres_active) ?? 0), 0)
  if (tyres > 0) {
    out.push({
      id: 'tyres-fitted',
      priority: 'medium',
      headline: `${fmtInt(tyres)} tyres are still fitted to ${tyreRows.length} of these machines`,
      detail: 'Recover them into stock before the machines leave the yard, or they go with the asset. Nothing here puts a value on them; the count is what the tyre register holds today.',
      evidence: tyreRows
        .sort((a, b) => (num(b?.tyres_active) ?? 0) - (num(a?.tyres_active) ?? 0))
        .slice(0, 8)
        .map((r) => `${txt(r?.asset_no)}: ${fmtInt(r?.tyres_active)} fitted`),
      assets: tyreRows.map((r) => txt(r?.asset_no)).filter(Boolean),
      measure: tyres,
    })
  }

  /* 10. Machines the register has never heard of. ---------------------- */
  const unregistered = list.filter((r) => 'in_register' in r && r.in_register !== true).map((r) => txt(r?.asset_no)).filter(Boolean)
  if (unregistered.length) {
    out.push({
      id: 'not-in-register',
      priority: 'medium',
      headline: `${unregistered.length} machines on this list are not in the fleet register at all`,
      detail: `${unregistered.join(', ')} have no job cards and no spend here. That means no history was ever recorded for them, NOT that they cost nothing. Nothing on this page can say whether they are worth keeping.`,
      evidence: unregistered.map((a) => `${a}: no register entry, so no maintenance history exists to read`),
      assets: unregistered,
      measure: unregistered.length,
    })
  }

  /* 11. What all of the above rests on. -------------------------------- */
  const coverage = num(t?.date_coverage_pct)
  if (coverage != null && coverage < 100) {
    out.push({
      id: 'data-quality',
      priority: 'info',
      headline: `Only ${fmt1(coverage)}% of these job cards carry a usable date`,
      detail: `${fmtInt(t?.dated_cards)} of ${fmtInt(t?.job_cards)} cards can be placed in time. Everything measured per year on this page, which is mean time between failures, failures a year, idle days and availability, is worked out from that share alone. The spend and job card counts use every card and are unaffected. Re uploading the affected job cards would firm up the reliability figures without changing the money.`,
      evidence: [
        `${fmtInt(t?.dated_cards)} dated of ${fmtInt(t?.job_cards)} job cards`,
        `Affected measures: ${TIME_BASED_METRICS.map((k) => metricMeta(k).label).join(', ')}`,
      ],
      assets: [],
      measure: 100 - coverage,
    })
  }

  return out.sort((a, b) => priorityMeta(a.priority).rank - priorityMeta(b.priority).rank
    || (num(b.measure) ?? 0) - (num(a.measure) ?? 0)
    || a.id.localeCompare(b.id))
}

/* ------------------------------------------------------------------ *
 * 9. Export
 * ------------------------------------------------------------------ */

const EXPORT_COLUMNS = [
  ['asset_no', 'Asset'],
  ['asset_type', 'Type'],
  ['job_cards', 'Job cards'],
  ['date_coverage_pct', 'Cards with a date (%)'],
  ['failures', 'Failures'],
  ['preventive_cards', 'Planned services'],
  ['preventive_share_pct', 'Planned work share (%)'],
  ['breakdown_hours', 'Breakdown hours'],
  ['parked_cards', 'Parked cards'],
  ['parked_hours', 'Parked hours'],
  ['mtbf_days', 'Mean days between failures'],
  ['failures_per_year', 'Failures per year'],
  ['availability_pct', 'Availability (%)'],
  ['observed_days', 'Observed days'],
  ['idle_days', 'Days since last job card'],
  ['first_seen', 'First job card'],
  ['last_seen', 'Last job card'],
  ['spend', 'Maintenance spend'],
  ['cost_per_failure', 'Cost per failure'],
  ['cost_per_breakdown_hour', 'Cost per breakdown hour'],
  ['currency', 'Currency'],
]

/**
 * Rows for the download, in the same head/body plus columns/rows shape the
 * disposal export uses, so both existing exporters can be fed from one call.
 *
 * A missing figure prints "Not measured", never a blank and never a zero: a
 * spreadsheet full of zeros is the one artefact from which somebody will later
 * compute an average.
 */
export function reliabilityExportRows(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object')
  const objects = list.map((r) => {
    const cell = (k, dp = 2) => {
      const v = metricValue(r, k)
      return v == null ? 'Not measured' : round(v, dp)
    }
    return {
      asset_no: txt(r?.asset_no) || 'N/A',
      asset_type: txt(r?.asset_type) || txt(r?.reliability?.asset_type) || 'N/A',
      job_cards: cell('job_cards', 0),
      date_coverage_pct: cell('date_coverage_pct', 1),
      failures: cell('failures', 0),
      preventive_cards: cell('preventive_cards', 0),
      preventive_share_pct: cell('preventive_share_pct', 1),
      breakdown_hours: cell('breakdown_hours', 1),
      parked_cards: cell('parked_cards', 0),
      parked_hours: cell('parked_hours', 1),
      mtbf_days: cell('mtbf_days', 1),
      failures_per_year: cell('failures_per_year', 1),
      availability_pct: cell('availability_pct', 1),
      observed_days: cell('observed_days', 0),
      idle_days: cell('idle_days', 0),
      first_seen: txt(r?.reliability?.first_seen) || txt(r?.first_seen) || 'N/A',
      last_seen: txt(r?.reliability?.last_seen) || txt(r?.last_seen) || 'N/A',
      spend: cell('spend', 2),
      cost_per_failure: cell('cost_per_failure', 2),
      cost_per_breakdown_hour: cell('cost_per_breakdown_hour', 2),
      currency: txt(r?.currency) || txt(r?.reliability?.currency) || 'SAR',
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
