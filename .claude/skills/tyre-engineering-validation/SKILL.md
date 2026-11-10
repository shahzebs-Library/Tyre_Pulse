---
name: tyre-engineering-validation
description: Verify Tyre Pulse tyre engineering maths and lifecycle data before trusting or changing any KPI - CPK (cost per km / per hour), tyre life, running and remaining life bands, km caps, one price per tyre, warranty and repair exclusions, double-active wheels, serial on two assets, placeholder meters. Use for "check CPK", "tyre life wrong", "running life", "tyre cost audit", "lifecycle reconciliation", "is this KPI right", or before touching src/lib/tyre*.js, kpiEngine.js or any get_*_cpk / tyre_* RPC.
---

# Tyre engineering validation

Act as the senior tyre engineer: a KPI is right only when its inputs are physically possible AND the JS mirror
equals the SQL that produced the number on screen.

## Single sources (change BOTH sides, then run the pinning test)
| Rule | JS | SQL | Pin test |
|---|---|---|---|
| km life, placeholder fitment (1 = placeholder, 0 = factory), class caps mixer 80k / pump 56k / loader 15k / else 100k | `src/lib/tyreKm.js` | `tyre_km_life`, `tyre_life_km_cap` | `src/test/tyreKm*.test.js` |
| running/remaining bands, both budgets (km AND hours) worst-wins, due-soon = least(10000, 10%) / least(500, 10%) | `src/lib/tyreRunningLife.js` (`measureFor`) | `get_tyre_running_life` (`is_due`) | `tyreRunningLifeBands.test.js` |
| weighted fleet CPK = total cost / total km, one price per tyre | `src/lib/tyreLifetime.js`, `kpiEngine.withOnePricePerTyre` | `get_fleet_cpk`, `fleet_tyre_km_by_asset` | `kpiEngineCore.test.js` |
| price evidence: same item code + SAME month, warranty never repriced, tube/flap/valve/repair never a tyre price | `src/lib/tyreCostAudit.js` | `tyre_cost_audit_classify` | `tyreCostAudit*.test.js` |
| strong serial (needs a digit; month codes, sizes, placeholders are weak) | `isStrongSerial` | `tyre_serial_is_strong` | pinned live answers |
| wear rule: under-inflation = SHOULDER wear, over-inflation = centre | `_shared/aiAgents.ts` WEAR_RULES | - | aiRouter tests |

## Procedure
1. Read `docs/tyre/BUSINESS_RULES.md` and `docs/tyre/CALCULATION_SOURCE_MAP.md`; list which surfaces still compute
   per fitment row (known: all server CPK RPCs + ~40 web helpers). Never add a 41st.
2. Parity: `select pg_get_functiondef('public.<fn>'::regproc)` (SELECT only) and diff the branches against the JS.
3. Physical sanity on live data (cheap aggregates, read-only):
   - double-active per (asset, position) = 0; strong serial active on 2 assets = 0; removal before fitment = 0;
   - total_km above the class cap -> must be NULL, never shown; km_at_fitment in (0,1) counted and labelled;
   - unknown price renders "Cost Pending Verification", never 0; mixed currencies never summed.
4. KPI cross-check: the same number on Dashboard, Engineering KPI, Expenses & CPK, Board Overview and the PDF
   must come from one engine; if two differ, the one reading the expense grid (`loadGovernedCostSplit`) wins.
5. Record: rule, where it lives, live counts, mismatches, owner decisions (e.g. one-month gap rule).

## Refuse
Estimating a price from other months, inventing a meter reading, rendering an unmeasurable KPI as 0 or 100%,
collapsing hours into km, or "fixing" a mirror on one side only.
