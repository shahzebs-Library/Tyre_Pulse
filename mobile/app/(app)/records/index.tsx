/**
 * Tyre Records - mobile list view
 *
 * Roles:
 *   admin / manager  → all records, site filter, inline status badge
 *   director         → all records, read-only
 *   inspector / tyre_man / reporter → own site only, read-only
 */

import { useState, useCallback, useEffect } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator,
  Modal, ScrollView,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { supabase } from '../../../lib/supabase'
import { isAdminOrAbove } from '../../../lib/types'
import {
  spacing, radius, typography, statusColor, StatusKind,
} from '../../../lib/theme'
import {
  Screen, Card, AppText, Button, Badge, EmptyState, ErrorState, Loading,
} from '../../../components/ui'

const PAGE = 30

/** Map an operational risk band to a design-system status kind. */
const RISK_KIND: Record<string, StatusKind> = {
  Critical: 'critical',
  High:     'danger',
  Medium:   'warning',
  Low:      'success',
}

function riskKind(risk?: string | null): StatusKind {
  return (risk && RISK_KIND[risk]) || 'neutral'
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
  const { t } = useLanguage()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const c = theme.color
  const role = profile?.role ?? null
  const elevated = isAdminOrAbove(role)

  const [records, setRecords]     = useState<TyreRecord[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

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
    try {
      let q = supabase.from('tyre_records').select('site').not('site', 'is', null)
      if (!elevated && profile?.site) q = q.eq('site', profile.site)
      const { data } = await q
      if (data) setSites([...new Set(data.map((r: any) => r.site as string))].sort())
    } catch (e: any) {
      if (__DEV__) console.warn('[records] loadSites failed:', e?.message)
    }
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

    try {
      const { data, count, error: qErr } = await q
      if (qErr) throw qErr
      const rows = (data ?? []) as TyreRecord[]

      setError(null)
      setTotal(count ?? 0)
      setRecords(prev => fresh ? rows : [...prev, ...rows])
      setHasMore(rows.length === PAGE)
    } catch (e: any) {
      if (__DEV__) console.warn('[records] load failed:', e?.message)
      setError(t('modules.records.loadError'))
      if (fresh) setRecords([])
      setHasMore(false)
    } finally {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
    }
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
    <Screen edges={['top']} style={{ paddingHorizontal: 0 }}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <AppText variant="h2">{t('modules.records.title')}</AppText>
          <AppText variant="caption" color="muted" style={{ marginTop: 2 }}>
            {loading ? t('common.loading') : `${total.toLocaleString()} ${t('common.records')}${elevated ? '' : ` · ${profile?.site ?? t('modules.records.mySite')}`}`}
          </AppText>
        </View>
        <TouchableOpacity
          style={[
            styles.filterBtn,
            { backgroundColor: activeFilters > 0 ? c.primary : c.surfaceAlt },
          ]}
          onPress={() => setShowFilters(true)}
        >
          <Ionicons name="options-outline" size={18} color={activeFilters > 0 ? c.onPrimary : c.textSecondary} />
          {activeFilters > 0 && (
            <View style={[styles.filterBadge, { backgroundColor: c.danger.base }]}>
              <AppText style={[typography.micro, { color: c.textInverse, fontSize: 9 }]}>{activeFilters}</AppText>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[styles.searchRow, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Ionicons name="search-outline" size={16} color={c.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: c.text }]}
          placeholder={t('modules.records.searchPlaceholder')}
          placeholderTextColor={c.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color={c.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Active filter chips */}
      {activeFilters > 0 && (
        <View style={styles.chipRow}>
          {siteFilter ? (
            <TouchableOpacity
              style={[styles.chip, { backgroundColor: c.surface, borderColor: c.border }]}
              onPress={() => setSiteFilter('')}
            >
              <AppText variant="caption" color="secondary">{siteFilter}</AppText>
              <Ionicons name="close" size={11} color={c.textSecondary} />
            </TouchableOpacity>
          ) : null}
          {riskFilter ? (
            <TouchableOpacity
              style={[styles.chip, { backgroundColor: statusColor(theme, riskKind(riskFilter)).soft, borderColor: statusColor(theme, riskKind(riskFilter)).base }]}
              onPress={() => setRiskFilter('')}
            >
              <AppText style={[typography.caption, { color: statusColor(theme, riskKind(riskFilter)).on }]}>{t(`modules.priority.${riskFilter}`)}</AppText>
              <Ionicons name="close" size={11} color={statusColor(theme, riskKind(riskFilter)).on} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => { setSiteFilter(''); setRiskFilter('') }}>
            <AppText style={[typography.caption, { color: c.danger.base, marginLeft: 4 }]}>{t('modules.records.clearAll')}</AppText>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <Loading />
      ) : (
        <FlatList
          data={records}
          keyExtractor={r => r.id}
          contentContainerStyle={styles.list}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            error ? (
              <ErrorState message={error} onRetry={onRefresh} />
            ) : (
              <EmptyState
                icon="layers-outline"
                title={t('modules.records.noRecordsTitle')}
                message={t('modules.records.noRecordsHint')}
              />
            )
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={c.primary} style={{ margin: spacing.lg }} /> : null}
          renderItem={({ item }) => (
            <Card
              onPress={() => setDetail(item)}
              padded={false}
              accent={statusColor(theme, riskKind(item.risk_level)).base}
              style={styles.card}
            >
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>{item.asset_no ?? '-'}</AppText>
                  {item.risk_level ? (
                    <Badge kind={riskKind(item.risk_level)}>{item.risk_level}</Badge>
                  ) : null}
                </View>
                <AppText variant="caption" color="secondary">{[item.brand, item.serial_no].filter(Boolean).join(' · ') || '-'}</AppText>
                <View style={styles.cardMeta}>
                  {item.site ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="location-outline" size={11} color={c.textMuted} />
                      <AppText variant="micro" color="muted">{item.site}</AppText>
                    </View>
                  ) : null}
                  {item.issue_date ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="calendar-outline" size={11} color={c.textMuted} />
                      <AppText variant="micro" color="muted">{item.issue_date}</AppText>
                    </View>
                  ) : null}
                  {item.cost_per_tyre != null ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="cash-outline" size={11} color={c.textMuted} />
                      <AppText variant="micro" color="muted">{Number(item.cost_per_tyre).toLocaleString(undefined, { maximumFractionDigits: 0 })}</AppText>
                    </View>
                  ) : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} style={{ marginRight: spacing.md }} />
            </Card>
          )}
        />
      )}

      {/* Filter sheet */}
      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <View style={[styles.sheetBackdrop, { backgroundColor: c.overlay }]}>
          <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={[styles.sheetHandle, { backgroundColor: c.borderStrong }]} />
            <AppText variant="h3">{t('modules.records.filterTitle')}</AppText>

            <AppText style={[typography.label, styles.sheetLabel, { color: c.textMuted }]}>{t('modules.records.riskLevel')}</AppText>
            <View style={styles.pillRow}>
              {RISKS.map(r => {
                const active = riskFilter === r
                const sc = statusColor(theme, riskKind(r))
                return (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.pill,
                      { backgroundColor: active ? sc.base : c.surfaceAlt, borderColor: active ? sc.base : c.border },
                    ]}
                    onPress={() => setRiskFilter(prev => prev === r ? '' : r)}
                  >
                    <AppText style={[typography.label, { color: active ? c.textInverse : c.textSecondary }]}>{t(`modules.priority.${r}`)}</AppText>
                  </TouchableOpacity>
                )
              })}
            </View>

            {elevated && sites.length > 0 && (
              <>
                <AppText style={[typography.label, styles.sheetLabel, { color: c.textMuted }]}>{t('modules.records.site')}</AppText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.pillRow}>
                    {sites.map(s => {
                      const active = siteFilter === s
                      return (
                        <TouchableOpacity
                          key={s}
                          style={[
                            styles.pill,
                            { backgroundColor: active ? c.primary : c.surfaceAlt, borderColor: active ? c.primary : c.border },
                          ]}
                          onPress={() => setSiteFilter(prev => prev === s ? '' : s)}
                        >
                          <AppText style={[typography.label, { color: active ? c.onPrimary : c.textSecondary }]}>{s}</AppText>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </ScrollView>
              </>
            )}

            <Button label={t('modules.records.applyFilters')} full onPress={() => setShowFilters(false)} style={{ marginTop: spacing.xs }} />
            <Button
              label={t('modules.records.clearAllBtn')}
              variant="ghost"
              full
              onPress={() => { setSiteFilter(''); setRiskFilter(''); setShowFilters(false) }}
            />
          </View>
        </View>
      </Modal>

      {/* Detail sheet */}
      {detail && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setDetail(null)}>
          <View style={[styles.sheetBackdrop, { backgroundColor: c.overlay }]}>
            <View style={[styles.sheet, { backgroundColor: c.surface, maxHeight: '85%', paddingBottom: Math.max(insets.bottom, 24) }]}>
              <View style={[styles.sheetHandle, { backgroundColor: c.borderStrong }]} />
              <View style={styles.detailHeader}>
                <View style={{ flex: 1 }}>
                  <AppText variant="h3">{detail.asset_no ?? t('modules.records.record')}</AppText>
                  <AppText variant="caption" color="secondary" style={{ marginTop: 2 }}>{detail.brand ?? '-'}</AppText>
                </View>
                {detail.risk_level ? (
                  <Badge kind={riskKind(detail.risk_level)}>{detail.risk_level}</Badge>
                ) : null}
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                <DetailRow label={t('modules.records.serialNo')} value={detail.serial_no} />
                <DetailRow label={t('modules.records.site')} value={detail.site} />
                <DetailRow label={t('modules.records.issueDate')} value={detail.issue_date} />
                <DetailRow label={t('modules.records.category')} value={detail.category} />
                <DetailRow label={t('modules.records.costPerTyre')} value={detail.cost_per_tyre != null ? `SAR ${Number(detail.cost_per_tyre).toLocaleString()}` : null} />
                <DetailRow label={t('modules.records.kmFitment')} value={detail.km_at_fitment?.toLocaleString()} />
                <DetailRow label={t('modules.records.kmRemoval')} value={detail.km_at_removal?.toLocaleString()} />
                {detail.km_at_fitment != null && detail.km_at_removal != null && detail.km_at_removal > detail.km_at_fitment ? (
                  <DetailRow
                    label={t('modules.records.tyreLife')}
                    value={(detail.km_at_removal - detail.km_at_fitment).toLocaleString()}
                    highlight
                  />
                ) : null}
                <DetailRow label={t('modules.records.country')} value={detail.country} />
                {detail.description ? (
                  <View style={[styles.detailBlock, { borderBottomColor: c.border }]}>
                    <AppText variant="caption" color="muted" style={{ marginBottom: 4 }}>{t('modules.records.description')}</AppText>
                    <AppText variant="body">{detail.description}</AppText>
                  </View>
                ) : null}
                {detail.remarks ? (
                  <View style={[styles.detailBlock, { borderBottomColor: c.border }]}>
                    <AppText variant="caption" color="muted" style={{ marginBottom: 4 }}>{t('modules.records.remarks')}</AppText>
                    <AppText variant="body">{detail.remarks}</AppText>
                  </View>
                ) : null}
              </ScrollView>
              <Button label={t('common.close')} variant="secondary" full onPress={() => setDetail(null)} style={{ marginTop: spacing.md }} />
            </View>
          </View>
        </Modal>
      )}
    </Screen>
  )
}

