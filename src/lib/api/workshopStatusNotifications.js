/**
 * Workshop Status notifications service (Loop 12).
 *
 * Reads the caller's OWN rows of the existing per-user `notifications` table
 * (RLS: user_id = auth.uid()) whose type starts with "workshop_status". They
 * are written server-side only, by the notifier in migration
 * 20261007140000_workshop_status_notifications.sql; this module never inserts.
 * Read state goes through the existing mark_notification_read RPC, the same
 * path the global Notification Center uses, so marking a notice read here also
 * clears it there.
 */
import { supabase, toServiceError } from './_client'
import { markNotificationRead } from '../notifications'
import { WORKSHOP_NOTIFICATION_PREFIX, sortWorkshopNotices } from '../workshopStatus/notificationLinks'

const COLS = 'id,user_id,type,title,body,entity_type,entity_id,read,created_at'

/** The signed-in user's id, or null (no session). Never throws. */
export async function getCurrentUserId() {
  try {
    const { data } = await supabase.auth.getUser()
    return data?.user?.id || null
  } catch {
    return null
  }
}

/**
 * The caller's Workshop Status notifications, unread first then newest.
 * No session -> { rows: [] } (nothing to show, not an error).
 *
 * @returns {Promise<{ rows: object[], userId: string|null }>}
 */
export async function listMyWorkshopNotifications({ limit = 20, unreadOnly = false } = {}) {
  const userId = await getCurrentUserId()
  if (!userId) return { rows: [], userId: null }
  let q = supabase
    .from('notifications')
    .select(COLS)
    .eq('user_id', userId)
    .like('type', `${WORKSHOP_NOTIFICATION_PREFIX}%`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100))
  if (unreadOnly) q = q.eq('read', false)
  const { data, error } = await q
  if (error) throw toServiceError(error, 'Could not load your workshop notifications.')
  return { rows: sortWorkshopNotices(data || [], limit), userId }
}

/** Mark notices read (own rows only - the RPC checks). Resolves with the ids that failed. */
export async function markWorkshopNotificationsRead(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  const results = await Promise.all(list.map((nid) => markNotificationRead(nid)))
  return list.filter((_, i) => results[i]?.error)
}
