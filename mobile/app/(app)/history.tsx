import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, TextInput, Alert, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { getQueue, syncQueue } from '../../lib/offlineQueue'
import { shareInspectionById } from '../../lib/inspectionReportPdf'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import SyncBanner from '../../components/SyncBanner'
import { SkeletonList } from '../../components/SkeletonLoader'
import { useRealtime } from '../../hooks/useRealtime'
import { Theme, StatusKind, spacing, radius, elevation } from '../../lib/theme'
import {
  Screen, Card, AppText, Badge, EmptyState, ErrorState,
} from '../../components/ui'

type SyncStatus = 'synced' | 'pending' | 'failed'
type FilterKey = 'all' | SyncStatus

interface HistoryItem {
  id: string
  title: string
  site: string
  asset_no: string
  inspection_date: string
  sync_status: SyncStatus
  isOffline?: boolean
  tyre_count?: number
  locked?: boolean
}

const FILTERS: FilterKey[] = ['all', 'synced', 'pending', 'failed']

/** Sync state -> design-system status kind + icon. */
const STATUS_META: Record<SyncStatus, { kind: StatusKind; icon: string }> = {
  synced:  { kind: 'success', icon: 'cloud-done-outline' },
  pending: { kind: 'warning', icon: 'cloud-upload-outline' },
  failed:  { kind: 'danger',  icon: 'cloud-offline-outline' },
}

