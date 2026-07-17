/**
 * Accident Dashboard
 *
 * KPI summary cards, severity breakdown, site filter (admin/manager/director),
 * search, filterable accident list. Tap any report to open the detail view.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  View, ScrollView, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { supabase } from '../../../lib/supabase'
import { useRoleGuard } from '../../../hooks/useRoleGuard'
import { spacing, radius, statusColor, StatusKind } from '../../../lib/theme'
import {
  Screen, Card, AppText, Button, Badge, StatTile, EmptyState, ErrorState, Loading,
} from '../../../components/ui'
import {
  AccidentRecord, AccidentSeverity, AccidentStatus,
  SEVERITY_ICONS, STATUS_ICONS,
  isAdminOrAbove,
} from '../../../lib/types'

type FilterTab = 'all' | 'mine'
type IconName = React.ComponentProps<typeof Ionicons>['name']

const SEVERITY_ORDER: AccidentSeverity[] = ['minor', 'moderate', 'severe', 'fatal']

// Semantic mapping: preserve the MEANING of severity/status while sourcing the
// actual colours from the theme status kinds (sunlight-tuned).
const SEVERITY_KIND: Record<AccidentSeverity, StatusKind> = {
  minor:    'success',
  moderate: 'warning',
  severe:   'critical',
  fatal:    'danger',
}
const STATUS_KIND: Record<AccidentStatus, StatusKind> = {
  reported:     'info',
  under_review: 'warning',
  closed:       'neutral',
}

export default function AccidentDashboardScreen() {
  const { allowed, loading: guardLoading } = useRoleGuard(['admin', 'manager', 'director', 'inspector'])
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const c = theme.color

  const [accidents, setAccidents]   = useState<AccidentRecord[]>([])
  const [sites, setSites]           = useState<string[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filterTab, setFilterTab]   = useState<FilterTab>('all')
  const [siteFilter, setSiteFilter] = useState<string>('all')
  const [search, setSearch]         = useState('')

  const textAlign = isRTL ? 'right' : 'left'
  const elevated  = isAdminOrAbove(profile?.role ?? null)

  const load = useCallback(async () => {
    if (!allowed) return

    try {
      setError(null)
      let query = supabase
        .from('accidents')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)

      if (filterTab === 'mine' && profile?.id) {
        query = query.eq('reported_by', profile.id)
      }
      if (elevated && siteFilter !== 'all') {
        query = query.eq('site', siteFilter)
      }

      const { data, error: qErr } = await query
      if (qErr) throw qErr
      const rows = (data ?? []) as AccidentRecord[]
      setAccidents(rows)
      if (elevated) {
        const unique = Array.from(new Set(rows.map(a => a.site).filter(Boolean))).sort()
        setSites(unique)
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[accident/dashboard] load failed:', e?.message)
      setError('Could not load accident reports. Pull down to retry.')
    } finally {
      setLoading(false)
    }
  }, [allowed, filterTab, siteFilter, profile?.id, elevated])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  // ── Derived stats ──────────────────────────────────────────────────────────
  const thisMonthStr = new Date().toISOString().slice(0, 7)
  const total        = accidents.length
  const open         = accidents.filter(a => a.status !== 'closed').length
  const thisMonth    = accidents.filter(a => a.incident_date?.startsWith(thisMonthStr)).length
  const critical     = accidents.filter(a => a.severity === 'fatal' || a.severity === 'severe').length

  const bySeverity: Record<AccidentSeverity, number> = { minor: 0, moderate: 0, severe: 0, fatal: 0 }
  accidents.forEach(a => { bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1 })

  // ── Client-side search ─────────────────────────────────────────────────────
  const q = search.trim().toLowerCase()
  const filtered = q
    ? accidents.filter(a =>
        a.asset_no.toLowerCase().includes(q) ||
        a.site.toLowerCase().includes(q) ||
        (a.location ?? '').toLowerCase().includes(q) ||
        (a.reporter_name ?? '').toLowerCase().includes(q) ||
        a.accident_type.toLowerCase().includes(q)
      )
    : accidents

  if (guardLoading || !allowed || loading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    )
  }

  return (
    <Screen>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.header,
          { backgroundColor: c.surface, borderBottomColor: c.border },
          isRTL && { flexDirection: 'row-reverse' },
        ]}
      >
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('accident.dashboardTitle')}</AppText>
          <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>
            {elevated
              ? siteFilter === 'all' ? 'All Sites' : siteFilter
              : profile?.site ?? 'My Site'
            }
            {elevated ? <AppText variant="caption" color="danger">  :  Admin View</AppText> : null}
          </AppText>
        </View>
        <Button
          label={t('accident.reportNew')}
          icon="add-circle"
          size="sm"
          variant="danger"
          onPress={() => router.push('/(app)/accident/report')}
        />
      </View>

      <FlatList
        style={styles.scroll}
        contentContainerStyle={styles.content}
        data={filtered}
        keyExtractor={acc => acc.id}
        initialNumToRender={8}
        maxToRenderPerBatch={10}
        windowSize={11}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <AccidentCard
            accident={item}
            showReporter={elevated}
            onPress={() => router.push(`/(app)/accident/${item.id}`)}
            t={t}
          />
        )}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {/* ── KPI tiles ─────────────────────────────────────────────── */}
            <View style={styles.kpiRow}>
              <StatTile label={t('accident.stats.total')}     value={total}     icon="documents-outline" tint="slate" />
              <StatTile label={t('accident.stats.open')}      value={open}      icon="time-outline"      tint="amber" />
              <StatTile label={t('accident.stats.thisMonth')} value={thisMonth} icon="calendar-outline"  tint="blue" />
              <StatTile label={t('accident.stats.critical')}  value={critical}  icon="warning-outline"   tint="red" />
            </View>

            {/* ── Severity breakdown ────────────────────────────────────── */}
            <Card padded>
              <AppText variant="title">Severity Breakdown</AppText>
              <View style={styles.severityBreakdown}>
                {SEVERITY_ORDER.map(sev => {
                  const count   = bySeverity[sev]
                  const pct     = total > 0 ? count / total : 0
                  const sevBase = statusColor(theme, SEVERITY_KIND[sev]).base
                  return (
                    <View key={sev} style={styles.sevRow}>
                      <AppText variant="caption" color="secondary" style={styles.sevLabel}>
                        {t(`accident.severities.${sev}`)}
                      </AppText>
                      <View style={[styles.sevBarTrack, { backgroundColor: c.surfaceSunken }]}>
                        <View
                          style={[
                            styles.sevBarFill,
                            { width: `${Math.round(pct * 100)}%`, backgroundColor: sevBase },
                          ]}
                        />
                      </View>
                      <AppText variant="bodyStrong" style={[styles.sevCount, { color: sevBase }]}>{count}</AppText>
                    </View>
                  )
                })}
              </View>
            </Card>

            {/* ── Admin: site filter chips ──────────────────────────────── */}
            {elevated && sites.length > 1 && (
              <View>
                <AppText variant="label" color="muted" style={styles.sectionLabel}>Filter by Site</AppText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.siteScroll}>
                  {['all', ...sites].map(sv => {
                    const active = siteFilter === sv
                    return (
                      <TouchableOpacity
                        key={sv}
                        style={[
                          styles.siteChip,
                          { backgroundColor: active ? c.primary : c.surface, borderColor: active ? c.primary : c.border },
                        ]}
                        onPress={() => setSiteFilter(sv)}
                      >
                        <AppText variant="caption" style={{ color: active ? c.onPrimary : c.textMuted }}>
                          {sv === 'all' ? 'All Sites' : sv}
                        </AppText>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>
              </View>
            )}

            {/* ── Search bar ────────────────────────────────────────────── */}
            <View style={[styles.searchRow, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Ionicons name="search-outline" size={16} color={c.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: c.text }]}
                placeholder="Search asset, site, type, reporter..."
                placeholderTextColor={c.textMuted}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={16} color={c.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* ── Filter tabs ───────────────────────────────────────────── */}
            <View style={styles.filterRow}>
              {(['all', 'mine'] as FilterTab[]).map(tab => {
                const active = filterTab === tab
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[
                      styles.filterTab,
                      { backgroundColor: active ? c.primary : c.surface, borderColor: active ? c.primary : c.border },
                    ]}
                    onPress={() => setFilterTab(tab)}
                  >
                    <AppText variant="bodyStrong" style={{ color: active ? c.onPrimary : c.textMuted }}>
                      {tab === 'all' ? t('accident.filterAll') : t('accident.filterMine')}
                    </AppText>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* ── Result count ──────────────────────────────────────────── */}
            {q.length > 0 && (
              <AppText variant="caption" color="muted">
                {filtered.length} result{filtered.length !== 1 ? 's' : ''} for "{search}"
              </AppText>
            )}
          </View>
        }
        ListEmptyComponent={
          error ? (
            <ErrorState message={error} onRetry={onRefresh} />
          ) : (
            <EmptyState
              icon="shield-outline"
              title={q ? 'No matching reports' : t('accident.noAccidents')}
              message={q ? 'Try a different search term' : t('accident.noAccidentsHint')}
            />
          )
        }
      />
    </Screen>
  )
}

// ── Accident list card ─────────────────────────────────────────────────────────
function AccidentCard({
  accident, onPress, t, showReporter,
}: {
  accident: AccidentRecord
  onPress: () => void
  t: (k: string) => string
  showReporter: boolean
}) {
  const { theme } = useTheme()
  const c = theme.color
  const sevBase = statusColor(theme, SEVERITY_KIND[accident.severity]).base

  return (
    <Card onPress={onPress} padded={false} accent={sevBase} style={styles.accCard}>
      <View style={styles.accContent}>
        <View style={styles.accTopRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {accident.asset_no}
              <AppText variant="caption" color="secondary">  :  {accident.site}</AppText>
            </AppText>
            <AppText variant="caption" color="secondary" style={{ marginTop: 2 }}>
              {t(`accident.types.${accident.accident_type}`)}
            </AppText>
          </View>
          <Badge
            kind={SEVERITY_KIND[accident.severity]}
            icon={SEVERITY_ICONS[accident.severity] as IconName}
          >
            {t(`accident.severities.${accident.severity}`)}
          </Badge>
        </View>

        <View style={styles.accBottomRow}>
          <View style={styles.accMeta}>
            <Ionicons name="calendar-outline" size={12} color={c.textMuted} />
            <AppText variant="micro" color="muted">{accident.incident_date}</AppText>
          </View>
          {accident.location ? (
            <View style={styles.accMeta}>
              <Ionicons name="location-outline" size={12} color={c.textMuted} />
              <AppText variant="micro" color="muted" numberOfLines={1}>{accident.location}</AppText>
            </View>
          ) : null}
          {accident.injuries && (
            <View style={styles.accMeta}>
              <Ionicons name="medical-outline" size={12} color={c.danger.base} />
              <AppText variant="micro" color="danger">
                {accident.injury_count} {t('accident.injuries')}
              </AppText>
            </View>
          )}
          <Badge
            kind={STATUS_KIND[accident.status]}
            icon={STATUS_ICONS[accident.status] as IconName}
          >
            {t(`accident.statuses.${accident.status}`)}
          </Badge>
        </View>

        {/* Admin/manager: show reporter + photo count inline */}
        {showReporter && accident.reporter_name ? (
          <View style={styles.reporterRow}>
            <Ionicons name="person-outline" size={11} color={c.textMuted} />
            <AppText variant="micro" color="muted">{accident.reporter_name}</AppText>
            {accident.photos?.length > 0 && (
              <>
                <View style={[styles.reporterDot, { backgroundColor: c.borderStrong }]} />
                <Ionicons name="images-outline" size={11} color={c.textMuted} />
                <AppText variant="micro" color="muted">{accident.photos.length} photos</AppText>
              </>
            )}
          </View>
        ) : (
          accident.photos?.length > 0 && (
            <View style={styles.accMeta}>
              <Ionicons name="images-outline" size={12} color={c.textMuted} />
              <AppText variant="micro" color="muted">{accident.photos.length} photos</AppText>
            </View>
          )
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textMuted} style={styles.accChevron} />
    </Card>
  )
}

const styles = StyleSheet.create({
  scroll:  { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md, flexGrow: 1 },
  listHeader: { gap: spacing.md },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1,
    gap: spacing.md,
  },

  // KPI
  kpiRow: { flexDirection: 'row', gap: spacing.sm },

  // Severity breakdown
  severityBreakdown: { gap: spacing.md, marginTop: spacing.md },
  sectionLabel: { marginBottom: spacing.sm, textTransform: 'uppercase' },
  sevRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sevLabel:   { width: 72 },
  sevBarTrack:{ flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  sevBarFill: { height: 8, borderRadius: 4, minWidth: 4 },
  sevCount:   { width: 24, textAlign: 'right' },

  // Admin site filter
  siteScroll: { marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg },
  siteChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1.5, marginRight: spacing.sm,
  },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderWidth: 1.5, gap: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 13, padding: 0 },

  // Filter tabs
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  filterTab: {
    flex: 1, paddingVertical: spacing.sm + 1, borderRadius: radius.sm,
    borderWidth: 1.5, alignItems: 'center',
  },

  // Accident cards
  accCard: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  accContent:  { flex: 1, padding: spacing.md, gap: spacing.sm },
  accTopRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  accBottomRow:{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  accMeta:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  accChevron:  { marginRight: spacing.sm },
  reporterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  reporterDot: { width: 3, height: 3, borderRadius: 2 },
})
