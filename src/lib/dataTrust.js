/**
 * dataTrust.js - the Data Trust Centre engine.
 *
 * THE PROBLEM THIS SOLVES
 * Every KPI in this app is printed with the same authority. "Tyre and parts
 * spend: EGP 28,959,626" looks exactly as solid as "Fleet vehicles: 1,019",
 * but half of that Egyptian money was put in its cost bucket by a fallback rule
 * that could not identify the item, and 99.8% of those rows carry no import
 * identity so a re-imported file would silently double them. A manager reading
 * the figure has no way to know that. This file computes, for each KPI domain,
 * a 0-100 confidence and the specific reasons behind it.
 *
 * THREE RULES IT ENFORCES
 *   1. A CHECK ONLY COUNTS AGAINST A KPI IT ACTUALLY AFFECTS. Blank vehicle
 *      makes do not make tyre spend less trustworthy. Each domain names the
 *      checks that bear on it and weights them; nothing else can dilute it.
 *   2. UNMEASURABLE IS NOT ZERO. A check with no denominator returns null and
 *      is dropped from the mean. A domain with nothing to measure scores null,
 *      and the UI must say "N/A", never "0".
 *   3. A SCORE BELOW 100 ALWAYS CARRIES ITS REASONS. The number on its own is
 *      just a different unexplained figure. `score < 100` and `reasons.length
 *      > 0` are guaranteed to imply each other.
 *
 * CURRENCY: every ratio here is computed inside ONE country, so no money is
 * ever added across SAR, AED and EGP. A cross-country roll-up averages the
 * unitless SCORES, which is legitimate arithmetic; it never averages money.
 *
 * Pure and injectable: no I/O, no clock. `measures` comes from the
 * `get_data_trust_overview` RPC (V375), which returns counts only.
 */

/** The kind of doubt a check expresses. */
export const DIMENSIONS = Object.freeze({
  completeness: 'Completeness',
  consistency: 'Consistency',
  timeliness: 'Timeliness',
  provenance: 'Provenance',
  coverage: 'Coverage',
})

/**
 * Confidence bands. Deliberately coarse: the difference between 71 and 74 is
 * not meaningful, the difference between "Good" and "Low" is.
 */
export const BANDS = Object.freeze([
  { key: 'high', label: 'High', min: 85, tone: 'good' },
  { key: 'good', label: 'Good', min: 70, tone: 'good' },
  { key: 'moderate', label: 'Moderate', min: 50, tone: 'warn' },
  { key: 'low', label: 'Low', min: 30, tone: 'bad' },
  { key: 'very_low', label: 'Very low', min: 0, tone: 'bad' },
])

/** The band for a score, or the honest unknown band when it is null. */
export function trustBand(score) {
  if (score == null || !Number.isFinite(Number(score))) {
    return { key: 'unknown', label: 'Not measurable', min: null, tone: 'muted' }
  }
  const s = Number(score)
  return BANDS.find((b) => s >= b.min) || BANDS[BANDS.length - 1]
}

// Half of spend confirmed by a person is treated as full confidence. Reviewing
// all 22,089 item codes is not a realistic bar; reviewing the codes that carry
// the money is, and that is what this target represents.
const TARGET_REVIEW_SHARE = 0.5
// An import landing within a week is current. Ninety days with no new line is
// treated as no feed at all.
const FRESH_DAYS = 7
const STALE_DAYS = 90

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))

/** A ratio, or null when there is no denominator to divide by. */
function ratio(part, whole) {
  const p = num(part)
  const w = num(whole)
  if (w == null || w <= 0 || p == null) return null
  return p / w
}

const pctScore = (r) => (r == null ? null : Math.max(0, Math.min(100, r * 100)))
const n = (v) => (num(v) == null ? 'N/A' : Number(v).toLocaleString('en-US'))
const pctText = (r) => (r == null ? 'N/A' : `${(r * 100).toFixed(1)}%`)

/**
 * THE CHECKS.
 *
 * Each one measures a single property of the data and returns
 * `{ score, detail }`. `score` is null when the property cannot be measured at
 * all, which is different from measuring it and finding nothing.
 * `detail` is written for a manager, not an engineer: it says what is missing
 * and what that costs them.
 */
