/**
 * Planning and procurement simulation (pure). Method: docs/inventory/22_SIMULATION_METHOD.md
 *
 * Honesty rules (owner rule 5):
 * - Every input carries a source label: 'measured' (from Tyre Pulse data) or
 *   'assumption' (typed by a person). Outputs report which inputs were assumptions.
 * - Every result is a SCENARIO. Nothing here is labelled a saving. Working capital
 *   released (cash not tied up in stock) is kept apart from modelled cost
 *   difference (holding + obsolescence + price + fees), because releasing cash is
 *   not the same as spending less.
 * - Compatibility is never inferred from descriptions. Missing validated data
 *   reads "No validated compatibility data".
 * - A required input that is missing makes the dependent output null with a reason.
 */
import { num, roundMoney } from './valuation'

export const NO_VALIDATED_COMPATIBILITY = 'No validated compatibility data'
export const SCENARIO_LABEL = 'Scenario (modelled, not an actual saving)'
export const STRATEGIES = Object.freeze(['bulk_purchase', 'company_warehouse', 'supplier_managed', 'consignment', 'framework'])

/** Wrap an input with its provenance. source: 'measured' | 'assumption'. */
export function input(value, source = 'assumption', note = null) {
  return { value, source: source === 'measured' ? 'measured' : 'assumption', note }
}

const val = (x) => (x && typeof x === 'object' && 'value' in x ? num(x.value) : num(x))
const src = (x) => (x && typeof x === 'object' && 'source' in x ? x.source : 'assumption')

/**
 * Normalise a scenario's inputs. Returns { values, sources, missing }.
 * Bare numbers are treated as assumptions (nothing is "measured" unless it says so).
 */
function readInputs(params, required) {
  const values = {}
  const sources = {}
  const missing = []
  for (const [k, raw] of Object.entries(params || {})) {
    if (raw === undefined) continue
    values[k] = val(raw)
    sources[k] = src(raw)
  }
  for (const k of required) if (values[k] === null || values[k] === undefined) missing.push(k)
  return { values, sources, missing }
}

const REQUIRED = {
  bulk_purchase: ['annualDemandQty', 'unitPrice', 'years', 'bulkQty', 'holdingCostRate'],
  company_warehouse: ['annualDemandQty', 'unitPrice', 'years', 'holdingCostRate', 'orderQty'],
  supplier_managed: ['annualDemandQty', 'unitPrice', 'years'],
  consignment: ['annualDemandQty', 'unitPrice', 'years'],
  framework: ['annualDemandQty', 'unitPrice', 'years'],
}

/**
 * Model one procurement strategy over a horizon.
 *
 * Common params (each a number or input()):
 *   annualDemandQty, unitPrice, years, currency,
 *   holdingCostRate      (share of average owned stock value per year: storage, insurance, handling)
 *   obsolescenceRate     (share of remaining owned stock value lost per year)
 *   leadTimeDays, safetyStockQty, priceEscalationRate (per year)
 * Strategy params:
 *   bulk_purchase:     bulkQty, bulkDiscountRate
 *   company_warehouse: orderQty
 *   supplier_managed:  servicePremiumRate, minCommitmentValue, commitmentYears, exitFee, onSiteBufferQty
 *   consignment:       consignmentPremiumRate, minCommitmentValue, commitmentYears, buybackRate, onSiteQty
 *   framework:         frameworkDiscountRate, minCommitmentValue, commitmentYears
 */
