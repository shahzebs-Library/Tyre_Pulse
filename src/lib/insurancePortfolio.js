/**
 * insurancePortfolio - PURE engine (zero I/O) for insurance portfolio
 * intelligence: coverage reconciliation, insured value, loss ratio, claim
 * frequency and severity, repeat offenders, renewal exposure, premium
 * efficiency, and the claim-to-accident reconciliation gap.
 *
 * THE TWO RULES EVERY METRIC HERE OBEYS:
 *
 *  1. UNMEASURABLE IS NULL, NEVER ZERO. A loss ratio with no premium is not
 *     "0% - excellent", it is unknown; a fleet with no schedule rows loaded is
 *     not "0% insured", it is unmeasured. A flattering zero on an insurance
 *     screen reads as safety and is the most expensive lie this module could
 *     tell.
 *
 *  2. EVERY PARTIAL DENOMINATOR PUBLISHES ITS BASIS. Only ~38% of the KSA fleet
 *     register carries a chassis or a plate, so a schedule row often cannot be
 *     resolved to an asset at all. "Uninsured" and "we could not tell" are
 *     opposite statements and are counted separately everywhere below - the
 *     same discipline as costPerM3Reliable and dataTrust.
 *
 * DELIBERATELY NOT BUILT: any metric cut by driver NATIONALITY. The claim
 * register carries it, and it would produce a chart that looks analytical and
 * is a protected-characteristic profile of the workforce. Per-DRIVER repetition
 * is a real operational signal and IS built; nationality is not a cause of loss.
 */
import {
  buildFleetIndex,
  matchAll,
  matchToAsset,
  linkClaimToAccident,
  summarizeMatches,
  normAssetNo,
  MIN_CONFIDENT_MATCH,
} from './insuranceMatch'

export { MIN_CONFIDENT_MATCH }

/** Policies inside this window are "renewing" by default. */
export const RENEWAL_WINDOW_DAYS = 60

/** Below this many claims an asset/driver is not a "repeat" of anything. */
export const REPEAT_THRESHOLD = 2

const num = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** A ratio, or null when the denominator is absent, zero or negative. */
export function ratio(part, whole) {
  const p = num(part)
  const w = num(whole)
  if (p == null || w == null || w <= 0) return null
  return p / w
}

const dayOf = (v) => {
  if (v == null || String(v).trim() === '') return null
  const t = Date.parse(String(v).length <= 10 ? `${v}T00:00:00Z` : v)
  return Number.isFinite(t) ? Math.floor(t / 86400000) : null
}

/**
 * Sum a money column across rows WITHOUT ever blending currencies.
 *
 * When more than one currency appears the total is NULL and `mixedCurrency` is
 * true, with a per-currency breakdown - the caller must not print one figure
 * under one symbol. This is the SAR+AED+EGP defect this codebase has already
 * had to fix at four separate reader sites.
 */
export function sumMoney(rows, field, { currencyField = 'currency' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const byCurrency = new Map()
  let counted = 0
  let missing = 0
  for (const r of list) {
    const v = num(r?.[field])
    if (v == null) { missing += 1; continue }
    const cur = r?.[currencyField] || 'SAR'
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + v)
    counted += 1
  }
  const currencies = [...byCurrency.keys()].sort()
  const mixedCurrency = currencies.length > 1
  return {
    total: currencies.length === 1 ? byCurrency.get(currencies[0]) : null,
    currency: currencies.length === 1 ? currencies[0] : null,
    mixedCurrency,
    byCurrency: Object.fromEntries(byCurrency),
    // Basis: how many rows carried a figure vs how many did not. A total over
    // 3 of 200 rows is arithmetic, not a portfolio value.
    counted,
    missing,
    coverage: list.length > 0 ? counted / list.length : null,
  }
}

/* ------------------------------------------------------------------ *
 * 1. Coverage reconciliation
 * ------------------------------------------------------------------ */

/**
 * Which fleet assets have an insurance schedule row, which do not, and which
 * schedule rows insure something the fleet register does not hold.
 *
 * The three outcomes are kept STRICTLY apart:
 *   - insured        : resolved to a fleet asset (premium is buying cover)
 *   - uninsured      : a fleet asset with no schedule row at all (real exposure)
 *   - orphanSchedule : the row names an asset code the register does not hold
 *                      (confidently insuring something that is gone - wasted premium)
 *   - unresolved     : the row carries no usable key, or an ambiguous one. This
 *                      is NOT an orphan. Calling it one would invoice the
 *                      customer for our own matching gap.
 */
