import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { UserRole } from '../../lib/types'
import {
  Theme, StatusKind, spacing, radius, typography, statusColor, elevation,
} from '../../lib/theme'
import {
  Screen, Card, AppText, StatTile, SectionHeader, Loading, ErrorState, EmptyState,
} from '../../components/ui'

const ROLES: UserRole[] = ['admin', 'manager', 'director']
const FETCH_PAGE = 1000

type TintKey = keyof Theme['tint']

/** Risk band -> design-system status kind (sun-legible, theme-aware). */
const RISK_KIND: Record<string, StatusKind> = {
  Critical: 'critical', High: 'danger', Medium: 'warning', Low: 'success', Unknown: 'neutral',
}
function riskKind(level: string): StatusKind {
  return RISK_KIND[level] ?? 'neutral'
}
const RISK_ORDER = ['Critical', 'High', 'Medium', 'Low']

/** Raw tyre row loaded once; KPIs + charts are computed in-memory so filters are live. */
interface TyreRow {
  asset_no: string | null
  site: string | null
  issue_date: string | null
  risk_level: string | null
  cost_per_tyre: number | null
  country: string | null
}

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

/** Local YYYY-MM-DD (avoids UTC shift from toISOString). */
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Short month label for a 'YYYY-MM' bucket key. */
function shortMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  if (isNaN(d.getTime())) return monthKey
  return d.toLocaleDateString('en', { month: 'short' })
}

