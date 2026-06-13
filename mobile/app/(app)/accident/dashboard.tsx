/**
 * Accident Dashboard
 *
 * KPI summary cards, severity breakdown, site filter (admin/manager/director),
 * search, filterable accident list. Tap any report to open the detail view.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, StatusBar, ActivityIndicator, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { supabase } from '../../../lib/supabase'
import {
  AccidentRecord, AccidentSeverity,
  SEVERITY_COLORS, STATUS_COLORS,
  SEVERITY_ICONS, STATUS_ICONS,
  isAdminOrAbove,
} from '../../../lib/types'

type FilterTab = 'all' | 'mine'

const SEVERITY_ORDER: AccidentSeverity[] = ['minor', 'moderate', 'severe', 'fatal']

export default function AccidentDashboardScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()

  const [accidents, setAccidents]   = useState<AccidentRecord[]>([])
  const [sites, setSites]           = useState<string[]>([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filterTab, setFilterTab]   = useState<FilterTab>('all')
  const [siteFilter, setSiteFilter] = useState<string>('all')
  const [search, setSearch]         = useState('')

  const textAlign = isRTL ? 'right' : 'left'
  const elevated  = isAdminOrAbove(profile?.role ?? null)

  const load = useCallback(async () => {
    try {
      let query = supabase
        .from('accidents')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)

      if (filterTab === 'mine') {
        query = query.eq('reported_by', profile?.id ?? '')
      }
      if (elevated && siteFilter !== 'all') {
        query = query.eq('site', siteFilter)
      }

      const { data } = await query
      if (data) {
        setAccidents(data as AccidentRecord[])
        if (elevated) {
          const unique = Array.from(new Set((data as AccidentRecord[]).map(a => a.site))).sort()
          setSites(unique)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [filterTab, siteFilter, profile?.id, elevated])

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

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff5f5" />
        <View style={styles.loader}><ActivityIndicator size="large" color="#dc2626" /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff5f5" />

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={[styles.header, isRTL && { flexDirection: 'row-reverse' }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { textAlign }]}>{t('accident.dashboardTitle')}</Text>
          <Text style={[styles.headerSub, { textAlign }]}>
            {elevated
              ? siteFilter === 'all' ? 'All Sites' : siteFilter
              : profile?.site ?? 'My Site'
            }
            {elevated ? <Text style={styles.adminTag}>  ·  Admin View</Text> : null}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.reportBtn}
          onPress={() => router.push('/(app)/accident/report')}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle" size={18} color="#fff" />
          <Text style={styles.reportBtnText}>{t('accident.reportNew')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#dc2626" />}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── KPI cards ───────────────────────────────────────────────────── */}
        <View style={styles.kpiRow}>
          <KpiCard label={t('accident.stats.total')}     value={total}     color="#0f172a" />
          <KpiCard label={t('accident.stats.open')}      value={open}      color="#f59e0b" />
          <KpiCard label={t('accident.stats.thisMonth')} value={thisMonth} color="#3b82f6" />
          <KpiCard label={t('accident.stats.critical')}  value={critical}  color="#dc2626" />
        </View>

        {/* ── Severity breakdown ──────────────────────────────────────────── */}
        <View style={styles.severityCard}>
          <Text style={styles.sectionTitle}>Severity Breakdown</Text>
          <View style={styles.severityBreakdown}>
            {SEVERITY_ORDER.map(sev => {
              const count = bySeverity[sev]
              const pct   = total > 0 ? count / total : 0
              return (
                <View key={sev} style={styles.sevRow}>
                  <Text style={styles.sevLabel}>{t(`accident.severities.${sev}`)}</Text>
                  <View style={styles.sevBarTrack}>
                    <View
                      style={[
                        styles.sevBarFill,
                        { width: `${Math.round(pct * 100)}%`, backgroundColor: SEVERITY_COLORS[sev] },
                      ]}
                    />
                  </View>
                  <Text style={[styles.sevCount, { color: SEVERITY_COLORS[sev] }]}>{count}</Text>
                </View>
              )
            })}
          </View>
        </View>

        {/* ── Admin: site filter chips ─────────────────────────────────────── */}
        {elevated && sites.length > 1 && (
          <View>
            <Text style={styles.sectionLabel}>Filter by Site</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.siteScroll}>
              {['all', ...sites].map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.siteChip, siteFilter === s && styles.siteChipActive]}
                  onPress={() => setSiteFilter(s)}
                >
                  <Text style={[styles.siteChipText, siteFilter === s && styles.siteChipTextActive]}>
                    {s === 'all' ? 'All Sites' : s}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Search bar ───────────────────────────────────────────────────── */}
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={16} color="#94a3b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search asset, site, type, reporter…"
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Filter tabs ─────────────────────────────────────────────────── */}
        <View style={styles.filterRow}>
          {(['all', 'mine'] as FilterTab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.filterTab, filterTab === tab && styles.filterTabActive]}
              onPress={() => setFilterTab(tab)}
            >
              <Text style={[styles.filterTabText, filterTab === tab && styles.filterTabTextActive]}>
                {tab === 'all' ? t('accident.filterAll') : t('accident.filterMine')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Result count ─────────────────────────────────────────────────── */}
        {q.length > 0 && (
          <Text style={styles.resultCount}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''} for "{search}"
          </Text>
        )}

        {/* ── Accident list ─────────────────────────────────────────────────── */}
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-outline" size={52} color="#fca5a5" />
            <Text style={styles.emptyTitle}>
              {q ? 'No matching reports' : t('accident.noAccidents')}
            </Text>
            <Text style={styles.emptyHint}>
              {q ? 'Try a different search term' : t('accident.noAccidentsHint')}
            </Text>
          </View>
        ) : (
          filtered.map(acc => (
            <AccidentCard
              key={acc.id}
              accident={acc}
              showReporter={elevated}
              onPress={() => router.push(`/(app)/accident/${acc.id}`)}
              t={t}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ── KPI Card ───────────────────────────────────────────────────────────────────
function KpiCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.kpiCard, { borderTopColor: color }]}>
      <Text style={[styles.kpiValue, { color }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
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
  const sevColor    = SEVERITY_COLORS[accident.severity]
  const statusColor = STATUS_COLORS[accident.status]

  return (
    <TouchableOpacity style={styles.accCard} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.accStrip, { backgroundColor: sevColor }]} />
      <View style={styles.accContent}>
        <View style={styles.accTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.accAsset} numberOfLines={1}>
              {accident.asset_no}
              <Text style={styles.accSite}>  ·  {accident.site}</Text>
            </Text>
            <Text style={styles.accType}>{t(`accident.types.${accident.accident_type}`)}</Text>
          </View>
          <View style={[styles.accSeverityBadge, { backgroundColor: sevColor + '20', borderColor: sevColor + '50' }]}>
            <Ionicons name={SEVERITY_ICONS[accident.severity] as any} size={12} color={sevColor} />
            <Text style={[styles.accSeverityText, { color: sevColor }]}>
              {t(`accident.severities.${accident.severity}`)}
            </Text>
          </View>
        </View>

        <View style={styles.accBottomRow}>
          <View style={styles.accMeta}>
            <Ionicons name="calendar-outline" size={12} color="#94a3b8" />
            <Text style={styles.accMetaText}>{accident.incident_date}</Text>
          </View>
          {accident.location ? (
            <View style={styles.accMeta}>
              <Ionicons name="location-outline" size={12} color="#94a3b8" />
              <Text style={styles.accMetaText} numberOfLines={1}>{accident.location}</Text>
            </View>
          ) : null}
          {accident.injuries && (
            <View style={styles.accMeta}>
              <Ionicons name="medical-outline" size={12} color="#dc2626" />
              <Text style={[styles.accMetaText, { color: '#dc2626' }]}>
                {accident.injury_count} {t('accident.injuries')}
              </Text>
            </View>
          )}
          <View style={[styles.accStatusBadge, { backgroundColor: statusColor + '20' }]}>
            <Ionicons name={STATUS_ICONS[accident.status] as any} size={11} color={statusColor} />
            <Text style={[styles.accStatusText, { color: statusColor }]}>
              {t(`accident.statuses.${accident.status}`)}
            </Text>
          </View>
        </View>

        {/* Admin/manager: show reporter + photo count inline */}
        {showReporter && accident.reporter_name ? (
          <View style={styles.reporterRow}>
            <Ionicons name="person-outline" size={11} color="#94a3b8" />
            <Text style={styles.reporterText}>{accident.reporter_name}</Text>
            {accident.photos?.length > 0 && (
              <>
                <View style={styles.reporterDot} />
                <Ionicons name="images-outline" size={11} color="#94a3b8" />
                <Text style={styles.reporterText}>{accident.photos.length} photos</Text>
              </>
            )}
          </View>
        ) : (
          accident.photos?.length > 0 && (
            <View style={styles.accPhotoMeta}>
              <Ionicons name="images-outline" size={12} color="#94a3b8" />
              <Text style={styles.accMetaText}>{accident.photos.length} photos</Text>
            </View>
          )
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#fff5f5' },
  loader:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:  { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.07)',
    gap: 12,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  headerSub:   { fontSize: 12, color: '#64748b', marginTop: 2 },
  adminTag:    { color: '#dc2626', fontWeight: '700' },

  reportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#dc2626',
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
  },
  reportBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },

  // KPI
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpiCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12,
    padding: 12, borderTopWidth: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    alignItems: 'center',
  },
  kpiValue: { fontSize: 22, fontWeight: '800' },
  kpiLabel: { fontSize: 10, fontWeight: '600', color: '#94a3b8', marginTop: 2, textAlign: 'center' },

  // Severity breakdown
  severityCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, gap: 12,
  },
  sectionTitle:      { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  sectionLabel:      { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 8 },
  severityBreakdown: { gap: 10 },
  sevRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sevLabel:   { fontSize: 12, fontWeight: '600', color: '#374151', width: 72 },
  sevBarTrack:{ flex: 1, height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, overflow: 'hidden' },
  sevBarFill: { height: 8, borderRadius: 4, minWidth: 4 },
  sevCount:   { fontSize: 13, fontWeight: '800', width: 24, textAlign: 'right' },

  // Admin site filter
  siteScroll: { marginHorizontal: -16, paddingHorizontal: 16 },
  siteChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0', marginRight: 8,
  },
  siteChipActive:    { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  siteChipText:      { fontSize: 12, fontWeight: '700', color: '#94a3b8' },
  siteChipTextActive:{ color: '#fff' },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1.5, borderColor: '#e2e8f0', gap: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: '#0f172a', padding: 0 },
  resultCount: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },

  // Filter tabs
  filterRow: { flexDirection: 'row', gap: 8 },
  filterTab: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0', alignItems: 'center',
  },
  filterTabActive:     { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  filterTabText:       { fontSize: 13, fontWeight: '700', color: '#94a3b8' },
  filterTabTextActive: { color: '#fff' },

  // Accident cards
  accCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  accStrip:    { width: 4, alignSelf: 'stretch' },
  accContent:  { flex: 1, padding: 14, gap: 8 },
  accTopRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  accAsset:    { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  accSite:     { fontWeight: '400', color: '#64748b' },
  accType:     { fontSize: 12, color: '#64748b', marginTop: 2 },
  accSeverityBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  accSeverityText:  { fontSize: 11, fontWeight: '800' },
  accBottomRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  accMeta:          { flexDirection: 'row', alignItems: 'center', gap: 3 },
  accMetaText:      { fontSize: 11, color: '#94a3b8' },
  accStatusBadge:   { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  accStatusText:    { fontSize: 10, fontWeight: '700' },
  accPhotoMeta:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reporterRow:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reporterText:     { fontSize: 11, color: '#94a3b8' },
  reporterDot:      { width: 3, height: 3, borderRadius: 2, backgroundColor: '#cbd5e1' },

  // Empty
  empty:      { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptyHint:  { fontSize: 13, color: '#94a3b8', textAlign: 'center' },
})
