/**
 * SHIP BEFORE MIGRATE. The web is deployed while the three closure drafts
 * (20261116100000, 101000, 102000) are NOT applied. PostgREST then answers:
 *   PGRST202  function not found          42883  function does not exist
 *   42703     column does not exist       PGRST204  column not in schema cache
 *   PGRST205 / 42P01  table or view not found
 * Every service function this branch added or changed must turn those into
 * "not available yet": never a thrown raw error on a read, never a silent save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

import * as svc from '../lib/api/closureReview'
import { isChecklistPathAllowed, isChecklistOnlyRole } from '../lib/checklistAccess'
import { isCommandVisible } from '../lib/commandSearch'

function builder(result) {
  const b = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range']) b[m] = () => b
  b.maybeSingle = () => Promise.resolve(result)
  b.then = (ok, bad) => Promise.resolve(result).then(ok, bad)
  return b
}

const MISSING_FN = [
  { code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' },
  { code: '42883', message: 'function public.x() does not exist' },
]
const MISSING_COL = [
  { code: '42703', message: 'column corrective_actions.review_status does not exist' },
  { code: 'PGRST204', message: "Could not find the 'review_status' column of 'corrective_actions' in the schema cache" },
]
const MISSING_REL = [
  { code: 'PGRST205', message: "Could not find the table 'public.corrective_action_review_events' in the schema cache" },
  { code: '42P01', message: 'relation "public.checklist_decision_events" does not exist' },
]
const NOT_ON = 'Closure review is not switched on for this system yet.'

beforeEach(() => { h.rpc.mockReset(); h.from.mockReset() })

describe('reads degrade when the drafts are not applied', () => {
  for (const error of MISSING_FN) {
    it(`RPC reads report not provisioned (${error.code})`, async () => {
      h.rpc.mockResolvedValue({ data: null, error })
      const cfg = await svc.getClosureReviewConfig()
      expect(cfg.provisioned).toBe(false)
      expect(cfg.config).toBeTruthy()
      const access = await svc.getActionReviewAccess('a1')
      expect(access).toMatchObject({ provisioned: false, canSubmit: false, canReview: false })
    })
  }
  for (const error of MISSING_COL) {
    it(`column reads report not provisioned (${error.code})`, async () => {
      h.from.mockImplementation(() => builder({ data: null, error }))
      expect(await svc.getActionReview('a1')).toEqual({ provisioned: false, review: null })
      expect(await svc.listReviewQueue({ country: 'KSA' })).toEqual({ provisioned: false, rows: [] })
      expect(await svc.getAcknowledgement('s1')).toBeNull()
    })
    it(`sheet actions fall back to today's columns (${error.code})`, async () => {
      h.from.mockReturnValueOnce(builder({ data: null, error }))
        .mockReturnValueOnce(builder({ data: [{ id: 1, status: 'Open' }], error: null }))
      expect(await svc.listSheetActions('s1')).toEqual({ provisioned: false, actions: [{ id: 1, status: 'Open' }] })
    })
  }
  for (const error of MISSING_REL) {
    it(`history reads are empty (${error.code})`, async () => {
      h.from.mockImplementation(() => builder({ data: null, error }))
      expect(await svc.listActionReviewEvents('a1')).toEqual([])
      expect(await svc.listChecklistDecisionEvents('s1')).toEqual([])
    })
    it(`an acknowledged list is returned as given when the compliance view is missing (${error.code})`, async () => {
      h.from.mockImplementation(() => builder({ data: null, error }))
      const rows = [{ id: 's1', approval_status: 'acknowledged' }]
      expect(await svc.attachAckFaultStates(rows)).toBe(rows)
    })
  }
  it('lists with no acknowledged sheet (every sheet today) cost no extra request', async () => {
    const rows = [{ id: 's1', approval_status: 'pending' }, { id: 's2', approval_status: 'approved' }, { id: 's3', approval_status: 'rejected' }]
    expect(await svc.attachAckFaultStates(rows)).toBe(rows)
    expect(h.from).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe('writes never pretend to save when the drafts are not applied', () => {
  const writes = [
    ['saveClosureReviewConfig', () => svc.saveClosureReviewConfig({ ca_min_photos: 1 })],
    ['recordProgress', () => svc.recordProgress('a1', 'Half done')],
    ['submitCompletion', () => svc.submitCompletion('a1', { note: 'Tyre replaced' })],
    ['reviewAction', () => svc.reviewAction('a1', 'approve')],
    ['requestException', () => svc.requestException('a1', 'Vehicle sold in December')],
    ['decideException', () => svc.decideException('a1', 'approve')],
    ['acknowledgeChecklist', () => svc.acknowledgeChecklist('s1', { signature: 'sig' })],
  ]
  for (const error of MISSING_FN) {
    for (const [name, run] of writes) {
      it(`${name} says plainly it is not switched on (${error.code})`, async () => {
        h.rpc.mockResolvedValue({ data: null, error })
        const err = await run().catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe(NOT_ON)
        expect(err.message).not.toMatch(/schema cache|does not exist|public\./)
        expect(h.from).not.toHaveBeenCalled()
      })
    }
  }
})

describe('supervisors and the corrective actions screen before the module row exists', () => {
  const none = () => false
  const on = (k) => k === 'corrective_actions'
  it('the path is closed without the module row and open with it', () => {
    expect(isChecklistOnlyRole('Workshop Supervisor')).toBe(true)
    expect(isChecklistPathAllowed('/actions', none)).toBe(false)
    expect(isChecklistPathAllowed('/actions')).toBe(false)
    expect(isChecklistPathAllowed('/actions', on)).toBe(true)
  })
  it('the command search follows the same rule', () => {
    const cmd = { path: '/actions' }
    for (const role of ['Workshop Supervisor', 'Maintenance Supervisor']) {
      expect(isCommandVisible(cmd, { role }, none, new Set(), false)).toBe(false)
      expect(isCommandVisible(cmd, { role }, on, new Set(), false)).toBe(true)
    }
  })
  it('every checklist page a supervisor has today is still reachable', () => {
    for (const p of ['/checklists', '/approvals', '/profile', '/my-problems', '/request-access']) {
      expect(isChecklistPathAllowed(p, none)).toBe(true)
    }
  })
})
