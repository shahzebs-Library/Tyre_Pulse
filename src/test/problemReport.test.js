import { describe, it, expect } from 'vitest'
import {
  normalizeErrorMessage, errorFingerprint, validateIssueInput, describeClient,
  webAppVersion, slaState, filterIssues, isOpenStatus, ISSUE_CATEGORIES, ISSUE_STATUSES,
} from '../lib/problemReport'
import { issueError } from '../lib/api/userIssues'

describe('normalizeErrorMessage / errorFingerprint', () => {
  it('strips numbers, uuids and quoted values so the same error groups together', () => {
    const a = 'Cannot read property "foo" of row 12 (id 3f2f008d-986f-48f5-805f-f1070307679d)'
    const b = "Cannot read property 'bar' of row 997 (id 00000000-0000-0000-0000-000000000001)"
    expect(normalizeErrorMessage(a)).toBe(normalizeErrorMessage(b))
    expect(normalizeErrorMessage(a)).toBe('cannot read property <q> of row <n> (id <id>)')
  })
  it('collapses whitespace and lower-cases', () => {
    expect(normalizeErrorMessage('  Save   FAILED\n\tnow ')).toBe('save failed now')
  })
  it('prefixes the source and returns null for an empty message', () => {
    expect(errorFingerprint('ErrorBoundary', 'Boom 42')).toBe('errorboundary|boom <n>')
    expect(errorFingerprint(null, 'Boom')).toBe('app|boom')
    expect(errorFingerprint('x', '   ')).toBeNull()
    expect(errorFingerprint('x', null)).toBeNull()
  })
  it('keeps different sources apart', () => {
    expect(errorFingerprint('page', 'x')).not.toBe(errorFingerprint('app-root', 'x'))
  })
})

describe('validateIssueInput', () => {
  it('requires a few words and a known type', () => {
    const r = validateIssueInput({ description: ' hi ', category: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.errors.description).toMatch(/few words/)
    expect(r.errors.category).toMatch(/kind of problem/)
  })
  it('trims, defaults severity to medium and rejects unknown severity', () => {
    const r = validateIssueInput({ description: '  Save does nothing  ', category: 'bug', severity: 'extreme' })
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({ description: 'Save does nothing', category: 'bug', severity: 'medium' })
  })
  it('refuses text over 2000 characters', () => {
    expect(validateIssueInput({ description: 'a'.repeat(2001), category: 'bug' }).ok).toBe(false)
  })
  it('vocabulary mirrors the database CHECK constraints', () => {
    expect(ISSUE_CATEGORIES.map((c) => c.key)).toEqual(['bug', 'data_wrong', 'slow', 'access', 'other'])
    expect(ISSUE_STATUSES.map((c) => c.key)).toEqual(['new', 'triaged', 'in_progress', 'waiting_user', 'fixed', 'closed', 'wont_fix'])
  })
})

describe('describeClient / webAppVersion', () => {
  it('reads browser and system from a user agent', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
    expect(describeClient(ua)).toEqual({ browser: 'Chrome', os: 'Windows', device: 'Chrome' })
    expect(describeClient('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36').device).toBe('Chrome (mobile)')
    expect(describeClient(undefined)).toEqual({ browser: null, os: null, device: null })
  })
  it('never invents a version', () => {
    expect(webAppVersion({})).toBeNull()
    expect(webAppVersion({ VITE_APP_VERSION: ' 2.1.0 ' })).toBe('2.1.0')
  })
})

describe('slaState / filterIssues', () => {
  const now = Date.parse('2026-09-30T12:00:00Z')
  it('reports due, breached, met and none', () => {
    expect(slaState({ status: 'new', sla_due_at: '2026-09-30T13:00:00Z' }, now)).toBe('due')
    expect(slaState({ status: 'new', sla_due_at: '2026-09-30T11:00:00Z' }, now)).toBe('breached')
    expect(slaState({ status: 'fixed', sla_due_at: '2026-09-30T11:00:00Z', resolved_at: '2026-09-30T10:00:00Z' }, now)).toBe('met')
    expect(slaState({ status: 'new' }, now)).toBe('none')
  })
  it('filters by open, type and search text', () => {
    const rows = [
      { id: 1, status: 'new', category: 'bug', description: 'Save broken', platform: 'web' },
      { id: 2, status: 'fixed', category: 'slow', description: 'Slow report', platform: 'flutter' },
    ]
    expect(filterIssues(rows, { status: 'open' }).map((r) => r.id)).toEqual([1])
    expect(filterIssues(rows, { status: 'all', category: 'slow' }).map((r) => r.id)).toEqual([2])
    expect(filterIssues(rows, { status: 'all', search: 'save' }).map((r) => r.id)).toEqual([1])
    expect(isOpenStatus('waiting_user')).toBe(true)
    expect(isOpenStatus('wont_fix')).toBe(false)
  })
})

describe('issueError', () => {
  it('shows server messages written for people, hides database text', () => {
    expect(issueError({ code: '22023', message: 'Say which app version has the fix' }).message)
      .toBe('Say which app version has the fix')
    expect(issueError({ code: '42P01', message: 'relation "user_issues" does not exist' }, 'Could not load.').message)
      .toBe('Could not load.')
  })
})
