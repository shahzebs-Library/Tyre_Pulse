/**
 * Notifications inbox - every work notification for the signed-in user
 * (assignments, approvals, alerts, parts, QC, accidents...). Reads the
 * `notifications` table (own rows via RLS), marks read on tap, and navigates to
 * the related screen when there is one. Realtime + focus + pull-to-refresh keep
 * it live; the Home bell badge mirrors the unread count.
 */
import { useCallback, useEffect, useState } from 'react'
import { View, FlatList, TouchableOpacity, RefreshControl, StyleSheet, DeviceEventEmitter } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Screen, AppText, EmptyState, ErrorState, Loading } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import {
  listNotifications, markRead, markAllRead, notificationRoute, notificationIcon,
  type AppNotification,
} from '../../lib/notificationsInbox'

export const UNREAD_EVENT = 'tyrepulse:notifications-unread'

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function NotificationsScreen() {
  const { theme } = useTheme()
  const { profile } = useAuth()
  const { t } = useLanguage()
  const router = useRouter()
  const c = theme.color
  const userId = profile?.id || ''

  const [rows, setRows] = useState<AppNotification[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!userId) { setRows([]); return }
    setError(null)
    try {
      const data = await listNotifications(userId, { limit: 100 })
      setRows(data)
      const unread = data.filter((n) => !n.read).length
      DeviceEventEmitter.emit(UNREAD_EVENT, unread)
    } catch (e: any) {
      setError(toUserMessage(e, t('modules.notifications.loadFail')))
      setRows((prev) => prev ?? [])
    }
  }, [userId, t])

  useEffect(() => { load() }, [load])
  useFocusEffect(useCallback(() => { load() }, [load]))

  // Live updates for this user's rows.
  useEffect(() => {
    if (!userId) return undefined
    const ch = supabase
      .channel(`notif-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [userId, load])

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [load])

  const openRow = useCallback(async (n: AppNotification) => {
    if (!n.read) {
      setRows((prev) => (prev ? prev.map((r) => (r.id === n.id ? { ...r, read: true } : r)) : prev))
      markRead(n.id).catch(() => {})
      DeviceEventEmitter.emit(UNREAD_EVENT, (rows || []).filter((r) => !r.read && r.id !== n.id).length)
    }
    const route = notificationRoute(n)
    if (route) router.push(route as any)
  }, [router, rows])

  const onMarkAll = useCallback(async () => {
    if (!userId) return
    setRows((prev) => (prev ? prev.map((r) => ({ ...r, read: true })) : prev))
    DeviceEventEmitter.emit(UNREAD_EVENT, 0)
    try { await markAllRead(userId) } catch { /* optimistic; RLS enforces */ }
  }, [userId])

  const unread = (rows || []).filter((n) => !n.read).length

  return (
    <Screen padded={false}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <AppText variant="h2">{t('modules.notifications.title')}</AppText>
        {unread > 0 ? (
          <TouchableOpacity onPress={onMarkAll} accessibilityLabel={t('modules.notifications.markAll')}>
            <AppText variant="body" color="secondary">{t('modules.notifications.markAll')}</AppText>
          </TouchableOpacity>
        ) : null}
      </View>

      {rows === null ? (
        <Loading label={t('modules.notifications.loading')} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState icon="notifications-outline" title={t('modules.notifications.emptyTitle')} message={t('modules.notifications.emptyBody')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          renderItem={({ item }) => {
            const route = notificationRoute(item)
            return (
              <TouchableOpacity
                onPress={() => openRow(item)}
                activeOpacity={route || !item.read ? 0.7 : 1}
                style={[styles.row, { backgroundColor: item.read ? c.surface : c.surfaceAlt, borderColor: c.border }]}
              >
                <View style={[styles.icon, { backgroundColor: c.surfaceSunken }]}>
                  <Ionicons name={notificationIcon(item) as any} size={20} color={item.read ? c.textMuted : c.primary} />
                </View>
                <View style={styles.body}>
                  <View style={styles.titleRow}>
                    <AppText variant="body" style={{ fontWeight: item.read ? '500' : '700', flexShrink: 1 }}>
                      {item.title || t('modules.notifications.title')}
                    </AppText>
                    {!item.read ? <View style={[styles.dot, { backgroundColor: c.primary }]} /> : null}
                  </View>
                  {item.body ? <AppText variant="caption" color="muted" style={styles.msg}>{item.body}</AppText> : null}
                  <AppText variant="caption" color="muted">{timeAgo(item.created_at)}</AppText>
                </View>
                {route ? <Ionicons name="chevron-forward" size={16} color={c.textMuted} /> : null}
              </TouchableOpacity>
            )
          }}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  list: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  msg: { marginBottom: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: 'auto' },
})
