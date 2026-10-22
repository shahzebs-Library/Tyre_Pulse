/**
 * Explicit push-delivery states for Message the Team manager reporting.
 *
 * Evidence sources (nothing here can prove OS-level delivery to a handset):
 *  - workflow_notifications row (queue + edge-function/FCM provider result)
 *  - team_push_device_events (app-observed: received_foreground / opened_by_user)
 *
 * States:
 *   queued            waiting for the sender job (pending)
 *   accepted_by_fcm   provider (FCM/Expo) accepted at least one device message. NOT OS delivery.
 *   opened_in_app     at least one employee opened the message from a push (device-reported)
 *   failed            queue row failed/skipped, or sent but the provider accepted 0 devices
 *   not_queued        (headline only) no push record exists, push off, or not visible to this user
 *
 * States are not mutually exclusive across devices: `summarizeDelivery` returns one
 * headline state (opened > accepted > queued > failed) plus the raw counts.
 */
export const DELIVERY_STATES = Object.freeze(['queued', 'accepted_by_fcm', 'opened_in_app', 'failed'])

export const DELIVERY_LABELS = Object.freeze({
  queued: 'Queued',
  accepted_by_fcm: 'Accepted by push provider',
  opened_in_app: 'Opened in app',
  failed: 'Failed',
  not_queued: 'No push queued',
})

export const DELIVERY_HELP = Object.freeze({
  queued: 'Waiting to be sent to the push provider.',
  accepted_by_fcm: 'The push provider accepted the message. This does not confirm it reached or was shown on a phone.',
  opened_in_app: 'Employees opened the message from a notification (reported by the app).',
  failed: 'The push could not be sent or no device accepted it.',
  not_queued: 'No push delivery record is available for this message.',
})

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 }

/** Classify one workflow_notifications row into a state key. */
export function queueRowState(row) {
  if (!row) return 'not_queued'
  const status = String(row.status || '').toLowerCase()
  if (status === 'pending') return 'queued'
  if (status === 'delivered') {
    // "delivered" in the queue = the edge function returned success, not that a phone showed it.
    return num(row.result?.push) > 0 ? 'accepted_by_fcm' : 'failed'
  }
  return 'failed'
}

/**
 * @param {Array} queueRows workflow_notifications rows for the broadcast
 * @param {Array} pushEvents team_push_device_events rows for the broadcast
 */
export function summarizeDelivery(queueRows = [], pushEvents = []) {
  const rows = Array.isArray(queueRows) ? queueRows : []
  const events = Array.isArray(pushEvents) ? pushEvents : []
  const counts = { queued: 0, accepted_by_fcm: 0, opened_in_app: 0, failed: 0 }
  let acceptedDevices = 0
  let lastError = null
  for (const row of rows) {
    const s = queueRowState(row)
    if (s in counts) counts[s] += 1
    if (s === 'accepted_by_fcm') acceptedDevices += num(row.result?.push)
    if (s === 'failed' && row.last_error) lastError = String(row.last_error).slice(0, 200)
  }
  const openedUsers = new Set(events.filter((e) => e.event_type === 'opened_by_user').map((e) => e.user_id))
  const foregroundUsers = new Set(events.filter((e) => e.event_type === 'received_foreground').map((e) => e.user_id))
  counts.opened_in_app = openedUsers.size
  let headline = 'not_queued'
  if (counts.opened_in_app > 0) headline = 'opened_in_app'
  else if (counts.accepted_by_fcm > 0) headline = 'accepted_by_fcm'
  else if (counts.queued > 0) headline = 'queued'
  else if (counts.failed > 0) headline = 'failed'
  return {
    headline,
    counts,
    acceptedDevices,
    foregroundUsers: foregroundUsers.size,
    openedUsers: openedUsers.size,
    lastError,
    hasQueueRecord: rows.length > 0,
  }
}
