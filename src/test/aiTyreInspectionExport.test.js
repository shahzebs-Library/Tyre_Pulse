/**
 * Export accuracy: the per-vehicle Excel, the damage report Excel and the damage report PDF.
 * The writers are mocked at the engine boundary (exportUtils / pdfEngine) so the test can assert
 * exactly what would land in the file: columns, headers, values and the decision grouping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  exportToExcel: vi.fn(),
  exportSheetsToExcel: vi.fn(async () => true),
  signed: vi.fn(),
  pdf: null,
}))

vi.mock('../lib/exportUtils', () => ({
  exportToExcel: h.exportToExcel,
  exportSheetsToExcel: h.exportSheetsToExcel,
  reportFileName: (...parts) => parts.filter(Boolean).join(' '),
  reportDateLabel: () => '22 Oct 2026',
}))
vi.mock('../lib/storageRefs', () => ({
  resolveStorageUrlMap: (refs) => h.signed(refs),
  resolveStorageUrl: vi.fn(),
}))
vi.mock('../lib/pdfEngine', () => ({ loadPdf: async () => h.pdf }))

import { INSPECTION_EXPORT_COLUMNS, buildInspectionExportRows, exportInspectionExcel } from '../lib/aiTyreInspectionExport'
import { buildDamageRows, exportDamageExcel, exportDamagePdf, DAMAGE_COLUMNS, DECISIONS, PDF_PHOTO_LIMIT, attachPhotoLinks } from '../lib/aiDamageReport'
import { measurementReading } from '../lib/aiTyreInspectionDomain'
import { analyzeMeasurements } from '../lib/tyreMeasurementEngine'
import { displayPositionCode, inspectionTypeHint } from '../lib/tyreBay'

const inspection = { id: 'i1', asset_no: 'TM514', vehicle_type: 'TR-MIXER', site: 'NHC', inspection_date: '2026-10-01', inspector: 'Ali' }
const label = p => displayPositionCode(inspectionTypeHint(inspection), p)
const reading = (position, condition, extra = {}) => ({
  position, condition,
  calculation: measurementReading({
    inspectionId: 'i1', position, originalMm: 16, minimumMm: 3, centerMm: 10, source: 'manual_gauge',
    measuredAt: '2026-10-01T00:00:00Z', ...extra,
  }),
})
const job = (o = {}) => ({
  id: 'j', inspection_id: 'i1', tyre_position: 'R1Lo', status: 'completed', review_status: 'accepted', photo_ref: 'tp-storage://p/a.jpg',
  model_version: 'claude-haiku', reviewer_note: 'confirmed', reviewed_at: '2026-10-02T10:00:00Z',
  analysis: { assessable: true, recommendation: 'Replace tyre', defects: [{ type: 'sidewall_cut', description: 'deep cut', visibleEvidence: 'steel visible', severity: 'high' }] }, ...o,
})

beforeEach(() => { h.exportToExcel.mockClear(); h.exportSheetsToExcel.mockClear(); h.signed.mockReset() })

describe('per-vehicle Excel export', () => {
  const readings = [reading('R1Lo', 'Damaged'), reading('F1L', 'Good', { centerMm: undefined }), reading('Z9', 'Worn')]
  const evidence = { allPhotos: [{ position: 'R1Lo', ref: 'tp-storage://p/a.jpg' }, { position: 'R1Lo', ref: 'tp-storage://p/b.jpg' }] }

  it('has one unique key per column and a header for each', () => {
    const keys = INSPECTION_EXPORT_COLUMNS.map(([k]) => k)
    expect(new Set(keys).size).toBe(keys.length)
    INSPECTION_EXPORT_COLUMNS.forEach(([, header]) => expect(header.length).toBeGreaterThan(2))
  })

  it('writes one row per tyre position with canonical label AND the stored slot id', () => {
    const rows = buildInspectionExportRows({ inspection, readings, analysisJobs: [job()], evidence, positionLabel: label })
    expect(rows.map(r => r.position)).toEqual(['LHCO', 'LHF1', 'Z9']) // unplaceable wheel keeps its own name
    expect(rows.map(r => r.internal_position)).toEqual(['R1Lo', 'F1L', 'Z9'])
    expect(rows[0]).toMatchObject({
      vehicle: 'TM514', site: 'NHC', date: '2026-10-01', inspector: 'Ali', inspection_id: 'i1', condition: 'Damaged',
      photos: 2, photo_references: 'tp-storage://p/a.jpg | tp-storage://p/b.jpg',
      ai_status: 'completed', review_status: 'accepted', assessable: 'Yes',
      findings: 'sidewall_cut: deep cut: steel visible', severity: 'high', recommendation: 'Replace tyre', model: 'claude-haiku',
      measured_mm: 10, remaining_mm: 7, remaining_percent: 53.8, measurement_status: 'Recorded physical measurement',
    })
  })

  it('never fabricates: unmeasured, unanalysed positions say so', () => {
    const rows = buildInspectionExportRows({ inspection, readings, analysisJobs: [job()], evidence, positionLabel: label })
    const clean = rows[1]
    expect(clean).toMatchObject({
      measured_mm: 'Not measured', remaining_mm: '', remaining_percent: '', measurement_status: 'Measurement required',
      ai_status: 'Not requested', review_status: 'Not reviewed', findings: '', photos: 0, photo_references: '',
      wear_rate: 'Not measured', km_to_limit: 'Not measured', replace_soon: 'Not measured', uneven_wear: 'Not measured',
    })
  })

  it('joins several jobs for one position and treats a missing review as unreviewed', () => {
    const rows = buildInspectionExportRows({
      inspection, readings: [reading('R1Lo', 'Damaged')], evidence,
      analysisJobs: [job({ review_status: null, status: 'pending', analysis: null }), job({ id: 'k', review_status: 'rejected', model_version: 'm2' })],
      positionLabel: label,
    })
    expect(rows[0].ai_status).toBe('pending; completed')
    expect(rows[0].review_status).toBe('unreviewed; rejected')
    expect(rows[0].assessable).toBe('No; Yes')
    expect(rows[0].model).toBe('claude-haiku; m2')
  })

  it('adds wear analysis columns only from engine series', () => {
    const rowsIn = [0, 1, 2, 3].map(i => ({
      id: 'm' + i, inspection_id: 'i1', tyre_position: 'R1Lo', tyre_serial: 'S1', original_mm: 16, minimum_mm: 3,
      center_mm: 12 - i, odometer_km: 10000 + i * 5000, measured_at: new Date(Date.parse('2026-06-01') + i * 30 * 86400000).toISOString(),
    }))
    const { series } = analyzeMeasurements(rowsIn, { now: Date.parse('2026-10-20') })
    const rows = buildInspectionExportRows({ inspection, readings: [reading('R1Lo', 'Worn')], evidence, analysisJobs: [], positionLabel: label, seriesByPosition: new Map([['R1Lo', series[0]]]) })
    expect(rows[0].wear_rate).toBe('0.2 mm/1000 km')
    expect(rows[0].km_to_limit).toContain('30,000 km')
    expect(rows[0].replace_soon).toBe('No')
    expect(rows[0].uneven_wear).toBe('None indicated')
  })

  it('passes keys, headers and a descriptive file name to the Excel writer', async () => {
    await exportInspectionExcel({ inspection, readings, analysisJobs: [], evidence, positionLabel: label })
    const [rows, keys, headers, filename] = h.exportToExcel.mock.calls[0]
    expect(keys).toEqual(INSPECTION_EXPORT_COLUMNS.map(([k]) => k))
    expect(headers).toEqual(INSPECTION_EXPORT_COLUMNS.map(([, x]) => x))
    expect(rows).toHaveLength(3)
    expect(Object.keys(rows[0]).sort()).toEqual([...keys].sort())
    expect(filename).toBe('AI Tyre Inspection TM514 2026-10-01 22 Oct 2026')
  })
})

describe('damage report rows', () => {
  const insps = [inspection, { id: 'i2', asset_no: 'MP093', site: 'DIRIYAH', inspection_date: '2026-10-05', vehicle_type: 'PUMPS' }]
  const jobsBy = {
    i1: [job(), job({ id: 'b', tyre_position: 'F1R', review_status: 'rejected', reviewer_note: 'glare', photo_ref: 'tp-storage://p/c.jpg' }),
      job({ id: 'c', review_status: null, analysis: { assessable: true, defects: [{ type: 'bulge', description: 'x', severity: 'moderate' }, { type: 'cracking', description: 'y', severity: 'moderate' }] } }),
      job({ id: 'd', analysis: { assessable: true, defects: [] } }), job({ id: 'e', status: 'failed' })],
    i2: [job({ id: 'f', inspection_id: 'i2', tyre_position: 'R2Ro', review_status: 'corrected' })],
  }
  const rows = buildDamageRows(insps, jobsBy, (i, p) => displayPositionCode(inspectionTypeHint(i), p))

  it('maps each field of a finding exactly', () => {
    expect(rows[0]).toEqual({
      decision: 'accepted', date: '2026-10-01', vehicle: 'TM514', site: 'NHC', position: 'LHCO',
      finding: 'sidewall_cut: deep cut: steel visible', severity: 'high', reviewer_note: 'confirmed',
      reviewed_at: '2026-10-02', photo_ref: 'tp-storage://p/a.jpg', inspection_id: 'i1',
    })
  })
  it('uses the right vehicle map per inspection and de-duplicates severities', () => {
    expect(rows.map(r => r.position)).toEqual(['LHCO', 'RHF1', 'LHCO', 'RHR2-O'])
    expect(rows[2].severity).toBe('moderate')
    expect(rows[2].decision).toBe('unreviewed')
    expect(rows[2].finding).toBe('bulge: x | cracking: y')
  })
  it('excludes clean photos and failed jobs', () => { expect(rows).toHaveLength(4) })

  it('columns and photo link behave', async () => {
    h.signed.mockResolvedValue({ 'tp-storage://p/a.jpg': 'https://signed/a', 'tp-storage://p/c.jpg': null })
    const withLinks = await attachPhotoLinks(rows)
    expect(h.signed).toHaveBeenCalledTimes(1) // ONE batch call, not one per photo
    expect(h.signed.mock.calls[0][0]).toEqual(['tp-storage://p/a.jpg', 'tp-storage://p/c.jpg'])
    expect(withLinks[0].photo_link).toBe('https://signed/a')
    expect(withLinks[1].photo_link).toBe('Not available')
    expect(DAMAGE_COLUMNS.map(([k]) => k)).toContain('photo_link')
  })

  it('Excel: summary counts and one sheet per decision with the right rows', async () => {
    h.signed.mockResolvedValue({ 'tp-storage://p/a.jpg': 'https://signed/a', 'tp-storage://p/c.jpg': 'https://signed/c' })
    await exportDamageExcel(rows, { dateRange: 'From 2026-10-01' })
    const [sheets, filename, opts] = h.exportSheetsToExcel.mock.calls[0]
    expect(sheets.map(s => s.name)).toEqual(['Summary', 'Accepted', 'Rejected', 'Corrected', 'Awaiting review'])
    expect(sheets[0].rows).toEqual([
      { decision: 'Accepted', findings: 1 }, { decision: 'Rejected', findings: 1 },
      { decision: 'Corrected', findings: 1 }, { decision: 'Awaiting review', findings: 1 },
    ])
    expect(sheets[1].rows[0]).toMatchObject({ vehicle: 'TM514', position: 'LHCO', photo_link: 'https://signed/a' })
    expect(sheets[2].rows[0]).toMatchObject({ position: 'RHF1', reviewer_note: 'glare', photo_link: 'https://signed/c' })
    expect(sheets[3].rows[0]).toMatchObject({ vehicle: 'MP093', position: 'RHR2-O' })
    expect(sheets.slice(1).every(s => s.columns.length === s.headers.length && s.columns[0] === 'date')).toBe(true)
    expect(filename).toBe('AI damage report 22 Oct 2026')
    expect(opts.dateRange).toBe('From 2026-10-01')
    expect(opts.notes.join(' ')).toMatch(/only Accepted/)
  })
})

describe('damage report PDF', () => {
  const makePdf = () => {
    const calls = { autoTable: [], addPage: 0, text: [], saved: null, images: 0 }
    class Doc {
      constructor() { this.internal = { pageSize: { width: 297, height: 210 } } }
      setFontSize() {} setTextColor() {} setPage() {} getNumberOfPages() { return 1 }
      text(t) { calls.text.push(String(t)) }
      addPage() { calls.addPage++ }
      addImage() { calls.images++ }
      save(name) { calls.saved = name }
    }
    return { calls, pdf: { jsPDF: Doc, autoTable: (_doc, opts) => calls.autoTable.push(opts) } }
  }
  const mk = (decision, n) => Array.from({ length: n }, (_, i) => ({
    decision, date: '2026-10-01', vehicle: 'V' + i, site: 'NHC', position: 'LHF1', finding: 'f' + i, severity: 'high',
    reviewer_note: 'n' + i, reviewed_at: '', photo_ref: '', inspection_id: 'i',
  }))

  it('prints a summary table plus one page and table per decision group, in order', async () => {
    const { calls, pdf } = makePdf()
    h.pdf = pdf
    h.signed.mockResolvedValue({})
    await exportDamagePdf([...mk('accepted', 2), ...mk('rejected', 1), ...mk('unreviewed', 3)], { dateRange: 'Through 2026-10-31' })
    const [summary, ...groups] = calls.autoTable
    expect(summary.body).toEqual([['Accepted', 2], ['Rejected', 1], ['Corrected', 0], ['Awaiting review', 3]])
    expect(calls.addPage).toBe(DECISIONS.length) // one page per group, even the empty one
    expect(groups).toHaveLength(3) // corrected is empty: heading + "No findings", no table
    expect(groups.map(g => g.body.length)).toEqual([2, 1, 3])
    expect(groups[0].body[0]).toEqual(['', '2026-10-01', 'V0', 'NHC', 'LHF1', 'f0', 'high', 'n0'])
    expect(groups[0].head[0]).toEqual(['Photo', 'Date', 'Vehicle', 'Site', 'Position', 'AI finding', 'Severity', 'Reviewer note'])
    expect(calls.text).toContain('Accepted (2)')
    expect(calls.text).toContain('Corrected (0)')
    expect(calls.text).toContain('No findings in this group.')
    expect(calls.text).toContain('Awaiting review (3)')
    expect(calls.saved).toBe('AI damage report 22 Oct 2026.pdf')
  })

  it('states when photos were only embedded for the first findings', async () => {
    const { calls, pdf } = makePdf()
    h.pdf = pdf
    const rows = mk('accepted', PDF_PHOTO_LIMIT + 1).map(r => ({ ...r, photo_ref: 'tp-storage://p/x' }))
    h.signed.mockResolvedValue({ 'tp-storage://p/x': 'https://signed/x' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await exportDamagePdf(rows)
    vi.unstubAllGlobals()
    expect(calls.text.some(t => t.includes(`first ${PDF_PHOTO_LIMIT} findings only`))).toBe(true)
  })
})
