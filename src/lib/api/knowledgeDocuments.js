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
import { supabase, unwrap, fetchAllPages, toServiceError } from './_client'

// Least-privilege metadata columns for list/detail. Excludes `embedding`
// (heavy vector; presence is derived separately) and `organisation_id`
// (RLS-managed). `content` is included for detail parity but omitted from the
// list read, which never renders document bodies.
const LIST_COLS = 'id,title,doc_type,site,asset_no,tags,created_at,updated_at'
const DETAIL_COLS =
  'id,title,content,doc_type,site,asset_no,country,tags,created_at,updated_at'

/**
 * Safety ceiling on a single corpus read. The table is small today, but a bare
 * select is silently capped at 1,000 rows by PostgREST; paging with a ceiling
 * keeps the read complete up to this size and HONEST beyond it.
 */
export const KNOWLEDGE_DOCS_MAX = 20000

/**
 * List knowledge documents, newest first. Each returned row carries a
 * lightweight boolean `embedding` presence flag (true when the row has an
 * embedding vector) so callers can render indexed/pending status without
 * transferring the vector itself.
 *
 * Paged past the PostgREST 1,000-row cap via fetchAllPages. `created_at` is not
 * unique, so the order carries an `id` tiebreak - without it a page boundary
 * inside a tie group drops or repeats rows.
 *
 * The result is still an ARRAY (the page contract), with two extra properties:
 * `truncated` (true when the ceiling was hit, so the list is NOT the whole
 * corpus) and `max` (the ceiling). A silently shortened list reads as "these
 * are all the documents", which is the failure this guards against.
 * @param {{max?:number}} [opts]
 * @returns {Promise<Array<object> & {truncated:boolean, max:number}>}
 */
export async function listKnowledgeDocuments({ max = KNOWLEDGE_DOCS_MAX } = {}) {
  const { data, error, truncated } = await fetchAllPages(
    (from, to) =>
      supabase
        .from('knowledge_documents')
        .select(LIST_COLS)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    { max },
  )
  if (error) throw toServiceError(error)
  const rows = data ?? []

  const finish = list => {
    Object.defineProperty(list, 'truncated', { value: !!truncated, enumerable: false })
    Object.defineProperty(list, 'max', { value: max, enumerable: false })
    return list
  }
  if (rows.length === 0) return finish(rows)

  // Lightweight presence pass: ids of rows that HAVE an embedding. Returns only
  // uuids (no vector bytes). Paged too - an unpaged read would mark every
  // indexed document past the 1,000th as "pending".
  const presence = await fetchAllPages(
    (from, to) =>
      supabase
        .from('knowledge_documents')
        .select('id')
        .not('embedding', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
  )
  if (presence.error) throw toServiceError(presence.error)
  const indexedIds = new Set((presence.data ?? []).map(r => r.id))

  // Preserve the page's `d.embedding` truthiness contract without shipping the
  // vector: presence -> truthy marker, absence -> null.
  return finish(rows.map(r => ({ ...r, embedding: indexedIds.has(r.id) ? true : null })))
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