export default function HistoryScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [error, setError] = useState<string | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)

  // Share a synced inspection as PDF (fetches the full record by id, then builds
  // + opens the device share sheet). Only offered for synced (openable) rows -
  // offline-queued rows are not yet persisted server-side.
  const shareRow = useCallback(async (id: string) => {
    if (sharingId) return
    setSharingId(id)
    try {
      await shareInspectionById(id)
    } catch (e: any) {
      Alert.alert('Share failed', e?.message || 'Could not generate the PDF.')
    } finally {
      setSharingId(null)
    }
  }, [sharingId])

  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const textAlign = isRTL ? 'right' : 'left'

  const load = useCallback(async () => {
    try {
    const queue = await getQueue()
    const offlineItems: HistoryItem[] = queue.map(item => ({
      id: item.id,
      title: item.payload.title,
      site: item.payload.site,
      asset_no: item.payload.asset_no,
      inspection_date: item.payload.inspection_date,
      sync_status: item.sync_status,
      isOffline: true,
      tyre_count: Object.keys(item.payload.tyre_conditions ?? {}).length,
    }))

    let syncedItems: HistoryItem[] = []
    if (profile?.id) {
      const { data: dbItems, error: dbErr } = await supabase
        .from('inspections')
        .select('id, title, site, asset_no, inspection_date, tyre_conditions, locked')
        .eq('created_by', profile.id)
        .order('created_at', { ascending: false })
        .limit(100)

      if (dbErr) {
        if (__DEV__) console.warn('[history] synced fetch failed:', dbErr.message)
        setError('Could not load synced history. Pull down to retry.')
      } else {
        setError(null)
      }

      syncedItems = (dbItems ?? []).map(i => ({
        id: i.id,
        title: i.title,
        site: i.site,
        asset_no: i.asset_no,
        inspection_date: i.inspection_date,
        sync_status: 'synced' as const,
        tyre_count: Object.keys(i.tyre_conditions ?? {}).length,
        locked: i.locked === true,
      }))
    }

    setItems([...offlineItems, ...syncedItems])
    } catch (e: any) {
      if (__DEV__) console.warn('[history] load failed:', e?.message)
      setError('Could not load history. Pull down to retry.')
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { load() }, [load])
  useRealtime('inspections', load)

  async function onRefresh() {
    setRefreshing(true)
    try {
      await syncQueue()
      await load()
    } catch (e: any) {
      if (__DEV__) console.warn('[history] refresh failed:', e?.message)
    } finally {
      setRefreshing(false)
    }
  }

  // Counts per status drive the filter chip badges.
  const counts = useMemo(() => {
    const c = { all: items.length, synced: 0, pending: 0, failed: 0 }
    for (const i of items) c[i.sync_status]++
    return c
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(i => {
      if (filter !== 'all' && i.sync_status !== filter) return false
      if (!q) return true
      return (
        i.title?.toLowerCase().includes(q) ||
        i.asset_no?.toLowerCase().includes(q) ||
        i.site?.toLowerCase().includes(q)
      )
    })
  }, [items, query, filter])

  function filterLabel(key: FilterKey): string {
    if (key === 'all') return t('history.filterAll')
    return key === 'synced' ? t('common.synced') : key === 'pending' ? t('common.pending') : t('common.failed')
  }

  function statusLabelFor(status: SyncStatus): string {
    return status === 'synced' ? t('common.synced')
      : status === 'pending' ? t('common.pending')
      : t('common.failed')
  }

  function renderItem({ item }: { item: HistoryItem }) {
    const meta = STATUS_META[item.sync_status]
    const formattedDate = item.inspection_date
      ? new Date(item.inspection_date + 'T00:00:00').toLocaleDateString(dateLocale, {
          day: 'numeric', month: 'short', year: 'numeric',
        })
      : '-'
    const openable = !item.isOffline

    return (
      <Card
        padded={false}
        onPress={openable ? () => router.push(`/(app)/inspection/${item.id}`) : undefined}
        style={s.card}
      >
        <View style={[s.cardRow, isRTL && s.rowR]}>
          <View style={[s.cardIcon, { backgroundColor: theme.color.primarySoft }]}>
            <Ionicons name="document-text-outline" size={20} color={theme.color.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="title" style={{ textAlign }} numberOfLines={1}>{item.title}</AppText>
            <View style={[s.metaRow, isRTL && s.rowR]}>
              <Ionicons name="location-outline" size={12} color={theme.color.textMuted} />
              <AppText variant="caption" color="muted">{item.site}</AppText>
              <AppText variant="caption" color="muted">·</AppText>
              <Ionicons name="bus-outline" size={12} color={theme.color.textMuted} />
              <AppText variant="caption" color="muted">{item.asset_no}</AppText>
            </View>
            <View style={[s.metaRow, isRTL && s.rowR]}>
              <Ionicons name="calendar-outline" size={12} color={theme.color.textMuted} />
              <AppText variant="caption" color="muted">{formattedDate}</AppText>
              {item.tyre_count ? (
                <>
                  <AppText variant="caption" color="muted">·</AppText>
                  <Ionicons name="ellipse-outline" size={12} color={theme.color.textMuted} />
                  <AppText variant="caption" color="muted">{item.tyre_count} {t('history.tyres')}</AppText>
                </>
              ) : null}
            </View>
          </View>
          <View style={s.cardRight}>
            <Badge kind={meta.kind} icon={meta.icon as any}>{statusLabelFor(item.sync_status)}</Badge>
            {item.locked ? <Badge kind="neutral" icon="lock-closed">Locked</Badge> : null}
            {openable ? (
              <TouchableOpacity
                style={s.shareChip}
                onPress={() => shareRow(item.id)}
                disabled={sharingId === item.id}
                activeOpacity={0.85}
                hitSlop={8}
              >
                {sharingId === item.id
                  ? <ActivityIndicator size="small" color={theme.color.primary} />
                  : (
                    <>
                      <Ionicons name="share-outline" size={13} color={theme.color.primary} />
                      <AppText variant="micro" style={{ color: theme.color.primary }}>PDF</AppText>
                    </>
                  )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Card>
    )
  }

  const hasAnyRecords = items.length > 0

  return (
    <Screen edges={['top']}>
      <View style={s.header}>
        <AppText variant="h2" style={{ textAlign }}>{t('history.title')}</AppText>
        <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>
          {filtered.length} {t('common.records')}
        </AppText>
      </View>
      <SyncBanner />

      <View style={[s.searchWrap, isRTL && s.rowR]}>
        <Ionicons name="search-outline" size={18} color={theme.color.textMuted} />
        <TextInput
          style={[s.search, { color: theme.color.text, textAlign }]}
          value={query}
          onChangeText={setQuery}
          placeholder={t('history.searchPlaceholder')}
          placeholderTextColor={theme.color.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={theme.color.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTERS}
        keyExtractor={k => k}
        contentContainerStyle={s.filterRow}
        renderItem={({ item: key }) => {
          const active = filter === key
          return (
            <TouchableOpacity
              style={[s.chip, active && s.chipActive]}
              onPress={() => setFilter(key)}
              activeOpacity={0.8}
            >
              <AppText variant="label" style={{ color: active ? theme.color.onPrimary : theme.color.textSecondary }}>
                {filterLabel(key)}
              </AppText>
              <View style={[s.chipCount, active && s.chipCountActive]}>
                <AppText variant="micro" style={{ color: active ? theme.color.onPrimary : theme.color.textMuted }}>
                  {counts[key]}
                </AppText>
              </View>
            </TouchableOpacity>
          )
        }}
      />

      {error && !loading ? (
        <View style={s.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={theme.color.danger.base} />
          <AppText variant="caption" style={{ flex: 1, color: theme.color.danger.on, textAlign }} numberOfLines={2}>{error}</AppText>
          <TouchableOpacity style={[s.errorRetry, { backgroundColor: theme.color.danger.base }]} onPress={onRefresh} disabled={refreshing} activeOpacity={0.8}>
            <Ionicons name="refresh" size={14} color="#fff" />
            <AppText variant="micro" style={{ color: '#fff' }}>{t('common.retry')}</AppText>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading ? (
        <View style={s.skeleton}>
          <SkeletonList count={5} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={9}
          removeClippedSubviews
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />
          }
          ListEmptyComponent={
            error ? (
              <ErrorState message={error} onRetry={onRefresh} />
            ) : (
              <EmptyState
                icon={hasAnyRecords ? 'filter-outline' : 'time-outline'}
                title={hasAnyRecords ? t('history.noResults') : t('history.noHistory')}
                message={hasAnyRecords ? t('history.noResultsHint') : t('history.noHistoryHint')}
              />
            )
          }
        />
      )}
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    header: {
      paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginHorizontal: spacing.lg, marginTop: spacing.sm,
      backgroundColor: c.surface, borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      borderWidth: 1.5, borderColor: c.border,
    },
    search: { flex: 1, paddingVertical: 12, fontSize: 15, fontWeight: '500' },
    filterRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.pill, backgroundColor: c.surface,
      borderWidth: 1.5, borderColor: c.border, height: 38,
    },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipCount: {
      minWidth: 22, paddingHorizontal: 6, paddingVertical: 1,
      borderRadius: radius.pill, backgroundColor: c.surfaceAlt, alignItems: 'center',
    },
    chipCountActive: { backgroundColor: 'rgba(255,255,255,0.24)' },
    errorBanner: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginHorizontal: spacing.lg, marginTop: spacing.sm,
      paddingHorizontal: spacing.md, paddingVertical: spacing.md,
      borderRadius: radius.md, backgroundColor: c.danger.soft,
      borderWidth: 1, borderColor: c.danger.base,
    },
    errorRetry: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm,
    },
    skeleton: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md, paddingTop: spacing.md, flexGrow: 1 },
    card: { overflow: 'hidden' },
    cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md },
    cardIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
    cardRight: { alignItems: 'flex-end', gap: spacing.xs },
    shareChip: {
      flexDirection: 'row', alignItems: 'center', gap: 3,
      paddingHorizontal: spacing.sm, paddingVertical: 4,
      borderRadius: radius.sm, borderWidth: 1, borderColor: c.primary,
      backgroundColor: c.primarySoft, minWidth: 34, justifyContent: 'center',
    },
  })
}
