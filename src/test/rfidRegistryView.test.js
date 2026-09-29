import { describe, it, expect } from 'vitest'
import {
  classifyVehicleType, duplicateTagIds, lostTagKeys, tagState, buildTagRows, summarizeTagRows,
  stateSegments, countByItemType, scanActivity, filterTagRows, assignmentHistory, registrationsByDay,
  importField, planTagImport, tagExportRows, dayKey,
} from '../lib/rfidRegistryView'

const TAGS = [
  { id: 't1', tag_id: 'e2001', tyre_serial: 'SN-1', status: 'active', site: 'NHC', created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:10Z', last_scanned_at: '2026-09-20T08:00:00Z' },
  { id: 't2', tag_id: 'E2002', asset_no: 'TM514', status: 'active', created_at: '2026-09-02T08:00:00Z', updated_at: '2026-09-10T08:00:00Z' },
  { id: 't3', tag_id: ' E2003 ', status: 'unassigned', created_at: '2026-09-02T09:00:00Z' },
  { id: 't4', tag_id: 'E2004', status: 'unassigned' },
  { id: 't5', tag_id: 'e 2004', asset_no: 'X1', status: 'active' },
  { id: 't6', tag_id: 'E2006', status: 'retired' },
]
const TYRES = new Map([['SN-1', { serial_no: 'SN-1', brand: 'Triangle', size: '315/80R22.5', site: 'NHC' }]])
const FLEET = new Map([['TM514', { asset_no: 'TM514', make: 'Sany', model: 'Mixer', vehicle_type: 'TR-MIXER', site: 'DIRIYAH' }], ['X1', { vehicle_type: 'WHEEL LOADER' }]])

describe('rfidRegistryView', () => {
  it('classifies vehicle types honestly', () => {
    expect(classifyVehicleType('')).toBeNull()
    expect(classifyVehicleType('LOW BED TRAILER')).toBe('trailer')
    expect(classifyVehicleType('Wheel Loader')).toBe('equipment')
    expect(classifyVehicleType('TR-MIXER')).toBe('vehicle')
  })

  it('finds duplicates by normalised tag id', () => {
    expect([...duplicateTagIds(TAGS)]).toEqual(['E2004'])
  })

  it('treats only open lost or not-seen alerts as not found', () => {
    const lost = lostTagKeys([
      { tag_id: 't3', alert_type: 'tag_not_seen' },
      { tag_uid: 'e2002', alert_type: 'lost_tag', resolved_at: '2026-09-02' },
      { tag_uid: 'E2001', alert_type: 'wrong_zone' },
    ])
    expect(lost.ids.has('t3')).toBe(true)
    expect(lost.uids.size).toBe(0)
    expect(tagState(TAGS[2], { lost })).toBe('lost')
  })

  it('builds rows with states, item types and enrichment', () => {
    const rows = buildTagRows({ tags: TAGS, tyresBySerial: TYRES, fleetByAsset: FLEET, events: [] })
    const by = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(by.t1).toMatchObject({ state: 'assigned', itemType: 'tyre', makeModel: 'Triangle', sizeSpec: '315/80R22.5', scanCount: 0, signal: null })
    expect(by.t2).toMatchObject({ itemType: 'vehicle', makeModel: 'Sany Mixer', site: 'DIRIYAH' })
    expect(by.t3.state).toBe('unassigned')
    expect(by.t3.itemType).toBe('other')
    expect(by.t4.state).toBe('duplicate')
    expect(by.t5).toMatchObject({ state: 'duplicate', itemType: 'equipment' })
    expect(by.t6.state).toBe('retired')
  })

  it('leaves scan count null when events were not read, and folds reads when they were', () => {
    expect(buildTagRows({ tags: TAGS.slice(0, 1) })[0].scanCount).toBeNull()
    const [r] = buildTagRows({
      tags: TAGS.slice(0, 1),
      events: [
        { id: 'e1', tag_id: 't1', read_at: '2026-09-25T10:00:00Z', rssi: -45, read_count: 3 },
        { id: 'e2', tag_uid: 'E2001', read_at: '2026-09-24T10:00:00Z', rssi: -80 },
        { id: 'e1', tag_uid: 'E2001', read_at: '2026-09-25T10:00:00Z', rssi: -45, read_count: 3 },
      ],
    })
    expect(r.scanCount).toBe(4)
    expect(r.signal.key).toBe('strong')
    expect(r.lastScannedAt).toBe('2026-09-25T10:00:00.000Z')
  })

  it('summarises without inventing a read success rate', () => {
    const sum = summarizeTagRows(buildTagRows({ tags: TAGS }))
    expect(sum).toMatchObject({ total: 6, assigned: 2, unassigned: 1, duplicate: 2, lost: 0, retired: 1, readSuccessRate: null })
    expect(stateSegments(sum).map((x) => x.key)).toContain('retired')
    expect(stateSegments({ byState: { ...sum.byState, retired: 0 } }).map((x) => x.key)).not.toContain('retired')
    expect(countByItemType(buildTagRows({ tags: TAGS })).map((x) => x.count)).toEqual([1, 0, 0, 0, 5])
  })

  it('bins scan activity per local day and returns null without a feed', () => {
    expect(scanActivity(null)).toBeNull()
    const now = new Date(2026, 8, 29, 12)
    const a = scanActivity([
      { read_at: new Date(2026, 8, 29, 9).toISOString() },
      { read_at: new Date(2026, 8, 28, 9).toISOString(), read_count: 2 },
      { read_at: new Date(2026, 6, 1).toISOString() },
    ], now, 30)
    expect(a.series).toHaveLength(30)
    expect(a.total).toBe(3)
    expect(a.series[29].key).toBe(dayKey(now.getTime()))
    expect(a.series[29].count).toBe(1)
    expect(a.avgPerDay).toBe(0.1)
  })

  it('filters by tab, type, site and search', () => {
    const rows = buildTagRows({ tags: TAGS, tyresBySerial: TYRES, fleetByAsset: FLEET })
    expect(filterTagRows(rows, { tab: 'duplicate' })).toHaveLength(2)
    expect(filterTagRows(rows, { type: 'tyre' })).toHaveLength(1)
    expect(filterTagRows(rows, { site: 'NHC' })).toHaveLength(1)
    expect(filterTagRows(rows, { search: 'sany' })).toHaveLength(1)
    expect(filterTagRows(rows, { make: 'Triangle' })).toHaveLength(1)
  })

  it('derives assignment history and registrations from real timestamps only', () => {
    const rows = buildTagRows({ tags: TAGS })
    const h = assignmentHistory(rows)
    expect(h[0]).toMatchObject({ action: 'Record changed', tagId: 'E2002' })
    expect(h.filter((x) => x.tagId === 'e2001')).toHaveLength(1)
    const reg = registrationsByDay(rows)
    expect(reg.reduce((n, d) => n + d.count, 0)).toBe(3)
  })

  it('plans an import from any reasonable headers', () => {
    expect(importField('RFID Tag ID')).toBe('tag_id')
    expect(importField('EPC')).toBe('tag_id')
    expect(importField('Tyre Serial No')).toBe('tyre_serial')
    expect(importField('Asset No')).toBe('asset_no')
    const plan = planTagImport([
      { 'Tag ID': 'e9', 'Asset No': 'TM1', Status: 'Active' },
      { 'Tag ID': 'E9' },
      { 'Tag ID': 'E2002' },
      { 'Asset No': 'TM2' },
    ], new Set(['E2002']))
    expect(plan.valid).toEqual([{ tag_id: 'E9', tyre_serial: null, asset_no: 'TM1', site: null, status: 'active', notes: null }])
    expect(plan.skipped.map((x) => x.reason)).toEqual(['Repeated in the file', 'Already registered', 'No tag ID'])
  })

  it('exports blanks as empty strings', () => {
    const [r] = tagExportRows(buildTagRows({ tags: TAGS.slice(2, 3) }))
    expect(r.asset).toBe('')
    expect(r.stateLabel).toBe('Unassigned')
  })
})
