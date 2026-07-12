import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable Supabase mock recording table + filters + payloads, plus auth.getUser.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, uid: 'user-1' }
  function from(table) {
    const calls = { eq: [], or: [] }
    const b = {
      _table: table, _calls: calls,
      select(cols) { calls.select = cols; return b },
      order() { return b },
      limit() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  const auth = { getUser: () => Promise.resolve({ data: { user: { id: state.uid } } }) }
  return { state, supabase: { from, auth } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const svc = await import('../lib/api/support')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.uid = 'user-1'
})

describe('support ticket service', () => {
  it('createTicket validates and clamps a clean payload', async () => {
    h.state.result = { data: { id: 't1' }, error: null }
    await svc.createTicket({ subject: ' Broken export ', message: 'PDF is blank', category: 'bug', severity: 'high', country: 'KSA' })
    const ins = h.state.last._calls.insert
    expect(ins.subject).toBe('Broken export')
    expect(ins.category).toBe('bug')
    expect(ins.severity).toBe('high')
    expect(ins.status).toBe('open')
    expect(ins.country).toBe('KSA')
  })

  it('createTicket rejects missing subject/message', async () => {
    await expect(svc.createTicket({ message: 'x' })).rejects.toThrow(/subject/i)
    await expect(svc.createTicket({ subject: 'x' })).rejects.toThrow(/describe/i)
  })

  it('createTicket falls back to safe defaults for bad category/severity', async () => {
    h.state.result = { data: { id: 't2' }, error: null }
    await svc.createTicket({ subject: 'A', message: 'B', category: 'nonsense', severity: 'ultra' })
    const ins = h.state.last._calls.insert
    expect(ins.category).toBe('question')
    expect(ins.severity).toBe('medium')
  })

  it('listTickets with mine scopes to the current user', async () => {
    h.state.result = { data: [{ id: 't1' }], error: null }
    await svc.listTickets({ mine: true, status: 'open', country: 'KSA' })
    expect(h.state.last._table).toBe('support_tickets')
    expect(h.state.last._calls.eq).toContainEqual(['status', 'open'])
    expect(h.state.last._calls.eq).toContainEqual(['created_by', 'user-1'])
    expect(h.state.last._calls.or[0]).toMatch(/country\.eq\.KSA/)
  })

  it('updateTicket stamps resolved_at on resolve and clears it on reopen', async () => {
    h.state.result = { data: { id: 't1' }, error: null }
    await svc.updateTicket('t1', { status: 'resolved' })
    expect(h.state.last._calls.update.resolved_at).toBeTruthy()
    await svc.updateTicket('t1', { status: 'open' })
    expect(h.state.last._calls.update.resolved_at).toBeNull()
  })

  it('respondToTicket attaches response + responder and moves to in_progress', async () => {
    h.state.result = { data: { id: 't1' }, error: null }
    await svc.respondToTicket('t1', 'We are on it')
    const up = h.state.last._calls.update
    expect(up.admin_response).toBe('We are on it')
    expect(up.responded_by).toBe('user-1')
    expect(up.status).toBe('in_progress')
  })

  it('summarizeTickets counts by status', () => {
    const s = svc.summarizeTickets([
      { status: 'open' }, { status: 'open' }, { status: 'in_progress' },
      { status: 'resolved' }, { status: 'closed' },
    ])
    expect(s).toEqual({ open: 2, in_progress: 1, resolved: 1, closed: 1, total: 5, unresolved: 3 })
  })
})
