import { describe, it, expect } from 'vitest'
import { pctChange, groupErrors, severityCounts, buildActionQueue } from '../lib/api/consoleOverview'
import { NAV_GROUPS, CONSOLE_NAV, sectionsOf } from '../console/components/ConsoleLayout'

describe('console overview shapers', () => {
  it('pctChange refuses to invent a percentage from nothing', () => {
    expect(pctChange(150, 100)).toBe(50)
    expect(pctChange(50, 100)).toBe(-50)
    expect(pctChange(10, 0)).toBeNull()
    expect(pctChange(null, 5)).toBeNull()
    expect(pctChange(5, null)).toBeNull()
  })

  it('groupErrors folds repeats, worst severity first', () => {
    const rows = [
      { message: 'A', severity: 'error', created_at: '2026-09-01' },
      { message: 'A', severity: 'critical', created_at: '2026-09-02' },
      { message: 'B', severity: 'warning', created_at: '2026-09-03' },
      { message: 'B', severity: 'warning', created_at: '2026-09-04' },
      { message: 'B', severity: 'warning', created_at: '2026-09-05' },
    ]
    const g = groupErrors(rows)
    expect(g[0]).toMatchObject({ message: 'A', count: 2, severity: 'critical', latest: '2026-09-02' })
    expect(g[1]).toMatchObject({ message: 'B', count: 3 })
    expect(groupErrors(null)).toEqual([])
  })

  it('severityCounts folds unknown severities into info', () => {
    expect(severityCounts([{ severity: 'critical' }, { severity: 'weird' }, {}])).toEqual({ critical: 1, error: 0, warning: 0, info: 2 })
  })

  it('buildActionQueue ranks attention, security and mobile items by risk', () => {
    const q = buildActionQueue({
      attention: [{ key: 'pending', tone: 'warning', text: '3 users waiting', to: '/console/users' }],
      posture: { checks: [
        { id: 'x', title: 'Anon definer', severity: 'critical', status: 'fail' },
        { id: 'y', title: 'Passing', severity: 'critical', status: 'pass' },
        { id: 'z', title: 'Ext in public', severity: 'low', status: 'warn' },
      ] },
      mobile: { configOk: true, minVersion: '', latestVersion: '1.6.0' },
    })
    expect(q.map((i) => i.level)).toEqual(['critical', 'high', 'low', 'low'])
    expect(q[0].to).toBe('/console/security-audit')
    expect(q.some((i) => i.key === 'sec:y')).toBe(false)
    expect(q.some((i) => i.key === 'mobile:min')).toBe(true)
  })
})

describe('Control Center sidebar', () => {
  it('has the five areas with Access Control first in Trust', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Monitor', 'Platform', 'Trust', 'Runtime', 'Engineering'])
    const trust = NAV_GROUPS.find((g) => g.label === 'Trust')
    expect(trust.items[0]).toMatchObject({ to: '/console/access', label: 'Access Control' })
  })

  it('lists every console route exactly once', () => {
    const routes = CONSOLE_NAV.flatMap((g) => g.items.map((i) => i.to))
    expect(routes.length).toBe(54)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('sectionsOf groups consecutive items by section', () => {
    const s = sectionsOf([{ label: 'a', section: 'X' }, { label: 'b', section: 'X' }, { label: 'c' }])
    expect(s.map((x) => [x.name, x.items.length])).toEqual([['X', 2], ['c', 1]])
  })
})
