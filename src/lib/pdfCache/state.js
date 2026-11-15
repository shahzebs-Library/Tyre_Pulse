/**
 * Pure rules of the stored-PDF job lifecycle. No I/O.
 *
 * MIRROR: the status values and the backoff of public.pdf_cache_fail in
 * supabase/pending_migrations/20261117090000_report_pdf_cache.sql.
 *
 *   queued -> processing -> ready
 *                 |-> retry_scheduled -> processing ... (bounded) -> failed
 * A processing job whose lease expired is treated as queued: anyone authorised may take it.
 */
export const STATUSES = Object.freeze(['queued', 'processing', 'ready', 'failed', 'retry_scheduled'])
export const MAX_ATTEMPTS = 5
export const LEASE_SECONDS = 180
export const BACKOFF_BASE_MS = 30_000
export const BACKOFF_CAP_MS = 60 * 60 * 1000

/** Wait before retry number `attempts` (1 = first failure): 30 s, 1 min, 2 min ... capped at 1 hour. */
export function backoffMs(attempts) {
  const n = Math.max(1, Math.floor(Number(attempts) || 1))
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (n - 1))
}

/** What a failure turns a processing job into. */
export function afterFailure({ attempts = 0, maxAttempts = MAX_ATTEMPTS, retryable = true, countAttempt = true } = {}) {
  const next = attempts + (countAttempt ? 1 : 0)
  if (!countAttempt) return { status: 'queued', attempts: next, waitMs: 0 }
  if (retryable && next < maxAttempts) return { status: 'retry_scheduled', attempts: next, waitMs: backoffMs(next) }
  return { status: 'failed', attempts: next, waitMs: 0 }
}

/** The state a reader should act on: an abandoned processing job counts as queued. */
export function effectiveState(row, now = Date.now()) {
  if (!row) return 'missing'
  if (row.status === 'processing' && row.lease_expires_at && new Date(row.lease_expires_at).getTime() <= now) return 'queued'
  return row.status
}

/**
 * What the screen shows for a lookup result.
 *   ready            -> Ready (download is instant)
 *   processing       -> Preparing (somebody is generating it now)
 *   missing / queued -> Not prepared yet; when an older stored copy exists: Update available
 *   retry_scheduled  -> Preparing again shortly
 *   failed           -> Failed, Retry
 */
export function displayStatus(lookup) {
  if (!lookup || lookup.ok === false) return { key: 'unavailable', label: 'Not available', tone: 'muted' }
  const hasOld = !!lookup.previous
  switch (lookup.state) {
    case 'ready': return { key: 'ready', label: 'Ready', tone: 'good' }
    case 'processing': return { key: 'preparing', label: 'Preparing', tone: 'info' }
    case 'retry_scheduled': return { key: 'retrying', label: 'Preparing again shortly', tone: 'warn' }
    case 'failed': return { key: 'failed', label: 'Failed', tone: 'bad' }
    default:
      return hasOld
        ? { key: 'update_available', label: 'Update available', tone: 'warn' }
        : { key: 'not_prepared', label: 'Not prepared yet', tone: 'muted' }
  }
}

/** Plain sentences for the refusal reasons the server returns. */
export const REASON_MESSAGES = Object.freeze({
  not_signed_in: 'Sign in again to download this report.',
  not_available: 'This report is not available to your account, or the record no longer exists.',
  bad_request: 'The report request was not valid. Refresh the page and retry.',
  not_allowed: 'Only a manager or administrator can regenerate a stored report.',
  approved_needs_admin: 'This report belongs to an approved record. Only an administrator can replace it.',
  approved_needs_authorisation: 'This report belongs to an approved record. Your account is not authorised to regenerate it. Ask an administrator.',
  over_limit: 'Too many reports for one download. Select fewer records and download again.',
  admin_only: 'Only an administrator can change these settings.',
  retention_below_minimum: 'Superseded copies must be kept for at least 90 days.',
  retention_range: 'Retention must be between 90 and 3650 days.',
  bulk_limit_range: 'The bulk download limit must be between 1 and 500.',
  reason_required: 'Give a short reason for regenerating an approved report.',
  not_your_job: 'Another person finished or took over this report. Retry the download.',
  already_stored: 'This report is already stored and cannot be overwritten.',
  bad_checksum: 'The report file could not be verified. Retry the download.',
  size_mismatch: 'The stored report file is incomplete. Retry the download.',
  file_missing: 'The report file did not finish uploading. Retry the download.',
  not_a_pdf: 'The stored file is not a PDF. Retry the download.',
})

export function reasonMessage(reason, fallback = 'The report could not be prepared. Retry the download.') {
  return REASON_MESSAGES[reason] || fallback
}
