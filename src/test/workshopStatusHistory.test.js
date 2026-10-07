import { describe, it, expect } from 'vitest'
import {
  groupHistory, classifyEntry, formatValue, formatDay, collectPersonIds, filterEntries,
  categoryCounts, historyExportRows, sourceLabel, fieldLabel, HISTORY_FIELD_LABELS, HISTORY_CATEGORIES,
} from '../lib/workshopStatus/history'
import en from '../locales/en/workshopStatusHistory.json'
import ar from '../locales/ar/workshopStatusHistory.json'

const P1 = '00000000-0000-0000-0000-000000000001'
const P2 = '00000000-0000-0000-0000-000000000002'
let n = 0
const ev = (over) => ({
  id: `e${String(++n).padStart(3, '0')}`, record_id: 'r1', asset_no: 'TM1', upload_id: null,
  event_type: 'field_change', field_name: null, old_value: null, new_value: null, reason: null,
  source: 'manual', details: {}, actor_id: 'u1', actor_name: 'Ground Mechanic',
  created_at: '2026-10-07T09:00:00.100000+00:00', ...over,
})

const T_IMPORT = '2026-10-05T06:00:00.000001+00:00'
const T_MANUAL = '2026-10-06T10:15:30.500000+00:00'
const T_ASSIGN = '2026-10-06T11:00:00.000000+00:00'
const T_REMOVE = '2026-10-07T06:00:00.000000+00:00'

const EVENTS = [
  ev({ event_type: 'added', source: 'excel', upload_id: 'up1', actor_id: 'sup', actor_name: 'Sajid', created_at: T_IMPORT, details: { message: 'Vehicle added through Daily Workshop Excel upload.' } }),
  ev({ event_type: 'manual_update', created_at: T_MANUAL, details: { changed: 2 } }),
  ev({ field_name: 'current_stage', old_value: null, new_value: 'Waiting for Parts', created_at: T_MANUAL }),
  ev({ field_name: 'expected_release_date', old_value: null, new_value: '2026-10-20', created_at: T_MANUAL }),
  ev({ event_type: 'manual_update', actor_id: 'sup', actor_name: 'Sajid', created_at: T_ASSIGN }),
  ev({ field_name: 'responsible_user_id', old_value: null, new_value: P1, actor_id: 'sup', actor_name: 'Sajid', created_at: T_ASSIGN }),
  ev({ field_name: 'supporting_user_id', old_value: P2, new_value: null, actor_id: 'sup', actor_name: 'Sajid', created_at: T_ASSIGN }),
  ev({ event_type: 'removed', source: 'excel', upload_id: 'up2', actor_id: 'sup', actor_name: 'Sajid', reason: 'missing_from_upload', created_at: T_REMOVE }),
  ev({ field_name: 'current_active', old_value: 'true', new_value: 'false', source: 'excel', upload_id: 'up2', actor_id: 'sup', actor_name: 'Sajid', reason: 'missing_from_upload', created_at: T_REMOVE }),
  ev({ field_name: 'daily_report_status', old_value: 'active', new_value: 'removed_from_current_report', source: 'excel', upload_id: 'up2', actor_id: 'sup', actor_name: 'Sajid', reason: 'missing_from_upload', created_at: T_REMOVE }),
]

describe('groupHistory', () => {
  it('folds one action into one entry, newest first', () => {
    const entries = groupHistory([...EVENTS].reverse())
    expect(entries.map((e) => e.at)).toEqual([T_REMOVE, T_ASSIGN, T_MANUAL, T_IMPORT])
    const manual = entries[2]
    expect(manual.actorName).toBe('Ground Mechanic')
    expect(manual.source).toBe('manual')
    expect(manual.changes.map((c) => c.field)).toEqual(['current_stage', 'expected_release_date'])
    expect(manual.changes[0]).toEqual({ field: 'current_stage', oldValue: null, newValue: 'Waiting for Parts' })
  })

  it('keeps two actions at the same instant apart when actor or upload differ', () => {
    const a = ev({ event_type: 'manual_update', created_at: T_MANUAL, actor_id: 'x' })
    const b = ev({ event_type: 'manual_update', created_at: T_MANUAL, actor_id: 'y' })
    expect(groupHistory([a, b])).toHaveLength(2)
  })

  it('classifies import, manual + ETA, assignment and removal', () => {
    const [removal, assign, manual, imp] = groupHistory(EVENTS)
    expect(imp.categories).toEqual(['import'])
    expect(imp.message).toMatch(/Excel upload/)
    expect(manual.categories).toEqual(['manual', 'eta'])
    expect(assign.categories).toEqual(['manual', 'assignment'])
    expect(removal.categories[0]).toBe('removal')
    expect(removal.reason).toBe('missing_from_upload')
    expect(removal.changes.map((c) => c.field)).toEqual(['current_active', 'daily_report_status'])
  })

  it('classifies restore, disposition, attachment and deletion', () => {
    const cls = (events) => classifyEntry(groupHistory(events)[0])
    expect(cls([ev({ event_type: 'restored' })])).toEqual(['restore'])
    expect(cls([ev({ field_name: 'current_active', old_value: 'false', new_value: 'true', source: 'system' })])).toEqual(['restore'])
    expect(cls([ev({ field_name: 'final_disposition', new_value: 'Scrap', source: 'system' })])).toEqual(['disposition'])
    expect(cls([ev({ event_type: 'attachment_added' })])).toContain('attachment')
    expect(cls([ev({ event_type: 'permanently_deleted', source: 'system' })])).toEqual(['deletion'])
    expect(cls([ev({ field_name: 'archived_at', new_value: '2026-10-07T00:00:00Z', source: 'system' })])).toEqual(['removal'])
    expect(cls([ev({ event_type: 'export', source: 'system' })])).toEqual(['other'])
  })
})