export function simulateStrategy(strategy, params = {}) {
  if (!STRATEGIES.includes(strategy)) return { ok: false, reason: 'unknown_strategy', strategy }
  const { values: p, sources, missing } = readInputs(params, REQUIRED[strategy])
  const currency = String(params.currency?.value ?? params.currency ?? '').toUpperCase() || null
  const assumptions = Object.entries(sources).filter(([, s]) => s === 'assumption').map(([k]) => k)
  const base = { strategy, kind: 'scenario', label: SCENARIO_LABEL, currency, assumptions, measuredInputs: Object.keys(sources).filter((k) => sources[k] === 'measured') }
  if (missing.length) return { ok: false, reason: 'missing_inputs', missing, ...base }
  if (!currency) return { ok: false, reason: 'currency_required', missing: ['currency'], ...base }

  const years = Math.max(1, Math.round(p.years))
  const demand = p.annualDemandQty
  const esc = p.priceEscalationRate ?? 0
  const hold = p.holdingCostRate ?? 0
  const obs = p.obsolescenceRate ?? 0
  const safety = p.safetyStockQty ?? 0
  const yearly = []
  let totals = { purchaseSpend: 0, holdingCost: 0, obsolescenceCost: 0, feesAndPremium: 0, totalCost: 0 }
  let peakWorkingCapital = 0
  let exitExposure = 0
  let remainingStockQtyEnd = 0

  if (strategy === 'bulk_purchase') {
    // One upfront purchase at the discounted price, drawn down by demand.
    const price = p.unitPrice * (1 - (p.bulkDiscountRate ?? 0))
    let stock = p.bulkQty
    const spend = roundMoney(p.bulkQty * price)
    peakWorkingCapital = spend
    for (let y = 1; y <= years; y++) {
      const open = stock
      const used = Math.min(open, demand)
      let close = open - used
      const lost = close * obs
      close -= lost
      const shortfall = Math.max(0, demand - used)
      const topUpPrice = p.unitPrice * (1 + esc) ** (y - 1)
      const avgValue = ((open + close) / 2) * price
      const row = {
        year: y,
        purchaseSpend: roundMoney((y === 1 ? spend : 0) + shortfall * topUpPrice),
        averageWorkingCapital: roundMoney(avgValue),
        holdingCost: roundMoney(avgValue * hold),
        obsolescenceCost: roundMoney(lost * price),
        feesAndPremium: 0,
        closingStockQty: close,
        shortfallBoughtQty: shortfall,
      }
      yearly.push(row)
      stock = close
    }
    remainingStockQtyEnd = stock
    exitExposure = roundMoney(stock * price) // stock left at horizon: paid for, unused
  } else if (strategy === 'company_warehouse') {
    // Buy as needed in lots of orderQty; owned average stock = safety + order/2.
    const avgQty = safety + p.orderQty / 2
    for (let y = 1; y <= years; y++) {
      const price = p.unitPrice * (1 + esc) ** (y - 1)
      const avgValue = avgQty * price
      yearly.push({
        year: y,
        purchaseSpend: roundMoney(demand * price),
        averageWorkingCapital: roundMoney(avgValue),
        holdingCost: roundMoney(avgValue * hold),
        obsolescenceCost: roundMoney(avgValue * obs),
        feesAndPremium: 0,
      })
      peakWorkingCapital = Math.max(peakWorkingCapital, roundMoney((safety + p.orderQty) * price))
    }
    remainingStockQtyEnd = avgQty
    exitExposure = roundMoney(safety * p.unitPrice * (1 + esc) ** (years - 1))
  } else {
    // Supplier-managed, consignment, framework: company does not own buffer stock
    // (VMI: supplier owns until delivery; consignment: until issue; framework:
    // a price agreement, the company still buys as it needs).
    const premium = strategy === 'supplier_managed' ? p.servicePremiumRate ?? 0 : strategy === 'consignment' ? p.consignmentPremiumRate ?? 0 : -(p.frameworkDiscountRate ?? 0)
    const ownedBuffer = strategy === 'framework' ? safety : strategy === 'supplier_managed' ? p.onSiteBufferQty ?? 0 : 0
    const commitment = p.minCommitmentValue ?? 0
    const cYears = p.commitmentYears ?? years
    let spentInCommitment = 0
    for (let y = 1; y <= years; y++) {
      const price = p.unitPrice * (1 + esc) ** (y - 1)
      const paid = demand * price * (1 + premium)
      const avgValue = ownedBuffer * price
      yearly.push({
        year: y,
        purchaseSpend: roundMoney(demand * price),
        averageWorkingCapital: roundMoney(avgValue),
        holdingCost: roundMoney(avgValue * hold),
        obsolescenceCost: roundMoney(avgValue * obs),
        feesAndPremium: roundMoney(paid - demand * price),
      })
      if (y <= cYears) spentInCommitment += paid
      peakWorkingCapital = Math.max(peakWorkingCapital, roundMoney(avgValue))
    }
    // Shortfall against the minimum commitment is payable on exit / at term end.
    const shortfall = Math.max(0, commitment - spentInCommitment)
    const buyback = strategy === 'consignment' ? (p.onSiteQty ?? 0) * p.unitPrice * (1 - (p.buybackRate ?? 1)) : 0
    exitExposure = roundMoney(shortfall + (p.exitFee ?? 0) + Math.max(0, buyback))
    if (shortfall > 0) {
      yearly[Math.min(years, cYears) - 1].feesAndPremium = roundMoney(yearly[Math.min(years, cYears) - 1].feesAndPremium + shortfall)
    }
    remainingStockQtyEnd = ownedBuffer
  }

  for (const r of yearly) {
    r.totalCost = roundMoney(r.purchaseSpend + r.holdingCost + r.obsolescenceCost + r.feesAndPremium)
    totals = {
      purchaseSpend: roundMoney(totals.purchaseSpend + r.purchaseSpend),
      holdingCost: roundMoney(totals.holdingCost + r.holdingCost),
      obsolescenceCost: roundMoney(totals.obsolescenceCost + r.obsolescenceCost),
      feesAndPremium: roundMoney(totals.feesAndPremium + r.feesAndPremium),
      totalCost: roundMoney(totals.totalCost + r.totalCost),
    }
  }
  const avgWorkingCapital = roundMoney(yearly.reduce((a, r) => a + r.averageWorkingCapital, 0) / yearly.length)

  return {
    ok: true,
    ...base,
    years,
    yearly,
    totals,
    averageWorkingCapital: avgWorkingCapital,
    peakWorkingCapital: roundMoney(peakWorkingCapital),
    contractExitExposure: exitExposure,
    remainingStockQtyEnd,
    serviceLevelRisk: serviceLevelRisk(strategy, p),
  }
}

