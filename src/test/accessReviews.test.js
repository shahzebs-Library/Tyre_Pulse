import { describe, it, expect } from 'vitest'
import {
  daysSince, dormancy, isDormant, grantCount, reviewProgress, filterItems, rolesIn,
  bulkKeepCandidates, evidenceRows, EVIDENCE_COLUMNS, isOverdue,
} from '../lib/accessReviews'

const NOW = new Date('2026-09-24T12:00:00Z')
const items = [
  { id: 'a', full_name: 'Anum', user_email: 'a@x.com', role: 'Admin', is_super_admin: true, country: ['KSA'], sites: ['ALL'], grants: [], last_sign_in_at: '2026-09-20T00:00:00Z', decision: 'keep', decided_by_email: 'rev@x.com', decided_at: '2026-09-24T10:00:00Z' },
  { id: 'b', full_name: 'Bilal', user_email: 'b@x.com', role: 'Manager', is_super_admin: false, country: ['UAE'], sites: ['NHC'], grants: [{ module_key: 'stock', capability: 'view', effect: 'grant' }], last_sign_in_at: '2026-05-01T00:00:00Z', decision: 'revoke', decision_note: 'Left' },
  { id: 'c', full_name: 'Chen', user_email: 'c@x.com', role: 'Tyre Man', is_super_admin: false, country: null, sites: null, grants: null, last_sign_in_at: null, decision: 'pending' },
  { id: 'd', full_name: 'Dana', user_email: 'd@x.com', role: 'Manager', decision: 'modify', last_sign_in_at: '2026-06-26T12:00:00Z' },
]

describe('dormancy', () => {
  it('counts whole days and handles junk', () => {
    expect(daysSince('2026-09-23T12:00:00Z', NOW)).toBe(1)
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince('not a date', NOW)).toBeNull()
  })
  it('flags 90+ days and never signed in', () => {
    expect(isDormant(items[0], NOW)).toBe(false)
    expect(dormancy(items[1], NOW)).toMatchObject({ dormant: true, never: false })
    expect(dormancy(items[2], NOW)).toEqual({ dormant: true, never: true, days: null })
    expect(dormancy(items[3], NOW).days).toBe(90)
    expect(isDormant(items[3], NOW)).toBe(true)
  })
})

describe('reviewProgress', () => {
  it('summarises decisions', () => {
    const p = reviewProgress(items, NOW)
    expect(p).toMatchObject({ total: 4, pending: 1, keep: 1, revoke: 1, modify: 1, decided: 3, pct: 75, dormant: 3, superAdmins: 1 })
  })
  it('returns null pct for an empty campaign', () => {
    expect(reviewProgress([], NOW).pct).toBeNull()
  })
  it('treats an unknown decision as pending', () => {
    expect(reviewProgress([{ decision: 'weird' }], NOW).pending).toBe(1)
  })
})

describe('filterItems', () => {
  it('filters by decision, role, flag and search', () => {
    expect(filterItems(items, { decision: 'revoke' }, NOW).map((i) => i.id)).toEqual(['b'])
    expect(filterItems(items, { role: 'Manager' }, NOW).map((i) => i.id)).toEqual(['b', 'd'])
    expect(filterItems(items, { flag: 'dormant' }, NOW).map((i) => i.id)).toEqual(['b', 'c', 'd'])
    expect(filterItems(items, { flag: 'super' }, NOW).map((i) => i.id)).toEqual(['a'])
    expect(filterItems(items, { flag: 'grants' }, NOW).map((i) => i.id)).toEqual(['b'])
    expect(filterItems(items, { search: 'nhc' }, NOW).map((i) => i.id)).toEqual(['b'])
    expect(filterItems(items, {}, NOW)).toHaveLength(4)
  })
  it('lists roles and bulk candidates', () => {
    expect(rolesIn(items)).toEqual(['Admin', 'Manager', 'Tyre Man'])
    expect(bulkKeepCandidates(items).map((i) => i.id)).toEqual(['c'])
    expect(grantCount(items[2])).toBe(0)
  })
})

describe('evidence', () => {
  it('produces one row per item with every column', () => {
    const rows = evidenceRows(items, NOW)
    expect(rows).toHaveLength(4)
    for (const [k] of EVIDENCE_COLUMNS) expect(rows[0]).toHaveProperty(k)
    expect(rows[0].reviewer).toBe('rev@x.com')
    expect(rows[1].grants).toBe('grant stock (view)')
    expect(rows[2].dormant).toBe('Yes (never signed in)')
    expect(rows[2].countries).toBe('None')
  })
  it('flags overdue open campaigns only', () => {
    expect(isOverdue({ status: 'open', due_at: '2026-09-01' }, NOW)).toBe(true)
    expect(isOverdue({ status: 'closed', due_at: '2026-09-01' }, NOW)).toBe(false)
    expect(isOverdue({ status: 'open', due_at: null }, NOW)).toBe(false)
  })
})
