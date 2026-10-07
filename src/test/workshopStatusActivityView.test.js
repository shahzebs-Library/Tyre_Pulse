import { describe, it, expect } from 'vitest'
import {
  actionGroupOf, serverFilterFor, ACTION_GROUP_KEYS, formatValue, collectPersonIds, shapeEvent,
  shapeActivity, filterActivity, actorOptions, actorSummary, dayRangeToIso, daysAgo, workload,
  workloadFlags, UNASSIGNED_KEY, distinctOf,
} from '../lib/workshopStatus/activityView'

const NOW = new Date(2026, 9, 7, 12, 0, 0)
const todayIso = new Date(2026, 9, 7, 9, 0, 0).toISOString()
const yesterdayIso = new Date(2026, 9, 6, 9, 0, 0).toISOString()

describe('action groups', () => {
  it('classifies field changes by field', () => {
    expect(actionGroupOf({ event_type: 'field_change', field_name: 'responsible_user_id' })).toBe('assignment')
    expect(actionGroupOf({ event_type: 'field_change', field_name: 'supporting_user_id' })).toBe('assignment')
    expect(actionGroupOf({ event_type: 'field_change', field_name: 'expected_release_date' })).toBe('eta_change')
    expect(actionGroupOf({ event_type: 'field_change', field_name: 'final_disposition' })).toBe('disposition')
    expect(actionGroupOf({ event_type: 'field_change', field_name: 'current_stage' })).toBe('field_change')
  })

  it('classifies the other event types', () => {
    expect(actionGroupOf({ event_type: 'manual_update' })).toBe('manual_update')
    expect(actionGroupOf({ event_type: 'upload_confirmed' })).toBe('upload_confirmed')
    expect(actionGroupOf({ event_type: 'upload_previewed' })).toBe('upload_previewed')
    expect(actionGroupOf({ event_type: 'upload_cancelled' })).toBe('upload_cancelled')
    expect(actionGroupOf({ event_type: 'added' })).toBe('added')
    expect(actionGroupOf({ event_type: 'removed' })).toBe('removed')
    expect(actionGroupOf({ event_type: 'soft_deleted' })).toBe('removed')
    expect(actionGroupOf({ event_type: 'restored' })).toBe('restore')
    expect(actionGroupOf({ event_type: 'final_disposition' })).toBe('disposition')
    expect(actionGroupOf({ event_type: 'export' })).toBe('export')
    expect(actionGroupOf({ event_type: 'excel_updated' })).toBe('excel_refresh')
    expect(actionGroupOf({ event_type: 'attachment_added' })).toBe('attachment')
  })

  it('every group has a server filter, unknown groups have none', () => {
    for (const k of ACTION_GROUP_KEYS) expect(serverFilterFor(k)).not.toBeNull()
    expect(serverFilterFor('nope')).toBeNull()
    expect(serverFilterFor('assignment')).toEqual({ eventTypes: ['field_change'], fields: ['responsible_user_id', 'supporting_user_id'] })
    expect(serverFilterFor('field_change').excludeFields).toContain('expected_release_date')
    expect(serverFilterFor('disposition').orFilter).toContain('event_type.eq.final_disposition')
    expect(serverFilterFor('removed').eventTypes).toEqual(['removed', 'archived', 'soft_deleted', 'permanently_deleted'])
  })
})

describe('formatValue', () => {
  const people = new Map([['u1', 'Ahmed Khan']])
  it('formats people, dates, booleans and blanks', () => {
    expect(formatValue('responsible_user_id', 'u1', { people })).toBe('Ahmed Khan')
    expect(formatValue('responsible_user_id', 'u9', { people, unknownPerson: 'Unknown' })).toBe('Unknown')
    expect(formatValue('expected_release_date', '2026-10-08')).toBe('08 Oct 2026')
    expect(formatValue('current_active', 'false')).toBe('No')
    expect(formatValue('current_stage', '  ')).toBeNull()
    expect(formatValue('current_stage', 'Waiting for Parts')).toBe('Waiting for Parts')
  })

  it('collects actor and person-field ids', () => {
    const ids = collectPersonIds([
      { actor_id: 'a1', field_name: 'responsible_user_id', old_value: 'u1', new_value: 'u2' },
      { actor_id: 'a1', field_name: 'current_stage', old_value: 'x', new_value: 'y' },
      { actor_id: null },
    ])
    expect(ids.sort()).toEqual(['a1', 'u1', 'u2'])
  })
})

describe('shapeEvent', () => {
  const records = new Map([['r1', { id: 'r1', asset_no: 'TM599', site: 'NHC', current_stage: 'Waiting for Parts', delay_reason: 'MR Pending', daily_report_status: 'active', current_active: true }]])
  const uploads = new Map([['up1', { id: 'up1', upload_no: 126, file_name: 'morning.xlsx' }]])
  const people = new Map([['a1', 'Sajid']])

  it('joins record, upload and actor', () => {
    const row = shapeEvent({ id: 'e1', event_type: 'field_change', field_name: 'current_stage', old_value: 'Waiting for Diagnosis', new_value: 'Waiting for Parts', record_id: 'r1', actor_id: 'a1', actor_name: 'old name', created_at: todayIso, upload_id: 'up1' }, { records, uploads, people })
    expect(row).toMatchObject({ actorName: 'Sajid', assetNo: 'TM599', site: 'NHC', field: 'current_stage', oldValue: 'Waiting for Diagnosis', newValue: 'Waiting for Parts', group: 'field_change', uploadNo: 126, uploadFile: 'morning.xlsx', recordStage: 'Waiting for Parts', recordDelay: 'MR Pending', isSystem: false })
  })

  it('marks events without an actor as system and keeps upload events without a record', () => {
    const row = shapeEvent({ id: 'e2', event_type: 'upload_confirmed', upload_id: 'up1', details: { new: 2 } }, { uploads })
    expect(row.isSystem).toBe(true)
    expect(row.actorName).toBeNull()
    expect(row.assetNo).toBeNull()
    expect(row.recordStage).toBeNull()
    expect(row.field).toBeNull()
    expect(row.uploadNo).toBe(126)
  })

  it('falls back to the stored actor name and to the details file name', () => {
    const row = shapeEvent({ id: 'e3', event_type: 'upload_previewed', actor_id: 'a2', actor_name: 'Vinay', details: { file_name: 'x.xlsx' }, upload_id: 'zz' })
    expect(row.actorName).toBe('Vinay')
    expect(row.uploadFile).toBe('x.xlsx')
  })
})