export function reconcileCoverage({ fleet = [], schedule = [], country } = {}) {
  const index = buildFleetIndex(fleet, { country })
  const results = matchAll(schedule, index)

  const insuredAssets = new Set()
  const orphanSchedule = []
  const unresolved = []
  for (const { row, match } of results) {
    if (match.asset_no && match.confidence >= MIN_CONFIDENT_MATCH) {
      insuredAssets.add(normAssetNo(match.asset_no))
    } else if (match.method === 'unmatched' && match.reason === 'not_in_fleet') {
      orphanSchedule.push({ ...row, _reason: 'not_in_fleet' })
    } else {
      unresolved.push({ ...row, _reason: match.reason || match.method })
    }
  }

  const scopedFleet = (Array.isArray(fleet) ? fleet : []).filter(
    (r) => r && (!country || country === 'All' || r.country === country),
  )
  const uninsured = scopedFleet.filter((r) => !insuredAssets.has(normAssetNo(r.asset_no)))

  const fleetCount = scopedFleet.length
  const matchable = index.keyCoverage.chassis + index.keyCoverage.plate
  return {
    fleetCount,
    scheduleCount: schedule.length,
    insuredCount: insuredAssets.size,
    uninsuredCount: uninsured.length,
    uninsured,
    orphanSchedule,
    unresolved,
    /**
     * Share of the fleet with a schedule row. NULL when there is no fleet to
     * measure, and NULL when no schedule has been loaded at all - "0% insured"
     * on an empty table is a false alarm, not a finding.
     */
    coveragePct: fleetCount > 0 && schedule.length > 0 ? insuredAssets.size / fleetCount : null,
    matchSummary: summarizeMatches(results),
    /**
     * How much of the fleet register is even reachable by a strong key. Where
     * this is low, `uninsured` overstates exposure - it includes assets we
     * simply could not link. Say it; do not bury it.
     */
    basis: {
      fleetWithChassis: index.keyCoverage.chassis,
      fleetWithPlate: index.keyCoverage.plate,
      fleetKeyCoverage: fleetCount > 0 ? Math.min(1, matchable / fleetCount) : null,
      reliable: fleetCount > 0 && schedule.length > 0,
    },
  }
}

/* ------------------------------------------------------------------ *
 * 2. Insured value
 * ------------------------------------------------------------------ */

function groupSum(rows, keyFn, field, currencyField) {
  const buckets = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = keyFn(r) || '(not stated)'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(r)
  }
  return [...buckets.entries()]
    .map(([key, list]) => ({
      key,
      count: list.length,
      ...sumMoney(list, field, { currencyField }),
    }))
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0) || String(a.key).localeCompare(String(b.key)))
}

/**
 * Total sum insured and premium, per cover type / per site / per asset class.
 * Asset class comes from the FLEET row the schedule line resolves to - the
 * schedule's own free-text description is the insurer's wording, not our
 * vocabulary, so grouping on it would fragment every class.
 */
export function insuredValue({ schedule = [], fleet = [], country } = {}) {
  const index = buildFleetIndex(fleet, { country })
  const enriched = (Array.isArray(schedule) ? schedule : []).map((row) => {
    const m = matchToAsset(row, index)
    const f = m.confidence >= MIN_CONFIDENT_MATCH ? m.fleet : null
    return {
      ...row,
      _site: row.site || f?.site || null,
      _class: f?.vehicle_type || f?.asset_category || null,
    }
  })
  return {
    total: sumMoney(enriched, 'sum_insured'),
    premium: sumMoney(enriched, 'premium'),
    byCoverType: groupSum(enriched, (r) => r.cover_type, 'sum_insured'),
    bySite: groupSum(enriched, (r) => r._site, 'sum_insured'),
    // A class of "(not classified)" is honest: the schedule row could not be
    // resolved to a fleet asset, so its class is unknown - not "Other".
    byAssetClass: groupSum(enriched, (r) => r._class || '(not classified)', 'sum_insured'),
  }
}

/* ------------------------------------------------------------------ *
 * 3. Loss ratio
 * ------------------------------------------------------------------ */

/**
 * Loss ratio = (paid + outstanding) / premium, per policy and per policy year.
 *
 * Returns null - never 0 - when the premium is unknown or zero. A policy whose
 * premium never loaded would otherwise report a perfect 0% loss ratio while
 * carrying real claims, which is the exact inverse of the truth.
 *
 * Loss-run rows flagged `is_total` are the insurer's own summary line; they are
 * EXCLUDED from the monthly sums or every figure double counts.
 */
