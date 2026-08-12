/**
 * assetReplacement - PURE engine (zero I/O) for what a machine on the disposal
 * list would cost to replace, and what that says about keeping it.
 *
 * WHY THIS EXISTS. Every valuation slot in the disposal module printed "Not
 * valued", because nothing in the data supported a figure and inventing one
 * would have been the worst kind of confident wrong. A supplier quotation is
 * the first hard price the fleet has: SANY quoted a new 47m truck-mounted
 * concrete pump at SAR 1,120,000 ex-VAT on 24 July 2026. That single figure
 * turns "this pump has cost us a lot" into "this pump has cost us N% of a new
 * one", which is a decision a board can actually take.
 *
 * FOUR RULES, and every one of them exists because breaking it would produce a
 * number that looks authoritative and is not:
 *
 *  1. A BENCHMARK APPLIES ONLY WHERE IT WAS OBTAINED. A quotation may name ONE
 *     machine or a whole class, and the two are different claims:
 *       - `assetNo` set -> it prices THAT machine and no other.
 *       - `assetNo` null -> it prices any machine of that `assetType`.
 *     The machine price wins over the class price. It is NEVER widened to the
 *     class, because a quotation obtained for one machine is not evidence about
 *     another - the SANY 47m pump quotation was obtained for MP049, and putting
 *     it on MP042, a Putzmeister of different spec, invented a price nobody
 *     quoted. The class match itself is exact: a pump quotation does not price a
 *     generator, and it does not price a SPIDER PUMP because the word "pump"
 *     appears. Anything with no quotation has NO replacement cost - it is listed
 *     as uncovered so the gap is visible, never filled by the nearest thing.
 *
 *  2. THE COST BASIS IS EX-VAT. The 15% VAT is recoverable, so it is not a cost
 *     to the business - the same rule the SANY invoice reading already follows.
 *     The VAT-inclusive total is carried alongside because that is what the
 *     document prints and what the cheque is written for, but every ratio below
 *     divides by the ex-VAT figure.
 *
 *  3. NO SERVICE LIFE IS INVENTED. The obvious move is to annualise the
 *     replacement over an assumed life and compare it with annual repair cost.
 *     That assumed life would be the single biggest number in the calculation
 *     and nobody could check it. So the comparison is expressed only in figures
 *     that exist: spend as a share of a new machine, and how many years of the
 *     last complete year's repair bill add up to one. A reader can draw the
 *     conclusion; the engine does not smuggle in an assumption to draw it for
 *     them.
 *
 *  4. AN EXPIRED QUOTATION IS LABELLED, NOT DISCARDED AND NOT PRESENTED AS
 *     CURRENT. A price from a quotation that lapsed last month is still the best
 *     evidence available and is far better than nothing, but a board paper that
 *     shows it as today's price is wrong. `status` says which it is, every time.
 *
 * NULL IS NOT ZERO here as everywhere else in this module: a machine with no
 * recorded spend has no ratio, and that prints as "Not measured", never 0%,
 * which would read as a machine that has cost nothing.
 *
 * ASCII only - this output reaches a PowerPoint, a PDF and an Excel export.
 * Deterministic: `now` is injected, nothing calls the clock inside a sum.
 */
import { sumMoney } from './insurancePortfolio'

const txt = (v) => (v == null ? '' : String(v).trim())
const key = (v) => txt(v).toUpperCase().replace(/\s+/g, ' ')
const num = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
const round = (v, d = 2) => {
  if (v == null || !Number.isFinite(v)) return null
  const f = 10 ** d
  return Math.round(v * f) / f
}
const asDay = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

/**
 * How a benchmark stands on the day it is being read.
 *
 * `expired` is deliberately still usable - see rule 4. It is the label that
 * matters, not a refusal to show the figure.
 */
export const BENCHMARK_STATUS = {
  current: {
    key: 'current',
    label: 'Quotation current',
    tone: 'good',
    note: 'Supplier quotation is still inside its validity period.',
  },
  expired: {
    key: 'expired',
    label: 'Quotation lapsed',
    tone: 'warning',
    note: 'The validity period has passed. Treat this as the last known price and ask the supplier to requote before committing.',
  },
  undated: {
    key: 'undated',
    label: 'No validity date',
    tone: 'quiet',
    note: 'The quotation carries no validity date, so it cannot be aged.',
  },
}