describe('client filters and summaries', () => {
  const rows = shapeActivity([
    { id: '1', event_type: 'field_change', field_name: 'current_stage', record_id: 'r1', actor_id: 'a1', actor_name: 'Sajid', asset_no: 'TM1', site: 'NHC' },
    { id: '2', event_type: 'manual_update', record_id: 'r2', actor_id: 'a1', actor_name: 'Sajid', asset_no: 'TM2', site: 'JED' },
    { id: '3', event_type: 'upload_confirmed', actor_id: 'a2', actor_name: 'Vinay' },
    { id: '4', event_type: 'manual_update', record_id: 'r1', actor_id: 'a1', actor_name: 'Sajid', asset_no: 'TM1', site: 'NHC' },
  ], { records: new Map([
    ['r1', { current_stage: 'Waiting for Parts', delay_reason: 'MR Pending' }],
    ['r2', { current_stage: 'Repair in Progress', delay_reason: null }],
  ]) })

  it('filters on current stage and delay reason, excluding upload rows', () => {
    expect(filterActivity(rows, {}).length).toBe(4)
    expect(filterActivity(rows, { status: 'Waiting for Parts' }).map((r) => r.id)).toEqual(['1', '4'])
    expect(filterActivity(rows, { delayReason: 'MR Pending', status: 'Repair in Progress' })).toEqual([])
  })

  it('lists actors and counts events and vehicles per person', () => {
    expect(actorOptions(rows)).toEqual([{ id: 'a1', name: 'Sajid' }, { id: 'a2', name: 'Vinay' }])
    const s = actorSummary(rows)
    expect(s[0]).toMatchObject({ id: 'a1', events: 3, vehicles: 2 })
    expect(s[1]).toMatchObject({ id: 'a2', events: 1, vehicles: 0 })
    expect(distinctOf(rows, 'site')).toEqual(['JED', 'NHC'])
  })
})

describe('date helpers', () => {
  it('turns local days into an exclusive ISO range', () => {
    const r = dayRangeToIso('2026-10-01', '2026-10-07')
    expect(new Date(r.from).getTime()).toBe(new Date(2026, 9, 1).getTime())
    expect(new Date(r.to).getTime()).toBe(new Date(2026, 9, 8).getTime())
    expect(dayRangeToIso('', 'bad')).toEqual({ from: null, to: null })
  })
  it('days ago is a local day', () => {
    expect(daysAgo(NOW, 7)).toBe('2026-09-30')
  })
})

describe('workload', () => {
  const records = [
    { id: '1', responsible_user_id: 'u1', responsible_name: 'Ahmed', current_stage: 'Repair in Progress', last_manual_update_at: todayIso },
    { id: '2', responsible_user_id: 'u1', responsible_name: 'Ahmed', current_stage: 'Waiting for Parts', last_manual_update_at: yesterdayIso },
    { id: '3', responsible_user_id: 'u2', responsible_name: 'Sajid', current_stage: 'Testing', parts_status: 'PO Issued', delay_reason: 'Waiting for Budget Approval' },
    { id: '4', responsible_user_id: null, current_stage: 'Waiting for Approval' },
    { id: '5', responsible_user_id: 'u2', current_active: false },
    { id: '6', responsible_user_id: 'u2', deleted_at: todayIso },
  ]

  it('counts per person with Unassigned last and totals', () => {
    const { rows, totals } = workload(records, { now: NOW })
    expect(rows.map((r) => r.id)).toEqual(['u1', 'u2', UNASSIGNED_KEY])
    expect(rows[0]).toMatchObject({ name: 'Ahmed', assigned: 2, inProgress: 1, waitingParts: 1, waitingApproval: 0, pendingToday: 1 })
    expect(rows[1]).toMatchObject({ name: 'Sajid', assigned: 1, inProgress: 0, waitingParts: 1, waitingApproval: 1, pendingToday: 1 })
    expect(rows[2]).toMatchObject({ unassigned: true, assigned: 1, waitingApproval: 1, pendingToday: 1 })
    expect(totals).toEqual({ assigned: 4, inProgress: 1, waitingParts: 2, waitingApproval: 2, pendingToday: 3 })
  })

  it('parts not required or received is not waiting parts', () => {
    expect(workloadFlags({ parts_status: 'Received' }, NOW).waitingParts).toBe(false)
    expect(workloadFlags({ parts_status: 'Not Required' }, NOW).waitingParts).toBe(false)
    expect(workloadFlags({ parts_status: 'MR Raised' }, NOW).waitingParts).toBe(true)
  })

  it('is empty for no records', () => {
    expect(workload([], { now: NOW })).toEqual({ rows: [], totals: { assigned: 0, inProgress: 0, waitingParts: 0, waitingApproval: 0, pendingToday: 0 } })
  })
})
