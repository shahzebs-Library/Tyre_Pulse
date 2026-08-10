import { describe, it, expect } from 'vitest'
import {
  fmtMoney, fmtM3, fmtCostPerM3, toMonthStart, mapImportRows, IMPORT_TEMPLATES,
  assetFromTruck, toRejectedBool, toDateDay, normalizeRegion,
  summarizeLedger, rejectedRowsDetail, sourceShares,
} from '../lib/costPerM3'

describe('formatters', () => {
  it('fmtMoney rounds, separates, prefixes currency; N/A on null', () => {
    expect(fmtMoney(1374855, 'SAR')).toBe('SAR 1,374,855')
    expect(fmtMoney(null)).toBe('N/A')
    expect(fmtMoney('597,688', 'SAR')).toBe('SAR 597,688')
  })
  it('fmtM3', () => {
    expect(fmtM3(299784)).toBe('299,784 M3')
    expect(fmtM3(null)).toBe('N/A')
  })
  it('fmtCostPerM3 uses 2 dp; N/A when no denominator', () => {
    expect(fmtCostPerM3(4.5862, 'SAR')).toBe('SAR 4.59/M3')
    expect(fmtCostPerM3(null, 'SAR')).toBe('N/A')
  })
})

describe('toMonthStart', () => {
  it('accepts YYYY-MM', () => { expect(toMonthStart('2026-07')).toBe('2026-07-01') })
  it('accepts YYYY-MM-DD (snaps to 1st)', () => { expect(toMonthStart('2026-07-22')).toBe('2026-07-01') })
  it('accepts DD-MM-YYYY (snaps to 1st)', () => { expect(toMonthStart('22-07-2026')).toBe('2026-07-01') })
  it('null on junk', () => { expect(toMonthStart('later')).toBeNull(); expect(toMonthStart('')).toBeNull() })
})

describe('mapImportRows', () => {
  it('maps SCO headers (with synonyms) to fields and coerces amount', () => {
    const rows = mapImportRows('sco', [
      { Country: 'KSA', Region: 'Central', Site: 'NHC', Month: '2026-07', Amount: '252,981', Currency: 'SAR', 'Ref No': 'X1' },
    ])
    expect(rows[0]).toMatchObject({
      country: 'KSA', region: 'Central', site: 'NHC', period_date: '2026-07-01',
      amount: 252981, currency: 'SAR', ref_no: 'X1', source: 'import',
    })
  })

  it('maps a SANY SUMMARY row (Region/Date/Quotation No/Amount (SAR)) -> summary doc_type', () => {
    const rows = mapImportRows('sany', [
      { Region: 'Western Region', Date: '06/09/2025', 'Quotation No': '20250906-16Y', 'Amount (SAR)': '1142.41' },
    ])
    expect(rows[0]).toMatchObject({
      region: 'Western', invoice_no: '20250906-16Y', invoice_date: '2025-09-01',
      period_date: '2025-09-01', amount: 1142.41, doc_type: 'summary',
    })
  })

  it('maps a SANY DETAIL row (Location/Asset/Parts/Quot. No/Cost/Remarks) -> detail doc_type', () => {
    const rows = mapImportRows('sany', [
      { 'Asset Code': 'AC1', 'Asset No': 'TM505', 'Parts Description': 'Filter kit',
        'Quot. No': 'GCC 10', Cost: '710.36', Remarks: 'ok', 'Fleet Remarks': 'fr', 'Maintenance Remarks': 'mr', Location: 'NHC' },
    ])
    expect(rows[0]).toMatchObject({
      asset_code: 'AC1', asset_no: 'TM505', description: 'Filter kit', invoice_no: 'GCC 10',
      amount: 710.36, notes: 'ok', fleet_remarks: 'fr', maintenance_remarks: 'mr', site: 'NHC', doc_type: 'detail',
    })
  })

  it('maps the concrete batching format (Station->site, Truck->asset, Approved/Signed->approved)', () => {
    const rows = mapImportRows('production', [
      { Station: 'Qiddiya-Lower Plateau', 'Batching Time': '2026-05-01 00:00:00',
        'Truck Number': 'TM505     9772 BSA', 'Pump Number': 'MP-130', 'DN Number': '86-03901',
        'Supplied Qty': '12', 'Approved/Signed Qty': '12', 'Rejection Type': 'No', Reason: '', Remarks: '' },
    ])
    expect(rows[0]).toMatchObject({
      site: 'Qiddiya-Lower Plateau', period_date: '2026-05-01', asset_no: 'TM505', pump_no: 'MP-130',
      dn_number: '86-03901', m3: 12, approved_m3: 12, rejected: false,
    })
  })

  it('maps a rejected batching row (Rejection Type Yes + reason)', () => {
    const rows = mapImportRows('production', [
      { Station: 'NHC', 'Batching Time': '2026-05-02', 'Supplied Qty': '10',
        'Approved/Signed Qty': '7', 'Rejection Type': 'Yes', Reason: 'Slump high' },
    ])
    expect(rows[0]).toMatchObject({ site: 'NHC', m3: 10, approved_m3: 7, rejected: true, reason: 'Slump high' })
  })

  it('ignores unknown headers and drops empty rows', () => {
    const rows = mapImportRows('sco', [{ Nonsense: 'x' }, {}])
    // source is always added, so a row with no mapped field yields only {source}; those are dropped
    expect(rows).toEqual([])
  })

  it('maps a Sites row (Site Name->name, Region normalised, Active)', () => {
    const rows = mapImportRows('sites', [
      { Country: 'KSA', 'Site Name': 'RED SEA', 'Site Code': 'REDSEA-ST', Region: 'Western Region', City: 'Jeddah', 'Site Type': 'plant', Active: 'Yes' },
    ])
    expect(rows[0]).toMatchObject({
      country: 'KSA', name: 'RED SEA', site_code: 'REDSEA-ST', region: 'Western', city: 'Jeddah', site_type: 'plant',
    })
  })

  it('every template lists matching headers and fields', () => {
    for (const t of Object.values(IMPORT_TEMPLATES)) {
      expect(t.headers.length).toBe(t.fields.length)
    }
  })
})

