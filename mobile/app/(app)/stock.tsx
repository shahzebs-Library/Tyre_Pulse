import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput,
  RefreshControl, StatusBar, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRealtime } from '../../hooks/useRealtime'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { canCountStock } from '../../lib/permissions'
import { setStockCount, adjustStock, statusFor } from '../../lib/stock'

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

const STATUS_COLOR: Record<string, string> = { Critical: '#dc2626', Low: '#ea580c', OK: '#16a34a' }

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

export default function StockScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const STATUS_LABEL: Record<string, string> = {
    OK: t('modules.stock.ok'), Low: t('modules.stock.lowS'), Critical: t('modules.stock.criticalS'),
  }
  const router = useRouter()
  const [rows, setRows] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
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
    let q = supabase
      .from('stock_records')
      .select('id,site,description,stock_qty,min_level,critical_level,stock_status,updated_at')
      .order('site')
      .limit(1000)
    if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
    const { data } = await q
    setRows((data as StockItem[]) ?? [])
    setLoading(false)
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

  const shown = useMemo(() => {
    const s = query.trim().toLowerCase()
    let list = rows
    if (filter === 'low') list = list.filter(r => ['Low', 'Critical'].includes(statusFor(r.stock_qty ?? 0, r.min_level, r.critical_level)))
    if (filter === 'stale') list = list.filter(r => !isToday(r.updated_at))
    if (s) list = list.filter(r => r.description?.toLowerCase().includes(s) || r.site?.toLowerCase().includes(s))
    return list
  }, [rows, filter, query])

  const lowCount = useMemo(() => rows.filter(r => ['Low', 'Critical'].includes(statusFor(r.stock_qty ?? 0, r.min_level, r.critical_level))).length, [rows])
  const staleCount = useMemo(() => rows.filter(r => !isToday(r.updated_at)).length, [rows])

  if (!allowed) return null

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { textAlign }]}>{t('modules.stock.title')}</Text>
          <Text style={[styles.sub, { textAlign }]}>{rows.length} {t('modules.stock.items')} · {lowCount} {t('modules.stock.needReorder')}</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color="#94a3b8" />
        <TextInput style={[styles.search, { textAlign }]} placeholder={t('modules.stock.searchPh')} placeholderTextColor="#94a3b8" value={query} onChangeText={setQuery} />
      </View>
      <View style={styles.filters}>
        {(['all', 'low', 'stale'] as FilterKey[]).map(f => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {f === 'all' ? t('modules.stock.all') : f === 'low' ? t('modules.stock.low') : `Not counted today${staleCount ? ` (${staleCount})` : ''}`}
            </Text>
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
          ListEmptyComponent={<View style={styles.empty}><Ionicons name="cube-outline" size={48} color="#cbd5e1" /><Text style={styles.emptyText}>{t('modules.stock.none')}</Text></View>}
          renderItem={({ item }) => {
            const qty = item.stock_qty ?? 0
            const st = statusFor(qty, item.min_level, item.critical_level)
            const sc = STATUS_COLOR[st]
            const counted = countedHint(item.updated_at)
            return (
              <View style={styles.card}>
                <View style={[styles.statusBar, { backgroundColor: sc }]} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.cardTitle, { textAlign }]} numberOfLines={2}>{item.description ?? 'Item'}</Text>
                  <Text style={[styles.cardMeta, { textAlign }]}>
                    {item.site ?? '-'}{item.min_level != null ? ` · ${t('modules.stock.min')} ${item.min_level}` : ''}
                  </Text>
                  <View style={[styles.badgeRow, isRTL && styles.rowR]}>
                    <View style={[styles.statusBadge, { backgroundColor: sc + '1a' }]}>
                      <Text style={[styles.statusText, { color: sc }]}>{STATUS_LABEL[st] ?? st}</Text>
                    </View>
                    <View style={[styles.countedPill, counted.stale && styles.countedPillStale]}>
                      <Ionicons name={counted.stale ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={11} color={counted.stale ? '#b45309' : '#15803d'} />
                      <Text style={[styles.countedText, { color: counted.stale ? '#b45309' : '#15803d' }]}>{counted.text}</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.qtyBox, isRTL && styles.rowR]}>
                  {mayAdjust && (
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => quickAdjust(item, -1)} disabled={busyId === item.id}>
                      <Ionicons name="remove" size={18} color="#dc2626" />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => openCount(item)} disabled={!mayAdjust} activeOpacity={0.7} style={styles.qtyTap}>
                    <Text style={styles.qtyNum}>{qty}</Text>
                    {mayAdjust && <Text style={styles.qtyTapHint}>tap to count</Text>}
                  </TouchableOpacity>
                  {mayAdjust && (
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => quickAdjust(item, 1)} disabled={busyId === item.id}>
                      <Ionicons name="add" size={18} color="#16a34a" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )
          }}
        />
      )}

      {/* ── Stock-take modal ─────────────────────────────────────────────────── */}
      <Modal visible={!!countItem} transparent animationType="fade" onRequestClose={() => setCountItem(null)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => !countSaving && setCountItem(null)} />
          <View style={styles.modalCard}>
            <View style={[styles.modalHead, isRTL && styles.rowR]}>
              <View style={styles.modalIcon}><Ionicons name="clipboard-outline" size={18} color="#16a34a" /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { textAlign }]} numberOfLines={2}>{countItem?.description ?? 'Item'}</Text>
                <Text style={[styles.modalSub, { textAlign }]}>
                  {countItem?.site ?? '-'} · was {countItem?.stock_qty ?? 0}
                </Text>
              </View>
            </View>

            <Text style={[styles.modalLabel, { textAlign }]}>Counted quantity</Text>
            <TextInput
              style={[styles.countInput, { textAlign: 'center' }]}
              value={countValue}
              onChangeText={v => setCountValue(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#cbd5e1"
              autoFocus
              selectTextOnFocus
            />
            <TextInput
              style={[styles.reasonInput, { textAlign }]}
              value={countReason}
              onChangeText={setCountReason}
              placeholder="Reason / note (optional)"
              placeholderTextColor="#94a3b8"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => !countSaving && setCountItem(null)} disabled={countSaving}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSave, countSaving && styles.modalSaveDisabled]} onPress={submitCount} disabled={countSaving}>
                {countSaving ? <ActivityIndicator size="small" color="#fff" /> : (
                  <>
                    <Ionicons name="save-outline" size={16} color="#fff" />
                    <Text style={styles.modalSaveText}>Save count</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  search: { flex: 1, paddingVertical: 11, fontSize: 14, color: '#0f172a' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  chipTextActive: { color: '#fff' },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, paddingLeft: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  statusBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  cardMeta: { fontSize: 11.5, color: '#94a3b8' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 10, fontWeight: '800' },
  countedPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(22,163,74,0.1)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  countedPillStale: { backgroundColor: 'rgba(245,158,11,0.14)' },
  countedText: { fontSize: 9.5, fontWeight: '800' },
  qtyBox: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' },
  qtyTap: { minWidth: 44, alignItems: 'center' },
  qtyNum: { fontSize: 18, fontWeight: '800', color: '#0f172a', minWidth: 28, textAlign: 'center' },
  qtyTapHint: { fontSize: 8.5, fontWeight: '700', color: '#0ea5e9', marginTop: 1 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#94a3b8' },

  // Modal
  modalRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  modalCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 12 },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(22,163,74,0.1)', alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  modalSub: { fontSize: 11.5, color: '#94a3b8', marginTop: 2 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: '#334155' },
  countInput: { backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#16a34a', borderRadius: 14, paddingVertical: 14, fontSize: 30, fontWeight: '900', color: '#0f172a', letterSpacing: 1 },
  reasonInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 13, color: '#0f172a' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalCancel: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '800', color: '#64748b' },
  modalSave: { flex: 1.4, flexDirection: 'row', gap: 8, height: 48, borderRadius: 12, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  modalSaveDisabled: { opacity: 0.5 },
  modalSaveText: { fontSize: 14, fontWeight: '800', color: '#fff' },
})