export const CHECKS = Object.freeze({
  expense_classification: {
    key: 'expense_classification',
    label: 'Items identified',
    dimension: 'provenance',
    measures: 'Share of spend whose cost bucket was decided by real evidence rather than the fallback rule.',
    run(m) {
      const r = ratio(num(m.expense_spend) - num(m.expense_spend_default), m.expense_spend)
      if (r == null) return { score: null, detail: 'No spend in this period to measure.' }
      const fallback = num(m.expense_spend_default) || 0
      return {
        score: pctScore(r),
        detail: r >= 1
          ? 'Every line was identified by a reviewed item, an ERP code range or its description.'
          : `${n(Math.round(fallback))} of ${n(Math.round(num(m.expense_spend)))} was bucketed by the fallback because nothing identified the item. Those amounts may sit in the wrong cost category.`,
      }
    },
  },

  master_review: {
    key: 'master_review',
    label: 'Confirmed by a person',
    dimension: 'provenance',
    measures: 'Share of spend whose item code carries a human-reviewed Material Master decision.',
    run(m) {
      const r = ratio(m.expense_spend_reviewed, m.expense_spend)
      if (r == null) return { score: null, detail: 'No spend in this period to measure.' }
      return {
        score: pctScore(r / TARGET_REVIEW_SHARE),
        detail: `${pctText(r)} of spend sits behind an item a person has confirmed in Material Master. Reviewing the highest value codes is the fastest way to raise every cost figure's confidence.`,
      }
    },
  },

  expense_dating: {
    key: 'expense_dating',
    label: 'Expense lines dated',
    dimension: 'completeness',
    measures: 'Share of expense lines carrying an event date, so they can fall into a reporting period.',
    run(m) {
      const total = num(m.expense_lines_total)
      const r = ratio(total - num(m.expense_lines_no_date), total)
      if (r == null) return { score: null, detail: 'No expense lines to measure.' }
      const missing = num(m.expense_lines_no_date) || 0
      return {
        score: pctScore(r),
        detail: missing === 0
          ? 'Every expense line carries a date.'
          : `${n(missing)} lines have no date, so they are invisible to every period based figure.`,
      }
    },
  },

  expense_currency: {
    key: 'expense_currency',
    label: 'Currency recorded',
    dimension: 'completeness',
    measures: 'Share of expense lines stamped with the currency they were booked in.',
    run(m) {
      const r = ratio(num(m.expense_lines) - num(m.expense_lines_no_currency), m.expense_lines)
      if (r == null) return { score: null, detail: 'No expense lines in this period to measure.' }
      const missing = num(m.expense_lines_no_currency) || 0
      return {
        score: pctScore(r),
        detail: missing === 0
          ? 'Every line records its currency.'
          : `${n(missing)} lines have no currency, so their amounts cannot be safely reported.`,
      }
    },
  },

  expense_item_code: {
    key: 'expense_item_code',
    label: 'Item code present',
    dimension: 'completeness',
    measures: 'Share of expense lines carrying an item code, the key classification and Material Master rely on.',
    run(m) {
      const r = ratio(num(m.expense_lines) - num(m.expense_lines_no_item), m.expense_lines)
      if (r == null) return { score: null, detail: 'No expense lines in this period to measure.' }
      const missing = num(m.expense_lines_no_item) || 0
      return {
        score: pctScore(r),
        detail: missing === 0
          ? 'Every line carries an item code.'
          : `${n(missing)} lines have no item code and can never be reviewed or reclassified.`,
      }
    },
  },

  import_identity: {
    key: 'import_identity',
    label: 'Protected against re-import',
    dimension: 'provenance',
    measures: 'Share of expense lines carrying an import identity, which is what stops a re-uploaded file duplicating the money.',
    run(m) {
      const total = num(m.expense_lines_total)
      const r = ratio(total - num(m.expense_lines_no_uid), total)
      if (r == null) return { score: null, detail: 'No expense lines to measure.' }
      const missing = num(m.expense_lines_no_uid) || 0
      return {
        score: pctScore(r),
        detail: missing === 0
          ? 'Every line carries an import identity, so re-uploading a file cannot duplicate it.'
          : `${n(missing)} lines carry no import identity. Re-uploading the same file would add them again and inflate this spend. Mapping the source line number column on import is what fixes this.`,
      }
    },
  },

  expense_asset_link: {
    key: 'expense_asset_link',
    label: 'Spend attributed to a known asset',
    dimension: 'consistency',
    measures: 'Share of spend booked against an asset that exists in the fleet register.',
    run(m) {
      const r = ratio(m.expense_spend_linked, m.expense_spend)
      if (r == null) return { score: null, detail: 'No spend in this period to measure.' }
      const unlinked = (num(m.expense_assets) || 0) - (num(m.expense_assets_linked) || 0)
      const money = (num(m.expense_spend) || 0) - (num(m.expense_spend_linked) || 0)
      return {
        score: pctScore(r),
        detail: r >= 1
          ? 'All spend maps to an asset in the fleet register.'
          : `${n(Math.round(money))} sits on ${n(unlinked)} assets missing from the fleet register, so it drops out of every per asset and per vehicle type cost.`,
      }
    },
  },

  expense_freshness: {
    key: 'expense_freshness',
    label: 'Expense feed current',
    dimension: 'timeliness',
    measures: 'How long ago the most recent expense line was dated.',
    run(m) {
      const days = num(m.expense_days_since)
      if (days == null) return { score: null, detail: 'No dated expense line to measure against.' }
      const over = Math.max(0, days - FRESH_DAYS)
      const span = STALE_DAYS - FRESH_DAYS
      const score = Math.max(0, Math.min(100, 100 - (over / span) * 100))
      return {
        score,
        detail: days <= FRESH_DAYS
          ? `The most recent expense line is ${n(days)} days old, so this figure reflects current activity.`
          : `The most recent expense line is ${n(days)} days old. Anything more recent than that has not been imported yet.`,
      }
    },
  },

  distance_coverage: {
    key: 'distance_coverage',
    label: 'Assets with measurable distance',
    dimension: 'coverage',
    measures: 'Share of the assets that incur spend for which a running distance can actually be derived.',
    run(m) {
      const r = ratio(m.km_assets_measured, m.expense_assets)
      if (r == null) return { score: null, detail: 'No assets with spend in this period to measure.' }
      return {
        score: pctScore(r),
        detail: `Distance is available for ${n(m.km_assets_measured)} of the ${n(m.expense_assets)} assets that incurred cost. Cost per kilometre is measured on that subset only, so it is not the whole fleet's figure.`,
      }
    },
  },

  meter_source: {
    key: 'meter_source',
    label: 'Direct meter readings',
    dimension: 'provenance',
    measures: 'Whether distance comes from logged odometer or engine hour readings, or is inferred from tyre fitment records.',
    run(m) {
      const odo = num(m.odometer_rows) || 0
      const hrs = num(m.engine_hours_rows) || 0
      if (odo + hrs > 0) {
        return {
          score: 100,
          detail: `${n(odo + hrs)} meter readings have been logged, so distance is measured rather than inferred.`,
        }
      }
      return {
        score: 0,
        detail: 'No odometer or engine hour readings have ever been logged. Distance is inferred from the kilometres stamped on tyre fitment and removal, which is an estimate covering only the assets that had a tyre changed.',
      }
    },
  },

  tyre_unit_cost: {
    key: 'tyre_unit_cost',
    label: 'Tyre unit cost recorded',
    dimension: 'completeness',
    measures: 'Share of tyre records carrying a price for the individual tyre.',
    run(m) {
      const rows = num(m.tyre_rows)
      const r = ratio(rows - num(m.tyre_no_unit_cost), rows)
      if (r == null) return { score: null, detail: 'No tyre records to measure.' }
      const missing = num(m.tyre_no_unit_cost) || 0
      return {
        score: pctScore(r),
        detail: missing === 0
          ? 'Every tyre record carries a unit cost.'
          : `${n(missing)} of ${n(rows)} tyre records have no price. Any cost per brand or per position is built only on the priced remainder.`,
      }
    },
  },

  tyre_brand: {
    key: 'tyre_brand',
    label: 'Tyre brand recorded',
    dimension: 'completeness',
    measures: 'Share of tyre records naming the brand fitted.',
    run(m) {
      const rows = num(m.tyre_rows)
      const r = ratio(rows - num(m.tyre_no_brand), rows)
      if (r == null) return { score: null, detail: 'No tyre records to measure.' }
      const missing = num(m.tyre_no_brand) || 0
      return {
        score: pctScore(r),
        detail: missing === 0
          ? 'Every tyre record names its brand.'
          : `${n(missing)} of ${n(rows)} tyre records have no brand. The brand columns were present in the source files and were not mapped on import, so a re-import fixes this rather than a manual fill.`,
      }
    },
  },

  tyre_fitment_date: {
    key: 'tyre_fitment_date',
    label: 'Fitment date recorded',
    dimension: 'completeness',
    measures: 'Share of tyre records carrying the date the tyre went on.',
    run(m) {
      const rows = num(m.tyre_rows)
      const r = ratio(rows - num(m.tyre_no_fitment_date), rows)
      if (r == null) return { score: null, detail: 'No tyre records to measure.' }
      const missing = num(m.tyre_no_fitment_date) || 0
      return {
        score: pctScore(r),
        detail: missing === 0
          ? 'Every tyre record carries a fitment date.'
          : `${n(missing)} tyre records have no fitment date, so no service life can be calculated for them.`,
      }
    },
  },

  tyre_km_span: {
    key: 'tyre_km_span',
    label: 'Tyre distance recorded',
    dimension: 'completeness',
    measures: 'Share of tyre records carrying kilometres at BOTH fitment and removal, which is what a life in kilometres needs.',
    run(m) {
      const rows = num(m.tyre_rows)
      const r = ratio(m.tyre_km_span_both, rows)
      if (r == null) return { score: null, detail: 'No tyre records to measure.' }
      return {
        score: pctScore(r),
        detail: `${n(m.tyre_km_span_both)} of ${n(rows)} tyre records carry kilometres at both fitment and removal. Tyre life in kilometres is measured on those only; the rest are either still fitted or were removed without a reading.`,
      }
    },
  },

  tyre_date_sanity: {
    key: 'tyre_date_sanity',
    label: 'Tyre dates and readings sane',
    dimension: 'consistency',
    measures: 'Records with a date in the future, a removal before its fitment, or a removal reading below the fitment reading.',
    run(m) {
      const rows = num(m.tyre_rows)
      if (rows == null || rows <= 0) return { score: null, detail: 'No tyre records to measure.' }
      const bad = (num(m.tyre_future_dated) || 0)
        + (num(m.tyre_removal_before_fitment) || 0)
        + (num(m.tyre_km_backwards) || 0)
      return {
        score: pctScore(1 - bad / rows),
        detail: bad === 0
          ? 'No impossible dates or readings found.'
          : `${n(bad)} records are impossible: a date in the future, a removal before its fitment, or a removal reading below the fitment reading. Each one distorts the life it feeds.`,
      }
    },
  },

  fleet_typing: {
    key: 'fleet_typing',
    label: 'Vehicle type recorded',
    dimension: 'completeness',
    measures: 'Share of fleet register rows naming the vehicle type, which every per type comparison groups on.',
    run(m) {
      const rows = num(m.fleet_rows)
      const r = ratio(rows - num(m.fleet_no_vehicle_type), rows)
      if (r == null) return { score: null, detail: 'No fleet register rows to measure.' }
      const missing = num(m.fleet_no_vehicle_type) || 0
      return {
        score: pctScore(r),
        detail: missing === 0
          ? 'Every fleet record names its vehicle type.'
          : `${n(missing)} of ${n(rows)} fleet records have no vehicle type, so they are missing from every comparison that groups by type.`,
      }
    },
  },

  fleet_identity: {
    key: 'fleet_identity',
    label: 'Make recorded',
    dimension: 'completeness',
    measures: 'Share of fleet register rows naming the manufacturer.',
    run(m) {
      const rows = num(m.fleet_rows)
      const r = ratio(rows - num(m.fleet_no_make), rows)
      if (r == null) return { score: null, detail: 'No fleet register rows to measure.' }
      const missing = num(m.fleet_no_make) || 0
      return {
        score: pctScore(r),
        detail: missing === 0
          ? 'Every fleet record names its make.'
          : `${n(missing)} of ${n(rows)} fleet records have no make recorded.`,
      }
    },
  },
})