describe('batching helpers', () => {
  it('assetFromTruck takes the first token, uppercased', () => {
    expect(assetFromTruck('TM505     9772 BSA')).toBe('TM505')
    expect(assetFromTruck('mp-130')).toBe('MP-130')
    expect(assetFromTruck('')).toBeNull()
  })
  it('toRejectedBool maps Yes/true/1 to true, No/blank to false', () => {
    expect(toRejectedBool('Yes')).toBe(true)
    expect(toRejectedBool('No')).toBe(false)
    expect(toRejectedBool('')).toBe(false)
    expect(toRejectedBool('YES')).toBe(true)
  })
  it('toDateDay handles datetime string, Date, DMY, and blanks', () => {
    expect(toDateDay('2026-05-01 00:00:00')).toBe('2026-05-01')
    expect(toDateDay('01/05/2026')).toBe('2026-05-01')
    expect(toDateDay(new Date(Date.UTC(2026, 4, 1, 12)))).toMatch(/^2026-05-0[12]$/)
    expect(toDateDay('')).toBeNull()
  })
  it('normalizeRegion strips " Region" and title-cases', () => {
    expect(normalizeRegion('Western Region')).toBe('Western')
    expect(normalizeRegion('central region')).toBe('Central')
    expect(normalizeRegion('Western')).toBe('Western')
    expect(normalizeRegion('')).toBeNull()
  })
})

describe('SCO Values mapping + SANY proforma passthrough', () => {
  it('maps the ERP/SCO grid "Values" column to the cost amount', () => {
    const [row] = mapImportRows('sco', [{
      Country: 'KSA', 'Store Code': 'SP_RIY', 'Cost Center': 'CC1',
      'Item Desc': 'Cement', Values: '12,500.50', Transaction: '2026-07-05',
    }])
    expect(row.amount).toBeCloseTo(12500.5, 2)
    expect(row.site).toBe('SP_RIY')
    expect(row.description).toBe('Cement')
    expect(row.period_date).toBe('2026-07-01')
  })

  it('keeps an explicit proforma Doc Type and passes gross/net/fx/deductions through', () => {
    const [row] = mapImportRows('sany', [{
      Country: 'KSA', 'Doc Type': 'proforma', 'Quotation No': 'SYDU1',
      'Parts Description': 'SANY service contract', 'Amount (SAR) / Cost': 2004903.83,
      Currency: 'USD', 'Gross Amount (USD)': 534641.02, 'Net Amount (USD)': 381946.65,
      'FX Rate': 3.75, Deductions: [{ label: 'Penalty', amount_usd: 51690.9 }],
    }])
    expect(row.doc_type).toBe('proforma') // NOT 'detail' - it must feed Cost/M3
    expect(row.amount).toBeCloseTo(2004903.83, 2)
    expect(row.gross_amount).toBeCloseTo(534641.02, 2)
    expect(row.net_amount).toBeCloseTo(381946.65, 2)
    expect(row.fx_rate).toBe(3.75)
    expect(Array.isArray(row.deductions)).toBe(true)
    expect(row.deductions[0]).toMatchObject({ label: 'Penalty' })
  })

  it('a SANY detail row (asset/parts, no Doc Type) is still tagged detail', () => {
    const [row] = mapImportRows('sany', [{
      Country: 'KSA', 'Asset No': 'TM505', 'Parts Description': 'Filter', 'Amount (SAR) / Cost': 100,
    }])
    expect(row.doc_type).toBe('detail')
  })
})

