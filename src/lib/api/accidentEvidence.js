/**
 * Supabase boundary for `accident_evidence` - the photo/document attachment
 * log backing the "Responsibility documents" table (Responsibility & Payment
 * tab) and the "Attachments" checklist (Workshop Assessment tab). Writes go
 * through the accident-module RPCs (accident_evidence_add / _verify, from
 * docs/accident-module/13_EVIDENCE.sql) - verified live via the identical
 * pattern already in production use in accidentInsuranceClaims.js
 * (accident_document_add/_mark_received are the sibling RPCs from the SAME
 * migration file, so all five share one apply/rollback transaction).
 *
 * accident_evidence_checklist() (the RPC) matches against a CONFIGURED
 * requirements table (accident_evidence_requirements) this org has not
 * populated, so it would report an empty checklist even with real uploads on
 * record - this module reads the RAW rows directly instead (same
 * SHIP-BEFORE-MIGRATE convention as accidentLiability.js), so what is
 * actually attached is what is actually shown.
 *
 * Files upload into the SAME shared media bucket already used by
 * checklists.js/washRecords.js ('tyre-photos', a general attachment store
 * despite the name), under an accidents/ prefix - no new bucket invented.
 */
import { supabase, unwrap, isMissingRelation } from './_client'

const PHOTO_BUCKET = 'tyre-photos'

const EVIDENCE_COLS =
  'id,accident_id,country,site,workstream_key,requirement_key,category,kind,storage_ref,' +
  'file_name,mime_type,byte_size,caption,document_type,document_date,mandatory,' +
  'verification_status,verified_by,verified_at,uploaded_by,uploaded_at,created_by,created_at'

/** Evidence kinds the `accident_evidence_add` RPC accepts (CHECK, verified live). */
export const EVIDENCE_KINDS = ['photo', 'video', 'document']

async function readOrEmpty(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

/** Unpack an RPC's `{ok, ...}` jsonb envelope. */
function unwrapRpc(result, key) {
  const envelope = unwrap(result)
  if (!envelope?.ok) throw new Error('The request could not be completed.')
  return key ? envelope[key] : envelope
}

/** Every evidence row attached to a case, newest first. Optionally scoped to
 *  one workstream (e.g. 'liability' for the responsibility documents table,
 *  'assessment' for repair attachments). */
export async function listEvidence(accidentId, { workstreamKey } = {}) {
  if (!accidentId) return []
  return readOrEmpty(async () => {
    let q = supabase.from('accident_evidence').select(EVIDENCE_COLS).eq('accident_id', accidentId)
    if (workstreamKey) q = q.eq('workstream_key', workstreamKey)
    return unwrap(await q.order('created_at', { ascending: false })) || []
  }, [])
}

/** Upload one file into the shared media bucket and return its public URL -
 *  mirrors checklists.js's uploadChecklistPhoto exactly, under its own prefix. */
export async function uploadEvidenceFile(accidentId, file) {
  if (!file) throw new Error('No file provided.')
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const rand = Math.random().toString(36).slice(2, 8)
  const path = `accidents/${accidentId || 'misc'}/${Date.now()}_${rand}.${ext}`
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || undefined,
  })
  if (error) throw new Error(error.message || 'File upload failed.')
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return data?.publicUrl || null
}

/**
 * Upload a file and record it as one evidence row in a single call.
 * @param {string} accidentId
 * @param {File} file
 * @param {{kind?:'photo'|'video'|'document', caption?:string, workstreamKey?:string,
 *   requirementKey?:string}} [opts]
 */
export async function addEvidence(accidentId, file, { kind = 'document', caption, workstreamKey, requirementKey } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  const storageRef = await uploadEvidenceFile(accidentId, file)
  const row = unwrapRpc(
    await supabase.rpc('accident_evidence_add', {
      p_accident_id: accidentId,
      p_kind: kind,
      p_storage_ref: storageRef,
      p_caption: caption ?? file?.name ?? null,
      p_workstream_key: workstreamKey ?? null,
      p_requirement_key: requirementKey ?? null,
    }),
    'evidence',
  )
  return { ...row, file_name: row?.file_name || file?.name || null }
}

/** Verify / reject one evidence row (verification_status transition). */
export async function verifyEvidence(accidentId, evidenceId, decision, note) {
  if (!accidentId) throw new Error('An incident is required.')
  if (!evidenceId) throw new Error('An evidence item is required.')
  return unwrapRpc(
    await supabase.rpc('accident_evidence_verify', {
      p_accident_id: accidentId,
      p_evidence_id: evidenceId,
      p_decision: decision,
      p_note: note ?? null,
    }),
    'evidence',
  )
}
