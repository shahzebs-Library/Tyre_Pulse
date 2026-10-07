import {
  daysDown, updatedToday, isMine, filterRecords, sortByDaysDown, formFromRecord, diffPatch,
  validateForm, shapePermissions, isStaleError, localDay, WorkshopRecord,
} from '../lib/workshopStatusView'

jest.mock('../lib/supabase', () => ({ supabase: {} }))
import { notificationRoute } from '../lib/notificationsInbox'

const base = (over: Partial<WorkshopRecord> = {}): WorkshopRecord => ({
  id: 'r1', asset_no: 'TM514', site: 'NHC', country: 'KSA', complaint: 'Brake noise',
  current_stage: 'Repair in Progress', delay_reason: null, detailed_reason: null, work_done: null,
  action_taken: null, next_action: null, parts_status: null, mr_number: null, po_number: null,
  responsible_user_id: 'u1', supporting_user_id: null, expected_part_date: null,
  expected_release_date: '2026-10-09', blocker: null, remarks: null, current_active: true,
  deleted_at: null, ooc_since: '2026-10-01', excel_down_days: null,
  updated_at: '2026-10-07T08:00:00.123456+00:00', last_updated_by_name: null,
  last_manual_update_at: null, removed_at: null, ...over,
})

const NOW = new Date(2026, 9, 7, 12, 0, 0)

describe('days down', () => {
  it('prefers the daily file figure', () => expect(daysDown(base({ excel_down_days: 12 }), NOW)).toBe(12))
  it('derives from ooc_since in local days', () => expect(daysDown(base(), NOW)).toBe(6))
  it('is null, never 0, when unknown', () => expect(daysDown(base({ ooc_since: null }), NOW)).toBeNull())
})

describe('updated today', () => {
  it('false when never updated', () => expect(updatedToday(base(), NOW)).toBe(false))
  it('true for a same-day update', () => {
    expect(updatedToday(base({ last_manual_update_at: new Date(2026, 9, 7, 7).toISOString() }), NOW)).toBe(true)
  })
  it('false for yesterday', () => {
    expect(updatedToday(base({ last_manual_update_at: new Date(2026, 9, 6, 7).toISOString() }), NOW)).toBe(false)
  })
})

describe('mine / search / sort', () => {
  const rows = [base(), base({ id: 'r2', asset_no: 'MP083', responsible_user_id: 'u2', supporting_user_id: 'u1', excel_down_days: 30 }),
    base({ id: 'r3', asset_no: 'GN103', responsible_user_id: 'u9', complaint: 'Generator fault' })]
  it('mine = responsible or supporting', () => {
    expect(filterRecords(rows, { mine: true, userId: 'u1' }).map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(isMine(rows[2], null)).toBe(false)
  })
  it('all + search', () => expect(filterRecords(rows, { mine: false, query: 'generator' }).map((r) => r.id)).toEqual(['r3']))
  it('longest down first', () => expect(sortByDaysDown(rows, NOW)[0].id).toBe('r2'))
})

describe('patch + validation', () => {
  it('sends only changed fields; a cleared field is null', () => {
    const orig = formFromRecord(base())
    const f = { ...orig, current_stage: 'Testing', expected_release_date: '', remarks: ' ok ' }
    expect(diffPatch(orig, f, true)).toEqual({ current_stage: 'Testing', expected_release_date: null, remarks: 'ok' })
  })
  it('drops people fields without assign permission', () => {
    const orig = formFromRecord(base())
    expect(diffPatch(orig, { ...orig, responsible_user_id: 'u7' }, false)).toEqual({})
  })
  it('never contains who/when fields', () => {
    const orig = formFromRecord(base())
    const p = diffPatch(orig, { ...orig, work_done: 'Pads replaced' }, true)
    expect(Object.keys(p)).toEqual(['work_done'])
  })
  it('Other requires a detailed reason; off-list values refused', () => {
    const f = formFromRecord(base())
    expect(validateForm({ ...f, delay_reason: 'Other' })).toBe('detailedReason')
    expect(validateForm({ ...f, delay_reason: 'Other', detailed_reason: 'Paint shop' })).toBeNull()
    expect(validateForm({ ...f, current_stage: 'Made up' })).toBe('stage')
    expect(validateForm({ ...f, parts_status: 'Nope' })).toBe('parts')
    expect(validateForm({ ...f, expected_part_date: '07/10/2026' })).toBe('partDate')
  })
  it('date columns are trimmed to the day', () => {
    expect(formFromRecord(base({ expected_part_date: '2026-10-08T00:00:00' })).expected_part_date).toBe('2026-10-08')
    expect(localDay(new Date(2026, 0, 2))).toBe('2026-01-02')
  })
})

describe('permissions + concurrency', () => {
  it('fails closed', () => {
    expect(shapePermissions(null)).toEqual({ view: false, update: false, assign: false })
    expect(shapePermissions({ view: true, update: 'true', assign: true })).toEqual({ view: true, update: false, assign: true })
  })
  it('PT409 is the stale-record refusal', () => {
    expect(isStaleError({ code: 'PT409' })).toBe(true)
    expect(isStaleError({ message: 'record_changed' })).toBe(true)
    expect(isStaleError({ code: '42501' })).toBe(false)
  })
})

describe('workshop status notifications open the workshop-status screen', () => {
  it('a daily-ops workshop link opens the list', () => {
    expect(notificationRoute({ type: 'upload', entity_type: null, link: '/daily-ops/workshop' })).toBe('/(app)/workshop-status')
  })
  it('a workshop_status record notification opens the record', () => {
    expect(notificationRoute({ type: 'workshop_status.assigned', entity_type: 'workshop_status_record', entity_id: 'abc' }))
      .toBe('/(app)/workshop-status/abc')
  })
  it('an upload id is not treated as a record', () => {
    expect(notificationRoute({ type: 'workshop_status_upload', entity_type: 'workshop_status_upload', entity_id: 'u1' }))
      .toBe('/(app)/workshop-status')
  })
  it('an asset-only push opens the vehicle by asset', () => {
    expect(notificationRoute({ type: 'workshop_status', entity_type: null, asset_no: 'TM514' })).toBe('/(app)/workshop-status/TM514')
  })
  it('Workshop Live job notifications still go to My Jobs', () => {
    expect(notificationRoute({ type: 'workshop.job_assigned', entity_type: 'wo_assignment' })).toBe('/(app)/workshop')
  })
})
