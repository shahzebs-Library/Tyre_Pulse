/**
 * notificationsInbox.ts - read + mark the in-app notification inbox on mobile.
 *
 * The `notifications` table is populated server-side (approvals, job
 * assignments, alerts, accident closures, parts, QC ...). RLS lets a user only
 * SELECT and UPDATE their OWN rows, so this service never inserts - it lists,
 * counts unread, and marks read. Every call degrades honestly (never throws to
 * the screen; callers still wrap in toUserMessage for user-facing errors).
 */
import { supabase } from './supabase'

export type AppNotification = {
  id: string
  user_id: string
  type: string | null
  title: string | null
  body: string | null
  entity_type: string | null
  entity_id: string | null
  read: boolean
  created_at: string
}

const COLS = 'id,user_id,type,title,body,entity_type,entity_id,read,created_at'

/** List a user's notifications, newest first. []-degrades. */
export async function listNotifications(
  userId: string,
  { unreadOnly = false, limit = 100 }: { unreadOnly?: boolean; limit?: number } = {},
): Promise<AppNotification[]> {
  if (!userId) return []
  try {
    let q = supabase
      .from('notifications')
      .select(COLS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (unreadOnly) q = q.eq('read', false)
    const { data, error } = await q
    if (error) return []
    return (data as AppNotification[]) || []
  } catch {
    return []
  }
}

/** Count unread notifications for the badge. 0-degrades. */
export async function unreadCount(userId: string): Promise<number> {
  if (!userId) return 0
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false)
    if (error) return 0
    return count || 0
  } catch {
    return 0
  }
}

/** Mark one notification read (own row; RLS enforces). */
export async function markRead(id: string): Promise<void> {
  if (!id) return
  await supabase.from('notifications').update({ read: true }).eq('id', id)
}

/** Mark every unread notification read for the user. */
export async function markAllRead(userId: string): Promise<void> {
  if (!userId) return
  await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
}

/**
 * Map a notification to an in-app route (or null when there is nowhere sensible
 * to go - the row is still marked read on tap). Only routes that exist under
 * app/(app) are returned.
 */
export function notificationRoute(n: Pick<AppNotification, 'type' | 'entity_type'>): string | null {
  const k = String(n.entity_type || n.type || '').toLowerCase()
  if (k.includes('assign') || k.includes('work_order') || k.includes('workorder') || k.includes('job') || k.includes('parts') || k.includes('qc') || k.includes('workshop')) {
    return '/(app)/workshop'
  }
  if (k.includes('inspection')) return '/(app)/inspection'
  if (k.includes('accident') || k.includes('incident') || k.includes('claim')) return '/(app)/accident'
  if (k.includes('alert')) return '/(app)/alerts'
  return null
}

/** A coarse icon name (Ionicons) per notification kind for the list. */
export function notificationIcon(n: Pick<AppNotification, 'type' | 'entity_type'>): string {
  const k = String(n.entity_type || n.type || '').toLowerCase()
  if (k.includes('assign') || k.includes('job') || k.includes('work')) return 'construct-outline'
  if (k.includes('approval') || k.includes('approve')) return 'checkmark-done-outline'
  if (k.includes('parts')) return 'cube-outline'
  if (k.includes('inspection')) return 'clipboard-outline'
  if (k.includes('accident') || k.includes('incident')) return 'warning-outline'
  if (k.includes('alert')) return 'notifications-outline'
  return 'notifications-outline'
}
