# 22 - Planning and simulation method

Engine: `src/lib/inventory/simulation.js`. Tests: `src/test/inventorySimulation.test.js`.
Surface: Inventory Control Center -> Planning & simulation (WEB lane).

## Honesty rules (owner rule 5)

1. Every result has `kind: 'scenario'` and the label **"Scenario (modelled, not an actual saving)"**.
   The words "saving/savings" are never used for a modelled figure (a test asserts it).
2. Every input carries a source: `input(value, 'measured' | 'assumption', note)`. A bare number is an
   assumption. Results list `assumptions` and `measuredInputs`; a comparison is `fullyMeasured` only when
   no assumption was used.
3. Required inputs missing -> `ok: false`, `reason: 'missing_inputs'`, `missing: [...]`. No defaults are
   invented for demand, price, horizon or holding rate.
4. Currency required; comparisons across currencies are refused.
5. Compatibility comes only from validated records (`status: 'validated'` and `approved_by` set). Anything
   else reads **"No validated compatibility data"**; descriptions are never used to infer it.

## Strategies (`simulateStrategy(strategy, params)`)

Common inputs: `annualDemandQty`, `unitPrice`, `years`, `currency`, `holdingCostRate` (share of average
owned stock value per year), `obsolescenceRate` (share of remaining owned stock lost per year),
`leadTimeDays`, `safetyStockQty`, `priceEscalationRate`.

| Strategy | Owned stock modelled | Specific inputs |
|---|---|---|
| `bulk_purchase` | One upfront buy of `bulkQty` at `unitPrice x (1 - bulkDiscountRate)`, drawn down by demand; obsolescence removes a share of the remainder each year; any shortfall is bought at the escalated price | `bulkQty`, `bulkDiscountRate` |
| `company_warehouse` | Average owned qty = `safetyStockQty + orderQty / 2`; buy as needed | `orderQty` |
| `supplier_managed` (VMI) | Supplier owns until delivery; company owns only `onSiteBufferQty` | `servicePremiumRate`, `minCommitmentValue`, `commitmentYears`, `exitFee`, `onSiteBufferQty` |
| `consignment` | Supplier owns until issue; company owns nothing | `consignmentPremiumRate`, `minCommitmentValue`, `commitmentYears`, `buybackRate`, `onSiteQty` |
| `framework` | Price agreement; company buys as needed and owns its safety stock | `frameworkDiscountRate`, `minCommitmentValue`, `commitmentYears` |

Per year: purchase spend, average working capital (owned stock value), holding cost, obsolescence cost,
fees and premium (premium, minimum-commitment shortfall), total cost. Totals over the horizon.
`contractExitExposure`: bulk = paid-for stock left at horizon; warehouse = safety stock; VMI/consignment/
framework = commitment shortfall + exit fee + consignment buyback loss.
`serviceLevelRisk`: cover days (buffer / daily demand) vs lead time -> low (>= 1.5 x lead) / medium (>= lead)
/ high; `unknown` with a reason when demand or lead time is missing.

## Comparison (`compareStrategies(baseline, alternative)`)

Two separate outputs, never merged:
- **Working capital released** = baseline average owned stock value - alternative ("cash not tied up in
  owned stock. Not a cost saving.").
- **Modelled cost difference** = baseline total cost - alternative total cost, with per-component split
  ("Modelled difference over the horizon under the stated inputs. Not an actual saving.").
Plus exit exposure change and both service-level risks.

### Worked example (pinned by test): SAR 15M bulk vs SAR 1M supplier commitment

Inputs: demand 5,000 tyres/yr (measured), price SAR 1,000 (measured), 3 years, holding 12%/yr,
obsolescence 2%/yr, lead time 30 d (assumptions). Bulk 15,000 units. VMI premium 3%, minimum commitment
SAR 1,000,000 over 3 years.

| | Bulk 15M | Supplier managed 1M commitment |
|---|---|---|
| Purchase spend | 15,296,000 (296 units topped up in year 3 after obsolescence) | 15,000,000 |
| Holding cost | 2,640,480 | 0 |
| Obsolescence | 296,000 | 0 |
| Fees / premium | 0 | 450,000 |
| Total modelled cost | 18,232,480 | 15,450,000 |
| Average working capital | 7,334,666.67 (peak 15,000,000) | 0 |
| Exit exposure | 0 | 0 (commitment met) |

Result: working capital released SAR 7,334,666.67 and modelled cost difference SAR 2,782,480, both shown
as scenario figures with the assumption list. Neither is an actual saving.

## Brand-change exposure (`brandChangeExposure(items, compatibility, { monthsUntilChange })`)

Per item on hand: validated + compatible -> no stranding; validated + incompatible -> stranded qty =
`on hand - monthly consumption x months until change`, valued at its unit cost; not validated ->
"No validated compatibility data", exposure **not estimated** and counted in `unknownCompatibilityLines`.
Today there are 0 validated OEM links (doc 04 section 2.6), so most items will read "No validated
compatibility data" until engineering approves cross-references.

## Where inputs come from (WEB lane)

Measured: annual demand (inventory issues or first-fit tyre demand from `newTyreDemand`, doc 24), unit
price (WAC or validated quote), lead time (from `leadTimeVariance`). Everything else is an assumption the
user types, shown as such.
