/**
 * Workshop Status - daily upload history (Loop 15). Read only, through RLS:
 *   workshop_status_uploads      readable with workshop_status_can('view_uploads')
 *   workshop_status_upload_rows  same permission, plus country / site scope
 *   workshop_status_events       the upload_confirmed event (applied conflict
 *                                choices); best effort - needs view_activity
 * Every list is ordered with an id tiebreak so paging never repeats or skips.
 */
import { supabase, fetchAllPages, ServiceError, toServiceError, isMissingColumn as clientMissingColumn } from './_client'
import { dayRangeBounds } from '../workshopStatus/uploadHistory'

export const UPLOAD_HISTORY_COLS = [
  'id', 'upload_no', 'country', 'file_name', 'sheet_name', 'report_date', 'status',
  'uploaded_by_name', 'uploaded_at', 'confirmed_by_name', 'confirmed_at', 'cancelled_at',
  'total_rows', 'new_count', 'updated_count', 'unchanged_count', 'removed_count', 'closed_count',
  'invalid_count', 'duplicate_count', 'previous_active_count', 'duplicate_of_upload_id',
].join(',')
/** Added by migration 20261011140000; read only when present. */
const CONFLICT_COLS = 'conflict_count,kept_manual_count'

export const UPLOAD_ROW_COLS = [
  'id', 'upload_id', 'row_number', 'section', 'asset_no', 'site', 'outcome', 'data', 'raw',
  'changes', 'errors', 'record_id',
].join(',')
const ROW_CONFLICT_COLS = 'conflict,resolution,conflict_details'

const MAX_EXPORT = 5000
const MAX_ROWS_PER_UPLOAD = 6000

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')
const isMissingColumn = (e) => clientMissingColumn(e)
  || /column .* does not exist/i.test(`${e?.message ?? ''} ${e?.details ?? ''}`)

function applyFilters(q, { country, from, to, state } = {}) {
  let out = q
  if (!blank(country) && String(country).toLowerCase() !== 'all') out = out.eq('country', String(country).trim())
  const { gte, lt } = dayRangeBounds(from, to)
  if (gte) out = out.gte('uploaded_at', gte)
  if (lt) out = out.lt('uploaded_at', lt)
  if (state === 'confirmed') out = out.eq('status', 'confirmed')
  else if (state === 'abandoned') out = out.in('status', ['cancelled', 'previewed'])
  else if (state === 'failed') out = out.eq('status', 'failed')
  return out
}

/** Runs `build(cols)`; retries without the Loop 16 columns before that migration is applied. */
async function withOptionalCols(build, base, extra) {
  const first = await build(`${base},${extra}`)
  if (first.error && isMissingColumn(first.error)) return build(base)
  return first
}

/**
 * One page of the upload register, newest first.
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listUploadHistory({ country, from, to, state, page = 0, pageSize = 25 } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 200)
  const start = Math.max(Number(page) || 0, 0) * size
  const { data, error, count } = await withOptionalCols((cols) => applyFilters(
    supabase.from('workshop_status_uploads').select(cols, { count: 'exact' }), { country, from, to, state })
    .order('uploaded_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + size - 1), UPLOAD_HISTORY_COLS, CONFLICT_COLS)
  if (error) throw toServiceError(error, 'Could not load the upload history.')
  return { rows: data || [], total: Number.isFinite(count) ? count : (data || []).length }
}

/** Every upload matching the filters (export), capped. */
export async function listAllUploadHistory({ country, from, to, state } = {}) {
  const run = (cols) => fetchAllPages((a, b) => applyFilters(
    supabase.from('workshop_status_uploads').select(cols), { country, from, to, state })
    .order('uploaded_at', { ascending: false })
    .order('id', { ascending: false })
    .range(a, b), { max: MAX_EXPORT })
  let res = await run(`${UPLOAD_HISTORY_COLS},${CONFLICT_COLS}`)
  if (res.error && isMissingColumn(res.error)) res = await run(UPLOAD_HISTORY_COLS)
  if (res.error) throw toServiceError(res.error, 'Could not load the upload history.')
  return { rows: res.data || [], truncated: Boolean(res.truncated) }
}

/** The parsed rows of one upload, in file order (removed rows last). */
export async function listUploadRows(uploadId) {
  if (blank(uploadId)) throw new ServiceError('Choose an upload first.', 'upload_required')
  const run = (cols) => fetchAllPages((a, b) => supabase
    .from('workshop_status_upload_rows')
    .select(cols)
    .eq('upload_id', uploadId)
    .order('row_number', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .range(a, b), { max: MAX_ROWS_PER_UPLOAD })
  let res = await run(`${UPLOAD_ROW_COLS},${ROW_CONFLICT_COLS}`)
  if (res.error && isMissingColumn(res.error)) res = await run(UPLOAD_ROW_COLS)
  if (res.error) throw toServiceError(res.error, 'Could not load the rows of this upload.')
  return { rows: res.data || [], truncated: Boolean(res.truncated) }
}

/**
 * Details of the upload_confirmed event (summary + applied conflict choices),
 * or null when it is not readable (no activity permission) or not confirmed.
 * Never throws: the detail view works without it.
 */
export async function getUploadConfirmDetails(uploadId) {
  if (blank(uploadId)) return null
  try {
    const { data, error } = await supabase
      .from('workshop_status_events')
      .select('details,created_at,actor_name')
      .eq('upload_id', uploadId)
      .eq('event_type', 'upload_confirmed')
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) return null
    return data?.[0]?.details || null
  } catch {
    return null
  }
}