export const CHECK_KEYS = Object.freeze(Object.keys(CHECKS))

/**
 * THE KPI DOMAINS.
 *
 * `checks` is the closed list of what bears on this figure, with a relative
 * weight. Anything not listed CANNOT change the score. That is the whole point:
 * a blank vehicle make is a real gap, but it says nothing about whether the
 * tyre spend figure is right.
 */
export const DOMAINS = Object.freeze({
  tyre_cost: {
    key: 'tyre_cost',
    label: 'Tyre and parts spend',
    question: 'How much should I trust this cost figure?',
    checks: [
      { key: 'expense_classification', weight: 3 },
      { key: 'master_review', weight: 1 },
      { key: 'expense_dating', weight: 1 },
      { key: 'expense_currency', weight: 1 },
      { key: 'expense_item_code', weight: 1 },
      { key: 'import_identity', weight: 1 },
      { key: 'expense_freshness', weight: 1 },
    ],
  },
  cost_per_km: {
    key: 'cost_per_km',
    label: 'Cost per kilometre',
    question: 'Is this rate measured on enough of the fleet to mean anything?',
    checks: [
      { key: 'distance_coverage', weight: 3 },
      { key: 'expense_classification', weight: 2 },
      { key: 'expense_asset_link', weight: 2 },
      { key: 'meter_source', weight: 1 },
      { key: 'expense_freshness', weight: 1 },
    ],
  },
  tyre_life: {
    key: 'tyre_life',
    label: 'Tyre life',
    question: 'Is the service life built on enough complete tyre records?',
    checks: [
      { key: 'tyre_km_span', weight: 3 },
      { key: 'tyre_date_sanity', weight: 2 },
      { key: 'tyre_fitment_date', weight: 1 },
    ],
  },
  brand_performance: {
    key: 'brand_performance',
    label: 'Brand performance',
    question: 'Can brands actually be compared on this data?',
    checks: [
      { key: 'tyre_brand', weight: 3 },
      { key: 'tyre_unit_cost', weight: 2 },
      { key: 'tyre_km_span', weight: 1 },
    ],
  },
  fleet_register: {
    key: 'fleet_register',
    label: 'Fleet register',
    question: 'Does the asset list describe the fleet the costs belong to?',
    checks: [
      { key: 'fleet_typing', weight: 2 },
      { key: 'expense_asset_link', weight: 2 },
      { key: 'fleet_identity', weight: 1 },
    ],
  },
})

