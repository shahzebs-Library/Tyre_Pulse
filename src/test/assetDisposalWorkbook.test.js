import { describe, it, expect } from 'vitest'
import { disposalWorkbookSheets, workbookNotes, summarySheetRows, headerFor } from '../lib/assetDisposalWorkbook'
import { shapeBenchmarks } from '../lib/assetReplacement'

const NOW = Date.UTC(2026, 7, 12)

const benchmarks = shapeBenchmarks([{
  id: 'q', asset_no: 'MP049', asset_type: 'PUMPS', label: 'SANY 47m',
  supplier: 'SANY', unit_price: 1120000, vat_pct: 15, vat_amount: 168000,
  total_price: 1288000, currency: 'SAR', quote_date: '2026-07-24',
  valid_until: '2026-08-10', source_file: 'SANY.pdf', active: true,
}], { now: NOW })

const rows = [
  {
    asset_no: 'MP049', asset_type: 'PUMPS', disposition: 'sell', fleet_status: 'Active', currency: 'SAR',
    reliability: { spend: 406470, job_cards: 303, failures: 277, breakdown_hours: 12708, date_coverage_pct: 53.1, spend_by_year: { 2025: 92359 } },
  },
  {
    asset_no: 'MP042', asset_type: 'PUMPS', disposition: 'scrap', fleet_status: 'Inactive', currency: 'SAR',
    reliability: { spend: 399402, job_cards: 131, failures: 90, breakdown_hours: 14514, date_coverage_pct: 64.1, spend_by_year: { 2024: 55174 } },
  },
  { asset_no: 'GN074', asset_type: 'GENERATOR', disposition: 'scrap', currency: 'SAR', reliability: { spend: 1000 } },
]

const build = (over = {}) => disposalWorkbookSheets({ rows, benchmarks, now: NOW, ...over })
const sheet = (name, over) => build(over).find((s) => s.name === name)

describe('disposalWorkbookSheets', () => {
  it('carries every part of the module in one workbook', () => {
    expect(build().map((s) => s.name)).toEqual([
      'Summary', 'Register', 'Reliability', 'Replacement', 'Quotations', 'Recommendations',
    ])
  })

  it('adds the fleet comparison only when the baseline was actually read', () => {
    expect(build().some((s) => s.name === 'Fleet comparison')).toBe(false)
    const withBase = build({ baseline: { onList: { assets: 37, spend: 2260917 }, rest: { assets: 969, spend: 36000000 } } })
    expect(withBase.some((s) => s.name === 'Fleet comparison')).toBe(true)
  })

  it('drops the replacement sheets entirely when no quotation exists', () => {
    const names = build({ benchmarks: null }).map((s) => s.name)
    expect(names).not.toContain('Replacement')
    expect(names).not.toContain('Quotations')
  })

  it('keeps an empty sheet with a reason, so nothing-to-report is not mistaken for not-exported', () => {
    const recs = sheet('Recommendations')
    expect(recs.rows).toHaveLength(0)
    expect(recs.emptyNote).toMatch(/met the threshold/i)
  })

  it('uses each builder OWN headers rather than deriving new ones', () => {
    const reg = sheet('Register')
    expect(reg.headers.length).toBe(reg.columns.length)
    // A derived header would be Title Case of the key; the builder's own is prose.
    expect(reg.headers).not.toEqual(reg.columns)
  })
})

