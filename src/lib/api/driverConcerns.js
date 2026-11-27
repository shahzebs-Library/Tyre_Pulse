/**
 * Driver Concerns service. Clients only READ the tables; every write is an RPC
 * from supabase/migrations/20261127191000_driver_concerns.sql, which re-checks
 * org, visibility (sensitive cases never reach the fleet pool) and the rung.
 */
import { supabase, unwrap, toServiceError, isNotProvisioned } from './_client'
import { invokeChatAI } from './uploads'
import { CONCERN_LANGS } from '../driverConcerns'

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

const MODEL = 'claude-haiku-4-5' // chat-ai locks the model server-side; recorded for the label

/**
 * Machine translation through the chat-ai edge function. Returns
 * { text, detectedLang, model } or null. The original is never touched.
 */
export async function translateText(text, targetLang) {
  if (!text || !CONCERN_LANGS.includes(targetLang)) return null
  const system = 'You translate short workplace messages. Reply with JSON only: {"detected":"<iso code>","text":"<translation>"}. Use one of: en, ar, ur, hi, bn, ps, ne, tl for detected. Keep names, numbers and dates unchanged. Do not add anything.'
  const user = `Translate into ${targetLang}:\n${text}`
  const res = await invokeChatAI({ system, user, max_tokens: 800 })
  if (res?.error || res?.data?.error) return null
  const raw = String(res?.data?.content || '')
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    if (!parsed?.text) return null
    const detected = CONCERN_LANGS.includes(parsed.detected) ? parsed.detected : null
    return { text: String(parsed.text), detectedLang: detected, model: res?.data?.model || MODEL }
  } catch {
    return null
  }
}

export async function saveTranslation(id, { source, sourceId = '', targetLang, text, model, modelVersion = null, detectedLang = null }) {
  return unwrap(await supabase.rpc('driver_concern_add_translation', {
    p_id: id, p_source: source, p_source_id: sourceId, p_target_lang: targetLang,
    p_text: text, p_model: model, p_model_version: modelVersion, p_detected_lang: detectedLang,
  }))
}

/** Translate and store, best-effort. Returns the saved row shape or null. */
export async function translateAndSave(id, source, sourceId, text, targetLang) {
  const out = await translateText(text, targetLang)
  if (!out) return null
  try {
    await saveTranslation(id, { source, sourceId, targetLang, text: out.text, model: out.model, detectedLang: out.detectedLang })
  } catch {
    return null
  }
  return { source, source_id: sourceId, target_lang: targetLang, text: out.text, model: out.model, generated_at: new Date().toISOString() }
}
