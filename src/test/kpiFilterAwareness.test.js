import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A guard against KPI tiles drifting back to the UNFILTERED row array.
 *
 * THE DEFECT IT POLICES: on a register page the summary tiles are computed over
 * the raw rows while the table beneath them is computed over the filtered ones.
 * Filter to one site and the tiles keep stating fleet-wide numbers - on several
 * of these pages directly above a caption reading "18 of 1,617 shown", so the
 * two numbers contradict each other inside one viewport. The owner's instruction
 * was "anything should be filter aware".
 *
 * WHY THIS IS A SOURCE SCAN rather than a rendered test. These are page
 * components wired to AuthContext, SettingsContext, the router, supabase,
 * chart.js and twenty-odd API modules; the repo's own accidentsWorkflow test
 * records that rendering one is impractical, and the aggregates are local
 * `useMemo`s with no exported seam. What CAN be pinned exactly is the thing that
 * regresses: which array each aggregate is handed. A one-token edit
 * (`registerScoped` -> `records`) reintroduces the whole defect, is invisible in
 * review, and is caught here.
 *
 * TWO RULES ARE PINNED, both taken from the reference implementation at
 * src/pages/Inspections.jsx:1129-1215:
 *
 *  1. A tile that is ALSO a filter toggle holds out its OWN dimension. Counted
 *     over the already-filtered set it just restates the table's row count the
 *     moment it is pressed, and stops being a target you can aim at.
 *  2. When the tiles cover a narrowed set, the page SAYS SO next to them. A
 *     silently narrowed KPI is the same defect one level down.
 */

const PAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'pages')
const src = (f) => readFileSync(join(PAGES, f), 'utf8')
// Collapse runs of whitespace so a reformat cannot fail the guard, while an
// actual change of ARGUMENT still does.
const flat = (f) => src(f).replace(/\s+/g, ' ')

/**
 * `expect(source).toContain(needle)` prints the ENTIRE 160 kB page as the
 * received value, which buries the one line that matters. These assert on a
 * boolean with the needle in the message instead, so a failure reads as one
 * sentence naming exactly what is missing.
 */
const must = (hay, needle, why) =>
  expect(hay.includes(needle), `${why}\n  MISSING from the source: ${needle}`).toBe(true)
const mustNot = (hay, needle, why) =>
  expect(hay.includes(needle), `${why}\n  the source STILL contains: ${needle}`).toBe(false)

