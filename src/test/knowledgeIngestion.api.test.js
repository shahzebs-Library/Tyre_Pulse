import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = { inserts: [], deletes: [], rpc: [], results: [], rpcResult: { data: { ok: true }, error: null } }
  const next = () => (state.results.length ? state.results.shift() : { data: null, error: null })
  function from(table) {
    const b = {
      insert(v) { state.inserts.push({ table, v }); return b },
      select() { return b },
      single() { return Promise.resolve(next()) },
      delete() { b._delete = true; return b },
      eq(c, v) { if (b._delete) state.deletes.push({ table, c, v }); return b },
      then(onF, onR) { return Promise.resolve(b._delete ? { error: null } : next()).then(onF, onR) },
    }
    return b
  }
  const rpc = (name, args) => { state.rpc.push({ name, args }); return Promise.resolve(state.rpcResult) }
  return { state, supabase: { from, rpc } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const svc = await import('../lib/api/knowledgeIngestion')

beforeEach(() => {
  h.state.inserts = []
  h.state.deletes = []
  h.state.rpc = []
  h.state.results = []
  h.state.rpcResult = { data: { ok: true }, error: null }
})

describe('knowledgeIngestion service', () => {
  it('inserts a draft parent then chunks linked by chunk_of with no embedding', async () => {
    h.state.results = [{ data: { id: 'P1' }, error: null }, { data: null, error: null }]
    const res = await svc.ingestDocument({ title: 'SOP' }, [{ page: 1, text: 'Inflate to 8.5 bar.' }])
    expect(res).toEqual({ documentId: 'P1', chunks: 1 })
    expect(h.state.inserts[0].v).toMatchObject({ title: 'SOP', status: 'draft', chunk_count: 1 })
    expect(h.state.inserts[1].v[0]).toMatchObject({ chunk_of: 'P1', chunk_index: 1, page_from: 1, embedding: null })
  })

  it('deletes the parent when a chunk batch fails (no half documents)', async () => {
    h.state.results = [{ data: { id: 'P2' }, error: null }, { data: null, error: { code: '23514', message: 'violates check' } }]
    await expect(svc.ingestDocument({ title: 'SOP' }, 'text')).rejects.toBeTruthy()
    expect(h.state.deletes).toEqual([{ table: 'knowledge_documents', c: 'id', v: 'P2' }])
  })

  it('says the lifecycle is not installed when the columns are missing', async () => {
    h.state.results = [{ data: null, error: { code: '42703', message: 'column status does not exist' } }]
    await expect(svc.ingestDocument({ title: 'SOP' }, 'text')).rejects.toThrow(svc.LIFECYCLE_NOT_INSTALLED)
  })

  it('approves and withdraws through the RPCs and maps server refusals', async () => {
    await svc.approveKnowledgeDocument('D1')
    expect(h.state.rpc[0]).toEqual({ name: 'kb_approve_document', args: { p_id: 'D1' } })
    h.state.rpcResult = { data: null, error: { code: '42501', message: 'The person who uploaded a document cannot approve it' } }
    await expect(svc.approveKnowledgeDocument('D1')).rejects.toThrow(/cannot approve it. Ask another approver/)
    await expect(svc.withdrawKnowledgeDocument('D1', '  ')).rejects.toThrow(/reason is required/)
    h.state.rpcResult = { data: { ok: true }, error: null }
    await svc.withdrawKnowledgeDocument('D1', ' replaced ')
    expect(h.state.rpc.at(-1)).toEqual({ name: 'kb_withdraw_document', args: { p_id: 'D1', p_reason: 'replaced' } })
  })

  it('rejects unsupported files before reading', async () => {
    await expect(svc.extractDocument({ name: 'photo.png', type: 'image/png' })).rejects.toThrow(/not supported/)
    const out = await svc.extractDocument({ name: 'a.txt', type: 'text/plain', text: async () => 'Hello\r\n\r\n\r\nWorld' })
    expect(out).toEqual({ kind: 'text', pages: [{ page: null, text: 'Hello\n\nWorld' }], pageCount: null })
  })
})
