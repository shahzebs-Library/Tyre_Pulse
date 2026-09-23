import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { INSPECTION_SIGNER_ROLES, canSignInspection } from '../lib/inspectionApproval'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...p) => readFileSync(join(SRC, ...p), 'utf8').replace(/\r\n/g, '\n')

/**
 * The predicate is a MIRROR of the role list inside `decide_inspection_approval`
 * (V600, widened by V606). These tests read that migration's own text, so the
 * two cannot drift silently: widen one side and this fails until both agree.
 */
const RPC_SQL = read('..', 'MIGRATIONS_V606_CHECKLIST_DATA_COLLECTOR_APPROVAL.sql')

/** The `v_role NOT IN (...)` list guarding decide_inspection_approval. */
function rolesInRpc() {
  const body = RPC_SQL.slice(RPC_SQL.indexOf('decide_inspection_approval'))
  const list = body.match(/v_role NOT IN \(([\s\S]*?)\)\)/)
  if (!list) throw new Error('Could not find the role guard in the V606 migration.')
  return list[1].match(/'([^']+)'/g).map(s => s.slice(1, -1))
}

describe('who may sign off a tyre inspection', () => {
  it('matches the RPC role list exactly, in both directions', () => {
    expect([...INSPECTION_SIGNER_ROLES].sort()).toEqual(rolesInRpc().sort())
  })

  it('admits every role the database accepts', () => {
    for (const role of rolesInRpc()) {
      expect(canSignInspection(role)).toBe(true)
    }
  })

  // These four read as plausible approvers and are refused by the RPC. Offering
  // any of them a sign-off control is the defect this module closed: the person
  // signs, and the refusal is the first they hear of it.
  it.each(['Manager', 'Director', 'Maintenance Supervisor', 'Inspector'])(
    'refuses %s, whom the RPC rejects',
    (role) => {
      expect(rolesInRpc()).not.toContain(role)
      expect(canSignInspection(role)).toBe(false)
    },
  )

  it('lets a super admin sign whatever their role says', () => {
    expect(canSignInspection('Reporter', { isSuperAdmin: true })).toBe(true)
    expect(canSignInspection(null, { isSuperAdmin: true })).toBe(true)
  })

  it('refuses a missing or unknown role rather than failing open', () => {
    for (const role of [null, undefined, '', 'Nonsense Role', 'admin']) {
      expect(canSignInspection(role)).toBe(false)
    }
  })

  // A capability grant cannot open this: the RPC is a bare role test with an
  // is_super_admin() escape and never consults app_user_can.
  it('does not consult a capability grant', () => {
    expect(RPC_SQL).not.toMatch(/app_user_can/)
    expect(canSignInspection('Reporter', { hasCapability: () => true })).toBe(false)
  })
})

describe('the screens that decide an inspection', () => {
  // Both screens used to carry their own role list; each was wrong in both
  // directions. They must ask the shared predicate instead.
  it.each([
    ['Approvals.jsx', 'the approvals queue'],
    ['Inspections.jsx', 'the inspections register'],
  ])('%s asks the shared predicate', (file) => {
    const src = read('pages', file)
    expect(src).toMatch(/canSignInspection/)
    expect(src).toMatch(/from '\.\.\/lib\/inspectionApproval'/)
  })

  it('no longer gates an inspection sign-off on the Admin/Manager/Director set', () => {
    const src = read('pages', 'Approvals.jsx')
    // MANAGER_ROLES still governs the other bulk-approvable sources; what must
    // not come back is an inspection decision resolved through it.
    expect(src).not.toMatch(/mayAct\s*=\s*isChecklistish\s*\?\s*mayDecideChecklist\s*:\s*canAct/)
  })
})
