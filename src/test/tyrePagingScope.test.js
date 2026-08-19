import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * PAGING A REGISTER MUST NOT CHANGE WHAT ANY NUMBER MEANS.
 *
 * The inspection register, the bulk serial lookup, the scrapped register and the
 * two derived tyre-exchange registers now render one page at a time through the
 * shared `usePagedRows`. That is a rendering change and nothing more - but the
 * two ways it silently goes wrong are both one identifier long, and both produce
 * a page that looks entirely correct:
 *
 *   1. AN EXPORT REPOINTED AT THE PAGE. `exportToExcel(pager.pageRows, ...)`
 *      writes a fifty-row file that opens fine, is headed with the report's own
 *      title, and is missing most of the register. PROJECT_MEMORY records this
 *      as the near-miss on the Work Orders paging work, and it is the reason
 *      that page reports truncation rather than clipping.
 *
 *   2. A HEADLINE REPOINTED AT THE PAGE. "435 inspections done" becoming "50"
 *      turns a summary into a per-page number, which is exactly the defect the
 *      filter-awareness work fixed a few commits earlier.
 *
 * Neither is visible in review: `filtered` and `pager.pageRows` differ by one
 * token, and neither breaks a render. So the identifier is what is asserted.
 *
 * This is a source scan for the same reason `exportFilterScope.test.js` is one -
 * every export here builds a real PDF or XLSX through a dynamic import and a DOM
 * save path, and a mocked export cannot see which array it was handed.
 *
 * If a variable is renamed, UPDATE the case. Do not delete it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** Every file in this session's paging pass, whether or not it gained a pager. */
const PAGED_SURFACES = [
  'pages/Inspections.jsx',
  'pages/SerialTracker.jsx',
  'pages/TyreExchange.jsx',
  'pages/TyreRecords.jsx',
  'pages/TyreLifecycle.jsx',
  'components/tyre/TyreChangeTracking.jsx',
]

