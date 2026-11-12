import { describe, it, expect } from 'vitest'
import {
  HANDOVER_STAGES, STAGE_SUPERVISOR, STAGE_INCHARGE,
  stageFor, roleCanSign, canActOnStage, canReject, closesInOneSign,
  nextStatusFor, approvalProgress, statusSummary, isFullyClosed, isRejected,
  normaliseRole,
} from '../lib/handoverApproval.js'

const atSupervisor = { approval_status: 'pending_supervisor' }
const atIncharge = { approval_status: 'pending_incharge' }
const closed = { approval_status: 'approved' }
const rejected = { approval_status: 'rejected' }
const draft = { approval_status: 'draft' }

describe('the two-stage ladder', () => {
  it('a sheet goes pending_supervisor -> pending_incharge -> approved', () => {
    // Fleet Supervisor signs the first rung -> waits for the incharge.
    expect(nextStatusFor(atSupervisor, true, { role: 'Fleet Supervisor' })).toBe('pending_incharge')
    // Fleet Incharge signs the second rung -> closed.
    expect(nextStatusFor(atIncharge, true, { role: 'Fleet Incharge' })).toBe('approved')
  })

  it('stageFor maps the status onto the rung', () => {
    expect(stageFor(atSupervisor)).toBe(STAGE_SUPERVISOR)
    expect(stageFor(atIncharge)).toBe(STAGE_INCHARGE)
    expect(stageFor(closed)).toBeNull()
    expect(stageFor(rejected)).toBeNull()
    expect(stageFor(draft)).toBeNull()
    expect(stageFor({})).toBeNull()
  })

  it('exposes exactly two rungs, supervisor then incharge', () => {
    expect(HANDOVER_STAGES.map((s) => s.key)).toEqual([STAGE_SUPERVISOR, STAGE_INCHARGE])
    expect(HANDOVER_STAGES[0].status).toBe('pending_supervisor')
    expect(HANDOVER_STAGES[1].status).toBe('pending_incharge')
  })
})

describe('who signs which rung (mirrors handover_can_sign_supervisor / _incharge)', () => {
  it('the supervisor rung = Fleet Supervisor, elevated (Admin/Manager/Director), Fleet Incharge, or super', () => {
    for (const role of ['Fleet Supervisor', 'Admin', 'Manager', 'Director', 'Fleet Incharge']) {
      expect(roleCanSign(STAGE_SUPERVISOR, role)).toBe(true)
    }
    expect(roleCanSign(STAGE_SUPERVISOR, 'Reporter', { isSuperAdmin: true })).toBe(true)
  })

  it('the incharge rung = Fleet Incharge or Admin (not Manager/Director), or super', () => {
    expect(roleCanSign(STAGE_INCHARGE, 'Fleet Incharge')).toBe(true)
    expect(roleCanSign(STAGE_INCHARGE, 'Admin')).toBe(true)
    expect(roleCanSign(STAGE_INCHARGE, 'Manager')).toBe(false)
    expect(roleCanSign(STAGE_INCHARGE, 'Director')).toBe(false)
    expect(roleCanSign(STAGE_INCHARGE, 'Fleet Supervisor')).toBe(false)
    expect(roleCanSign(STAGE_INCHARGE, 'Reporter', { isSuperAdmin: true })).toBe(true)
  })

  it('a plain non-signer can act at NEITHER stage', () => {
    for (const role of ['Reporter', 'Tyre Man', 'Driver']) {
      expect(canActOnStage(atSupervisor, { role })).toBe(false)
      expect(canActOnStage(atIncharge, { role })).toBe(false)
      expect(roleCanSign(STAGE_SUPERVISOR, role)).toBe(false)
      expect(roleCanSign(STAGE_INCHARGE, role)).toBe(false)
    }
  })

  it('role matching is case- and spacing-insensitive', () => {
    expect(roleCanSign(STAGE_INCHARGE, 'fleet_incharge')).toBe(true)
    expect(roleCanSign(STAGE_SUPERVISOR, '  fleet-supervisor ')).toBe(true)
    expect(normaliseRole('Fleet Incharge')).toBe('fleet_incharge')
  })
})

