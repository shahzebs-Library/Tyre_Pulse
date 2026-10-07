/**
 * Workshop Status - the field list.
 *
 * A technician opens this (or taps a "workshop status" notification) and sees
 * the vehicles currently in the daily workshop report. Default view is MINE
 * (vehicles where I am the responsible or supporting person); "All" shows every
 * vehicle RLS lets me see. Longest-down first. Tap a vehicle to update it.
 *
 * This is NOT Workshop Live (app/(app)/workshop.tsx, "My Jobs") - that screen
 * records technician job activity; this one updates the daily status sheet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity, RefreshControl, TextInput,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { withModuleGuard } from '../../../components/ModuleGuard'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { Theme, spacing, radius, elevation } from '../../../lib/theme'
import {
  Screen, Card, AppText, Badge, BackButton, Loading, EmptyState, ErrorState,
} from '../../../components/ui'
import { listActiveRecords, loadPermissions } from '../../../lib/workshopStatus'
import {
  WorkshopRecord, WorkshopPerms, daysDown, updatedToday, filterRecords, sortByDaysDown,
} from '../../../lib/workshopStatusView'
import { RELEASED_STAGE, vocabKey } from '../../../lib/workshopStatusVocab'
import { toUserMessage } from '../../../lib/safeError'

export default withModuleGuard(WorkshopStatusListScreen, 'workshopStatus')

function WorkshopStatusListScreen() {
  const { user } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])
  const userId = user?.id ?? null

  const [rows, setRows] = useState<WorkshopRecord[]>([])
  const [perms, setPerms] = useState<WorkshopPerms | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState(true)
  // Only the newest request may paint (a slow earlier read must not overwrite).
  const seq = useRef(0)

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'quiet') => {
    const my = ++seq.current
    if (mode === 'initial') setLoading(true)
    if (mode === 'refresh') setRefreshing(true)
    try {
      const [p, list] = await Promise.all([loadPermissions(), listActiveRecords()])
      if (my !== seq.current) return
      setPerms(p)
      setRows(list)
      setError(null)
    } catch (e: any) {
      if (my !== seq.current) return
      setError(toUserMessage(e, t('modules.workshopStatus.loadError')))
    } finally {
      if (my === seq.current) { setLoading(false); setRefreshing(false) }
    }
  }, [t])

  useEffect(() => { load('initial') }, [load])

  // Coming back from the update screen: re-read quietly so the saved stage and
  // the "updated today" badge are current without a spinner.
  const firstFocus = useRef(true)
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return }
    load('quiet')
  }, [load]))

  const now = new Date()
  const visible = useMemo(
    () => sortByDaysDown(filterRecords(rows, { mine, userId, query }), now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, mine, userId, query],
  )
  const mineCount = useMemo(() => filterRecords(rows, { mine: true, userId }).length, [rows, userId])
  const staleCount = useMemo(() => visible.filter((r) => !updatedToday(r)).length, [visible])

  const stageLabel = (stage: string | null) => {
    if (!stage) return t('modules.workshopStatus.noStage')
    if (stage === RELEASED_STAGE) return t('modules.workshopStatus.released')
    const k = `modules.workshopStatus.stages.${vocabKey(stage)}`
    const tr = t(k)
    return tr === k ? stage : tr
  }

  const renderItem = ({ item }: { item: WorkshopRecord }) => {
    const days = daysDown(item, now)
    const fresh = updatedToday(item, now)
    return (
      <Card onPress={() => router.push(`/(app)/workshop-status/${item.id}`)} style={s.card}>
        <View style={[s.row, isRTL && s.rowRtl]}>
          <View style={{ flex: 1 }}>
            <AppText variant="title" align="start">{item.asset_no || t('common.notAvailable')}</AppText>
            <AppText variant="caption" color="secondary" align="start" numberOfLines={1}>
              {[item.site, item.country].filter(Boolean).join(' - ') || t('common.notAvailable')}
            </AppText>
          </View>
          <View style={s.days}>
            <AppText variant="h3" color={days != null && days > 7 ? 'danger' : 'text'}>
              {days == null ? '-' : String(days)}
            </AppText>
            <AppText variant="micro" color="muted">{t('modules.workshopStatus.daysDown')}</AppText>
          </View>
        </View>
        {item.complaint ? (
          <AppText variant="body" color="secondary" align="start" numberOfLines={2} style={s.complaint}>
            {item.complaint}
          </AppText>
        ) : null}
        <View style={[s.badges, isRTL && s.rowRtl]}>
          <Badge kind="info">{stageLabel(item.current_stage)}</Badge>
          {fresh
            ? <Badge kind="success" icon="checkmark-circle-outline">{t('modules.workshopStatus.updatedToday')}</Badge>
            : <Badge kind="warning" icon="time-outline">{t('modules.workshopStatus.notUpdatedToday')}</Badge>}
          {userId && item.responsible_user_id === userId
            ? <Badge kind="neutral" icon="person-outline">{t('modules.workshopStatus.responsibleMe')}</Badge>
            : null}
        </View>
      </Card>
    )
  }

  const header = (
    <View>
      <View style={[s.header, isRTL && s.rowRtl]}>
        <BackButton />
        <View style={{ flex: 1 }}>
          <AppText variant="h2" align="start">{t('modules.workshopStatus.title')}</AppText>
          <AppText variant="caption" color="secondary" align="start">
            {`${visible.length} ${t('modules.workshopStatus.vehicles')}  |  ${staleCount} ${t('modules.workshopStatus.notUpdatedToday')}`}
          </AppText>
        </View>
      </View>
      <View style={[s.search, isRTL && s.rowRtl]}>
        <Ionicons name="search-outline" size={18} color={theme.color.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('modules.workshopStatus.searchPlaceholder')}
          placeholderTextColor={theme.color.textMuted}
          style={[s.searchInput, { textAlign: isRTL ? 'right' : 'left' }]}
          autoCorrect={false}
          autoCapitalize="characters"
          accessibilityLabel={t('common.search')}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel={t('common.clear')}>
            <Ionicons name="close-circle" size={18} color={theme.color.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={[s.segment, isRTL && s.rowRtl]}>
        {([true, false] as const).map((v) => (
          <TouchableOpacity
            key={String(v)}
            onPress={() => setMine(v)}
            style={[s.segBtn, mine === v && s.segBtnOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: mine === v }}
          >
            <AppText variant="label" color={mine === v ? 'inverse' : 'secondary'}>
              {v ? `${t('modules.workshopStatus.mine')} (${mineCount})` : `${t('modules.workshopStatus.all')} (${rows.length})`}
            </AppText>
          </TouchableOpacity>
        ))}
      </View>
      {perms && !perms.update ? (
        <AppText variant="caption" color="muted" align="start" style={s.note}>
          {t('modules.workshopStatus.viewOnly')}
        </AppText>
      ) : null}
    </View>
  )

  if (loading) return <Screen padded>{header}<Loading label={t('common.loading')} /></Screen>
  if (error && rows.length === 0) {
    return <Screen padded>{header}<ErrorState message={error} onRetry={() => load('initial')} /></Screen>
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={visible}
        keyExtractor={(r) => r.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={s.list}
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} />}
        ListEmptyComponent={
          <EmptyState
            icon="construct-outline"
            title={mine && !query ? t('modules.workshopStatus.emptyMine') : t('modules.workshopStatus.empty')}
            message={mine && !query ? t('modules.workshopStatus.emptyMineHint') : undefined}
            actionLabel={mine && !query && rows.length > 0 ? t('modules.workshopStatus.showAll') : undefined}
            onAction={mine && !query && rows.length > 0 ? () => setMine(false) : undefined}
          />
        }
      />
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'] },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
    rowRtl: { flexDirection: 'row-reverse' },
    search: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 46,
      ...elevation(theme, 1),
    },
    searchInput: { flex: 1, fontSize: 15, color: c.text, paddingVertical: spacing.sm },
    segment: {
      flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.md,
      backgroundColor: c.surfaceAlt, borderRadius: radius.pill, padding: 4,
    },
    segBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill, minHeight: 40, justifyContent: 'center' },
    segBtnOn: { backgroundColor: c.primary },
    note: { marginBottom: spacing.md },
    card: { marginBottom: spacing.md },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    days: { alignItems: 'center', minWidth: 56 },
    complaint: { marginTop: spacing.sm },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  })
}
