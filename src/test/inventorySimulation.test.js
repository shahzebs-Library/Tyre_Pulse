import { describe, it, expect } from 'vitest'
import {
  input, simulateStrategy, compareStrategies, brandChangeExposure, runScenarioSet, serviceLevelRisk,
  NO_VALIDATED_COMPATIBILITY, SCENARIO_LABEL, STRATEGIES,
} from '../lib/inventory/simulation'

const base = {
  currency: 'SAR',
  annualDemandQty: input(5000, 'measured', '12 months of grid tyre issues'),
  unitPrice: input(1000, 'measured'),
  years: input(3, 'assumption'),
  holdingCostRate: input(0.12, 'assumption'),
  obsolescenceRate: input(0.02, 'assumption'),
  leadTimeDays: input(30, 'assumption'),
}

describe('SAR 15M bulk purchase vs SAR 1M supplier commitment', () => {
  const bulk = simulateStrategy('bulk_purchase', { ...base, bulkQty: input(15000, 'assumption') })
  const vmi = simulateStrategy('supplier_managed', { ...base, servicePremiumRate: input(0.03, 'assumption'), minCommitmentValue: input(1000000, 'assumption'), commitmentYears: 3 })

  it('bulk: 15M upfront, drawn down, holding and obsolescence modelled per year', () => {
    expect(bulk.ok).toBe(true)
    expect(bulk.yearly[0].purchaseSpend).toBe(15000000)
    expect(bulk.peakWorkingCapital).toBe(15000000)
    expect(bulk.totals).toEqual({ purchaseSpend: 15296000, holdingCost: 2640480, obsolescenceCost: 296000, feesAndPremium: 0, totalCost: 18232480 })
    expect(bulk.averageWorkingCapital).toBe(7334666.67)
    expect(bulk.yearly[2].shortfallBoughtQty).toBe(296)
    expect(bulk.contractExitExposure).toBe(0)
  })

  it('supplier managed: premium paid, commitment met, no owned stock', () => {
    expect(vmi.totals.totalCost).toBe(15450000)
    expect(vmi.averageWorkingCapital).toBe(0)
    expect(vmi.contractExitExposure).toBe(0)
  })

  it('comparison separates working capital released from modelled cost difference, never a saving', () => {
    const c = compareStrategies(bulk, vmi)
    expect(c.kind).toBe('scenario')
    expect(c.label).toBe(SCENARIO_LABEL)
    expect(c.workingCapitalReleased.value).toBe(7334666.67)
    expect(c.workingCapitalReleased.note).toMatch(/Not a cost saving/)
    expect(c.modelledCostDifference.value).toBe(2782480)
    expect(c.modelledCostDifference.note).toMatch(/Not an actual saving/)
    expect(c.fullyMeasured).toBe(false)
    expect(c.assumptionsUsed).toEqual(expect.arrayContaining(['years', 'holdingCostRate', 'bulkQty', 'servicePremiumRate']))
    expect(JSON.stringify(c)).not.toMatch(/"saving"|savings/i)
  })
})

describe('inputs and provenance', () => {
  it('lists assumptions and measured inputs', () => {
    const r = simulateStrategy('company_warehouse', { ...base, orderQty: 500, safetyStockQty: input(200, 'measured') })
    expect(r.measuredInputs).toEqual(expect.arrayContaining(['annualDemandQty', 'unitPrice', 'safetyStockQty']))
    expect(r.assumptions).toContain('orderQty')
  })
  it('missing required inputs -> no result, with the list', () => {
    const r = simulateStrategy('bulk_purchase', { currency: 'SAR', unitPrice: 1 })
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(expect.arrayContaining(['annualDemandQty', 'years', 'bulkQty', 'holdingCostRate']))
  })
  it('currency required and unknown strategy refused', () => {
    expect(simulateStrategy('framework', { ...base, currency: undefined }).reason).toBe('currency_required')
    expect(simulateStrategy('crypto', base).reason).toBe('unknown_strategy')
    expect(STRATEGIES).toHaveLength(5)
  })
})

