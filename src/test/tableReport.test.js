import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the renderers so we assert dispatch + payload shape without generating files.
vi.mock('../lib/exportUtils', () => ({
  exportToPdf: vi.fn(() => Promise.resolve()),
  exportToExcel: vi.fn(() => Promise.resolve()),
  applyExportPolicy: vi.fn((rows) => rows),
}))
vi.mock('../lib/tableExport', () => ({
  buildCsv: vi.fn((headers, rows) => ({ headers, rows })),
  downloadCsv: vi.fn(),
}))

import {
  getExportColumns,
  getColumnHeader,
  getRowsForMode,
  describeTableState,
  buildReportDefinition,
  runTableExport,
  EXPORT_MODES,
  EXPORT_FORMATS,
} from '../lib/report/tableReport'
import { exportToPdf, exportToExcel } from '../lib/exportUtils'
import { buildCsv, downloadCsv } from '../lib/tableExport'

// A minimal stand-in for a TanStack table instance covering only what the
// engine reads. Columns: cost (numeric, exportValue keeps raw number),
// actions (excluded via meta.export=false), name.
function makeTable({ selected = [] } = {}) {
  const col = (id, header, extra = {}) => ({
    id,
    accessorFn: extra.accessorFn === null ? undefined : (r) => r[id],
    columnDef: { header, meta: extra.meta },
  })
  const columns = [
    col('name', 'Name'),
    col('cost', 'Cost', { meta: { exportValue: (r) => r.cost, exportHeader: 'Cost (raw)' } }),
    col('actions', 'Actions', { meta: { export: false } }),
  ]
  const mkRow = (o) => ({ original: o, getValue: (id) => o[id] })
  const filtered = [mkRow({ name: 'A', cost: 10 }), mkRow({ name: 'B', cost: 20 })]
  const current = [filtered[0]]
  return {
    getVisibleLeafColumns: () => columns,
    getRowModel: () => ({ rows: current }),
    getPrePaginationRowModel: () => ({ rows: filtered }),
    getSelectedRowModel: () => ({ rows: selected.map(mkRow) }),
    getState: () => ({
      globalFilter: 'vol',
      columnFilters: [{ id: 'name', value: 'A' }],
      sorting: [{ id: 'cost', desc: true }],
    }),
  }
}

describe('tableReport engine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getExportColumns drops non-exportable and accessor-less columns', () => {
    const cols = getExportColumns(makeTable())
    expect(cols.map((c) => c.id)).toEqual(['name', 'cost'])
  })

  it('getColumnHeader honours meta.exportHeader', () => {
    const cols = getExportColumns(makeTable())
    expect(getColumnHeader(cols[0])).toBe('Name')
    expect(getColumnHeader(cols[1])).toBe('Cost (raw)')
  })

  it('getRowsForMode returns the right row set per mode', () => {
    const t = makeTable({ selected: [{ name: 'C', cost: 30 }] })
    expect(getRowsForMode(t, EXPORT_MODES.CURRENT)).toHaveLength(1)
    expect(getRowsForMode(t, EXPORT_MODES.FILTERED)).toHaveLength(2)
    expect(getRowsForMode(t, EXPORT_MODES.SELECTED)).toHaveLength(1)
  })

  it('describeTableState records search, filters and sort', () => {
    const meta = describeTableState(makeTable(), EXPORT_MODES.FILTERED)
    expect(meta['Search']).toBe('vol')
    expect(meta['Filters']).toContain('name=A')
    expect(meta['Sorted by']).toContain('cost ↓')
  })

  it('CSV export builds rows from the filtered model with raw exportValue', async () => {
    const n = await runTableExport({
      table: makeTable(),
      format: EXPORT_FORMATS.CSV,
      mode: EXPORT_MODES.FILTERED,
      fileName: 'fleet',
    })
    expect(n).toBe(2)
    expect(buildCsv).toHaveBeenCalledWith(
      ['Name', 'Cost (raw)'],
      [['A', 10], ['B', 20]],
    )
    expect(downloadCsv).toHaveBeenCalledOnce()
  })

  it('PDF export dispatches with {key,header} columns + object rows', async () => {
    await runTableExport({
      table: makeTable(),
      format: EXPORT_FORMATS.PDF,
      mode: EXPORT_MODES.CURRENT,
      fileName: 'fleet',
      title: 'Fleet',
      company: 'RMC',
    })
    expect(exportToPdf).toHaveBeenCalledOnce()
    const [rows, cols, title, , , company] = exportToPdf.mock.calls[0]
    expect(cols).toEqual([{ key: 'name', header: 'Name' }, { key: 'cost', header: 'Cost (raw)' }])
    expect(rows).toEqual([{ name: 'A', cost: 10 }]) // current mode = 1 row
    expect(title).toBe('Fleet')
    expect(company).toBe('RMC')
  })

  it('Excel export forwards keys, headers and report meta', async () => {
    await runTableExport({
      table: makeTable(),
      format: EXPORT_FORMATS.EXCEL,
      mode: EXPORT_MODES.FILTERED,
      fileName: 'fleet',
      currency: 'USD',
    })
    expect(exportToExcel).toHaveBeenCalledOnce()
    const [rows, keys, headers, , , opts] = exportToExcel.mock.calls[0]
    expect(keys).toEqual(['name', 'cost'])
    expect(headers).toEqual(['Name', 'Cost (raw)'])
    expect(rows).toHaveLength(2)
    expect(opts.currency).toBe('USD')
    expect(opts.meta['Export mode']).toBe('Filtered Report')
  })

  it('buildReportDefinition produces the portable server payload from live state', () => {
    const def = buildReportDefinition({
      table: makeTable(),
      mode: EXPORT_MODES.FILTERED,
      fileName: 'fleet',
      title: 'Fleet',
      company: 'RMC',
      currency: 'SAR',
    })
    expect(def.title).toBe('Fleet')
    expect(def.company).toBe('RMC')
    expect(def.exportMode).toBe('filtered')
    expect(def.columns).toEqual([
      { key: 'name', header: 'Name', align: 'left' },
      { key: 'cost', header: 'Cost (raw)', align: 'left' },
    ])
    expect(def.rows).toEqual([{ name: 'A', cost: 10 }, { name: 'B', cost: 20 }])
    expect(def.filtersSummary['Export mode']).toBe('Filtered Report')
  })

  it('returns 0 and exports nothing when there are no exportable columns', async () => {
    const empty = { getVisibleLeafColumns: () => [] }
    const n = await runTableExport({ table: empty, format: EXPORT_FORMATS.PDF })
    expect(n).toBe(0)
    expect(exportToPdf).not.toHaveBeenCalled()
  })
})
