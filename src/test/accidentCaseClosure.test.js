import { describe, it, expect } from 'vitest'
import {
  requiredWorkstreams,
  completeness,
  closureLevel, canFullyClose, NON_WAIVABLE,
  allowedTransitions, canTransition, transitionSpec,
  preHoldStatus, reopenTarget, deriveCaseStatus,
} from '../lib/accidentCase'

const NOW = new Date('2026-07-28T00:00:00Z').getTime()

// Build explicit accident_case_workstreams rows from a { ws: status } map
// (mirrors the helper in accidentCase.test.js).
const rows = (map) => Object.entries(map).map(([workstream, v]) =>
  (typeof v === 'string' ? { workstream, status: v } : { workstream, ...v }))

// Every required workstream of a route completed, then override a subset.
const completedExcept = (route, record, overrides = {}) => {
  const req = [...requiredWorkstreams(route, record)]
  const base = Object.fromEntries(req.map((ws) => [ws, 'completed']))
  return rows({ ...base, ...overrides })
}

// A valid, approved NA envelope (the strongest waiver a case can carry).
const naApproved = (reason = 'not applicable') =>
  ({ status: 'not_required', na_reason: { reason, by: 'u1', at: '2026-07-01', approved_by: 'mgr' } })
// A valid NA envelope with NO approver.
const naBare = (reason = 'not applicable') =>
  ({ status: 'not_required', na_reason: { reason, by: 'u1', at: '2026-07-01' } })

