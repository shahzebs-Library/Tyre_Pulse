import { describe, it, expect } from 'vitest'
import {
  STALE_DAYS, detectStaleGroups, summarizeFindings, severityForFinding,
} from './selfHealing'

const DAY = 24 * 60 * 60 * 1000

describe('selfHealing pure - detectStaleGroups', () => {
  const now = Date.parse('2026-07-16T00:00:00Z')

  it('flags only groups silent for STALE_DAYS or more', () => {
    const rows = [
      { site: 'FRESH', created_at: new Date(now - 2 * DAY).toISOString() },        // 2d -> ok
      { site: 'EDGE', created_at: new Date(now - STALE_DAYS * DAY).toISOString() }, // exactly 7d -> stale
      { site: 'OLD', created_at: new Date(now - 30 * DAY).toISOString() },          // 30d -> stale
    ]
    const out = detectStaleGroups(rows, { now })
    const groups = out.map(o => o.group)
    expect(groups).toContain('EDGE')
    expect(groups).toContain('OLD')
    expect(groups).not.toContain('FRESH')
    // most stale first
    expect(out[0].group).toBe('OLD')
    expect(out[0].daysStale).toBe(30)
  })

  it('just-under-threshold groups are not stale', () => {
    const rows = [{ site: 'ALMOST', created_at: new Date(now - (STALE_DAYS - 1) * DAY).toISOString() }]
    expect(detectStaleGroups(rows, { now })).toEqual([])
  })

  it('keeps the most recent timestamp when a group repeats', () => {
    const rows = [
      { site: 'DUP', created_at: new Date(now - 40 * DAY).toISOString() },
      { site: 'DUP', created_at: new Date(now - 1 * DAY).toISOString() }, // recent -> not stale
    ]
    expect(detectStaleGroups(rows, { now })).toEqual([])
  })

  it('ignores rows with no group or an unparseable date, and never throws', () => {
    const rows = [
      { site: '', created_at: new Date(now - 30 * DAY).toISOString() },
      { site: 'X', created_at: 'not-a-date' },
      { site: 'Y' },
      null,
      'garbage',
    ]
    expect(detectStaleGroups(rows, { now })).toEqual([])
    expect(detectStaleGroups(undefined, { now })).toEqual([])
    expect(detectStaleGroups(null)).toEqual([])
  })

  it('honours custom key/dateField', () => {
    const rows = [{ region: 'R1', last_at: new Date(now - 20 * DAY).toISOString() }]
    const out = detectStaleGroups(rows, { now, key: 'region', dateField: 'last_at' })
    expect(out).toHaveLength(1)
    expect(out[0].group).toBe('R1')
  })
})

describe('selfHealing pure - severityForFinding', () => {
  it('maps each known category to its band', () => {
    expect(severityForFinding('orphans')).toBe('warning')
    expect(severityForFinding('duplicates')).toBe('warning')
    expect(severityForFinding('stale')).toBe('warning')
    expect(severityForFinding('serialConflicts')).toBe('info')
    expect(severityForFinding('anomalies')).toBe('info')
  })

  it('defaults unknown keys to info', () => {
    expect(severityForFinding('mystery')).toBe('info')
    expect(severityForFinding()).toBe('info')
  })
})

describe('selfHealing pure - summarizeFindings', () => {
  it('is honestly empty when nothing is found', () => {
    const s = summarizeFindings({})
    expect(s.total).toBe(0)
    expect(s.bySeverity).toEqual({ critical: 0, warning: 0, info: 0 })
    expect(s.items).toHaveLength(5)
    expect(s.items.every(i => i.count === 0)).toBe(true)
    expect(s.items.every(i => i.fixable === false)).toBe(true)
  })

  it('aggregates counts into the right severity buckets', () => {
    const s = summarizeFindings({
      orphans: [{ asset_no: 'A1' }, { asset_no: 'A2' }],   // warning x2
      duplicates: [{ serial_no: 'S1' }],                   // warning x1
      serialConflicts: [{ serial_no: 'S2' }],              // info x1
      stale: [{ group: 'SITE', lastSeen: 't', daysStale: 9 }], // warning x1
      anomalies: [{ id: 'x' }, { id: 'y' }, { id: 'z' }],  // info x3
    })
    expect(s.total).toBe(8)
    expect(s.bySeverity.warning).toBe(4) // 2 + 1 + 1
    expect(s.bySeverity.info).toBe(4)    // 1 + 3
    expect(s.bySeverity.critical).toBe(0)
  })

  it('marks orphans and duplicates fixable only when present; conflicts/stale/anomalies never', () => {
    const s = summarizeFindings({
      orphans: [{ asset_no: 'A1' }],
      duplicates: [{ serial_no: 'S1' }],
      serialConflicts: [{ serial_no: 'S2' }],
      stale: [{ group: 'SITE', lastSeen: 't', daysStale: 9 }],
      anomalies: [{ id: 'x' }],
    })
    const byKey = Object.fromEntries(s.items.map(i => [i.key, i]))
    expect(byKey.orphans.fixable).toBe(true)
    expect(byKey.duplicates.fixable).toBe(true)
    expect(byKey.serialConflicts.fixable).toBe(false)
    expect(byKey.stale.fixable).toBe(false)
    expect(byKey.anomalies.fixable).toBe(false)
  })

  it('empty fixable buckets are not marked fixable', () => {
    const s = summarizeFindings({ orphans: [], duplicates: [] })
    const byKey = Object.fromEntries(s.items.map(i => [i.key, i]))
    expect(byKey.orphans.fixable).toBe(false)
    expect(byKey.duplicates.fixable).toBe(false)
  })
})
