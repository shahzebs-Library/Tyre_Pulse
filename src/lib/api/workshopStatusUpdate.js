/**
 * Workshop Status manual update service (Loop 8, Vehicle Update Drawer).
 *
 * The ONE write path for the TyrePulse-owned operational fields of a workshop
 * vehicle: the SECURITY DEFINER function workshop_status_update_record of
 * migration 20261007120000. The server checks permission (update, plus assign
 * for people), validates the vocabulary, refuses Excel-owned fields and
 * stamps who/when from the signed-in user. Nothing here sends a name or a
 * time for "updated by".
 */
import { supabase, fetchAllOrThrow, ServiceError, toServiceError } from './_client'

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

export const STALE_RECORD_MESSAGE = 'This vehicle was updated by someone else. Reload it and try again.'

/** True for the server's optimistic-concurrency refusal. */
export function isRecordChangedError(err) {
  if (!err) return false
  if (err.code === 'record_changed') return true
  const text = `${err?.message ?? ''} ${err?.details ?? ''} ${err?.cause?.message ?? ''}`
  return err.code === 'PT409' || err?.cause?.code === 'PT409' || text.includes('record_changed')
}

/**
 * Save a manual update. `patch` holds ONLY the changed fields (see
 * diffPatch in src/lib/workshopStatus/updateForm.js). `expectedUpdatedAt` is
 * the record's updated_at exactly as it was read (keep the server string:
 * a JS Date drops the microseconds and would read as stale every time).
 *
 * Resolves to { ok, changed, fields, record } (record is absent when nothing
 * changed). Throws ServiceError with code 'record_changed' when someone else
 * saved first.
 */
export async function updateWorkshopRecord(recordId, patch, { expectedUpdatedAt } = {}) {
  if (blank(recordId)) throw new ServiceError('No vehicle selected.', 'record_required')
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ServiceError('Nothing to save.', 'patch_required')
  }
  const { data, error } = await supabase.rpc('workshop_status_update_record', {
    p_record_id: recordId,
    p_patch: patch,
    p_expected_updated_at: blank(expectedUpdatedAt) ? null : String(expectedUpdatedAt),
  })
  if (error) {
    if (isRecordChangedError(error)) throw new ServiceError(STALE_RECORD_MESSAGE, 'record_changed', error)
    throw toServiceError(error, 'Could not save the vehicle update.')
  }
  return data || { ok: true, changed: 0, fields: [] }
}

const PROFILE_COLS = 'id,full_name,username,role'

/**
 * People who can be named responsible / supporting: approved, unlocked
 * profiles (RLS scopes them to the caller's organisation). Light columns,
 * paged past the 1000-row cap with a ceiling. Sorted by display name.
 */
export async function listAssignableUsers() {
  const rows = await fetchAllOrThrow((from, to) => supabase
    .from('profiles').select(PROFILE_COLS).eq('approved', true).eq('locked', false)
    .order('id').range(from, to), { max: 5000 })
  const out = rows.map((r) => ({
    id: r.id,
    name: (r.full_name && String(r.full_name).trim()) || (r.username && String(r.username).trim()) || '',
    role: r.role || '',
  })).filter((r) => r.id && r.name)
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
