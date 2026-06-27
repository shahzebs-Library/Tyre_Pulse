/**
 * Tyre Records — mobile list view
 *
 * Roles:
 *   admin / manager  → all records, site filter, inline status badge
 *   director         → all records, read-only
 *   inspector / tyre_man / reporter → own site only, read-only
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl, StatusBar, ActivityIndicator,
  Modal, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { canEditRecords, canViewRecords } from '../../../lib/permissions'
import { isAdminOrAbove } from '../../../lib/types'

const PAGE = 30

const RISK_COLOR: Record<string, string> = {
  Critical: '#dc2626',
  High:     '#ea580c',
  Medium:   '#f59e0b',
  Low:      '#16a34a',
}
const RISK_BG: Record<string, string> = {
  Critical: '#fef2f2',
  High:     '#fff7ed',
  Medium:   '#fffbeb',
  Low:      '#f0fdf4',
}

interface TyreRecord {
  id: string
  asset_no: string | null
  serial_no: string | null
  brand: string | null
  site: string | null
  issue_date: string | null
  risk_level: string | null
  category: string | null
  cost_per_tyre: number | null
  km_at_fitment: number | null
  km_at_removal: number | null
  description: string | null
  remarks: string | null
  country: string | null
}

export default function RecordsScreen() {
  const { profile } = useAuth()
  const router = useRouter()
  const role = profile?.role ?? null
  const elevated = isAdminOrAbove(role)
  const canEdit  = canEditRecords(role)

  const [records, setRecords]     = useState<TyreRecord[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore]     = useState(true)

  const [search, setSearch]       = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [riskFilter, setRiskFilter] = useState('')
  const [sites, setSites]         = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [detail, setDetail]       = useState<TyreRecord | null>(null)

  const RISKS = ['Critical', 'High', 'Medium', 'Low']

  useEffect(() => { loadSites() }, [])
  useEffect(() => { reset() }, [search, siteFilter, riskFilter])

  async function loadSites() {
    let q = supabase.from('tyre_records').select('site').not('site', 'is', null)
    if (!elevated && profile?.site) q = q.eq('site', profile.site)
    const { data } = await q
    if (data) setSites([...new Set(data.map((r: any) => r.site as string))].sort())
  }

  function reset() {
    setPage(0)
    setRecords([])
    setHasMore(true)
    loadPage(0, true)
  }

  const loadPage = useCallback(async (p: number, fresh = false) => {
    if (fresh) setLoading(true)
    else setLoadingMore(true)

    let q = supabase
      .from('tyre_records')
      .select('id,asset_no,serial_no,brand,site,issue_date,risk_level,category,cost_per_tyre,km_at_fitment,km_at_removal,description,remarks,country', { count: 'exact' })
      .order('issue_date', { ascending: false })
      .range(p * PAGE, (p + 1) * PAGE - 1)

    if (search.trim()) {
      q = q.or(`asset_no.ilike.%${search}%,serial_no.ilike.%${search}%,brand.ilike.%${search}%`)
    }
    if (siteFilter) q = q.eq('site', siteFilter)
    else if (!elevated && profile?.site) q = q.eq('site', profile.site)
    if (riskFilter) q = q.eq('risk_level', riskFilter)

    const { data, count } = await q
    const rows = (data ?? []) as TyreRecord[]

    setTotal(count ?? 0)
    setRecords(prev => fresh ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE)
    setLoading(false)
    setLoadingMore(false)
    setRefreshing(false)
  }, [search, siteFilter, riskFilter, elevated, profile?.site])

  useEffect(() => { loadPage(page) }, [page])

  async function onRefresh() {
    setRefreshing(true)
    reset()
  }

  function loadMore() {
    if (!loadingMore && hasMore) {
      const next = page + 1
      setPage(next)
    }
  }

  const activeFilters = [siteFilter, riskFilter].filter(Boolean).length

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tyre Records</Text>
          <Text style={styles.subtitle}>
            {loading ? 'Loading…' : `${total.toLocaleString()} record${total !== 1 ? 's' : ''}${elevated ? '' : ` · ${profile?.site ?? 'My site'}`}`}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, activeFilters > 0 && styles.filterBtnActive]}
          onPress={() => setShowFilters(true)}
        >
          <Ionicons name="options-outline" size={18} color={activeFilters > 0 ? '#fff' : '#64748b'} />
          {activeFilters > 0 && (
            <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilters}</Text></View>
          )}
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color="#94a3b8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search asset, serial, brand…"
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Active filter chips */}
      {activeFilters > 0 && (
        <View style={styles.chipRow}>
          {siteFilter ? (
            <TouchableOpacity style={styles.chip} onPress={() => setSiteFilter('')}>
              <Text style={styles.chipText}>{siteFilter}</Text>
              <Ionicons name="close" size={11} color="#64748b" />
            </TouchableOpacity>
          ) : null}
          {riskFilter ? (
            <TouchableOpacity style={[styles.chip, { borderColor: RISK_COLOR[riskFilter] + '60' }]} onPress={() => setRiskFilter('')}>
              <Text style={[styles.chipText, { color: RISK_COLOR[riskFilter] }]}>{riskFilter}</Text>
              <Ionicons name="close" size={11} color={RISK_COLOR[riskFilter]} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => { setSiteFilter(''); setRiskFilter('') }}>
            <Text style={styles.clearAll}>Clear all</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#16a34a" /></View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={r => r.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="layers-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>No records found</Text>
              <Text style={styles.emptyHint}>Try adjusting your search or filters</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color="#16a34a" style={{ margin: 16 }} /> : null}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => setDetail(item)} activeOpacity={0.75}>
              <View style={[styles.riskStrip, { backgroundColor: RISK_COLOR[item.risk_level ?? ''] ?? '#94a3b8' }]} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.assetNo} numberOfLines={1}>{item.asset_no ?? '—'}</Text>
                  {item.risk_level ? (
                    <View style={[styles.riskBadge, { backgroundColor: RISK_BG[item.risk_level] ?? '#f1f5f9', borderColor: RISK_COLOR[item.risk_level] + '40' }]}>
                      <Text style={[styles.riskText, { color: RISK_COLOR[item.risk_level] }]}>{item.risk_level}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.brand}>{[item.brand, item.serial_no].filter(Boolean).join(' · ') || '—'}</Text>
                <View style={styles.cardMeta}>
                  {item.site ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="location-outline" size={11} color="#94a3b8" />
                      <Text style={styles.metaText}>{item.site}</Text>
                    </View>
                  ) : null}
                  {item.issue_date ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="calendar-outline" size={11} color="#94a3b8" />
                      <Text style={styles.metaText}>{item.issue_date}</Text>
                    </View>
                  ) : null}
                  {item.cost_per_tyre != null ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="cash-outline" size={11} color="#94a3b8" />
                      <Text style={styles.metaText}>{Number(item.cost_per_tyre).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={15} color="#cbd5e1" />
            </TouchableOpacity>
          )}
        />
      )}

      {/* Filter sheet */}
      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Filter Records</Text>

            <Text style={styles.sheetLabel}>Risk Level</Text>
            <View style={styles.pillRow}>
              {RISKS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.pill, riskFilter === r && { backgroundColor: RISK_COLOR[r], borderColor: RISK_COLOR[r] }]}
                  onPress={() => setRiskFilter(prev => prev === r ? '' : r)}
                >
                  <Text style={[styles.pillText, riskFilter === r && { color: '#fff' }]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {elevated && sites.length > 0 && (
              <>
                <Text style={styles.sheetLabel}>Site</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.pillRow}>
                    {sites.map(s => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.pill, siteFilter === s && styles.pillActive]}
                        onPress={() => setSiteFilter(prev => prev === s ? '' : s)}
                      >
                        <Text style={[styles.pillText, siteFilter === s && styles.pillTextActive]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}

            <TouchableOpacity style={styles.applyBtn} onPress={() => setShowFilters(false)}>
              <Text style={styles.applyBtnText}>Apply Filters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearBtn} onPress={() => { setSiteFilter(''); setRiskFilter(''); setShowFilters(false) }}>
              <Text style={styles.clearBtnText}>Clear All</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Detail sheet */}
      {detail && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setDetail(null)}>
          <View style={styles.sheetBackdrop}>
            <View style={[styles.sheet, { maxHeight: '85%' }]}>
              <View style={styles.sheetHandle} />
              <View style={styles.detailHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailAsset}>{detail.asset_no ?? 'Record'}</Text>
                  <Text style={styles.detailBrand}>{detail.brand ?? '—'}</Text>
                </View>
                {detail.risk_level ? (
                  <View style={[styles.riskBadge, { backgroundColor: RISK_BG[detail.risk_level] ?? '#f1f5f9', borderColor: RISK_COLOR[detail.risk_level] + '60' }]}>
                    <Text style={[styles.riskText, { color: RISK_COLOR[detail.risk_level] }]}>{detail.risk_level}</Text>
                  </View>
                ) : null}
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                <DetailRow label="Serial No" value={detail.serial_no} />
                <DetailRow label="Site" value={detail.site} />
                <DetailRow label="Issue Date" value={detail.issue_date} />
                <DetailRow label="Category" value={detail.category} />
                <DetailRow label="Cost / Tyre" value={detail.cost_per_tyre != null ? `SAR ${Number(detail.cost_per_tyre).toLocaleString()}` : null} />
                <DetailRow label="KM at Fitment" value={detail.km_at_fitment?.toLocaleString()} />
                <DetailRow label="KM at Removal" value={detail.km_at_removal?.toLocaleString()} />
                {detail.km_at_fitment != null && detail.km_at_removal != null && detail.km_at_removal > detail.km_at_fitment ? (
                  <DetailRow
                    label="Tyre Life (km)"
                    value={(detail.km_at_removal - detail.km_at_fitment).toLocaleString()}
                    highlight
                  />
                ) : null}
                <DetailRow label="Country" value={detail.country} />
                {detail.description ? (
                  <View style={styles.detailBlock}>
                    <Text style={styles.detailLabel}>Description</Text>
                    <Text style={styles.detailValue}>{detail.description}</Text>
                  </View>
                ) : null}
                {detail.remarks ? (
                  <View style={styles.detailBlock}>
                    <Text style={styles.detailLabel}>Remarks</Text>
                    <Text style={styles.detailValue}>{detail.remarks}</Text>
                  </View>
                ) : null}
              </ScrollView>
              <TouchableOpacity style={styles.closeDetailBtn} onPress={() => setDetail(null)}>
                <Text style={styles.closeDetailText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  )
}