/**
 * Service-level risk from cover vs lead time. Qualitative + the numbers behind it.
 * cover days = owned or guaranteed buffer / daily demand.
 */
export function serviceLevelRisk(strategy, p = {}) {
  const daily = num(p.annualDemandQty) > 0 ? p.annualDemandQty / 365 : null
  const lead = num(p.leadTimeDays)
  if (daily === null || lead === null) return { level: 'unknown', reason: daily === null ? 'demand_unknown' : 'lead_time_unknown' }
  let buffer
  if (strategy === 'bulk_purchase') buffer = num(p.bulkQty) ?? 0
  else if (strategy === 'company_warehouse') buffer = (num(p.safetyStockQty) ?? 0) + (num(p.orderQty) ?? 0) / 2
  else if (strategy === 'supplier_managed') buffer = num(p.onSiteBufferQty) ?? 0
  else if (strategy === 'consignment') buffer = num(p.onSiteQty) ?? 0
  else buffer = num(p.safetyStockQty) ?? 0
  const coverDays = Math.round((buffer / daily) * 10) / 10
  const level = coverDays >= lead * 1.5 ? 'low' : coverDays >= lead ? 'medium' : 'high'
  return { level, coverDays, leadTimeDays: lead, reason: null }
}

/**
 * Compare an alternative strategy against a baseline. Outputs are scenario
 * differences, never savings:
 *   workingCapitalReleased  = baseline avg working capital - alternative (cash not tied in stock)
 *   modelledCostDifference  = baseline total cost - alternative total cost (positive = alternative cheaper in the model)
 *   exitExposureChange      = alternative exit exposure - baseline
 */
export function compareStrategies(baseline, alternative) {
  if (!baseline?.ok || !alternative?.ok) return { ok: false, reason: 'scenario_incomplete', kind: 'scenario' }
  if (baseline.currency !== alternative.currency) return { ok: false, reason: 'mixed_currency', kind: 'scenario' }
  const allAssumptions = [...new Set([...baseline.assumptions, ...alternative.assumptions])]
  return {
    ok: true,
    kind: 'scenario',
    label: SCENARIO_LABEL,
    currency: baseline.currency,
    baseline: baseline.strategy,
    alternative: alternative.strategy,
    workingCapitalReleased: {
      value: roundMoney(baseline.averageWorkingCapital - alternative.averageWorkingCapital),
      peak: roundMoney(baseline.peakWorkingCapital - alternative.peakWorkingCapital),
      note: 'Cash not tied up in owned stock. Not a cost saving.',
    },
    modelledCostDifference: {
      value: roundMoney(baseline.totals.totalCost - alternative.totals.totalCost),
      byComponent: Object.fromEntries(Object.keys(baseline.totals).map((k) => [k, roundMoney(baseline.totals[k] - alternative.totals[k])])),
      note: 'Modelled difference over the horizon under the stated inputs. Not an actual saving.',
    },
    exitExposureChange: roundMoney(alternative.contractExitExposure - baseline.contractExitExposure),
    serviceLevelRisk: { baseline: baseline.serviceLevelRisk, alternative: alternative.serviceLevelRisk },
    assumptionsUsed: allAssumptions,
    fullyMeasured: allAssumptions.length === 0,
  }
}

