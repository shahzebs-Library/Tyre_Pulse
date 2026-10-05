import { describe, it, expect } from 'vitest'
import {
  policyCode, statusTone, ownerInitials, policyGaps, policyKpis, reviewDistance,
  optionsOf, regionLabel, versionLog, policyDetailRows, categoryBreakdown,
} from '../lib/policyView'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const full = {
  id: 'a1b2c3d4-0000-0000-0000-000000000000', title: 'Tyre Inspection Policy', category: 'Safety',
  version: '3.2', owner: 'James Carter', country: 'KSA', status: 'active',
  effective_date: '2026-01-01', review_date: '2027-01-01', body: 'Rules', notes: '',
  created_at: '2026-01-01T08:00:00Z', updated_at: '2026-06-01T08:00:00Z',
}

describe('policyView', () => {
  it('derives a stable policy code from the id', () => {
    expect(policyCode(full)).toBe('POL-A1B2C3')
    expect(policyCode({})).toBe('N/A')
  })

  it('maps status tones and owner initials', () => {
    expect(statusTone('active')).toBe('good')
    expect(statusTone('under_review')).toBe('warn')
    expect(statusTone('nope')).toBe('muted')
    expect(ownerInitials('James Carter')).toBe('JC')
    expect(ownerInitials('Fleet')).toBe('FL')
    expect(ownerInitials('')).toBe('')
  })

  it('finds governance gaps only from real empty or past fields', () => {
    expect(policyGaps(full, NOW)).toEqual([])
    const bad = { ...full, owner: '', review_date: '2026-09-01', body: null }
    expect(policyGaps(bad, NOW)).toEqual(['No owner', 'Review overdue', 'No policy text'])
    expect(policyGaps({ ...bad, status: 'archived' }, NOW)).toEqual([])
    expect(policyGaps({ ...full, review_date: null, effective_date: null }, NOW)).toEqual(['No review date', 'No effective date'])
  })

  it('counts KPIs and never measures acknowledgment', () => {
    const rows = [
      full,
      { ...full, id: 'b', status: 'under_review', review_date: '2026-10-20' },
      { ...full, id: 'c', status: 'draft', owner: null },
    ]
    const k = policyKpis(rows, NOW)
    expect(k).toMatchObject({ total: 3, active: 1, pendingReview: 1, expiringSoon: 1, withGaps: 1 })
    expect(k.avgAcknowledgment).toBeNull()
    expect(policyKpis([], NOW).total).toBe(0)
  })

  it('describes review distance', () => {
    expect(reviewDistance('2026-10-15', NOW)).toBe('in 10 days')
    expect(reviewDistance('2027-01-05', NOW)).toBe('in 3 months')
    expect(reviewDistance('2026-10-01', NOW)).toBe('overdue by 4 days')
    expect(reviewDistance(null, NOW)).toBeNull()
  })

  it('lists options and regions', () => {
    expect(optionsOf([{ c: 'b' }, { c: 'a' }, { c: 'b' }, { c: '' }], 'c')).toEqual(['a', 'b'])
    expect(regionLabel(full)).toBe('KSA')
    expect(regionLabel({})).toBe('All countries')
  })

  it('builds an honest version log', () => {
    const log = versionLog(full)
    expect(log.complete).toBe(false)
    expect(log.entries.map((e) => e.key)).toEqual(['current', 'created'])
    expect(versionLog({ ...full, updated_at: full.created_at }).entries).toHaveLength(1)
    expect(versionLog(null).entries).toEqual([])
  })

  it('shapes detail rows and category breakdown', () => {
    const rows = policyDetailRows({ ...full, category: '' }, NOW)
    expect(rows.find((r) => r.field === 'Category').value).toBe('Not recorded')
    expect(rows.find((r) => r.field === 'Governance gaps').value).toBe('None')
    expect(categoryBreakdown([full, full, { category: null }])).toEqual([
      { label: 'Safety', count: 2 }, { label: 'Uncategorised', count: 1 },
    ])
  })
})