export const DOMAIN_KEYS = Object.freeze(Object.keys(DOMAINS))

/**
 * Run one check against a measures block.
 * @returns {{key,label,dimension,score:number|null,detail:string}}
 */
export function runCheck(key, measures) {
  const def = CHECKS[key]
  if (!def) return null
  const m = measures || {}
  const out = def.run(m) || { score: null, detail: 'Not measurable.' }
  const score = out.score == null ? null : Math.max(0, Math.min(100, Number(out.score)))
  // Rounding must never invent a perfect score. One impossible record in 6,016
  // is 99.98%, which rounds to 100.0 and would erase a known fault from every
  // reason list downstream. Anything short of a true 100 is capped below it.
  const shown = score == null
    ? null
    : (score < 100 ? Math.min(99.9, Math.round(score * 10) / 10) : 100)
  return {
    key: def.key,
    label: def.label,
    dimension: def.dimension,
    dimensionLabel: DIMENSIONS[def.dimension],
    measures: def.measures,
    score: shown,
    detail: out.detail,
  }
}

/** Every check, for the detailed view. Order is stable. */
export function runAllChecks(measures) {
  return CHECK_KEYS.map((k) => runCheck(k, measures))
}

/**
 * Score one KPI domain.
 *
 * Returns null `score` when not one bearing check could be measured, so the UI
 * can say "N/A" instead of printing a zero that reads as "this data is bad"
 * when the truth is "there is nothing here to judge".
 *
 * GUARANTEE: `score < 100` if and only if `reasons` is non-empty. A domain that
 * loses a fraction of a point to rounding is reported as 99 with its reason
 * attached, never as a silent 100.
 */
