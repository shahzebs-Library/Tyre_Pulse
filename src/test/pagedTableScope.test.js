import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A source-scan guard for the four registers whose long tables are paged.
 *
 * WHAT PAGING IS ALLOWED TO CHANGE, AND WHAT IT IS NOT
 * ---------------------------------------------------
 * A page is a reading convenience. It narrows WHICH ROWS ARE ON SCREEN and
 * nothing else. Two things must therefore keep reading the full filtered set:
 *
 *   1. EVERY EXPORT. Repointing an export at the current page ships a file that
 *      opens fine, is formatted correctly, carries the right title, and holds
 *      50 of 15,933 rows. Nobody downstream can tell. This is the near-miss
 *      already recorded against WorkOrders in PROJECT_MEMORY.
 *   2. EVERY HEADLINE FIGURE AND ROW-COUNT CAPTION. A tile computed over the
 *      page turns "Total Cost" into "cost of the 50 rows you happen to be
 *      looking at", and it changes when you press Next - a number that moves
 *      under a heading that did not.
 *
 * WHY SOURCE-SCANNED RATHER THAN RENDERED: these are page components with no
 * exported seam, and the defect is WHICH ARRAY an aggregate or an export was
 * handed. `filteredOrders` and `jobsPager.pageRows` differ by one identifier,
 * both compile, both render, and only one is right. The identifier IS the
 * defect, so the identifier is what is asserted. This is the style of
 * rowCapGuard and exportFilterScope, deliberately.
 *
 * Each case names the defect it stands on. If a future edit trips one, work out
 * whether it reintroduced the bug or merely renamed a variable - in the second
 * case update the case, do not delete it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * required: the correct, full-filtered-set form.
 * forbidden: the page-scoped form that would be the regression.
 */
const CASES = [
  // ── WorkshopManagement: the job grid, paged with the shared hook ──────────
  {
    file: 'pages/WorkshopManagement.jsx',
    what: 'Excel export covers the whole filtered set',
    // The grid renders 50 jobs; the export must still write every job the
    // filters left. A 15,933-card window exported as 50 rows looks complete.
    required: 'exportToExcel(\n      filteredOrders,',
    forbidden: 'exportToExcel(\n      jobsPager.pageRows,',
  },
  {
    file: 'pages/WorkshopManagement.jsx',
    what: 'the row-count caption quotes the filtered total',
    // "N jobs" is about the filters. Which page you are on is the pager's
    // sentence, and it states its own range separately.
    required: '{filteredOrders.length.toLocaleString()} job',
    forbidden: '{jobsPager.pageRows.length.toLocaleString()} job',
  },
  {
    file: 'pages/WorkshopManagement.jsx',
    what: 'the empty state asks about the filtered set, not the page',
    // Reading the page here would print "no work orders found" whenever the
    // reader walked past the last page.
    required: '{filteredOrders.length === 0 ? (',
    forbidden: '{jobsPager.pageRows.length === 0 ? (',
  },
  {
    file: 'pages/WorkshopManagement.jsx',
    what: 'the table body renders the page',
    required: 'jobsPager.pageRows.map((job, i) => (',
    forbidden: 'filteredOrders.map((job, i) => (',
  },

  // ── AssetManagement: the register, paged against a URL-borne page ─────────
  {
    file: 'pages/AssetManagement.jsx',
    what: 'Excel export covers the whole filtered set',
    required: 'const rows = filteredAssets.map(a => ({',
    forbidden: 'const rows = pageAssets.map(a => ({',
  },
  {
    file: 'pages/AssetManagement.jsx',
    what: 'PDF export covers the whole filtered set',
    required: 'exportToPdf(\n        filteredAssets.map(a => ({',
    forbidden: 'exportToPdf(\n        pageAssets.map(a => ({',
  },
  {
    file: 'pages/AssetManagement.jsx',
    what: 'the row-count caption quotes the filtered total',
    required: '{filteredAssets.length} asset',
    forbidden: '{pageAssets.length} asset',
  },
  {
    file: 'pages/AssetManagement.jsx',
    what: 'the five tiles still count the filtered set, holding out their own dimensions',
    // These tiles break down status and risk, so those two filters are held out
    // for them alone (see applyAssetFilters). Computing them over the PAGE
    // would restate the page size five different ways.
    required: 'applyAssetFilters(enrichedAssets, { status: true, risk: true })',
    forbidden: 'applyAssetFilters(pageAssets, { status: true, risk: true })',
  },
  {
    file: 'pages/AssetManagement.jsx',
    what: 'the table body renders the page',
    required: '{pageAssets.map((a, i) => {',
    forbidden: '{filteredAssets.map((a, i) => {',
  },

  // ── Accidents: EnterpriseTable owns the paging; it is handed everything ───
  {
    file: 'pages/Accidents.jsx',
    what: 'the table is handed the whole filtered set and pages it itself',
    // EnterpriseTable slices internally. Handing it a pre-sliced array would
    // page an already-paged page, and its own "N of M" footer would then be
    // counting the slice.
    required: 'data={filtered}',
    forbidden: 'data={filtered.slice(',
  },
  {
    file: 'pages/Accidents.jsx',
    what: 'the Excel export covers the whole filtered set',
    required: '() => filtered.map(r => {',
    forbidden: '() => filtered.slice(0,',
  },
  {
    file: 'pages/Accidents.jsx',
    what: 'the tiles read the register-scoped set',
    // registerScoped is the filtered set minus the four toggles the tiles
    // themselves break down. Paging must not reach it.
    required: 'computeAccidentStats(registerScoped, fleetCount)',
    forbidden: 'computeAccidentStats(filtered.slice(',
  },

  // ── FleetMaster: paged on the SERVER; the export re-reads the full set ────
  {
    file: 'pages/FleetMaster.jsx',
    what: 'the register is paged server-side, not sliced in the browser',
    // `records` is already only one page of rows. Slicing it again would page
    // a page; loading every row to slice it would undo the server bound.
    required: 'manualPagination',
    forbidden: 'records.slice(',
  },
  {
    file: 'pages/FleetMaster.jsx',
    what: 'the export re-reads every matching row rather than exporting the page',
    // This is the one export on the four pages that CANNOT map an in-memory
    // filtered set, because the browser only ever holds one page. It pages the
    // server itself. Exporting `records` would write exactly 50 vehicles.
    required: 'fetchAll().then(rows => {',
    forbidden: 'exportToExcel(\n        records,',
  },
]