export function lossRatios({ lossRuns = [], claims = [], schedule = [] } = {}) {
  const runs = (Array.isArray(lossRuns) ? lossRuns : []).filter((r) => r && !r.is_total)
  const hasRuns = runs.length > 0

  // Premium: prefer the loss run's own stated premium (the insurer's figure for
  // that policy year); fall back to summing the per-machine schedule.
  const premiumFor = (rows, fallbackRows) => {
    const stated = rows.map((r) => num(r.premium)).filter((v) => v != null)
    if (stated.length > 0) return Math.max(...stated) // repeated per month, not additive
    const s = sumMoney(fallbackRows, 'premium')
    return s.mixedCurrency ? null : s.total
  }

  const build = (keyFn, rows, source) => {
    const buckets = new Map()
    for (const r of rows) {
      const key = keyFn(r) || '(not stated)'
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(r)
    }
    return [...buckets.entries()].map(([key, list]) => {
      const paid = list.reduce((a, r) => a + (num(r.paid_amount) || 0), 0)
      const outstanding = list.reduce((a, r) => a + (num(r.outstanding_amount) || 0), 0)
      const policyNos = new Set(list.map((r) => r.policy_no).filter(Boolean))
      const sched = schedule.filter((s) => policyNos.has(s.policy_no))
      const premium = source === 'loss_runs' ? premiumFor(list, sched) : premiumFor([], sched)
      const incurred = paid + outstanding
      return {
        key,
        source,
        policyNos: [...policyNos],
        claimCount:
          source === 'loss_runs'
            ? list.reduce((a, r) => a + (num(r.paid_count) || 0) + (num(r.outstanding_count) || 0), 0)
            : list.length,
        paid,
        outstanding,
        incurred,
        premium,
        lossRatio: ratio(incurred, premium),
        // States WHY a null ratio is null, so the screen can say it.
        basis: premium == null || premium <= 0 ? 'premium_unknown' : 'measured',
      }
    })
  }

  const rows = hasRuns ? runs : (Array.isArray(claims) ? claims : [])
  const source = hasRuns ? 'loss_runs' : 'claim_register'
  return {
    source,
    byPolicy: build((r) => r.policy_no, rows, source).sort((a, b) => b.incurred - a.incurred),
    byPolicyYear: build(
      (r) => String(r.policy_year ?? r.uw_year ?? ''),
      rows,
      source,
    ).sort((a, b) => String(a.key).localeCompare(String(b.key))),
    /** True only when the insurer's own loss runs are the basis. */
    fromInsurerLossRuns: hasRuns,
  }
}

/* ------------------------------------------------------------------ *
 * 4. Claim frequency + severity
 * ------------------------------------------------------------------ */

function claimIncurred(c) {
  const paid = num(c?.paid_amount)
  const outstanding = num(c?.outstanding_amount)
  if (paid == null && outstanding == null) return num(c?.estimate_payment)
  return (paid || 0) + (outstanding || 0)
}

function statsGroup(claims, keyFn) {
  const buckets = new Map()
  for (const c of claims) {
    const key = keyFn(c) || '(not stated)'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(c)
  }
  return [...buckets.entries()]
    .map(([key, list]) => {
      const amounts = list.map(claimIncurred).filter((v) => v != null)
      const total = amounts.reduce((a, v) => a + v, 0)
      return {
        key,
        claimCount: list.length,
        totalIncurred: amounts.length > 0 ? total : null,
        // Average severity over the claims that CARRY a value, with the count
        // published - averaging over claims with no figure invents cheap claims.
        avgSeverity: amounts.length > 0 ? total / amounts.length : null,
        valuedCount: amounts.length,
        maxIncurred: amounts.length > 0 ? Math.max(...amounts) : null,
      }
    })
    .sort((a, b) => b.claimCount - a.claimCount || (b.totalIncurred ?? 0) - (a.totalIncurred ?? 0))
}

/**
 * Claim frequency and severity per asset, per site, per cause of loss and per
 * driver. Site comes from the resolved fleet asset (where the machine is based)
 * falling back to the claim's own city.
 */
