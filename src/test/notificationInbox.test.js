import { describe, expect, it } from 'vitest'
import { filterInboxNotifications, groupInboxUpdates } from '../lib/notificationInbox'

const notification = (id, overrides = {}) => ({ id, type: 'approval', title: 'Inspection awaiting approval', message: 'TM671 at QIDDIYA-UPPER PLATEAU needs sign-off.', assetNo: 'TM671', severity: 'Medium', timestamp: '2026-10-18T06:00:00Z', read: false, ...overrides })

describe('notification inbox filtering', () => {
  it('searches existing vehicle, site and message values, ignoring case/whitespace', () => {
    const rows = [notification('1'), notification('2', { message: 'JEDDAH', assetNo: 'WL049' })]
    expect(filterInboxNotifications(rows, 'inbox', ' qIdDiYa ')).toEqual([rows[0]])
    expect(filterInboxNotifications(rows, 'inbox', 'WL049')).toEqual([rows[1]])
    expect(filterInboxNotifications(rows, 'inbox', 'missing')).toEqual([])
  })
  it('does not mistake decisions for pending approvals or high priority for critical', () => {
    const rows = [notification('1'), notification('2', { type: 'approval_decision', read: true }), notification('3', { type: 'tyre_critical', severity: 'Critical' })]
    expect(filterInboxNotifications(rows, 'approvals').map(n => n.id)).toEqual(['1'])
    expect(filterInboxNotifications(rows, 'critical').map(n => n.id)).toEqual(['3'])
    expect(filterInboxNotifications(rows, 'read').map(n => n.id)).toEqual(['2'])
  })
})

describe('notification update grouping', () => {
  it('keeps distinct inspection records on the same asset separate', () => {
    const rows = [notification('1', { entityType: 'inspection', entityId: 'first' }), notification('2', { entityType: 'inspection', entityId: 'second' }), notification('3'), notification('4')]
    expect(groupInboxUpdates(rows)).toHaveLength(4)
  })
  it('groups only matching type and entity, retaining all IDs and the highest severity', () => {
    const older = notification('old', { entityType: 'inspection', entityId: 'one', timestamp: '2026-10-18T05:00:00Z', severity: 'Critical' })
    const newer = notification('new', { entityType: 'inspection', entityId: 'one', read: true })
    const decision = notification('decision', { entityType: 'inspection', entityId: 'one', type: 'approval_decision' })
    const groups = groupInboxUpdates([older, newer, decision])
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ timestamp: newer.timestamp, read: false, severity: 'Critical' })
    expect(groups[0].items.map(n => n.id)).toEqual(['new', 'old'])
    expect(older.read).toBe(false)
    expect(newer.severity).toBe('Medium')
  })
  it('does not multiply an update delivered twice', () => {
    const row = notification('one')
    expect(groupInboxUpdates([row, { ...row }])[0].items).toHaveLength(1)
  })
})