describe('KPI tiles are computed over the filtered rows, not the raw ones', () => {
  it('Accidents: the register tiles read the scoped stats, and the delayed toggle holds out its own dimension', () => {
    const s = flat('Accidents.jsx')

    // The tile aggregate is handed the scoped rows.
    must(s, 'const registerStats = useMemo(() => computeAccidentStats(registerScoped, fleetCount)', 'The tile aggregate is handed the scoped rows')
    // ...and the whole-register one stays available for the Analytics tab / PDF.
    must(s, 'const stats = useMemo(() => computeAccidentStats(records, fleetCount)', '...and the whole-register one stays available for the Analytics tab / PDF')

    // Every one of the seven tiles renders the scoped figure.
    for (const tile of [
      "{ v: registerStats.total, label: 'Total Incidents'",
      "{ v: registerStats.open, label: 'Open'",
      "label: 'Total Cost (repair+parts)'",
      "label: 'Avg Cost / Incident'",
      "label: 'At-Fault Rate'",
      "{ v: registerStats.insur, label: 'Insurance Claims'",
    ]) must(s, tile, 'every one of the seven register tiles must render the scoped figure')
    must(s, 'fmtCurrency(registerStats.cost)', 'Every one of the seven tiles renders the scoped figure')
    must(s, 'fmtCurrency(registerStats.avgClaim)', 'Every one of the seven tiles renders the scoped figure')
    must(s, '${registerStats.atFaultPct}%', 'Every one of the seven tiles renders the scoped figure')

    // RULE 1: the Delayed tile IS the delayed toggle, so it reads the hold-out
    // count, never `registerStats.delayed` (which has the filter applied).
    must(s, '{ v: toggleCounts.delayed, label: `Delayed >${DELAY_THRESHOLD_DAYS}d`', 'count, never `registerStats.delayed` (which has the filter applied)')
    must(s, "onClick: () => setFilterDelayed(v => !v)", 'count, never `registerStats.delayed` (which has the filter applied)')
    mustNot(s, '{ v: registerStats.delayed,', 'count, never `registerStats.delayed` (which has the filter applied)')
    mustNot(s, '{ v: stats.delayed,', 'count, never `registerStats.delayed` (which has the filter applied)')

    // The hold-out is real: each toggle count skips its own dimension.
    must(s, "if (skip !== 'delayed' && filterDelayed)", 'The hold-out is real: each toggle count skips its own dimension')
    must(s, "if (skip !== 'claims' && filterOpenClaims)", 'The hold-out is real: each toggle count skips its own dimension')

    // RULE 2: a caption states the scope.
    must(s, 'These figures cover the {registerStats.total} incident', 'RULE 2: a caption states the scope')

    // The old defect, spelled out so a revert is unmistakable.
    mustNot(s, "{ v: stats.total, label: 'Total Incidents'", 'The old defect, spelled out so a revert is unmistakable')
  })

  it('DriverSafety: the KPI cards and every scorecard read the filtered events', () => {
    const s = flat('DriverSafety.jsx')

    must(s, 'const summary = useMemo(() => summariseSafety(filtered)', 'DriverSafety: the KPI cards and every scorecard read the filtered events')
    must(s, 'const scorecard = useMemo(() => driverScorecard(filtered)', 'DriverSafety: the KPI cards and every scorecard read the filtered events')
    must(s, 'const weighted = useMemo(() => weightedDriverScorecard(filtered)', 'DriverSafety: the KPI cards and every scorecard read the filtered events')
    must(s, 'const trend = useMemo(() => weeklyEventTrend(filtered)', 'DriverSafety: the KPI cards and every scorecard read the filtered events')

    // RULE 1: the events-by-type breakdown holds out the event-type filter, or it
    // collapses to a single chip the moment a type is picked.
    must(s, 'const eventTypes = useMemo(() => byEventType(filteredBase)', 'collapses to a single chip the moment a type is picked')
    must(s, 'typeFilter ? filteredBase.filter((r) => r.event_type === typeFilter) : filteredBase', 'collapses to a single chip the moment a type is picked')

    // The "N of M" caption keeps an UNFILTERED denominator, or it reads "12 of 12".
    must(s, '{filtered.length} of {(rows || []).length}', 'The "N of M" caption keeps an UNFILTERED denominator, or it reads "12 of 12"')

    // RULE 2.
    must(s, 'These figures cover the {filtered.length} event', 'RULE 2')

    // The old defect.
    mustNot(s, 'summariseSafety(rows || [])', 'The old defect')
    mustNot(s, 'weightedDriverScorecard(rows || [])', 'The old defect')
  })

  it('AssetManagement: the KPI cards and the charts read the filtered assets', () => {
    const s = flat('AssetManagement.jsx')

    // RULE 1: the tiles hold out the two dimensions they break down.
    must(s, 'applyAssetFilters(enrichedAssets, { status: true, risk: true })', 'RULE 1: the tiles hold out the two dimensions they break down')
    must(s, 'const totalActive = kpiAssets.filter(a => a.active !== false).length', 'RULE 1: the tiles hold out the two dimensions they break down')
    must(s, "const atRisk = kpiAssets.filter(a => a._worstRisk === 'Critical'", 'RULE 1: the tiles hold out the two dimensions they break down')
    must(s, 'const totalYtdCost = kpiAssets.reduce(', 'RULE 1: the tiles hold out the two dimensions they break down')

    // The charts hold out the dimension each one breaks down.
    must(s, 'applyAssetFilters(enrichedAssets, { type: true })', 'The charts hold out the dimension each one breaks down')
    must(s, 'applyAssetFilters(enrichedAssets, { site: true, risk: true })', 'The charts hold out the dimension each one breaks down')

    // RULE 2, on both surfaces (the charts live on a tab that cannot see the
    // filters, so saying nothing there would be a silently narrowed KPI).
    must(s, 'These figures cover the {kpis.covered} asset', 'filters, so saying nothing there would be a silently narrowed KPI)')
    must(s, 'These charts cover the assets matching the filters set on the Registry tab', 'filters, so saying nothing there would be a silently narrowed KPI)')

    // The old defect.
    mustNot(s, 'const atRisk = enrichedAssets.filter(a => a._worstRisk', 'The old defect')
    mustNot(s, 'const totalYtdCost = enrichedAssets.reduce(', 'The old defect')
  })

  it('FleetHealthBoard: the KPI bar reads the scoped vehicles and their own tyres', () => {
    const s = flat('FleetHealthBoard.jsx')

    must(s, 'const total = scopedVehicles.length', 'FleetHealthBoard: the KPI bar reads the scoped vehicles and their own tyres')
    must(s, 'const scopedTyres = scopedVehicles.flatMap(v => v.tyres)', 'FleetHealthBoard: the KPI bar reads the scoped vehicles and their own tyres')
    must(s, 'const criticalVehicles = scopedVehicles.filter(', 'FleetHealthBoard: the KPI bar reads the scoped vehicles and their own tyres')
    must(s, 'const healthyVehicles = scopedVehicles.filter(', 'FleetHealthBoard: the KPI bar reads the scoped vehicles and their own tyres')

    // RULE 1: the risk filter is held out, because two tiles report on risk.
    must(s, 'const filtered = useMemo(() => { return scopedVehicles', 'RULE 1: the risk filter is held out, because two tiles report on risk')
    expect(s).not.toMatch(/const scopedVehicles = useMemo\(\(\) => \{ return vehicles [^}]*riskFilter/)

    // RULE 2.
    must(s, 'These figures cover the {kpis.total} vehicle', 'RULE 2')

    // The old defect: tyre-level tiles counted every loaded tyre.
    mustNot(s, "const atRiskCount = rawRecords.filter(t => ['Critical','High'].includes(t.risk_level)).length", 'The old defect: tyre-level tiles counted every loaded tyre')
    mustNot(s, 'const total = vehicles.length', 'The old defect: tyre-level tiles counted every loaded tyre')
  })

  it('FleetMaster: the summary query applies the same filters as the register', () => {
    const s = flat('FleetMaster.jsx')

    // The summary read is the one that used to apply the country alone.
    const summary = s.slice(s.indexOf('async function loadSummary()'), s.indexOf('loadSummary() }, ['))
    must(summary, 'if (debouncedSearch)', 'The summary read is the one that used to apply the country alone')
    must(summary, "if (siteFilter) q = q.eq('site', siteFilter)", 'The summary read is the one that used to apply the country alone')
    must(summary, "if (activeCountry !== 'All') q = q.eq('country', activeCountry)", 'The summary read is the one that used to apply the country alone')
    // RULE 1: status is held out - the "Active" card reports on exactly that
    // dimension, so applying it would make Total equal Active.
    mustNot(summary, 'statusFilter', 'dimension, so applying it would make Total equal Active')

    // The effect re-runs when those filters move.
    must(s, '}, [activeCountry, debouncedSearch, siteFilter, records])', 'The effect re-runs when those filters move')

    // RULE 2.
    must(s, 'These figures cover the {summary.total.toLocaleString()} vehicle', 'RULE 2')
  })

  it('ComplianceDashboard: inspections and the fleet denominator are country-scoped', () => {
    const s = flat('ComplianceDashboard.jsx')

    // The column has to be SELECTED before it can be filtered on.
    must(s, "id,asset_no,site,country,scheduled_date,status,inspection_type,findings,inspector", 'The column has to be SELECTED before it can be filtered on')
    must(s, "asset_no,site,country,vehicle_type,status", 'The column has to be SELECTED before it can be filtered on')

    // Both halves of the compliance score now answer the same question.
    must(s, 'const filteredInspections = useMemo(() => { let d = inspections.filter(matchesCountry)', 'Both halves of the compliance score now answer the same question')
    must(s, 'const scopedFleet = useMemo(() => { let d = fleetMaster.filter(matchesCountry)', 'Both halves of the compliance score now answer the same question')
    must(s, '...scopedFleet.map(v => v.asset_no)', 'Both halves of the compliance score now answer the same question')

    // RULE 2.
    must(s, 'These figures cover the {treadStats.total.toLocaleString()} tyre', 'RULE 2')

    // The old defect: inspections applied site only, the denominator was every
    // asset in the register.
    mustNot(s, 'let d = [...inspections] if (siteFilter)', 'asset in the register')
    mustNot(s, 'fleetMaster.filter(v => !siteFilter || v.site === siteFilter)', 'asset in the register')
  })
})
