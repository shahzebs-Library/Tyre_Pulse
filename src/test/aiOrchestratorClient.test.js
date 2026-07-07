import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase mock (mirrors uploads.api.test.js): query
// builder recorder plus functions.invoke for the ai-orchestrator edge
// function.
const h = vi.hoisted(() => {
  const state = {
    result: { data: [], error: null },
    last: null,
    fn: { data: null, error: null },
    lastFn: null,
  }
  function invoke(name, opts) { state.lastFn = { name, opts }; return Promise.resolve(state.fn) }
  function from(table) {
    const calls = { eq: [], order: [], limit: [] }
    const b = {
      _table: table,
      _calls: calls,
      select(cols, opts) { calls.select = { cols, opts }; return b },
      order(col, opts) { calls.order.push([col, opts]); return b },
      limit(n) { calls.limit.push(n); return b },
      update(v) { calls.update = v; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      single() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from, functions: { invoke } } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const client = await import('../lib/aiOrchestratorClient')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
  h.state.fn = { data: null, error: null }
  h.state.lastFn = null
})

describe('aiOrchestratorClient - sendOrchestratorMessage', () => {
  it('invokes the ai-orchestrator edge function with the snake_case body', async () => {
    h.state.fn = { data: { content: 'CPK is trending up.', conversation_id: 'c1', tool_calls: [] }, error: null }
    const res = await client.sendOrchestratorMessage({
      message: 'How is CPK trending?',
      conversationId: 'c1',
      agent: 'analyst',
    })
    expect(h.state.lastFn.name).toBe('ai-orchestrator')
    expect(h.state.lastFn.opts).toEqual({
      body: { message: 'How is CPK trending?', conversation_id: 'c1', agent: 'analyst' },
    })
    expect(res).toEqual({ content: 'CPK is trending up.', conversation_id: 'c1', tool_calls: [] })
  })

  it('defaults conversationId to null and agent to auto', async () => {
    h.state.fn = { data: { content: 'ok', conversation_id: 'c2' }, error: null }
    await client.sendOrchestratorMessage({ message: 'Hello' })
    expect(h.state.lastFn.opts).toEqual({
      body: { message: 'Hello', conversation_id: null, agent: 'auto' },
    })
  })

  it('surfaces edge-function errors as ServiceError', async () => {
    h.state.fn = { data: null, error: { message: 'orchestrator unavailable' } }
    await expect(client.sendOrchestratorMessage({ message: 'x' })).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('aiOrchestratorClient - conversation reads', () => {
  it('lists non-archived conversations by updated_at desc with the limit', async () => {
    h.state.result = { data: [{ id: 'c1', title: 'CPK review' }], error: null }
    const rows = await client.listConversations({ limit: 5 })
    expect(h.state.last._table).toBe('ai_conversations')
    expect(h.state.last._calls.eq).toContainEqual(['archived', false])
    expect(h.state.last._calls.order).toContainEqual(['updated_at', { ascending: false }])
    expect(h.state.last._calls.limit).toContainEqual(5)
    expect(rows).toEqual([{ id: 'c1', title: 'CPK review' }])
  })

  it('defaults the conversation list limit to 30', async () => {
    await client.listConversations()
    expect(h.state.last._calls.limit).toContainEqual(30)
  })

  it('lists a conversation transcript in turn (id) order', async () => {
    h.state.result = { data: [{ id: 1, role: 'user', content: 'hi' }], error: null }
    const rows = await client.listConversationMessages('c1')
    expect(h.state.last._table).toBe('ai_messages')
    expect(h.state.last._calls.eq).toContainEqual(['conversation_id', 'c1'])
    expect(h.state.last._calls.order).toContainEqual(['id', { ascending: true }])
    expect(rows).toEqual([{ id: 1, role: 'user', content: 'hi' }])
  })

  it('archives a conversation by id', async () => {
    await client.archiveConversation('c1')
    expect(h.state.last._table).toBe('ai_conversations')
    expect(h.state.last._calls.update).toEqual({ archived: true })
    expect(h.state.last._calls.eq).toContainEqual(['id', 'c1'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(client.listConversations()).rejects.toBeInstanceOf(ServiceError)
    await expect(client.listConversations()).rejects.toMatchObject({ code: '42501' })
  })
})
