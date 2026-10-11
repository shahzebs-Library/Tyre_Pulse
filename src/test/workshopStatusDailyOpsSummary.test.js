import { describe, it, expect } from 'vitest'
import {
  buildDailyOpsWorkshopSummary, overdueReleaseCount, releasedTodayCount, latestConfirmedUpload,
  DAILY_OPS_WORKSHOP_LINKS,
} from '../lib/workshopStatus/dailyOpsSummary'

const NOW = new Date(2026, 9, 11, 10, 0, 0) // 11 Oct 2026 local

describe('workshop status daily ops summary', () => {
  const active = [
    { id: 'a', asset_no: 'TM1', ooc_since: '2026-10-01', expected_release_date: '2026-10-09' }, // 10 days, overdue
    { id: 'b', asset_no: 'TM2', ooc_since: '2026-10-08', expected_release_date: '2026-10-11' }, // 3 days, due today
    { id: 'c', asset_no: 'TM3', ooc_since: null, excel_down_days: 8 }, // 8 days, no eta
    { id: 'd', asset_no: 'TM4', ooc_since: null }, // unknown days
  ]

  it('counts active, down more than 7 days and overdue release', () => {
    const s = buildDailyOpsWorkshopSummary({ active, removed: [], uploads: [], now: NOW })
    expect(s.active).toBe(4)
    expect(s.waiting7).toBe(2)
    expect(s.overdueRelease).toBe(1)
  })

  it('does not treat an unknown or today expected date as overdue', () => {
    expect(overdueReleaseCount([{ expected_release_date: null }, { expected_release_date: '2026-10-11' }], { now: NOW })).toBe(0)
  })

  it('counts released today, excluding soft-deleted and earlier releases', () => {
    const removed = [
      { removed_at: new Date(2026, 9, 11, 8, 0).toISOString() },
      { removed_at: new Date(2026, 9, 11, 9, 0).toISOString(), deleted_at: '2026-10-11T09:30:00Z' },
      { removed_at: new Date(2026, 9, 10, 9, 0).toISOString() },
      { removed_at: null },
    ]
    expect(releasedTodayCount(removed, { now: NOW })).toBe(1)
  })

  it('picks the newest confirmed upload and its confirmer', () => {
    const u = latestConfirmedUpload([
      { status: 'confirmed', confirmed_at: '2026-10-09T07:00:00Z', confirmed_by_name: 'Old', upload_no: 1 },
      { status: 'previewed', uploaded_at: '2026-10-11T07:00:00Z', uploaded_by_name: 'Draft', upload_no: 3 },
      { status: 'confirmed', confirmed_at: '2026-10-10T07:00:00Z', confirmed_by_name: ' Ali ', uploaded_by_name: 'X', upload_no: 2 },
    ])
    expect(u).toMatchObject({ by: 'Ali', uploadNo: 2, at: '2026-10-10T07:00:00Z' })
    expect(latestConfirmedUpload([{ status: 'previewed', uploaded_at: '2026-10-11T07:00:00Z' }])).toBeNull()
  })

  it('returns null (never 0) for a source that was not read', () => {
    const s = buildDailyOpsWorkshopSummary({ active: null, removed: null, uploads: null, now: NOW })
    expect(s.active).toBeNull()
    expect(s.waiting7).toBeNull()
    expect(s.overdueRelease).toBeNull()
    expect(s.releasedToday).toBeNull()
    expect(s.lastUpload).toBeNull()
    expect(s.uploadsKnown).toBe(false)
  })

  it('a successful empty read is a real zero', () => {
    const s = buildDailyOpsWorkshopSummary({ active: [], removed: [], uploads: [], now: NOW })
    expect(s).toMatchObject({ active: 0, waiting7: 0, overdueRelease: 0, releasedToday: 0, lastUpload: null, uploadsKnown: true })
  })

  it('links each figure to the matching Workshop Status tab', () => {
    expect(DAILY_OPS_WORKSHOP_LINKS.released).toBe('/daily-ops/workshop?tab=removed')
    expect(DAILY_OPS_WORKSHOP_LINKS.upload).toBe('/daily-ops/workshop?tab=upload')
    expect(DAILY_OPS_WORKSHOP_LINKS.waiting).toBe('/daily-ops/workshop?focus=over7')
  })
})