describe('SCO issue grid (bj_griddetails) format', () => {
  it('maps Issue Number/Transaction Type/Store Code/Item Description/Values and keeps WO+Asset in notes', () => {
    const [row] = mapImportRows('sco', [{
      '#': 1,
      'Issue Number': 'GC/SCO/0006/0826',
      'Work Order Number': 'GCKR/JC/2306/0726',
      'Transaction Type': new Date(2026, 7, 2),
      'Asset Code': 'MP079',
      'Asset Description': 'CONCRETE PUMP',
      'Asset Type': 'PUMPS',
      'Store Code': 'NHC-ST',
      'Cost Center': '100054',
      Itemcode: 'SC-001',
      Qty: 1,
      'Item Description': 'Hydraulic Pipe For MP079 Pump',
      Values: 160.87,
      'Spare Parts': 160.87, Trye: 0, Oil: 0, 'Total Parts Consumption': 160.87,
    }])
    expect(row.ref_no).toBe('GC/SCO/0006/0826')
    expect(row.period_date).toBe('2026-08-01')
    expect(row.site).toBe('NHC-ST')
    expect(row.cost_center).toBe('100054')
    expect(row.description).toBe('Hydraulic Pipe For MP079 Pump')
    expect(row.amount).toBeCloseTo(160.87, 2)
    expect(row.notes).toBe('WO GCKR/JC/2306/0726 / Asset MP079')
  })
})

describe('summarizeLedger', () => {
  const scoRows = [
    { period_date: '2026-07-01', site: 'NHC', amount: 100, currency: 'SAR' },
    { period_date: '2026-07-01', site: 'NHC', amount: 50, currency: 'SAR' },
    { period_date: '2026-06-01', site: 'RED SEA', amount: 200, currency: 'SAR' },
  ]

  it('totals rows, value, sites, months and period covered (sco)', () => {
    const s = summarizeLedger(scoRows, 'sco')
    expect(s.totals.rows).toBe(3)
    expect(s.totals.value).toBe(350)
    expect(s.totals.sites).toBe(2)
    expect(s.totals.months).toBe(2)
    expect(s.totals.firstMonth).toBe('2026-06')
    expect(s.totals.lastMonth).toBe('2026-07')
    expect(s.totals.currencies).toEqual(['SAR'])
    expect(s.totals.mixedCurrency).toBe(false)
  })

  it('byMonth is newest first with per-month rows + value', () => {
    const s = summarizeLedger(scoRows, 'sco')
    expect(s.byMonth).toEqual([
      { month: '2026-07', rows: 2, value: 150 },
      { month: '2026-06', rows: 1, value: 200 },
    ])
  })

  it('bySite is sorted by value desc; blank site falls back to region then Not stated', () => {
    const s = summarizeLedger([
      { period_date: '2026-07-01', site: '', region: 'Western', amount: 10 },
      { period_date: '2026-07-01', amount: 5 },
      { period_date: '2026-07-01', site: 'NHC', amount: 99 },
    ], 'sco')
    expect(s.bySite[0]).toEqual({ site: 'NHC', rows: 1, value: 99 })
    expect(s.bySite.map((r) => r.site)).toEqual(['NHC', 'Western', 'Not stated'])
  })

  it('flags mixed currencies instead of blending them silently', () => {
    const s = summarizeLedger([
      { period_date: '2026-07-01', amount: 10, currency: 'SAR' },
      { period_date: '2026-07-01', amount: 10, currency: 'AED' },
    ], 'sco')
    expect(s.totals.mixedCurrency).toBe(true)
    expect(s.totals.currencies).toEqual(['AED', 'SAR'])
  })

  it('production sums approved m3 with supplied fallback + rejection counts', () => {
    const s = summarizeLedger([
      { period_date: '2026-07-02', site: 'NHC', m3: 12, approved_m3: 12, rejected: false },
      { period_date: '2026-07-03', site: 'NHC', m3: 10, approved_m3: 7, rejected: true },
      { period_date: '2026-07-04', site: 'NHC', m3: 8 }, // approved blank -> falls back to supplied
    ], 'production')
    expect(s.totals.value).toBe(27) // 12 + 7 + 8
    expect(s.totals.supplied_m3).toBe(30)
    expect(s.totals.approved_m3).toBe(27)
    expect(s.totals.rejected_loads).toBe(1)
    expect(s.totals.rejected_m3).toBe(3)
  })

  it('sany splits counted (non-detail) value from detail lines', () => {
    const s = summarizeLedger([
      { period_date: '2026-07-01', amount: 1000, doc_type: 'summary' },
      { period_date: '2026-07-01', amount: 400, doc_type: 'proforma' },
      { period_date: '2026-07-01', amount: 99, doc_type: 'detail' },
    ], 'sany')
    expect(s.totals.value).toBe(1499)
    expect(s.totals.counted_value).toBe(1400)
    expect(s.totals.detail_rows).toBe(1)
  })

  it('a row with no readable month lands in the Unknown bucket, sorted last', () => {
    const s = summarizeLedger([
      { period_date: '2026-07-01', amount: 1 },
      { period_date: null, amount: 2 },
    ], 'sco')
    expect(s.byMonth.map((m) => m.month)).toEqual(['2026-07', 'Unknown'])
    expect(s.totals.firstMonth).toBe('2026-07')
  })

  it('empty input -> honest nulls, never fabricated zero values', () => {
    const s = summarizeLedger([], 'sco')
    expect(s.totals.rows).toBe(0)
    expect(s.totals.value).toBeNull()
    expect(s.byMonth).toEqual([])
    expect(s.bySite).toEqual([])
  })
})

