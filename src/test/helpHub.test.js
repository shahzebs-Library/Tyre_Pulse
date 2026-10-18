import { describe, it, expect } from 'vitest'
import { scopedHelp, availableHelpGuides, recentHelpRequests } from '../lib/helpHub'

describe('personal help workspace', () => {
  it('does not expose guides for inaccessible modules or unknown custom roles', () => {
    const faqs = scopedHelp(['/inspections'])
    expect(faqs.some(row => row.id === 'in-record')).toBe(true)
    expect(faqs.some(row => row.id === 'da-import')).toBe(false)
    expect(faqs.some(row => row.id === 'ac-report')).toBe(false)
    expect(availableHelpGuides(['/inspections']).map(row => row.id)).toEqual(['inspections', 'account'])
    expect(availableHelpGuides([]).map(row => row.id)).toEqual(['account'])
  })
  it('keeps support tickets and console problem reports distinct and orders actual updates', () => {
    const rows = recentHelpRequests([{ id: 'same', subject: 'Question', status: 'open', created_at: '2026-10-17' }], [{ id: 'same', description: 'Sync problem', status: 'new', created_at: '2026-10-18' }])
    expect(rows.map(row => row.id)).toEqual(['problem:same', 'ticket:same'])
    expect(rows[0].source).toBe('problem')
  })
})
