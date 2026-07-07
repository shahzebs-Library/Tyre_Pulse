// embeddingService.js - Text embedding generation for RAG
// Uses Supabase Edge Function as proxy to avoid exposing API keys client-side
import { supabase } from './supabase'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536

// Generate embedding via Supabase Edge Function
// Edge function name: 'generate-embedding'
// Input: { text: string }
// Output: { embedding: number[] }
export async function generateEmbedding(text) {
  if (!text || !text.trim()) return null

  // Truncate to ~8000 chars (safe token limit for text-embedding-3-small)
  const truncated = text.trim().slice(0, 8000)

  const { data, error } = await supabase.functions.invoke('generate-embedding', {
    body: { text: truncated, model: EMBEDDING_MODEL },
  })

  if (error || !data?.embedding) {
    console.error('Embedding generation failed:', error)
    return null
  }

  return data.embedding
}

// Batch embed multiple texts (rate-limited to 5 concurrent)
export async function generateEmbeddingsBatch(texts, onProgress = null) {
  const results = []
  const BATCH_SIZE = 5

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const embeddings = await Promise.all(batch.map(t => generateEmbedding(t)))
    results.push(...embeddings)
    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, texts.length), texts.length)
    // Small delay to avoid rate limiting
    if (i + BATCH_SIZE < texts.length) await new Promise(r => setTimeout(r, 200))
  }
  return results
}

// Store document with embedding
export async function indexDocument(supabaseClient, doc) {
  const embedding = await generateEmbedding(doc.content)
  if (!embedding) return { error: 'Embedding generation failed' }

  const { error } = await supabaseClient
    .from('knowledge_documents')
    .insert({ ...doc, embedding })

  return { error }
}

// Re-index all documents without embeddings
export async function reindexMissingEmbeddings(supabaseClient, onProgress = null) {
  const { data: docs } = await supabaseClient
    .from('knowledge_documents')
    .select('id, content')
    .is('embedding', null)

  if (!docs?.length) return { indexed: 0 }

  let indexed = 0
  for (const doc of docs) {
    const embedding = await generateEmbedding(doc.content)
    if (embedding) {
      await supabaseClient
        .from('knowledge_documents')
        .update({ embedding })
        .eq('id', doc.id)
      indexed++
    }
    if (onProgress) onProgress(indexed, docs.length)
    await new Promise(r => setTimeout(r, 100))
  }

  return { indexed }
}

// ── Chunked indexing (V96: knowledge_documents.chunk_of / chunk_index) ──────

// Defaults tuned for text-embedding-3-small retrieval quality: ~1500 chars per
// chunk with 200 chars of tail context carried across boundaries.
const CHUNK_MAX_CHARS = 1500
const CHUNK_OVERLAP = 200
// Documents at or under this size are indexed whole (no parent/chunk split).
const CHUNK_THRESHOLD = 2000
// Parent rows keep a truncated preview of the full document.
const PARENT_PREVIEW_CHARS = 1500

/**
 * Paragraph-aware text splitter for RAG chunking. Splits on blank lines
 * (\n\n), packs paragraphs into chunks of at most `maxChars`, and carries
 * `overlap` chars of tail context from one chunk into the next so retrieval
 * never loses boundary-straddling sentences. A single paragraph longer than
 * `maxChars` is hard-split into overlapping windows.
 *
 * @param {string} text
 * @param {{maxChars?: number, overlap?: number}} [opts]
 * @returns {string[]} ordered chunks, each <= maxChars
 */
