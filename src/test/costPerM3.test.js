import { describe, it, expect } from 'vitest'
import {
  fmtMoney, fmtM3, fmtCostPerM3, toMonthStart, mapImportRows, IMPORT_TEMPLATES,
  assetFromTruck, toRejectedBool, toDateDay, normalizeRegion,
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
