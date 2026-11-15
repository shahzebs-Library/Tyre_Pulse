import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  roleIn, normaliseRole, reviewLabel, isAwaitingReview, completionProblem, reviewProblem, exceptionProblem,
  actionAccess, accessFromServer, withDefaults, DEFAULT_CONFIG, acknowledgeCheck, isFinalSigner,
  faultRows, faultSummary, isCompliant, complianceLabel,
} from '../lib/closureWorkflow'
import { statusSummary, stageFor, isFullyClosed } from '../lib/checklist/checklistApproval'

// Comment lines are dropped: the headers discuss names the statements must not contain.
const sql = (f) => readFileSync(resolve(__dirname, '../../supabase/pending_migrations', f), 'utf8').replace(/\r\n/g, '\n')
  .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
const CA = sql('20261116100000_clo_corrective_action_review.sql')
const CL = sql('20261116101000_clo_checklist_acknowledge_exception.sql')

describe('roles', () => {
  it('compares roles the way the database does', () => {
    expect(normaliseRole(' Workshop_Supervisor ')).toBe('workshop supervisor')
    expect(roleIn('workshop-supervisor', ['Workshop Supervisor'])).toBe(true)
    expect(roleIn('', ['Admin'])).toBe(false)
    expect(roleIn('Admin', null)).toBe(false)
  })
  it('default reviewer and exception roles match the SQL defaults exactly', () => {
    const arrays = [...CA.matchAll(/default array\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
    expect(arrays[0]).toEqual(DEFAULT_CONFIG.ca_reviewer_roles)
    expect(arrays[1]).toEqual(DEFAULT_CONFIG.exception_roles)
    expect(arrays[2]).toEqual([])
  })
  it('a missing or partial config falls back to the defaults', () => {
    expect(withDefaults(null).ca_reviewer_roles).toContain('Workshop Supervisor')
    expect(withDefaults({ ca_min_photos: '2' }).ca_min_photos).toBe(2)
    expect(withDefaults({}).ca_allow_direct_close).toBe(true)
    expect(withDefaults({}).ca_allow_self_review).toBe(false)
  })
})

describe('status vocabulary stays compatible', () => {
  it('the draft adds no corrective action status', () => {
    expect(CA).not.toMatch(/corrective_actions_status_check/)
    expect(CA).not.toMatch(/'Pending Review'/)
    const written = [...CA.matchAll(/set status = '([^']+)'/g)].map((m) => m[1])
    expect(new Set(written)).toEqual(new Set(['In Progress', 'Closed']))
  })
  it('review progress lives in review_status', () => {
    expect(CA).toMatch(/review_status in \('submitted','returned','approved','exception'\)/)
  })
  it('never raises a serialisation failure code', () => {
    expect(CA + CL).not.toMatch(/40001|40P01/)
  })
  it('the blocking rule function is not replaced by the checklist draft', () => {
    expect(CL).not.toMatch(/create or replace function public\.guard_checklist_approval_stages/)
    expect(CL).not.toMatch(/create or replace function public\.decide_checklist_approval/)
  })
  it('every new function is taken away from public and anon', () => {
    for (const text of [CA, CL]) {
      const made = [...text.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1])
      for (const fn of new Set(made)) {
        if (fn === 'checklist_is_area_manager') continue // existing function, grants unchanged
        expect(text, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^;]*\\) from public`))
      }
    }
  })
  it('both drafts end by re-applying the reporting reader policies', () => {
    expect(CA.trim().endsWith('select anum_integration.apply_reader_policies();')).toBe(true)
    expect(CL.trim().endsWith('select anum_integration.apply_reader_policies();')).toBe(true)
  })
})

describe('corrective action review', () => {
  const open = { id: 'a', status: 'Open', review_status: null }
  const submitted = { id: 'a', status: 'In Progress', review_status: 'submitted', submitted_by: 'u1' }

  it('the assigned worker may submit and may not review', () => {
    const a = actionAccess(open, { userId: 'u1', role: 'Tyre Data Collector', isAssignee: true })
    expect(a.canSubmit).toBe(true)
    expect(a.canReview).toBe(false)
    expect(a.canException).toBe(false)
  })
  it('somebody else in the same role may do nothing', () => {
    const a = actionAccess(open, { userId: 'u2', role: 'Tyre Data Collector', isAssignee: false })
    expect(a.canSubmit || a.canUpdate || a.canReview).toBe(false)
  })
  it('a reviewer decides a submission that is not their own', () => {
    expect(actionAccess(submitted, { userId: 'u9', role: 'Workshop Supervisor' }).canReview).toBe(true)
    expect(actionAccess(submitted, { userId: 'u9', role: 'Tyre Engineer' }).canReview).toBe(true)
    expect(actionAccess(submitted, { userId: 'u9', role: 'Tyre Man' }).canReview).toBe(false)
  })
  it('self review is refused unless the company allows it', () => {
    const mine = actionAccess(submitted, { userId: 'u1', role: 'Manager' })
    expect(mine.canReview).toBe(false)
    expect(mine.selfReviewBlocked).toBe(true)
    expect(actionAccess(submitted, { userId: 'u1', role: 'Manager', config: { ca_allow_self_review: true } }).canReview).toBe(true)
  })
  it('reviewer roles come from the company config, not from code', () => {
    const cfg = { ca_reviewer_roles: ['Quality Lead'] }
    expect(actionAccess(submitted, { userId: 'u9', role: 'Manager', config: cfg }).canReview).toBe(false)
    expect(actionAccess(submitted, { userId: 'u9', role: 'quality lead', config: cfg }).canReview).toBe(true)
  })
  it('nothing is offered on a closed action or while it is waiting', () => {
    const closed = actionAccess({ status: 'Closed' }, { userId: 'u1', role: 'Admin', isAssignee: true })
    expect(closed.canSubmit || closed.canReview || closed.canException).toBe(false)
    expect(actionAccess(submitted, { userId: 'u1', role: 'Tyre Data Collector', isAssignee: true }).canSubmit).toBe(false)
  })
  it('evidence: a note is always required, photographs when the company asks', () => {
    expect(completionProblem({ note: ' ' })).toMatch(/Describe/)
    expect(completionProblem({ note: 'Tyre replaced' })).toBeNull()
    expect(completionProblem({ note: 'Tyre replaced', photos: [] }, { minPhotos: 1 })).toMatch(/photograph/)
    expect(completionProblem({ note: 'Tyre replaced', photos: ['x'] }, { minPhotos: 1 })).toBeNull()
    expect(completionProblem({ note: 'Tyre replaced', photos: new Array(7).fill('x') })).toMatch(/at most 6/)
  })
  it('a return needs a comment, an approval does not', () => {
    expect(reviewProblem('return', '')).toMatch(/corrected/)
    expect(reviewProblem('return', 'Photo is blurred')).toBeNull()
    expect(reviewProblem('approve', '')).toBeNull()
    expect(reviewProblem('close', '')).toMatch(/approve or return/)
  })
  it('an exception needs a real reason', () => {
    expect(exceptionProblem('too short')).toMatch(/10 characters/)
    expect(exceptionProblem('Vehicle sold on 1 December')).toBeNull()
  })
  it('an unreadable server answer offers nothing', () => {
    const a = accessFromServer(null)
    expect(a.known).toBe(false)
    expect(a.canSubmit || a.canReview || a.canException || a.canUpdate).toBe(false)
    expect(accessFromServer({ ok: true, can_review: true, min_photos: 2 })).toMatchObject({ known: true, canReview: true, minPhotos: 2 })
  })
  it('labels say where the action is, and an old closed action is not given an invented review', () => {
    expect(reviewLabel(submitted).text).toBe('Waiting for review')
    expect(reviewLabel({ status: 'In Progress', review_status: 'returned' }).tone).toBe('bad')
    expect(reviewLabel({ status: 'Closed', review_status: 'exception' }).text).toMatch(/exception/)
    expect(reviewLabel({ status: 'Closed', review_status: null }).text).toMatch(/before reviews/)
    expect(reviewLabel(open)).toBeNull()
    expect(isAwaitingReview(submitted)).toBe(true)
    expect(isAwaitingReview({ status: 'Closed', review_status: 'submitted' })).toBe(false)
  })
  it('no user-facing text uses a long dash', () => {
    const src = readFileSync(resolve(__dirname, '../lib/closureWorkflow.js'), 'utf8')
      + readFileSync(resolve(__dirname, '../components/correctiveActions/ClosureReviewPanel.jsx'), 'utf8')
      + readFileSync(resolve(__dirname, '../components/checklist/ChecklistFaultPanel.jsx'), 'utf8')
      + readFileSync(resolve(__dirname, '../components/correctiveActions/ClosureReviewSettings.jsx'), 'utf8')
    expect(src).not.toMatch(/[–—]/)
  })
})

describe('checklist with a fault', () => {
  const pending = { approval_status: 'pending', submitted_by: 'w1' }
  const atManager = { approval_status: 'pending_area_manager', submitted_by: 'w1' }
  const base = { twoStage: true, faultCount: 1, userId: 'u9' }

  it('a clean sheet is never acknowledged', () => {
    expect(acknowledgeCheck({ ...base, submission: atManager, faultCount: 0, role: 'Admin' }).ok).toBe(false)
  })
  it('two signatures: the final signer acknowledges, a supervisor is told to sign first', () => {
    expect(acknowledgeCheck({ ...base, submission: atManager, role: 'Workshop Maintenance Area Manager' })).toMatchObject({ ok: true, bothSteps: false })
    expect(acknowledgeCheck({ ...base, submission: pending, role: 'PMV Manager' })).toMatchObject({ ok: true, bothSteps: true })
    const sup = acknowledgeCheck({ ...base, submission: pending, role: 'Workshop Supervisor' })
    expect(sup.ok).toBe(false)
    expect(sup.reason).toMatch(/supervisor signature first/)
    expect(acknowledgeCheck({ ...base, submission: atManager, role: 'Tyre Man' }).ok).toBe(false)
  })
  it('one signature: a supervisor acknowledges', () => {
    expect(acknowledgeCheck({ ...base, twoStage: false, submission: pending, role: 'Workshop Supervisor' }).ok).toBe(true)
    expect(acknowledgeCheck({ ...base, twoStage: false, submission: pending, role: 'Driver' }).ok).toBe(false)
  })
  it('the submitter cannot acknowledge their own sheet unless the company allows it', () => {
    const own = { ...base, submission: atManager, role: 'Admin', userId: 'w1' }
    expect(acknowledgeCheck(own).ok).toBe(false)
    expect(acknowledgeCheck({ ...own, config: { checklist_allow_self_ack: true } }).ok).toBe(true)
  })
  it('a company can add a final signer role; the default adds none', () => {
    expect(isFinalSigner('Workshop Supervisor')).toBe(false)
    expect(isFinalSigner('Workshop Supervisor', { config: { checklist_final_signer_roles: ['Workshop Supervisor'] } })).toBe(true)
    expect(isFinalSigner('Director')).toBe(true)
  })
  it('a decided or policy-routed sheet is not acknowledged here', () => {
    expect(acknowledgeCheck({ ...base, submission: { approval_status: 'approved' }, role: 'Admin' }).ok).toBe(false)
    expect(acknowledgeCheck({ ...base, submission: { ...atManager, approval_policy_required: true }, role: 'Admin' }).reason).toMatch(/approval policy/)
  })
  it('acknowledged is not approved and is not waiting on anyone', () => {
    const s = { approval_status: 'acknowledged' }
    expect(isFullyClosed(s)).toBe(false)
    expect(stageFor({ require_area_manager: true }, s)).toBeNull()
    expect(statusSummary(null, s)).toEqual({ tone: 'warn', text: 'Acknowledged with a recorded fault' })
  })

  const blocking = [{ id: 'f1', label: 'Brakes', value: 'Not OK' }, { id: 'f2', label: 'Mirrors', value: 'Not OK' }]
  it('each fault takes its state from its corrective action', () => {
    const rows = faultRows(blocking, [
      { id: 1, source_detail: 'Brakes', status: 'Closed', review_status: 'approved' },
      { id: 2, source_detail: 'Mirrors', status: 'In Progress', review_status: 'submitted' },
    ])
    expect(rows.map((r) => r.state)).toEqual(['resolved', 'in_review'])
    expect(faultRows(blocking, []).map((r) => r.state)).toEqual(['unlinked', 'unlinked'])
  })
  it('compliant only when every fault is resolved or excepted', () => {
    const ack = { approval_status: 'acknowledged' }
    const oneOpen = faultSummary(faultRows(blocking, [{ source_detail: 'Brakes', status: 'Closed', review_status: 'approved' }, { source_detail: 'Mirrors', status: 'Open' }]))
    expect(oneOpen).toMatchObject({ open: 1, state: 'fault_open' })
    expect(isCompliant(ack, oneOpen)).toBe(false)
    expect(complianceLabel(ack, oneOpen).text).toBe('Acknowledged, 1 fault open')

    const excepted = faultSummary(faultRows(blocking, [{ source_detail: 'Brakes', status: 'Closed', review_status: 'approved' }, { source_detail: 'Mirrors', status: 'Closed', review_status: 'exception' }]))
    expect(excepted).toMatchObject({ open: 0, exception: 1, state: 'exception' })
    expect(isCompliant(ack, excepted)).toBe(true)
    expect(complianceLabel(ack, excepted).text).toMatch(/by exception/)
  })
  it('an unlinked fault keeps the sheet non-compliant', () => {
    expect(isCompliant({ approval_status: 'acknowledged' }, faultSummary(faultRows(blocking, [])))).toBe(false)
  })
  it('history is never re-judged: an approved sheet stays compliant, a waiting sheet is not', () => {
    const open = faultSummary(faultRows(blocking, []))
    expect(isCompliant({ approval_status: 'approved' }, open)).toBe(true)
    expect(isCompliant({ approval_status: 'pending' }, faultSummary([]))).toBe(false)
    expect(isCompliant({ approval_status: 'rejected' }, faultSummary([]))).toBe(false)
  })
})
