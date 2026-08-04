/**
 * Fleet Analytics - mobile KPI dashboard
 *
 * Available to: admin / super-admin only (the `analytics` module carries
 * roles: [] in the mobile MODULES registry; a per-user or per-role grant can
 * still extend it). Gated by withModuleGuard(..., 'analytics') so the screen
 * guard agrees with the registry and a manager cannot reach it directly.
 * Shows: fleet cost KPIs, risk breakdown, top sites by cost, recent critical alerts
 */

import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  RefreshControl, StatusBar, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { toUserMessage } from '../../../lib/safeError'
import { useAuth } from '../../../contexts/AuthContext'
import {
  getMobileAnalytics, safeCount, avgCostPerTyre,
  compactNumber, currencyFor, formatSpend,
  type MobileAnalytics,
} from '../../../lib/mobileAnalytics'

/** Local YYYY-MM-DD (avoids the UTC shift that toISOString() introduces). */
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
function daysAgo(days: number): string {
  const d = new Date(); d.setDate(d.getDate() - days); return isoDay(d)
}

/** Risk bands shown in a fixed order so the list does not reshuffle on refresh. */
const RISK_BANDS = ['Critical', 'High', 'Medium', 'Low'] as const

const RISK_COLOR: Record<string, string> = {
  Critical: '#dc2626', High: '#ea580c', Medium: '#f59e0b', Low: '#16a34a',
}

import { withModuleGuard } from '../../../components/ModuleGuard'

export default withModuleGuard(AnalyticsScreen, 'analytics')

