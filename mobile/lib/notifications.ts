/**
 * TyrePulse Notification Manager
 *
 * Handles:
 * - Permission requests + Expo push token registration
 * - Local notifications: sync failures, sync success summary
 * - Scheduled local reminders: daily inspection prompts
 * - Token persistence to Supabase `profiles` table
 */

import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { supabase } from './supabase'

// ── Default behaviour: show alert + play sound when app is foregrounded ──────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

// ── Channel IDs ───────────────────────────────────────────────────────────────
export const CHANNEL_SYNC    = 'sync'
export const CHANNEL_REMIND  = 'reminders'
export const CHANNEL_ALERTS  = 'alerts'

// ── One-time setup on app boot ───────────────────────────────────────────────

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return

  await Promise.all([
    Notifications.setNotificationChannelAsync(CHANNEL_SYNC, {
      name: 'Sync Status',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    }),
    Notifications.setNotificationChannelAsync(CHANNEL_REMIND, {
      name: 'Inspection Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    }),
    Notifications.setNotificationChannelAsync(CHANNEL_ALERTS, {
      name: 'Fleet Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 500, 250, 500],
    }),
  ])
}

// ── Permission request ────────────────────────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) return false

  const { status: existing } = await Notifications.getPermissionsAsync()
  if (existing === 'granted') return true

  const { status } = await Notifications.requestPermissionsAsync()
  return status === 'granted'
}

// ── Push token registration ───────────────────────────────────────────────────

/** True when a Supabase RPC error means the function itself is not deployed yet
 *  (pre-V321 apply). In that case we degrade to the profiles.push_token path
 *  rather than treating it as a real persistence failure. */
function isMissingRpc(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (err.code === 'PGRST202' || err.code === '404') return true
  const m = (err.message || '').toLowerCase()
  return m.includes('could not find') || m.includes('does not exist')
}

/**
 * Register this device's Expo push token.
 *
 * Multi-device (V321): the token is upserted into `user_devices` via the
 * `register_user_device` RPC (one row per physical device, so a second phone no
 * longer overwrites the first). The legacy `profiles.push_token` column is ALSO
 * written for backward compatibility with the existing server push consumers
 * that still read it. Persistence is verified: if neither path stored the token
 * we return null so the caller sees the failure instead of a false success.
 *
 * Returns the Expo token on success, or null if permission was denied, the
 * token could not be obtained, or it could not be persisted anywhere.
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  try {
    const granted = await requestNotificationPermission()
    if (!granted) return null

    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: '3ed4e62f-e91f-4c78-b1eb-9b7310c08255',
    })).data

    if (!token) return null

    // 1. Multi-device registry (authoritative going forward). Best-effort:
    //    a missing RPC (pre-apply) degrades to the profiles path below.
    let devicePersisted = false
    let rpcMissing = false
    try {
      const { error: rpcErr } = await supabase.rpc('register_user_device', {
        p_push_token: token,
        p_platform: Platform.OS,
        p_device_id: Device.modelName ?? null,
        p_app_version: Constants.expoConfig?.version ?? null,
      })
      if (rpcErr) {
        rpcMissing = isMissingRpc(rpcErr)
        if (!rpcMissing && __DEV__) {
          console.warn('[Notifications] register_user_device failed:', rpcErr)
        }
      } else {
        devicePersisted = true
      }
    } catch (rpcEx) {
      if (__DEV__) console.warn('[Notifications] register_user_device threw:', rpcEx)
    }

    // 2. Legacy compatibility write (server consumers still read this column).
    //    Verify the result - a silent error must not read as success.
    let profilePersisted = false
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ push_token: token, push_token_updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (profileErr) {
      if (__DEV__) console.warn('[Notifications] profiles.push_token write failed:', profileErr)
    } else {
      profilePersisted = true
    }

    // The RPC also stamps profiles.push_token itself, so a successful device
    // registration counts as persisted even if the direct profiles write failed.
    if (!devicePersisted && !profilePersisted) {
      if (__DEV__) console.warn('[Notifications] push token was not persisted to any store')
      return null
    }

    return token
  } catch (err) {
    if (__DEV__) console.warn('[Notifications] Push token registration failed:', err)
    return null
  }
}

/**
 * Clear this user's push token on logout, so pushes targeted at them are not
 * delivered to a shared device now used by another account. Soft-revokes this
 * device's row in `user_devices` (V321) AND clears the legacy
 * `profiles.push_token` column. Best-effort - must be called while still
 * authenticated (RLS-scoped writes). Signature kept: clearPushToken(userId).
 */