export function scoreDomain(measures, domainKey) {
  const domain = DOMAINS[domainKey]
  if (!domain) return null

  const checks = domain.checks.map((c) => ({
    ...runCheck(c.key, measures),
    weight: c.weight,
  }))
  const scored = checks.filter((c) => c.score != null)

  if (scored.length === 0) {
    return {
      key: domain.key,
      label: domain.label,
      question: domain.question,
      score: null,
      band: trustBand(null),
      measurable: false,
      reasons: [],
      checks,
      note: 'There is no data behind this figure yet, so its confidence cannot be judged.',
    }
  }

  const totalWeight = scored.reduce((s, c) => s + c.weight, 0)
  const raw = scored.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight

  // Biggest drag first: how many points this check costs the domain.
  const reasons = scored
    .filter((c) => c.score < 100)
    .map((c) => ({
      key: c.key,
      label: c.label,
      dimension: c.dimension,
      dimensionLabel: c.dimensionLabel,
      score: c.score,
      detail: c.detail,
      impact: Math.round(((100 - c.score) * c.weight) / totalWeight * 10) / 10,
    }))
    .sort((a, b) => b.impact - a.impact)

  const score = reasons.length > 0
    ? Math.min(99, Math.round(raw))
    : 100

  return {
    key: domain.key,
    label: domain.label,
    question: domain.question,
    score,
    band: trustBand(score),
    measurable: true,
    reasons,
    checks,
    note: null,
  }
}

