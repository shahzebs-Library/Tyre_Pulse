import { describe, it, expect } from 'vitest'
import { remediationStats, openSince, hardeningTasks, taskCounts } from '../lib/securityHardening'
import { parseQuery, toQueryString, filterByQuery, reasonCoverageText } from '../lib/auditQuery'
import {
  suggestDecision, shapeUnusedSummary, unusedFindings, unusedKpis, inScope, toReviewDecision,
  decisionCounts, defaultGrantEndDate, roleBreakdownText,
} from '../lib/accessUnused'
import { resendMessage } from '../lib/api/webhookAdmin'

const NOW = new Date('2026-09-30T10:00:00Z')
const runs = [
  { ran_at: '2026-09-24T22:40:00Z', failing: ['extensions_public'] },
  { ran_at: '2026-09-27T05:00:00Z', failing: ['anon_definer_functions', 'extensions_public'] },
]
const posture = {
  checks: [
    { id: 'anon_definer_functions', status: 'fail', severity: 'high' },
    { id: 'extensions_public', status: 'warn', severity: 'low' },
    { id: 'super_admin_mfa', status: 'pass', severity: 'critical' },
    { id: 'super_admin_count', status: 'pass', severity: 'high', count: 2 },
    { id: 'leaked_password', status: 'manual', severity: 'medium' },
  ],
}

describe('security remediation', () => {
  it('ages open findings from the scan history', () => {
    const s = remediationStats(posture, runs, NOW)
    expect(s.open).toBe(2)
    expect(s.oldestDays).toBe(5)
    expect(s.oldestId).toBe('extensions_public')
    expect(s.avgFixDays).toBeNull()
    expect(s.fixed30).toBe(0)
    expect(s.owners).toBeNull()
  })
  it('open since is the start of the unbroken failing streak', () => {
    expect(openSince('anon_definer_functions', runs)).toBe(new Date('2026-09-27T05:00:00Z').getTime())
    expect(openSince('rls_disabled', runs)).toBeNull()
  })
  it('counts a finding that passes now as fixed', () => {
    const p = { checks: [{ id: 'extensions_public', status: 'pass' }] }
    const s = remediationStats(p, runs, NOW)
    expect(s.fixed30).toBe(2)
    expect(s.avgFixDays).not.toBeNull()
  })
  it('ranks hardening tasks, never guessing unknown switches', () => {
    const t = hardeningTasks({ posture, ipAllowlist: false, dualControl: null, reviewsEver: 0, people: 727 })
    expect(t).toHaveLength(8)
    expect(t[0].state).toBe('todo')
    expect(t.find((x) => x.key === 'dual_control').state).toBe('unknown')
    expect(t.find((x) => x.key === 'first_review').state).toBe('todo')
    expect(t.find((x) => x.key === 'few_super_admins').detail).toMatch(/^2 super admins/)
    expect(taskCounts(t).done).toBe(3)
  })
})

describe('audit query', () => {
  const rows = [
    { actor: 'anum', action: 'update', target: 'role', detail: '' },
    { actor: 'sajid', action: 'login', target: '', detail: '' },
    { actor: 'anum', action: 'login', target: '', detail: '', reason: 'quarterly review' },
  ]
  it('builder and typed syntax share one parser', () => {
    const q = toQueryString([{ field: 'actor', op: 'contains', value: 'anum' }, { field: 'action', op: 'not', value: 'login' }], 'and')
    expect(q).toBe('actor:anum -action:login')
    expect(parseQuery(q).conditions).toHaveLength(2)
    expect(filterByQuery(rows, q)).toHaveLength(1)
  })
  it('OR matches any positive condition', () => {
    expect(filterByQuery(rows, 'actor:sajid OR action:update')).toHaveLength(2)
  })
  it('free text and quoted values', () => {
    expect(filterByQuery(rows, 'reason:"quarterly review"')).toHaveLength(1)
    expect(filterByQuery(rows, 'sajid')).toHaveLength(1)
    expect(filterByQuery(rows, '')).toHaveLength(3)
  })
  it('reason coverage is N/A when unread, never 0', () => {
    expect(reasonCoverageText({ total: null, withReason: null })).toBe('N/A')
    expect(reasonCoverageText({ total: 1821, withReason: 0 })).toBe('0 of 1,821')
  })
})

describe('unused access', () => {
  const idle = new Date(NOW.getTime() - 58 * 86400000).toISOString()
  it('never suggests removing an admin', () => {
    expect(suggestDecision({ role: 'Admin', last_sign_in_at: null }, NOW)).not.toBe('remove')
    expect(suggestDecision({ is_super_admin: true, role: 'Manager', last_sign_in_at: null }, NOW)).not.toBe('remove')
    expect(suggestDecision({ role: 'Admin', last_sign_in_at: idle }, NOW)).toBe('keep')
  })
  it('suggests by sign-in date', () => {
    expect(suggestDecision({ role: 'Tyre Man', last_sign_in_at: NOW.toISOString() }, NOW)).toBe('keep')
    expect(suggestDecision({ role: 'Tyre Man', last_sign_in_at: idle }, NOW)).toBe('ask')
    expect(suggestDecision({ role: 'Driver', last_sign_in_at: null }, NOW)).toBe('lock_until_used')
    expect(suggestDecision({ role: 'Manager', last_sign_in_at: null }, NOW)).toBe('remove')
  })
  it('shapes the summary and lists findings with page views as N/A', () => {
    const s = shapeUnusedSummary({
      idle_days: 30, can_sign_in: 727, active_30d: 118, never_signed_in: 582, never_by_role: { Driver: 581, Manager: 1 },
      idle: 27, idle_by_role: { 'Tyre Man': 12 }, role_totals: { Driver: 674 }, rules_total: 73, rules_with_end: 0,
      rules_grants: 32, rules_blocks: 41, rules_people: 5, empty_custom_roles: ['Mechanic'], reviews_ever: 0, reviews_closed: 0, people: [],
    })
    const f = unusedFindings(s)
    expect(f[0].title).toBe('581 Driver accounts have never signed in')
    expect(f.find((x) => x.key === 'no_end').title).toBe('0 of 73 personal rules have an end date')
    expect(f[f.length - 1].na).toBe(true)
    expect(unusedKpis(s)[1].sub).toBe('16%')
  })
  it('scope, mapping and counts', () => {
    expect(inScope({ last_sign_in_at: null }, 'never', NOW)).toBe(true)
    expect(inScope({ last_sign_in_at: idle }, 'idle', NOW)).toBe(true)
    expect(toReviewDecision('remove')).toBe('revoke')
    expect(toReviewDecision('edit')).toBe('modify')
    expect(decisionCounts({ a: 'keep', b: 'remove' })).toMatchObject({ keep: 1, remove: 1, decided: 2 })
    expect(defaultGrantEndDate(90, new Date('2026-09-30T12:00:00'))).toBe('2026-12-29')
    expect(roleBreakdownText({ A: 5, B: 3, C: 1 }, 2)).toBe('A 5, B 3 and 1 more')
  })
})

describe('webhook resend message', () => {
  it('is honest when the webhook is off', () => {
    expect(resendMessage({ ok: true, will_send: false })).toMatch(/off/)
    expect(resendMessage({ ok: false, reason: 'already_delivered' })).toMatch(/already/)
  })
})
