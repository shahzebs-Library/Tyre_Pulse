import { describe, it, expect } from 'vitest'
import {
  auditSeverity, highSeverityOrFilter, BUSINESS_TABLES, SECURITY_TABLES, FAILURE_ACTIONS,
} from '../lib/auditSeverity'

describe('auditSeverity (rule based)', () => {
  it('rates a business delete by a person High', () => {
    for (const t of ['tyre_records', 'work_orders', 'accidents', 'parts_consumption', 'vehicle_fleet', 'inspections']) {
      expect(auditSeverity({ action: 'db.delete', table_name: t, user_id: 'u1' }).key).toBe('high')
    }
    expect(auditSeverity({ action: 'DELETE', table_name: 'tyre_records', user_id: 'u1' }).key).toBe('high')
  })
  it('rates the same delete by an import or job Medium, and the server filter agrees', () => {
    expect(auditSeverity({ action: 'db.delete', table_name: 'work_orders', user_id: null }).key).toBe('medium')
    expect(highSeverityOrFilter()).toContain('user_id.not.is.null')
  })
  it('rates access deletes and failed security events High', () => {
    expect(auditSeverity({ action: 'db.delete', table_name: 'api_keys' }).key).toBe('high')
    expect(auditSeverity({ action: 'LOGIN_FAILED' }).key).toBe('high')
    expect(auditSeverity({ action: 'ACCESS_DENIED' }).reason).toMatch(/security/)
  })
  it('rates scrap, branding, role and access changes Medium', () => {
    expect(auditSeverity({ action: 'tyre_scrap', table_name: 'tyre_status_marks' }).key).toBe('medium')
    expect(auditSeverity({ action: 'tyre_unscrap' }).key).toBe('medium')
    expect(auditSeverity({ action: 'org_branding_update', table_name: 'organisations' }).key).toBe('medium')
    expect(auditSeverity({ action: 'db.update', table_name: 'user_access_grants' }).key).toBe('medium')
    expect(auditSeverity({ action: 'db.update', table_name: 'profiles', old_values: { role: 'Reporter' }, new_values: { role: 'Admin' } }).key).toBe('medium')
    expect(auditSeverity({ action: 'db.delete', table_name: 'knowledge_documents' }).key).toBe('medium')
  })
  it('rates routine events Info', () => {
    for (const a of ['db.insert', 'db.update', 'CREATE', 'UPDATE', 'LOGIN', 'LOGOUT', 'EXPORT', 'UPLOAD']) {
      expect(auditSeverity({ action: a, table_name: 'tyre_records' }).key).toBe('info')
    }
    expect(auditSeverity({ action: 'db.update', table_name: 'profiles', new_values: { full_name: 'A' } }).key).toBe('info')
    expect(auditSeverity({}).key).toBe('info')
    expect(auditSeverity(null).label).toBe('Info')
  })
  it('the server filter names exactly the High rule inputs', () => {
    const f = highSeverityOrFilter()
    expect(f).toContain('action.in.("db.delete","DELETE")')
    for (const t of [...BUSINESS_TABLES, ...SECURITY_TABLES]) expect(f).toContain(`"${t}"`)
    for (const a of FAILURE_ACTIONS) expect(f).toContain(`"${a}"`)
    expect(f.match(/and\(action/g)).toHaveLength(2)
    expect(f.endsWith(')')).toBe(true)
  })
})
