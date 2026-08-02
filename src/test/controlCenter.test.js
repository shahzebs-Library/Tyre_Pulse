import { describe, it, expect } from 'vitest'
import { rankIssues, openIssueCount, ISSUE_SEVERITY_TONE, DOMAIN_LABELS, LINEAGE_DOMAINS } from '../lib/api/controlCenter'

describe('controlCenter pure helpers', () => {
  const issues = [
    { key: 'a', severity: 'info', count: 100 },
    { key: 'b', severity: 'critical', count: 2 },
    { key: 'c', severity: 'warning', count: 50 },
    { key: 'd', severity: 'critical', count: 9 },
    { key: 'e', severity: 'info', count: 0 },
  ]

  it('rankIssues orders critical > warning > info, then by count desc', () => {
    const r = rankIssues(issues).map((i) => i.key)
    expect(r).toEqual(['d', 'b', 'c', 'a', 'e'])
  })

  it('rankIssues is pure (does not mutate input)', () => {
    const copy = JSON.parse(JSON.stringify(issues))
    rankIssues(issues)
    expect(issues).toEqual(copy)
  })

  it('openIssueCount counts only non-zero issues', () => {
    expect(openIssueCount(issues)).toBe(4)
    expect(openIssueCount([])).toBe(0)
    expect(openIssueCount(undefined)).toBe(0)
  })

  it('every lineage domain has a label', () => {
    for (const d of LINEAGE_DOMAINS) expect(DOMAIN_LABELS[d]).toBeTruthy()
  })

  it('severity tones map to console kit vocabulary', () => {
    expect(ISSUE_SEVERITY_TONE.critical).toBe('danger')
    expect(ISSUE_SEVERITY_TONE.warning).toBe('warning')
    expect(ISSUE_SEVERITY_TONE.info).toBe('info')
  })
})
