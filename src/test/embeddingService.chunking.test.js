import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock for generateEmbedding's functions.invoke
// ('generate-embedding' edge function) - mirrors uploads.api.test.js.
const h = vi.hoisted(() => {
  const state = { fn: { data: { embedding: [0.1, 0.2] }, error: null }, invokes: [] }
  function invoke(name, opts) {
    state.invokes.push({ name, opts })
    return Promise.resolve(state.fn)
  }
  return { state, supabase: { functions: { invoke } } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { chunkText, indexDocumentChunked } = await import('../lib/embeddingService')

// Fake supabaseClient for indexDocumentChunked: records inserts; the parent
// insert resolves via .select().single(), chunk inserts resolve as thenables.
function makeClient({ parentResult, insertResults } = {}) {
  const inserts = []
  const parent = parentResult ?? { data: { id: 'parent-1' }, error: null }
  const queue = insertResults ? [...insertResults] : []
  return {
    inserts,
    from(table) {
      const b = {
        insert(v) { inserts.push({ table, values: v }); return b },
        select() { return b },
        single() { return Promise.resolve(parent) },
        then(onF, onR) {
          const res = queue.length ? queue.shift() : { error: null }
          return Promise.resolve(res).then(onF, onR)
        },
      }
      return b
    },
  }
}

beforeEach(() => {
  h.state.fn = { data: { embedding: [0.1, 0.2] }, error: null }
  h.state.invokes = []
})

describe('embeddingService - chunkText', () => {
  it('returns [] for empty or whitespace input', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  ')).toEqual([])
    expect(chunkText(null)).toEqual([])
  })

  it('keeps a short document as a single chunk', () => {
    expect(chunkText('Steer axle wear normal.\n\nDrive axle wear normal.')).toEqual([
      'Steer axle wear normal.\n\nDrive axle wear normal.',
    ])
  })

  it('packs paragraphs into chunks no longer than maxChars', () => {
    const paras = ['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400), 'd'.repeat(400)]
    const chunks = chunkText(paras.join('\n\n'), { maxChars: 900, overlap: 100 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(900)
    // every paragraph's content survives somewhere
    for (const p of paras) expect(chunks.some(c => c.includes(p))).toBe(true)
  })

  it('carries overlap chars of tail context into the next chunk', () => {
    const chunks = chunkText(`${'a'.repeat(800)}\n\n${'b'.repeat(700)}`, { maxChars: 900, overlap: 100 })
    expect(chunks).toHaveLength(2)
    // second chunk starts with the 100-char tail of the first
    expect(chunks[1].startsWith(chunks[0].slice(-100))).toBe(true)
    expect(chunks[1]).toContain('b'.repeat(700))
  })

  it('hard-splits a single paragraph longer than maxChars into overlapping windows', () => {
    const chunks = chunkText('x'.repeat(2500), { maxChars: 1000, overlap: 200 })
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000)
    // windows advance by maxChars - overlap, so total coverage is complete
    expect(chunks.join('').length).toBeGreaterThanOrEqual(2500)
  })
})

describe('embeddingService - indexDocumentChunked', () => {
  const meta = { doc_type: 'sop', site: 'RUH', asset_no: 'TRK-01', tags: ['tyres'] }

  it('delegates short documents (<= 2000 chars) to indexDocument', async () => {
    const client = makeClient()
    const res = await indexDocumentChunked(client, { title: 'Short SOP', content: 'Rotate tyres every 10k km.', ...meta })
    expect(res).toEqual({ parentId: null, chunks: 0 })
    expect(client.inserts).toHaveLength(1)
    expect(client.inserts[0].table).toBe('knowledge_documents')
    expect(client.inserts[0].values).toMatchObject({ title: 'Short SOP', content: 'Rotate tyres every 10k km.', embedding: [0.1, 0.2] })
    expect(client.inserts[0].values.chunk_of).toBeUndefined()
  })

  it('splits a long document into a parent row plus linked chunk rows', async () => {
    const content = ['a'.repeat(900), 'b'.repeat(900), 'c'.repeat(900)].join('\n\n')
    const client = makeClient()
    const res = await indexDocumentChunked(client, { title: 'Fleet manual', content, ...meta })

    expect(res.parentId).toBe('parent-1')
    expect(res.chunks).toBeGreaterThan(1)
    // parent + one row per chunk
    expect(client.inserts).toHaveLength(1 + res.chunks)

    const parent = client.inserts[0].values
    expect(parent.title).toBe('Fleet manual')
    expect(parent.content).toBe(content.slice(0, 1500) + '…')
    expect(parent.embedding).toEqual([0.1, 0.2])
    expect(parent).toMatchObject(meta)

    client.inserts.slice(1).forEach(({ table, values }, i) => {
      expect(table).toBe('knowledge_documents')
      expect(values.title).toBe(`Fleet manual (part ${i + 1})`)
      expect(values.chunk_of).toBe('parent-1')
      expect(values.chunk_index).toBe(i + 1)
      expect(values.content.length).toBeLessThanOrEqual(1500)
      expect(values).toMatchObject(meta)
    })

    // first chunk reuses the parent embedding call: 1 + (chunks - 1) invokes
    expect(h.state.invokes).toHaveLength(res.chunks)
    expect(h.state.invokes.every(c => c.name === 'generate-embedding')).toBe(true)
  })

  it('returns an error when embedding generation fails', async () => {
    h.state.fn = { data: null, error: { message: 'rate limited' } }
    const client = makeClient()
    const res = await indexDocumentChunked(client, { title: 'Doc', content: 'z'.repeat(2500), ...meta })
    expect(res).toEqual({ error: 'Embedding generation failed' })
    expect(client.inserts).toHaveLength(0)
  })

  it('surfaces a parent insert failure', async () => {
    const client = makeClient({ parentResult: { data: null, error: { message: 'rls denied' } } })
    const res = await indexDocumentChunked(client, { title: 'Doc', content: 'z'.repeat(2500), ...meta })
    expect(res).toEqual({ error: 'rls denied' })
  })

  it('surfaces a chunk insert failure', async () => {
    const client = makeClient({ insertResults: [{ error: { message: 'chunk boom' } }] })
    const res = await indexDocumentChunked(client, { title: 'Doc', content: 'z'.repeat(2500), ...meta })
    expect(res).toEqual({ error: 'chunk boom' })
  })

  it('rejects empty content', async () => {
    const client = makeClient()
    const res = await indexDocumentChunked(client, { title: 'Doc', content: '   ', ...meta })
    expect(res).toEqual({ error: 'No content to index' })
    expect(client.inserts).toHaveLength(0)
  })
})
