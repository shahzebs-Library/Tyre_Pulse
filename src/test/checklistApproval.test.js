import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  APPROVAL_STAGES, STAGE_SUPERVISOR, STAGE_AREA_MANAGER,
  isTwoStage, stageFor, nextStatusFor, canActOnStage, canDecide,
  approvalProgress, isFullyClosed, statusSummary, normaliseRole,
} from '../lib/checklist/checklistApproval'

const TWO = { require_area_manager: true }
const ONE = { require_area_manager: false }

describe('the ladder', () => {
  it('a two-stage sheet goes pending -> waiting for the area manager -> closed', () => {
    // This is the whole point of V594. Before it, one signature closed a sheet.
    const s0 = { approval_status: 'pending' }
    expect(stageFor(TWO, s0)).toBe(STAGE_SUPERVISOR)
    expect(nextStatusFor(TWO, s0, true)).toBe('pending_area_manager')

    const s1 = { approval_status: 'pending_area_manager', supervisor_signature: '<svg/>' }
    expect(stageFor(TWO, s1)).toBe(STAGE_AREA_MANAGER)
    expect(nextStatusFor(TWO, s1, true)).toBe('approved')
  })

  it('a single-stage sheet still closes on one approval', () => {
    // The other four live templates must be untouched by this.
    expect(nextStatusFor(ONE, { approval_status: 'pending' }, true)).toBe('approved')
    expect(stageFor(ONE, { approval_status: 'pending_area_manager' })).toBe(STAGE_AREA_MANAGER)
  })

  it('a rejection is available at either rung', () => {
    expect(nextStatusFor(TWO, { approval_status: 'pending' }, false)).toBe('rejected')
    expect(nextStatusFor(TWO, { approval_status: 'pending_area_manager' }, false)).toBe('rejected')
  })

  it('a finished sheet offers no stage at all', () => {
    for (const st of ['approved', 'rejected', 'not_required', '']) {
      expect(stageFor(TWO, { approval_status: st })).toBeNull()
      expect(canDecide(TWO, { approval_status: st }, 'Admin')).toBe(false)
    }
  })
})

describe('who may act', () => {
  it('a Manager signs NOTHING - V600 took them off both rungs', () => {
    // BEHAVIOUR CHANGE, not a weakened test. Until V600 a Manager could sign the
    // supervisor rung. The owner's instruction was that the area manager or the
    // PMV manager signs, so Manager came off - on the server too, proven live by
    // impersonation against a real pending record.
    expect(canActOnStage(STAGE_SUPERVISOR, 'Manager')).toBe(false)
    expect(canActOnStage(STAGE_AREA_MANAGER, 'Manager')).toBe(false)
  })

  it('the trades supervisors sign the first rung', () => {
    for (const role of ['Maintenance Supervisor', 'Workshop Supervisor']) {
      expect(canActOnStage(STAGE_SUPERVISOR, role)).toBe(true)
      // ...and cannot close their own sheet. Two rungs or it is one signature
      // wearing two names.
      expect(canActOnStage(STAGE_AREA_MANAGER, role)).toBe(false)
    }
  })

  it('the PMV manager signs, which is who the owner named', () => {
    expect(canActOnStage(STAGE_SUPERVISOR, 'PMV Manager')).toBe(true)
    expect(canActOnStage(STAGE_AREA_MANAGER, 'PMV Manager')).toBe(true)
  })

  it('the area manager can close it', () => {
    expect(canActOnStage(STAGE_AREA_MANAGER, 'Workshop Maintenance Area Manager')).toBe(true)
  })

  it('Admin and Director can close too, deliberately', () => {
    // Exactly ONE person holds an area-manager role today. A queue only they can
    // clear jams the moment they take leave.
    expect(canActOnStage(STAGE_AREA_MANAGER, 'Admin')).toBe(true)
    expect(canActOnStage(STAGE_AREA_MANAGER, 'Director')).toBe(true)
  })

  it('a trade or a driver cannot sign off their own sheet', () => {
    for (const r of ['Mechanic', 'Electrician', 'Driver', 'Tyre Man', 'Reporter']) {
      expect(canActOnStage(STAGE_SUPERVISOR, r)).toBe(false)
      expect(canActOnStage(STAGE_AREA_MANAGER, r)).toBe(false)
    }
  })

  it('a tyre data collector can sign the supervisor rung but not the area manager rung', () => {
    expect(canActOnStage(STAGE_SUPERVISOR, 'Tyre Data Collector')).toBe(true)
    expect(canActOnStage(STAGE_AREA_MANAGER, 'Tyre Data Collector')).toBe(false)
  })

  it('matches the DB Title Case against the app lowercase role', () => {
    // profiles.role is 'Maintenance Supervisor'; the app carries
    // 'maintenance_supervisor'. A raw compare matches nobody, which is how a
    // gate silently locks out the exact person it was written for.
    expect(normaliseRole('Maintenance Supervisor')).toBe('maintenance_supervisor')
    expect(canActOnStage(STAGE_SUPERVISOR, 'maintenance_supervisor')).toBe(true)
    expect(canActOnStage(STAGE_AREA_MANAGER, 'workshop-maintenance-area-manager')).toBe(true)
  })

  it('a super admin is never locked out', () => {
    expect(canActOnStage(STAGE_AREA_MANAGER, 'Reporter', { isSuperAdmin: true })).toBe(true)
  })

  it('a loading profile grants nothing', () => {
    expect(canActOnStage(STAGE_SUPERVISOR, null)).toBe(false)
    expect(canActOnStage(null, 'Admin')).toBe(false)
  })
})

