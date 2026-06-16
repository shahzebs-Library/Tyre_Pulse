import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { canInspect } from '../../lib/permissions'

interface Vehicle {
  id: string
  asset_no: string | null
  fleet_number: string | null
  make: string | null
  model: string | null
  vehicle_type: string | null
  site: string | null
  status: string | null
  operator_name: string | null
  tyre_size: string | null
}

const STATUS_COLOR: Record<string, string> = {
  active: '#16a34a', operational: '#16a34a',
  maintenance: '#ca8a04', repair: '#ea580c',
  inactive: '#94a3b8', retired: '#94a3b8', sold: '#94a3b8',
}

export default function VehiclesScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const [rows, setRows] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')

  const textAlign = isRTL ? 'right' : 'left'
  const mayInspect = canInspect(profile?.role)

  const load = useCallback(async () => {
    let q = supabase
      .from('vehicle_fleet')
      .select('id,asset_no,fleet_number,make,model,vehicle_type,site,status,operator_name,tyre_size')
      .order('asset_no')
      .limit(2000)
    if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
    const { data } = await q
    setRows((data as Vehicle[]) ?? [])
    setLoading(false)
  }, [profile?.country])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const shown = useMemo(() => {
    const s = query.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(v =>
      v.asset_no?.toLowerCase().includes(s) ||
      v.fleet_number?.toLowerCase().includes(s) ||
      v.make?.toLowerCase().includes(s) ||
      v.model?.toLowerCase().includes(s) ||
      v.vehicle_type?.toLowerCase().includes(s) ||
      v.site?.toLowerCase().includes(s),
    )
  }, [rows, query])

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { textAlign }]}>{t('modules.vehicles.title')}</Text>
          <Text style={[styles.sub, { textAlign }]}>{rows.length} {t('modules.vehicles.inFleet')}</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color="#94a3b8" />
        <TextInput
          style={[styles.search, { textAlign }]}
          placeholder={t('modules.vehicles.searchPh')}
          placeholderTextColor="#94a3b8"
          value={query}
          onChangeText={setQuery}
        />
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
              <Ionicons name="bus-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyText}>{t('modules.vehicles.none')}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const sc = STATUS_COLOR[(item.status ?? '').toLowerCase()] ?? '#64748b'
            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.85}
                disabled={!mayInspect}
                onPress={() => mayInspect && router.push({ pathname: '/(app)/inspection/new', params: { site: item.site ?? '', asset: item.asset_no ?? '' } })}
              >
                <View style={styles.vIcon}>
                  <Ionicons name="bus" size={20} color="#16a34a" />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.cardTitle, { textAlign }]}>{item.asset_no ?? item.fleet_number ?? 'Unknown'}</Text>
                  <Text style={[styles.cardMeta, { textAlign }]} numberOfLines={1}>
                    {[item.make, item.model, item.vehicle_type].filter(Boolean).join(' · ') || '—'}
                  </Text>
                  <Text style={[styles.cardMeta, { textAlign }]} numberOfLines={1}>
                    {[item.site, item.tyre_size].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  {item.status && (
                    <View style={[styles.statusBadge, { backgroundColor: sc + '1a' }]}>
                      <Text style={[styles.statusText, { color: sc }]}>{item.status}</Text>
                    </View>
                  )}
                  {mayInspect && <Ionicons name="clipboard-outline" size={18} color="#16a34a" />}
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  search: { flex: 1, paddingVertical: 11, fontSize: 14, color: '#0f172a' },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  vIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(22,163,74,0.08)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  cardMeta: { fontSize: 11.5, color: '#94a3b8' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#94a3b8' },
})
