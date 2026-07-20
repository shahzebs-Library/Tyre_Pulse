/**
 * Calendar / Schedule - a field-friendly agenda of what is coming up.
 *
 * Aggregates REAL scheduled work from three sources and groups it by day
 * (Overdue / Today / This week / Later):
 *   - inspections.scheduled_date  (open, not yet locked)  -> "Inspection"
 *   - pm_programs.next_due        (active programmes)      -> "Maintenance"
 *   - corrective_actions.due_date (open tasks)             -> "Task"
 *
 * Every source is fetched independently and degrades to nothing on error, so a
 * missing table or an RLS gap never fabricates items or crashes the screen.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useRealtime } from '../../hooks/useRealtime'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { Theme, spacing, radius, typography } from '../../lib/theme'
import {
  Screen, AppText, Badge, StatTile, ListRow,
  SectionHeader, EmptyState, ErrorState, Loading,
} from '../../components/ui'
import type { StatusKind } from '../../lib/theme'
import {
  ScheduleItem, ScheduleKind, BucketKey,
  groupSchedule, summarize, dayLabel,
} from '../../lib/schedule'

// Presentation per source kind.
const KIND_META: Record<ScheduleKind, {
  labelKey: string
  icon: React.ComponentProps<typeof Ionicons>['name']
  tint: 'blue' | 'amber' | 'violet' | 'teal'
}> = {
  inspection:  { labelKey: 'modules.calendar.kindInspection',  icon: 'clipboard-outline', tint: 'blue' },
  maintenance: { labelKey: 'modules.calendar.kindMaintenance', icon: 'build-outline',     tint: 'amber' },
  task:        { labelKey: 'modules.calendar.kindTask',        icon: 'checkbox-outline',  tint: 'violet' },
  work_order:  { labelKey: 'modules.calendar.kindWorkOrder',   icon: 'construct-outline', tint: 'teal' },
}

// Bucket -> badge colour for the due-date chip.
const BUCKET_KIND: Record<BucketKey, StatusKind> = {
  overdue: 'danger', today: 'warning', week: 'info', later: 'neutral',
}

const closed = (s: string | null | undefined) => {
  const v = (s ?? '').toLowerCase()
  return v === 'closed' || v === 'completed' || v === 'cancelled' || v === 'done'
}

import { withModuleGuard } from '../../components/ModuleGuard'

export default withModuleGuard(CalendarScreen, 'calendar')

function CalendarScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const router = useRouter()

  const { allowed } = useRoleGuard(['inspector', 'tyre_man', 'admin', 'manager', 'director'])
  const textAlign = isRTL ? 'right' : 'left'

  const [items, setItems] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
    const cc = profile?.country
    const scope = (q: any) => (cc ? q.or(`country.eq.${cc},country.is.null`) : q)
    // 30-day lookback so recent overdue work shows, but ancient rows do not flood.
    const windowStart = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

    const [insp, pm, task] = await Promise.allSettled([
      scope(
        supabase
          .from('inspections')
          .select('id,title,site,asset_no,scheduled_date,locked')
          .not('scheduled_date', 'is', null)
          .gte('scheduled_date', windowStart)
          .order('scheduled_date', { ascending: true })
          .limit(200),
      ),
      scope(
        supabase
          .from('pm_programs')
          .select('id,name,asset_no,site,next_due,status')
          .eq('status', 'active')
          .not('next_due', 'is', null)
          .order('next_due', { ascending: true })
          .limit(200),
      ),
      scope(
        supabase
          .from('corrective_actions')
          .select('id,title,site,asset_no,due_date,status,priority')
          .not('due_date', 'is', null)
          .order('due_date', { ascending: true })
          .limit(200),
      ),
    ])

    const collected: ScheduleItem[] = []
    let anyOk = false

    if (insp.status === 'fulfilled' && !insp.value.error) {
      anyOk = true
      for (const r of insp.value.data ?? []) {
        if (r.locked === true) continue // completed / approved - not upcoming work
        collected.push({
          id: `insp-${r.id}`,
          kind: 'inspection',
          title: r.title || `${t('modules.calendar.kindInspection')} ${r.asset_no ?? ''}`.trim(),
          subtitle: [r.asset_no, r.site].filter(Boolean).join(' - ') || undefined,
          date: r.scheduled_date,
          route: `/(app)/inspection/${r.id}`,
        })
      }
    }

    if (pm.status === 'fulfilled' && !pm.value.error) {
      anyOk = true
      for (const r of pm.value.data ?? []) {
        collected.push({
          id: `pm-${r.id}`,
          kind: 'maintenance',
          title: r.name || t('modules.calendar.kindMaintenance'),
          subtitle: [r.asset_no, r.site].filter(Boolean).join(' - ') || undefined,
          date: r.next_due,
        })
      }
    }

    if (task.status === 'fulfilled' && !task.value.error) {
      anyOk = true
      for (const r of task.value.data ?? []) {
        if (closed(r.status)) continue
        collected.push({
          id: `task-${r.id}`,
          kind: 'task',
          title: r.title || t('modules.calendar.kindTask'),
          subtitle: [r.asset_no, r.site].filter(Boolean).join(' - ') || undefined,
          date: r.due_date,
          priority: r.priority,
          status: r.status,
          route: '/(app)/tasks',
        })
      }
    }

    setItems(collected)
    setError(anyOk ? null : t('modules.calendar.loadError'))
    } catch (e: any) {
      if (__DEV__) console.warn('[calendar] load failed:', e?.message)
      setError(t('modules.calendar.loadError'))
    } finally {
      setLoading(false)
    }
  }, [profile?.country])

  useEffect(() => { load() }, [load])
  useRealtime('inspections', load)
  useRealtime('pm_programs', load)
  useRealtime('corrective_actions', load)

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const summary = useMemo(() => summarize(items), [items])
  const groups = useMemo(() => groupSchedule(items), [items])

  if (!allowed) return null

  return (
    <Screen edges={['top']}>
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.calendar.title')}</AppText>
          <AppText variant="caption" color="muted" style={{ textAlign }}>
            {summary.total > 0 ? `${summary.total} ${t('modules.calendar.scheduledSuffix')}` : t('modules.calendar.yourSchedule')}
          </AppText>
        </View>
      </View>

      {loading ? (
        <Loading label={t('modules.calendar.loadingLabel')} />
      ) : error && items.length === 0 ? (
        <ErrorState message={error} onRetry={onRefresh} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          removeClippedSubviews
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
        >
          {/* Summary strip */}
          <View style={styles.stats}>
            <StatTile label={t('modules.calendar.overdue')} value={summary.overdue} icon="alert-circle-outline" tint="red" />
            <StatTile label={t('modules.calendar.dueToday')} value={summary.today} icon="today-outline" tint="amber" />
            <StatTile label={t('modules.calendar.thisWeek')} value={summary.week} icon="calendar-outline" tint="blue" />
          </View>

          {groups.length === 0 ? (
            <EmptyState
              icon="calendar-clear-outline"
              title={t('modules.calendar.nothing')}
              message={t('modules.calendar.nothingHint')}
            />
          ) : (
            groups.map(group => (
              <View key={group.key}>
                <SectionHeader title={`${group.label} (${group.items.length})`} />
                <View style={{ gap: spacing.sm }}>
                  {group.items.map(item => {
                    const meta = KIND_META[item.kind]
                    return (
                      <ListRow
                        key={item.id}
                        title={item.title}
                        subtitle={item.subtitle
                          ? `${t(meta.labelKey)} - ${item.subtitle}`
                          : t(meta.labelKey)}
                        icon={meta.icon}
                        tint={meta.tint}
                        chevron={!!item.route}
                        onPress={item.route ? () => router.push(item.route as any) : undefined}
                        right={
                          <Badge kind={BUCKET_KIND[group.key]}>
                            {dayLabel(item.date)}
                          </Badge>
                        }
                      />
                    )
                  })}
                </View>
              </View>
            ))
          )}

          <AppText variant="micro" color="muted" center style={styles.footnote}>
            {t('modules.calendar.footnote')}
          </AppText>
        </ScrollView>
      )}
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    backBtn: {
      width: 38, height: 38, borderRadius: radius.md, backgroundColor: c.surface,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border,
    },
    body: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm, paddingBottom: spacing['4xl'] },
    stats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    footnote: { marginTop: spacing.xl, ...typography.micro },
  })
}
