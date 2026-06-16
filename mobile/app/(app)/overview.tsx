import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { UserRole } from '../../lib/types'

const ROLES: UserRole[] = ['admin', 'manager', 'director']
const RISK_COLOR: Record<string, string> = { Critical: '#dc2626', High: '#ea580c', Medium: '#ca8a04', Low: '#16a34a', Unknown: '#94a3b8' }

interface Summary {
  total_records: number
  distinct_assets: number
  total_cost: number
  high_risk: number
  critical: number
  risk_breakdown: { level: string; count: number }[]
  top_sites: { site: string; count: number; cost: number }[]
  monthly_trend: { month: string; count: number; cost: number }[]
}

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return Math.round(n).toLocaleString()
}

export default function OverviewScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const { allowed } = useRoleGuard(ROLES)
  const [s, setS] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('report_tyre_summary', {
      p_country: profile?.country ?? 'All', p_from: null, p_to: null,
    })
    setS(data as Summary)
    setLoading(false)
  }, [profile?.country])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  if (!allowed) return null

  const risk = s?.risk_breakdown ?? []
  const riskMax = Math.max(...risk.map(r => r.count), 1)
  const sites = s?.top_sites?.slice(0, 6) ?? []
  const siteMax = Math.max(...sites.map(x => x.count), 1)
  const trend = s?.monthly_trend ?? []
  const trendMax = Math.max(...trend.map(m => m.count), 1)

  const kpis = [
    { key: 'tyres', label: t('modules.overview.tyres'), value: compact(s?.total_records ?? 0), icon: 'ellipse-outline', tint: '#2563eb' },
    { key: 'vehicles', label: t('modules.overview.vehicles'), value: compact(s?.distinct_assets ?? 0), icon: 'bus-outline', tint: '#0d9488' },
    { key: 'highRisk', label: t('modules.overview.highRisk'), value: compact(s?.high_risk ?? 0), icon: 'alert-circle-outline', tint: '#dc2626' },
    { key: 'periodCost', label: t('modules.overview.periodCost'), value: compact(s?.total_cost ?? 0), icon: 'cash-outline', tint: '#7c3aed' },
  ]

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { textAlign }]}>{t('modules.overview.title')}</Text>
          <Text style={[styles.sub, { textAlign }]}>{profile?.country ?? t('modules.overview.allCountries')}</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
        >
          <View style={styles.kpiGrid}>
            {kpis.map(k => (
              <View key={k.key} style={styles.kpiCard}>
                <View style={[styles.kpiIcon, { backgroundColor: k.tint + '14' }]}>
                  <Ionicons name={k.icon as any} size={18} color={k.tint} />
                </View>
                <Text style={styles.kpiValue}>{k.value}</Text>
                <Text style={styles.kpiLabel}>{k.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={[styles.section, { textAlign }]}>{t('modules.overview.riskDist')}</Text>
            {risk.map(r => (
              <View key={r.level} style={styles.barRow}>
                <Text style={styles.barLabel}>{r.level}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(r.count / riskMax) * 100}%`, backgroundColor: RISK_COLOR[r.level] ?? '#94a3b8' }]} />
                </View>
                <Text style={styles.barValue}>{compact(r.count)}</Text>
              </View>
            ))}
          </View>

          {sites.length > 0 && (
            <View style={styles.card}>
              <Text style={[styles.section, { textAlign }]}>{t('modules.overview.topSites')}</Text>
              {sites.map(x => (
                <View key={x.site} style={styles.barRow}>
                  <Text style={styles.barLabel} numberOfLines={1}>{x.site}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${(x.count / siteMax) * 100}%`, backgroundColor: '#2563eb' }]} />
                  </View>
                  <Text style={styles.barValue}>{compact(x.count)}</Text>
                </View>
              ))}
            </View>
          )}

          {trend.length > 0 && (
            <View style={styles.card}>
              <Text style={[styles.section, { textAlign }]}>{t('modules.overview.trend')}</Text>
              <View style={styles.trendRow}>
                {trend.map(m => (
                  <View key={m.month} style={styles.trendCol}>
                    <View style={styles.trendBarTrack}>
                      <View style={[styles.trendBar, { height: `${Math.max(4, (m.count / trendMax) * 100)}%` }]} />
                    </View>
                    <Text style={styles.trendVal}>{compact(m.count)}</Text>
                    <Text style={styles.trendMonth}>{m.month.split(' ')[0]}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
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
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: { width: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  kpiIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  kpiLabel: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', gap: 10 },
  section: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 72, fontSize: 12, color: '#475569', fontWeight: '600' },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#eef2f7', overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  barValue: { width: 44, fontSize: 12, fontWeight: '700', color: '#0f172a', textAlign: 'right' },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 130, gap: 6 },
  trendCol: { flex: 1, alignItems: 'center', gap: 4 },
  trendBarTrack: { width: '70%', height: 90, justifyContent: 'flex-end' },
  trendBar: { width: '100%', borderRadius: 5, backgroundColor: '#16a34a' },
  trendVal: { fontSize: 10, fontWeight: '700', color: '#475569' },
  trendMonth: { fontSize: 10, color: '#94a3b8' },
})
