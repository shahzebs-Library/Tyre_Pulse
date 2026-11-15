import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  roleIn, normaliseRole, reviewLabel, isAwaitingReview, completionProblem, reviewProblem, exceptionProblem,
  actionAccess, accessFromServer, withDefaults, DEFAULT_CONFIG, acknowledgeCheck, isFinalSigner,
  faultRows, faultSummary, isCompliant, complianceLabel, hasNoAction, exceptionDecisionProblem,
  ACK_ACTION_REQUIRED, acknowledgedLabel, acknowledgedText,
} from '../lib/closureWorkflow'
import { workspaceBucket, WORKSPACE_BUCKETS, workspaceKpis, listTabCounts, filterWorkspaceList } from '../lib/checklistWorkspaceView'
import { prettyStatus } from '../lib/checklistView'
import { submissionExportRows } from '../lib/checklistsAnalytics'
import { buildAuditPack, approvalLabel } from '../lib/checklistAuditPack'
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
    expect(CA).toMatch(/review_status in \('submitted','returned','approved','exception_requested','exception'\)/)
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
    expect(a.canDecideException).toBe(false)
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
    expect(closed.canSubmit || closed.canReview || closed.canRequestException || closed.canDecideException).toBe(false)
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
    expect(a.canSubmit || a.canReview || a.canRequestException || a.canDecideException || a.canUpdate).toBe(false)
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
    expect(statusSummary(null, s)).toEqual({ tone: 'warn', text: 'Acknowledged, Action Required' })
    expect(statusSummary(null, { ...s, ack_fault_state: 'fault_resolved' }).text).toBe('Acknowledged, faults resolved')
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
    expect(complianceLabel(ack, oneOpen)).toMatchObject({ text: 'Acknowledged, Action Required', detail: '1 fault open', open: 1 })

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