describe('other strategies', () => {
  it('company warehouse: owned average stock = safety + order/2', () => {
    const r = simulateStrategy('company_warehouse', { ...base, orderQty: 1000, safetyStockQty: 200 })
    expect(r.averageWorkingCapital).toBe(700000)
    expect(r.totals.holdingCost).toBe(252000)
    expect(r.serviceLevelRisk.level).toBe('low')
  })
  it('consignment: no owned value, commitment shortfall becomes exit exposure', () => {
    const r = simulateStrategy('consignment', { ...base, annualDemandQty: 100, years: 1, consignmentPremiumRate: 0.05, minCommitmentValue: 500000, onSiteQty: 50 })
    expect(r.averageWorkingCapital).toBe(0)
    expect(r.contractExitExposure).toBe(395000)
    expect(r.totals.feesAndPremium).toBe(400000)
  })
  it('framework: discount applies, owned safety stock carried', () => {
    const r = simulateStrategy('framework', { ...base, years: 1, frameworkDiscountRate: 0.05, safetyStockQty: 100 })
    expect(r.totals.feesAndPremium).toBe(-250000)
    expect(r.averageWorkingCapital).toBe(100000)
  })
  it('price escalation compounds yearly', () => {
    const r = simulateStrategy('company_warehouse', { ...base, orderQty: 0, priceEscalationRate: 0.1 })
    expect(r.yearly.map((y) => y.purchaseSpend)).toEqual([5000000, 5500000, 6050000])
  })
  it('compare refuses mixed currency or failed runs', () => {
    const a = simulateStrategy('framework', base)
    const b = simulateStrategy('framework', { ...base, currency: 'AED' })
    expect(compareStrategies(a, b).reason).toBe('mixed_currency')
    expect(compareStrategies(a, { ok: false }).reason).toBe('scenario_incomplete')
  })
  it('runScenarioSet compares each to the first', () => {
    const s = runScenarioSet(base, [
      { strategy: 'company_warehouse', params: { orderQty: 1000 } },
      { strategy: 'consignment', params: {} },
    ])
    expect(s.comparisons).toHaveLength(1)
    expect(s.comparisons[0].alternative).toBe('consignment')
  })
})

describe('service level risk', () => {
  it('cover vs lead time; unknown when inputs missing', () => {
    expect(serviceLevelRisk('consignment', { annualDemandQty: 365, leadTimeDays: 10, onSiteQty: 5 })).toMatchObject({ level: 'high', coverDays: 5 })
    expect(serviceLevelRisk('consignment', { annualDemandQty: 365 }).level).toBe('unknown')
  })
})

describe('brand change exposure', () => {
  const items = [
    { item_id: 'A', onHandQty: 100, unitCost: 900, currency: 'SAR', monthlyConsumptionQty: 20 },
    { item_id: 'B', onHandQty: 50, unitCost: 800, currency: 'SAR', monthlyConsumptionQty: 5 },
    { item_id: 'C', onHandQty: 30, unitCost: 700, currency: 'SAR', monthlyConsumptionQty: 1 },
    { item_id: 'D', onHandQty: 10, unitCost: 600, currency: 'SAR', monthlyConsumptionQty: 1 },
  ]
  const compat = [
    { item_id: 'A', compatible_with_new: false, status: 'validated', approved_by: 'eng-1' },
    { item_id: 'B', compatible_with_new: true, status: 'validated', approved_by: 'eng-1' },
    { item_id: 'C', compatible_with_new: false, status: 'proposed' },
    // D: no record at all - never inferred from its description
  ]
  it('only validated compatibility counts; the rest is "No validated compatibility data"', () => {
    const r = brandChangeExposure(items, compat, { monthsUntilChange: 3 })
    const by = Object.fromEntries(r.lines.map((l) => [l.item_id, l]))
    expect(by.A).toMatchObject({ strandedQty: 40, strandedValue: 36000 })
    expect(by.B.strandedQty).toBe(0)
    expect(by.C.status).toBe(NO_VALIDATED_COMPATIBILITY)
    expect(by.D.status).toBe(NO_VALIDATED_COMPATIBILITY)
    expect(by.D.strandedValue).toBe(null)
    expect(r.byCurrency.SAR).toMatchObject({ strandedValue: 36000, unknownCompatibilityLines: 2, unknownCompatibilityQty: 40 })
    expect(r.byCurrency.SAR.note).toMatch(NO_VALIDATED_COMPATIBILITY)
    expect(r.kind).toBe('scenario')
  })
  it('requires the months until the change', () => {
    expect(brandChangeExposure(items, compat, {}).ok).toBe(false)
  })
})