function DetailRow({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  if (!value && value !== '0') return null
  return (
    <View style={detailRowStyles.row}>
      <Text style={detailRowStyles.label}>{label}</Text>
      <Text style={[detailRowStyles.value, highlight && detailRowStyles.highlight]}>{value}</Text>
    </View>
  )
}

const detailRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  label: { fontSize: 13, color: '#64748b', flex: 1 },
  value: { fontSize: 13, color: '#0f172a', fontWeight: '600', flex: 1, textAlign: 'right' },
  highlight: { color: '#16a34a' },
})

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: '#f8fafc' },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  title:    { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },

  filterBtn: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  filterBtnActive:  { backgroundColor: '#16a34a' },
  filterBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center',
  },
  filterBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginVertical: 10,
    backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  searchInput: { flex: 1, fontSize: 13, color: '#0f172a', padding: 0 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginBottom: 6, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0',
    paddingHorizontal: 10, paddingVertical: 4,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  clearAll: { fontSize: 12, color: '#dc2626', fontWeight: '700', marginLeft: 4 },

  list:  { paddingHorizontal: 16, paddingBottom: 40, gap: 10, paddingTop: 6 },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  riskStrip:  { width: 4, alignSelf: 'stretch' },
  cardBody:   { flex: 1, padding: 12, gap: 4 },
  cardTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  assetNo:    { fontSize: 15, fontWeight: '800', color: '#0f172a', flex: 1 },
  brand:      { fontSize: 12, color: '#64748b' },
  riskBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    borderWidth: 1, alignSelf: 'flex-start',
  },
  riskText:   { fontSize: 11, fontWeight: '800' },
  cardMeta:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  metaItem:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText:   { fontSize: 11, color: '#94a3b8' },

  empty:      { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptyHint:  { fontSize: 13, color: '#94a3b8' },

  // Filter / detail sheets
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36, gap: 12,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 4 },
  sheetTitle:  { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  sheetLabel:  { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  pillRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  pillActive:    { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  pillText:      { fontSize: 13, fontWeight: '700', color: '#64748b' },
  pillTextActive:{ color: '#fff' },
  applyBtn: {
    backgroundColor: '#16a34a', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  applyBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  clearBtn:     { alignItems: 'center', paddingVertical: 10 },
  clearBtnText: { color: '#94a3b8', fontSize: 14 },

  detailHeader:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  detailAsset:   { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  detailBrand:   { fontSize: 13, color: '#64748b', marginTop: 2 },
  detailBlock:   { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  detailLabel:   { fontSize: 12, color: '#64748b', marginBottom: 4 },
  detailValue:   { fontSize: 13, color: '#0f172a' },
  closeDetailBtn:{ backgroundColor: '#f1f5f9', borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  closeDetailText:{ fontSize: 15, fontWeight: '700', color: '#374151' },
})
