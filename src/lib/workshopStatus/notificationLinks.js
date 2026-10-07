/**
 * Workshop Status notifications (Loop 12) - pure deep-link logic.
 *
 * The notifications table carries only type / entity_type / entity_id, so the
 * link is rebuilt here from those three. It MIRRORS the `link` the server puts
 * in the push payload (migration 20261007140000_workshop_status_notifications
 * .sql, functions workshop_status_notify_upload / workshop_status_notify_scan).
 * CHANGE BOTH TOGETHER.
 *
 *   entity_type workshop_status_record  -> /daily-ops/workshop?record=<id>   (exact vehicle)
 *   upload review                       -> ?tab=upload
 *   upload released                     -> ?tab=removed  (the UI calls them "Released")
 *   everything else                     -> ?focus=<filter preset>
 */
import { UNASSIGNED } from './activeView'

export const WORKSHOP_STATUS_PATH = '/daily-ops/workshop'
export const WORKSHOP_NOTIFICATION_PREFIX = 'workshop_status'

/** Focus presets a link may carry (?focus=). */
export const WORKSHOP_FOCUS = Object.freeze(['mine', 'unassigned', 'not_today', 'over7', 'expected_today', 'ready'])

/** Server notice kind -> focus preset used when the notice covers several vehicles. */
const KIND_FOCUS = Object.freeze({
  workshop_status_upload_mine: 'mine',
  workshop_status_upload_unassigned: 'unassigned',
  workshop_status_update_missing: 'not_today',
  workshop_status_waiting_long: 'over7',
  workshop_status_long_down: 'over7',
  workshop_status_release_today: 'expected_today',
  workshop_status_no_responsible: 'unassigned',
  workshop_status_ready_release: 'ready',
  workshop_status_release_overdue: 'mine',
  workshop_status_missing_eta: 'mine',
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v) => (v == null ? '' : String(v).trim())

/** True for a row the Workshop Status notifier wrote. */
export function isWorkshopNotification(n) {
  return str(n?.type).toLowerCase().startsWith(WORKSHOP_NOTIFICATION_PREFIX)
}

/**
 * The in-app path a Workshop Status notification opens, or null when the row
 * is not one. Accepts both the raw table row (snake_case) and the Notification
 * Center shape (entityType / entityId).
 */
export function workshopNotificationLink(n) {
  if (!isWorkshopNotification(n)) return null
  const kind = str(n.type).toLowerCase()
  const entityType = str(n.entity_type ?? n.entityType).toLowerCase()
  const entityId = str(n.entity_id ?? n.entityId)

  if (kind === 'workshop_status_upload_review') return `${WORKSHOP_STATUS_PATH}?tab=upload`
  if (kind === 'workshop_status_upload_released') return `${WORKSHOP_STATUS_PATH}?tab=removed`
  if (entityType === 'workshop_status_record' && UUID_RE.test(entityId)) {
    return `${WORKSHOP_STATUS_PATH}?record=${encodeURIComponent(entityId)}`
  }
  const focus = KIND_FOCUS[kind]
  return focus ? `${WORKSHOP_STATUS_PATH}?focus=${focus}` : WORKSHOP_STATUS_PATH
}

/**
 * Active-vehicles filter patch for a focus preset (merged over emptyFilters()).
 * `mine` needs the signed-in user's id; without it the preset is not applied
 * (null) rather than showing an unrelated list.
 */
export function focusFilters(focus, userId) {
  switch (str(focus)) {
    case 'mine': return str(userId) ? { responsible: str(userId) } : null
    case 'unassigned': return { responsible: UNASSIGNED }
    case 'not_today': return { updated: 'not_today' }
    case 'over7': return { minDays: 7 }
    case 'expected_today': return { expectedToday: true }
    case 'ready': return { stage: 'Ready for Release' }
    default: return null
  }
}

/** Notices newest first, unread first; at most `limit`. Pure. */
export function sortWorkshopNotices(rows, limit = 20) {
  return (Array.isArray(rows) ? rows : [])
    .filter(isWorkshopNotification)
    .slice()
    .sort((a, b) => (Number(!!a.read) - Number(!!b.read)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, Math.max(0, limit))
}
