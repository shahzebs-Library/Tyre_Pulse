/**
 * Owner decision 2026-11-15: a Tire Planning Engineer may ASK for an exception, with
 * supporting evidence, only on actions inside their company, country and sites. They
 * never decide or close it. The database enforces this (draft 20261116100000, staging
 * tests T01-T11); these tests pin what the browser offers and sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const svc = vi.hoisted(() => ({
  getActionReviewAccess: vi.fn(), getActionReview: vi.fn(), listActionReviewEvents: vi.fn(),
  submitCompletion: vi.fn(), reviewAction: vi.fn(), requestException: vi.fn(), decideException: vi.fn(), recordProgress: vi.fn(),
}))
vi.mock('../lib/api/closureReview', () => svc)
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en' }),
}))

import ClosureReviewPanel from '../components/correctiveActions/ClosureReviewPanel'
import { actionAccess, accessFromServer, hasNoAction, evidenceProblem } from '../lib/closureWorkflow'
import { MESSAGE_KEYS } from '../lib/closureText'
import { CLOSURE_STATUS_REFUSALS } from '../lib/api/correctiveActions'
import en from '../locales/en/closure.json'
import ar from '../locales/ar/closure.json'

const TPE = 'Tire Planning Engineer'
const ASKED = 'You asked for an exception on this action, so another authorised person has to close it.'
const open = { id: 'a1', status: 'In Progress', review_status: null }

function serverAccess(over) {
  return { provisioned: true, ...accessFromServer({ ok: true, ...over }) }
}

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset())
  svc.getActionReview.mockResolvedValue({ provisioned: true, review: null })
  svc.listActionReviewEvents.mockResolvedValue([])
})

describe('Tire Planning Engineer exception rules (client mirror)', () => {
  it('a TPE reviewer may ask for an exception but is not an exception decider by default', () => {
    const a = actionAccess(open, { userId: 'tpe', role: TPE })
    expect(a.canRequestException).toBe(true)
    const pending = { ...open, review_status: 'exception_requested', exception_requested_by: 'other' }
    expect(actionAccess(pending, { userId: 'tpe', role: TPE }).canDecideException).toBe(false)
  })
  it('the TPE who asked never decides it, even when the company adds TPE as an exception role', () => {
    const pending = { ...open, review_status: 'exception_requested', exception_requested_by: 'tpe' }
    const cfg = { exception_roles: ['Admin', TPE] }
    const a = actionAccess(pending, { userId: 'tpe', role: TPE, config: cfg })
    expect(a.canDecideException).toBe(false)
    expect(a.exceptionSelfBlocked).toBe(true)
    expect(a.exceptionRequestedByMe).toBe(true)
  })
  it('the TPE who asked cannot approve a later completion; another reviewer can', () => {
    const submitted = { ...open, review_status: 'submitted', submitted_by: 'worker', exception_requested_by: 'tpe' }
    const mine = actionAccess(submitted, { userId: 'tpe', role: TPE })
    expect(mine.canReview).toBe(false)
    expect(mine.closeBlockedExceptionRequester).toBe(true)
    expect(actionAccess(submitted, { userId: 'tpe2', role: TPE }).canReview).toBe(true)
  })
  it('server flags are read and fail closed; a blocked requester still has something to read', () => {
    const a = accessFromServer({ ok: true, close_blocked_exception_requester: true, exception_requested_by_me: true })
    expect(a.closeBlockedExceptionRequester).toBe(true)
    expect(a.exceptionRequestedByMe).toBe(true)
    expect(hasNoAction(a)).toBe(false)
    const unknown = accessFromServer({ ok: false })
    expect(unknown.canRequestException).toBe(false)
    expect(unknown.closeBlockedExceptionRequester).toBe(false)
  })
  it('evidence is optional and limited to 6 photographs', () => {
    expect(evidenceProblem([])).toBeNull()
    expect(evidenceProblem(undefined)).toBeNull()
    expect(evidenceProblem(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toMatch(/at most 6/)
    expect(evidenceProblem('x')).toMatch(/list/)
  })
  it('the database refusal reads as a plain sentence in English and Arabic', () => {
    expect(CLOSURE_STATUS_REFUSALS).toContain(ASKED)
    const key = MESSAGE_KEYS[ASKED]
    expect(key).toBe('selfExceptionClose')
    expect(en.msg[key]).toBe(ASKED)
    expect(typeof ar.msg[key]).toBe('string')
    for (const k of ['exceptionRequestedByMe', 'closeBlockedExceptionRequester', 'exceptionEvidenceLabel', 'exceptionEvidence']) {
      expect(typeof en.review[k]).toBe('string')
      expect(typeof ar.review[k]).toBe('string')
      expect(/[–—]/.test(en.review[k])).toBe(false)
    }
  })
})

describe('ClosureReviewPanel for a Tire Planning Engineer', () => {
  it('offers "Ask for exception" on an in-scope action and sends the reason with evidence', async () => {
    svc.getActionReviewAccess.mockResolvedValue(serverAccess({ is_reviewer: true, can_request_exception: true, waiting_on: 'worker' }))
    svc.requestException.mockResolvedValue({ ok: true })
    render(<ClosureReviewPanel action={open} />)
    fireEvent.click(await screen.findByText('closure.review.requestLink'))
    fireEvent.change(screen.getByLabelText('closure.review.requestReasonLabel'), { target: { value: 'Tyre held for supplier warranty check' } })
    expect(screen.getByText('closure.review.exceptionEvidenceLabel')).toBeTruthy()
    fireEvent.click(screen.getByText('closure.review.requestBtn'))
    await waitFor(() => expect(svc.requestException).toHaveBeenCalledWith('a1', 'Tyre held for supplier warranty check', []))
  })
  it('shows nothing for an action outside the company, country or sites (server says ok: false)', async () => {
    svc.getActionReviewAccess.mockResolvedValue({ provisioned: true, ...accessFromServer({ ok: false }) })
    const { container } = render(<ClosureReviewPanel action={open} />)
    await waitFor(() => expect(svc.getActionReviewAccess).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('closure.review.loading')).toBeNull())
    expect(screen.queryByText('closure.review.requestLink')).toBeNull()
    expect(container.querySelector('[data-testid="closure-review-panel"]')).toBeNull()
  })
  it('on their own pending exception: no decide controls, a plain sentence instead', async () => {
    svc.getActionReviewAccess.mockResolvedValue(serverAccess({
      is_reviewer: true, can_decide_exception: false, exception_requested_by_me: true, waiting_on: 'exception_decider',
      review_status: 'exception_requested',
    }))
    svc.getActionReview.mockResolvedValue({ provisioned: true, review: {
      review_status: 'exception_requested', exception_requested_by: 'tpe', exception_reason: 'Held for warranty check',
      exception_evidence: ['data:image/jpeg;base64,AAAA'],
    } })
    render(<ClosureReviewPanel action={{ ...open, review_status: 'exception_requested' }} />)
    expect(await screen.findByTestId('exception-requested-by-me')).toBeTruthy()
    expect(screen.queryByTestId('exception-decision')).toBeNull()
    expect(screen.queryByText('closure.review.approveException')).toBeNull()
    expect(screen.getByTestId('exception-evidence')).toBeTruthy()
  })
  it('after asking, the TPE sees no approve control on the later completion', async () => {
    svc.getActionReviewAccess.mockResolvedValue(serverAccess({
      is_reviewer: true, can_review: false, close_blocked_exception_requester: true, waiting_on: 'reviewer', review_status: 'submitted',
    }))
    render(<ClosureReviewPanel action={{ ...open, review_status: 'submitted' }} />)
    expect(await screen.findByTestId('exception-requester-close-blocked')).toBeTruthy()
    expect(screen.queryByText('closure.review.approveBtn')).toBeNull()
  })
})
