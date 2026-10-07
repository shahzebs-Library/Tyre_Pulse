/**
 * Workshop Status -> Released / Closed service (Loop 11).
 *
 * Reads go through RLS: a record that left the report is visible only with
 * the view_removed permission, and a soft-deleted one only with soft_delete
 * (policy in migration 20261007100000). The ONE write path is the SECURITY
 * DEFINER function workshop_status_record_action (migration 20261007130000),
 * which checks the permission, the record state and the reason, and stamps
 * who / when from the signed-in user. Nothing here sends a name or a time.
 */
import { supabase, fetchAllPages, ServiceError, toServiceError } from './_client'
import { RECORD_COLS } from './workshopStatus'
import { loadPeopleNames, loadUploadsById } from './workshopStatusActive'
import { isRecordChangedError, STALE_RECORD_MESSAGE } from './workshopStatusUpdate'

const MAX_ROWS = 20000

// Built on first use (not at import) so a test that mocks workshopStatus.js
// without RECORD_COLS can still import this module.
const EXTRA_COLS = [
  'removed_by_upload_id', 'removed_at', 'removed_by_user_id', 'removed_reason',
  'previous_current_stage', 'previous_delay_reason', 'previous_responsible_user_id',
  'final_disposition', 'final_disposition_remarks', 'final_disposition_by',
  'final_disposition_by_name', 'final_disposition_at',
  'archived_at', 'archived_by', 'archive_reason', 'deleted_at', 'deleted_by', 'delete_reason',
]
export function removedCols() {
  return [RECORD_COLS, ...EXTRA_COLS].join(',')
}

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

/**
 * Records that are not in the active report (released, archived and - for
 * callers allowed to see them - soft deleted).
 *
 * @returns {Promise<{ rows: object[], truncated: boolean }>}
 */
export async function listRemovedRecords({ country } = {}) {
  const c = blank(country) || country === 'All' ? null : String(country).trim()
  const { data, error, truncated } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('workshop_status_records')
      .select(removedCols())
      .eq('current_active', false)
    if (c) q = q.eq('country', c)
    return q
      .order('removed_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
  }, { max: MAX_ROWS })
  if (error) throw toServiceError(error, 'Could not load the released vehicles.')
  return { rows: data || [], truncated: Boolean(truncated) }
}

/**
 * Records plus the previous responsible person's name and the upload that
 * removed each one, joined client-side (best effort: a failed name lookup
 * leaves the cell empty instead of breaking the screen).
 */
export async function loadRemovedRecords({ country } = {}) {
  const { rows, truncated } = await listRemovedRecords({ country })
  const [people, uploads] = await Promise.all([
    loadPeopleNames(rows.map((r) => r.previous_responsible_user_id)),
    loadUploadsById(rows.map((r) => r.removed_by_upload_id)),
  ])
  return {
    truncated,
    rows: rows.map((r) => ({
      ...r,
      previous_responsible_name: r.previous_responsible_user_id
        ? people.get(String(r.previous_responsible_user_id)) || null
        : null,
      removed_by_upload: r.removed_by_upload_id ? uploads.get(String(r.removed_by_upload_id)) || null : null,
    })),
  }
}

/**
 * Run an action on a released record. Throws ServiceError with a code the
 * screen translates: record_changed, already_active, not_found, denied, or
 * invalid (the server's own validation sentence, which this function wrote
 * and which carries no database internals).
 */
export async function runRecordAction(recordId, action, { reason, disposition, remarks, expectedUpdatedAt } = {}) {
  if (blank(recordId)) throw new ServiceError('No vehicle selected.', 'record_required')
  if (blank(action)) throw new ServiceError('No action selected.', 'action_required')
  const { data, error } = await supabase.rpc('workshop_status_record_action', {
    p_record_id: recordId,
    p_action: action,
    p_reason: blank(reason) ? null : String(reason).trim(),
    p_disposition: blank(disposition) ? null : String(disposition),
    p_remarks: blank(remarks) ? null : String(remarks).trim(),
    p_expected_updated_at: blank(expectedUpdatedAt) ? null : String(expectedUpdatedAt),
  })
  if (error) {
    if (isRecordChangedError(error)) throw new ServiceError(STALE_RECORD_MESSAGE, 'record_changed', error)
    const code = error.code || error?.cause?.code
    if (code === '23505') throw new ServiceError('This vehicle is already in the active report.', 'already_active', error)
    if (code === 'P0002') throw new ServiceError('Workshop vehicle not found.', 'not_found', error)
    if (code === '42501') throw new ServiceError('You do not have permission to do this.', 'denied', error)
    if (code === '22023' && error.message) throw new ServiceError(String(error.message), 'invalid', error)
    throw toServiceError(error, 'The action could not be completed.')
  }
  return data || { ok: true, changed: 0 }
}
