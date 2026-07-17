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

export async function registerPushToken(userId: string): Promise<string | null> {
  try {
    const granted = await requestNotificationPermission()
    if (!granted) return null

    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: '3ed4e62f-e91f-4c78-b1eb-9b7310c08255',
    })).data

    // Persist to profiles so the server can send targeted pushes later.
    await supabase
      .from('profiles')
      .update({ push_token: token, push_token_updated_at: new Date().toISOString() })
      .eq('id', userId)

    return token
  } catch (err) {
    if (__DEV__) console.warn('[Notifications] Push token registration failed:', err)
    return null
  }
}

/**
 * Clear this user's push token from their profile on logout, so pushes targeted
 * at them are not delivered to a shared device now used by another account.
 * Best-effort - must be called while still authenticated (RLS-scoped update).
 */
export async function clearPushToken(userId: string): Promise<void> {
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
