/**
 * Tyre import review - fitments an ERP upload could not place automatically
 * (20261109100000). Each held row names the wheel, the uploaded tyre and the
 * tyre the system already has on that wheel. An admin decides; nothing is
 * guessed. All three RPCs are elevated-only and organisation scoped.
 */
import { supabase, toServiceError } from './_client'

export const REVIEW_ACTIONS = Object.freeze({
  make_current: 'Fit uploaded tyre (latest upload wins)',
  add_as_history: 'Record as past fitment',
  dismiss: 'Dismiss',
})

/** Plain-English reason for a held row. */
export function reviewReason(reason) {
  const s = String(reason || '').replace('replacement_needs_review:', '')
  return {
    ambiguous_not_later: 'Uploaded tyre is dated before the one already on the wheel',
    ambiguous_backdated: 'A later tyre is already recorded on this wheel',
    ambiguous_same_day_stale: 'Same-day upload looks older than the tyre on the wheel (stale file)',
    ambiguous_previous_undated: 'The tyre on the wheel has no fitting date',
    ambiguous_multiple_active: 'The wheel already shows two tyres',
    same_tyre: 'Same tyre already on the wheel with a different date',
    error: 'The check could not run',
  }[s] || 'Needs review'
}

export async function listTyreImportReviews({ country, includeResolved = false } = {}) {
  const { data, error } = await supabase.rpc('list_tyre_import_reviews', {
    p_country: country && country !== 'All' ? country : null,
    p_include_resolved: includeResolved,
    p_limit: 2000,
  })
  if (error) throw toServiceError(error)
  return Array.isArray(data) ? data : []
}

export async function resolveTyreImportReview(id, action) {
  if (!REVIEW_ACTIONS[action]) throw new Error('Unknown action')
  const { data, error } = await supabase.rpc('resolve_tyre_import_review', { p_id: id, p_action: action })
  if (error) throw toServiceError(error)
  if (data && data.ok === false) {
    const msg = {
      already_resolved: 'Someone has already resolved this row.',
      no_later_fitment_use_make_current: 'There is no later tyre on this wheel, so it cannot be past history. Use "Fit uploaded tyre".',
      forbidden: 'You cannot change tyres for this country.',
      not_found: 'This row no longer exists.',
    }[data.reason] || 'This row could not be resolved.'
    throw new Error(msg)
  }
  return data
}

export async function listTyreReplacementBatches() {
  const { data, error } = await supabase.rpc('list_tyre_replacement_batches', { p_limit: 50 })
  if (error) throw toServiceError(error)
  return Array.isArray(data) ? data : []
}

export async function undoTyreReplacementBatch(batchId) {
  const { data, error } = await supabase.rpc('tyre_replacement_undo', { p_batch: batchId })
  if (error) throw toServiceError(error)
  return data
}