describe('the replacement sheet reflects who the quotation was for', () => {
  it('prices the machine the quotation names', () => {
    const r = sheet('Replacement').rows.find((x) => x.asset_no === 'MP049')
    expect(r.replacement_ex_vat).toBe(1120000)
    expect(r.priced_for).toBe('This machine')
    expect(r.spend_pct_of_new).toBe(36.3)
  })

  // The defect the owner caught.
  it('leaves the other pump unpriced instead of lending it that price', () => {
    const r = sheet('Replacement').rows.find((x) => x.asset_no === 'MP042')
    expect(r.replacement_ex_vat).toBe('')
    expect(r.spend_pct_of_new).toBe('')
    expect(r.note).toContain('MP042')
  })

  it('every machine still appears, priced or not', () => {
    expect(sheet('Replacement').rows.map((r) => r.asset_no)).toEqual(['MP049', 'MP042', 'GN074'])
  })

  it('the quotations sheet keeps both the ex-VAT basis and the printed total', () => {
    const q = sheet('Quotations').rows[0]
    expect(q.unit_price_ex_vat).toBe(1120000)
    expect(q.total_price).toBe(1288000)
    expect(q.asset_no).toBe('MP049')
    expect(q.status).toBe('Lapsed')
  })

  it('a class-wide quotation is labelled as such rather than as a machine', () => {
    const cls = shapeBenchmarks([{ id: 'c', asset_type: 'PUMPS', label: 'Any pump', unit_price: 900000, currency: 'SAR', active: true }], { now: NOW })
    expect(sheet('Quotations', { benchmarks: cls }).rows[0].asset_no).toBe('(whole class)')
  })
})

describe('summarySheetRows', () => {
  it('states the basis beside each figure, not just the figure', () => {
    const out = summarySheetRows({
      rows,
      reliabilityTotals: { failures: 367, breakdown_hours: 27222, parked_hours: 129993, date_coverage_pct: 51.4 },
      currency: 'SAR',
    })
    const parked = out.find((r) => r.measure === 'Parked hours')
    expect(parked.basis).toMatch(/standing still/i)
    const dated = out.find((r) => r.measure === 'Job cards with a usable date')
    expect(dated.basis).toMatch(/rests on this share/i)
  })

  it('says Not measured rather than 0 for something absent', () => {
    const out = summarySheetRows({ rows, reliabilityTotals: { failures: null }, currency: 'SAR' })
    expect(out.find((r) => r.measure === 'Failures recorded').value).toBe('Not measured')
  })

  it('refuses to add quotations in different currencies', () => {
    const mixed = shapeBenchmarks([
      { id: 'a', asset_type: 'PUMPS', label: 'p', unit_price: 100, currency: 'SAR', active: true },
      { id: 'b', asset_type: 'GENERATOR', label: 'g', unit_price: 100, currency: 'AED', active: true },
    ], { now: NOW })
    const out = summarySheetRows({
      rows,
      replacement: { coveredCount: 2, uncoveredCount: 1, exposure: { total: null, mixedCurrency: true }, uncoveredTypes: [] },
      currency: 'SAR',
    })
    expect(out.find((r) => r.measure === 'Replacement exposure').value).toMatch(/Mixed currencies/)
    expect(mixed.list).toHaveLength(2)
  })
})

describe('workbookNotes', () => {
  it('names the limits the numbers rest on', () => {
    const notes = workbookNotes({ rows, benchmarks, now: NOW }).join(' | ')
    expect(notes).toMatch(/usable business date/i)
    expect(notes).toMatch(/parked machine, not a breakdown/i)
    expect(notes).toMatch(/breakdown hours above zero/i)
    expect(notes).toMatch(/quoted for a named machine/i)
    expect(notes).toMatch(/ex-VAT/i)
  })

  it('never claims a scrap or resale value', () => {
    const notes = workbookNotes({ rows, benchmarks, now: NOW }).join(' ')
    expect(notes).toMatch(/No scrap value, resale price or saving if disposed/i)
  })

  it('says plainly when nothing can be priced', () => {
    expect(workbookNotes({ rows, benchmarks: null, now: NOW }).join(' '))
      .toMatch(/No supplier quotation is on file/i)
  })
})

describe('headerFor', () => {
  it('renders keys as readable headers', () => {
    expect(headerFor('asset_no')).toBe('Asset No.')
    expect(headerFor('spend_pct_of_new')).toBe('Spend Pct Of New')
    expect(headerFor('mtbf_days')).toBe('MTBF Days')
    expect(headerFor('availability_pct')).toBe('Availability %')
  })
})
