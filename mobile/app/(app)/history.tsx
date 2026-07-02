import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { getQueue, syncQueue } from '../../lib/offlineQueue'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import SyncBanner from '../../components/SyncBanner'
import { useRealtime } from '../../hooks/useRealtime'

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

export default function HistoryScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')

  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const textAlign = isRTL ? 'right' : 'left'

  const load = useCallback(async () => {
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
      const { data: dbItems } = await supabase
        .from('inspections')
        .select('id, title, site, asset_no, inspection_date, tyre_conditions, locked')
        .eq('created_by', profile.id)
        .order('created_at', { ascending: false })
        .limit(100)

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
    setLoading(false)
  }, [profile?.id])

  useEffect(() => { load() }, [load])
  useRealtime('inspections', load)

  async function onRefresh() {
    setRefreshing(true)
    await syncQueue()
    await load()
    setRefreshing(false)
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

  const STATUS_COLORS = {
    synced:  { bg: 'rgba(22,163,74,0.08)',  text: '#15803d',  icon: 'cloud-done-outline' },
    pending: { bg: 'rgba(245,158,11,0.08)', text: '#b45309',  icon: 'cloud-upload-outline' },
    failed:  { bg: 'rgba(239,68,68,0.08)',  text: '#dc2626',  icon: 'cloud-offline-outline' },
  } as const

  function filterLabel(key: FilterKey): string {
    if (key === 'all') return t('history.filterAll')
    return key === 'synced' ? t('common.synced') : key === 'pending' ? t('common.pending') : t('common.failed')
  }

  function renderItem({ item }: { item: HistoryItem }) {
    const status = STATUS_COLORS[item.sync_status]
    const formattedDate = item.inspection_date
      ? new Date(item.inspection_date + 'T00:00:00').toLocaleDateString(dateLocale, {
          day: 'numeric', month: 'short', year: 'numeric',
        })
      : '-'

    const statusLabel = item.sync_status === 'synced' ? t('common.synced')
      : item.sync_status === 'pending' ? t('common.pending')
      : t('common.failed')

    const openable = !item.isOffline
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={openable ? 0.7 : 1}
        disabled={!openable}
        onPress={() => openable && router.push(`/(app)/inspection/${item.id}`)}
      >
        <View style={styles.cardLeft}>
          <View style={styles.cardIcon}>
            <Ionicons name="document-text-outline" size={20} color="#16a34a" />
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardTitle, { textAlign }]} numberOfLines={1}>{item.title}</Text>
          <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
            <Ionicons name="location-outline" size={12} color="#94a3b8" />
            <Text style={styles.metaText}>{item.site}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Ionicons name="bus-outline" size={12} color="#94a3b8" />
            <Text style={styles.metaText}>{item.asset_no}</Text>
          </View>
          <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
            <Ionicons name="calendar-outline" size={12} color="#94a3b8" />
            <Text style={styles.metaText}>{formattedDate}</Text>
            {item.tyre_count ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Ionicons name="ellipse-outline" size={12} color="#94a3b8" />
                <Text style={styles.metaText}>{item.tyre_count} {t('history.tyres')}</Text>
              </>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
            <Ionicons name={status.icon as any} size={13} color={status.text} />
            <Text style={[styles.statusText, { color: status.text }]}>{statusLabel}</Text>
          </View>
          {item.locked && (
            <View style={styles.lockBadge}>
              <Ionicons name="lock-closed" size={11} color="#64748b" />
              <Text style={styles.lockText}>Locked</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    )
  }

  const hasAnyRecords = items.length > 0

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.headerRTL]}>
        <Text style={[styles.headerTitle, { textAlign }]}>{t('history.title')}</Text>
        <Text style={[styles.headerSub, { textAlign }]}>{filtered.length} {t('common.records')}</Text>
      </View>
      <SyncBanner />

      {/* Search + status filters */}
      <View style={styles.controls}>
        <View style={[styles.searchBox, isRTL && styles.searchBoxRTL]}>
          <Ionicons name="search-outline" size={18} color="#94a3b8" />
          <TextInput
            style={[styles.searchInput, { textAlign }]}
            value={query}
            onChangeText={setQuery}
            placeholder={t('history.searchPlaceholder')}
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={18} color="#cbd5e1" />
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={k => k}
          contentContainerStyle={styles.filterRow}
          renderItem={({ item: key }) => {
            const active = filter === key
            return (
              <TouchableOpacity
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilter(key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {filterLabel(key)}
                </Text>
                <View style={[styles.filterCount, active && styles.filterCountActive]}>
                  <Text style={[styles.filterCountText, active && styles.filterCountTextActive]}>
                    {counts[key]}
                  </Text>
                </View>
              </TouchableOpacity>
            )
          }}
        />
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#16a34a" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name={hasAnyRecords ? 'filter-outline' : 'time-outline'}
                size={52}
                color="#cbd5e1"
              />
              <Text style={styles.emptyTitle}>
                {hasAnyRecords ? t('history.noResults') : t('history.noHistory')}
              </Text>
              <Text style={styles.emptyText}>
                {hasAnyRecords ? t('history.noResultsHint') : t('history.noHistoryHint')}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.07)',
  },
  headerRTL: { alignItems: 'flex-end' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  headerSub: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  controls: { backgroundColor: '#fff', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchBoxRTL: { flexDirection: 'row-reverse' },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a' },
  filterRow: { gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  filterChipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  filterChipTextActive: { color: '#fff' },
  filterCount: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  filterCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  filterCountText: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  filterCountTextActive: { color: '#fff' },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, gap: 10, paddingBottom: 40, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  cardLeft: {},
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(22,163,74,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaRowRTL: { flexDirection: 'row-reverse' },
  metaText: { fontSize: 11, color: '#94a3b8' },
  metaDot: { fontSize: 11, color: '#cbd5e1' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  statusText: { fontSize: 10, fontWeight: '700' },
  lockBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(100,116,139,0.1)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  lockText: { fontSize: 9, fontWeight: '700', color: '#64748b' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#94a3b8' },
  emptyText: { fontSize: 13, color: '#cbd5e1', textAlign: 'center' },
})
