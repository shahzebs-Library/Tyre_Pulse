import { describe, it, expect } from 'vitest'
import {
  summarizeRfidRegistry, filterTags, filterReaders, filterAlerts, filterHistory,
  topOpenAlerts, readsByZone, rssiBand, readerHealth, readerSilenceHours,
  alertTypeLabel, tagRows, readerRows, alertRows, historyRows, distinctValues,
} from '../lib/rfidRegistryAnalytics'

const NOW = new Date('2026-09-15T12:00:00')

describe('rfidRegistryAnalytics', () => {
  it('summarises tags, readers and alerts with honest null shares', () => {
    const empty = summarizeRfidRegistry({ now: NOW })
    expect(empty.attachedPct).toBeNull()
    expect(empty.linkedPct).toBeNull()
    const s = summarizeRfidRegistry({
      tags: [
        { status: 'attached', tyre_record_id: 'x' },
        { status: 'lost' },
        { status: 'damaged' },
        { status: 'available' },
      ],
      readers: [
        { status: 'active', last_heartbeat: '2026-09-15T10:00:00' },
        { status: 'active', last_heartbeat: '2026-09-10T10:00:00' },
        { status: 'active' },
        { status: 'maintenance' },
      ],
      alerts: [
        { severity: 'critical', created_at: '2026-09-15T08:00:00' },
        { severity: 'low', created_at: '2026-09-01T08:00:00' },
        { severity: 'high', created_at: '2026-09-15T08:00:00', resolved_at: '2026-09-15T09:00:00' },
      ],
      now: NOW,
    })
    expect(s.totalTags).toBe(4)
    expect(s.lostOrDamaged).toBe(2)
    expect(s.attachedPct).toBe(25)
    expect(s.linkedToTyre).toBe(1)
    expect(s.activeReaders).toBe(3)
    expect(s.readerHealth).toEqual({ online: 1, stale: 1, never: 1, inactive: 1 })
    expect(s.alertsOpen).toBe(2)
    expect(s.alertsToday).toBe(1)
    expect(s.criticalOpen).toBe(1)
    expect(s.alertsResolved).toBe(1)
  })

  it('reader silence is null when a reader never reported', () => {
    expect(readerSilenceHours({}, NOW)).toBeNull()
    expect(readerSilenceHours({ last_heartbeat: '2026-09-15T09:00:00' }, NOW)).toBe(3)
    expect(readerHealth({ status: 'active' }, NOW)).toBe('never')
  })

  it('filters tags by text, status and site', () => {
    const tags = [
      { tag_uid: 'E200', status: 'attached', site: 'NHC', tyre_records: { serial_no: 'SN1', asset_no: 'TM1' } },
      { tag_uid: 'E300', status: 'lost', site: 'JED' },
    ]
    expect(filterTags(tags, { search: 'sn1' })).toHaveLength(1)
    expect(filterTags(tags, { status: 'lost' })[0].tag_uid).toBe('E300')
    expect(filterTags(tags, { site: 'NHC' })).toHaveLength(1)
    expect(distinctValues(tags, (t) => t.site)).toEqual(['JED', 'NHC'])
  })

  it('filters readers, alerts and history', () => {
    expect(filterReaders([{ name: 'Gate', status: 'active' }, { name: 'Bay', status: 'offline' }], { health: 'inactive', now: NOW })).toHaveLength(1)
    const alerts = [
      { id: 1, severity: 'low', created_at: '2026-09-01', message: 'x' },
      { id: 2, severity: 'critical', created_at: '2026-09-02', message: 'door', resolved_at: '2026-09-03' },
    ]
    expect(filterAlerts(alerts, { scope: 'open' })).toHaveLength(1)
    expect(filterAlerts(alerts, { scope: 'all' })[0].id).toBe(2)
    expect(filterAlerts(alerts, { scope: 'all', search: 'door' })).toHaveLength(1)
    expect(filterHistory([{ tag_uid: 'A', site: 'S1' }, { tag_uid: 'B', site: 'S2' }], { site: 'S2' })).toHaveLength(1)
  })

  it('top open alerts rank by severity then recency', () => {
    const top = topOpenAlerts([
      { id: 'a', severity: 'low', created_at: '2026-09-10' },
      { id: 'b', severity: 'critical', created_at: '2026-09-01' },
      { id: 'c', severity: 'critical', created_at: '2026-09-05' },
      { id: 'd', severity: 'high', resolved_at: '2026-09-05' },
    ], 2)
    expect(top.map((a) => a.id)).toEqual(['c', 'b'])
  })

  it('rssi bands and zone read counts', () => {
    expect(rssiBand(null)).toBeNull()
    expect(rssiBand(-40).key).toBe('strong')
    expect(rssiBand(-60).key).toBe('fair')
    expect(rssiBand(-80).key).toBe('weak')
    expect(readsByZone([{ zone_name: 'A' }, { zone_name: 'A', read_count: 3 }, {}])).toEqual([
      { zone: 'A', reads: 4 }, { zone: 'Unzoned', reads: 1 },
    ])
  })

  it('row shapers carry labels and nulls, not blanks', () => {
    expect(alertTypeLabel('tag_not_seen')).toBe('Tag not seen')
    expect(alertTypeLabel(null)).toBe('N/A')
    expect(tagRows([{ id: 1, status: 'attached', tyre_records: { serial_no: 'S' } }])[0]).toMatchObject({ serial: 'S', statusLabel: 'Attached', asset: null })
    expect(readerRows([{ id: 1, status: 'active' }], NOW)[0].healthLabel).toBe('Never reported')
    expect(alertRows([{ id: 1, severity: 'high', resolved_at: 'x' }])[0]).toMatchObject({ state: 'Resolved', severityRank: 3 })
    expect(historyRows([{ tag_uid: 'T', read_at: '2026-09-01' }])[0]).toMatchObject({ rssi: null, rssiLabel: 'N/A' })
  })
})