describe('formatValue', () => {
  it('shows blank, people by name, dates readable, booleans as words', () => {
    const userNames = { [P1]: 'Helper Tech' }
    expect(formatValue('remarks', null)).toBe('(blank)')
    expect(formatValue('remarks', '  ')).toBe('(blank)')
    expect(formatValue('responsible_user_id', P1, { userNames })).toBe('Helper Tech')
    expect(formatValue('responsible_user_id', P2, { userNames })).toBe('Unknown person')
    expect(formatValue('expected_release_date', '2026-10-20')).toBe('20 Oct 2026')
    expect(formatValue('current_active', 'false')).toBe('No')
    expect(formatValue('current_active', 'true', { labels: { yes: 'Oui' } })).toBe('Oui')
    expect(formatValue('remarks', null, { labels: { blank: '(vide)' } })).toBe('(vide)')
    expect(formatValue('mr_number', 'MR-1')).toBe('MR-1')
  })
  it('formatDay never shifts the day and leaves junk alone', () => {
    expect(formatDay('2026-01-01')).toBe('01 Jan 2026')
    expect(formatDay('2026-13-01')).toBe('2026-13-01')
    expect(formatDay('soon')).toBe('soon')
  })
})

describe('helpers', () => {
  it('collects person ids from old and new values', () => {
    expect(collectPersonIds(EVENTS).sort()).toEqual([P1, P2])
    expect(collectPersonIds([ev({ field_name: 'responsible_user_id', new_value: 'not-a-uuid' })])).toEqual([])
  })
  it('filters and counts by category', () => {
    const entries = groupHistory(EVENTS)
    expect(filterEntries(entries, 'all')).toHaveLength(4)
    expect(filterEntries(entries, 'assignment')).toHaveLength(1)
    expect(filterEntries(entries, 'manual')).toHaveLength(2)
    const counts = categoryCounts(entries)
    expect(counts).toMatchObject({ import: 1, manual: 2, eta: 1, assignment: 1, removal: 1, restore: 0 })
  })
  it('export rows carry who, when, source, field, old and new', () => {
    const rows = historyExportRows(groupHistory(EVENTS), { userNames: { [P1]: 'Helper Tech', [P2]: 'Ground Mechanic' } })
    const resp = rows.find((r) => r.field === 'Responsible person')
    expect(resp).toMatchObject({ actor: 'Sajid', source: 'Manual', old_value: '(blank)', new_value: 'Helper Tech' })
    const sup = rows.find((r) => r.field === 'Supporting person')
    expect(sup.old_value).toBe('Ground Mechanic')
    const imp = rows.find((r) => r.source === 'Excel upload' && r.field === '')
    expect(imp.category).toBe('Excel import')
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/[\u2013\u2014]/)
  })
  it('labels', () => {
    expect(sourceLabel('excel')).toBe('Excel upload')
    expect(sourceLabel('nonsense')).toBe('System')
    expect(fieldLabel('complaint')).toBe('Complaint')
    expect(fieldLabel('unknown_col')).toBe('unknown_col')
  })
  it('every engine field and category has en + ar labels', () => {
    for (const f of Object.keys(HISTORY_FIELD_LABELS)) {
      expect(typeof en.fields[f], f).toBe('string')
      expect(typeof ar.fields[f], f).toBe('string')
    }
    for (const c of HISTORY_CATEGORIES) {
      expect(typeof en.categories[c]).toBe('string')
      expect(typeof ar.categories[c]).toBe('string')
    }
  })
})
