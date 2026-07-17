import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  RefreshControl, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useRealtime } from '../../hooks/useRealtime'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { canCountStock } from '../../lib/permissions'
import { setStockCount, adjustStock, statusFor } from '../../lib/stock'
import { Theme, StatusKind, spacing, radius, elevation } from '../../lib/theme'
import {
  Screen, Card, AppText, Badge, StatTile, Button, Loading, EmptyState, ErrorState,
} from '../../components/ui'

interface StockItem {
  id: string
  site: string | null
  description: string | null
  stock_qty: number | null
  min_level: number | null
  critical_level: number | null
  stock_status: string | null
  updated_at: string | null
}

type FilterKey = 'all' | 'low' | 'stale'

/** Stock status -> design-system status kind. */
const STATUS_KIND: Record<string, StatusKind> = { Critical: 'critical', Low: 'warning', OK: 'success' }
function statusKind(st: string): StatusKind {
  return STATUS_KIND[st] ?? 'neutral'
}

// Whole-day age of the last count (null when never counted).
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / 86400000)
}
function isToday(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}
function countedHint(iso: string | null): { text: string; stale: boolean } {
  if (!iso) return { text: 'Never counted', stale: true }
  if (isToday(iso)) return { text: 'Counted today', stale: false }
  const n = daysSince(iso)
  if (n == null) return { text: 'Counted', stale: true }
  if (n <= 0) return { text: 'Counted today', stale: false }
  return { text: `Counted ${n}d ago`, stale: n >= 1 }
}

// Bucket a row that has no recognisable tyre size.
const NO_SIZE = 'No size'

/**
 * Derive a tyre size token from a free-text stock description. stock_records has
 * NO dedicated size column - the size is embedded in `description` (e.g.
 * "315/80R22.5 Double Coin"), so we extract the standard tyre-size pattern.
 * Returns null when the description carries no recognisable size.
 */
function extractTyreSize(desc: string | null): string | null {
  if (!desc) return null
  const s = desc.toUpperCase()
  // Metric radial: 315/80R22.5, 295/80 R 22.5, 385/65R22.5
  let m = s.match(/\d{2,3}\s*\/\s*\d{2,3}\s*R?\s*\d{2}(?:\.\d)?/)
  if (m) return m[0].replace(/\s+/g, '')
  // Radial / bias without aspect ratio: 11R22.5, 1200R20, 12.00-20, 385R22.5
  m = s.match(/\d{2,4}(?:\.\d{1,2})?\s*[-R]\s*\d{2}(?:\.\d)?/)
  if (m) return m[0].replace(/\s+/g, '')
  return null
}

