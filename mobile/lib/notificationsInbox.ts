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
 * to go - the row is still marked read on tap).
 *
 * THIS IS THE ONE TAP MAPPING. The in-app notifications list AND the push-tap
 * handler in app/_layout.tsx both call it. They used to disagree: the list
 * covered every kind while the root layout hardcoded three, so an approval,
 * an assignment, a parts request or an accident push tapped from the shade did
 * nothing at all. A second copy of a routing rule always drifts from the first.
 *
 * EVERY ROUTE RETURNED HERE MUST RESOLVE UNDER app/. Two of them did not:
 * `/(app)/inspection` and `/(app)/accident` are DIRECTORIES with no index file
 * ([id].tsx / new.tsx / approvals/ and [id].tsx / case.tsx / dashboard.tsx /
 * report.tsx respectively), and expo-router only addresses a folder by its
 * folder path when that folder has an `index`. Tapping an inspection or an
 * accident notification therefore landed the user on expo-router's raw
 * "Unmatched Route" developer screen. __tests__/notificationRoutes.test.ts now
 * resolves every route this function can return against the real route table
 * read off the filesystem, so a folder path can never ship again.
 */
/** Extra fields a PUSH payload may carry (the notifications table has no link
 * or asset column - only type / entity_type / entity_id). All optional. */
export interface RouteHints {
  entity_id?: string | null
  /** Web path the notification points at, e.g. '/daily-ops/workshop'. Push data only. */
  link?: string | null
  /** Asset number, when a push names the vehicle but not the record id. */
  asset_no?: string | null
}

/** Workshop Status (the daily workshop sheet), NOT Workshop Live job activity. */
export function isWorkshopStatusNotification(
  n: Pick<AppNotification, 'type' | 'entity_type'> & RouteHints,
): boolean {
  const t = String(n.type || '').toLowerCase()
  const k = String(n.entity_type || '').toLowerCase()
  const link = String(n.link || '').toLowerCase()
  if (link.includes('/daily-ops/workshop') || link.includes('/workshop-status')) return true
  const norm = (v: string) => v.replace(/[\s.-]+/g, '_')
  return [t, k].some((v) => {
    const x = norm(v)
    return x.startsWith('workshop_status') || x.includes('daily_ops_workshop') || x.startsWith('daily_ops')
  })
}

export function notificationRoute(n: Pick<AppNotification, 'type' | 'entity_type'> & RouteHints): string | null {
  const t = String(n.type || '').toLowerCase()
  const k = String(n.entity_type || n.type || '').toLowerCase()
  if (k === 'driver_workspace' || t === 'driver_workspace') return '/(app)/driver-workspace'

  // Workshop Status: a daily upload or an assignment on the workshop sheet.
  // Checked BEFORE the generic workshop bucket below (which routes job cards to
  // Workshop Live). Opens the record when the row names it, else the list.
  if (isWorkshopStatusNotification(n)) {
    // Only a RECORD id opens the record; an upload/batch id would be a dead end.
    const ent = String(n.entity_type || '').toLowerCase().replace(/[\s.-]+/g, '_')
    const isRecord = ent === 'workshop_status' || ent === 'workshop_status_record' || ent === 'workshop_status_records'
    const id = isRecord ? String(n.entity_id || '').trim() : ''
    if (id) return `/(app)/workshop-status/${encodeURIComponent(id)}`
    const asset = String(n.asset_no || '').trim()
    if (asset) return `/(app)/workshop-status/${encodeURIComponent(asset)}`
    return '/(app)/workshop-status'
  }

  // 1. LOCAL device notifications (lib/notifications.ts). Matched on the EXACT
  //    type and matched FIRST, because their wording overlaps the entity
  //    buckets below - 'inspection_reminder' contains "inspection" but must
  //    open a NEW inspection, not somebody else's approval queue.
  if (t === 'inspection_reminder') return '/(app)/inspection/new'
  if (t === 'sync_success' || t === 'sync_failure' || t === 'photo_failure') {
    // Profile carries the offline queue: sync, retry and clear all live there.
    return '/(app)/profile'
  }
  if (t === 'wash_due') return '/(app)/washing'
  if (t === 'approval' && (k === 'work_order' || k === 'tyre_change')) return '/(app)/approvals'

  // 2. A decision on YOUR OWN submission goes to your own-work history, not the
  //    generic hub; a checklist decision goes to the checklists hub.
  if (t === 'approval_decision') {
    return k.includes('checklist') ? '/(app)/checklists' : '/(app)/history'
  }

  // 3. Checklist first: it is more specific than the workshop bucket below,
  //    which would otherwise swallow a 'checklist_assignment' on `assign`.
  if (k.includes('checklist')) return '/(app)/checklists/approvals'

  // 4. Workshop work. Kept AHEAD of the inspection test on purpose: a
  //    "Quality Inspection" job card is workshop work, not a tyre inspection.
  if (k.includes('assign') || k.includes('work_order') || k.includes('workorder') || k.includes('job') || k.includes('parts') || k.includes('qc') || k.includes('workshop')) {
    return '/(app)/workshop'
  }

  // 5. An inspection notification that is not a decision on your own work is a
  //    request to SIGN somebody else's (V267 targets the approver roles), so
  //    the approval queue is the screen that can act on it. There is no
  //    inspection index to send them to and inventing one would just be a menu.
  if (k.includes('inspection')) return '/(app)/inspection/approvals'

  // 6. The accident register. `case`/`report`/`[id]` all need a specific id we
  //    are not given here, and the dashboard is the list that leads to any of
  //    them - so it is right for an accident, an incident and a claim alike.
  if (k.includes('accident') || k.includes('incident') || k.includes('claim')) {
    return '/(app)/accident/dashboard'
  }

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
  if (k.includes('broadcast')) return 'megaphone-outline'
  if (k.includes('alert')) return 'notifications-outline'
  return 'notifications-outline'
}
