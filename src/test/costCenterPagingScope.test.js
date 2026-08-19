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
const src = readFileSync(join(ROOT, 'pages/CostCenter.jsx'), 'utf8')

/** Strip block and line comments so prose about a defect cannot satisfy a check. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('CostCenter paging keeps exports and money on the full set', () => {
  it('pages the two long tables through the shared pager, not a private one', () => {
    expect(code).toContain("from '../components/ui/TablePagination'")
    // 95 brands and 555 assets carry tyre records - both past one page.
    expect(code).toContain('const brandPager = usePagedRows(byBrand)')
    expect(code).toContain('const vehiclePager = usePagedRows(byVehicle)')
    expect(code).toContain('{brandPager.pageRows.map(b => (')
    expect(code).toContain('{vehiclePager.pageRows.map(v => (')
    expect(code).toContain('<TablePagination {...brandPager} />')
    expect(code).toContain('<TablePagination {...vehiclePager} />')
  })

  it('exports the full filtered set, never the visible page', () => {
    // Both exports build their rows from bySite in full. bySite is not paged at
    // all (23 sites), but the assertion is what stops a later edit repointing an
    // export at whichever pager happens to exist on this page.
    expect(code).toContain('bySite.map(s => ({')
    for (const pager of ['brandPager', 'vehiclePager', 'prodPager']) {
      expect(
        code.includes(`exportToExcel(\n        ${pager}.pageRows`),
        `exportToExcel must not read ${pager}.pageRows`,
      ).toBe(false)
      expect(
        code.includes(`${pager}.pageRows.map(s => ({`),
        `an export must not map ${pager}.pageRows`,
      ).toBe(false)
    }
  })

  it('computes every money figure and chart over the full array', () => {
    // The doughnut, the top-10 asset bar and the brand CPK bar each slice the
    // FULL sorted array. Reading a page here would make "top 10 by cost" mean
    // "top 10 on the page the reader happens to be on".
    expect(code).toContain('const top8  = bySite.slice(0, 8)')
    expect(code).toContain('const other = bySite.slice(8).reduce((s, r) => s + r.totalCost, 0)')
    expect(code).toContain('const top10 = byVehicle.slice(0, 10)')
    expect(code).toContain('labels: byBrand.slice(0, 10).map(b => b.brand)')

    // Nothing anywhere may aggregate a page.
    for (const m of ['reduce', 'slice']) {
      for (const pager of ['brandPager', 'vehiclePager', 'prodPager']) {
        expect(
          new RegExp(`${pager}\\.pageRows\\s*\\.?\\s*${m}\\(`).test(code),
          `${pager}.pageRows must not be ${m}()d into a figure`,
        ).toBe(false)
      }
    }
  })

  it('keeps the anomaly feed on the population it always scanned', () => {
    // Lifting the By Vehicle table's old .slice(0, 50) made 555 assets reachable.
    // The anomaly feed must NOT silently widen with it: which assets a manager is
    // alerted about is a product decision, not a side effect of paging a table.
    expect(code).toContain('const byVehicleTop50 = useMemo(() => byVehicle.slice(0, 50), [byVehicle])')
    expect(code).toContain('byVehicleTop50.forEach(v => {')
    expect(code).not.toContain('byVehicle.forEach(v => {')
  })

  it('says so when the production list stopped at its own server limit', () => {
    // listProduction asks for at most PROD_ROW_LIMIT rows. Without the notice the
    // pager's "of 200" reads as the total for the range, which it is not.
    expect(code).toContain('const PROD_ROW_LIMIT = 200')
    expect(code).toContain('limit: PROD_ROW_LIMIT')
    expect(code).toContain('const prodAtLimit = prodRows.length >= PROD_ROW_LIMIT')
    expect(code).toContain('{prodAtLimit && (')
    // The site picker reads every loaded row, not the page.
    expect(code).toContain('for (const r of prodRows) if (r?.site) set.add(r.site)')
  })
})
