import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The SAVE PAYLOAD is what these tests pin.
 *
 * `checklist_templates.assignee_roles` is nullable and NULL means "for every
 * role" - which is the state all six pre-V591 templates are in. So writing []
 * instead of NULL is not cosmetic: it changes an untargeted checklist into one
 * that reads as deliberately narrowed to nobody. That distinction is the whole
 * back-compat story, so it is asserted on the exact object handed to PostgREST,
 * not on a helper's return value.
 */

const h = vi.hoisted(() => {
  const state = { result: { data: { id: 't1' }, error: null }, last: null }
  function from(table) {
    const calls = { eq: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols) { calls.select = cols; return b },
      order() { return b },
      limit() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or = e; return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, storage: { from: () => ({}) } } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const cl = await import('../lib/api/checklists')

beforeEach(() => {
  h.state.result = { data: { id: 't1' }, error: null }
  h.state.last = null
})

describe('assignee_roles save payload', () => {
  it('createTemplate writes NULL, not [], when no role is selected', async () => {
    await cl.createTemplate({ name: 'Daily check', fields: [], assignee_roles: [] })
    expect(h.state.last._calls.insert.assignee_roles).toBeNull()
  })

  it('createTemplate writes NULL when the builder never sent the key at all', async () => {
    await cl.createTemplate({ name: 'Daily check', fields: [] })
    expect(h.state.last._calls.insert).toHaveProperty('assignee_roles', null)
  })

  it('createTemplate writes the two chosen roles verbatim, in order', async () => {
    await cl.createTemplate({
      name: 'Workshop sheet', fields: [], assignee_roles: ['Mechanic', 'Electrician'],
    })
    expect(h.state.last._calls.insert.assignee_roles).toEqual(['Mechanic', 'Electrician'])
  })

  it('updateTemplate normalises the array it is given', async () => {
    await cl.updateTemplate('t1', { assignee_roles: [' Mechanic ', 'mechanic', '', 'Driver'] })
    // Trimmed, de-duplicated case-insensitively (first spelling wins), blanks gone.
    expect(h.state.last._calls.update.assignee_roles).toEqual(['Mechanic', 'Driver'])
  })

  it('updateTemplate clearing the selection stores NULL', async () => {
    await cl.updateTemplate('t1', { assignee_roles: [] })
    expect(h.state.last._calls.update.assignee_roles).toBeNull()
  })

  it('a patch that does not mention targeting leaves the stored value alone', async () => {
    // Publishing must not blank out who the checklist is for.
    await cl.publishTemplate('t1')
    expect(h.state.last._calls.update).not.toHaveProperty('assignee_roles')
  })

  it('duplicateTemplate carries the targeting across', async () => {
    h.state.result = {
      data: { id: 'src', name: 'Workshop sheet', fields: [], assignee_roles: ['Electrician'] },
      error: null,
    }
    await cl.duplicateTemplate('src')
    expect(h.state.last._calls.insert.assignee_roles).toEqual(['Electrician'])
  })

  it('listTemplates asks for the column, or every checklist reads as untargeted', async () => {
    h.state.result = { data: [], error: null }
    await cl.listTemplates({ status: 'published' })
    expect(h.state.last._calls.select).toContain('assignee_roles')
  })
})

describe('normaliseAssigneeRoles', () => {
  it('returns null for anything that is not a populated array', () => {
    expect(cl.normaliseAssigneeRoles(null)).toBeNull()
    expect(cl.normaliseAssigneeRoles(undefined)).toBeNull()
    expect(cl.normaliseAssigneeRoles([])).toBeNull()
    expect(cl.normaliseAssigneeRoles(['  ', ''])).toBeNull()
    expect(cl.normaliseAssigneeRoles('Mechanic')).toBeNull()
  })

  it('keeps the stored spelling of the first occurrence', () => {
    // profiles.role is Title Case; storing 'mechanic' would still match through
    // normaliseRoleKey, but the chip a person reads should say 'Mechanic'.
    expect(cl.normaliseAssigneeRoles(['Mechanic', 'MECHANIC'])).toEqual(['Mechanic'])
  })
})
