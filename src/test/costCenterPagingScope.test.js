import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * CostCenter was converted from render-everything tables to the shared 50-a-page
 * pager. This guard stands on the two ways that conversion can go wrong in a way
 * nobody notices, because on screen both look right.
 *
 * 1. AN EXPORT THAT COVERS THE PAGE INSTEAD OF THE FILTERED SET.
 *    `bySite.map(...)` and `sitePager.pageRows.map(...)` differ by one
 *    identifier. The resulting spreadsheet opens fine, is titled "Cost by Site",
 *    and silently holds 50 of however many sites. PROJECT_MEMORY records exactly
 *    this near-miss on WorkOrders.
 *
 * 2. A MONEY FIGURE COMPUTED FROM A PAGE.
 *    A spend headline derived from 50 rows is a wrong financial number that
 *    still looks authoritative. Every total, chart and anomaly on this page must
 *    read the full array, never `*Pager.pageRows`.
 *
 * WHY SOURCE-SCANNED RATHER THAN RENDERED: the exports build XLSX/PDF through a
 * dynamic import and write a file; the page's own tests mock that out, and a
 * mocked export cannot see WHICH array it was handed. The identifier is the
 * defect, so the identifier is what is asserted. Same reasoning as
 * exportFilterScope.test.js, which this file sits beside.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(ROOT, 'pages/CostCenter.jsx'), 'utf8').replace(/\r\n/g, '\n')

/** Strip block and line comments so prose about a defect cannot satisfy a check. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('CostCenter tables keep exports and money on the full set', () => {
  // The four dimension tables and the production list moved from the private
  // 50-a-page pager to the shared EnterpriseTable (sortable, searchable, its
  // own full-set export). The guards below keep the SAME two failure modes out.
  it('renders the dimension and production tables through EnterpriseTable', () => {
    expect(code).toContain("import EnterpriseTable from '../components/ui/EnterpriseTable'")
    for (const data of ['bySite', 'byBrand', 'byVehicle', 'byMonth', 'prodRows']) {
      expect(code, `${data} must feed an EnterpriseTable in full`).toContain(`data={${data}}`)
    }
    expect(code).not.toContain('usePagedRows(')
    expect(code).not.toMatch(/<table\b/)
  })

  it('exports the full filtered set, never a visible page', () => {
    expect(code).toContain('bySite.map(s => ({')
    expect(code).toContain('byBrand.map(b => ({')
    expect(code).toContain('byVehicle.map(v => ({')
    expect(code).not.toMatch(/pageRows/)
  })

  it('never sums cost_per_tyre into a headline spend total', () => {
    // The KPI strip reads the expense grid through the governed split.
    expect(code).toMatch(/loadGovernedCostSplit\(\{\s*country: activeCountry, from: dateFrom/)
    expect(code).toContain('<CostValue split={spendSplit} mode="tyres" compact />')
    expect(code).not.toMatch(/reduce\([^)]*cost_per_tyre/)
  })

  it('computes every chart over the full array', () => {
    expect(code).toContain('const top8  = bySite.slice(0, 8)')
    expect(code).toContain('const top10 = byVehicle.slice(0, 10)')
  })

  it('keeps the anomaly feed on the population it always scanned', () => {
    // Which assets a manager is alerted about is a product decision, not a side
    // effect of how the vehicle table pages.
    expect(code).toContain('const byVehicleTop50 = useMemo(() => byVehicle.slice(0, 50), [byVehicle])')
    expect(code).toContain('vehicles: byVehicleTop50')
  })

  it('says so when the production list stopped at its own server limit', () => {
    expect(code).toContain('const PROD_ROW_LIMIT = 200')
    expect(code).toContain('limit: PROD_ROW_LIMIT')
    expect(code).toContain('const prodAtLimit = prodRows.length >= PROD_ROW_LIMIT')
    expect(code).toContain('{prodAtLimit && (')
    // The site picker reads every loaded row, not the page.
    expect(code).toContain('for (const r of prodRows) if (r?.site) set.add(r.site)')
  })
})
