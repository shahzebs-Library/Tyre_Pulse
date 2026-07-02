/**
 * Knowledge Documents service - knowledge_documents (RAG corpus). Single
 * boundary for that table as pages migrate off inline supabase. Explicit,
 * least-privilege column lists (no SELECT *).
 *
 * Read policy: the `embedding` column is a vector(1536) - never shipped to the
 * browser on reads (huge payload, and pages render metadata + a presence badge,
 * not the raw vector). Reads therefore SELECT metadata columns only and derive a
 * lightweight boolean `embedding` presence flag via a second id-only query
 * filtered on `embedding is not null` (no vector bytes transferred). This keeps
 * the KnowledgeBase page's existing `d.embedding` truthiness checks (stats +
 * status badge) working with zero behaviour change while excluding the vector
 * and RLS-managed `organisation_id` from the wire.
 *
 * Writes pass `values` through unchanged, INCLUDING the caller-computed
 * `embedding` vector.
 */
import { supabase, unwrap } from './_client'

// Least-privilege metadata columns for list/detail. Excludes `embedding`
// (heavy vector; presence is derived separately) and `organisation_id`
// (RLS-managed). `content` is included for detail parity but omitted from the
// list read, which never renders document bodies.
const LIST_COLS = 'id,title,doc_type,site,asset_no,tags,created_at,updated_at'
const DETAIL_COLS =
  'id,title,content,doc_type,site,asset_no,country,tags,created_at,updated_at'

/**
 * List knowledge documents, newest first (mirrors the page's
 * `.order('created_at', { ascending: false })`). Each returned row carries a
 * lightweight boolean `embedding` presence flag (true when the row has an
 * embedding vector) so callers can render indexed/pending status without
 * transferring the vector itself.
 * @returns {Promise<Array<object>>}
 */
export async function listKnowledgeDocuments() {
  const rows =
    unwrap(
      await supabase
        .from('knowledge_documents')
        .select(LIST_COLS)
        .order('created_at', { ascending: false }),
    ) ?? []

  if (rows.length === 0) return rows

  // Lightweight presence pass: ids of rows that HAVE an embedding. Returns only
  // uuids (no vector bytes), so the full corpus stays cheap to load.
  const indexedIds = new Set(
    (
      unwrap(
        await supabase
          .from('knowledge_documents')
          .select('id')
          .not('embedding', 'is', null),
      ) ?? []
    ).map(r => r.id),
  )

  // Preserve the page's `d.embedding` truthiness contract without shipping the
  // vector: presence → truthy marker, absence → null.
  return rows.map(r => ({ ...r, embedding: indexedIds.has(r.id) ? true : null }))
}

/** Get one knowledge document by id (or null if not found). Excludes embedding. */
export async function getKnowledgeDocument(id) {
  return unwrap(
    await supabase.from('knowledge_documents').select(DETAIL_COLS).eq('id', id).maybeSingle(),
  )
}

/**
 * Create a knowledge document. `values` is passed through unchanged and MUST
 * include the caller-computed `embedding` vector when indexing.
 */
export async function createKnowledgeDocument(values) {
  return unwrap(await supabase.from('knowledge_documents').insert(values))
}

/** Delete a knowledge document by id. */
export async function deleteKnowledgeDocument(id) {
  return unwrap(await supabase.from('knowledge_documents').delete().eq('id', id))
}
