import { describe, it, expect } from 'vitest'
import {
  delegationKpis, filterDelegations, delegationExportRows, scopeLabel, personName,
  EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/approvalDelegationsAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z').getTime()
const iso = (days) => new Date(NOW + days * 86400000).toISOString()
const rows = [
  { id: 1, delegator_id: 'u1', delegate_id: 'u2', active: true, entity_type: 'work_order', ends_at: iso(3), reason: 'leave' },
  { id: 2, delegator_id: 'u1', delegate_id: 'u3', active: true },
  { id: 3, delegator_id: 'u4', delegate_id: 'u2', active: true, starts_at: iso(5) },
  { id: 4, delegator_id: 'u4', delegate_id: 'u3', active: true, ends_at: iso(-2) },
]

describe('delegationKpis', () => {
  it('counts lifecycle, ending soon and open-ended', () => {
    const k = delegationKpis(rows, { now: NOW })
    expect(k.total).toBe(4)
    expect(k.activeCount).toBe(2)
    expect(k.upcomingCount).toBe(1)
    expect(k.expiredCount).toBe(1)
    expect(k.endingSoon).toBe(1)
    expect(k.openEnded).toBe(1)
  })
})

describe('filters and export', () => {
  const people = new Map([['u2', { full_name: 'Sara' }]])
  const nameOf = (id) => personName(id, people)
  it('resolves names honestly', () => {
    expect(personName(null, people)).toBe('N/A')
    expect(personName('u2', people)).toBe('Sara')
    expect(personName('zz', people)).toBe('zz')
  })
  it('filters by status, scope and search', () => {
    expect(filterDelegations(rows, { status: 'active' }, NOW, nameOf)).toHaveLength(2)
    expect(filterDelegations(rows, { scope: 'work_order' }, NOW, nameOf)).toHaveLength(1)
    expect(filterDelegations(rows, { search: 'sara' }, NOW, nameOf)).toHaveLength(2)
    expect(filterDelegations(rows, { search: 'work order' }, NOW, nameOf)).toHaveLength(1)
  })
  it('labels scope', () => {
    expect(scopeLabel('')).toBe('All approval types')
    expect(scopeLabel('invoice')).toBe('Invoice')
    expect(scopeLabel('custom')).toBe('custom')
  })
  it('export rows align with headers', () => {
    const out = delegationExportRows(rows, NOW, nameOf, () => 'D')
    expect(Object.keys(out[0])).toEqual(EXPORT_COLS)
    expect(EXPORT_HEADERS).toHaveLength(EXPORT_COLS.length)
    expect(out[1].ends_at).toBe('Open-ended')
    expect(out[1].starts_at).toBe('Immediately')
    expect(out[0].delegate).toBe('Sara')
    expect(out[3].status).toBe('Expired')
  })
})