function DetailRow({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  const { theme } = useTheme()
  const c = theme.color
  if (!value && value !== '0') return null
  return (
    <View style={[detailRowStyles.row, { borderBottomColor: c.border }]}>
      <AppText style={[detailRowStyles.label, { color: c.textSecondary }]}>{label}</AppText>
      <AppText style={[detailRowStyles.value, { color: highlight ? c.primaryDark : c.text }]}>{value}</AppText>
    </View>
  )
}

const detailRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1 },
  label: { fontSize: 13, flex: 1 },
  value: { fontSize: 13, fontWeight: '600', flex: 1, textAlign: 'right' },
})

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1,
  },

  filterBtn: {
    width: 38, height: 38, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  filterBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginVertical: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderWidth: 1.5,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: spacing.lg, marginBottom: 6, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: radius.pill, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 4,
  },

  list: { paddingHorizontal: spacing.lg, paddingBottom: 40, gap: 10, paddingTop: 6 },

  card: {
    flexDirection: 'row', alignItems: 'center',
    overflow: 'hidden',
  },
  cardBody: { flex: 1, padding: spacing.md, gap: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },

  // Filter / detail sheets
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
    padding: spacing.xl, paddingBottom: 36, gap: spacing.md,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 4 },
  sheetLabel: { textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1.5,
  },

  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  detailBlock: { paddingVertical: 10, borderBottomWidth: 1 },
})