export default function StockScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const s = useMemo(() => makeStyles(theme), [theme])
  const STATUS_LABEL: Record<string, string> = {
    OK: t('modules.stock.ok'), Low: t('modules.stock.lowS'), Critical: t('modules.stock.criticalS'),
  }
  const router = useRouter()
  const [rows, setRows] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
  const [sizeFilter, setSizeFilter] = useState<string>('all')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  // Stock-take modal state
  const [countItem, setCountItem] = useState<StockItem | null>(null)
  const [countValue, setCountValue] = useState('')
  const [countReason, setCountReason] = useState('')
  const [countSaving, setCountSaving] = useState(false)

  const { allowed } = useRoleGuard(['tyre_man', 'admin', 'manager', 'director'])
  const textAlign = isRTL ? 'right' : 'left'
  const mayAdjust = canCountStock(profile?.role)

  const load = useCallback(async () => {
    try {
      setError(null)
      let q = supabase
        .from('stock_records')
        .select('id,site,description,stock_qty,min_level,critical_level,stock_status,updated_at')
        .order('site')
        .limit(1000)
      if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
      const { data, error: qErr } = await q
      if (qErr) throw qErr
      setRows((data as StockItem[]) ?? [])
    } catch (e: any) {
      if (__DEV__) console.warn('[stock] load failed:', e?.message)
      setError('Could not load stock. Pull down to retry.')
    } finally {
      setLoading(false)
    }
  }, [profile?.country])

  useEffect(() => { load() }, [load])
  useRealtime('stock_records', load)

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  const ctxFor = (item: StockItem) => ({
    minLevel: item.min_level, criticalLevel: item.critical_level, userId: profile?.id ?? null,
  })

  async function quickAdjust(item: StockItem, delta: number) {
    if (!mayAdjust || busyId) return
    const current = item.stock_qty ?? 0
    if (delta < 0 && current <= 0) return
    setBusyId(item.id)
    // optimistic
    const optimistic = Math.max(0, current + delta)
    setRows(prev => prev.map(r => r.id === item.id
      ? { ...r, stock_qty: optimistic, stock_status: statusFor(optimistic, r.min_level, r.critical_level), updated_at: new Date().toISOString() }
      : r))
    try {
      const res = await adjustStock(item.id, delta, current, ctxFor(item))
      if (res.qtyAfter != null) {
        setRows(prev => prev.map(r => r.id === item.id
          ? { ...r, stock_qty: res.qtyAfter!, stock_status: res.status ?? statusFor(res.qtyAfter!, r.min_level, r.critical_level) }
          : r))
      }
      if (res.offline) Alert.alert(t('modules.common.offlineSaved'))
    } catch (e: any) {
      await load() // reconcile from server on a real rejection
      Alert.alert('Could not update', e?.message || 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  function openCount(item: StockItem) {
    if (!mayAdjust) return
    setCountItem(item)
    setCountValue(String(item.stock_qty ?? 0))
    setCountReason('')
  }

  async function submitCount() {
    if (!countItem || countSaving) return
    const n = Number(countValue)
    if (countValue.trim() === '' || Number.isNaN(n) || n < 0) {
      Alert.alert('Invalid count', 'Enter the exact quantity counted (0 or more).')
      return
    }
    setCountSaving(true)
    try {
      const res = await setStockCount(countItem.id, n, countReason.trim() || null, ctxFor(countItem))
      const after = res.qtyAfter ?? Math.floor(n)
      setRows(prev => prev.map(r => r.id === countItem.id
        ? { ...r, stock_qty: after, stock_status: res.status ?? statusFor(after, r.min_level, r.critical_level), updated_at: new Date().toISOString() }
        : r))
      setCountItem(null)
      if (res.offline) Alert.alert(t('modules.common.offlineSaved'))
    } catch (e: any) {
      Alert.alert('Could not save count', e?.message || 'Please try again.')
    } finally {
      setCountSaving(false)
    }
  }

  // Distinct location (site) + tyre-size options, derived live from loaded rows
  // (never hardcoded). Size is extracted from the description; rows without a
  // recognisable size fall into the NO_SIZE bucket so the filter stays honest.
  const locationOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) { const v = r.site?.trim(); if (v) set.add(v) }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const sizeOptions = useMemo(() => {
    const set = new Set<string>()
    let sawUnsized = false
    for (const r of rows) {
      const sz = extractTyreSize(r.description)
      if (sz) set.add(sz); else sawUnsized = true
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (sawUnsized && set.size > 0) list.push(NO_SIZE)
    return list
  }, [rows])

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase()
    let list = rows
    if (filter === 'low') list = list.filter(r => ['Low', 'Critical'].includes(statusFor(r.stock_qty ?? 0, r.min_level, r.critical_level)))
    if (filter === 'stale') list = list.filter(r => !isToday(r.updated_at))
    if (locationFilter !== 'all') list = list.filter(r => (r.site?.trim() ?? '') === locationFilter)
    if (sizeFilter !== 'all') list = list.filter(r => (extractTyreSize(r.description) ?? NO_SIZE) === sizeFilter)
    if (term) list = list.filter(r => r.description?.toLowerCase().includes(term) || r.site?.toLowerCase().includes(term))
    return list
  }, [rows, filter, query, sizeFilter, locationFilter])

  const lowCount = useMemo(() => rows.filter(r => ['Low', 'Critical'].includes(statusFor(r.stock_qty ?? 0, r.min_level, r.critical_level))).length, [rows])
  const staleCount = useMemo(() => rows.filter(r => !isToday(r.updated_at)).length, [rows])

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'all', label: t('modules.stock.all') },
    { key: 'low', label: t('modules.stock.low') },
    { key: 'stale', label: `Not counted today${staleCount ? ` (${staleCount})` : ''}` },
  ]

  if (!allowed) return null

  return (
    <Screen edges={['top']}>
      <View style={[s.header, isRTL && s.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.stock.title')}</AppText>
          <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>
            {rows.length} {t('modules.stock.items')} · {lowCount} {t('modules.stock.needReorder')}
          </AppText>
        </View>
      </View>

      {!loading && (
        <View style={s.statRow}>
          <StatTile
            label={t('modules.stock.items')} value={rows.length}
            icon="cube" tint="blue" onPress={() => setFilter('all')}
          />
          <StatTile
            label={t('modules.stock.needReorder')} value={lowCount}
            icon="alert-circle" tint="red" onPress={() => setFilter('low')}
          />
          <StatTile
            label="Not counted" value={staleCount}
            icon="time-outline" tint="amber" onPress={() => setFilter('stale')}
          />
        </View>
      )}

      <View style={[s.searchWrap, isRTL && s.rowR]}>
        <Ionicons name="search-outline" size={18} color={theme.color.textMuted} />
        <TextInput
          style={[s.search, { color: theme.color.text, textAlign }]}
          placeholder={t('modules.stock.searchPh')}
          placeholderTextColor={theme.color.textMuted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={theme.color.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={[s.filters, isRTL && s.rowR]}>
        {FILTERS.map(({ key, label }) => {
          const active = filter === key
          return (
            <TouchableOpacity
              key={key}
              style={[s.chip, active && s.chipActive]}
              onPress={() => setFilter(key)}
              activeOpacity={0.8}
            >
              <AppText variant="label" style={{ color: active ? theme.color.onPrimary : theme.color.textSecondary }}>
                {label}
              </AppText>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Location (site) filter - options derived from the loaded rows */}
      {locationOptions.length > 1 && (
        <View style={[s.dimRow, isRTL && s.rowR]}>
          <View style={[s.dimLead, isRTL && s.rowR]}>
            <Ionicons name="location-outline" size={13} color={theme.color.textMuted} />
            <AppText variant="micro" color="muted">Location</AppText>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[s.dimScroll, isRTL && s.rowR]}
          >
            {['all', ...locationOptions].map(opt => {
              const active = locationFilter === opt
              return (
                <TouchableOpacity
                  key={opt}
                  style={[s.chipSm, active && s.chipActive]}
                  onPress={() => setLocationFilter(opt)}
                  activeOpacity={0.8}
                >
                  <AppText variant="micro" style={{ color: active ? theme.color.onPrimary : theme.color.textSecondary, fontWeight: '700' }}>
                    {opt === 'all' ? 'All' : opt}
                  </AppText>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>
      )}

      {/* Tyre size filter - sizes extracted from each row description */}
      {sizeOptions.length > 1 && (
        <View style={[s.dimRow, isRTL && s.rowR]}>
          <View style={[s.dimLead, isRTL && s.rowR]}>
            <Ionicons name="resize-outline" size={13} color={theme.color.textMuted} />
            <AppText variant="micro" color="muted">Size</AppText>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[s.dimScroll, isRTL && s.rowR]}
          >
            {['all', ...sizeOptions].map(opt => {
              const active = sizeFilter === opt
              return (
                <TouchableOpacity
                  key={opt}
                  style={[s.chipSm, active && s.chipActive]}
                  onPress={() => setSizeFilter(opt)}
                  activeOpacity={0.8}
                >
                  <AppText variant="micro" style={{ color: active ? theme.color.onPrimary : theme.color.textSecondary, fontWeight: '700' }}>
                    {opt === 'all' ? 'All' : opt}
                  </AppText>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <Loading label="Loading stock" />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={i => i.id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={12}
          windowSize={11}
          removeClippedSubviews
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
          ListEmptyComponent={
            error ? (
              <ErrorState message={error} onRetry={onRefresh} />
            ) : (
              <EmptyState
                icon="cube-outline"
                title={t('modules.stock.none')}
                message={query || filter !== 'all' || sizeFilter !== 'all' || locationFilter !== 'all' ? 'Try a different search or filter.' : undefined}
              />
            )
          }
          renderItem={({ item }) => {
            const qty = item.stock_qty ?? 0
            const st = statusFor(qty, item.min_level, item.critical_level)
            const kind = statusKind(st)
            const counted = countedHint(item.updated_at)
            return (
              <Card padded={false} accent={theme.color[kind].base} style={s.card}>
                <View style={[s.cardRow, isRTL && s.rowR]}>
                  <View style={{ flex: 1, gap: 5 }}>
                    <AppText variant="title" style={{ textAlign }} numberOfLines={2}>{item.description ?? 'Item'}</AppText>
                    <AppText variant="caption" color="muted" style={{ textAlign }}>
                      {item.site ?? '-'}{item.min_level != null ? ` · ${t('modules.stock.min')} ${item.min_level}` : ''}
                    </AppText>
                    <View style={[s.badgeRow, isRTL && s.rowR]}>
                      <Badge kind={kind}>{STATUS_LABEL[st] ?? st}</Badge>
                      <View style={[s.countedPill, { backgroundColor: counted.stale ? theme.color.warning.soft : theme.color.success.soft }]}>
                        <Ionicons
                          name={counted.stale ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                          size={11}
                          color={counted.stale ? theme.color.warning.on : theme.color.success.on}
                        />
                        <AppText variant="micro" style={{ color: counted.stale ? theme.color.warning.on : theme.color.success.on }}>
                          {counted.text}
                        </AppText>
                      </View>
                    </View>
                  </View>
                  <View style={[s.qtyBox, isRTL && s.rowR]}>
                    {mayAdjust && (
                      <TouchableOpacity style={[s.qtyBtn, { backgroundColor: theme.color.danger.soft }]} onPress={() => quickAdjust(item, -1)} disabled={busyId === item.id} activeOpacity={0.7}>
                        <Ionicons name="remove" size={18} color={theme.color.danger.base} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => openCount(item)} disabled={!mayAdjust} activeOpacity={0.7} style={s.qtyTap}>
                      <AppText variant="h2" numberOfLines={1}>{qty}</AppText>
                      {mayAdjust && <AppText variant="micro" color="info">tap to count</AppText>}
                    </TouchableOpacity>
                    {mayAdjust && (
                      <TouchableOpacity style={[s.qtyBtn, { backgroundColor: theme.color.success.soft }]} onPress={() => quickAdjust(item, 1)} disabled={busyId === item.id} activeOpacity={0.7}>
                        <Ionicons name="add" size={18} color={theme.color.success.base} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </Card>
            )
          }}
        />
      )}

      {/* ── Stock-take modal ─────────────────────────────────────────────────── */}
      <Modal visible={!!countItem} transparent animationType="fade" onRequestClose={() => setCountItem(null)}>
        <KeyboardAvoidingView style={s.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={[s.modalBackdrop, { backgroundColor: theme.color.overlay }]} activeOpacity={1} onPress={() => !countSaving && setCountItem(null)} />
          <View style={s.modalCard}>
            <View style={[s.modalHead, isRTL && s.rowR]}>
              <View style={[s.modalIcon, { backgroundColor: theme.color.primarySoft }]}>
                <Ionicons name="clipboard-outline" size={18} color={theme.color.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="title" style={{ textAlign }} numberOfLines={2}>{countItem?.description ?? 'Item'}</AppText>
                <AppText variant="caption" color="muted" style={{ textAlign, marginTop: 2 }}>
                  was {countItem?.stock_qty ?? 0}
                </AppText>
              </View>
            </View>

            {/* Location + tyre size of the item being counted */}
            <View style={[s.metaChips, isRTL && s.rowR]}>
              <View style={[s.metaChip, isRTL && s.rowR]}>
                <Ionicons name="location-outline" size={12} color={theme.color.primary} />
                <AppText variant="micro" style={{ color: theme.color.text, fontWeight: '700' }}>
                  {countItem?.site?.trim() || 'No location'}
                </AppText>
              </View>
              <View style={[s.metaChip, isRTL && s.rowR]}>
                <Ionicons name="resize-outline" size={12} color={theme.color.primary} />
                <AppText variant="micro" style={{ color: theme.color.text, fontWeight: '700' }}>
                  {(countItem && extractTyreSize(countItem.description)) || NO_SIZE}
                </AppText>
              </View>
            </View>

            <AppText variant="label" color="secondary" style={{ textAlign }}>Counted quantity</AppText>
            <TextInput
              style={[s.countInput, { textAlign: 'center' }]}
              value={countValue}
              onChangeText={v => setCountValue(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={theme.color.textMuted}
              autoFocus
              selectTextOnFocus
            />
            <TextInput
              style={[s.reasonInput, { textAlign }]}
              value={countReason}
              onChangeText={setCountReason}
              placeholder="Reason / note (optional)"
              placeholderTextColor={theme.color.textMuted}
            />

            <View style={s.modalActions}>
              <Button label="Cancel" variant="secondary" onPress={() => !countSaving && setCountItem(null)} disabled={countSaving} style={{ flex: 1 }} />
              <Button label="Save count" icon="save-outline" onPress={submitCount} loading={countSaving} style={{ flex: 1.4 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    },
    backBtn: {
      width: 40, height: 40, borderRadius: radius.md,
      backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border, ...elevation(theme, 1),
    },
    statRow: {
      flexDirection: 'row', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginHorizontal: spacing.lg, marginBottom: spacing.sm,
      backgroundColor: c.surface, borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      borderWidth: 1.5, borderColor: c.border,
    },
    search: { flex: 1, paddingVertical: 12, fontSize: 15, fontWeight: '500' },
    filters: {
      flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap',
      paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
    },
    chip: {
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
      borderRadius: radius.pill, backgroundColor: c.surface,
      borderWidth: 1.5, borderColor: c.border,
    },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipSm: {
      paddingHorizontal: spacing.md, paddingVertical: 6,
      borderRadius: radius.pill, backgroundColor: c.surface,
      borderWidth: 1.5, borderColor: c.border, marginRight: spacing.sm,
    },
    dimRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingLeft: spacing.lg, paddingBottom: spacing.sm,
    },
    dimLead: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 62 },
    dimScroll: { paddingRight: spacing.lg, alignItems: 'center' },
    metaChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: -spacing.xs },
    metaChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: c.surfaceAlt, borderRadius: radius.pill,
      paddingHorizontal: 10, paddingVertical: 5,
      borderWidth: 1, borderColor: c.border,
    },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md, paddingTop: spacing.xs, flexGrow: 1 },
    card: { overflow: 'hidden' },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: 2 },
    countedPill: {
      flexDirection: 'row', alignItems: 'center', gap: 3,
      borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3,
    },
    qtyBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    qtyBtn: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    qtyTap: { minWidth: 46, alignItems: 'center' },

    // Modal
    modalRoot: { flex: 1, justifyContent: 'center', padding: spacing['2xl'] },
    modalBackdrop: { ...StyleSheet.absoluteFillObject },
    modalCard: {
      backgroundColor: c.surface, borderRadius: radius['2xl'], padding: spacing.xl, gap: spacing.md,
      borderWidth: 1, borderColor: c.border, ...elevation(theme, 3),
    },
    modalHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    modalIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    countInput: {
      backgroundColor: c.surfaceAlt, borderWidth: 1.5, borderColor: c.primary,
      borderRadius: radius.lg, paddingVertical: 14, fontSize: 30, fontWeight: '900',
      color: c.text, letterSpacing: 1,
    },
    reasonInput: {
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
      fontSize: 14, color: c.text,
    },
    modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  })
}
