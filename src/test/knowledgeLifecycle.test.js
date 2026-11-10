import { describe, it, expect } from 'vitest'
import {
  KB_STATUSES, KB_TRANSITIONS, canTransition, storedStatus, isRetrievable, effectiveStatus,
  reviewState, reviewNote, canApprove, canWithdraw, canSupersede, nextVersion,
  validateLifecycleDates, citationLabel, lifecycleCounts, toDay,
} from '../lib/knowledgeLifecycle'

const T = '2026-11-10'
const approved = (extra = {}) => ({ status: 'approved', content: 'x', created_by: 'u1', ...extra })

describe('knowledgeLifecycle transitions (mirror of kb_lifecycle_guard)', () => {
  it('has the five stored states and terminal superseded/withdrawn', () => {
    expect(KB_STATUSES).toEqual(['draft', 'approved', 'superseded', 'expired', 'withdrawn'])
    expect(KB_TRANSITIONS.superseded).toEqual([])
    expect(KB_TRANSITIONS.withdrawn).toEqual([])
    expect(canTransition('draft', 'approved')).toBe(true)
    expect(canTransition('approved', 'draft')).toBe(false)
    expect(canTransition('expired', 'approved')).toBe(false)
  })

  it('treats an unknown status as draft, never approved', () => {
    expect(storedStatus({ status: 'APPROVED' })).toBe('approved')
    expect(storedStatus({ status: 'live' })).toBe('draft')
    expect(storedStatus(null)).toBe('draft')
  })
})

describe('retrieval rule (mirror of match_knowledge_documents WHERE)', () => {
  it('returns only approved, in-date documents', () => {
    expect(isRetrievable(approved(), T)).toBe(true)
    expect(isRetrievable({ status: 'draft' }, T)).toBe(false)
    expect(isRetrievable({ status: 'superseded' }, T)).toBe(false)
    expect(isRetrievable({ status: 'withdrawn' }, T)).toBe(false)
    expect(isRetrievable(approved({ effective_from: '2026-11-11' }), T)).toBe(false)
    expect(isRetrievable(approved({ effective_from: T }), T)).toBe(true)
    expect(isRetrievable(approved({ expires_at: T }), T)).toBe(false) // expires_at > today
    expect(isRetrievable(approved({ expires_at: '2026-11-11' }), T)).toBe(true)
  })

  it('effective status shows expired / scheduled before housekeeping flips it', () => {
    expect(effectiveStatus(approved({ expires_at: '2026-01-01' }), T)).toBe('expired')
    expect(effectiveStatus(approved({ effective_from: '2027-01-01' }), T)).toBe('scheduled')
    expect(effectiveStatus(approved(), T)).toBe('approved')
    expect(effectiveStatus({ status: 'draft', expires_at: '2020-01-01' }, T)).toBe('draft')
  })
})

describe('review warnings', () => {
  it('flags overdue and due-soon approved documents only', () => {
    expect(reviewState(approved({ review_due: '2026-11-01' }), T)).toEqual({ state: 'overdue', days: -9 })
    expect(reviewState(approved({ review_due: '2026-11-20' }), T)).toEqual({ state: 'due_soon', days: 10 })
    expect(reviewState(approved({ review_due: '2027-06-01' }), T).state).toBe('ok')
    expect(reviewState(approved(), T).state).toBe('none')
    expect(reviewState({ status: 'draft', review_due: '2020-01-01' }, T).state).toBe('none')
    expect(reviewNote({ state: 'overdue', days: -1 })).toBe('Review overdue by 1 day')
    expect(reviewNote({ state: 'due_soon', days: 0 })).toBe('Review due today')
    expect(reviewNote({ state: 'ok', days: 90 })).toBe('')
  })
})

describe('approval rights', () => {
  const draft = { status: 'draft', content: 'body', created_by: 'uploader' }
  it('lets an approver role other than the uploader approve', () => {
    expect(canApprove(draft, { role: 'Manager', userId: 'someone' }).ok).toBe(true)
    expect(canApprove(draft, { role: 'Director', userId: 'someone' }).ok).toBe(true)
    expect(canApprove(draft, { role: 'Tyre Man', isSuperAdmin: true, userId: 'x' }).ok).toBe(true)
  })
  it('refuses the uploader (four eyes), non-approvers and non-drafts', () => {
    expect(canApprove(draft, { role: 'Admin', userId: 'uploader' }).reason).toMatch(/uploaded/)
    expect(canApprove(draft, { role: 'Tyre Man', userId: 'x' }).ok).toBe(false)
    expect(canApprove({ ...draft, status: 'approved' }, { role: 'Admin', userId: 'x' }).ok).toBe(false)
    expect(canApprove({ status: 'draft', content: '', chunk_count: 0 }, { role: 'Admin', userId: 'x' }).ok).toBe(false)
    expect(canApprove({ status: 'draft', content: '', chunk_count: 3 }, { role: 'Admin', userId: 'x' }).ok).toBe(true)
  })
  it('withdraw / supersede follow the transition map', () => {
    expect(canWithdraw(approved(), { role: 'Manager' }).ok).toBe(true)
    expect(canWithdraw({ status: 'withdrawn' }, { role: 'Manager' }).ok).toBe(false)
    expect(canWithdraw(approved(), { role: 'Reporter' }).ok).toBe(false)
    expect(canSupersede(approved())).toBe(true)
    expect(canSupersede({ status: 'draft' })).toBe(false)
    expect(nextVersion({ version: 3 })).toBe(4)
    expect(nextVersion({})).toBe(2)
  })
})

describe('dates, citations, counts', () => {
  it('validates the lifecycle dates', () => {
    expect(validateLifecycleDates({})).toBe('')
    expect(validateLifecycleDates({ effective_from: '2026-11-10', expires_at: '2026-11-10' })).toMatch(/after/)
    expect(validateLifecycleDates({ effective_from: '2026-11-10', review_due: '2026-11-01' })).toMatch(/before/)
    expect(validateLifecycleDates({ review_due: 'nope' })).toMatch(/not a valid/)
    expect(toDay('2026-11-10T22:00:00Z')).toBe('2026-11-10')
  })

  it('builds a citation with title, version, page and document id', () => {
    expect(citationLabel({ title: 'Pressure SOP', version: 2, page_from: 3, page_to: 4, document_id: '1a2b3c4d-9999' }))
      .toBe('Pressure SOP v2, p.3-4 [doc 1a2b3c4d]')
    expect(citationLabel({ title: 'Removal criteria', version: 1, page_from: 5, page_to: 5, id: 'abcdef12' }))
      .toBe('Removal criteria v1, p.5 [doc abcdef12]')
    expect(citationLabel({ title: 'Warranty' })).toBe('Warranty')
  })

  it('counts documents by effective status', () => {
    const c = lifecycleCounts([
      approved(), approved({ review_due: '2026-01-01' }), { status: 'draft' },
      approved({ expires_at: '2026-01-01' }), { status: 'withdrawn' },
    ], T)
    expect(c).toMatchObject({ approved: 2, draft: 1, expired: 1, withdrawn: 1, live: 2, reviewOverdue: 1 })
  })
})