describe('rejectedRowsDetail', () => {
  it('keeps only rejected rows, newest first, with reason + remarks null-safe', () => {
    const rows = rejectedRowsDetail([
      { id: 1, period_date: '2026-07-01', site: 'NHC', dn_number: 'DN1', m3: 10, approved_m3: 7, rejected: true, reason: 'Slump high', remarks: 'Sent back' },
      { id: 2, period_date: '2026-07-05', site: 'RED SEA', dn_number: null, m3: 8, approved_m3: null, rejected: true, reason: '', remarks: null },
      { id: 3, period_date: '2026-07-03', site: 'NHC', m3: 12, approved_m3: 12, rejected: false },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 2, site: 'RED SEA', dn_number: null, supplied_m3: 8, approved_m3: null, not_approved_m3: 8, reason: null, remarks: null })
    expect(rows[1]).toMatchObject({ id: 1, dn_number: 'DN1', supplied_m3: 10, not_approved_m3: 3, reason: 'Slump high', remarks: 'Sent back' })
  })

  it('never invents a quantity: no supplied m3 -> null gap', () => {
    const [r] = rejectedRowsDetail([{ id: 9, period_date: '2026-07-01', rejected: true }])
    expect(r.supplied_m3).toBeNull()
    expect(r.not_approved_m3).toBeNull()
  })
})

describe('sourceShares', () => {
  it('computes per-source share of the grand total; tyre is a sub-line', () => {
    const s = sourceShares({ internal_cost: 600, tyre_cost: 100, sco_cost: 300, sany_cost: 100, grand_total: 1000 })
    const byKey = Object.fromEntries(s.map((x) => [x.key, x]))
    expect(byKey.internal.share).toBeCloseTo(60, 5)
    expect(byKey.sco.share).toBeCloseTo(30, 5)
    expect(byKey.sany.share).toBeCloseTo(10, 5)
    expect(byKey.tyre.sub).toBe(true)
    expect(byKey.tyre.share).toBeCloseTo(10, 5)
  })

  it('null shares when there is no positive grand total; empty on null input', () => {
    const s = sourceShares({ internal_cost: 0, sco_cost: 0, sany_cost: 0, grand_total: 0 })
    expect(s.every((x) => x.share === null)).toBe(true)
    expect(sourceShares(null)).toEqual([])
  })
})