/** Score every domain for one measures block. */
export function scoreAllDomains(measures) {
  const out = {}
  for (const k of DOMAIN_KEYS) out[k] = scoreDomain(measures, k)
  return out
}

/**
 * Turn the get_data_trust_overview payload into per-country domain scores.
 *
 * `overall` averages the unitless SCORES across countries. That is not a
 * currency sum: each country's score is already a ratio computed inside its own
 * currency, so averaging them is legitimate where averaging their money is not.
 */
export function buildTrustReport(payload) {
  if (!payload || payload.ok === false) {
    return {
      ok: false,
      reason: payload?.reason || 'unavailable',
      countries: [],
      overall: {},
      window: null,
    }
  }
  const countries = (Array.isArray(payload.countries) ? payload.countries : []).map((c) => ({
    country: c.country,
    currency: c.currency || null,
    measures: c.measures || {},
    domains: scoreAllDomains(c.measures || {}),
    checks: runAllChecks(c.measures || {}),
  }))

  const overall = {}
  for (const k of DOMAIN_KEYS) {
    const vals = countries
      .map((c) => c.domains[k])
      .filter((d) => d && d.score != null)
      .map((d) => d.score)
    overall[k] = vals.length
      ? { key: k, label: DOMAINS[k].label, score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), band: null, countries: vals.length }
      : { key: k, label: DOMAINS[k].label, score: null, band: null, countries: 0 }
    overall[k].band = trustBand(overall[k].score)
  }

  return {
    ok: true,
    window: payload.window || null,
    generatedAt: payload.generated_at || null,
    countries,
    overall,
  }
}

/**
 * The single worst thing to fix, across every country and domain, ranked by how
 * many confidence points it is costing. This is what turns the page from a
 * scoreboard into a work list.
 */
export function topActions(report, limit = 8) {
  if (!report?.ok) return []
  const bag = new Map()
  for (const c of report.countries) {
    for (const k of DOMAIN_KEYS) {
      const d = c.domains[k]
      if (!d || d.score == null) continue
      for (const r of d.reasons) {
        const id = `${c.country}::${r.key}`
        const prev = bag.get(id)
        if (prev) {
          prev.impact = Math.round((prev.impact + r.impact) * 10) / 10
          if (!prev.affects.includes(d.label)) prev.affects.push(d.label)
        } else {
          bag.set(id, {
            country: c.country,
            key: r.key,
            label: r.label,
            dimension: r.dimension,
            dimensionLabel: r.dimensionLabel,
            detail: r.detail,
            score: r.score,
            impact: r.impact,
            affects: [d.label],
          })
        }
      }
    }
  }
  return [...bag.values()]
    .sort((a, b) => b.impact - a.impact)
    .slice(0, Math.max(1, limit))
}

/** Rows for the Excel export of the Trust tab. */
export function trustExportRows(report) {
  const rows = []
  if (report?.ok) {
    for (const c of report.countries) {
      for (const k of DOMAIN_KEYS) {
        const d = c.domains[k]
        if (!d) continue
        rows.push({
          country: c.country,
          kpi: d.label,
          confidence: d.score == null ? 'N/A' : d.score,
          rating: d.band.label,
          reasons: d.reasons.length ? d.reasons.map((r) => r.label).join('; ') : 'None',
        })
      }
      for (const ck of c.checks) {
        rows.push({
          country: c.country,
          kpi: `Check: ${ck.label}`,
          confidence: ck.score == null ? 'N/A' : ck.score,
          rating: DIMENSIONS[ck.dimension] || 'N/A',
          reasons: ck.detail,
        })
      }
    }
  }
  return {
    rows,
    columns: ['country', 'kpi', 'confidence', 'rating', 'reasons'],
    headers: ['Country', 'KPI or check', 'Confidence', 'Rating', 'Why'],
  }
}
