import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted Supabase mock: a chainable, thenable query builder that
// records the table queried and the filters applied, and resolves to a
// configurable { data, error }. Mirrors src/test/api.test.js, plus `delete`
// and `not` on the builder for the knowledge_documents service.
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, results: null, last: null, builders: [] }
  function nextResult() {
    // If a queue of per-query results is set, consume it in order; otherwise
    // fall back to the single shared result.
    if (Array.isArray(state.results) && state.results.length) return state.results.shift()
    return state.result
  }
  function from(table) {
    const calls = { eq: [], or: [], not: [], order: [], range: [] }
    const b = {
      _table: table,
      _calls: calls,
      select() { return b },
      order(c, o) { calls.order.push([c, o]); return b },
      range(f, t) { calls.range.push([f, t]); return b },
      limit() { return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      not(c, op, v) { calls.not.push([c, op, v]); return b },
      maybeSingle() { return Promise.resolve(nextResult()) },
      single() { return Promise.resolve(nextResult()) },
      then(onF, onR) { return Promise.resolve(nextResult()).then(onF, onR) },
    }
    state.last = b
    state.builders.push(b)
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const knowledgeDocuments = await import('../lib/api/knowledgeDocuments')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.results = null
  h.state.last = null
  h.state.builders = []
})

describe('service layer - knowledgeDocuments', () => {
  it('lists from knowledge_documents newest-first and maps embedding presence', async () => {
    // First query: metadata rows. Second query: ids that have an embedding.
    h.state.results = [
      { data: [{ id: 'd1', title: 'A' }, { id: 'd2', title: 'B' }], error: null },
      { data: [{ id: 'd1' }], error: null },
    ]
    const rows = await knowledgeDocuments.listKnowledgeDocuments()

    // First builder targeted knowledge_documents.
    expect(h.state.builders[0]._table).toBe('knowledge_documents')
    // Presence pass filtered on embedding NOT NULL (no vector transferred).
    expect(h.state.builders[1]._calls.not).toContainEqual(['embedding', 'is', null])
    // d1 has an embedding (truthy), d2 does not (null) - preserves page contract.
    expect(rows.find(r => r.id === 'd1').embedding).toBe(true)
    expect(rows.find(r => r.id === 'd2').embedding).toBeNull()
  })

  it('pages the list past 1,000 rows with an id tiebreak (no silent cap)', async () => {
    const page = (n, off) => Array.from({ length: n }, (_, i) => ({ id: `d${off + i}` }))
    h.state.results = [
      { data: page(1000, 0), error: null },
      { data: page(5, 1000), error: null },
      // fetchAllPages fetches pages 1-4 as one concurrent window
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [{ id: 'd0' }], error: null },
    ]
    const rows = await knowledgeDocuments.listKnowledgeDocuments()
    expect(rows).toHaveLength(1005)
    expect(rows.truncated).toBe(false)
    const b0 = h.state.builders[0]
    expect(b0._calls.order[0][0]).toBe('created_at')
    expect(b0._calls.order).toContainEqual(['id', { ascending: true }])
    expect(b0._calls.range[0]).toEqual([0, 999])
    expect(h.state.builders[1]._calls.range[0]).toEqual([1000, 1999])
    // presence pass is paged + ordered too
    const pres = h.state.builders[5]
    expect(pres._calls.not).toContainEqual(['embedding', 'is', null])
    expect(pres._calls.order).toContainEqual(['id', { ascending: true }])
    expect(rows[0].embedding).toBe(true)
    expect(rows[1].embedding).toBeNull()
  })

  it('reports truncation honestly when the ceiling is hit', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ id: `d${i}` }))
    h.state.results = [{ data: page, error: null }, { data: [], error: null }]
    const rows = await knowledgeDocuments.listKnowledgeDocuments({ max: 1000 })
    expect(rows).toHaveLength(1000)
    expect(rows.truncated).toBe(true)
    expect(rows.max).toBe(1000)
  })

  it('createKnowledgeDocument passes values through INCLUDING the embedding vector', async () => {
    const embedding = [0.1, 0.2, 0.3]
    const values = { title: 'SOP', content: 'x', doc_type: 'sop', tags: ['a'], embedding }
    await knowledgeDocuments.createKnowledgeDocument(values)
    expect(h.state.last._table).toBe('knowledge_documents')
    expect(h.state.last._calls.insert).toBe(values)
    expect(h.state.last._calls.insert.embedding).toEqual(embedding)
  })

  it('deleteKnowledgeDocument deletes by id', async () => {
    await knowledgeDocuments.deleteKnowledgeDocument('d9')
    expect(h.state.last._table).toBe('knowledge_documents')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 'd9'])
  })

  it('throws a ServiceError on a Supabase error', async () => {
    h.state.result = { data: null, error: { message: 'boom', code: '42501' } }
    await expect(knowledgeDocuments.listKnowledgeDocuments()).rejects.toBeInstanceOf(ServiceError)
    await expect(knowledgeDocuments.deleteKnowledgeDocument('d1')).rejects.toMatchObject({ code: '42501' })
  })
})
