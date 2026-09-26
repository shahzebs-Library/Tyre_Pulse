import { describe, it, expect } from 'vitest'
import { washCompliance } from '../lib/washAnalytics'

const now = '2026-07-20'

describe('washCompliance', () => {
  it('is N/A (null) when no vehicle has a completed wash', () => {
    const c = washCompliance([], { now })
    expect(c.tracked).toBe(0)
    expect(c.compliancePct).toBeNull()
    expect(c.worstDaysOverdue).toBeNull()
  })

  it('ignores plans when judging which vehicles are tracked', () => {
    const c = washCompliance([{ asset_no: 'A1', wash_date: '2026-07-25', status: 'Scheduled' }], { now })
    expect(c.tracked).toBe(0)
    expect(c.compliancePct).toBeNull()
    expect(c.scheduledUpcoming).toBe(1)
  })

  it('splits tracked vehicles into on-interval and overdue', () => {
    const rows = [
      { asset_no: 'A1', wash_date: '2026-07-18', status: 'Completed' }, // 2 days ago: fine
      { asset_no: 'A2', wash_date: '2026-07-01', status: 'Completed' }, // 19 days ago: overdue 12
      { asset_no: 'A2', wash_date: '2026-06-01', status: 'Completed' },
      { asset_no: 'A3', wash_date: '2026-07-19', status: 'Completed' },
    ]
    const c = washCompliance(rows, { now })
    expect(c.tracked).toBe(3)
    expect(c.overdue).toBe(1)
    expect(c.onInterval).toBe(2)
    expect(c.compliancePct).toBeCloseTo(66.67, 1)
    expect(c.worstDaysOverdue).toBe(12)
  })

  it('honours a custom interval', () => {
    const rows = [{ asset_no: 'A1', wash_date: '2026-07-10', status: 'Completed' }]
    expect(washCompliance(rows, { now, intervalDays: 14 }).overdue).toBe(0)
    expect(washCompliance(rows, { now, intervalDays: 7 }).overdue).toBe(1)
  })

  it('counts a missed plan as scheduled overdue', () => {
    const rows = [{ asset_no: 'A9', wash_date: '2026-07-10', status: 'Scheduled' }]
    expect(washCompliance(rows, { now }).scheduledOverdue).toBe(1)
  })
})