describe('a paged register still exports the whole filtered set', () => {
  /**
   * The blanket rule. No export call on any of these surfaces may take a page
   * as its rows - whatever the pager happens to be called. This catches a
   * variable this file has never heard of, which the per-case list below cannot.
   */
  const EXPORT_TAKES_A_PAGE = /export(?:ToExcel|ToPdf|InspectionDetailPdf)\(\s*(?:\/\/[^\n]*\n\s*)?[\w$]*[Pp]ager\.pageRows/

  for (const file of PAGED_SURFACES) {
    it(`${file}: no export is handed a single page`, () => {
      const src = read(file)
      const hit = src.match(EXPORT_TAKES_A_PAGE)
      expect(
        hit,
        `${file} exports a PAGE rather than the filtered set (${hit ? hit[0] : ''}). ` +
        'A fifty-row file that carries the full report title reads as complete and is not. ' +
        'Export the filtered array; if the set must be capped, say so in the document.',
      ).toBe(null)
    })
  }

  /**
   * The named cases: the exact array each export shipped before paging existed,
   * so a repoint is caught even if it uses some other short name.
   */
  const EXPORT_CASES = [
    {
      file: 'pages/Inspections.jsx',
      what: 'register Excel export',
      // The register renders one page of `filtered`; the export must still
      // carry every row the filters left.
      required: 'await exportToExcel(\n                filtered,',
    },
    {
      file: 'pages/Inspections.jsx',
      what: 'register PDF export',
      required: 'await exportToPdf(\n                filtered,',
    },
    {
      file: 'pages/SerialTracker.jsx',
      what: 'bulk lookup Excel export',
      // Deliberately the UNfiltered results: the sheet is the answer to the
      // whole pasted list, and the chips above it are a view filter. Either way
      // it is a superset of the page, which is what matters here.
      required: 'exportToExcel(\n        bulkResults,',
    },
    {
      file: 'pages/TyreExchange.jsx',
      what: 'transfer history PDF export',
      required: 'exportToPdf(\n      filteredTransfers,',
    },
    {
      file: 'pages/TyreExchange.jsx',
      what: 'transfer history Excel sheet',
      required: 'XLSX.utils.json_to_sheet(filteredTransfers.map(t => ({',
    },
  ]

  for (const c of EXPORT_CASES) {
    it(`${c.file}: ${c.what} still covers the full set`, () => {
      expect(
        read(c.file).includes(c.required),
        `${c.file} no longer contains the whole-set form: ${JSON.stringify(c.required)}. ` +
        'If the variable was renamed, update this case; do not delete it.',
      ).toBe(true)
    })
  }
})

describe('a paged register still counts the whole filtered set', () => {
  /**
   * Every figure printed OUTSIDE the table body. Each of these was computed over
   * the full filtered population before paging and must stay there - the reader
   * is being told how many rows their filters left, not how many fit on a page.
   */
  const SUMMARY_CASES = [
    {
      file: 'pages/Inspections.jsx',
      what: 'overview tiles',
      // The tiles answer for every row the filters left, minus their own
      // drill-down. `scoped` is that set; a page would make "372 approved"
      // read 50 and the tile strip would stop being a summary.
      required: 'inspectionOverview(scoped, flagMap || {})',
    },
    {
      file: 'pages/Inspections.jsx',
      what: 'rows-shown caption',
      // "195 of 407 shown" is about the FILTERS. The pagination bar states the
      // page range separately, and the two must not be collapsed into one.
      required: '{filtered.length}{filtered.length !== tabFiltered.length ? ` of ${tabFiltered.length}` : \'\'} shown',
    },
    {
      file: 'pages/Inspections.jsx',
      what: 'status pill counts',
      // Each pill states how many rows clicking it would show, over every other
      // filter. Counting a page would print (0) on pills that hold hundreds.
      required: 'const c = { all: base.length, Scheduled: 0',
    },
    {
      file: 'pages/SerialTracker.jsx',
      what: 'bulk lookup result caption',
      required: 'Showing {filteredBulkResults.length} of {bulkResults.length} results',
    },
    {
      file: 'pages/SerialTracker.jsx',
      what: 'scrapped register count',
      required: '`${scrapList.length} tyre${scrapList.length !== 1 ? \'s\' : \'\'} marked as scrap`',
    },
  ]

  for (const c of SUMMARY_CASES) {
    it(`${c.file}: ${c.what} is computed over the filtered set`, () => {
      expect(
        read(c.file).includes(c.required),
        `${c.file} no longer computes the ${c.what} over the filtered set: ` +
        `${JSON.stringify(c.required)}. A summary that counts one page is a ` +
        'per-page number wearing a headline\'s label.',
      ).toBe(true)
    })
  }

  /**
   * The mirror of the rule above, stated as a prohibition so a NEW headline
   * cannot be born reading a page. `pageRows` belongs in a table body, never in
   * a `.length` that is printed as a total or fed to a summary builder.
   */
  const HEADLINE_READS_A_PAGE = /[\w$]*[Pp]ager\.pageRows\.length\s*(?:\}|\)|,)/

  for (const file of PAGED_SURFACES) {
    it(`${file}: no printed total is taken from a page`, () => {
      const src = read(file)
      // The virtualizer legitimately sizes itself from the page it draws, which
      // is a row COUNT for layout and not a figure anyone reads.
      const cleaned = src.replace(/count:\s*[\w$]*[Pp]ager\.pageRows\.length,/g, '')
      const hit = cleaned.match(HEADLINE_READS_A_PAGE)
      expect(
        hit,
        `${file} reads a page length where a total is expected (${hit ? hit[0] : ''}). ` +
        'State the filtered total; the pagination bar already states the page range.',
      ).toBe(null)
    })
  }
})