export async function clearPushToken(userId: string): Promise<void> {
  // 1. Soft-revoke this device's row in the multi-device registry. Best-effort:
  //    a missing RPC (pre-apply) or an unobtainable token is a no-op here.
  try {
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: '3ed4e62f-e91f-4c78-b1eb-9b7310c08255',
    })).data
    if (token) {
      const { error: rpcErr } = await supabase.rpc('revoke_user_device', {
        p_push_token: token,
      })
      if (rpcErr && !isMissingRpc(rpcErr) && __DEV__) {
        console.warn('[Notifications] revoke_user_device failed:', rpcErr)
      }
    }
  } catch (err) {
    if (__DEV__) console.warn('[Notifications] revoke_user_device skipped:', err)
  }

  // 2. Legacy compatibility: clear profiles.push_token so single-column
  //    consumers stop targeting this handset for the signed-out user.
  try {
    await supabase
      .from('profiles')
      .update({ push_token: null, push_token_updated_at: new Date().toISOString() })
      .eq('id', userId)
  } catch (err) {
    if (__DEV__) console.warn('[Notifications] clearPushToken failed:', err)
  }
}

// ── Local notification helpers ────────────────────────────────────────────────

export async function notifySyncSuccess(synced: number): Promise<void> {
  if (synced === 0) return
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '✅ Inspections Synced',
      body: `${synced} inspection${synced !== 1 ? 's' : ''} uploaded to TyrePulse.`,
      sound: true,
      data: { type: 'sync_success' },
    },
    trigger: null, // fire immediately
    identifier: 'sync_success',
  })
}

export async function notifySyncFailure(failed: number): Promise<void> {
  if (failed === 0) return
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '⚠️ Sync Failed',
      body: `${failed} inspection${failed !== 1 ? 's' : ''} could not be uploaded. Tap to retry.`,
      sound: true,
      data: { type: 'sync_failure' },
    },
    trigger: null,
    identifier: 'sync_failure',
  })
}

export async function notifyPhotoUploadFailure(position: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '📷 Photo Not Saved',
      body: `Photo for tyre ${position} could not upload. It is saved locally only.`,
      sound: false,
      data: { type: 'photo_failure', position },
    },
    trigger: null,
    identifier: `photo_${position}`,
  })
}

/**
 * Local "vehicles due for wash" reminder. Fires immediately (no server cron)
 * when the washing screen finds assets past their wash interval. Deduped by a
 * fixed identifier so it replaces, rather than stacks, a prior reminder.
 */
export async function notifyWashDue(count: number): Promise<void> {
  if (count <= 0) return
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Vehicles due for wash',
      body: `${count} vehicle${count !== 1 ? 's are' : ' is'} due for washing again.`,
      sound: true,
      data: { type: 'wash_due' },
    },
    trigger: null,
    identifier: 'wash_due',
  })
}

// ── Inspection reminders ──────────────────────────────────────────────────────

/** Schedule a daily inspection reminder at the given hour:minute (24-hour). */
export async function scheduleDailyInspectionReminder(
  hour = 7,
  minute = 0,
): Promise<string> {
  // Cancel any existing daily reminder before scheduling a new one.
  await cancelDailyInspectionReminder()

  return Notifications.scheduleNotificationAsync({
    content: {
      title: '🔍 Daily Inspection Due',
      body: 'Start today\'s tyre inspection for your assigned vehicles.',
      sound: true,
      data: { type: 'inspection_reminder' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
    identifier: 'daily_inspection_reminder',
  })
}

export async function cancelDailyInspectionReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync('daily_inspection_reminder')
}

/** Returns the scheduled reminder trigger, or null if not set. */
export async function getDailyReminderTrigger(): Promise<{ hour: number; minute: number } | null> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync()
  const reminder = scheduled.find(n => n.identifier === 'daily_inspection_reminder')
  if (!reminder) return null

  const trigger = reminder.trigger as any
  if (trigger?.hour !== undefined) {
    return { hour: trigger.hour, minute: trigger.minute ?? 0 }
  }
  return null
}

// ── Notification tap handler ──────────────────────────────────────────────────

/**
 * Returns an Expo Notifications subscription that handles taps on notifications.
 * Call `subscription.remove()` in useEffect cleanup.
 */
export function addNotificationTapHandler(
  onTap: (type: string, data: Record<string, any>) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(response => {
    const data = (response.notification.request.content.data ?? {}) as Record<string, any>
    const type = (data.type as string) ?? 'unknown'
    onTap(type, data)
  })
}
