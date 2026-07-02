/**
 * Home Screen - role-aware mission control
 *
 * Inspector / Tyre Man  → inspection-focused: sync status, quick scan, today's count
 * Manager / Director    → fleet health mini-dashboard + navigation shortcuts
 * Admin                 → AI shortcut + executive summary
 * Reporter              → reports & records access
 *
 * Loading strategy: offline queue from AsyncStorage (instant), then
 * DB data in parallel (skeleton while waiting).
 */

import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, StatusBar, Platform, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { getQueue, getPendingCount, syncQueue } from '../../lib/offlineQueue'
import { supabase } from '../../lib/supabase'
import SyncBanner from '../../components/SyncBanner'
import { SkeletonBox, SkeletonStatRow, SkeletonList } from '../../components/SkeletonLoader'
import { isAdminOrAbove, UserRole } from '../../lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InspectionItem {
  id: string
  title: string
  site: string | null
  asset_no: string | null
  inspection_date: string
  sync_status?: string
  isOffline?: boolean
}

interface FleetHealth {
  criticalCount: number
  openWorkOrders: number
  inspThisWeek: number
  totalVehicles: number
}

// ── Role-aware quick actions ───────────────────────────────────────────────────

interface QuickAction {
  icon: string
  label: string
  sublabel?: string
  route: string
  color: string
  bg: string
}