export function claimStats({ claims = [], fleet = [], country } = {}) {
  const index = buildFleetIndex(fleet, { country })
  const enriched = (Array.isArray(claims) ? claims : []).map((c) => {
    const m = matchToAsset(c, index)
    const f = m.confidence >= MIN_CONFIDENT_MATCH ? m.fleet : null
    return { ...c, _asset: f?.asset_no || normAssetNo(c.asset_no) || null, _site: f?.site || c.claim_city || null }
  })
  const all = enriched.map(claimIncurred).filter((v) => v != null)
  return {
    claimCount: enriched.length,
    valuedCount: all.length,
    totalIncurred: all.length > 0 ? all.reduce((a, v) => a + v, 0) : null,
    avgSeverity: all.length > 0 ? all.reduce((a, v) => a + v, 0) / all.length : null,
    byAsset: statsGroup(enriched, (c) => c._asset),
    bySite: statsGroup(enriched, (c) => c._site),
    byCause: statsGroup(enriched, (c) => c.cause_of_loss),
    byDriver: statsGroup(enriched, (c) => c.driver_name),
    /**
     * Claims per insured asset. Null when nothing is insured yet - a frequency
     * over an empty denominator is not a rate.
     */
    frequencyPerAsset: index.size > 0 && enriched.length > 0 ? enriched.length / index.size : null,
    linkedToAsset: enriched.filter((c) => c._asset).length,
  }
}

/* ------------------------------------------------------------------ *
 * 5. Repeat offenders
 * ------------------------------------------------------------------ */

/**
 * Assets and drivers appearing on `threshold` or more claims - a defensible
 * signal straight from the register, with no inference. Claims that name
 * neither are excluded rather than pooled into an "(unknown)" offender.
 */
export function repeatOffenders({ claims = [], fleet = [], country, threshold = REPEAT_THRESHOLD } = {}) {
  const stats = claimStats({ claims, fleet, country })
  const pick = (rows) => rows.filter((r) => r.key !== '(not stated)' && r.claimCount >= threshold)
  return {
    threshold,
    assets: pick(stats.byAsset),
    drivers: pick(stats.byDriver),
  }
}

/* ------------------------------------------------------------------ *
 * 6. Renewal exposure
 * ------------------------------------------------------------------ */

/**
 * Policies whose cover ends within `days`, with the sum insured and the number
 * of machines riding on each. Rows already expired are reported separately -
 * "expires in -12 days" is uninsured, not upcoming.
 */
export function renewalExposure({ schedule = [], now = Date.now(), days = RENEWAL_WINDOW_DAYS } = {}) {
  const today = Math.floor(now / 86400000)
  const buckets = new Map()
  for (const r of Array.isArray(schedule) ? schedule : []) {
    const end = dayOf(r?.cover_to)
    if (end == null) continue
    const key = `${r.policy_no || '(no policy no)'}|${r.cover_type || ''}|${r.cover_to}`
    if (!buckets.has(key)) {
      buckets.set(key, { policy_no: r.policy_no || null, cover_type: r.cover_type || null, cover_to: r.cover_to, rows: [] })
    }
    buckets.get(key).rows.push(r)
  }
  const all = [...buckets.values()].map((b) => {
    const daysToExpiry = dayOf(b.cover_to) - today
    return {
      policy_no: b.policy_no,
      cover_type: b.cover_type,
      cover_to: b.cover_to,
      daysToExpiry,
      assetCount: b.rows.length,
      sumInsured: sumMoney(b.rows, 'sum_insured'),
      premium: sumMoney(b.rows, 'premium'),
      expired: daysToExpiry < 0,
    }
  })
  return {
    windowDays: days,
    expiring: all.filter((r) => !r.expired && r.daysToExpiry <= days).sort((a, b) => a.daysToExpiry - b.daysToExpiry),
    expired: all.filter((r) => r.expired).sort((a, b) => a.daysToExpiry - b.daysToExpiry),
    // Rows with no cover_to at all: an unknown expiry is not a safe one.
    undated: (Array.isArray(schedule) ? schedule : []).filter((r) => dayOf(r?.cover_to) == null).length,
  }
}

/* ------------------------------------------------------------------ *
 * 7. Premium efficiency
 * ------------------------------------------------------------------ */

/**
 * Premium per machine and premium per unit of sum insured (the rate on line),
 * per cover type. Both are null when their denominator is missing, and the
 * whole cut is withheld when the rows blend currencies - a rate built from two
 * currencies is not a rate.
 */
export function premiumEfficiency({ schedule = [] } = {}) {
  const rows = Array.isArray(schedule) ? schedule : []
  const build = (list) => {
    const prem = sumMoney(list, 'premium')
    const si = sumMoney(list, 'sum_insured')
    const blocked = prem.mixedCurrency || si.mixedCurrency
    return {
      assetCount: list.length,
      premium: prem,
      sumInsured: si,
      premiumPerAsset: blocked ? null : ratio(prem.total, list.length),
      // Expressed per 1,000 of sum insured - the market's own "rate on line".
      ratePer1000: blocked ? null : (ratio(prem.total, si.total) == null ? null : ratio(prem.total, si.total) * 1000),
      basis: blocked ? 'mixed_currency' : prem.counted === 0 ? 'no_premium_recorded' : 'measured',
    }
  }
  const byCoverType = [...new Set(rows.map((r) => r.cover_type || '(not stated)'))].map((key) => ({
    key,
    ...build(rows.filter((r) => (r.cover_type || '(not stated)') === key)),
  }))
  return { overall: build(rows), byCoverType }
}

