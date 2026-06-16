import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRealtime } from '../../hooks/useRealtime'

type FilterKey = 'all' | 'Critical' | 'High'

interface AlertRow {
  id: string
  asset_no: string | null
  site: string | null
  brand: string | null
  position: string | null
  risk_level: string | null
  serial_no: string | null
  tread_depth: number | null
  issue_date: string | null
}

const RISK_COLOR: Record<string, string> = { Critical: '#dc2626', High: '#ea580c' }

export default function AlertsScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const router = useRouter()
  const [rows, setRows] = useState<AlertRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')

  const textAlign = isRTL ? 'right' : 'left'

  const load = useCallback(async () => {
    let q = supabase
      .from('tyre_records')
      .select('id,asset_no,site,brand,position,risk_level,serial_no,tread_depth,issue_date')
      .in('risk_level', ['Critical', 'High'])
      .order('issue_date', { ascending: false })
      .limit(300)
    if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
    const { data } = await q
    setRows((data as AlertRow[]) ?? [])
    setLoading(false)
  }, [profile?.country])

  useEffect(() => { load() }, [load])
  useRealtime('tyre_records', load)

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter(r => r.risk_level === filter)),
    [rows, filter],
  )
  const critCount = useMemo(() => rows.filter(r => r.risk_level === 'Critical').length, [rows])

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { textAlign }]}>Tyre Alerts</Text>
          <Text style={[styles.sub, { textAlign }]}>{critCount} critical · {rows.length} flagged</Text>
        </View>
      </View>

      <View style={styles.filters}>
        {(['all', 'Critical', 'High'] as FilterKey[]).map(f => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f === 'all' ? 'All' : f}</Text>
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
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="shield-checkmark-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>No active alerts</Text>
            </View>
          }
          renderItem={({ item }) => {
            const rc = RISK_COLOR[item.risk_level ?? ''] ?? '#64748b'
            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.85}
                onPress={() => item.asset_no && router.push({ pathname: '/(app)/inspection/new', params: { site: item.site ?? '', asset: item.asset_no } })}
              >
                <View style={[styles.riskDot, { backgroundColor: rc }]}>
                  <Ionicons name="alert" size={16} color="#fff" />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.cardTitle, { textAlign }]}>{item.asset_no ?? 'Unknown asset'}</Text>
                  <Text style={[styles.cardMeta, { textAlign }]}>
                    {[item.site, item.brand, item.position].filter(Boolean).join(' · ') || '—'}
                  </Text>
                  <Text style={[styles.cardMeta, { textAlign }]}>
                    {item.serial_no ? `SN ${item.serial_no}` : ''}{item.tread_depth != null ? `  ·  ${item.tread_depth}mm` : ''}
                  </Text>
                </View>
                <View style={[styles.riskBadge, { backgroundColor: rc + '1a' }]}>
                  <Text style={[styles.riskBadgeText, { color: rc }]}>{item.risk_level}</Text>
                </View>
              </TouchableOpacity>
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
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  chipActive: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  chipTextActive: { color: '#fff' },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  riskDot: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  cardMeta: { fontSize: 11.5, color: '#94a3b8' },
  riskBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  riskBadgeText: { fontSize: 11, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#94a3b8' },
})