export function chunkText(text, { maxChars = CHUNK_MAX_CHARS, overlap = CHUNK_OVERLAP } = {}) {
  const source = typeof text === 'string' ? text.trim() : ''
  if (!source) return []

  const max = Math.max(1, Math.floor(maxChars))
  const tail = Math.max(0, Math.min(Math.floor(overlap), max - 1))
  const paragraphs = source.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

  const chunks = []
  let current = '' // chunk under construction (may start with carried overlap)
  let hasNew = false // whether `current` holds content beyond the carried tail

  const flush = () => {
    if (!hasNew || !current) return
    chunks.push(current)
    current = tail > 0 ? current.slice(-tail) : ''
    hasNew = false
  }

  for (const para of paragraphs) {
    if (para.length > max) {
      // Hard-split an oversized paragraph into overlapping windows.
      flush()
      const step = Math.max(1, max - tail)
      for (let start = 0; start < para.length; start += step) {
        chunks.push(para.slice(start, start + max))
        if (start + max >= para.length) break
      }
      current = tail > 0 ? para.slice(-tail) : ''
      hasNew = false
      continue
    }

    const joined = current ? `${current}\n\n${para}` : para
    if (joined.length <= max) {
      current = joined
      hasNew = true
    } else {
      flush()
      const rejoined = current ? `${current}\n\n${para}` : para
      current = rejoined.length <= max ? rejoined : para
      hasNew = true
    }
  }
  flush()
  return chunks
}

/**
 * Index a document with automatic chunking. Short documents (<= 2000 chars)
 * delegate to indexDocument() unchanged. Longer documents are stored as one
 * parent row (truncated preview content, embedded on the first chunk) plus one
 * `knowledge_documents` row per chunk linked via chunk_of / chunk_index
 * (V96 columns), each with its own embedding for precise retrieval.
 *
 * @param {object} supabaseClient  Supabase client (same contract as indexDocument)
 * @param {{title:string, content:string, doc_type?:string, site?:string,
 *   asset_no?:string, tags?:string[]}} doc
 * @returns {Promise<{parentId: string|null, chunks: number}|{error: string}>}
 */
export async function indexDocumentChunked(supabaseClient, doc) {
  const content = typeof doc?.content === 'string' ? doc.content : ''
  if (!content.trim()) return { error: 'No content to index' }

  if (content.length <= CHUNK_THRESHOLD) {
    const { error } = await indexDocument(supabaseClient, doc)
    if (error) return { error: typeof error === 'string' ? error : error.message || 'Insert failed' }
    return { parentId: null, chunks: 0 }
  }

  const chunks = chunkText(content)
  if (!chunks.length) return { error: 'No content to index' }

  // Shared metadata copied onto the parent and every chunk row.
  const shared = {
    doc_type: doc.doc_type ?? null,
    site: doc.site ?? null,
    asset_no: doc.asset_no ?? null,
    tags: doc.tags ?? null,
  }

  // Parent row: truncated preview, embedded on the first chunk (the summary-
  // bearing head of the document) so it still participates in retrieval.
  const parentEmbedding = await generateEmbedding(chunks[0])
  if (!parentEmbedding) return { error: 'Embedding generation failed' }

  const { data: parent, error: parentError } = await supabaseClient
    .from('knowledge_documents')
    .insert({
      ...shared,
      title: doc.title,
      content: content.slice(0, PARENT_PREVIEW_CHARS) + '…',
      embedding: parentEmbedding,
    })
    .select('id')
    .single()

  if (parentError || !parent?.id) {
    return { error: parentError?.message || 'Parent document insert failed' }
  }

  for (let i = 0; i < chunks.length; i++) {
    // First chunk reuses the parent's embedding call; the rest embed fresh.
    // A null embedding is stored as-is and later healed by
    // reindexMissingEmbeddings().
    const embedding = i === 0 ? parentEmbedding : await generateEmbedding(chunks[i])

    const { error: chunkError } = await supabaseClient.from('knowledge_documents').insert({
      ...shared,
      title: `${doc.title} (part ${i + 1})`,
      content: chunks[i],
      chunk_of: parent.id,
      chunk_index: i + 1,
      embedding,
    })

    if (chunkError) {
      return { error: chunkError.message || `Chunk ${i + 1} insert failed` }
    }
    // Small delay between embedding calls to avoid rate limiting.
    if (i + 1 < chunks.length) await new Promise(r => setTimeout(r, 100))
  }

  return { parentId: parent.id, chunks: chunks.length }
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS }
