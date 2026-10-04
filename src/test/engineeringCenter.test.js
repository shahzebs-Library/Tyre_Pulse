import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  EDGE_FUNCTIONS, jobState, compareVersions, adoptionSummary, gateForced, errorVerdict,
  buildReleaseTimeline, filterTimeline, groupByDay, platformCounts, migrationDate, fmtInt,
} from '../lib/engineeringCenter'
import { validateCronPolicy } from '../lib/api/engineeringCenter'

describe('engineering center helpers', () => {
  it('lists every deployed edge function folder exactly once', () => {
    const dir = join(process.cwd(), 'supabase/functions')
    const folders = readdirSync(dir).filter((n) => !n.startsWith('_') && statSync(join(dir, n)).isDirectory()).sort()
    expect(EDGE_FUNCTIONS.map((f) => f.name).sort()).toEqual(folders)
  })

  it('fmtInt never fakes a zero', () => {
    expect(fmtInt(null)).toBe('N/A')
    expect(fmtInt(1234)).toBe('1,234')
  })

  it('job state follows the alert policy', () => {
    expect(jobState({ active: false }).key).toBe('paused')
    expect(jobState({ active: true, stuck: true }).key).toBe('stuck')
    expect(jobState({ active: true, fail_streak: 2 }, { fail_streak: 2 }).key).toBe('failing')
    expect(jobState({ active: true, fail_streak: 1 }, { fail_streak: 2 }).key).toBe('blip')
    expect(jobState({ active: true, overdue: true }).key).toBe('missed')
    expect(jobState({ active: true, last_start: '2026-09-30T00:00:00Z', schedule: '*/5 * * * *' }).key).toBe('ok')
  })

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.6.0', '1.6.0')).toBe(0)
  })

  it('adoption is judged on active phones as well as installs', () => {
    const rows = [
      { app_version: '1.6.0', installs: 122, active_7d: 77 },
      { app_version: '1.3.2', installs: 7, active_7d: 0 },
      { app_version: '1.5.0', installs: 1, active_7d: 0 },
    ]
    const s = adoptionSummary(rows, '1.3.1', '1.6.0')
    expect(s.installs).toBe(130)
    expect(s.pctActive).toBe(100)
    expect(s.pctInstalls).toBe(94)
    expect(s.belowInstalls).toBe(0)
    expect(gateForced(rows, '1.6.0')).toEqual({ forced: 8, forcedActive: 0, notAffected: 122 })
    expect(gateForced(rows, 'junk').forced).toBeNull()
    expect(adoptionSummary(rows, null, null).pctActive).toBeNull()
  })

  it('error verdict needs complete equal windows and a real difference', () => {
    expect(errorVerdict(null)).toBe('N/A')
    expect(errorVerdict({ before: 6, after: 14, complete: false })).toBe('Too early')
    expect(errorVerdict({ before: 6, after: 14, complete: true })).toBe('Higher')
    expect(errorVerdict({ before: 14, after: 4, complete: true })).toBe('Lower')
    expect(errorVerdict({ before: 6, after: 7, complete: true })).toBe('Similar')
  })

  it('builds, filters and groups the release timeline', () => {
    const now = Date.parse('2026-09-30T12:00:00Z')
    const events = buildReleaseTimeline({
      notes: [{ id: '2026.09.29.1', date: '2026-09-29', changes: [{ modules: ['x'], text: { en: 'Something changed for the better today.' } }] }],
      migrations: [
        { version: '20260930090000', name: 'first_change' },
        { version: '20260930100000', name: 'second_change' },
      ],
      recorded: [{ id: 'r1', version: '3bcfd28', kind: 'rollback', platform: 'web', to_version: '3bcfd28', from_version: '8b61b85', reason: 'bad build', released_at: '2026-09-30T11:00:00Z' }],
      liveBuild: 'abcdef1234',
    })
    const db = events.find((e) => e.platform === 'database')
    expect(db.version).toBe('2 migrations')
    const web = events.find((e) => e.id.startsWith('note-'))
    expect(web.timeKnown).toBe(false)
    expect(web.version).toBe('abcdef1')
    expect(events.find((e) => e.status === 'Rollback')).toBeTruthy()
    expect(platformCounts(events).all).toBe(events.length)
    expect(filterTimeline(events, { platform: 'database', days: 7, now })).toHaveLength(1)
    expect(filterTimeline(events, { search: 'second', days: 7, now })).toHaveLength(1)
    expect(groupByDay(events).length).toBeGreaterThanOrEqual(2)
    expect(migrationDate('20260930090000')).toBeInstanceOf(Date)
  })

  it('validates the job alert policy', () => {
    expect(validateCronPolicy({ grace_min: 5, fail_streak: 2, stuck_min: 5, recover_ok: 2 })).toBeNull()
    expect(validateCronPolicy({ grace_min: 0, fail_streak: 2, stuck_min: 5, recover_ok: 2 })).toMatch(/Grace/)
  })
})

describe('release timeline: Flutter app is the live mobile gate', () => {
  it('adds a Flutter gate event and marks the Expo gate as retired history', async () => {
    const { buildReleaseTimeline: build, PLATFORMS: P } = await import('../lib/engineeringCenter')
    const events = build({
      flutter: { min: '0.1.0', latest: '0.1.1', updatedAt: '2026-10-04T08:00:00Z' },
      android: { min: '1.6.0', latest: '1.6.0', updatedAt: '2026-08-31T05:56:38Z' },
    })
    const f = events.find((e) => e.id === 'flutter-gate')
    expect(f.platform).toBe('flutter')
    expect(f.version).toBe('0.1.1')
    expect(events.find((e) => e.id === 'android-gate').status).toBe('Retired')
    expect(P.find((p) => p.key === 'android').label).toMatch(/Retired/)
  })
})
