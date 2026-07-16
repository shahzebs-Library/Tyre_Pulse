import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl,
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

type TintKey = keyof Theme['tint']

/** Risk band -> design-system status kind (sun-legible, theme-aware). */
const RISK_KIND: Record<string, StatusKind> = {
  Critical: 'critical', High: 'danger', Medium: 'warning', Low: 'success', Unknown: 'neutral',
}
function riskKind(level: string): StatusKind {
  return RISK_KIND[level] ?? 'neutral'
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

export default function OverviewScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])
  const { allowed } = useRoleGuard(ROLES)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textAlign = isRTL ? 'right' : 'left'

  const load = useCallback(async () => {
    try {
      setError(null)
      const { data, error: rpcErr } = await supabase.rpc('report_tyre_summary', {
        p_country: profile?.country ?? 'All', p_from: null, p_to: null,
      })
      if (rpcErr) throw rpcErr
      setSummary((data ?? null) as Summary | null)
    } catch (e: any) {
      if (__DEV__) console.warn('[overview] summary load failed:', e?.message)
      setError('Could not load the summary. Pull down to retry.')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [profile?.country])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  if (!allowed) return null

  const summ = summary
  const risk = summ?.risk_breakdown ?? []
  const riskMax = Math.max(...risk.map(r => r.count), 1)
  const sites = summ?.top_sites?.slice(0, 6) ?? []
  const siteMax = Math.max(...sites.map(x => x.count), 1)
  const trend = summ?.monthly_trend ?? []
  const trendMax = Math.max(...trend.map(m => m.count), 1)

  const kpis: { key: string; label: string; value: string; icon: any; tint: TintKey }[] = [
    { key: 'tyres',      label: t('modules.overview.tyres'),      value: compact(summ?.total_records ?? 0),  icon: 'ellipse-outline',       tint: 'blue' },
    { key: 'vehicles',   label: t('modules.overview.vehicles'),   value: compact(summ?.distinct_assets ?? 0), icon: 'bus-outline',          tint: 'teal' },
    { key: 'highRisk',   label: t('modules.overview.highRisk'),   value: compact(summ?.high_risk ?? 0),      icon: 'alert-circle-outline',  tint: 'red' },
    { key: 'periodCost', label: t('modules.overview.periodCost'), value: compact(summ?.total_cost ?? 0),     icon: 'cash-outline',          tint: 'violet' },
  ]

  const header = (
    <View style={[s.header, isRTL && s.rowReverse]}>
      <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
        <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <AppText variant="h2" style={{ textAlign }}>{t('modules.overview.title')}</AppText>
        <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>
          {profile?.country ?? t('modules.overview.allCountries')}
        </AppText>
      </View>
    </View>
  )

  return (
    <Screen edges={['top']}>
      {header}

      {loading ? (
        <Loading label="Loading fleet summary" />
      ) : error ? (
        <ScrollView
          contentContainerStyle={s.stateWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
        >
          <ErrorState message={error} onRetry={onRefresh} />
        </ScrollView>
      ) : !summ || (summ.total_records ?? 0) === 0 ? (
        <ScrollView
          contentContainerStyle={s.stateWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
        >
          <EmptyState
            icon="bar-chart-outline"
            title="No data yet"
            message="No tyre records for this country. Pull down to refresh."
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
        >
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
                    <View style={[s.barTrack, { backgroundColor: theme.color.surfaceSunken }]}>
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
                      <View style={[s.barTrack, { backgroundColor: theme.color.surfaceSunken }]}>
                        <View style={[s.barFill, { width: `${(x.count / siteMax) * 100}%`, backgroundColor: theme.color.info.base }]} />
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
                        <View style={[s.trendBar, { height: `${Math.max(4, (m.count / trendMax) * 100)}%`, backgroundColor: theme.color.primary }]} />
                      </View>
                      <AppText variant="micro" color="secondary">{compact(m.count)}</AppText>
                      <AppText variant="micro" color="muted">{m.month.split(' ')[0]}</AppText>
                    </View>
                  ))}
                </View>
              </Card>
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
    stateWrap: { flexGrow: 1, justifyContent: 'center' },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.sm },

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