export default function OverviewScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])
  const { allowed } = useRoleGuard(ROLES)

  const [rows, setRows] = useState<TyreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters (applied to the in-memory rows).
  const [showFilters, setShowFilters] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [site, setSite] = useState('')
  const [country, setCountry] = useState('')

  const textAlign = isRTL ? 'right' : 'left'
  const c = theme.color

  const load = useCallback(async () => {
    try {
      setError(null)
      // Load raw rows (RLS scopes org + country); paginate to fetch everything.
      const all: TyreRow[] = []
      for (let p = 0; ; p++) {
        const { data, error: qErr } = await supabase
          .from('tyre_records')
          .select('asset_no,site,issue_date,risk_level,cost_per_tyre,country')
          .order('issue_date', { ascending: false })
          .range(p * FETCH_PAGE, (p + 1) * FETCH_PAGE - 1)
        if (qErr) throw qErr
        const batch = (data ?? []) as TyreRow[]
        all.push(...batch)
        if (batch.length < FETCH_PAGE) break
      }
      setRows(all)
    } catch (e: any) {
      if (__DEV__) console.warn('[overview] load failed:', e?.message)
      setError(t('modules.overview.loadError'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  // Filter option lists derived from the loaded data (distinct values, not hardcoded).
  const siteOptions = useMemo(
    () => [...new Set(rows.map(r => r.site).filter(Boolean) as string[])].sort(),
    [rows],
  )
  const countryOptions = useMemo(
    () => [...new Set(rows.map(r => r.country).filter(Boolean) as string[])].sort(),
    [rows],
  )

  // Apply date-range + site + country filters to the in-memory rows.
  const filtered = useMemo(() => rows.filter(r => {
    const day = (r.issue_date ?? '').slice(0, 10)
    if (fromDate) { if (!day || day < fromDate) return false }
    if (toDate) { if (!day || day > toDate) return false }
    if (site && r.site !== site) return false
    if (country && r.country !== country) return false
    return true
  }), [rows, fromDate, toDate, site, country])

  // Recompute the KPIs + charts the screen renders, from the filtered rows.
  const summ: Summary = useMemo(() => {
    const assets = new Set<string>()
    let totalCost = 0, highRisk = 0, critical = 0
    const riskMap = new Map<string, number>()
    const siteMap = new Map<string, { count: number; cost: number }>()
    const monthMap = new Map<string, { count: number; cost: number }>()

    for (const r of filtered) {
      if (r.asset_no) assets.add(r.asset_no)
      const cost = Number(r.cost_per_tyre) || 0
      totalCost += cost

      const level = r.risk_level || 'Unknown'
      if (level === 'Critical') { critical++; highRisk++ }
      else if (level === 'High') highRisk++
      riskMap.set(level, (riskMap.get(level) ?? 0) + 1)

      const st = r.site || 'Unknown'
      const se = siteMap.get(st) ?? { count: 0, cost: 0 }
      se.count++; se.cost += cost; siteMap.set(st, se)

      const day = (r.issue_date ?? '').slice(0, 10)
      if (day.length >= 7) {
        const mk = day.slice(0, 7)
        const me = monthMap.get(mk) ?? { count: 0, cost: 0 }
        me.count++; me.cost += cost; monthMap.set(mk, me)
      }
    }

    const known = RISK_ORDER.filter(l => riskMap.has(l)).map(l => ({ level: l, count: riskMap.get(l)! }))
    const extra = [...riskMap.keys()].filter(k => !RISK_ORDER.includes(k)).map(k => ({ level: k, count: riskMap.get(k)! }))
    const risk_breakdown = [...known, ...extra]

    const top_sites = [...siteMap.entries()]
      .map(([st, v]) => ({ site: st, count: v.count, cost: v.cost }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)

    const monthly_trend = [...monthMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-6)
      .map(([mk, v]) => ({ month: mk, count: v.count, cost: v.cost }))

    return {
      total_records: filtered.length,
      distinct_assets: assets.size,
      total_cost: totalCost,
      high_risk: highRisk,
      critical,
      risk_breakdown,
      top_sites,
      monthly_trend,
    }
  }, [filtered])

  if (!allowed) return null

  const activeCount = [fromDate, toDate, site, country].filter(Boolean).length

  function presetFrom(days: number): string {
    const start = new Date()
    start.setDate(start.getDate() - days)
    return isoDay(start)
  }

  function setRange(days: number | null) {
    if (days == null) { setFromDate(''); setToDate(''); return }
    setFromDate(presetFrom(days)); setToDate(isoDay(new Date()))
  }

  function clearFilters() {
    setFromDate(''); setToDate(''); setSite(''); setCountry('')
  }

  const risk = summ.risk_breakdown
  const riskMax = Math.max(...risk.map(r => r.count), 1)
  const sites = summ.top_sites
  const siteMax = Math.max(...sites.map(x => x.count), 1)
  const trend = summ.monthly_trend
  const trendMax = Math.max(...trend.map(m => m.count), 1)

  const kpis: { key: string; label: string; value: string; icon: any; tint: TintKey }[] = [
    { key: 'tyres',      label: t('modules.overview.tyres'),      value: compact(summ.total_records),   icon: 'ellipse-outline',       tint: 'blue' },
    { key: 'vehicles',   label: t('modules.overview.vehicles'),   value: compact(summ.distinct_assets), icon: 'bus-outline',           tint: 'teal' },
    { key: 'highRisk',   label: t('modules.overview.highRisk'),   value: compact(summ.high_risk),       icon: 'alert-circle-outline',  tint: 'red' },
    { key: 'periodCost', label: t('modules.overview.periodCost'), value: compact(summ.total_cost),      icon: 'cash-outline',          tint: 'violet' },
  ]

  const rangePresets: { key: string; label: string; days: number | null }[] = [
    { key: 'all', label: t('modules.overview.rangeAll'), days: null },
    { key: 'd30', label: t('modules.overview.range30'), days: 30 },
    { key: 'd90', label: t('modules.overview.range90'), days: 90 },
    { key: 'm6',  label: t('modules.overview.range6m'), days: 182 },
    { key: 'm12', label: t('modules.overview.range12m'), days: 365 },
  ]

  const header = (
    <View style={[s.header, isRTL && s.rowReverse]}>
      <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={c.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <AppText variant="h2" style={{ textAlign }}>{t('modules.overview.title')}</AppText>
        <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>
          {profile?.country ?? t('modules.overview.allCountries')}
        </AppText>
      </View>
      {!loading && !error && rows.length > 0 && (
        <TouchableOpacity
          style={[s.filterBtn, { backgroundColor: activeCount > 0 ? c.primary : c.surfaceAlt }]}
          onPress={() => setShowFilters(v => !v)}
          activeOpacity={0.8}
        >
          <Ionicons name="options-outline" size={18} color={activeCount > 0 ? c.onPrimary : c.textSecondary} />
          {activeCount > 0 && (
            <View style={[s.filterBadge, { backgroundColor: c.danger.base }]}>
              <AppText style={[typography.micro, { color: c.textInverse, fontSize: 9 }]}>{activeCount}</AppText>
            </View>
          )}
        </TouchableOpacity>
      )}
    </View>
  )

  const chip = (label: string, active: boolean, onPress: () => void, key: string) => (
    <TouchableOpacity
      key={key}
      style={[s.chip, { backgroundColor: active ? c.primary : c.surfaceAlt, borderColor: active ? c.primary : c.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <AppText style={[typography.label, { color: active ? c.onPrimary : c.textSecondary }]}>{label}</AppText>
    </TouchableOpacity>
  )

  const filterBar = (
    <Card style={s.filterCard}>
      {/* Date range */}
      <View style={[s.filterRow, isRTL && s.rowReverse]}>
        <AppText variant="label" color="muted" style={{ textAlign }}>{t('modules.overview.dateRange')}</AppText>
        {activeCount > 0 && (
          <TouchableOpacity onPress={clearFilters}>
            <AppText style={[typography.label, { color: c.danger.base }]}>{t('modules.overview.clearFilters')}</AppText>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
        {rangePresets.map(p => {
          const active = p.days == null
            ? !fromDate && !toDate
            : fromDate === presetFrom(p.days) && toDate === isoDay(new Date())
          return chip(p.label, active, () => setRange(p.days), p.key)
        })}
      </ScrollView>
      <View style={[s.dateRow, isRTL && s.rowReverse]}>
        <View style={s.dateField}>
          <AppText variant="micro" color="muted" style={{ textAlign }}>{t('modules.overview.from')}</AppText>
          <TextInput
            style={[s.dateInput, { color: c.text, backgroundColor: c.surfaceAlt, borderColor: c.border, textAlign }]}
            placeholder={t('modules.overview.datePlaceholder')}
            placeholderTextColor={c.textMuted}
            value={fromDate}
            onChangeText={setFromDate}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
          />
        </View>
        <View style={s.dateField}>
          <AppText variant="micro" color="muted" style={{ textAlign }}>{t('modules.overview.to')}</AppText>
          <TextInput
            style={[s.dateInput, { color: c.text, backgroundColor: c.surfaceAlt, borderColor: c.border, textAlign }]}
            placeholder={t('modules.overview.datePlaceholder')}
            placeholderTextColor={c.textMuted}
            value={toDate}
            onChangeText={setToDate}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
          />
        </View>
      </View>

      {/* Location / Site */}
      {siteOptions.length > 0 && (
        <>
          <AppText variant="label" color="muted" style={[s.filterGroupLabel, { textAlign }]}>{t('modules.overview.location')}</AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {chip(t('modules.overview.all'), site === '', () => setSite(''), '__allSites')}
            {siteOptions.map(st => chip(st, site === st, () => setSite(prev => prev === st ? '' : st), st))}
          </ScrollView>
        </>
      )}

      {/* Country */}
      {countryOptions.length > 0 && (
        <>
          <AppText variant="label" color="muted" style={[s.filterGroupLabel, { textAlign }]}>{t('modules.overview.country')}</AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {chip(t('modules.overview.all'), country === '', () => setCountry(''), '__allCountries')}
            {countryOptions.map(cn => chip(cn, country === cn, () => setCountry(prev => prev === cn ? '' : cn), cn))}
          </ScrollView>
        </>
      )}

      <AppText variant="micro" color="muted" style={[s.resultLine, { textAlign }]}>
        {`${summ.total_records.toLocaleString()} ${t('modules.overview.results')}`}
      </AppText>
    </Card>
  )

  return (
    <Screen edges={['top']}>
      {header}

      {loading ? (
        <Loading label={t('modules.overview.loadingLabel')} />
      ) : error ? (
        <ScrollView
          contentContainerStyle={s.stateWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
        >
          <ErrorState message={error} onRetry={onRefresh} />
        </ScrollView>
      ) : rows.length === 0 ? (
        <ScrollView
          contentContainerStyle={s.stateWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
        >
          <EmptyState
            icon="bar-chart-outline"
            title={t('modules.overview.noData')}
            message={t('modules.overview.noDataHint')}
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
        >
          {showFilters && filterBar}

          {summ.total_records === 0 ? (
            <EmptyState
              icon="filter-outline"
              title={t('modules.overview.noMatch')}
              message={t('modules.overview.noMatchHint')}
              actionLabel={t('modules.overview.clearFilters')}
              onAction={clearFilters}
            />
          ) : (
            <>
              {/* KPI grid */}
              <View style={s.kpiGrid}>
                {kpis.map(k => (
                  <View key={k.key} style={s.kpiCell}>
                    <StatTile icon={k.icon} value={k.value} label={k.label} tint={k.tint} />
                  </View>
                ))}
              </View>

              {/* Risk distribution */}
              <SectionHeader title={t('modules.overview.riskDist')} />
              <Card>
                <View style={{ gap: spacing.md }}>
                  {risk.map(r => {
                    const sc = statusColor(theme, riskKind(r.level))
                    return (
                      <View key={r.level} style={s.barRow}>
                        <AppText variant="caption" color="secondary" style={s.barLabel} numberOfLines={1}>{r.level}</AppText>
                        <View style={[s.barTrack, { backgroundColor: c.surfaceSunken }]}>
                          <View style={[s.barFill, { width: `${(r.count / riskMax) * 100}%`, backgroundColor: sc.base }]} />
                        </View>
                        <AppText variant="bodyStrong" style={s.barValue}>{compact(r.count)}</AppText>
                      </View>
                    )
                  })}
                </View>
              </Card>

              {/* Top sites */}
              {sites.length > 0 && (
                <>
                  <SectionHeader title={t('modules.overview.topSites')} />
                  <Card>
                    <View style={{ gap: spacing.md }}>
                      {sites.map(x => (
                        <View key={x.site} style={s.barRow}>
                          <AppText variant="caption" color="secondary" style={s.barLabel} numberOfLines={1}>{x.site}</AppText>
                          <View style={[s.barTrack, { backgroundColor: c.surfaceSunken }]}>
                            <View style={[s.barFill, { width: `${(x.count / siteMax) * 100}%`, backgroundColor: c.info.base }]} />
                          </View>
                          <AppText variant="bodyStrong" style={s.barValue}>{compact(x.count)}</AppText>
                        </View>
                      ))}
                    </View>
                  </Card>
                </>
              )}

              {/* Monthly trend */}
              {trend.length > 0 && (
                <>
                  <SectionHeader title={t('modules.overview.trend')} />
                  <Card>
                    <View style={s.trendRow}>
                      {trend.map(m => (
                        <View key={m.month} style={s.trendCol}>
                          <View style={s.trendBarTrack}>
                            <View style={[s.trendBar, { height: `${Math.max(4, (m.count / trendMax) * 100)}%`, backgroundColor: c.primary }]} />
                          </View>
                          <AppText variant="micro" color="secondary">{compact(m.count)}</AppText>
                          <AppText variant="micro" color="muted">{shortMonth(m.month)}</AppText>
                        </View>
                      ))}
                    </View>
                  </Card>
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowReverse: { flexDirection: 'row-reverse' },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    },
    backBtn: {
      width: 40, height: 40, borderRadius: radius.md,
      backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border, ...elevation(theme, 1),
    },
    filterBtn: {
      width: 40, height: 40, borderRadius: radius.md,
      alignItems: 'center', justifyContent: 'center',
    },
    filterBadge: {
      position: 'absolute', top: -4, right: -4,
      minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
      alignItems: 'center', justifyContent: 'center',
    },
    stateWrap: { flexGrow: 1, justifyContent: 'center' },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.sm },

    filterCard: { gap: spacing.sm, marginTop: spacing.xs },
    filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    filterGroupLabel: { marginTop: spacing.xs },
    chipRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
    chip: {
      paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1.5,
    },
    dateRow: { flexDirection: 'row', gap: spacing.md },
    dateField: { flex: 1, gap: 4 },
    dateInput: {
      borderWidth: 1, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 14,
    },
    resultLine: { marginTop: spacing.xs },

    kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
    kpiCell: { flexBasis: '47%', flexGrow: 1, minWidth: 150 },

    barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    barLabel: { width: 76 },
    barTrack: { flex: 1, height: 12, borderRadius: radius.pill, overflow: 'hidden' },
    barFill: { height: 12, borderRadius: radius.pill },
    barValue: { width: 48, textAlign: 'right' },

    trendRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 140, gap: 6 },
    trendCol: { flex: 1, alignItems: 'center', gap: 4 },
    trendBarTrack: { width: '68%', height: 96, justifyContent: 'flex-end' },
    trendBar: { width: '100%', borderRadius: radius.sm, minHeight: 4 },
  })
}