// ═════════════════════════════════════════════════════════════════════════════
// NON_WAIVABLE workstreams can NEVER be satisfied by a Not-Applicable waiver
// ═════════════════════════════════════════════════════════════════════════════
describe('NON_WAIVABLE workstreams cannot be closed out via NA (even approved)', () => {
  it('NON_WAIVABLE is exactly the case spine: incident_evidence, liability, finance', () => {
    expect([...NON_WAIVABLE].sort()).toEqual(['finance', 'incident_evidence', 'liability'])
  })

  // The three mandatory workstreams, each on a route that requires it. minor_no_insurance
  // requires incident_evidence, fleet_validation, liability, assessment, repair, handover, finance.
  for (const ws of ['incident_evidence', 'liability', 'finance']) {
    it(`a mandatory ${ws} marked NA-with-approval still blocks canFullyClose`, () => {
      const route = 'minor_no_insurance'
      const record = { closure_review_approved: true }
      expect(requiredWorkstreams(route, record).has(ws)).toBe(true)
      const wsRows = completedExcept(route, record, { [ws]: naApproved('self-declared not applicable') })
      const res = canFullyClose(record, wsRows, route, { now: NOW })
      expect(res.ok).toBe(false)
      expect(res.blockers.some((b) => b.workstream === ws)).toBe(true)
    })
  }

  it('finance NA (approved) blocks even when every other required workstream is genuinely complete', () => {
    const route = 'minor_no_insurance'
    const record = { closure_review_approved: true }
    const wsRows = completedExcept(route, record, { finance: naApproved('written off, no cost') })
    const res = canFullyClose(record, wsRows, route, { now: NOW })
    // finance is the ONLY blocker; nothing else can rescue a waived non-waivable spine
    expect(res.ok).toBe(false)
    const financeBlockers = res.blockers.filter((b) => b.workstream === 'finance')
    expect(financeBlockers).toHaveLength(1)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Waivable NA + the approval requirement (default-when-profile-absent)
// ═════════════════════════════════════════════════════════════════════════════
describe('waivable NA requires an approver unless a config profile opts out', () => {
  // insurance is waivable (not in NON_WAIVABLE) and required on the insurance routes.
  const record = { repair_type: 'Internal', closure_review_approved: true }

  it('a fallback route (NO profile) DEFAULTS to requiring approval: bare NA blocks, approved NA passes', () => {
    const route = 'internal_repair_insurance' // bare string => no profile
    expect(requiredWorkstreams(route, record).has('insurance')).toBe(true)

    const bare = completedExcept(route, record, { insurance: naBare('self-insured') })
    expect(canFullyClose(record, bare, route, { now: NOW }).ok).toBe(false)

    const approved = completedExcept(route, record, { insurance: naApproved('self-insured') })
    expect(canFullyClose(record, approved, route, { now: NOW }).ok).toBe(true)
  })

  it('a config profile with na_requires_approval: true blocks a bare NA and accepts an approved one', () => {
    const req = [...requiredWorkstreams('internal_repair_insurance', record)]
    const route = { key: 'cfg', profile: { na_requires_approval: true, required_workstreams: req } }

    const bare = completedExcept(route, record, { insurance: naBare('x') })
    expect(canFullyClose(record, bare, route, { now: NOW }).ok).toBe(false)

    const approved = completedExcept(route, record, { insurance: naApproved('x') })
    expect(canFullyClose(record, approved, route, { now: NOW }).ok).toBe(true)
  })

  it('a config profile MAY opt to be looser (na_requires_approval absent) so a bare NA waives', () => {
    // An explicit profile that does not demand approval can accept a bare reason.
    // This is the only path looser than the default; a profile-less route never is.
    const req = [...requiredWorkstreams('internal_repair_insurance', record)]
    const route = { key: 'cfg', profile: { required_workstreams: req } } // na_requires_approval undefined
    const bare = completedExcept(route, record, { insurance: naBare('self-insured') })
    expect(canFullyClose(record, bare, route, { now: NOW }).ok).toBe(true)
  })

  it('the same waivable insurance NA also flows through the case-status projection', () => {
    // With insurance validly + approvably waived and everything else done, the
    // projection lands on closed on a fallback route (which requires approval).
    const route = 'internal_repair_insurance'
    const submitted = { submitted: true, repair_type: 'Internal', closure_review_approved: true }
    const wsRows = completedExcept(route, submitted, { insurance: naApproved('self-insured') })
    expect(deriveCaseStatus(submitted, wsRows, route)).toBe('closed')
    // downgrade to a bare NA (no approver) on the same fallback route -> not closed
    const bare = completedExcept(route, submitted, { insurance: naBare('self-insured') })
    expect(deriveCaseStatus(submitted, bare, route)).not.toBe('closed')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// canFullyClose is true ONLY when everything in scope is done AND review passed
// ═════════════════════════════════════════════════════════════════════════════
describe('canFullyClose gates on both the workstreams AND the closure review', () => {
  const route = 'internal_repair_insurance'

  it('all in-scope complete (one validly waived) but review NOT approved -> blocked on closure_review', () => {
    const record = { repair_type: 'Internal', closure_review_approved: false }
    const wsRows = completedExcept(route, record, { insurance: naApproved('self-insured') })
    const res = canFullyClose(record, wsRows, route, { now: NOW })
    expect(res.ok).toBe(false)
    expect(res.blockers.some((b) => b.check === 'closure_review')).toBe(true)
    // and NO workstream blocker: the waiver counted, only the review remains
    expect(res.blockers.some((b) => b.workstream)).toBe(false)
  })

  it('approving the closure review with everything else done flips it to ok', () => {
    const record = { repair_type: 'Internal', closure_review_approved: true }
    const wsRows = completedExcept(route, record, { insurance: naApproved('self-insured') })
    const res = canFullyClose(record, wsRows, route, { now: NOW })
    expect(res.ok).toBe(true)
    expect(res.blockers).toEqual([])
  })

  it('the review approver name alone (no boolean) also satisfies the closure review gate', () => {
    const record = { repair_type: 'Internal', closure_approved_by: 'fleet.mgr' }
    const wsRows = completedExcept(route, record, { insurance: naApproved('self-insured') })
    expect(canFullyClose(record, wsRows, route, { now: NOW }).ok).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// allowedTransitions — dynamic targets
// ═════════════════════════════════════════════════════════════════════════════
describe('allowedTransitions dynamic legal-hold + reopen targets', () => {
  it('legal_hold release routes to preHoldStatus(record)', () => {
    const record = { pre_hold_status: 'repair_in_progress' }
    const target = preHoldStatus(record)
    expect(target).toBe('repair_in_progress')
    const release = allowedTransitions('legal_hold', { record }).find((t) => t.action === 'Hold released')
    expect(release).toBeTruthy()
    expect(release.to).toBe(target)
    expect(canTransition('legal_hold', 'repair_in_progress', { record })).toBe(true)
    // it does not fall through to a hardcoded closure_review
    expect(canTransition('legal_hold', 'closure_review', { record })).toBe(false)
  })

  it('legal_hold release with no stored prior falls back to a live, non-closure status', () => {
    const release = allowedTransitions('legal_hold').find((t) => t.action === 'Hold released')
    expect(release.to).not.toBe('closure_review')
    expect(release.to).toBe(preHoldStatus({}))
  })

  it('reopened routes to reopenTarget(record) — a finance dispute goes to financial_closure_pending', () => {
    const record = { reopen_reason: 'finance settlement dispute reopened' }
    const target = reopenTarget(record)
    expect(target).toBe('financial_closure_pending')
    const reopen = allowedTransitions('reopened', { record }).find((t) => t.action === 'Reopen assigns to workstream')
    expect(reopen).toBeTruthy()
    expect(reopen.to).toBe(target)
    expect(canTransition('reopened', 'financial_closure_pending', { record })).toBe(true)
    // the plain workshop entry is not offered when the reason names finance
    expect(canTransition('reopened', 'technical_assessment', { record })).toBe(false)
  })

  it('reopened with an explicit reopen_target wins over the reason keyword', () => {
    const record = { reopen_target: 'corrective_actions_pending', reopen_reason: 'finance dispute' }
    expect(reopenTarget(record)).toBe('corrective_actions_pending')
    expect(canTransition('reopened', 'corrective_actions_pending', { record })).toBe(true)
  })

  it('financial_closure_pending can go to BOTH corrective_actions_pending AND closure_review', () => {
    expect(canTransition('financial_closure_pending', 'corrective_actions_pending')).toBe(true)
    expect(canTransition('financial_closure_pending', 'closure_review')).toBe(true)
    expect(transitionSpec('financial_closure_pending', 'corrective_actions_pending').cap).toBe('post_cost')
    expect(transitionSpec('financial_closure_pending', 'closure_review').cap).toBe('post_cost')
    const targets = allowedTransitions('financial_closure_pending').map((t) => t.to)
    expect(targets).toContain('corrective_actions_pending')
    expect(targets).toContain('closure_review')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// completeness null dimensions + a genuinely closed legacy case
// ═════════════════════════════════════════════════════════════════════════════
describe('completeness null dimensions and legacy closed cases', () => {
  it('an out-of-scope dimension is null, never 0 or 100', () => {
    // minor_no_insurance has no insurance workstream in scope.
    const c = completeness({}, [], 'minor_no_insurance')
    expect(c.insurance).toBeNull()
    // an in-scope but empty dimension is 0, not null (the distinction is the point)
    expect(c.incident).toBe(0)
    expect(c.repair).toBe(0)
    expect(c.financial).toBe(0)
  })

  it('overall is null when nothing at all is in scope', () => {
    const route = { key: 'empty', profile: { required_workstreams: [] } }
    const c = completeness({}, [], route)
    expect(c.overall).toBeNull()
    expect(c.incident).toBeNull()
    expect(c.insurance).toBeNull()
    expect(c.repair).toBeNull()
    expect(c.financial).toBeNull()
  })

  it('a genuinely closed legacy case reads fully_closed regardless of its workstreams', () => {
    // No workstream rows at all, but the record carries a closed status.
    expect(closureLevel({ case_status: 'closed' }, [], 'internal_repair_insurance')).toBe('fully_closed')
    // the legacy `status` column is honoured too (case_status || status)
    expect(closureLevel({ status: 'closed' }, [], 'internal_repair_insurance')).toBe('fully_closed')
    // and the projection agrees the case is closed
    expect(deriveCaseStatus({ case_status: 'closed' }, [], 'internal_repair_insurance')).toBe('closed')
  })

  it('a closed status wins over a still-set total_loss / reopened flag on a legacy record', () => {
    expect(deriveCaseStatus({ case_status: 'closed', total_loss: true }, [], 'total_loss')).toBe('closed')
    expect(deriveCaseStatus({ case_status: 'closed', reopened: true }, [], 'total_loss')).toBe('closed')
  })
})