describe('what the reader is shown', () => {
  it('says WHO is holding it, not just "pending"', () => {
    expect(statusSummary(TWO, { approval_status: 'pending' }).text).toMatch(/supervisor/i)
    expect(statusSummary(TWO, { approval_status: 'pending_area_manager' }).text).toMatch(/area manager/i)
    expect(statusSummary(TWO, { approval_status: 'approved' }).text).toBe('Closed')
    expect(statusSummary(ONE, { approval_status: 'pending' }).text).toBe('Waiting for approval')
  })

  it('the ladder carries each signature so it can be opened and looked at', () => {
    const rows = approvalProgress(TWO, {
      approval_status: 'pending_area_manager',
      supervisor_name: 'A. Khan', supervisor_signature: '<svg/>', supervisor_at: '2026-08-18T09:00:00Z',
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ done: true, name: 'A. Khan', signature: '<svg/>' })
    expect(rows[1]).toMatchObject({ done: false, current: true, name: null })
  })

  it('a single-stage sheet shows ONE rung, filled from the approver columns', () => {
    const rows = approvalProgress(ONE, {
      approval_status: 'approved', approver_name: 'M. Ali', approver_signature: '<svg/>', approved_at: 'x',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ done: true, name: 'M. Ali' })
  })

  it('closed means CLOSED, not "a supervisor looked at it"', () => {
    expect(isFullyClosed({ approval_status: 'pending_area_manager' })).toBe(false)
    expect(isFullyClosed({ approval_status: 'approved' })).toBe(true)
  })
})

describe('the mobile mirror does not drift', () => {
  const web = readFileSync(resolve(__dirname, '../lib/checklist/checklistApproval.js'), 'utf8')
  const mob = readFileSync(resolve(__dirname, '../../mobile/lib/checklistApproval.ts'), 'utf8')

  it('exports the same decisions on both stacks', () => {
    const fns = (s) => [...s.matchAll(/export function (\w+)/g)].map((x) => x[1]).sort()
    expect(fns(mob)).toEqual(fns(web))
  })

  it('grants each stage to the same roles on both stacks', () => {
    // A role list that drifts is how a phone offers a button the server refuses.
    const roles = (s) => [...s.matchAll(/roles: \[([^\]]+)\]/g)].map((m) =>
      m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean).sort().join('|'))
    const w = roles(web)
    expect(w).toHaveLength(2)
    expect(roles(mob)).toEqual(w)
  })

  it('the role lists match the SQL helpers they mirror', () => {
    // checklist_is_supervisor / checklist_is_area_manager. V594 created them;
    // a later migration may REPLACE one, and the live database runs whichever
    // ran last - so read the migrations in order and keep the LAST definition
    // of each. Pinning V594 alone would quietly compare against a body the
    // database no longer has, which is worse than not checking at all.
    const sql = ['MIGRATIONS_V594_CHECKLIST_TWO_STAGE_APPROVAL.sql',
                 'MIGRATIONS_V599_WORKSHOP_SUPERVISOR.sql',
                 'MIGRATIONS_V600_WHO_SIGNS.sql',
                 'MIGRATIONS_V604_CHECKLIST_DATA_COLLECTOR_APPROVAL.sql']
      .map((f) => readFileSync(resolve(__dirname, '../..', f), 'utf8'))
      .join('\n')
    const sqlRoles = (fn) => {
      // Anchor on the DEFINITION, not the bare name: every one of these files
      // ends with a rollback comment containing `drop function public.<fn>()`,
      // and a last-match on the name lands there instead - then reads the next
      // array it finds, which belongs to a different function entirely.
      const body = sql.slice(sql.lastIndexOf(`create or replace function public.${fn}()`))
      const open = body.indexOf('array[')
      const arr = body.slice(open + 'array['.length, body.indexOf(']', open))
      return [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    }
    const sup = APPROVAL_STAGES.find((s) => s.key === STAGE_SUPERVISOR).roles.slice().sort()
    const area = APPROVAL_STAGES.find((s) => s.key === STAGE_AREA_MANAGER).roles.slice().sort()
    expect(sqlRoles('checklist_is_supervisor')).toEqual(sup)
    expect(sqlRoles('checklist_is_area_manager')).toEqual(area)
  })
})
