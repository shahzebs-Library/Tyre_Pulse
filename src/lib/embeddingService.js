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

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS }
