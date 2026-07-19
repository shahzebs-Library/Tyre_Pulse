/**
 * Fleet Analytics - mobile KPI dashboard
 *
 * Available to: admin · manager · director
 * Shows: fleet cost KPIs, risk breakdown, top sites by cost, recent critical alerts
 */

import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  RefreshControl, StatusBar, ActivityIndicator, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../../lib/supabase'
import { useElevatedGuard } from '../../../hooks/useRoleGuard'
import { toUserMessage } from '../../../lib/safeError'

/** Local YYYY-MM-DD (avoids the UTC shift that toISOString() introduces). */
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function daysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days); return isoDay(d)
}

interface KPI {
  totalRecords: number
  totalCost: number
  criticalCount: number
  highCount: number
  avgCostPerTyre: number
  totalVehicles: number
  openActions: number
}

interface SiteStat { site: string; count: number; cost: number }
interface BrandStat { brand: string; count: number; cost: number }
interface RiskStat  { risk: string; count: number }

const RISK_COLOR: Record<string, string> = {
  Critical: '#dc2626', High: '#ea580c', Medium: '#f59e0b', Low: '#16a34a',
}

export default function AnalyticsScreen() {
  const { allowed, loading: guardLoading } = useElevatedGuard()

  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [kpi, setKpi]             = useState<KPI | null>(null)
  const [byRisk, setByRisk]       = useState<RiskStat[]>([])
  const [bySite, setBySite]       = useState<SiteStat[]>([])
  const [byBrand, setByBrand]     = useState<BrandStat[]>([])
  const [period, setPeriod]       = useState<'30' | '90' | '365' | 'custom'>('90')
  // Custom date-range (YYYY-MM-DD); only used when period === 'custom'.
  const [fromDate, setFromDate]   = useState('')
  const [toDate, setToDate]       = useState('')
  // Site/location filter ('' = all sites) + the distinct-site option list.
  const [site, setSite]           = useState('')
  const [siteOptions, setSiteOptions] = useState<string[]>([])

  // Distinct sites for the location dropdown, sourced from the fleet master and
  // fetched once (RLS scopes org + country). Kept independent of the site filter
  // so selecting a site never collapses the option list.
  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    supabase.from('vehicle_fleet').select('site').then(({ data }) => {
      if (cancelled) return
      const sites = [...new Set(((data ?? []) as { site: string | null }[])
        .map(r => r.site).filter(Boolean) as string[])].sort()
      setSiteOptions(sites)
    })
    return () => { cancelled = true }
  }, [allowed])

  // Resolve the active [from, to] window from the selected period / custom range.
  // Empty string = open-ended on that side.
  const resolveRange = useCallback((): { from: string; to: string } => {
    if (period === 'custom') {
      // Only feed a fully-formed YYYY-MM-DD into the query; ignore partial input
      // so the charts do not thrash / error while the user is still typing.
      const valid = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : '')
      return { from: valid(fromDate), to: valid(toDate) }
    }
    return { from: daysAgo(Number(period)), to: '' }
  }, [period, fromDate, toDate])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
    const { from, to } = resolveRange()

    let recordsQ = supabase.from('tyre_records')
      .select('id,cost_per_tyre,risk_level,brand,site')
    if (from) recordsQ = recordsQ.gte('issue_date', from)
    if (to)   recordsQ = recordsQ.lte('issue_date', to)
    if (site) recordsQ = recordsQ.eq('site', site)

    let vehiclesQ = supabase.from('vehicle_fleet').select('id', { count: 'exact', head: true })
    if (site) vehiclesQ = vehiclesQ.eq('site', site)

    let actionsQ = supabase.from('corrective_actions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['Open', 'In Progress'])
    if (site) actionsQ = actionsQ.eq('site', site)

    const [recordsRes, vehiclesRes, actionsRes] = await Promise.all([
      recordsQ, vehiclesQ, actionsQ,
    ])
    if (recordsRes.error) throw recordsRes.error

    const records = (recordsRes.data ?? []) as { cost_per_tyre: number | null; risk_level: string | null; brand: string | null; site: string | null }[]

    const totalCost = records.reduce((s, r) => s + (Number(r.cost_per_tyre) || 0), 0)
    const critical  = records.filter(r => r.risk_level === 'Critical').length
    const high      = records.filter(r => r.risk_level === 'High').length

    setKpi({
      totalRecords:  records.length,
      totalCost,
      criticalCount: critical,
      highCount:     high,
      avgCostPerTyre: records.length > 0 ? totalCost / records.length : 0,
      totalVehicles: vehiclesRes.count ?? 0,
      openActions:   actionsRes.count ?? 0,
    })

    // Risk breakdown
    const riskMap: Record<string, number> = {}
    records.forEach(r => { const k = r.risk_level ?? 'Unknown'; riskMap[k] = (riskMap[k] ?? 0) + 1 })
    setByRisk(['Critical', 'High', 'Medium', 'Low'].map(r => ({ risk: r, count: riskMap[r] ?? 0 })))

    // Top sites by cost (top 6)
    const siteMap: Record<string, SiteStat> = {}
    records.forEach(r => {
      const s = r.site ?? 'Unknown'
      if (!siteMap[s]) siteMap[s] = { site: s, count: 0, cost: 0 }
      siteMap[s].count++
      siteMap[s].cost += Number(r.cost_per_tyre) || 0
    })
    setBySite(Object.values(siteMap).sort((a, b) => b.cost - a.cost).slice(0, 6))

    // Top brands by count (top 5)
    const brandMap: Record<string, BrandStat> = {}
    records.forEach(r => {
      const b = r.brand ?? 'Unknown'
      if (!brandMap[b]) brandMap[b] = { brand: b, count: 0, cost: 0 }
      brandMap[b].count++
      brandMap[b].cost += Number(r.cost_per_tyre) || 0
    })
    setByBrand(Object.values(brandMap).sort((a, b) => b.count - a.count).slice(0, 5))
    } catch (e: any) {
      setError(toUserMessage(e, 'Could not load analytics. Please try again.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [resolveRange, site])

  useEffect(() => { if (allowed) load() }, [load, allowed])

  async function onRefresh() { setRefreshing(true); load() }

  if (guardLoading) return (
    <View style={styles.center}><ActivityIndicator size="large" color="#3b82f6" /></View>
  )

  if (!allowed) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={48} color="#94a3b8" />
        <Text style={styles.accessDenied}>Analytics available for{'\n'}Admin, Manager & Director</Text>
      </View>
    </SafeAreaView>
  )

  const maxCost = bySite.reduce((m, s) => Math.max(m, s.cost), 1)
  const maxBrand = byBrand.reduce((m, b) => Math.max(m, b.count), 1)

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Fleet Analytics</Text>
          <Text style={styles.subtitle}>{site ? `${site} · ` : 'All sites · '}{period === 'custom' ? 'Custom range' : period === '365' ? 'Last 1 year' : `Last ${period} days`}</Text>
        </View>
      </View>

      {/* Period picker */}
      <View style={styles.filterBar}>
        <View style={styles.periodRow}>
          {(['30', '90', '365', 'custom'] as const).map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {p === '30' ? '30 days' : p === '90' ? '90 days' : p === '365' ? '1 year' : 'Custom'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom date range (revealed only for the Custom preset) */}
        {period === 'custom' && (
          <View style={styles.dateRow}>
            <View style={styles.dateField}>
              <Text style={styles.dateLabel}>From</Text>
              <TextInput
                style={styles.dateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94a3b8"
                value={fromDate}
                onChangeText={setFromDate}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
            <View style={styles.dateField}>
              <Text style={styles.dateLabel}>To</Text>
              <TextInput
                style={styles.dateInput}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94a3b8"
                value={toDate}
                onChangeText={setToDate}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
          </View>
        )}

        {/* Location / site dropdown */}
        {siteOptions.length > 0 && (
          <View style={styles.siteRow}>
            <Text style={styles.dateLabel}>Location</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <SiteChip label="All sites" active={site === ''} onPress={() => setSite('')} />
              {siteOptions.map(st => (
                <SiteChip key={st} label={st} active={site === st} onPress={() => setSite(prev => prev === st ? '' : st)} />
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {loading ? (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Skeleton KPI grid */}
          <View style={styles.kpiGrid}>
            {[0,1,2,3].map(i => (
              <View key={i} style={[kpiStyles.card, { borderTopColor: '#e2e8f0' }]}>
                <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: '#e2e8f0' }} />
                <View style={{ width: 36, height: 18, borderRadius: 4, backgroundColor: '#e2e8f0', marginVertical: 4 }} />
                <View style={{ width: 54, height: 10, borderRadius: 3, backgroundColor: '#f1f5f9' }} />
              </View>
            ))}
          </View>
          <View style={styles.kpiGrid}>
            {[0,1,2,3].map(i => (
              <View key={i} style={[kpiStyles.card, { borderTopColor: '#e2e8f0' }]}>
                <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: '#e2e8f0' }} />
                <View style={{ width: 36, height: 18, borderRadius: 4, backgroundColor: '#e2e8f0', marginVertical: 4 }} />
                <View style={{ width: 54, height: 10, borderRadius: 3, backgroundColor: '#f1f5f9' }} />
              </View>
            ))}
          </View>
          {[120, 160, 140].map((h, i) => (
            <View key={i} style={[styles.card, { height: h }]} />
          ))}
        </ScrollView>
      ) : (error || !kpi) ? (
        <ScrollView
          contentContainerStyle={[styles.content, { alignItems: 'center', justifyContent: 'center', flexGrow: 1 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
        >
          <Ionicons name="cloud-offline-outline" size={40} color="#94a3b8" />
          <Text style={{ color: '#475569', fontSize: 14, textAlign: 'center', marginTop: 12, paddingHorizontal: 24 }}>
            {error || 'No analytics data yet.'}
          </Text>
          <TouchableOpacity onPress={load} style={{ marginTop: 16, backgroundColor: '#3b82f6', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
          showsVerticalScrollIndicator={false}
        >
          {/* KPI row 1 */}
          <View style={styles.kpiGrid}>
            <KpiCard icon="layers-outline"    label="Total Records"  value={kpi!.totalRecords.toLocaleString()} color="#3b82f6" />
            <KpiCard icon="car-sport-outline" label="Fleet Size"     value={kpi!.totalVehicles.toLocaleString()} color="#8b5cf6" />
            <KpiCard icon="cash-outline"      label="Total Cost"     value={`SAR ${(kpi!.totalCost / 1000).toFixed(0)}k`} color="#16a34a" />
            <KpiCard icon="warning-outline"   label="Critical"       value={kpi!.criticalCount.toString()} color="#dc2626" />
          </View>
          <View style={styles.kpiGrid}>
            <KpiCard icon="trending-up-outline" label="Avg Cost/Tyre" value={`SAR ${Math.round(kpi!.avgCostPerTyre).toLocaleString()}`} color="#f59e0b" />
            <KpiCard icon="flame-outline"       label="High Risk"     value={kpi!.highCount.toString()} color="#ea580c" />
            <KpiCard icon="construct-outline"   label="Open Actions"  value={kpi!.openActions.toString()} color="#0ea5e9" />
            <KpiCard icon="checkmark-circle-outline" label="Safe"     value={(kpi!.totalRecords - kpi!.criticalCount - kpi!.highCount).toString()} color="#16a34a" />
          </View>

          {/* Risk breakdown - with % labels inside bars */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Risk Breakdown</Text>
            <View style={{ gap: 12 }}>
              {byRisk.map(r => {
                const pct = kpi!.totalRecords > 0 ? r.count / kpi!.totalRecords : 0
                const pctLabel = `${Math.round(pct * 100)}%`
                return (
                  <View key={r.risk}>
                    <View style={styles.barMeta}>
                      <View style={[styles.riskDot, { backgroundColor: RISK_COLOR[r.risk] }]} />
                      <Text style={styles.barLabel}>{r.risk}</Text>
                      <Text style={[styles.barValue, { color: RISK_COLOR[r.risk] }]}>{r.count}</Text>
                      <Text style={styles.pctLabel}>{pctLabel}</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: RISK_COLOR[r.risk] }]} />
                    </View>
                  </View>
                )
              })}
            </View>
          </View>

          {/* Top sites by cost */}
          {bySite.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top Sites by Cost (SAR)</Text>
              <View style={{ gap: 12 }}>
                {bySite.map((s, idx) => (
                  <View key={s.site}>
                    <View style={styles.barMeta}>
                      <Text style={styles.rankNum}>#{idx + 1}</Text>
                      <Text style={styles.barLabel} numberOfLines={1}>{s.site}</Text>
                      <Text style={[styles.barValue, { color: '#3b82f6' }]}>
                        {s.cost >= 1000 ? `${(s.cost / 1000).toFixed(0)}k` : Math.round(s.cost).toString()}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.round((s.cost / maxCost) * 100)}%`, backgroundColor: '#3b82f6' }]} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Top brands */}
          {byBrand.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top Brands by Volume</Text>
              <View style={{ gap: 12 }}>
                {byBrand.map((b, idx) => (
                  <View key={b.brand}>
                    <View style={styles.barMeta}>
                      <Text style={styles.rankNum}>#{idx + 1}</Text>
                      <Text style={styles.barLabel} numberOfLines={1}>{b.brand}</Text>
                      <Text style={[styles.barValue, { color: '#8b5cf6' }]}>{b.count}</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.round((b.count / maxBrand) * 100)}%`, backgroundColor: '#8b5cf6' }]} />
                    </View>
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

function SiteChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  )
}

function KpiCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <View style={[kpiStyles.card, { borderTopColor: color }]}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={[kpiStyles.value, { color }]}>{value}</Text>
      <Text style={kpiStyles.label}>{label}</Text>
    </View>
  )
}

const kpiStyles = StyleSheet.create({
  card: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 10,
    alignItems: 'center', gap: 4, borderTopWidth: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 2,
  },
  value: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 10, color: '#94a3b8', fontWeight: '600', textAlign: 'center' },
})

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#eff6ff' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  accessDenied: { fontSize: 15, color: '#94a3b8', textAlign: 'center', marginTop: 12, lineHeight: 22 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  title:    { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },

  filterBar: { backgroundColor: '#fff', paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  periodRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  periodBtn: { flex: 1, paddingVertical: 7, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', alignItems: 'center' },
  periodBtnActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  periodText:      { fontSize: 12, fontWeight: '700', color: '#94a3b8' },
  periodTextActive:{ color: '#fff' },

  dateRow:   { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingBottom: 8 },
  dateField: { flex: 1, gap: 4 },
  dateLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8' },
  dateInput: {
    height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc', paddingHorizontal: 12, fontSize: 13, color: '#0f172a', fontWeight: '600',
  },
  siteRow:   { paddingBottom: 8, gap: 4, paddingHorizontal: 12 },
  chipRow:   { flexDirection: 'row', gap: 8, paddingVertical: 2, paddingRight: 12 },
  chip:      { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', maxWidth: 180 },
  chipActive:{ backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  chipText:  { fontSize: 12, fontWeight: '700', color: '#94a3b8' },
  chipTextActive: { color: '#fff' },

  content: { padding: 16, gap: 14, paddingBottom: Platform.OS === 'ios' ? 24 : 16 },
  kpiGrid: { flexDirection: 'row', gap: 8 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, gap: 14,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },

  barMeta:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  riskDot:  { width: 8, height: 8, borderRadius: 4 },
  barLabel: { flex: 1, fontSize: 12, color: '#374151', fontWeight: '600' },
  barTrack: { height: 10, backgroundColor: '#f1f5f9', borderRadius: 6, overflow: 'hidden' },
  barFill:  { height: 10, borderRadius: 6, minWidth: 6 },
  barValue: { fontSize: 12, fontWeight: '800', color: '#64748b', minWidth: 32, textAlign: 'right' },
  pctLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '600', minWidth: 30, textAlign: 'right' },
  rankNum:  { fontSize: 11, color: '#94a3b8', fontWeight: '700', minWidth: 20 },
})
