import { describe, it, expect } from 'vitest'
import {
  statusMeta, cleanSerial, sameSerial, recordKm, currentAssignment, historyEvents,
  filterEvents, eventCounts, lifeUsage, sparkPath, recordPhotos,
} from '../lib/serialTrackerView'

const recs = [
  { id: 1, asset_no: 'TM1', site: 'NHC', position: 'LHF1', status: 'Removed', issue_date: '2025-01-01', removal_date: '2025-06-01', total_km: 30000, removal_reason: 'WORN OUT', tread_depth: 12 },
  { id: 2, asset_no: 'TM2', site: 'JED', tyre_position: 'RHF1 ', status: 'Active', issue_date: '2025-07-01', km_at_fitment: 1000, km_at_removal: null, tread_depth: 8, vehicle_type: 'TR-MIXER' },
]

describe('serialTrackerView', () => {
  it('maps stored status to page labels, scrap mark wins', () => {
    expect(statusMeta('Active').label).toBe('Installed')
    expect(statusMeta('Scrapped').label).toBe('Disposed')
    expect(statusMeta('Active', { scrapped: true }).label).toBe('Disposed')
    expect(statusMeta('').label).toBe('Unknown')
  })

  it('normalises padded serials', () => {
    expect(cleanSerial('YLY59042\t\t')).toBe('YLY59042')
    expect(sameSerial(' abc\t', 'ABC')).toBe(true)
    expect(sameSerial('', '')).toBe(false)
  })

  it('measures distance honestly', () => {
    expect(recordKm({ total_km: 500 })).toBe(500)
    expect(recordKm({ km_at_fitment: 100, km_at_removal: 600 })).toBe(500)
    expect(recordKm({ km_at_fitment: 600, km_at_removal: 100 })).toBe(null)
    expect(recordKm({ total_km: 0 })).toBe(null)
  })

  it('finds the current assignment from the latest active record', () => {
    expect(currentAssignment(recs)).toMatchObject({ asset_no: 'TM2', position: 'RHF1', site: 'JED', installed: '2025-07-01' })
    expect(currentAssignment([recs[0]])).toBe(null)
  })

  it('builds installation, removal, transfer and disposal events newest first', () => {
    const ev = historyEvents(recs, { scrapMark: { created_at: '2025-09-01', reason: 'Cut' } })
    expect(ev.map((e) => e.type)).toEqual(['disposal', 'transfer', 'replacement', 'installation'])
    expect(ev[1]).toMatchObject({ from: 'NHC', to: 'JED', vehicle: 'TM2' })
    expect(ev[2].remarks).toBe('WORN OUT')
    expect(filterEvents(ev, 'transfer')).toHaveLength(1)
    expect(filterEvents(ev, 'all')).toHaveLength(4)
    expect(eventCounts(ev)).toMatchObject({ all: 4, transfer: 1, disposal: 1 })
  })

  it('sums measured life and says how many fitments were measured', () => {
    const u = lifeUsage(recs)
    expect(u.totalKm).toBe(30000)
    expect(u.measured).toBe(1)
    expect(u.currentKm).toBe(null)
    expect(u.series.wear).toHaveLength(2)
    expect(lifeUsage([]).totalKm).toBe(null)
  })

  it('draws a path only with two or more points', () => {
    expect(sparkPath([{ value: 1 }])).toBe(null)
    expect(sparkPath([{ value: 1 }, { value: 3 }]).coords).toHaveLength(2)
  })

  it('collects unique photo refs from jsonb', () => {
    expect(recordPhotos([{ photos: ['a', { url: 'b' }] }, { photos: ['a'] }, { photos: null }])).toEqual(['a', 'b'])
  })
})