/* ------------------------------------------------------------------ *
 * 8. Claim <-> accident reconciliation gap
 * ------------------------------------------------------------------ */

/**
 * The two-sided gap between what the insurer knows and what the fleet logged.
 *
 *  - claimsWithoutAccident: the insurer is paying for an incident that was
 *    never entered in the accident register. Each one is an event the fleet has
 *    no root cause, no photos and no corrective action for.
 *  - accidentsWithoutClaim: an accident carrying a claim amount that the
 *    insurer's register does not show - either an unfiled claim (money left on
 *    the table) or a register that has not caught up.
 *
 * Rows whose link could not be RESOLVED (no asset, no date, ambiguous) are held
 * in `unresolved` and excluded from both gap lists. An unmatched row is not
 * evidence of a missing record; it is evidence of a missing key.
 */
export function claimAccidentGap({ claims = [], accidents = [], fleet = [], country, windowDays = 3 } = {}) {
  const accList = Array.isArray(accidents) ? accidents : []
  // THE ASSET MUST BE RESOLVED FIRST. The insurer names a machine by chassis and
  // plate, so a claim's own `asset_no` is usually empty; linking on it directly
  // sent every real gap into "unresolved" and the metric found nothing.
  const index = buildFleetIndex(fleet, { country })
  const claimList = (Array.isArray(claims) ? claims : []).map((c) => {
    if (c?.asset_no) return c
    const m = matchToAsset(c, index)
    return m.confidence >= MIN_CONFIDENT_MATCH ? { ...c, asset_no: m.asset_no } : c
  })

  const linkedAccidentIds = new Set()
  const claimsWithoutAccident = []
  const unresolved = []
  for (const c of claimList) {
    const link = linkClaimToAccident(c, accList, { windowDays })
    if (link.accident_id) linkedAccidentIds.add(link.accident_id)
    else if (link.reason === 'no_accident_in_window' || link.reason === 'no_accidents') claimsWithoutAccident.push({ ...c, _reason: link.reason })
    else unresolved.push({ ...c, _reason: link.reason || link.method })
  }

  const accidentsWithoutClaim = accList.filter(
    (a) => !linkedAccidentIds.has(a.id) && (num(a.claim_amount) || 0) > 0,
  )

  return {
    claimCount: claimList.length,
    accidentCount: accList.length,
    linkedCount: linkedAccidentIds.size,
    claimsWithoutAccident,
    accidentsWithoutClaim,
    unresolved,
    // Null when there is nothing to reconcile, so an empty screen never reports
    // a perfect 100% reconciliation.
    linkRate: claimList.length > 0 ? linkedAccidentIds.size / claimList.length : null,
  }
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

/**
 * The whole portfolio view in one call. Every section degrades to an honest
 * empty shape when its table has not been loaded, so a page can render before
 * the insurance documents are in.
 */
export function buildInsurancePortfolio({
  fleet = [],
  schedule = [],
  claims = [],
  lossRuns = [],
  propertyRisks = [],
  accidents = [],
  country,
  now = Date.now(),
  renewalDays = RENEWAL_WINDOW_DAYS,
} = {}) {
  return {
    country: country || null,
    generatedAt: now,
    coverage: reconcileCoverage({ fleet, schedule, country }),
    value: insuredValue({ schedule, fleet, country }),
    loss: lossRatios({ lossRuns, claims, schedule }),
    claims: claimStats({ claims, fleet, country }),
    repeat: repeatOffenders({ claims, fleet, country }),
    renewal: renewalExposure({ schedule, now, days: renewalDays }),
    efficiency: premiumEfficiency({ schedule }),
    gap: claimAccidentGap({ claims, accidents, fleet, country }),
    property: {
      riskCount: propertyRisks.length,
      totalValue: sumMoney(propertyRisks, 'total_value'),
      premium: sumMoney(propertyRisks, 'premium'),
      byLocation: groupSum(propertyRisks, (r) => r.location_name || r.site, 'total_value'),
    },
    /** True only when there is something real to read. Drives the empty state. */
    hasData: schedule.length + claims.length + lossRuns.length + propertyRisks.length > 0,
  }
}
