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
import { useModuleGuard } from '../../hooks/useRoleGuard'
import { canInspect } from '../../lib/permissions'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme } from '../../lib/theme'

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

import { withModuleGuard } from '../../components/ModuleGuard'
import { backTo } from '../../lib/goBack'

export default withModuleGuard(TasksScreen, 'tasks')

function TasksScreen() {
  const router = useRouter()
  const { t, isRTL } = useLanguage()
  const { profile } = useAuth()
  const { theme } = useTheme()
  const s = useMemo(() => makeStyles(theme), [theme])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('open')
  const [busyId, setBusyId] = useState<string | null>(null)

  const { allowed } = useModuleGuard('tasks')
  const textAlign = isRTL ? 'right' : 'left'
  const canResolve = canInspect(profile?.role)
  const myName = profile?.full_name ?? profile?.username ?? ''

  const load = useCallback(async () => {
    setError(null)
    try {
      let q = supabase
        .from('corrective_actions')
        .select('id,title,priority,status,site,asset_no,description,assigned_to,due_date,created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
      const { data, error: qErr } = await q
      if (qErr) throw qErr
      setTasks((data as Task[]) ?? [])
    } catch (e: any) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
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
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'} />
      <View style={[s.header, isRTL && s.rowR]}>
        <TouchableOpacity onPress={() => backTo(router, '/(app)')} style={s.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.mode === 'dark' ? theme.color.text : '#0f172a'} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { textAlign }]}>{t('modules.tasks.title')}</Text>
          <Text style={[s.sub, { textAlign }]}>{openCount} {t('modules.tasks.open')}</Text>
        </View>
        {canResolve && (
          <TouchableOpacity style={s.newBtn} onPress={() => router.push('/(app)/report-issue')}>
            <Ionicons name="add" size={20} color={theme.color.onPrimary} />
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={[s.calendarLink, isRTL && s.rowR]}
        onPress={() => router.push('/(app)/calendar')}
        activeOpacity={0.8}
      >
        <View style={s.calendarIcon}>
          <Ionicons name="calendar-outline" size={18} color={theme.mode === 'dark' ? theme.color.primary : '#0369a1'} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.calendarTitle, { textAlign }]}>{t('modules.tasks.openCalendar')}</Text>
          <Text style={[s.calendarSub, { textAlign }]}>{t('modules.tasks.openCalendarSub')}</Text>
        </View>
        <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={theme.color.textMuted} />
      </TouchableOpacity>

      <View style={s.filters}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[s.chip, filter === f.key && s.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[s.chipText, filter === f.key && s.chipTextActive]}>{t(f.labelKey)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={i => i.id}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
          ListEmptyComponent={
            error ? (
              <View style={s.empty}>
                <Ionicons name="cloud-offline-outline" size={48} color={theme.color.textMuted} />
                <Text style={s.emptyText}>{error}</Text>
                <TouchableOpacity onPress={load} style={{ marginTop: 14, backgroundColor: theme.color.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}>
                  <Text style={{ color: theme.color.onPrimary, fontWeight: '600' }}>{t('common.retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.empty}>
                <Ionicons name="checkmark-done-circle-outline" size={48} color={theme.color.textMuted} />
                <Text style={s.emptyText}>{t('modules.tasks.none')}</Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const closed = (item.status ?? '').toLowerCase() === 'closed'
            const pc = PRIORITY_COLOR[item.priority ?? ''] ?? theme.color.textMuted
            const overdue = !closed && item.due_date && new Date(item.due_date) < new Date()
            return (
              <View style={[s.card, closed && { opacity: 0.6 }]}>
                <View style={[s.priBar, { backgroundColor: pc }]} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[s.cardTitle, { textAlign }]} numberOfLines={2}>{item.title}</Text>
                  <Text style={[s.cardMeta, { textAlign }]}>
                    {[item.site, item.asset_no].filter(Boolean).join(' · ') || '-'}
                  </Text>
                  <View style={[s.badges, isRTL && s.rowR]}>
                    <View style={[s.badge, { backgroundColor: pc + '1a' }]}>
                      <Text style={[s.badgeText, { color: pc }]}>{item.priority ?? t('modules.tasks.normal')}</Text>
                    </View>
                    {item.due_date && (
                      <View style={[s.badge, overdue && { backgroundColor: theme.color.danger.soft }]}>
                        <Text style={[s.badgeText, overdue && { color: theme.color.danger.base }]}>
                          {t('modules.tasks.due')} {new Date(item.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </Text>
                      </View>
                    )}
                    {closed && (
                      <View style={[s.badge, { backgroundColor: theme.color.success.soft }]}>
                        <Text style={[s.badgeText, { color: theme.color.success.base }]}>{t('modules.tasks.resolved')}</Text>
                      </View>
                    )}
                  </View>
                </View>
                {!closed && canResolve && (
                  <TouchableOpacity style={s.resolveBtn} onPress={() => resolve(item)} disabled={busyId === item.id}>
                    {busyId === item.id
                      ? <ActivityIndicator size="small" color={theme.color.primary} />
                      : <Ionicons name="checkmark-circle" size={26} color={theme.color.primary} />}
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

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.mode === 'dark' ? c.bg : '#f0f5f1' },
    rowR: { flexDirection: 'row-reverse' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
    backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.06)' },
    title: { fontSize: 20, fontWeight: '800', color: theme.mode === 'dark' ? c.text : '#0f172a' },
    sub: { fontSize: 12, color: theme.mode === 'dark' ? c.textSecondary : '#64748b', marginTop: 2 },
    newBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
    calendarLink: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 10, backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.06)' },
    calendarIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: theme.mode === 'dark' ? c.surfaceAlt : 'rgba(3,105,161,0.08)', alignItems: 'center', justifyContent: 'center' },
    calendarTitle: { fontSize: 14, fontWeight: '700', color: theme.mode === 'dark' ? c.text : '#0f172a' },
    calendarSub: { fontSize: 11, color: theme.mode === 'dark' ? c.textMuted : '#94a3b8', marginTop: 2 },
    filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.08)' },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { fontSize: 12, fontWeight: '700', color: theme.mode === 'dark' ? c.textSecondary : '#64748b' },
    chipTextActive: { color: c.onPrimary },
    list: { padding: 16, gap: 10, paddingBottom: 40 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', borderRadius: 14, padding: 14, paddingLeft: 10, borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.06)' },
    priBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
    cardTitle: { fontSize: 14, fontWeight: '700', color: theme.mode === 'dark' ? c.text : '#0f172a' },
    cardMeta: { fontSize: 12, color: theme.mode === 'dark' ? c.textMuted : '#94a3b8' },
    badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
    badge: { backgroundColor: theme.mode === 'dark' ? c.surfaceAlt : 'rgba(0,0,0,0.05)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    badgeText: { fontSize: 10, fontWeight: '700', color: theme.mode === 'dark' ? c.textSecondary : '#64748b' },
    resolveBtn: { width: 40, alignItems: 'center', justifyContent: 'center' },
    empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
    emptyText: { fontSize: 15, fontWeight: '700', color: theme.mode === 'dark' ? c.textMuted : '#94a3b8' },
  })
}
