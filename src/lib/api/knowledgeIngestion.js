/**
 * Knowledge ingestion + lifecycle service.
 *
 * Upload: read the file (PDF via pdfjs-dist, DOCX via jszip, plain text via
 * File.text), chunk it with page numbers (src/lib/knowledgeIngest.js), insert
 * ONE parent row + its chunk rows into knowledge_documents. Chunks are stored
 * with no embedding: the existing embed-worker cron (V98) embeds them. There
 * is no second embedding pipeline.
 *
 * Lifecycle: approve / withdraw go through the SECURITY DEFINER RPCs from
 * supabase/migrations/20261112103000_knowledge_lifecycle.sql. The database
 * enforces approver role + four eyes; the client checks are for the UI only.
 */
import { supabase, toServiceError, isMissingColumn, isMissingRelation } from './_client'
import { chunkPages, buildIngestRows, fileKind, normalizeText, pdfItemsToPages, docxXmlToText } from '../knowledgeIngest'

/** Rows per insert request for chunk rows. */
const CHUNK_INSERT_BATCH = 100

export const LIFECYCLE_NOT_INSTALLED =
  'The knowledge lifecycle update has not been installed on the database yet, so documents cannot be uploaded or approved here. Ask the administrator to apply the knowledge lifecycle migration.'

/**
 * Lifecycle refusals the database raises on purpose. safeError hides every
 * coded server message, so the known, user-safe ones are mapped back here.
 */
const KB_REFUSALS = [
  ['person who uploaded a document cannot approve', 'The person who uploaded a document cannot approve it. Ask another approver.'],
  ['only an admin, manager or director', 'Only an Admin, Manager or Director can change a document\'s status.'],
  ['approved document cannot be edited', 'An approved document cannot be edited. Upload a new version that supersedes it.'],
  ['document status cannot change', 'This status change is not allowed for the document in its current state. Refresh and try again.'],
  ['no content cannot be approved', 'A document with no content cannot be approved.'],
  ['reason is required to withdraw', 'A reason is required to withdraw a document.'],
  ['document not found', 'The document was not found, or you cannot see it.'],
]

/** User-safe message for a lifecycle refusal, or null when it is not one of ours. */
export function kbRefusalMessage(err) {
  const raw = String(err?.cause?.message ?? err?.message ?? '').toLowerCase()
  const hit = KB_REFUSALS.find(([needle]) => raw.includes(needle))
  return hit ? hit[1] : null
}

/** True when an error means the lifecycle columns / RPCs are not there yet. */
export function isLifecycleMissing(err) {
  return isMissingColumn(err) || isMissingRelation(err)
}

/**
 * Read a File into page-tagged text.
 * @param {File} file
 * @returns {Promise<{ kind:'pdf'|'docx'|'text', pages:Array<{page:number|null,text:string}>, pageCount:number|null }>}
 */
export async function extractDocument(file) {
  const kind = fileKind(file)
  if (!kind) throw new Error('This file type is not supported. Upload a PDF, a Word .docx file or a text file.')
  if (kind === 'pdf') {
    const { extractPdfItems } = await import('../import/parsePdf')
    const items = await extractPdfItems(file)
    const pages = pdfItemsToPages(items)
    if (!pages.length) {
      throw new Error('No text could be read from this PDF. It may be a scanned image; upload a text-based PDF or paste the text.')
    }
    return { kind, pages, pageCount: pages.length ? Math.max(...pages.map((p) => p.page)) : null }
  }
  if (kind === 'docx') {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const entry = zip.file('word/document.xml')
    if (!entry) throw new Error('This Word file has no readable document body.')
    const text = docxXmlToText(await entry.async('string'))
    if (!text) throw new Error('No text could be read from this Word file.')
    return { kind, pages: [{ page: null, text }], pageCount: null }
  }
  const raw = typeof file.text === 'function'
    ? await file.text()
    : await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = (e) => resolve(e.target.result)
      r.onerror = () => reject(new Error('Could not read the file.'))
      r.readAsText(file)
    })
  const text = normalizeText(raw)
  if (!text) throw new Error('The file is empty.')
  return { kind, pages: [{ page: null, text }], pageCount: null }
}

/**
 * Store a document: parent (draft) + chunks queued for embedding. If any chunk
 * batch fails, the parent is deleted (chunks cascade via chunk_of) so a half
 * document never lingers.
 *
 * @param {object} meta  see buildIngestRows
 * @param {Array<{page:number|null,text:string}>|string} pages
 * @param {{ onProgress?: (done:number, total:number) => void }} [opts]
 * @returns {Promise<{ documentId: string, chunks: number }>}
 */
export async function ingestDocument(meta, pages, { onProgress } = {}) {
  const chunks = chunkPages(pages)
  const rows = buildIngestRows(meta, chunks)

  const { data: parent, error: pErr } = await supabase
    .from('knowledge_documents')
    .insert(rows.parent)
    .select('id')
    .single()
  if (pErr) {
    if (isLifecycleMissing(pErr)) throw new Error(LIFECYCLE_NOT_INSTALLED)
    throw toServiceError(pErr, 'Could not save the document.')
  }

  const total = rows.chunks.length
  try {
    for (let i = 0; i < total; i += CHUNK_INSERT_BATCH) {
      const batch = rows.chunks.slice(i, i + CHUNK_INSERT_BATCH).map((c) => ({ ...c, chunk_of: parent.id }))
      const { error } = await supabase.from('knowledge_documents').insert(batch)
      if (error) throw toServiceError(error, 'Could not save the document text.')
      onProgress?.(Math.min(i + CHUNK_INSERT_BATCH, total), total)
    }
  } catch (err) {
    await supabase.from('knowledge_documents').delete().eq('id', parent.id)
    throw err
  }
  return { documentId: parent.id, chunks: total }
}

/** Approve a draft (approver role, not the uploader - enforced server-side). */
export async function approveKnowledgeDocument(id) {
  const { data, error } = await supabase.rpc('kb_approve_document', { p_id: id })
  if (error) {
    if (isLifecycleMissing(error)) throw new Error(LIFECYCLE_NOT_INSTALLED)
    const known = kbRefusalMessage(error)
    if (known) throw new Error(known)
    throw toServiceError(error, 'Could not approve the document.')
  }
  return data
}

/** Withdraw a document from use. A reason is required. */
export async function withdrawKnowledgeDocument(id, reason) {
  const why = String(reason ?? '').trim()
  if (!why) throw new Error('A reason is required to withdraw a document.')
  const { data, error } = await supabase.rpc('kb_withdraw_document', { p_id: id, p_reason: why })
  if (error) {
    if (isLifecycleMissing(error)) throw new Error(LIFECYCLE_NOT_INSTALLED)
    const known = kbRefusalMessage(error)
    if (known) throw new Error(known)
    throw toServiceError(error, 'Could not withdraw the document.')
  }
  return data
}
