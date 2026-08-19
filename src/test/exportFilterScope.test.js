import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A source-scan guard against exports and headline figures drifting back off
 * the filtered set.
 *
 * THE RULE IT ENFORCES: a page that filters a list must export the FILTERED
 * list, and a figure printed above a filtered table must be computed over the
 * same population. Both regressions are invisible in code review because the
 * defective line looks identical to the correct one: `recalls.map(...)` and
 * `filtered.map(...)` differ by one identifier, and the resulting file opens
 * fine, looks complete, and is wrong.
 *
 * WHY THIS IS POLICED IN SOURCE RATHER THAN BY RENDERING THE PAGE: every one of
 * these export handlers builds a PDF or an XLSX through a dynamic import and
 * writes a file. Exercising them needs the real jspdf/xlsx and a DOM save path,
 * which the existing page tests deliberately mock out - and a mocked export
 * cannot see which array was handed to it. The identifier IS the defect, so the
 * identifier is what is asserted.
 *
 * Each case names the exact defect it is standing on, so a future edit that
 * trips it can tell whether it reintroduced the bug or merely renamed a
 * variable (in which case update the case, do not delete it).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * Every case: a page, a fragment that MUST be present (the filtered form), and
 * a fragment that must NOT be present (the unfiltered form that shipped).
 */
const CASES = [
  {
    file: 'pages/RecallTracker.jsx',
    what: 'PDF recall table',
    // The register table renders `filtered` and prints "N of M recalls" beneath
    // it. The PDF body mapped `recalls`, so filtering to Critical + Active and
    // exporting produced every recall ever recorded, under a safety title.
    required: 'body: filtered.map(r => [',
    forbidden: 'body: recalls.map(r => [',
  },
  {
    file: 'pages/RecallTracker.jsx',
    what: 'Excel recall sheet',
    required: 'const recallRows = filtered.map(r => ({',
    forbidden: 'const recallRows = recalls.map(r => ({',
  },
  {
    file: 'pages/RecallTracker.jsx',
    what: 'Excel affected-tyres sheet',
    // Affected tyres must be derived from the recalls actually in the file, or
    // the sheet names a recall the first sheet left out.
    required: 'const affectedRows = []\n    filtered.forEach(r => {',
    forbidden: 'const affectedRows = []\n    recalls.forEach(r => {',
  },
  {
    file: 'pages/RetreadManagement.jsx',
    what: 'Excel export',
    // The lifecycle table renders `filtered` (site/brand/risk/search); both
    // exports mapped the whole `enriched` array, CPK and cost included.
    required: 'const rows = filtered.map(t => ({',
    forbidden: 'const rows = enriched.map(t => ({',
  },
  {
    file: 'pages/RetreadManagement.jsx',
    what: 'PDF export',
    required: 'exportToPdf(\n      filtered.map(t => ({',
    forbidden: 'exportToPdf(\n      enriched.map(t => ({',
  },
  {
    file: 'pages/SiteComparison.jsx',
    what: 'Excel export',
    // The page exists to compare a CHOSEN subset and every chart reads
    // `filteredMetrics`; all three exports shipped `allMetrics`.
    required: 'exportToExcel(filteredMetrics,',
    forbidden: 'exportToExcel(allMetrics,',
  },
  {
    file: 'pages/SiteComparison.jsx',
    what: 'PDF export',
    required: "exportToPdf(filteredMetrics, SITE_COLS, 'Site Comparison'",
    forbidden: "exportToPdf(allMetrics, SITE_COLS, 'Site Comparison'",
  },
  {
    file: 'pages/TyreSpecifications.jsx',
    what: 'Spec Library Excel export',
    // The library renders `filteredSpecs`; the export mapped `specs`, and its
    // neighbour in the same toolbar was already filter-aware.
    required: 'const rows = filteredSpecs.map(s => ({',
    forbidden: 'const rows = specs.map(s => ({',
  },
  {
    file: 'pages/WarrantyTracker.jsx',
    what: 'PDF brand page scope',
    // Page 1 listed `filtered` while the Brand Performance page came from the
    // screen aggregate over a wider population, under one title.
    required: 'const exportBrandPerf = computeBrandPerf(filtered)',
    forbidden: 'body: brandPerf.map(b => [',
  },
  {
    file: 'pages/WarrantyTracker.jsx',
    what: 'Excel failure sheet scope',
    required: 'const exportFailures = computeFailureCounts(filtered)',
    forbidden: 'XLSX.utils.json_to_sheet(failureCounts.map(f => ({',
  },
  {
    file: 'pages/WorkOrders.jsx',
    what: 'page subtitle count',
    // `orders` is the 20-row SERVER PAGE, so the subtitle quoted the page size
    // as the total: a 15,933-card window read "20 total".
    required: "t('workorders.subtitle', { count: total.toLocaleString() })",
    forbidden: "t('workorders.subtitle', { count: orders.length })",
  },
  {
    file: 'pages/Procurement.jsx',
    what: 'spend KPI population',
    // Spend, pending value and lead time read the whole `orders` array while
    // the table read `filtered`, and the filter bar sits BELOW the tiles.
    // Scoped to the `kpis` memo: the budget panel keeps a whole-register spend
    // on purpose (the budget is one annual company-wide figure), so an
    // unscoped search would match that deliberate line instead.
    within: ['const kpis = useMemo', '// Budget variance DELIBERATELY'],
    required: 'const spend = filtered\n      .filter',
    forbidden: 'const spend = orders\n      .filter',
  },
  {
    file: 'pages/VehicleHistory.jsx',
    what: 'summary strip population',
    // One filter card, two scopes: the date range moved the tiles, the site
    // select in the SAME card did not.
    required: "value: scopedRows.length,",
    forbidden: "value: vehicleRows.length,",
  },
]