function getQuickActions(role: UserRole | null): QuickAction[] {
  switch (role) {
    case 'inspector':
      return [
        { icon: 'clipboard-outline',     label: 'New Inspection', sublabel: 'Start a tyre check',  route: '/(app)/inspection/new',       color: '#16a34a', bg: '#f0fdf4' },
        { icon: 'scan-outline',          label: 'Scan Asset',     sublabel: 'Barcode / QR code',   route: '/(app)/scanner',              color: '#0ea5e9', bg: '#f0f9ff' },
        { icon: 'layers-outline',        label: 'Tyre Records',   sublabel: 'Browse all records',  route: '/(app)/records/index',        color: '#3b82f6', bg: '#eff6ff' },
        { icon: 'warning-outline',       label: 'Accident',       sublabel: 'File a report',        route: '/(app)/accident/report',      color: '#dc2626', bg: '#fff5f5' },
      ]
    case 'tyre_man':
      return [
        { icon: 'construct-outline',     label: 'Work Orders',    sublabel: 'Open actions',         route: '/(app)/workorders/index',     color: '#f59e0b', bg: '#fffbeb' },
        { icon: 'clipboard-outline',     label: 'New Inspection', sublabel: 'Start a tyre check',  route: '/(app)/inspection/new',       color: '#16a34a', bg: '#f0fdf4' },
        { icon: 'layers-outline',        label: 'Tyre Records',   sublabel: 'Browse all records',  route: '/(app)/records/index',        color: '#3b82f6', bg: '#eff6ff' },
        { icon: 'scan-outline',          label: 'Scan Asset',     sublabel: 'Barcode / QR code',   route: '/(app)/scanner',              color: '#0ea5e9', bg: '#f0f9ff' },
      ]
    case 'reporter':
      return [
        { icon: 'document-text-outline', label: 'Reports',        sublabel: 'Generate PDF',         route: '/(app)/reports/index',        color: '#3b82f6', bg: '#eff6ff' },
        { icon: 'layers-outline',        label: 'Tyre Records',   sublabel: 'Browse all records',  route: '/(app)/records/index',        color: '#6366f1', bg: '#eef2ff' },
        { icon: 'warning-outline',       label: 'Accidents',      sublabel: 'Incident overview',    route: '/(app)/accident/dashboard',   color: '#dc2626', bg: '#fff5f5' },
        { icon: 'time-outline',          label: 'History',        sublabel: 'Past inspections',     route: '/(app)/history',              color: '#64748b', bg: '#f8fafc' },
      ]
    case 'manager':
    case 'director':
      return [
        { icon: 'bar-chart-outline',     label: 'Analytics',      sublabel: 'Fleet KPIs',           route: '/(app)/analytics/index',      color: '#3b82f6', bg: '#eff6ff' },
        { icon: 'construct-outline',     label: 'Work Orders',    sublabel: 'Open actions',         route: '/(app)/workorders/index',     color: '#f59e0b', bg: '#fffbeb' },
        { icon: 'document-text-outline', label: 'Reports',        sublabel: 'Generate PDF',         route: '/(app)/reports/index',        color: '#8b5cf6', bg: '#f5f3ff' },
        { icon: 'warning-outline',       label: 'Accidents',      sublabel: 'Incident review',      route: '/(app)/accident/dashboard',   color: '#dc2626', bg: '#fff5f5' },
      ]
    default: // admin
      return [
        { icon: 'sparkles-outline',      label: 'Fleet AI',       sublabel: 'Ask anything',         route: '/(app)/ai/index',             color: '#7c3aed', bg: '#f5f3ff' },
        { icon: 'bar-chart-outline',     label: 'Analytics',      sublabel: 'Fleet KPIs',           route: '/(app)/analytics/index',      color: '#3b82f6', bg: '#eff6ff' },
        { icon: 'construct-outline',     label: 'Work Orders',    sublabel: 'Open actions',         route: '/(app)/workorders/index',     color: '#f59e0b', bg: '#fffbeb' },
        { icon: 'document-text-outline', label: 'Reports',        sublabel: 'Generate PDF',         route: '/(app)/reports/index',        color: '#16a34a', bg: '#f0fdf4' },
      ]
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function QuickActionCard({ action, onPress }: { action: QuickAction; onPress: () => void }) {
  return (
    <TouchableOpacity style={[qas.card, { backgroundColor: action.bg }]} onPress={onPress} activeOpacity={0.78}>
      <View style={[qas.iconWrap, { backgroundColor: action.color + '1a' }]}>
        <Ionicons name={action.icon as any} size={22} color={action.color} />
      </View>
      <Text style={[qas.label, { color: action.color }]}>{action.label}</Text>
      {action.sublabel && <Text style={qas.sublabel}>{action.sublabel}</Text>}
    </TouchableOpacity>
  )
}

const qas = StyleSheet.create({
  card: {
    flex: 1, borderRadius: 16, padding: 14, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    minHeight: 100,
  },
  iconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  label:    { fontSize: 13, fontWeight: '800', marginTop: 2 },
  sublabel: { fontSize: 11, color: '#94a3b8', fontWeight: '500' },
})

// ── Main screen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()

  const [pendingCount, setPendingCount]         = useState(0)
  const [recentInspections, setRecentInspections] = useState<InspectionItem[]>([])
  const [refreshing, setRefreshing]             = useState(false)
  const [todayCount, setTodayCount]             = useState(0)
  const [networkLoading, setNetworkLoading]     = useState(true)
  const [fleetHealth, setFleetHealth]           = useState<FleetHealth | null>(null)
  const [fleetLoading, setFleetLoading]         = useState(true)

  const role = profile?.role as UserRole | null | undefined
  const elevated = isAdminOrAbove(role)
  const firstName = profile?.full_name?.split(' ')[0] ?? t('tabs.profile')
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('home.goodMorning') : hour < 17 ? t('home.goodAfternoon') : t('home.goodEvening')
  const today = new Date().toLocaleDateString(isRTL ? 'ar-SA' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  const quickActions = getQuickActions(role ?? null)

  const load = useCallback(async () => {
    // Phase 1: offline queue (AsyncStorage - instant)
    const count = await getPendingCount()
    setPendingCount(count)

    // Phase 2: network (parallel)
    const todayStr = new Date().toISOString().split('T')[0]
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    const weekStr = weekAgo.toISOString().split('T')[0]

    const queue = await getQueue()
    const todayQueue = queue.filter(i => i.payload.inspection_date?.startsWith(todayStr))

    const offlineItems: InspectionItem[] = queue.slice(0, 3).map(item => ({
      id: item.id,
      title: item.payload.title,
      site: item.payload.site,
      asset_no: item.payload.asset_no,
      inspection_date: item.payload.inspection_date,
      sync_status: item.sync_status,
      isOffline: true,
    }))

    const dbFetch = supabase
      .from('inspections')
      .select('id, title, site, asset_no, inspection_date, status')
      .eq('created_by', profile?.id ?? '')
      .order('created_at', { ascending: false })
      .limit(5)

    const fleetFetch = elevated
      ? Promise.all([
          supabase.from('tyre_records').select('risk_level').in('risk_level', ['Critical', 'High']).gte('issue_date', weekStr),
          supabase.from('corrective_actions').select('id', { count: 'exact', head: true }).eq('status', 'Open'),
          supabase.from('inspections').select('id', { count: 'exact', head: true }).gte('created_at', weekStr),
          supabase.from('vehicle_fleet').select('id', { count: 'exact', head: true }),
        ])
      : null

    const [dbRes, fleetRes] = await Promise.all([dbFetch, fleetFetch ?? Promise.resolve(null)])

    const dbItems = dbRes.data ?? []
    const todayDB = dbItems.filter((i: any) => i.inspection_date?.startsWith(todayStr))
    setTodayCount(todayDB.length + todayQueue.length)

    const combined = [...offlineItems, ...dbItems].slice(0, 5)
    setRecentInspections(combined as InspectionItem[])
    setNetworkLoading(false)

    if (fleetRes) {
      const [riskRes, actRes, inspRes, vehRes] = fleetRes as any[]
      const recs = (riskRes.data ?? []) as { risk_level: string }[]
      setFleetHealth({
        criticalCount:  recs.filter(r => r.risk_level === 'Critical').length,
        openWorkOrders: actRes.count ?? 0,
        inspThisWeek:   inspRes.count ?? 0,
        totalVehicles:  vehRes.count ?? 0,
      })
      setFleetLoading(false)
    } else {
      setFleetLoading(false)
    }
  }, [profile?.id, elevated])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    setNetworkLoading(true)
    setFleetLoading(true)
    await syncQueue()
    await load()
    setRefreshing(false)
  }

  const textAlign = isRTL ? 'right' : 'left'

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <SyncBanner />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <View style={[s.header, isRTL && s.rowReverse]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.greeting, { textAlign }]}>{greeting}, {firstName}</Text>
            <Text style={[s.date, { textAlign }]}>{today}</Text>
          </View>
          {pendingCount > 0 && (
            <TouchableOpacity style={s.pendingBadge} onPress={() => router.push('/(app)/profile')}>
              <Text style={s.pendingNum}>{pendingCount}</Text>
              <Text style={s.pendingLbl}>{t('home.pending')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Stats row ─────────────────────────────────────────────────────── */}
        {networkLoading ? <SkeletonStatRow /> : (
          <View style={s.statsRow}>
            <StatCard
              icon="calendar-outline"
              value={todayCount.toString()}
              label={t('home.today')}
              valueColor={todayCount > 0 ? '#16a34a' : '#0f172a'}
            />
            <StatCard
              icon="cloud-upload-outline"
              value={pendingCount.toString()}
              label={t('home.pendingSync')}
              valueColor={pendingCount > 0 ? '#d97706' : '#0f172a'}
            />
            <StatCard
              icon="location-outline"
              value={profile?.site ? profile.site.split(' ')[0] : t('home.allSites')}
              label="Site"
              small
            />
          </View>
        )}

        {/* ── Primary CTA ───────────────────────────────────────────────────── */}
        <TouchableOpacity style={s.ctaButton} onPress={() => router.push('/(app)/inspection/new')} activeOpacity={0.88}>
          <View style={s.ctaIcon}>
            <Ionicons name="add-circle" size={28} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.ctaTitle}>{t('home.startInspection')}</Text>
            <Text style={s.ctaSubtitle}>{t('home.startSubtitle')}</Text>
          </View>
          <Ionicons name={isRTL ? 'arrow-back-circle' : 'arrow-forward-circle'} size={28} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>

        {/* ── Quick Actions grid ─────────────────────────────────────────────── */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Quick Actions</Text>
        </View>
        <View style={s.quickGrid}>
          {quickActions.map((a, i) => (
            <QuickActionCard key={i} action={a} onPress={() => router.push(a.route as any)} />
          ))}
        </View>

        {/* ── Fleet Health (elevated roles) ─────────────────────────────────── */}
        {elevated && (
          <View>
            <Text style={s.sectionTitle}>Fleet Health · This Week</Text>
            {fleetLoading ? (
              <View style={s.fleetCard}>
                <View style={s.fleetRow}>
                  {[0, 1, 2, 3].map(i => (
                    <View key={i} style={s.fleetStat}>
                      <SkeletonBox height={26} width={32} radius={5} />
                      <SkeletonBox height={10} width={52} radius={3} style={{ marginTop: 5 }} />
                    </View>
                  ))}
                </View>
              </View>
            ) : fleetHealth && (
              <View style={s.fleetCard}>
                <View style={s.fleetRow}>
                  <FleetStat value={fleetHealth.totalVehicles} label="Vehicles" icon="car-outline" color="#3b82f6" />
                  <FleetStat value={fleetHealth.criticalCount} label="Critical" icon="warning-outline" color="#dc2626" alert={fleetHealth.criticalCount > 0} />
                  <FleetStat value={fleetHealth.openWorkOrders} label="Open Actions" icon="construct-outline" color="#f59e0b" alert={fleetHealth.openWorkOrders > 0} />
                  <FleetStat value={fleetHealth.inspThisWeek} label="Inspections" icon="clipboard-outline" color="#16a34a" />
                </View>
                {(fleetHealth.criticalCount > 0 || fleetHealth.openWorkOrders > 5) && (
                  <TouchableOpacity
                    style={s.fleetAlert}
                    onPress={() => router.push(fleetHealth.criticalCount > 0 ? '/(app)/records/index' : '/(app)/workorders/index')}
                  >
                    <Ionicons name="alert-circle-outline" size={14} color="#dc2626" />
                    <Text style={s.fleetAlertText}>
                      {fleetHealth.criticalCount > 0
                        ? `${fleetHealth.criticalCount} critical tyre${fleetHealth.criticalCount > 1 ? 's' : ''} need attention`
                        : `${fleetHealth.openWorkOrders} work orders open - review recommended`}
                    </Text>
                    <Ionicons name="chevron-forward" size={13} color="#dc2626" />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── Scan shortcut ─────────────────────────────────────────────────── */}
        <TouchableOpacity style={s.scanButton} onPress={() => router.push('/(app)/scanner')} activeOpacity={0.85}>
          <View style={s.scanIcon}>
            <Ionicons name="scan" size={22} color="#16a34a" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.scanTitle}>{t('home.scanAsset')}</Text>
            <Text style={s.scanSubtitle}>{t('home.scanSubtitle')}</Text>
          </View>
          <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color="#94a3b8" />
        </TouchableOpacity>

        {/* ── Recent inspections ────────────────────────────────────────────── */}
        <View>
          <View style={[s.sectionHeader, { marginBottom: 10 }]}>
            <Text style={s.sectionTitle}>{t('home.recentInspections')}</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/history')}>
              <Text style={s.sectionLink}>{t('home.viewAll')}</Text>
            </TouchableOpacity>
          </View>
          {networkLoading ? <SkeletonList count={3} /> : recentInspections.length === 0 ? (
            <View style={s.emptyState}>
              <Ionicons name="clipboard-outline" size={44} color="#cbd5e1" />
              <Text style={s.emptyTitle}>{t('home.noInspections')}</Text>
              <Text style={s.emptySubtitle}>{t('home.noInspectionsHint')}</Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {recentInspections.map(item => (
                <RecentCard key={item.id} item={item} t={t} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

// ── Mini sub-components ────────────────────────────────────────────────────────

function StatCard({ icon, value, label, valueColor = '#0f172a', small = false }: {
  icon: string; value: string; label: string; valueColor?: string; small?: boolean
}) {
  return (
    <View style={s.statCard}>
      <Ionicons name={icon as any} size={16} color={valueColor} />
      <Text style={[s.statNum, { color: valueColor }, small && { fontSize: 12, fontWeight: '700' }]} numberOfLines={1}>{value}</Text>
      <Text style={s.statLbl}>{label}</Text>
    </View>
  )
}

function FleetStat({ value, label, icon, color, alert }: { value: number; label: string; icon: string; color: string; alert?: boolean }) {
  return (
    <View style={s.fleetStat}>
      <Ionicons name={icon as any} size={16} color={color} />
      <Text style={[s.fleetNum, { color: alert ? color : '#0f172a' }]}>{value}</Text>
      <Text style={s.fleetLbl}>{label}</Text>
    </View>
  )
}

function RecentCard({ item, t }: { item: InspectionItem; t: (k: string) => string }) {
  const statusColor =
    item.sync_status === 'pending' ? '#d97706'
    : item.sync_status === 'failed' ? '#dc2626'
    : '#16a34a'
  const statusLabel =
    item.sync_status === 'pending' ? t('home.pending')
    : item.sync_status === 'failed' ? t('home.failed')
    : t('home.synced')

  return (
    <View style={s.recentCard}>
      <View style={s.recentIcon}>
        <Ionicons name="document-text-outline" size={18} color="#16a34a" />
      </View>
      <View style={s.recentInfo}>
        <Text style={s.recentTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={s.recentMeta} numberOfLines={1}>
          {[item.site, item.asset_no, item.inspection_date
            ? new Date(item.inspection_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            : null
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={[s.syncBadge, { borderColor: statusColor + '44', backgroundColor: statusColor + '14' }]}>
        <Text style={[s.syncBadgeText, { color: statusColor }]}>{statusLabel}</Text>
      </View>
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#f0f5f1' },
  scroll:  { flex: 1 },
  content: { padding: 18, gap: 18, paddingBottom: Platform.OS === 'ios' ? 24 : 16 },

  // Header
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  rowReverse: { flexDirection: 'row-reverse' },
  greeting:   { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  date:       { fontSize: 12, color: '#64748b', marginTop: 3 },
  pendingBadge: {
    alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
  },
  pendingNum: { fontSize: 18, fontWeight: '800', color: '#d97706' },
  pendingLbl: { fontSize: 10, color: '#b45309', fontWeight: '600' },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12,
    alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  statNum: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  statLbl: { fontSize: 10, color: '#94a3b8', fontWeight: '600', textAlign: 'center' },

  // CTA
  ctaButton: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#16a34a', borderRadius: 18, padding: 18,
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.32, shadowRadius: 14, elevation: 8,
  },
  ctaIcon:     { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  ctaTitle:    { fontSize: 17, fontWeight: '800', color: '#fff' },
  ctaSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  // Quick actions
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle:  { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  sectionLink:   { fontSize: 13, color: '#16a34a', fontWeight: '600' },
  quickGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  // Fleet health
  fleetCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    gap: 12,
  },
  fleetRow:  { flexDirection: 'row', justifyContent: 'space-around' },
  fleetStat: { alignItems: 'center', gap: 4 },
  fleetNum:  { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  fleetLbl:  { fontSize: 10, color: '#94a3b8', fontWeight: '600', textAlign: 'center' },
  fleetAlert:{
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef2f2', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#fecaca',
  },
  fleetAlertText: { flex: 1, fontSize: 12, color: '#dc2626', fontWeight: '600' },

  // Scan
  scanButton: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', borderRadius: 16, padding: 15,
    borderWidth: 1, borderColor: 'rgba(22,163,74,0.2)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  scanIcon:    { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(22,163,74,0.1)', alignItems: 'center', justifyContent: 'center' },
  scanTitle:   { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  scanSubtitle:{ fontSize: 12, color: '#64748b', marginTop: 2 },

  // Recent
  recentCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 12, padding: 13,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  recentIcon:  { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(22,163,74,0.08)', alignItems: 'center', justifyContent: 'center' },
  recentInfo:  { flex: 1, gap: 3 },
  recentTitle: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  recentMeta:  { fontSize: 11, color: '#94a3b8' },
  syncBadge:   { borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  syncBadgeText: { fontSize: 10, fontWeight: '700' },

  // Empty
  emptyState:   { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle:   { fontSize: 15, fontWeight: '700', color: '#94a3b8' },
  emptySubtitle:{ fontSize: 12, color: '#cbd5e1', textAlign: 'center', lineHeight: 18 },
})