export const benchmarkStatusMeta = (s) => BENCHMARK_STATUS[txt(s)] || BENCHMARK_STATUS.undated

/**
 * Normalise the rows from asset_replacement_costs.
 *
 * Inactive rows are dropped here rather than filtered by every caller, so a
 * superseded quotation cannot reappear on one screen after being retired on
 * another. Where two active rows price the same class, the NEWEST quotation
 * wins and the older one is returned in `superseded` so the choice is visible
 * instead of silent.
 */
export function shapeBenchmarks(rows, { now = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const shaped = list
    .filter((r) => r && r.active !== false)
    .map((r) => {
      const unit = num(r.unit_price)
      const total = num(r.total_price)
      const validUntil = asDay(r.valid_until)
      const quoteDate = asDay(r.quote_date)
      let status = 'undated'
      if (validUntil) status = validUntil.getTime() >= now ? 'current' : 'expired'
      return {
        id: r.id ?? null,
        // Set = this quotation prices ONE named machine. Null = the class.
        assetNo: key(r.asset_no) || null,
        assetType: key(r.asset_type),
        assetTypeLabel: txt(r.asset_type),
        label: txt(r.label) || txt(r.model) || 'Replacement benchmark',
        supplier: txt(r.supplier) || null,
        model: txt(r.model) || null,
        spec: txt(r.spec) || null,
        // Rule 2: the ex-VAT price is the cost basis for every ratio below.
        cost: unit,
        vatPct: num(r.vat_pct),
        vatAmount: num(r.vat_amount),
        totalPrice: total,
        currency: txt(r.currency) || 'SAR',
        quoteRef: txt(r.quote_ref) || null,
        quoteDate: quoteDate ? r.quote_date : null,
        validUntil: validUntil ? r.valid_until : null,
        warrantyNote: txt(r.warranty_note) || null,
        sourceFile: txt(r.source_file) || null,
        sourcePage: num(r.source_page),
        notes: txt(r.notes) || null,
        status,
        ageDays: quoteDate ? Math.max(0, Math.round((now - quoteDate.getTime()) / 86400000)) : null,
      }
    })
    .filter((b) => b.assetType && b.cost != null && b.cost > 0)

  // Machine-specific and class-wide quotations are indexed separately so one can
  // never be mistaken for the other. Within each index the NEWEST quotation
  // wins and the older one is returned in `superseded`, so the choice is visible
  // rather than silent.
  const byType = new Map()
  const byAsset = new Map()
  const superseded = []
  const claim = (map, mapKey, b) => {
    const held = map.get(mapKey)
    if (!held) { map.set(mapKey, b); return }
    const heldAt = asDay(held.quoteDate)?.getTime() ?? -Infinity
    const newAt = asDay(b.quoteDate)?.getTime() ?? -Infinity
    if (newAt > heldAt) { map.set(mapKey, b); superseded.push(held) } else { superseded.push(b) }
  }
  for (const b of shaped) {
    if (b.assetNo) claim(byAsset, b.assetNo, b)
    else claim(byType, b.assetType, b)
  }

  return {
    list: [...byAsset.values(), ...byType.values()],
    byType,
    byAsset,
    superseded,
  }
}

/**
 * The quotation that prices this machine, if there is one.
 *
 * Rule 1: a quotation naming this machine wins; otherwise a quotation for its
 * class applies; otherwise there is no price. A machine-specific quotation is
 * never widened to its class, and the class match is exact - never the nearest
 * thing.
 *
 * Accepts (assetType, benchmarks) or (row, benchmarks) so a caller with a whole
 * register row does not have to pull the two fields apart.
 */
export function benchmarkFor(assetTypeOrRow, benchmarks, opts = {}) {
  const row = assetTypeOrRow && typeof assetTypeOrRow === 'object' ? assetTypeOrRow : null
  const type = key(row ? (row.asset_type ?? row.assetType) : assetTypeOrRow)
  const asset = key(opts.assetNo ?? (row ? (row.asset_no ?? row.assetNo) : ''))

  const assetMap = benchmarks?.byAsset instanceof Map ? benchmarks.byAsset : null
  const typeMap = benchmarks?.byType instanceof Map ? benchmarks.byType : null
  if (assetMap || typeMap) {
    if (asset && assetMap?.has(asset)) return assetMap.get(asset)
    return (type && typeMap?.get(type)) || null
  }

  const list = Array.isArray(benchmarks) ? benchmarks : benchmarks?.list
  if (!Array.isArray(list)) return null
  if (asset) {
    const mine = list.find((b) => key(b.assetNo ?? b.asset_no) === asset)
    if (mine) return mine
  }
  return list.find((b) => !key(b.assetNo ?? b.asset_no) && key(b.assetType ?? b.asset_type) === type) || null
}

/** Lifetime maintenance spend as the reliability history holds it. */
function lifetimeSpend(row) {
  const nested = row?.reliability && typeof row.reliability === 'object' ? row.reliability : null
  return num(nested?.spend) ?? num(row?.spend)
}

/**
 * The last COMPLETE calendar year of spend.
 *
 * The year in progress is excluded for the same reason spendTrend excludes it:
 * eight months against twelve reports a fall on every machine in the fleet,
 * which is the calendar talking, not the workshop.
 */
export function lastCompleteYearSpend(row, { now = Date.now() } = {}) {
  const raw = (row?.reliability && row.reliability.spend_by_year) || row?.spend_by_year
  if (!raw || typeof raw !== 'object') return null
  const thisYear = new Date(now).getUTCFullYear()
  const done = Object.entries(raw)
    .map(([y, v]) => ({ year: num(y), spend: num(v) }))
    .filter((e) => e.year != null && e.spend != null && e.year < thisYear)
    .sort((a, b) => a.year - b.year)
  if (!done.length) return null
  const last = done[done.length - 1]
  return { year: last.year, spend: last.spend }
}

/**
 * What replacing THIS machine would cost, and what has already been spent
 * against that price.
 *
 * Returns a row for every asset, covered or not - a machine whose class has no
 * quotation must still appear, carrying `covered:false` and a reason, or the
 * uncovered half of the fleet quietly disappears from the analysis.
 */
export function replacementEconomics(row, benchmarks, { now = Date.now() } = {}) {
  const assetNo = txt(row?.asset_no || row?.assetNo)
  const assetType = txt(row?.asset_type || row?.assetType)
  const bm = benchmarkFor(assetType, benchmarks, { assetNo })
  const spend = lifetimeSpend(row)
  const lastYear = lastCompleteYearSpend(row, { now })

  if (!bm) {
    return {
      assetNo,
      assetType,
      covered: false,
      // Naming what is missing matters: "no quotation for a PUMPS" tells the
      // reader to go and ask for one. Saying nothing reads as a machine with no
      // replacement, which is a different claim.
      reason: assetType
        ? `No supplier quotation on file for ${assetType}${assetNo ? ` or for ${assetNo}` : ''}.`
        : 'This machine carries no asset class, so no quotation can be matched to it.',
      benchmark: null,
      replacementCost: null,
      currency: null,
      lifetimeSpend: spend,
      spendPctOfNew: null,
      lastCompleteYear: lastYear,
      yearsOfSpendPerNewMachine: null,
      status: null,
    }
  }

  const spendPctOfNew = spend != null && spend > 0 && bm.cost > 0
    ? round((spend / bm.cost) * 100, 1)
    : null
  const yearsOfSpend = lastYear && lastYear.spend > 0
    ? round(bm.cost / lastYear.spend, 1)
    : null

  return {
    assetNo,
    assetType,
    covered: true,
    reason: null,
    benchmark: bm,
    replacementCost: bm.cost,
    replacementTotalWithVat: bm.totalPrice,
    currency: bm.currency,
    lifetimeSpend: spend,
    // "We have already spent N% of a new machine on this one."
    spendPctOfNew,
    lastCompleteYear: lastYear,
    // "At last year's repair bill, N years of repairs buys a new machine."
    yearsOfSpendPerNewMachine: yearsOfSpend,
    status: bm.status,
    // Whether this price was quoted for THIS machine or for its class. A reader
    // deciding on one machine should know which, and a class price carried onto
    // a specific decision is a weaker claim than a quotation with its name on it.
    basis: bm.assetNo ? 'asset' : 'class',
    basisNote: bm.assetNo
      ? `Quoted for ${bm.assetNo}.`
      : `Quoted for the ${assetType || 'asset'} class, not for ${assetNo || 'this machine'} specifically.`,
  }
}

/**
 * Every asset on the list, priced where a quotation exists.
 *
 * `exposure` is the money it would take to replace only the covered machines.
 * It is NOT the cost of replacing the list, and the shape says so: `uncovered`
 * and `uncoveredTypes` travel with it so a reader cannot mistake a partial
 * total for the whole bill.
 */
export function replacementTotals(rows, benchmarks, { now = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const priced = list.map((r) => replacementEconomics(r, benchmarks, { now }))
  const covered = priced.filter((p) => p.covered)
  const uncovered = priced.filter((p) => !p.covered)

  const uncoveredTypes = [...new Set(
    uncovered.map((p) => p.assetType).filter(Boolean),
  )].sort()

  const exposure = sumMoney(
    covered.map((p) => ({ amount: p.replacementCost, currency: p.currency })),
    'amount',
  )

  const withRatio = covered.filter((p) => p.spendPctOfNew != null)
  const avgSpendPct = withRatio.length
    ? round(withRatio.reduce((a, p) => a + p.spendPctOfNew, 0) / withRatio.length, 1)
    : null

  return {
    rows: priced,
    covered,
    uncovered,
    uncoveredTypes,
    coveredCount: covered.length,
    uncoveredCount: uncovered.length,
    coveragePct: list.length ? round((covered.length / list.length) * 100, 1) : null,
    exposure,
    avgSpendPct,
    // The count that stops a partial exposure being read as the whole bill.
    unpricedNote: uncovered.length
      ? `${uncovered.length} of ${list.length} machines have no supplier quotation on file, across ${uncoveredTypes.length} asset ${uncoveredTypes.length === 1 ? 'class' : 'classes'}. The replacement figure below covers the priced machines only.`
      : null,
    expiredCount: covered.filter((p) => p.status === 'expired').length,
  }
}

/**
 * Machines that have absorbed the largest share of a new machine's price.
 * Ranks only what can be ranked - an asset with no spend or no quotation is not
 * "0%", it simply cannot be placed and is left out.
 */
export function replacementRanking(rows, benchmarks, { limit = 5, now = Date.now() } = {}) {
  return replacementTotals(rows, benchmarks, { now }).covered
    .filter((p) => p.spendPctOfNew != null)
    .sort((a, b) => b.spendPctOfNew - a.spendPctOfNew)
    .slice(0, Math.max(1, limit))
}

/**
 * Board-ready findings from the replacement side.
 *
 * Every line names the figures it rests on. Nothing here says "dispose" or
 * "keep" - that is the committee's call. It says what has been spent against
 * what a new one costs, which is the fact they lacked.
 */
export function replacementFindings(rows, benchmarks, { now = Date.now(), currency = 'SAR' } = {}) {
  const totals = replacementTotals(rows, benchmarks, { now })
  const out = []
  const money = (v) => (v == null ? 'Not measured' : `${currency} ${Math.round(v).toLocaleString('en-US')}`)

  if (!totals.coveredCount) {
    out.push({
      key: 'no_benchmark',
      priority: 'info',
      title: 'No machine on the list has a replacement price yet',
      detail: 'Add a supplier quotation against an asset class and every machine in that class can be measured against the cost of a new one.',
      evidence: [],
    })
    return out
  }

  const worst = replacementRanking(rows, benchmarks, { limit: 1, now })[0]
  if (worst && worst.spendPctOfNew != null) {
    const over = worst.spendPctOfNew >= 100
    out.push({
      key: 'spend_vs_new',
      priority: over ? 'critical' : worst.spendPctOfNew >= 50 ? 'high' : 'medium',
      title: over
        ? `${worst.assetNo} has cost more in repairs than a new machine`
        : `${worst.assetNo} has absorbed ${worst.spendPctOfNew}% of a new machine`,
      detail: over
        ? `Lifetime maintenance on ${worst.assetNo} is ${money(worst.lifetimeSpend)} against ${money(worst.replacementCost)} for a new ${worst.assetType.toLowerCase()}. Every further repair is spent on a machine the fleet has already paid for twice.`
        : `Lifetime maintenance on ${worst.assetNo} is ${money(worst.lifetimeSpend)} against ${money(worst.replacementCost)} for a new ${worst.assetType.toLowerCase()}.`,
      evidence: [
        `Maintenance spend ${money(worst.lifetimeSpend)}`,
        `New machine ${money(worst.replacementCost)} ex-VAT`,
        worst.benchmark?.supplier ? `Quotation from ${worst.benchmark.supplier}` : null,
        worst.status === 'expired' ? 'Quotation validity has lapsed - requote before committing' : null,
      ].filter(Boolean),
    })
  }

  const payback = totals.covered
    .filter((p) => p.yearsOfSpendPerNewMachine != null)
    .sort((a, b) => a.yearsOfSpendPerNewMachine - b.yearsOfSpendPerNewMachine)[0]
  if (payback) {
    out.push({
      key: 'years_of_spend',
      priority: payback.yearsOfSpendPerNewMachine <= 5 ? 'high' : 'medium',
      title: `${payback.yearsOfSpendPerNewMachine} years of repairs on ${payback.assetNo} buys a new machine`,
      detail: `${payback.assetNo} cost ${money(payback.lastCompleteYear?.spend)} to keep running in ${payback.lastCompleteYear?.year}. A new ${payback.assetType.toLowerCase()} is ${money(payback.replacementCost)}. This compares two real figures and assumes nothing about how long a new machine would last.`,
      evidence: [
        `${payback.lastCompleteYear?.year} maintenance ${money(payback.lastCompleteYear?.spend)}`,
        `New machine ${money(payback.replacementCost)} ex-VAT`,
      ],
    })
  }

  if (totals.uncoveredCount) {
    out.push({
      key: 'benchmark_gap',
      priority: 'medium',
      title: `${totals.uncoveredCount} machines cannot be measured against a replacement price`,
      detail: `${totals.unpricedNote} Ask the supplier for a price per class and the whole list becomes comparable.`,
      evidence: totals.uncoveredTypes.slice(0, 8),
    })
  }

  if (totals.expiredCount) {
    out.push({
      key: 'quote_expired',
      priority: 'medium',
      title: `${totals.expiredCount} replacement ${totals.expiredCount === 1 ? 'price rests' : 'prices rest'} on a lapsed quotation`,
      detail: 'The figure is the last price the supplier put in writing and is still the best evidence available, but it is not today\'s price. Requote before any purchase decision.',
      evidence: [],
    })
  }

  return out
}

/** Flat rows for Excel. Blank, never 0, where a figure could not be measured. */
export function replacementExportRows(rows, benchmarks, { now = Date.now() } = {}) {
  return replacementTotals(rows, benchmarks, { now }).rows.map((p) => ({
    asset_no: p.assetNo,
    asset_type: p.assetType,
    replacement_ex_vat: p.replacementCost ?? '',
    replacement_with_vat: p.replacementTotalWithVat ?? '',
    currency: p.currency ?? '',
    maintenance_spend: p.lifetimeSpend ?? '',
    spend_pct_of_new: p.spendPctOfNew ?? '',
    last_complete_year: p.lastCompleteYear?.year ?? '',
    last_year_spend: p.lastCompleteYear?.spend ?? '',
    years_of_spend_per_new_machine: p.yearsOfSpendPerNewMachine ?? '',
    priced_for: p.basis === 'asset' ? 'This machine' : p.basis === 'class' ? 'Asset class' : '',
    quotation: p.benchmark?.label ?? '',
    model: p.benchmark?.model ?? '',
    supplier: p.benchmark?.supplier ?? '',
    quotation_date: p.benchmark?.quoteDate ?? '',
    quotation_valid_until: p.benchmark?.validUntil ?? '',
    quotation_status: p.status ? benchmarkStatusMeta(p.status).label : '',
    source_document: p.benchmark?.sourceFile ?? '',
    note: p.reason ?? '',
  }))
}