describe('closes in one sign (mirrors v_both)', () => {
  it('an incharge-signer at the supervisor rung closes the whole sheet at once', () => {
    for (const role of ['Admin', 'Fleet Incharge']) {
      expect(closesInOneSign(atSupervisor, { role })).toBe(true)
      expect(nextStatusFor(atSupervisor, true, { role })).toBe('approved')
    }
    expect(closesInOneSign(atSupervisor, { role: 'Reporter', isSuperAdmin: true })).toBe(true)
    expect(nextStatusFor(atSupervisor, true, { role: 'Reporter', isSuperAdmin: true })).toBe('approved')
  })

  it('a Fleet Supervisor / Manager / Director does NOT close in one - they advance', () => {
    for (const role of ['Fleet Supervisor', 'Manager', 'Director']) {
      expect(closesInOneSign(atSupervisor, { role })).toBe(false)
      expect(nextStatusFor(atSupervisor, true, { role })).toBe('pending_incharge')
    }
  })

  it('close-in-one only applies at the supervisor rung, never the incharge rung', () => {
    expect(closesInOneSign(atIncharge, { role: 'Admin' })).toBe(false)
    expect(closesInOneSign(atIncharge, { role: 'Fleet Incharge' })).toBe(false)
  })
})

describe('canActOnStage / canReject', () => {
  it('a Fleet Supervisor can act on the supervisor rung but not approve the incharge rung', () => {
    expect(canActOnStage(atSupervisor, { role: 'Fleet Supervisor' })).toBe(true)
    expect(canActOnStage(atIncharge, { role: 'Fleet Supervisor' })).toBe(false)
  })

  it('a Fleet Incharge can act on both rungs (close-in-one on the first)', () => {
    expect(canActOnStage(atSupervisor, { role: 'Fleet Incharge' })).toBe(true)
    expect(canActOnStage(atIncharge, { role: 'Fleet Incharge' })).toBe(true)
  })

  it('nobody can act on a closed or rejected sheet', () => {
    expect(canActOnStage(closed, { role: 'Admin', isSuperAdmin: true })).toBe(false)
    expect(canActOnStage(rejected, { role: 'Admin', isSuperAdmin: true })).toBe(false)
  })

  it('a supervisor-signer may reject at either pending stage (wider than approve)', () => {
    expect(canReject(atSupervisor, { role: 'Fleet Supervisor' })).toBe(true)
    expect(canReject(atIncharge, { role: 'Fleet Supervisor' })).toBe(true)
    expect(canReject(atSupervisor, { role: 'Reporter' })).toBe(false)
    expect(canReject(closed, { role: 'Admin', isSuperAdmin: true })).toBe(false)
  })
})

describe('rejection', () => {
  it('a decision of not-approved always goes to rejected, from any stage', () => {
    expect(nextStatusFor(atSupervisor, false, { role: 'Fleet Supervisor' })).toBe('rejected')
    expect(nextStatusFor(atIncharge, false, { role: 'Fleet Incharge' })).toBe('rejected')
    expect(isRejected(rejected)).toBe(true)
    expect(isRejected(closed)).toBe(false)
  })
})

describe('approvalProgress', () => {
  it('reports each rung: who, signature, when, done, current', () => {
    const row = {
      approval_status: 'pending_incharge',
      supervisor_name: 'Ajay', supervisor_signature: 'sig1', supervisor_at: '2026-11-12T00:00:00Z',
      incharge_name: null, incharge_signature: null, incharge_at: null,
    }
    const [sup, inch] = approvalProgress(row)
    expect(sup.key).toBe(STAGE_SUPERVISOR)
    expect(sup.name).toBe('Ajay')
    expect(sup.signature).toBe('sig1')
    expect(sup.done).toBe(true)
    expect(sup.current).toBe(false)
    expect(inch.key).toBe(STAGE_INCHARGE)
    expect(inch.done).toBe(false)
    expect(inch.current).toBe(true)
  })

  it('both rungs are done once approved', () => {
    const row = { approval_status: 'approved', supervisor_at: 't', incharge_at: 't2' }
    const [sup, inch] = approvalProgress(row)
    expect(sup.done).toBe(true)
    expect(inch.done).toBe(true)
    expect(sup.current).toBe(false)
    expect(inch.current).toBe(false)
  })
})

describe('statusSummary / isFullyClosed', () => {
  it('names who is holding the sheet rather than "pending"', () => {
    expect(statusSummary(atSupervisor)).toEqual({ tone: 'warn', text: 'Waiting for a supervisor' })
    expect(statusSummary(atIncharge)).toEqual({ tone: 'warn', text: 'Waiting for the fleet incharge' })
    expect(statusSummary(closed)).toEqual({ tone: 'good', text: 'Closed' })
    expect(statusSummary(rejected)).toEqual({ tone: 'bad', text: 'Sent back' })
    expect(statusSummary(draft)).toEqual({ tone: 'muted', text: 'Draft' })
  })

  it('isFullyClosed is true only when approved', () => {
    expect(isFullyClosed(closed)).toBe(true)
    expect(isFullyClosed(atIncharge)).toBe(false)
    expect(isFullyClosed(rejected)).toBe(false)
  })
})
