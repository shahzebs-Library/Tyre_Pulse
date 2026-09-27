import { describe, expect, it } from 'vitest'
import {
  mappingOf, daysSinceScan, scanStateOf, duplicateSerials, enrichTags, filterTags,
  rfidKpis, tagsBySite, siteOptions, activeRfidFilterCount, rfidExportRows,
  EMPTY_RFID_FILTERS, STALE_SCAN_DAYS,
} from '../lib/rfidAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')
const rows = [
  { id: 1, tag_id: 'e200 01', tyre_serial: 'SN1', asset_no: 'TRK-1', site: 'RUH', status: 'active', last_scanned_at: '2026-09-25T12:00:00Z' },
  { id: 2, tag_id: 'E20002', tyre_serial: 'sn1', asset_no: '', site: 'RUH', status: 'active', last_scanned_at: '2026-07-01T12:00:00Z' },
  { id: 3, tag_id: 'E20003', tyre_serial: '', asset_no: 'TRK-2', site: 'JED', status: 'unassigned', last_scanned_at: null },
  { id: 4, tag_id: 'E20004', tyre_serial: null, asset_no: null, site: '', status: 'retired' },
]

describe('rfidAnalytics', () => {
  it('classifies mapping state', () => {
    expect(rows.map(mappingOf)).toEqual(['full', 'tyre', 'asset', 'none'])
  })

  it('never invents a scan age', () => {
    expect(daysSinceScan(rows[0], NOW)).toBe(2)
    expect(daysSinceScan(rows[2], NOW)).toBeNull()
    expect(daysSinceScan({ last_scanned_at: 'garbage' }, NOW)).toBeNull()
    expect(scanStateOf(rows[0], NOW)).toBe('recent')
    expect(scanStateOf(rows[1], NOW)).toBe('stale')
    expect(scanStateOf(rows[2], NOW)).toBe('never')
    expect(STALE_SCAN_DAYS).toBe(30)
  })

  it('flags a tyre serial mapped to more than one tag, case-insensitively', () => {
    expect([...duplicateSerials(rows).entries()]).toEqual([['SN1', 2]])
    const e = enrichTags(rows, NOW)
    expect(e.map((r) => r._duplicate)).toEqual([true, true, false, false])
    expect(e[0]._tag).toBe('E20001')
  })

  it('computes KPIs with honest null shares', () => {
    const k = rfidKpis(enrichTags(rows, NOW))
    expect(k.total).toBe(4)
    expect(k.mapped).toBe(3)
    expect(k.unmapped).toBe(1)
    expect(k.mappedPct).toBe(75)
    expect(k.assets).toBe(2)
    expect(k.neverScanned).toBe(2)
    expect(k.stale).toBe(1)
    expect(k.duplicates).toBe(2)
    expect(k.byStatus).toEqual({ active: 2, unassigned: 1, retired: 1 })
    const empty = rfidKpis([])
    expect(empty.mappedPct).toBeNull()
    expect(empty.scannedRecentlyPct).toBeNull()
  })

  it('filters by every dimension and counts active filters', () => {
    const e = enrichTags(rows, NOW)
    expect(filterTags(e, { ...EMPTY_RFID_FILTERS, site: 'RUH' })).toHaveLength(2)
    expect(filterTags(e, { ...EMPTY_RFID_FILTERS, mapping: 'none' }).map((r) => r.id)).toEqual([4])
    expect(filterTags(e, { ...EMPTY_RFID_FILTERS, scan: 'never' })).toHaveLength(2)
    expect(filterTags(e, { ...EMPTY_RFID_FILTERS, duplicatesOnly: true })).toHaveLength(2)
    expect(filterTags(e, { ...EMPTY_RFID_FILTERS, search: 'trk-2' }).map((r) => r.id)).toEqual([3])
    expect(activeRfidFilterCount(EMPTY_RFID_FILTERS)).toBe(0)
    expect(activeRfidFilterCount({ ...EMPTY_RFID_FILTERS, site: 'RUH', duplicatesOnly: true })).toBe(2)
  })

  it('builds site series, options and export rows', () => {
    const e = enrichTags(rows, NOW)
    expect(tagsBySite(e)).toEqual([{ site: 'RUH', count: 2 }, { site: 'JED', count: 1 }, { site: 'No site', count: 1 }])
    expect(siteOptions(rows)).toEqual(['JED', 'RUH'])
    const out = rfidExportRows(e)
    expect(out[2]).toMatchObject({ mapping: 'Asset only', scan: 'Never scanned', days_since_scan: 'N/A', duplicate: 'No' })
    expect(out[0].duplicate).toBe('Yes')
  })
})
