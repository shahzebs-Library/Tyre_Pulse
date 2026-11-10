// Pure formatting of knowledge-base retrieval hits for the model.
//
// match_knowledge_documents returns only APPROVED, IN-DATE documents
// (supabase/migrations/20261112103000_knowledge_lifecycle.sql). Every hit
// carries the document id, title, version, page range and status so the model
// can cite the exact source. No dependencies: unit-tested from vitest
// (src/test/aiOrchestratorKnowledge.test.js).

export const NO_KNOWLEDGE_MATCH =
  'No approved, in-date company document matches this question. Do NOT invent or assume company policy, ' +
  'procedure, limits or criteria. Say that no approved document covers it, and suggest the user check with ' +
  'their manager or add the document to the knowledge base.'

const EXCERPT_CHARS = 800

type Hit = Record<string, unknown>

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** "p.3" / "p.3-4" / null. */
export function pageRange(hit: Hit): string | null {
  const from = num(hit.page_from)
  const to = num(hit.page_to)
  if (from == null || from < 1) return null
  return to != null && to > from ? `p.${from}-${to}` : `p.${from}`
}

/** Citation string the model is told to quote: "Title v2, p.3 [doc <id>]". */
export function citation(hit: Hit): string {
  const title = str(hit.title) || 'Untitled document'
  const version = num(hit.version)
  const page = pageRange(hit)
  const id = str(hit.document_id) || str(hit.id)
  return `${title}${version != null ? ` v${version}` : ''}${page ? `, ${page}` : ''}${id ? ` [doc ${id}]` : ''}`
}

/**
 * Map RPC rows to the tool result. Rows whose status is present and not
 * 'approved' are dropped (defence in depth against an older database function
 * that does not filter by lifecycle). An empty result returns the explicit
 * do-not-invent note.
 */
export function formatKnowledgeHits(rows: Hit[] | null | undefined): string {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => {
    const s = str(r?.status).toLowerCase()
    return s === '' ? false : s === 'approved'
  })
  if (!list.length) return NO_KNOWLEDGE_MATCH
  return JSON.stringify({
    note: 'Approved company documents only. Cite each fact with its "cite" value. If these excerpts do not answer the question, say so; do not invent policy.',
    documents: list.map((d) => ({
      document_id: str(d.document_id) || str(d.id),
      chunk_id: str(d.id),
      title: str(d.title),
      version: num(d.version),
      status: str(d.status),
      page: pageRange(d),
      doc_type: str(d.doc_type) || null,
      effective_from: str(d.effective_from) || null,
      similarity: num(d.similarity),
      cite: citation(d),
      excerpt: str(d.content).slice(0, EXCERPT_CHARS),
    })),
  })
}