function AnalyticsScreen() {
  // Access is enforced by the registry via withModuleGuard(..., 'analytics')
  // above; the `analytics` module is admin/super only. By the time this body
  // renders, access is already confirmed, so no second in-screen role guard.
  const { profile } = useAuth()
  // The user's own country decides the currency. There is no all-countries
  // total: SAR, AED and EGP are not addable, so spend simply reads N/A there.
  const country  = profile?.country ?? null
  const currency = currencyFor(country)

  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData]           = useState<MobileAnalytics | null>(null)
  const [period, setPeriod]       = useState<'30' | '90' | '365' | 'custom'>('90')
  // Custom date-range (YYYY-MM-DD); only used when period === 'custom'.
  const [fromDate, setFromDate]   = useState('')
  const [toDate, setToDate]       = useState('')
  // Site/location filter ('' = all sites). The option list rides along with the
  // aggregate, so no separate read of the fleet register is needed.
  const [site, setSite]           = useState('')

  // Keep the last known site list so the chips do not vanish while a filtered
  // refresh is in flight.
  const [siteOptions, setSiteOptions] = useState<string[]>([])

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
      // ONE row from the server. This screen used to page the whole
      // tyre_records table into memory and count it here, which made it the
      // slowest screen in the app and a genuine out-of-memory risk on the
      // low-end handsets the fleet runs on. The database counts; the phone
      // renders. Every figure below is exact - there is no row cap to hit.
      const res = await getMobileAnalytics({ country, from, to, site })
      setData(res)
      // Only replace the chips when the server actually returned a list, so a
      // momentary empty result cannot strand the user with no way to clear
      // their own filter.
      if (res?.sites?.length) setSiteOptions(res.sites)
    } catch (e: any) {
      setError(toUserMessage(e, 'Could not load analytics. Please try again.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [resolveRange, site, country])

  useEffect(() => { load() }, [load])

  async function onRefresh() { setRefreshing(true); load() }

  // Money is only shown when a single country is in scope AND the server sent a
  // figure; otherwise the bars rank by volume, which is always comparable.
  const showMoney = !!currency && data?.tyre_spend != null

  // The server returns whatever bands exist in the data; render the four known
  // bands in a fixed order (zero-filled) so the list does not reshuffle.
  const riskRows = RISK_BANDS.map(band => ({
    risk: band,
    count: data?.by_risk.find(r => r.risk.toLowerCase() === band.toLowerCase())?.count ?? 0,
  }))
  // Anything the fleet has not rated yet. Stated plainly rather than folded into
  // Low, which would read as "these tyres were checked and are fine".
  const unratedTyres = Math.max(0, (data?.tyres_total ?? 0) - riskRows.reduce((s, r) => s + r.count, 0))

  const maxSite = (data?.by_site ?? []).reduce(
    (m, s) => Math.max(m, showMoney ? (s.cost ?? 0) : s.count), 1)
  const maxBrand = (data?.by_brand ?? []).reduce((m, b) => Math.max(m, b.count), 1)

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Fleet Analytics</Text>
          <Text style={styles.subtitle}>
            {country ? `${country} · ` : ''}{site ? `${site} · ` : 'All sites · '}
            {period === 'custom' ? 'Custom range' : period === '365' ? 'Last 1 year' : `Last ${period} days`}
          </Text>
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
      ) : (error || !data) ? (
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
            <KpiCard icon="layers-outline"    label="Total Records"  value={compactNumber(data.tyres_total)} color="#3b82f6" />
            <KpiCard icon="car-sport-outline" label="Fleet Size"     value={compactNumber(data.vehicles_total)} color="#8b5cf6" />
            {/* Reads N/A rather than a blended figure when no single country applies. */}
            <KpiCard icon="cash-outline"      label="Tyre Spend"     value={formatSpend(data.tyre_spend, country)} color="#16a34a" />
            <KpiCard icon="warning-outline"   label="Critical"       value={compactNumber(data.tyres_critical)} color="#dc2626" />
          </View>
          <View style={styles.kpiGrid}>
            <KpiCard icon="trending-up-outline" label="Avg Cost/Tyre" value={formatSpend(avgCostPerTyre(data), country)} color="#f59e0b" />
            <KpiCard icon="flame-outline"       label="High Risk"     value={compactNumber(data.tyres_high)} color="#ea580c" />
            <KpiCard icon="construct-outline"   label="Open Actions"  value={compactNumber(data.open_actions)} color="#0ea5e9" />
            <KpiCard icon="clipboard-outline"   label="Inspections 30d" value={compactNumber(data.inspections_30d)} color="#0891b2" />
          </View>

          {/* Risk breakdown - with % labels inside bars */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Risk Breakdown</Text>
            <View style={{ gap: 12 }}>
              {riskRows.map(r => {
                const pct = data.tyres_total > 0 ? r.count / data.tyres_total : 0
                const pctLabel = `${Math.round(pct * 100)}%`
                return (
                  <View key={r.risk}>
                    <View style={styles.barMeta}>
                      <View style={[styles.riskDot, { backgroundColor: RISK_COLOR[r.risk] || '#94a3b8' }]} />
                      <Text style={styles.barLabel}>{r.risk}</Text>
                      <Text style={[styles.barValue, { color: RISK_COLOR[r.risk] || '#64748b' }]}>{r.count}</Text>
                      <Text style={styles.pctLabel}>{pctLabel}</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: RISK_COLOR[r.risk] || '#cbd5e1' }]} />
                    </View>
                  </View>
                )
              })}
              {unratedTyres > 0 && (
                <Text style={styles.note}>
                  {compactNumber(unratedTyres)} of these tyres carry no risk rating yet, so they sit outside the bands above.
                </Text>
              )}
            </View>
          </View>

          {/* Top sites. Ranked by cost inside one country, by volume otherwise -
              the ranking always matches the number we are able to show. */}
          {data.by_site.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {showMoney ? `Top Sites by Cost (${currency})` : 'Top Sites by Volume'}
              </Text>
              <View style={{ gap: 12 }}>
                {data.by_site.map((s, idx) => {
                  const v = showMoney ? (s.cost ?? 0) : s.count
                  return (
                    <View key={s.site}>
                      <View style={styles.barMeta}>
                        <Text style={styles.rankNum}>#{idx + 1}</Text>
                        <Text style={styles.barLabel} numberOfLines={1}>{s.site}</Text>
                        <Text style={[styles.barValue, { color: '#3b82f6' }]}>{compactNumber(v)}</Text>
                      </View>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { width: `${Math.round((v / maxSite) * 100)}%`, backgroundColor: '#3b82f6' }]} />
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>
          )}

          {/* Top brands */}
          {data.by_brand.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Top Brands by Volume</Text>
              <View style={{ gap: 12 }}>
                {data.by_brand.map((b, idx) => (
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

          {!showMoney && (
            <Text style={styles.note}>
              Costs are hidden because more than one currency is in scope. Pick a single country to see spend.
            </Text>
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
  note: { fontSize: 11, color: '#64748b', lineHeight: 16 },

  barMeta:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  riskDot:  { width: 8, height: 8, borderRadius: 4 },
  barLabel: { flex: 1, fontSize: 12, color: '#374151', fontWeight: '600' },
  barTrack: { height: 10, backgroundColor: '#f1f5f9', borderRadius: 6, overflow: 'hidden' },
  barFill:  { height: 10, borderRadius: 6, minWidth: 6 },
  barValue: { fontSize: 12, fontWeight: '800', color: '#64748b', minWidth: 32, textAlign: 'right' },
  pctLabel: { fontSize: 11, color: '#94a3b8', fontWeight: '600', minWidth: 30, textAlign: 'right' },
  rankNum:  { fontSize: 11, color: '#94a3b8', fontWeight: '700', minWidth: 20 },
})
