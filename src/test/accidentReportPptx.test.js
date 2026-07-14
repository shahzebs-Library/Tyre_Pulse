/**
 * Accident Report PPTX renderer tests. pptxgenjs is MOCKED (a recording double,
 * like pptxIntegrity.test.js mocks nothing but here we assert on the mocked
 * instance's calls) so we exercise the block -> slide mapping without paying a
 * real OOXML render. We assert: a STARTER config + sample records builds a deck
 * without throwing; a chart block with a live `chartImageFor` image adds an
 * image; a table block adds a table with the filtered row count; empty records
 * stays honest (no throw, still a deck).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── pptxgenjs recording double ──────────────────────────────────────────────
class MockSlide {
  constructor() {
    this.background = null
    this.texts = []
    this.shapes = []
    this.charts = []
    this.tables = []
    this.images = []
  }
  addText(...a) { this.texts.push(a) }
  addShape(...a) { this.shapes.push(a) }
  addChart(...a) { this.charts.push(a) }
  addTable(...a) { this.tables.push(a) }
  addImage(...a) { this.images.push(a) }
}
class MockPptx {
  constructor() {
    this.slides = []
    this.layout = null
    this.theme = null
    this.ChartType = { bar: 'bar', line: 'line', pie: 'pie', doughnut: 'doughnut', radar: 'radar', area: 'area' }
    this.ShapeType = { rect: 'rect', line: 'line' }
    this.defineLayout = vi.fn()
    this.writeFile = vi.fn(async () => 'ok')
  }
  addSlide() { const s = new MockSlide(); this.slides.push(s); return s }
}
vi.mock('pptxgenjs', () => ({ default: MockPptx }))

import { renderAccidentReportPptx, toPptxSeries, chartColorsFor, normalizeHex } from '../lib/accidentReportPptx'
import { STARTER, makeBlock, tableRows } from '../lib/accidentReport'

const SAMPLE = [
  { id: 1, incident_date: '2026-05-02', asset_no: 'T-01', site: 'Riyadh', severity: 'Major', status: 'Open', claim_amount: 12000, claim_approved_amount: 8000, recovered_amount: 5000, repair_cost: 4000, insurer: 'Tawuniya', fault_status: 'faulty', driver_name: 'A. Khan' },
  { id: 2, incident_date: '2026-06-11', asset_no: 'T-02', site: 'Jeddah', severity: 'Minor', status: 'Closed', release_date: '2026-06-20', claim_amount: 3000, claim_approved_amount: 3000, recovered_amount: 3000, repair_cost: 900, insurer: 'Bupa', fault_status: 'non-faulty', driver_name: 'B. Ali' },
  { id: 3, incident_date: '2026-06-15', asset_no: 'T-01', site: 'Riyadh', severity: 'Total Loss', status: 'Open', claim_amount: 50000, claim_approved_amount: 0, recovered_amount: 0, repair_cost: 15000, insurer: 'Tawuniya', fault_status: 'under review', driver_name: 'C. Omar' },
]

describe('renderAccidentReportPptx', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds a deck from a STARTER config + sample records without throwing', async () => {
    const cfg = { blocks: STARTER(), orientation: 'portrait' }
    const res = await renderAccidentReportPptx({ config: cfg, records: SAMPLE, company: 'TyrePulse QA', save: true })
    expect(res.pptx).toBeInstanceOf(MockPptx)
    expect(res.slides.length).toBeGreaterThan(0)
    // 16:9 wide deck
    expect(res.pptx.layout).toBe('LAYOUT_WIDE')
    // filename is ASCII, no dashes/underscores, .pptx extension
    expect(res.filename).toMatch(/\.pptx$/)
    expect(res.filename).not.toMatch(/[_–—→]/)
    // save path writes the file
    expect(res.pptx.writeFile).toHaveBeenCalledTimes(1)
    expect(res.pptx.writeFile).toHaveBeenCalledWith({ fileName: res.filename })
    // header block -> a title/cover slide with the report title text somewhere
    const allText = res.slides.flatMap((s) => s.texts).map((a) => String(a[0])).join(' | ')
    expect(allText).toContain('TyrePulse QA'.toUpperCase())
  })

  it('embeds the live WYSIWYG image when chartImageFor returns a data URL', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANS'
    const chartBlock = makeBlock('chart', { chart: 'severity', title: 'Severity distribution', width: 'full' })
    const cfg = { blocks: [chartBlock], orientation: 'portrait' }
    const chartImageFor = vi.fn(() => PNG)
    const res = await renderAccidentReportPptx({ config: cfg, records: SAMPLE, chartImageFor, save: false })
    expect(chartImageFor).toHaveBeenCalled()
    const imgs = res.slides.flatMap((s) => s.images)
    expect(imgs.length).toBe(1)
    expect(imgs[0][0].data).toBe(PNG)
    // image path used, so no native chart was added
    expect(res.slides.flatMap((s) => s.charts).length).toBe(0)
    // no save when save:false
    expect(res.pptx.writeFile).not.toHaveBeenCalled()
  })

  it('adds a NATIVE chart when no image is supplied', async () => {
    const chartBlock = makeBlock('chart', { chart: 'severity', title: 'Severity', width: 'full' })
    const res = await renderAccidentReportPptx({ config: { blocks: [chartBlock] }, records: SAMPLE, save: false })
    const charts = res.slides.flatMap((s) => s.charts)
    expect(charts.length).toBe(1)
    expect(charts[0][0]).toBe('doughnut') // severity kind maps to a doughnut
  })

  it('adds a table whose body row count matches the engine filtered rows', async () => {
    const tableBlock = makeBlock('table', {
      title: 'Register',
      columns: ['incident_date', 'asset_no', 'severity', 'claim_amount'],
      filter: { claims: 'open', status: '', severity: '', fault: '', dateFrom: '', dateTo: '' },
      limit: 25,
    })
    const expectedRows = tableRows(SAMPLE, tableBlock)
    const res = await renderAccidentReportPptx({ config: { blocks: [tableBlock] }, records: SAMPLE, save: false })
    const tables = res.slides.flatMap((s) => s.tables)
    expect(tables.length).toBe(1)
    const rows = tables[0][0] // first arg to addTable = row array
    // rows = header + body; body length == engine filtered count
    expect(rows.length).toBe(expectedRows.length + 1)
    // caption reflects the filtered subset honestly
    const caption = res.slides.flatMap((s) => s.texts).map((a) => String(a[0])).find((t) => t.startsWith('Showing '))
    expect(caption).toContain(`Showing ${expectedRows.length} of ${SAMPLE.length} incidents`)
    expect(caption).toContain('open claims only')
  })

  it('paginates a large table across multiple slides, repeating the header', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: i, incident_date: '2026-06-01', asset_no: `T-${i}`, severity: 'Minor', status: 'Open', claim_amount: 100 }))
    const tableBlock = makeBlock('table', { columns: ['incident_date', 'asset_no', 'severity'], limit: 25, density: 'normal' })
    const res = await renderAccidentReportPptx({ config: { blocks: [tableBlock] }, records: many, save: false })
    const tableSlides = res.slides.filter((s) => s.tables.length)
    expect(tableSlides.length).toBeGreaterThan(1) // 25 rows / 10 per slide -> 3 slides
    // every table slide repeats the header row
    for (const s of tableSlides) expect(String(s.tables[0][0][0][0].text)).toBe('Date')
  })

  it('packs half-width charts side by side on one slide', async () => {
    const blocks = [
      makeBlock('chart', { chart: 'severity', width: 'half' }),
      makeBlock('chart', { chart: 'status', width: 'half' }),
    ]
    const res = await renderAccidentReportPptx({ config: { blocks }, records: SAMPLE, save: false })
    const chartSlides = res.slides.filter((s) => s.charts.length)
    // both charts land on a single slide
    expect(chartSlides.length).toBe(1)
    expect(chartSlides[0].charts.length).toBe(2)
  })

  it('stays honest with empty records (no throw, still a deck)', async () => {
    const cfg = { blocks: STARTER(), orientation: 'portrait' }
    const res = await renderAccidentReportPptx({ config: cfg, records: [], save: false })
    expect(res.slides.length).toBeGreaterThan(0)
    // insights degrade to an honest note when present; charts show a no-data note
    const allText = res.slides.flatMap((s) => s.texts).map((a) => String(a[0])).join(' | ')
    expect(allText).toMatch(/No data for this chart|Nothing to report|N\/A/)
  })

  it('handles a fully empty config without throwing', async () => {
    const res = await renderAccidentReportPptx({ config: { blocks: [] }, records: [], save: false })
    expect(res.slides.length).toBe(1)
  })
})

describe('pptx pure helpers', () => {
  it('normalizeHex accepts hex, #hex and rgb()/rgba()', () => {
    expect(normalizeHex('#ea580c')).toBe('EA580C')
    expect(normalizeHex('2563EB')).toBe('2563EB')
    expect(normalizeHex('rgba(37, 99, 235, 0.5)')).toBe('2563EB')
    expect(normalizeHex('not-a-color')).toBe('4F46E5') // accent fallback
    expect(normalizeHex(null)).toBe('4F46E5')
  })

  it('toPptxSeries coerces labels to non-empty strings and values to finite numbers', () => {
    const data = { labels: ['A', '', null], datasets: [{ label: 'X', data: [5, NaN, undefined] }] }
    const series = toPptxSeries(data, 'bar')
    expect(series).toHaveLength(1)
    expect(series[0].labels).toEqual(['A', 'N/A', 'N/A'])
    expect(series[0].values).toEqual([5, 0, 0])
  })

  it('toPptxSeries keeps a single series for doughnut and reads floating-bar magnitude', () => {
    const doughnut = { labels: ['A', 'B'], datasets: [{ data: [3, 4] }, { data: [9, 9] }] }
    expect(toPptxSeries(doughnut, 'doughnut')).toHaveLength(1)
    const waterfall = { labels: ['S'], datasets: [{ data: [[10, 25]] }] }
    expect(toPptxSeries(waterfall, 'bar')[0].values).toEqual([15])
  })

  it('chartColorsFor uses per-slice colours for doughnut and per-dataset otherwise', () => {
    const doughnut = { labels: ['A', 'B'], datasets: [{ backgroundColor: ['#ea580c', '#2563eb'] }] }
    expect(chartColorsFor(doughnut, 'doughnut', {})).toEqual(['EA580C', '2563EB'])
    const bars = { labels: ['A'], datasets: [{ backgroundColor: '#16a34a' }, { backgroundColor: '#9333ea' }] }
    expect(chartColorsFor(bars, 'bar', {})).toEqual(['16A34A', '9333EA'])
  })
})
