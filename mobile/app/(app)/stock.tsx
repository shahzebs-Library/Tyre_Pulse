import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput,
  RefreshControl, StatusBar, ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRealtime } from '../../hooks/useRealtime'
import { canInspect } from '../../lib/permissions'

interface StockItem {
  id: string
  site: string | null
  description: string | null
  stock_qty: number | null
  min_level: number | null
  critical_level: number | null
  stock_status: string | null
}

type FilterKey = 'all' | 'low'

function statusFor(qty: number, min: number | null, crit: number | null): string {
  if (crit != null && qty <= crit) return 'Critical'
  if (min != null && qty <= min) return 'Low'
  return 'OK'
}
const STATUS_COLOR: Record<string, string> = { Critical: '#dc2626', Low: '#ea580c', OK: '#16a34a' }

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

  const textAlign = isRTL ? 'right' : 'left'
  const mayAdjust = canInspect(profile?.role)

  const load = useCallback(async () => {
    let q = supabase
      .from('stock_records')
      .select('id,site,description,stock_qty,min_level,critical_level,stock_status')
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

  async function adjust(item: StockItem, delta: number) {
    if (!mayAdjust || busyId) return
    const next = Math.max(0, (item.stock_qty ?? 0) + delta)
    setBusyId(item.id)
    // optimistic
    setRows(prev => prev.map(r => r.id === item.id ? { ...r, stock_qty: next, stock_status: statusFor(next, r.min_level, r.critical_level) } : r))
    const { error } = await supabase.from('stock_records').update({
      stock_qty: next,
      stock_status: statusFor(next, item.min_level, item.critical_level),
      updated_by: profile?.id ?? null,
      updated_at: new Date().toISOString(),
    }).eq('id', item.id)
    setBusyId(null)
    if (error) { Alert.alert(t('modules.stock.updateFailed'), error.message); load() }
  }

  const shown = useMemo(() => {
    const s = query.trim().toLowerCase()
    let list = rows
    if (filter === 'low') list = list.filter(r => ['Low', 'Critical'].includes(statusFor(r.stock_qty ?? 0, r.min_level, r.critical_level)))
    if (s) list = list.filter(r => r.description?.toLowerCase().includes(s) || r.site?.toLowerCase().includes(s))
    return list
  }, [rows, filter, query])

  const lowCount = useMemo(() => rows.filter(r => ['Low', 'Critical'].includes(statusFor(r.stock_qty ?? 0, r.min_level, r.critical_level))).length, [rows])

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
        {(['all', 'low'] as FilterKey[]).map(f => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f === 'all' ? t('modules.stock.all') : t('modules.stock.low')}</Text>
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
            return (
              <View style={styles.card}>
                <View style={[styles.statusBar, { backgroundColor: sc }]} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.cardTitle, { textAlign }]} numberOfLines={2}>{item.description ?? 'Item'}</Text>
                  <Text style={[styles.cardMeta, { textAlign }]}>
                    {item.site ?? '—'}{item.min_level != null ? ` · ${t('modules.stock.min')} ${item.min_level}` : ''}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: sc + '1a' }]}>
                    <Text style={[styles.statusText, { color: sc }]}>{STATUS_LABEL[st] ?? st}</Text>
                  </View>
                </View>
                <View style={[styles.qtyBox, isRTL && styles.rowR]}>
                  {mayAdjust && (
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => adjust(item, -1)} disabled={busyId === item.id}>
                      <Ionicons name="remove" size={18} color="#dc2626" />
                    </TouchableOpacity>
                  )}
                  <Text style={styles.qtyNum}>{qty}</Text>
                  {mayAdjust && (
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => adjust(item, 1)} disabled={busyId === item.id}>
                      <Ionicons name="add" size={18} color="#16a34a" />
                    </TouchableOpacity>
                  )}
                </View>
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  search: { flex: 1, paddingVertical: 11, fontSize: 14, color: '#0f172a' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  chipTextActive: { color: '#fff' },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, paddingLeft: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  statusBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  cardMeta: { fontSize: 11.5, color: '#94a3b8' },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 2 },
  statusText: { fontSize: 10, fontWeight: '800' },
  qtyBox: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' },
  qtyNum: { fontSize: 18, fontWeight: '800', color: '#0f172a', minWidth: 28, textAlign: 'center' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#94a3b8' },
})