describe('the long tyre registers are actually paged', () => {
  /**
   * The owner asked for this: "all 300 inspections load at once, make it less".
   * These cases pin that each long list goes through the ONE shared pager rather
   * than reverting to a full render or growing a second pagination of its own.
   *
   * The three surfaces that already paged before this session are listed too, so
   * a future edit cannot quietly remove their bound either.
   */
  const CASES = [
    {
      file: 'pages/Inspections.jsx',
      what: 'the inspection register',
      // 435 inspections today and growing with every sheet the field records.
      requires: [
        'const pager = usePagedRows(filtered)',
        'const r = pager.pageRows[virtualRow.index]',
        '<TablePagination {...pager} />',
      ],
      // The virtualizer must draw the PAGE, not the whole filtered set.
      forbids: 'const r = filtered[virtualRow.index]',
    },
    {
      file: 'pages/SerialTracker.jsx',
      what: 'the bulk serial lookup',
      requires: [
        'const bulkPager  = usePagedRows(filteredBulkResults)',
        '{bulkPager.pageRows.map(r => (',
        '<TablePagination {...bulkPager} />',
      ],
      forbids: '{filteredBulkResults.map(r => (',
    },
    {
      file: 'pages/SerialTracker.jsx',
      what: 'the scrapped register',
      requires: [
        'const scrapPager = usePagedRows(filteredScrapList)',
        '{scrapPager.pageRows.map(r => (',
        '<TablePagination {...scrapPager} />',
      ],
      forbids: '{filteredScrapList.map(r => (',
    },
    {
      file: 'pages/TyreExchange.jsx',
      what: 'the retread register',
      // Empty on the live data today, but derived from every tyre record the
      // country holds with no ceiling of its own.
      requires: [
        'const retreadPager = usePagedRows(retreads)',
        'retreadPager.pageRows.map((r, idx) => (',
        '<TablePagination {...retreadPager} />',
      ],
      forbids: 'retreads.map((r, idx) => (',
    },
    {
      file: 'pages/TyreExchange.jsx',
      what: 'the pending returns register',
      requires: [
        'const pendingPager = usePagedRows(pendingReturns)',
        'pendingPager.pageRows.map((p, idx) => (',
        '<TablePagination {...pendingPager} />',
      ],
      forbids: 'pendingReturns.map((p, idx) => (',
    },
    {
      file: 'pages/TyreExchange.jsx',
      what: 'the transfer history (its own pager, predates this pass)',
      requires: ['txPagedData.map(t => ('],
      forbids: 'filteredTransfers.map(t => (\n',
    },
    {
      file: 'pages/TyreRecords.jsx',
      what: 'the tyre records grid (SERVER paged, do not page it twice)',
      // 11,200 rows: the bound has to stay on the server, so the page must keep
      // asking for one page rather than pulling the table into the browser.
      requires: ['page, pageSize: PAGE_SIZE,'],
      forbids: 'usePagedRows(',
    },
    {
      file: 'pages/TyreLifecycle.jsx',
      what: 'the lifecycle table (its own pager, predates this pass)',
      requires: ['filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)'],
      forbids: '{filtered.map(r => {',
    },
    {
      file: 'components/tyre/TyreChangeTracking.jsx',
      what: 'the flagged tyre table (EnterpriseTable pages it)',
      requires: ['initialPageSize={25}'],
      forbids: 'filtered.map((r) => (\n',
    },
  ]

  for (const c of CASES) {
    it(`${c.file}: ${c.what} renders one page at a time`, () => {
      const src = read(c.file)
      for (const frag of c.requires) {
        expect(
          src.includes(frag),
          `${c.file} lost the paging wiring for ${c.what}: ${JSON.stringify(frag)}. ` +
          'The whole point is that the register does not render every row at once.',
        ).toBe(true)
      }
      if (c.forbids) {
        expect(
          src.includes(c.forbids),
          `${c.file} renders ${c.what} in full again: ${JSON.stringify(c.forbids)}.`,
        ).toBe(false)
      }
    })
  }

  it('every pager on these surfaces is the shared one', () => {
    // A second pagination implementation is how two registers end up disagreeing
    // about what a page is. `usePagedRows` owns the clamping and the reset rule.
    for (const file of ['pages/Inspections.jsx', 'pages/SerialTracker.jsx', 'pages/TyreExchange.jsx']) {
      const src = read(file)
      if (!src.includes('usePagedRows')) continue
      expect(
        src.includes("from '../components/ui/TablePagination'"),
        `${file} uses a pager without importing the shared one.`,
      ).toBe(true)
    }
  })
})
