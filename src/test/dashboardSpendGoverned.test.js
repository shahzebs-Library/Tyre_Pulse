/**
 * Dashboard tyre spend reads the GOVERNED expense grid, not cost_per_tyre
 * (Loop 11, F-F-01). The legacy Dashboard headlined tyre cost from
 * report_tyre_summary.total_cost = sum(cost_per_tyre*qty) - several-fold low, and
 * on the All scope a SAR+AED+EGP blend labelled SAR.
 *
 * Source is READ (not the page imported) on purpose: "which source feeds the cost
 * tile" is a fact about the file, and importing Dashboard drags in the whole app.
 * The reconciliation case proves the figure Dashboard shows equals what Expenses &
 * CPK and Board Overview show, because all three extract the tyre bucket from the
 * same governed split.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickCost } from '../lib/costSources'

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
// Drop // line comments so the comments that discuss these patterns by name do
// not satisfy a grep for the pattern itself.
const code = (p) => read(p).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

describe('Dashboard cost tile is governed, never a cost_per_tyre blend', () => {
  const src = code('src/pages/Dashboard.jsx')

  it('the total-cost figure reads the governed split in every mode (no legacy tyres branch)', () => {
    // The old code returned stats.cost (report_tyre_summary blend) whenever the
    // mode was 'tyres'. That branch must be gone.
    expect(src).not.toMatch(/if\s*\(\s*costMode\s*===\s*'tyres'[^)]*\)\s*return\s+stats\.cost/)
    // totalCostFigure must come from costSplit (the governed grid).
    expect(src).toMatch(/totalCostFigure[\s\S]{0,200}pickCost\(\s*costMode\s*,\s*\{\s*tyre:\s*costSplit\.tyre/)
    expect(src).toMatch(/loadGovernedCostSplit/)
  })

  it('on a blended (All) scope the cost tile shows per-country figures, never one SAR number', () => {
    // The tile value is a CostValue (one line per currency) when blended.
    expect(src).toMatch(/costSplit\?\.blended[\s\S]{0,120}<CostValue/)
  })

  it('the money charts are withheld on the All scope (no SAR-labelled blend)', () => {
    // isAllScope gates the monthly-trend / top-assets / top-sites / spend-split
    // charts so none renders a single-currency money chart across three currencies.
    expect(src).toMatch(/const\s+isAllScope\s*=/)
    expect(src).toMatch(/isAllScope\s*\?\s*mixedCostNote/)
    // The chart titles carry the per-country label, not activeCurrency, on All.
    expect(src).toMatch(/costCurrencyLabel/)
  })

  it('the fleet KPI no longer calls an assets-with-tyre count "Fleet Vehicles" (F-K-11)', () => {
    expect(src).toMatch(/Assets with tyre activity/)
    expect(src).not.toMatch(/label=\{tf\('dashboard\.kpi\.fleetVehicles', 'Fleet Vehicles'\)\}/)
  })
})

describe('Dashboard / Expenses & CPK / Board Overview read the same tyre figure', () => {
  it('all three extract the tyre bucket from one governed split, so the totals reconcile', () => {
    // One governed window fixture (what loadGovernedCostSplit / loadCostSplit yield
    // for a single country): tyre and maintenance in one currency.
    const split = { tyre: 12_351_493.87, maintenance: 30_597_619.08, currency: 'SAR', blended: false }

    // Dashboard: pickCost('tyres', { tyre, maintenance }).
    const dashboardTyre = pickCost('tyres', { tyre: split.tyre, maintenance: split.maintenance })
    // Expenses & CPK (loadGovernedCost): totals.tyre.amount == split.tyre.
    const expensesCpkTyre = split.tyre
    // Board Overview: costTotals.tyre from the same grid split.
    const boardOverviewTyre = split.tyre

    expect(dashboardTyre).toBe(split.tyre)
    expect(dashboardTyre).toBe(expensesCpkTyre)
    expect(dashboardTyre).toBe(boardOverviewTyre)
    // And it is NOT the legacy cost_per_tyre sum (which on this live scope was
    // 4,270,910.34 against the grid's 12,351,493.87).
    expect(dashboardTyre).not.toBe(4_270_910.34)
  })
})
