/**
 * Driver Concerns service. Clients only READ the tables; every write is an RPC
 * from supabase/migrations/20261127191000_driver_concerns.sql, which re-checks
 * org, visibility (sensitive cases never reach the fleet pool) and the rung.
 */
import { supabase, unwrap, toServiceError, isNotProvisioned } from './_client'

const COLS = [
  'id', 'case_no', 'driver_id', 'category', 'subtype', 'sensitive', 'status', 'level',
  'country', 'site', 'ack_due_at', 'due_at', 'acknowledged_at',
  'escalation_count', 'entered_verbally', 'original_lang', 'created_at', 'updated_at',
  'closed_at', 'reopen_deadline', 'outcome_seen_at', 'driver_decision', 'version',
  'duplicate_of', 'linked_to', 'pdf_sha256',
].join(',')

/**
 * The inbox (RLS decides what the caller sees). Never throws on "not installed".
 * Only columns granted to `authenticated` may be listed here: proposals, who
 * handles a case and signatures are column-revoked and come from getConcern().
 */
export async function listConcerns({ limit = 500 } = {}) {
  const { data, error } = await supabase
    .from('driver_concerns')
    .select(`${COLS}, drivers:driver_id(driver_name, driver_id)`)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(limit)
  if (error) {
    if (isNotProvisioned(error)) return { rows: [], notProvisioned: true }
    throw toServiceError(error, 'Could not load driver concerns.')
  }
  const rows = (data || []).map(r => ({
    ...r,
    driver_name: r.drivers?.driver_name || null,
    driver_code: r.drivers?.driver_id || null,
  }))
  return { rows, notProvisioned: false }
}

export async function getConcern(id) {
  return unwrap(await supabase.rpc('driver_concern_get', { p_id: id }))
}

export async function raiseConcern({ category, subtype, text, lang = null, photos = [], clientUuid, driverId = null, onBehalf = false, verbal = false, subjectUserId = null }) {
  return unwrap(await supabase.rpc('driver_concern_raise', {
    p_category: category, p_subtype: subtype, p_text: text, p_lang: lang,
    p_photos: photos, p_client_uuid: clientUuid, p_driver_id: driverId,
    p_on_behalf: onBehalf, p_verbal: verbal, p_subject_user: subjectUserId,
  }))
}

/** One writer. A stale version comes back as PT409 ("record_changed"). */
export async function concernCommand(id, action, payload = {}, expectedVersion = null) {
  return unwrap(await supabase.rpc('driver_concern_command', {
    p_id: id, p_action: action, p_payload: payload, p_expected_version: expectedVersion,
  }))
}

export function isStale(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.cause?.message || err?.message || '')
  return code === 'PT409' || /record_changed|already_decided/.test(msg)
}

export async function setConcernPdf(id, sha256, path = null) {
  return unwrap(await supabase.rpc('driver_concern_set_pdf', { p_id: id, p_sha256: sha256, p_path: path }))
}

export async function signedPhotoUrl(path, seconds = 300) {
  const { data, error } = await supabase.storage.from('driver-concerns').createSignedUrl(path, seconds)
  if (error) return null
  return data?.signedUrl || null
}

