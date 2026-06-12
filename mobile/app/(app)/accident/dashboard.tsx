/**
 * Accident Dashboard
 *
 * Shows KPI summary cards, severity breakdown, and a filterable
 * list of all accident reports. Tap any report to open the detail view.
 * "Report Accident" FAB navigates to the report form.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, StatusBar, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { supabase } from '../../../lib/supabase'
import {
  AccidentRecord, AccidentSeverity, AccidentStatus,
  SEVERITY_COLORS, STATUS_COLORS,
} from '../../../lib/types'

type FilterTab = 'all' | 'mine'

const SEVERITY_ORDER: AccidentSeverity[] = ['minor', 'moderate', 'severe', 'fatal']

export default function AccidentDashboardScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()

  const [accidents, setAccidents]     = useState<AccidentRecord[]>([])
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)
  const [filterTab, setFilterTab]     = useState<FilterTab>('all')

  const textAlign = isRTL ? 'right' : 'left'

  const load = useCallback(async () => {
    try {
      let query = supabase
        .from('accidents')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      if (filterTab === 'mine') {
        query = query.eq('reported_by', profile?.id ?? '')
      }

      const { data } = await query
      if (data) setAccidents(data as AccidentRecord[])
    } finally {
      setLoading(false)
    }
  }, [filterTab, profile?.id])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  // ── Derived stats ──────────────────────────────────────────────────────────
  const thisMonthStr = new Date().toISOString().slice(0, 7) // YYYY-MM
  const total        = accidents.length
  const open         = accidents.filter(a => a.status !== 'closed').length
  const thisMonth    = accidents.filter(a => a.incident_date?.startsWith(thisMonthStr)).length
  const critical     = accidents.filter(a => a.severity === 'fatal' || a.severity === 'severe').length

  const bySeverity: Record<AccidentSeverity, number> = {
    minor: 0, moderate: 0, severe: 0, fatal: 0,
  }
  accidents.forEach(a => { bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1 })

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff5f5" />
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#dc2626" />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff5f5" />

      {/* ── Header ────────────────────────────────────────────────────── */}
      <View style={[styles.header, isRTL && styles.headerRTL]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { textAlign }]}>{t('accident.dashboardTitle')}</Text>
          <Text style={[styles.headerSub, { textAlign }]}>
            {profile?.site ?? 'All Sites'}
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
      >
        {/* ── KPI cards ───────────────────────────────────────────────── */}
        <View style={styles.kpiRow}>
          <KpiCard label={t('accident.stats.total')}    value={total}     color="#0f172a" />
          <KpiCard label={t('accident.stats.open')}     value={open}      color="#f59e0b" />
          <KpiCard label={t('accident.stats.thisMonth')} value={thisMonth} color="#3b82f6" />
          <KpiCard label={t('accident.stats.critical')} value={critical}   color="#dc2626" />
        </View>

        {/* ── Severity breakdown ──────────────────────────────────────── */}
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

        {/* ── Filter tabs ─────────────────────────────────────────────── */}
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

        {/* ── Accident list ────────────────────────────────────────────── */}
        {accidents.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-outline" size={52} color="#fca5a5" />
            <Text style={styles.emptyTitle}>{t('accident.noAccidents')}</Text>
            <Text style={styles.emptyHint}>{t('accident.noAccidentsHint')}</Text>
          </View>
        ) : (
          accidents.map(acc => (
            <AccidentCard
              key={acc.id}
              accident={acc}
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
  accident, onPress, t,
}: { accident: AccidentRecord; onPress: () => void; t: (k: string) => string }) {
  const sevColor    = SEVERITY_COLORS[accident.severity]
  const statusColor = STATUS_COLORS[accident.status]

  return (
    <TouchableOpacity style={styles.accCard} onPress={onPress} activeOpacity={0.75}>
      {/* Severity indicator strip */}
      <View style={[styles.accStrip, { backgroundColor: sevColor }]} />

      <View style={styles.accContent}>
        <View style={styles.accTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.accAsset} numberOfLines={1}>
              {accident.asset_no}
              <Text style={styles.accSite}>  ·  {accident.site}</Text>
            </Text>
            <Text style={styles.accType}>
              {t(`accident.types.${accident.accident_type}`)}
            </Text>
          </View>
          <View style={[styles.accSeverityBadge, { backgroundColor: sevColor + '20', borderColor: sevColor + '50' }]}>
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
            <Text style={[styles.accStatusText, { color: statusColor }]}>
              {t(`accident.statuses.${accident.status}`)}
            </Text>
          </View>
        </View>

        {accident.photos?.length > 0 && (
          <View style={styles.accPhotoMeta}>
            <Ionicons name="images-outline" size={12} color="#94a3b8" />
            <Text style={styles.accMetaText}>{accident.photos.length} photos</Text>
          </View>
        )}
      </View>

      <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: '#fff5f5' },
  loader:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:   { flex: 1 },
  content:  { padding: 16, paddingBottom: 40, gap: 14 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.07)',
    gap: 12,
  },
  headerRTL: { flexDirection: 'row-reverse' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  headerSub:   { fontSize: 12, color: '#64748b', marginTop: 2 },

  reportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#dc2626',
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20,
  },
  reportBtnText: { fontSize: 12, fontWeight: '800', color: '#fff' },

  // KPI
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpiCard: {
    flex: 1, backgroundColor: '#fff',
    borderRadius: 12, padding: 12,
    borderTopWidth: 3,
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
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    gap: 12,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  severityBreakdown: { gap: 10 },
  sevRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sevLabel: { fontSize: 12, fontWeight: '600', color: '#374151', width: 72 },
  sevBarTrack: { flex: 1, height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, overflow: 'hidden' },
  sevBarFill:  { height: 8, borderRadius: 4, minWidth: 4 },
  sevCount: { fontSize: 13, fontWeight: '800', width: 24, textAlign: 'right' },

  // Filter tabs
  filterRow: { flexDirection: 'row', gap: 8 },
  filterTab: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  filterTabActive:     { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  filterTabText:       { fontSize: 13, fontWeight: '700', color: '#94a3b8' },
  filterTabTextActive: { color: '#fff' },

  // Accident cards
  accCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  accStrip: { width: 4, alignSelf: 'stretch' },
  accContent: { flex: 1, padding: 14, gap: 8 },
  accTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  accAsset: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  accSite:  { fontWeight: '400', color: '#64748b' },
  accType:  { fontSize: 12, color: '#64748b', marginTop: 2 },
  accSeverityBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
  },
  accSeverityText: { fontSize: 11, fontWeight: '800' },
  accBottomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  accMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  accMetaText: { fontSize: 11, color: '#94a3b8' },
  accStatusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  accStatusText: { fontSize: 10, fontWeight: '700' },
  accPhotoMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  // Empty
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptyHint:  { fontSize: 13, color: '#94a3b8', textAlign: 'center' },
})
