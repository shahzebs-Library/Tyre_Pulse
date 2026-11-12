import { describe, it, expect } from 'vitest'
import { WRITE_RULES, resolveWriteAccess, writeRefusalReason, normRole } from '../lib/writeAccessRules'

// Every row below was read from pg_policies on the live database on 2026-11-12.
// If a policy changes, change WRITE_RULES and this table in the same pull request.
const LIVE_POLICIES = {
  work_orders: { capability: 'work_orders', create: [], edit: [] },
  vehicle_fleet: { capability: 'fleet_master', create: [], edit: [] },
  budgets: { capability: 'budgets', create: ['admin'], edit: ['admin'] },
  tyre_records: { capability: 'tyre_records', create: ['admin', 'manager', 'inspector', 'tyre_man'], edit: ['admin', 'manager'] },
  inspections: { capability: 'inspections', create: ['admin', 'manager', 'inspector', 'tyre_man'], edit: ['admin', 'manager', 'inspector'] },
  corrective_actions: { capability: 'corrective_actions', create: ['reporter', 'manager', 'admin'], edit: ['manager', 'admin'] },
  sites: { capability: null, create: ['admin', 'manager'], edit: ['admin', 'manager'] },
  kpi_targets: { capability: null, create: ['manager', 'admin'], edit: ['manager', 'admin'] },
}

describe('writeAccessRules mirrors the live write policies', () => {
  it('pins every table rule', () => {
    expect(WRITE_RULES).toEqual(LIVE_POLICIES)
  })

  it('normalises a role the way the database does', () => {
    expect(normRole('Tyre Man')).toBe('tyre_man')
    expect(normRole(' Manager ')).toBe('manager')
    expect(normRole(null)).toBe('')
  })
})

describe('resolveWriteAccess', () => {
  const no = { create: false, edit: false }
  const yes = { create: true, edit: true }

  it('a Manager cannot write the fleet register or budgets unless the server says so (MODA-8, MODC-04)', () => {
    for (const table of ['vehicle_fleet', 'budgets', 'work_orders']) {
      expect(resolveWriteAccess(table, { role: 'Manager', serverCaps: no })).toMatchObject({ create: false, edit: false, delete: false, known: true })
      expect(resolveWriteAccess(table, { role: 'Manager', serverCaps: yes })).toMatchObject({ create: true, edit: true, delete: false })
    }
  })

  it('a Director has no built-in write on the fleet register, budgets or sites', () => {
    expect(resolveWriteAccess('vehicle_fleet', { role: 'Director', serverCaps: no })).toMatchObject({ create: false, edit: false })
    expect(resolveWriteAccess('budgets', { role: 'Director', serverCaps: no })).toMatchObject({ create: false, edit: false })
    expect(resolveWriteAccess('sites', { role: 'Director' })).toMatchObject({ create: false, edit: false, delete: false, known: true })
  })

  it('sites and KPI targets follow their role policies with no server call', () => {
    expect(resolveWriteAccess('sites', { role: 'Manager' })).toMatchObject({ create: true, edit: true, delete: false, known: true })
    expect(resolveWriteAccess('sites', { role: 'Inspector' })).toMatchObject({ create: false, edit: false })
    expect(resolveWriteAccess('kpi_targets', { role: 'Manager' })).toMatchObject({ edit: true })
    expect(resolveWriteAccess('kpi_targets', { role: 'Director' })).toMatchObject({ edit: false })
    expect(resolveWriteAccess('kpi_targets', { role: 'Reporter' })).toMatchObject({ create: false, edit: false })
  })

  it('tyre records: Inspector and Tyre Man may add but not edit (MODA-7)', () => {
    for (const role of ['Inspector', 'Tyre Man']) {
      expect(resolveWriteAccess('tyre_records', { role, serverCaps: no })).toMatchObject({ create: true, edit: false, delete: false })
    }
    expect(resolveWriteAccess('tyre_records', { role: 'Manager', serverCaps: no })).toMatchObject({ create: true, edit: true, delete: false })
    expect(resolveWriteAccess('tyre_records', { role: 'Reporter', serverCaps: no })).toMatchObject({ create: false, edit: false })
    // A capability granted in Access Control opens it for a role with no role policy.
    expect(resolveWriteAccess('tyre_records', { role: 'Tyre Data Collector', serverCaps: yes })).toMatchObject({ create: true, edit: true })
  })

  it('corrective actions and inspections: who may change them (MODB-7)', () => {
    expect(resolveWriteAccess('corrective_actions', { role: 'Director', serverCaps: no })).toMatchObject({ create: false, edit: false })
    expect(resolveWriteAccess('corrective_actions', { role: 'Reporter', serverCaps: no })).toMatchObject({ create: true, edit: false })
    expect(resolveWriteAccess('corrective_actions', { role: 'Workshop Supervisor', serverCaps: no })).toMatchObject({ create: false, edit: false })
    expect(resolveWriteAccess('inspections', { role: 'Tyre Man', serverCaps: no })).toMatchObject({ create: true, edit: false })
    expect(resolveWriteAccess('inspections', { role: 'Inspector', serverCaps: no })).toMatchObject({ create: true, edit: true })
  })

  it('Admin and super admin always write and are the only ones who delete', () => {
    for (const table of Object.keys(WRITE_RULES)) {
      expect(resolveWriteAccess(table, { role: 'Admin' })).toMatchObject({ create: true, edit: true, delete: true, known: true })
      expect(resolveWriteAccess(table, { role: 'Manager', serverCaps: yes }).delete).toBe(false)
    }
    expect(resolveWriteAccess('vehicle_fleet', { role: 'Manager', isSuperAdmin: true })).toMatchObject({ create: true, edit: true, delete: true })
  })

  it('never hides a control on a guess: an unread server answer leaves it enabled and says so', () => {
    const unknown = resolveWriteAccess('vehicle_fleet', { role: 'Manager', serverCaps: null })
    expect(unknown).toMatchObject({ create: true, edit: true, known: false })
    const half = resolveWriteAccess('budgets', { role: 'Manager', serverCaps: { create: null, edit: false } })
    expect(half).toMatchObject({ create: true, edit: false, known: false })
  })

  it('an unknown table is not policed here', () => {
    expect(resolveWriteAccess('nope', { role: 'Reporter' })).toMatchObject({ create: true, edit: true, known: false })
  })
})

describe('writeRefusalReason', () => {
  it('says who is allowed, in plain words, with no dashes', () => {
    const all = Object.keys(WRITE_RULES).flatMap((t) => ['create', 'edit', 'delete'].map((c) => writeRefusalReason(t, c)))
    for (const text of all) {
      expect(text.length).toBeGreaterThan(10)
      expect(text).not.toMatch(/[\u2013\u2014]/)
    }
    expect(writeRefusalReason('sites', 'edit')).toBe('Only Admin or Manager can change this.')
    expect(writeRefusalReason('vehicle_fleet', 'create')).toMatch(/^Only an Admin can add this\. An Admin can give your role or your account this right in Access Control\.$/)
    expect(writeRefusalReason('tyre_records', 'edit')).toMatch(/^Admin and Manager can change this\./)
    expect(writeRefusalReason('budgets', 'delete')).toBe('Only an Admin can delete this record.')
  })
})
