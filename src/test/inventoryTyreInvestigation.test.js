import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  investigationActions, canManageInvestigation, investigatorCandidates, TYRE_INVESTIGATOR_ROLES,
} from '../lib/inventory/tyreInventoryView'

const base = { status: 'open', investigation_status: 'open', investigation_notes: [], i_am_investigator: false }
const mgr = { role: 'Manager' }
const pmv = { role: 'PMV Manager' }
const eng = { role: 'Tire Planning Engineer' }

describe('tyre investigation actions (mirror of 20261120114000)', () => {
  it('only Admin / Manager / Director / PMV Manager / super admin manage a case', () => {
    expect(canManageInvestigation(mgr)).toBe(true)
    expect(canManageInvestigation({ role: 'Admin' })).toBe(true)
    expect(canManageInvestigation({ role: 'Director' })).toBe(true)
    expect(canManageInvestigation(pmv)).toBe(true)
    expect(canManageInvestigation({ role: 'Store Keeper', isSuperAdmin: true })).toBe(true)
    expect(canManageInvestigation({ role: 'Store Keeper' })).toBe(false)
    expect(canManageInvestigation(eng)).toBe(false)
    // server compares get_my_role() = 'PMV Manager' exactly
    expect(canManageInvestigation({ role: 'pmv manager' })).toBe(false)
  })

  it('an open case offers assign to a manager only', () => {
    expect(investigationActions(base, mgr)).toMatchObject({ assign: true, investigate: false, propose: false, close: false })
    expect(investigationActions(base, eng).assign).toBe(false)
  })

  it('findings and proposals belong to the assigned investigator only', () => {
    const row = { ...base, investigation_status: 'investigating', i_am_investigator: true }
    expect(investigationActions(row, eng)).toMatchObject({ investigate: true, propose: false })
    expect(investigationActions({ ...row, i_am_investigator: false }, mgr)).toMatchObject({ investigate: false, propose: false, assign: true })
  })

  it('the assign note does not unlock a proposal; a finding does', () => {
    const row = { ...base, investigation_status: 'investigating', i_am_investigator: true,
      investigation_notes: [{ kind: 'assigned', note: 'go' }] }
    expect(investigationActions(row, eng).propose).toBe(false)
    row.investigation_notes.push({ kind: 'finding', note: 'checked' })
    expect(investigationActions(row, eng).propose).toBe(true)
  })

  it('a proposed case waits for approval; nobody acts on it here', () => {
    const row = { ...base, investigation_status: 'proposed', i_am_investigator: true, investigation_notes: [{ kind: 'finding' }] }
    expect(investigationActions(row, eng)).toEqual({ assign: false, investigate: false, propose: false, close: false, waitingApproval: true })
    expect(investigationActions(row, mgr).assign).toBe(false)
  })

  it('a rejected proposal goes back to the investigator and can be reassigned', () => {
    const row = { ...base, investigation_status: 'rejected', i_am_investigator: true, investigation_notes: [{ kind: 'finding' }] }
    expect(investigationActions(row, eng)).toMatchObject({ investigate: true, propose: true })
    expect(investigationActions({ ...row, i_am_investigator: false }, pmv).assign).toBe(true)
  })

  it('only an approved case closes, and only by a manager', () => {
    const row = { ...base, investigation_status: 'approved' }
    expect(investigationActions(row, pmv).close).toBe(true)
    expect(investigationActions(row, eng).close).toBe(false)
  })

  it('a closed or resolved case offers nothing', () => {
    expect(investigationActions({ ...base, status: 'resolved', investigation_status: 'closed' }, mgr))
      .toEqual({ assign: false, investigate: false, propose: false, close: false, waitingApproval: false })
    expect(investigationActions(null, mgr).assign).toBe(false)
  })

  it('investigator candidates are the server role list', () => {
    const people = [{ id: 1, role: 'Tire Planning Engineer' }, { id: 2, role: 'Store Keeper' }, { id: 3, role: 'PMV Manager' }]
    expect(investigatorCandidates(people).map((p) => p.id)).toEqual([1])
  })

  it('role list mirrors inv_tyre_investigator_roles()', () => {
    const sql = readFileSync('supabase/migrations/20261120114000_inv_tyre_conflict_investigation.sql', 'utf8')
    const m = sql.match(/inv_tyre_investigator_roles\(\)[\s\S]*?select array\[([^\]]+)\]/)
    const roles = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))
    expect(roles).toEqual(TYRE_INVESTIGATOR_ROLES)
  })
})
