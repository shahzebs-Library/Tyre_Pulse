import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRealtime } from '../../hooks/useRealtime'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { canInspect } from '../../lib/permissions'

type FilterKey = 'open' | 'mine' | 'all'

interface Task {
  id: string
  title: string
  priority: string | null
  status: string | null
  site: string | null
  asset_no: string | null
  description: string | null
  assigned_to: string | null
  due_date: string | null
  created_at: string | null
}

const PRIORITY_COLOR: Record<string, string> = {
  Critical: '#dc2626', High: '#ea580c', Medium: '#ca8a04', Low: '#16a34a',
}
const FILTERS: { key: FilterKey; labelKey: string }[] = [
  { key: 'open', labelKey: 'modules.tasks.filterOpen' },
  { key: 'mine', labelKey: 'modules.tasks.filterMine' },
  { key: 'all', labelKey: 'modules.tasks.filterAll' },
]

export default function TasksScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('open')
  const [busyId, setBusyId] = useState<string | null>(null)

  const { allowed } = useRoleGuard(['inspector', 'tyre_man', 'admin', 'manager', 'director'])
  const textAlign = isRTL ? 'right' : 'left'
  const canResolve = canInspect(profile?.role)
  const myName = profile?.full_name ?? profile?.username ?? ''

  const load = useCallback(async () => {
    let q = supabase
      .from('corrective_actions')
      .select('id,title,priority,status,site,asset_no,description,assigned_to,due_date,created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
    const { data } = await q
    setTasks((data as Task[]) ?? [])
    setLoading(false)
  }, [profile?.country])

  useEffect(() => { load() }, [load])
  useRealtime('corrective_actions', load)

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function resolve(task: Task) {
    if (!canResolve || busyId) return
    setBusyId(task.id)
    const { error } = await supabase
      .from('corrective_actions')
      .update({ status: 'Closed', resolved_at: new Date().toISOString(), closed_by: profile?.id ?? null })
      .eq('id', task.id)
    setBusyId(null)
    if (error) { Alert.alert(t('modules.tasks.couldNotResolve'), toUserMessage(error)); return }
    load()
  }

  const shown = useMemo(() => {
    const isOpen = (s: string | null) => (s ?? '').toLowerCase() !== 'closed'
    if (filter === 'open') return tasks.filter(t => isOpen(t.status))
    if (filter === 'mine') return tasks.filter(t => isOpen(t.status) && (t.assigned_to ?? '') === myName)
    return tasks
  }, [tasks, filter, myName])

  const openCount = useMemo(() => tasks.filter(t => (t.status ?? '').toLowerCase() !== 'closed').length, [tasks])

  if (!allowed) return null

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { textAlign }]}>{t('modules.tasks.title')}</Text>
          <Text style={[styles.sub, { textAlign }]}>{openCount} {t('modules.tasks.open')}</Text>
        </View>
        {canResolve && (
          <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/(app)/report-issue')}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={[styles.calendarLink, isRTL && styles.rowR]}
        onPress={() => router.push('/(app)/calendar')}
        activeOpacity={0.8}
      >
        <View style={styles.calendarIcon}>
          <Ionicons name="calendar-outline" size={18} color="#0369a1" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.calendarTitle, { textAlign }]}>{t('modules.tasks.openCalendar')}</Text>
          <Text style={[styles.calendarSub, { textAlign }]}>{t('modules.tasks.openCalendarSub')}</Text>
        </View>
        <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color="#94a3b8" />
      </TouchableOpacity>

      <View style={styles.filters}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{t(f.labelKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>{t('modules.tasks.none')}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const closed = (item.status ?? '').toLowerCase() === 'closed'
            const pc = PRIORITY_COLOR[item.priority ?? ''] ?? '#64748b'
            const overdue = !closed && item.due_date && new Date(item.due_date) < new Date()
            return (
              <View style={[styles.card, closed && { opacity: 0.6 }]}>
                <View style={[styles.priBar, { backgroundColor: pc }]} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.cardTitle, { textAlign }]} numberOfLines={2}>{item.title}</Text>
                  <Text style={[styles.cardMeta, { textAlign }]}>
                    {[item.site, item.asset_no].filter(Boolean).join(' · ') || '-'}
                  </Text>
                  <View style={[styles.badges, isRTL && styles.rowR]}>
                    <View style={[styles.badge, { backgroundColor: pc + '1a' }]}>
                      <Text style={[styles.badgeText, { color: pc }]}>{item.priority ?? t('modules.tasks.normal')}</Text>
                    </View>
                    {item.due_date && (
                      <View style={[styles.badge, overdue && { backgroundColor: 'rgba(220,38,38,0.1)' }]}>
                        <Text style={[styles.badgeText, overdue && { color: '#dc2626' }]}>
                          {t('modules.tasks.due')} {new Date(item.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </Text>
                      </View>
                    )}
                    {closed && (
                      <View style={[styles.badge, { backgroundColor: 'rgba(22,163,74,0.12)' }]}>
                        <Text style={[styles.badgeText, { color: '#15803d' }]}>{t('modules.tasks.resolved')}</Text>
                      </View>
                    )}
                  </View>
                </View>
                {!closed && canResolve && (
                  <TouchableOpacity style={styles.resolveBtn} onPress={() => resolve(item)} disabled={busyId === item.id}>
                    {busyId === item.id
                      ? <ActivityIndicator size="small" color="#16a34a" />
                      : <Ionicons name="checkmark-circle" size={26} color="#16a34a" />}
                  </TouchableOpacity>
                )}
              </View>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  rowR: { flexDirection: 'row-reverse' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  sub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  newBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  calendarLink: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10, backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  calendarIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(3,105,161,0.08)', alignItems: 'center', justifyContent: 'center' },
  calendarTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  calendarSub: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  chipTextActive: { color: '#fff' },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, paddingLeft: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  priBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  cardMeta: { fontSize: 12, color: '#94a3b8' },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  badge: { backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#64748b' },
  resolveBtn: { width: 40, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#94a3b8' },
})