describe('paged registers: the page narrows the screen, never the export or the figures', () => {
  for (const c of CASES) {
    it(`${c.file}: ${c.what}`, () => {
      const src = read(c.file)
      expect(
        src.includes(c.required),
        `${c.file} lost "${c.required}" - ${c.what}`,
      ).toBe(true)
      expect(
        src.includes(c.forbidden),
        `${c.file} reintroduced "${c.forbidden}" - ${c.what}`,
      ).toBe(false)
    })
  }

  /**
   * One pager, not several. The whole point of the shared component is that a
   * reader meets the same control on every table; a page that hand-rolls its
   * own drifts in size, in labelling and in whether it clamps.
   */
  const SHARED_BAR = [
    { file: 'pages/WorkshopManagement.jsx', uses: '<TablePagination {...jobsPager} />' },
    { file: 'pages/AssetManagement.jsx', uses: '<TablePagination' },
  ]

  for (const c of SHARED_BAR) {
    it(`${c.file}: renders the shared pagination bar`, () => {
      const src = read(c.file)
      expect(
        src.includes("from '../components/ui/TablePagination'"),
        `${c.file} stopped importing the shared pager`,
      ).toBe(true)
      expect(src.includes(c.uses), `${c.file} stopped rendering ${c.uses}`).toBe(true)
      // The hand-rolled strip these replaced: a numbered button per page, built
      // with Array.from. Its return is a second pager, which is what this bans.
      expect(
        /Array\.from\(\{ length: Math\.min\(\d+, totalPages\)/.test(src),
        `${c.file} hand-rolled a second page-number strip. Use TablePagination.`,
      ).toBe(false)
    })
  }

  it('WorkshopManagement still says its read is bounded, paged or not', () => {
    const src = read('pages/WorkshopManagement.jsx')
    // The grid is capped at 20,000 rows in a 12-month default window. Paging
    // makes the table shorter; it does NOT make a bounded read complete, and a
    // reader who cannot see the bound will read the last page as the last job.
    expect(src.includes('loadMeta.truncated')).toBe(true)
    expect(src.includes('Most recent {allOrders.length.toLocaleString()}')).toBe(true)
  })

  it('Accidents pages at the app-wide default of 50', () => {
    const src = read('pages/Accidents.jsx')
    expect(src.includes('initialPageSize={50}')).toBe(true)
  })
})
