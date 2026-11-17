import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  OPEN_STATUSES, CLOSED_STATUSES, STATUS_LABELS, effectiveStatus, isOpenLog, statusLabel, validReason,
} from '../lib/errorStatus'

describe('error status (Error Center triage is the single source)', () => {
  it('maps every Error Center status to open or closed exactly once', () => {
    const all = [...OPEN_STATUSES, ...CLOSED_STATUSES]
    expect(new Set(all).size).toBe(all.length)
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...all].sort())
  })

  it('no group status means open, whatever the immutable log flag says', () => {
    expect(effectiveStatus({})).toBe('for_review')
    expect(isOpenLog({ resolved: true, resolved_at: '2026-11-01' })).toBe(true)
    expect(statusLabel({ resolved: true })).toBe('Open')
  })

  it.each([
    ['for_review', 'Open', true],
    ['reviewed', 'Reviewed', true],
    ['fixed_in_code', 'Fixed in code', false],
    ['resolved', 'Resolved', false],
    ['ignored', 'Ignored', false],
    ['routine', 'Routine', false],
  ])('%s -> %s (open=%s)', (st, label, open) => {
    const row = { group_status: st }
    expect(statusLabel(row)).toBe(label)
    expect(isOpenLog(row)).toBe(open)
  })

  it('an unknown status is treated as open, never silently closed', () => {
    expect(isOpenLog({ group_status: 'something_new' })).toBe(true)
  })

  it('reason must be at least 3 non-space characters', () => {
    expect(validReason('')).toBe(false)
    expect(validReason('  ok ')).toBe(false)
    expect(validReason('fix')).toBe(true)
  })

  it('SQL and JS agree on which statuses are open', () => {
    const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261117120000_error_center_status_history.sql'), 'utf8')
    const opens = [...sql.matchAll(/in \('for_review', 'reviewed'\)/g)]
    expect(opens.length).toBeGreaterThanOrEqual(4)
    expect([...OPEN_STATUSES]).toEqual(['for_review', 'reviewed'])
  })

  it('the System Health export uses the same label as the screen', () => {
    const page = readFileSync(resolve(__dirname, '../console/pages/ConsoleSystemHealth.jsx'), 'utf8')
    expect(page).toMatch(/key: 'status', header: 'Status', value: r => statusLabel\(r\)/)
    expect(page).toMatch(/<Badge tone=\{isResolved \? 'good' : 'default'\}>\{statusLabel\(row\)\}<\/Badge>/)
    // the page must not read the immutable log flag for status anywhere
    expect(page).not.toMatch(/r\.resolved === true|row\.resolved === true|drawerRow\.resolved === true/)
  })
})