/**
 * Brand-change (or model-change) exposure. Compatibility is used ONLY from
 * validated records; anything else reads NO_VALIDATED_COMPATIBILITY.
 *
 * items = [{ item_id, onHandQty, unitCost, currency, monthlyConsumptionQty }]
 * compatibility = [{ item_id, compatible_with_new: boolean, status: 'validated'|... , approved_by }]
 * options = { monthsUntilChange }
 * For each item:
 *   - validated + compatible   -> keeps being used after the change, no stranding
 *   - validated + incompatible -> stranded qty = on hand - consumption until the change
 *   - not validated            -> exposure unknown (listed separately, not guessed)
 */
export function brandChangeExposure(items = [], compatibility = [], { monthsUntilChange } = {}) {
  const months = num(monthsUntilChange)
  if (months === null || months < 0) return { ok: false, reason: 'months_until_change_required', kind: 'scenario' }
  const validated = new Map()
  for (const c of compatibility) {
    if (String(c.status ?? '').toLowerCase() === 'validated' && c.approved_by && typeof c.compatible_with_new === 'boolean') validated.set(c.item_id, c)
  }
  const byCurrency = {}
  const lines = []
  for (const it of items) {
    const cur = String(it.currency ?? '').toUpperCase() || 'N/A'
    const s = (byCurrency[cur] ||= { strandedValue: 0, strandedQty: 0, unvaluedStrandedLines: 0, unknownCompatibilityLines: 0, unknownCompatibilityQty: 0, compatibleLines: 0 })
    const onHand = num(it.onHandQty) ?? 0
    const c = validated.get(it.item_id)
    if (!c) {
      s.unknownCompatibilityLines += 1
      s.unknownCompatibilityQty += onHand
      lines.push({ item_id: it.item_id, status: NO_VALIDATED_COMPATIBILITY, strandedQty: null, strandedValue: null })
      continue
    }
    if (c.compatible_with_new) {
      s.compatibleLines += 1
      lines.push({ item_id: it.item_id, status: 'compatible (validated)', strandedQty: 0, strandedValue: 0 })
      continue
    }
    const monthly = num(it.monthlyConsumptionQty)
    if (monthly === null) {
      s.unknownConsumptionLines = (s.unknownConsumptionLines || 0) + 1
      lines.push({ item_id: it.item_id, status: 'incompatible (validated)', strandedQty: null, strandedValue: null, reason: 'consumption_unknown' })
      continue
    }
    const stranded = Math.max(0, onHand - monthly * months)
    const cost = num(it.unitCost)
    s.strandedQty += stranded
    if (cost === null) {
      if (stranded > 0) s.unvaluedStrandedLines += 1
    } else s.strandedValue = roundMoney(s.strandedValue + stranded * cost)
    lines.push({ item_id: it.item_id, status: 'incompatible (validated)', strandedQty: stranded, strandedValue: cost === null ? null : roundMoney(stranded * cost) })
  }
  for (const s of Object.values(byCurrency)) {
    s.strandedValueComplete = s.unvaluedStrandedLines === 0
    s.note = s.unknownCompatibilityLines > 0 ? `${NO_VALIDATED_COMPATIBILITY} for ${s.unknownCompatibilityLines} item(s); their exposure is not estimated.` : null
  }
  return { ok: true, kind: 'scenario', label: SCENARIO_LABEL, byCurrency, lines }
}

/**
 * Convenience: run several strategies on the same base inputs and compare each
 * with the first. Used by the Planning & simulation section.
 */
export function runScenarioSet(baseParams, strategies = []) {
  const runs = strategies.map(({ strategy, params }) => simulateStrategy(strategy, { ...baseParams, ...params }))
  const [first, ...rest] = runs
  return {
    kind: 'scenario',
    label: SCENARIO_LABEL,
    runs,
    comparisons: first?.ok ? rest.map((r) => compareStrategies(first, r)) : [],
  }
}