describe('round 2 owner decisions', () => {
  const cfg = withDefaults(null)
  const requested = { status: 'In Progress', review_status: 'exception_requested', exception_requested_by: 'mgr', submitted_by: 'worker' }

  it('an exception is a request: the person who asked can never decide it', () => {
    const asker = actionAccess(requested, { userId: 'mgr', role: 'Manager', config: cfg })
    expect(asker).toMatchObject({ canDecideException: false, exceptionSelfBlocked: true, canRequestException: false })
    const other = actionAccess(requested, { userId: 'am', role: 'Workshop Maintenance Area Manager', config: cfg })
    expect(other).toMatchObject({ canDecideException: true, exceptionSelfBlocked: false })
  })
  it('the self review switch never applies to exceptions, and a super admin is bound too', () => {
    const on = { ...cfg, ca_allow_self_review: true }
    expect(actionAccess(requested, { userId: 'mgr', role: 'Manager', config: on }).canDecideException).toBe(false)
    expect(actionAccess(requested, { userId: 'mgr', role: 'Admin', isSuperAdmin: true, config: on }).canDecideException).toBe(false)
  })
  it('the person who submitted the completion cannot decide the exception either', () => {
    const a = { ...requested, exception_requested_by: 'admin', submitted_by: 'mgr' }
    expect(actionAccess(a, { userId: 'mgr', role: 'Manager', config: cfg })).toMatchObject({ canDecideException: false, exceptionSelfBlocked: true })
  })
  it('a worker may ask for an exception but has no closing right of any kind', () => {
    const open = { status: 'In Progress', review_status: null }
    const worker = actionAccess(open, { userId: 'w', role: 'Tyre Data Collector', isAssignee: true, config: cfg })
    expect(worker).toMatchObject({ canSubmit: true, canRequestException: true, canReview: false, canDecideException: false, isReviewer: false })
    const waiting = actionAccess({ ...requested, exception_requested_by: 'w' }, { userId: 'w', role: 'Tyre Data Collector', isAssignee: true, config: cfg })
    expect(waiting).toMatchObject({ canSubmit: false, canUpdate: false, canDecideException: false, exceptionSelfBlocked: false, waitingOn: 'exception_decider' })
    expect(hasNoAction(waiting)).toBe(true)
  })
  it('a requested exception is not a closed action and sits in the queue', () => {
    expect(reviewLabel(requested)).toEqual({ tone: 'warn', text: 'Exception requested, waiting for a decision' })
    expect(isAwaitingReview(requested)).toBe(true)
    expect(exceptionDecisionProblem('refuse', '')).toMatch(/why the exception is refused/)
    expect(exceptionDecisionProblem('approve', '')).toBeNull()
    expect(exceptionDecisionProblem('close', '')).toMatch(/approve or refuse/)
    expect(faultRows([{ id: 'f', label: 'Brakes', value: 'Not OK' }], [{ source_detail: 'Brakes', ...requested }])[0].state).toBe('exception_requested')
  })
  it('the server answer carries the same exception fields, failing closed', () => {
    expect(accessFromServer({ ok: true, can_request_exception: true, exception_self_blocked: true, waiting_on: 'reviewer' }))
      .toMatchObject({ canRequestException: true, exceptionSelfBlocked: true, canDecideException: false, waitingOn: 'reviewer' })
    expect(accessFromServer({ ok: true, waiting_on: 'someone' }).waitingOn).toBeNull()
  })
  it('the SQL draft has the request and decision writers and no self-service exception', () => {
    expect(CA).toMatch(/corrective_action_request_exception/)
    expect(CA).toMatch(/corrective_action_decide_exception/)
    expect(CA).not.toMatch(/function public\.corrective_action_record_exception/)
    expect(CA).toMatch(/You asked for this exception, so another authorised person has to decide it\./)
    expect(CA).not.toMatch(/errcode = '40001'/)
  })

  it('an acknowledged sheet reads "Acknowledged, Action Required" unless its fault is known to be settled', () => {
    expect(ACK_ACTION_REQUIRED).toBe('Acknowledged, Action Required')
    expect(acknowledgedLabel({ approval_status: 'acknowledged' })).toMatchObject({ text: ACK_ACTION_REQUIRED, actionRequired: true })
    expect(acknowledgedLabel({ approval_status: 'acknowledged', ack_fault_state: 'fault_open' }).actionRequired).toBe(true)
    expect(acknowledgedLabel({ approval_status: 'acknowledged', ack_fault_state: 'exception' })).toMatchObject({ text: 'Acknowledged, compliant by exception', actionRequired: false })
    expect(acknowledgedLabel({ approval_status: 'acknowledged', ack_fault_state: 'fault_resolved' }).text).toBe('Acknowledged, faults resolved')
    expect(acknowledgedLabel({ approval_status: 'approved' })).toBeNull()
    expect(acknowledgedText({ approval_status: 'pending' })).toBeNull()
  })
  it('lists: not pending, not approved, counted as action required', () => {
    const subs = [
      { id: 1, approval_status: 'acknowledged' },
      { id: 2, approval_status: 'acknowledged', ack_fault_state: 'fault_resolved' },
      { id: 3, approval_status: 'pending' },
      { id: 4, approval_status: 'approved' },
    ]
    expect(subs.map(workspaceBucket)).toEqual(['ack_action', 'ack_settled', 'pending', 'approved'])
    expect(WORKSPACE_BUCKETS.ack_action.label).toBe(ACK_ACTION_REQUIRED)
    const k = workspaceKpis(subs)
    expect(k).toMatchObject({ pending: 1, actionRequired: 1, done: 2 })
    expect(listTabCounts(subs)).toMatchObject({ pending: 1, action: 1 })
    expect(filterWorkspaceList(subs, { tab: 'action' }).map((s) => s.id)).toEqual([1])
  })
  it('viewer, export and queue rows use the same words', () => {
    const s = { id: 1, approval_status: 'acknowledged', status: 'submitted' }
    expect(prettyStatus(s.approval_status, s)).toBe(ACK_ACTION_REQUIRED)
    expect(prettyStatus('acknowledged')).toBe(ACK_ACTION_REQUIRED)
    expect(prettyStatus('pending_area_manager')).toBe('Pending Area Manager')
    expect(submissionExportRows([s])[0].status).toBe(ACK_ACTION_REQUIRED)
    expect(submissionExportRows([{ ...s, ack_fault_state: 'exception' }])[0].status).toBe('Acknowledged, compliant by exception')
  })
  it('Audit Pack: acknowledged is named, not waiting, not signed off, and raises a finding while a fault is open', () => {
    const tpl = { id: 't1', name: 'Daily', status: 'published', fields: [{ id: 'f1', label: 'Brakes', type: 'select', options_ref: 'legend' }],
      option_sets: { legend: { options: ['OK', 'Not OK'], blocking: ['Not OK'] } } }
    const sub = { id: 's1', template_id: 't1', approval_status: 'acknowledged', answers: { f1: 'Not OK' }, submitted_at: '2026-11-10T08:00:00Z', acknowledged_name: 'Test Signer', acknowledged_at: '2026-11-11T08:00:00Z' }
    const openPack = buildAuditPack({ templates: [tpl], submissions: [sub], actions: [{ id: 'a1', source_id: 's1', source_detail: 'Brakes', status: 'Open' }], now: '2026-11-15T00:00:00Z' })
    expect(openPack.records[0]).toMatchObject({ approval: ACK_ACTION_REQUIRED, ack_open: 1, acknowledged_by: 'Test Signer' })
    expect(openPack.summary).toMatchObject({ acknowledged: 1, acknowledged_open: 1, pending: 0, approved: 0 })
    expect(openPack.findings.some((f) => /acknowledged with a fault still open/i.test(f.title))).toBe(true)
    expect(openPack.faults[0]).toMatchObject({ item: 'Brakes', has_action: true, action_status: 'Open' })
    const donePack = buildAuditPack({ templates: [tpl], submissions: [sub], actions: [{ id: 'a1', source_id: 's1', source_detail: 'Brakes', status: 'Closed' }], now: '2026-11-15T00:00:00Z' })
    expect(donePack.records[0]).toMatchObject({ approval: 'Acknowledged, faults resolved', ack_open: 0 })
    expect(donePack.summary.acknowledged_open).toBe(0)
    expect(approvalLabel('acknowledged')).toBe(ACK_ACTION_REQUIRED)
  })
})

