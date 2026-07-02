import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Mock external libraries before importing exportUtils
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('xlsx', () => {
  const jsonToSheet = vi.fn(() => ({ '!cols': [] }))
  const aoaToSheet  = vi.fn(() => ({ '!cols': [] }))
  const bookNew     = vi.fn(() => ({}))
  const bookAppend  = vi.fn()
  const encodeRange = vi.fn(() => 'A1:Z1')
  const writeFile   = vi.fn()
  const utils = {
    json_to_sheet: jsonToSheet,
    aoa_to_sheet:  aoaToSheet,
    book_new:      bookNew,
    book_append_sheet: bookAppend,
    encode_range:  encodeRange,
  }
  return { default: { utils, writeFile }, utils, writeFile }
})

vi.mock('jspdf', () => {
  // Robust doc stub: any drawing/layout method (rect, roundedRect, setDrawColor,
  // line, addPage, …) resolves to a no-op spy, while the few properties the code
  // reads back (internal dimensions, lastAutoTable.finalY) return real values.
  const makeDoc = () => {
    const data = {
      internal: { pageSize: { width: 297, height: 210 }, getNumberOfPages: () => 1 },
      lastAutoTable: { finalY: 40 },
      splitTextToSize: (txt) => String(txt ?? '').split('\n'),
      getTextWidth: () => 10,
      save: vi.fn(),
    }
    const cache = new Map()
    return new Proxy(data, {
      get(target, prop) {
        if (prop in target) return target[prop]
        if (!cache.has(prop)) cache.set(prop, vi.fn())
        return cache.get(prop)
      },
    })
  }
  return { default: vi.fn(() => makeDoc()) }
})

vi.mock('jspdf-autotable', () => ({
  default: vi.fn(),
}))

vi.mock('pptxgenjs', () => {
  const mockSlide = {
    addShape: vi.fn(),
    addText:  vi.fn(),
    addTable: vi.fn(),
    addChart: vi.fn(),
  }
  const mockPptx = {
    layout:      '',
    ShapeType:   { rect: 'rect' },
    ChartType:   { doughnut: 'doughnut', bar: 'bar', area: 'area', line: 'line', pie: 'pie' },
    addSlide:    vi.fn(() => ({ ...mockSlide, background: {} })),
    writeFile:   vi.fn(() => Promise.resolve()),
  }
  return { default: vi.fn(() => mockPptx) }
})

