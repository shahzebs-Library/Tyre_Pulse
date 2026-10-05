import { describe, it, expect } from 'vitest'
import {
  actionLabel, moduleLabel, recordRef, eventType, actorLabel, changeHeadline, defaultRange,
  previousRange, trendPct, tabScope, actionsForGroup, canReadAudit, rangeLabel,
  siteLabel, exportInfo, emptyMessage, AUDIT_TABS,
} from '../lib/auditTrailView'

describe('auditTrailView', () => {
  it('labels the real stored action tokens', () => {
    expect(actionLabel('db.update')).toBe('Update')
    expect(actionLabel('LOGIN')).toBe('Sign in')
    expect(actionLabel('tyre_scrap')).toBe('Scrap tyre')
    expect(actionLabel('some_new_action')).toBe('Some new action')
    expect(actionLabel(null)).toBe('N/A')
  })
  it('names the module and shortens uuids', () => {
    expect(moduleLabel({ table_name: 'tyre_records' })).toBe('Tyre records')
    expect(moduleLabel({ action: 'LOGIN' })).toBe('Sign-in')
    expect(recordRef({ record_id: '1234abcd-0000-4000-8000-000000000000' })).toBe('1234abcd')
    expect(recordRef({ record_id: 'WO-2026-00003' })).toBe('WO-2026-00003')
    expect(recordRef({})).toBe('N/A')
  })
  it('derives a type, never a severity', () => {
    expect(eventType({ action: 'LOGIN' }).key).toBe('security')
    expect(eventType({ action: 'db.delete' }).key).toBe('removal')
    expect(eventType({ action: 'db.update', actor_type: 'service' }).key).toBe('automation')
    expect(eventType({ action: 'db.insert', actor_type: 'user' }).key).toBe('data')
    expect(eventType({ action: 'stock_movement' }).key).toBe('operation')
  })
  it('names the actor honestly', () => {
    expect(actorLabel({ profiles: { full_name: 'Sara' } })).toBe('Sara')
    expect(actorLabel({ actor_type: 'service', actor_detail: 'postgres' })).toBe('System (postgres)')
    expect(actorLabel({})).toBe('Not recorded')
  })
  it('builds the headline from stored old/new values', () => {
    const row = { action: 'db.update', table_name: 'tyre_records', record_id: 'TY-1', old_values: { psi: 95, site: 'A' }, new_values: { psi: 110, site: 'A' } }
    expect(changeHeadline(row)).toBe('Update on Tyre records TY-1: psi 95 to 110')
    expect(changeHeadline({ action: 'LOGIN' })).toBe('Sign in on Sign-in')
  })
  it('computes the previous equal window and trends', () => {
    expect(previousRange('2026-09-01', '2026-09-30')).toEqual({ from: '2026-08-02', to: '2026-08-31' })
    expect(previousRange('', '2026-09-30')).toBeNull()
    expect(previousRange('2026-09-30', '2026-09-01')).toBeNull()
    expect(trendPct(150, 100)).toBe(50)
    expect(trendPct(5, 0)).toBeNull()
    expect(trendPct(null, 4)).toBeNull()
    const r = defaultRange(new Date('2026-10-05T12:00:00Z'))
    expect(r).toEqual({ from: '2026-09-06', to: '2026-10-05' })
    expect(rangeLabel('', '')).toBe('All dates')
  })
  it('scopes tabs and action groups to real tokens', () => {
    expect(tabScope('security').actions).toContain('LOGIN')
    expect(tabScope('automation')).toEqual({ actorType: 'service' })
    expect(tabScope('audit')).toEqual({})
    expect(actionsForGroup('delete')).toEqual(['db.delete', 'DELETE'])
    expect(actionsForGroup('nope')).toBeNull()
  })
  it('mirrors the audit_log_v2 read roles', () => {
    expect(canReadAudit({ role: 'Manager' })).toBe(true)
    expect(canReadAudit({ role: 'Reporter' })).toBe(false)
    expect(canReadAudit({ role: 'Reporter' }, true)).toBe(true)
  })
  it('has the five mockup tabs and scopes Exports to EXPORT rows', () => {
    expect(AUDIT_TABS.map((t) => t.key)).toEqual(['audit', 'upload', 'security', 'exports', 'automation'])
    expect(tabScope('exports')).toEqual({ actions: ['EXPORT'] })
    expect(emptyMessage('exports')).toMatch(/5 Oct 2026/)
  })
  it('reads export file, rows and format honestly', () => {
    expect(exportInfo({ action: 'EXPORT', table_name: 'TyrePulse Audit Log 2026-10-05.xlsx', new_values: { rows: 120 } }))
      .toEqual({ file: 'TyrePulse Audit Log 2026-10-05.xlsx', rows: 120, format: 'XLSX' })
    expect(exportInfo({ action: 'EXPORT', table_name: 'report', new_values: {} })).toEqual({ file: 'report', rows: null, format: null })
    expect(moduleLabel({ action: 'EXPORT', table_name: 'x.pdf' })).toBe('Export')
  })
  it('shows site or N/A', () => {
    expect(siteLabel({ site: 'NHC' })).toBe('NHC')
    expect(siteLabel({ site: '  ' })).toBe('N/A')
    expect(siteLabel({})).toBe('N/A')
  })
})