describe('exports and headline figures follow the filters on screen', () => {
  for (const c of CASES) {
    it(`${c.file}: ${c.what} covers the filtered set`, () => {
      let src = read(c.file)
      // Some pages hold a DELIBERATE whole-register figure beside the filtered
      // one, so a case can narrow the scan to the region that owns the defect.
      if (c.within) {
        const from = src.indexOf(c.within[0])
        const to = src.indexOf(c.within[1])
        expect(from, `${c.file} lost the region marker ${c.within[0]}`).toBeGreaterThan(-1)
        expect(to, `${c.file} lost the region marker ${c.within[1]}`).toBeGreaterThan(from)
        src = src.slice(from, to)
      }
      expect(
        src.includes(c.required),
        `${c.file} no longer contains the filtered form: ${JSON.stringify(c.required)}. ` +
        'If the variable was renamed, update this case; do not delete it.',
      ).toBe(true)
      expect(
        src.includes(c.forbidden),
        `${c.file} reintroduced the unfiltered form: ${JSON.stringify(c.forbidden)} ` +
        `for the ${c.what}. An export must cover the whole filtered set, and a figure ` +
        'printed above a filtered table must be computed over the same rows.',
      ).toBe(false)
    })
  }
})

describe('capped documents disclose the cap', () => {
  /**
   * Where a cap must stay (a document built in memory, or an emailed
   * attachment), the caption has to say when it bites. A PDF headed
   * "500 records" built from 1,200 filtered rows is a false statement that
   * outlives the screen it came from.
   */
  const CAPPED = [
    {
      file: 'pages/PredictiveMaintenance.jsx',
      cap: 'PDF_ROW_CAP',
      // :862 sliced at 500 with no disclosure at all.
      discloses: 'narrow the filters to include the rest',
    },
    {
      file: 'pages/ReportCenter.jsx',
      cap: 'PDF_ROW_CAP',
      // `partialExport` was set only from the 40,000-row FETCH cap, so an
      // 8,000-row report said "Report generated and downloaded" and delivered
      // 200 rows.
      discloses: 'narrow the date range for the rest',
      alsoRequires: 'partialExport = truncated || pdfCapped',
    },
    {
      file: 'pages/Reports.jsx',
      cap: 'EMAIL_PDF_ROW_CAP',
      // kpiSummary sent "Total Records: 12,000" into the PDF summary table AND
      // the email body while the attachment held 5,000 rows.
      discloses: 'narrow the filters to include the rest',
      alsoRequires: "'Rows In Attached PDF'",
    },
  ]

  for (const c of CAPPED) {
    it(`${c.file}: the row cap is named and disclosed`, () => {
      const src = read(c.file)
      expect(src.includes(`const ${c.cap} =`), `${c.file} lost its named ${c.cap}`).toBe(true)
      expect(src.includes(`.slice(0, ${c.cap})`), `${c.file} caps with a bare number instead of ${c.cap}`).toBe(true)
      expect(
        src.includes(c.discloses),
        `${c.file} caps its rows without telling the reader. Keep the cap, make the caption honest.`,
      ).toBe(true)
      if (c.alsoRequires) {
        expect(src.includes(c.alsoRequires), `${c.file} lost ${c.alsoRequires}`).toBe(true)
      }
    })
  }

  it('exportToPdf still supports the subtitleNote a capped caller uses', () => {
    const src = read('lib/exportUtils.js')
    expect(src.includes('opts.subtitleNote')).toBe(true)
    expect(src.includes('${rows.length.toLocaleString()} records${scopeNote}')).toBe(true)
  })
})