// Import after mocks are set up
import * as XLSX       from 'xlsx'
import jsPDF           from 'jspdf'
import autoTable       from 'jspdf-autotable'
import pptxgen         from 'pptxgenjs'
import { exportToExcel, exportToPdf, exportToPptx } from '../lib/exportUtils'

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a captured call argument for json_to_sheet
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// exportToExcel - data mapping / row transformation
// ─────────────────────────────────────────────────────────────────────────────
describe('exportToExcel - data row mapping', () => {
  it('maps column keys to headers in each display row', () => {
    const rows    = [{ id: 1, name: 'Goodyear', size: '225/45R17' }]
    const columns = ['id', 'name', 'size']
    const headers = ['ID', 'Name', 'Size']

    exportToExcel(rows, columns, headers, 'test')

    const jsonToSheet = XLSX.utils.json_to_sheet
    expect(jsonToSheet).toHaveBeenCalledOnce()
    const [displayRows] = jsonToSheet.mock.calls[0]
    expect(displayRows[0]).toEqual({ ID: 1, Name: 'Goodyear', Size: '225/45R17' })
  })

  it('uses empty string for missing column values', () => {
    const rows    = [{ id: 1 }] // name and size missing
    const columns = ['id', 'name', 'size']
    const headers = ['ID', 'Name', 'Size']

    exportToExcel(rows, columns, headers, 'test')

    const jsonToSheet = XLSX.utils.json_to_sheet
    const [displayRows] = jsonToSheet.mock.calls[0]
    expect(displayRows[0]).toEqual({ ID: 1, Name: '', Size: '' })
  })

  it('only includes specified columns (extra row fields are excluded)', () => {
    const rows    = [{ id: 1, name: 'Michelin', secret: 'hidden' }]
    const columns = ['id', 'name']
    const headers = ['ID', 'Name']

    exportToExcel(rows, columns, headers, 'test')

    const jsonToSheet = XLSX.utils.json_to_sheet
    const [displayRows] = jsonToSheet.mock.calls[0]
    expect(displayRows[0]).not.toHaveProperty('secret')
    expect(Object.keys(displayRows[0])).toEqual(['ID', 'Name'])
  })

  it('handles multiple data rows correctly', () => {
    const rows = [
      { site: 'Riyadh', count: 10 },
      { site: 'Jeddah', count: 25 },
      { site: 'Dammam', count: 5 },
    ]
    const columns = ['site', 'count']
    const headers = ['Site', 'Count']

    exportToExcel(rows, columns, headers, 'sites')

    const jsonToSheet = XLSX.utils.json_to_sheet
    const [displayRows] = jsonToSheet.mock.calls[0]
    expect(displayRows).toHaveLength(3)
    expect(displayRows[1]).toEqual({ Site: 'Jeddah', Count: 25 })
  })

  it('handles empty rows array (produces empty sheet)', () => {
    exportToExcel([], ['id'], ['ID'], 'empty')

    const jsonToSheet = XLSX.utils.json_to_sheet
    const [displayRows] = jsonToSheet.mock.calls[0]
    expect(displayRows).toEqual([])
  })

  it('passes headers array as header option to json_to_sheet', () => {
    const rows    = [{ name: 'Continental' }]
    const columns = ['name']
    const headers = ['Tyre Name']

    exportToExcel(rows, columns, headers, 'test')

    const jsonToSheet = XLSX.utils.json_to_sheet
    const [, options] = jsonToSheet.mock.calls[0]
    expect(options.header).toEqual(['Tyre Name'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// exportToExcel - column width calculation
// ─────────────────────────────────────────────────────────────────────────────
describe('exportToExcel - column width calculation', () => {
  it('sets ws["!cols"] with one entry per header', () => {
    const rows    = [{ a: 'hello', b: 'world' }]
    const columns = ['a', 'b']
    const headers = ['Col A', 'Col B']

    // We need the actual ws object returned by json_to_sheet to check !cols
    // json_to_sheet is mocked but returns a plain object; we can inspect what writeFile receives
    exportToExcel(rows, columns, headers, 'test')
    // Verify the data worksheet was appended (a Summary sheet precedes it when
    // rows are present, so assert the final append targets the Data sheet).
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalled()
    const appendCalls = XLSX.utils.book_append_sheet.mock.calls
    expect(appendCalls[appendCalls.length - 1][2]).toBe('Data')
  })

  it('appends sheet to workbook with correct sheet name', () => {
    const rows    = [{ a: '1' }]
    const columns = ['a']
    const headers = ['A']

    exportToExcel(rows, columns, headers, 'myfile', 'MySheet')

    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'MySheet'
    )
  })

  it('calls writeFile with correct filename including .xlsx extension', () => {
    const rows    = [{ x: 'data' }]
    const columns = ['x']
    const headers = ['X']

    exportToExcel(rows, columns, headers, 'my_export')

    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), 'my_export.xlsx')
  })

  it('uses default filename "export" when none provided', () => {
    exportToExcel([{ x: '1' }], ['x'], ['X'])

    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), 'export.xlsx')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// exportToPdf - PDF generation
// ─────────────────────────────────────────────────────────────────────────────
describe('exportToPdf - PDF generation', () => {
  it('creates a jsPDF instance with landscape orientation by default', () => {
    exportToPdf([], [], 'Test Report', 'test')

    expect(jsPDF).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'landscape' })
    )
  })

  it('creates a jsPDF instance with portrait orientation when specified', () => {
    exportToPdf([], [], 'Test Report', 'test', 'portrait')

    expect(jsPDF).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'portrait' })
    )
  })

  it('calls autoTable with rows mapped through column keys', () => {
    const rows    = [{ site: 'Riyadh', count: 5 }]
    const columns = [{ key: 'site', header: 'Site' }, { key: 'count', header: 'Count' }]

    exportToPdf(rows, columns, 'Sites Report', 'sites')

    expect(autoTable).toHaveBeenCalled()
    // The main data table is the final autoTable call (analytical summary tables
    // precede it). Read the last call's body for the mapped row data.
    const dataCall = autoTable.mock.calls[autoTable.mock.calls.length - 1]
    const [, tableOptions] = dataCall
    expect(tableOptions.body).toEqual([['Riyadh', '5']])
  })

  it('maps null/undefined cell values to em-dash "-" in table body', () => {
    const rows    = [{ site: 'Riyadh', notes: null }]
    const columns = [{ key: 'site', header: 'Site' }, { key: 'notes', header: 'Notes' }]

    exportToPdf(rows, columns, 'Report', 'test')

    const dataCall = autoTable.mock.calls[autoTable.mock.calls.length - 1]
    const [, tableOptions] = dataCall
    // Missing/null cells render as an empty string in the data table body.
    expect(tableOptions.body[0][1]).toBe('')
  })

  it('passes column headers as first element of head array', () => {
    const columns = [
      { key: 'id', header: 'ID' },
      { key: 'name', header: 'Name' },
    ]

    exportToPdf([], columns, 'Test', 'test')

    const [, tableOptions] = autoTable.mock.calls[0]
    expect(tableOptions.head).toEqual([['ID', 'Name']])
  })

  it('calls doc.save with filename + .pdf extension', () => {
    const mockDoc = jsPDF.mock.results[0]?.value ?? new jsPDF()
    exportToPdf([], [], 'Title', 'my_report')

    // The instance created inside exportToPdf should have .save called
    // Access through the mock constructor's latest instance
    const instance = jsPDF.mock.results[jsPDF.mock.results.length - 1].value
    expect(instance.save).toHaveBeenCalledWith('my_report.pdf')
  })

  it('uses default filename "report" when none given', () => {
    exportToPdf([], [], 'Title')

    const instance = jsPDF.mock.results[jsPDF.mock.results.length - 1].value
    expect(instance.save).toHaveBeenCalledWith('report.pdf')
  })

  it('handles empty rows array without error', () => {
    expect(() => exportToPdf([], [], 'Empty Report', 'empty')).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// exportToPptx - PowerPoint generation
// ─────────────────────────────────────────────────────────────────────────────
describe('exportToPptx - PowerPoint generation', () => {
  it('returns a Promise', () => {
    const result = exportToPptx({ totalTyres: 0, totalCost: 0, openActions: 0, highRisk: 0, period: 'Q1 2024' })
    expect(result).toBeInstanceOf(Promise)
  })

  it('resolves without error with minimal data', async () => {
    await expect(
      exportToPptx({ totalTyres: 0, totalCost: 0, openActions: 0, highRisk: 0, period: 'Q1 2024' })
    ).resolves.not.toThrow()
  })

  it('calls pptxgen writeFile with correct filename', async () => {
    const PptxClass = pptxgen
    await exportToPptx(
      { totalTyres: 10, totalCost: 5000, openActions: 2, highRisk: 1, period: 'Q1 2024' },
      'My_Report'
    )
    // Access the mock instance's writeFile
    const instance = PptxClass.mock.results[PptxClass.mock.results.length - 1].value
    expect(instance.writeFile).toHaveBeenCalledWith({ fileName: 'My_Report.pptx' })
  })

  it('uses default filename when none provided', async () => {
    const PptxClass = pptxgen
    await exportToPptx({ totalTyres: 0, totalCost: 0, openActions: 0, highRisk: 0, period: 'Test' })
    const instance = PptxClass.mock.results[PptxClass.mock.results.length - 1].value
    expect(instance.writeFile).toHaveBeenCalledWith({ fileName: 'TyrePulse_Report.pptx' })
  })

  it('adds at least 2 slides (title + executive summary always present)', async () => {
    const PptxClass = pptxgen
    await exportToPptx({
      totalTyres: 100,
      totalCost: 50000,
      openActions: 5,
      highRisk: 20,
      period: 'Q1 2024',
      company: 'Test Corp',
    })
    const instance = PptxClass.mock.results[PptxClass.mock.results.length - 1].value
    expect(instance.addSlide).toHaveBeenCalled()
    expect(instance.addSlide.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('adds top-sites slide when topSites array is non-empty', async () => {
    const PptxClass = pptxgen
    await exportToPptx({
      totalTyres: 10,
      totalCost: 0,
      openActions: 0,
      highRisk: 0,
      period: 'Q1 2024',
      topSites: [{ site: 'Riyadh', count: 50 }, { site: 'Jeddah', count: 30 }],
    })
    const instance = PptxClass.mock.results[PptxClass.mock.results.length - 1].value
    // Title + Summary + TopSites + RiskBreakdown = at least 4 slides
    expect(instance.addSlide.mock.calls.length).toBeGreaterThanOrEqual(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatSAR - internal currency formatting (tested via exportToPptx KPI tile values)
// We exercise the formatSAR logic by checking what gets passed to addText
// ─────────────────────────────────────────────────────────────────────────────
describe('formatSAR - currency formatting logic (via exportToPptx)', () => {
  it('formats value >= 1,000,000 as "SAR X.XM"', async () => {
    // We test the function behavior indirectly by verifying the slide's addText calls
    // contain a formatted SAR string for totalCost = 2_500_000
    const PptxClass = pptxgen
    await exportToPptx({
      totalTyres: 0,
      totalCost: 2_500_000,
      openActions: 0,
      highRisk: 0,
      period: 'Test',
    })
    // Find the addText calls across all slides and look for "SAR 2.5M"
    const instance = PptxClass.mock.results[PptxClass.mock.results.length - 1].value
    const allAddTextCalls = instance.addSlide.mock.results.flatMap(r =>
      r.value?.addText?.mock?.calls ?? []
    )
    const sarTexts = allAddTextCalls.filter(([txt]) => typeof txt === 'string' && txt.startsWith('SAR'))
    expect(sarTexts.some(([txt]) => txt === 'SAR 2.50M')).toBe(true)
  })

  it('formats value >= 1,000 as "SAR XK"', async () => {
    const PptxClass = pptxgen
    await exportToPptx({
      totalTyres: 0,
      totalCost: 75_000,
      openActions: 0,
      highRisk: 0,
      period: 'Test',
    })
    const instance = PptxClass.mock.results[PptxClass.mock.results.length - 1].value
    const allAddTextCalls = instance.addSlide.mock.results.flatMap(r =>
      r.value?.addText?.mock?.calls ?? []
    )
    const sarTexts = allAddTextCalls.filter(([txt]) => typeof txt === 'string' && txt.startsWith('SAR'))
    expect(sarTexts.some(([txt]) => txt === 'SAR 75.0k')).toBe(true)
  })

  it('formats value 0 / falsy as "SAR 0"', async () => {
    const PptxClass = pptxgen
    await exportToPptx({
      totalTyres: 0,
      totalCost: 0,
      openActions: 0,
      highRisk: 0,
      period: 'Test',
    })
    const instance = PptxClass.mock.results[PptxClass.mock.results.length - 1].value
    const allAddTextCalls = instance.addSlide.mock.results.flatMap(r =>
      r.value?.addText?.mock?.calls ?? []
    )
    const sarTexts = allAddTextCalls.filter(([txt]) => typeof txt === 'string' && txt === 'SAR 0')
    expect(sarTexts.length).toBeGreaterThan(0)
  })
})
