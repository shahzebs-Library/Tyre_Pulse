/**
 * Admin Executive Snapshot
 *
 * Morning briefing for Admin / Manager / Director:
 * Fleet KPIs · Open accidents · Active alerts · Pending user approvals
 * Quick navigation to AI Chat, User Management, and Accident Review.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { supabase } from '../../../lib/supabase'
import { SEVERITY_COLORS, STATUS_COLORS, isAdminOrAbove, isAdmin } from '../../../lib/types'
import { useElevatedGuard } from '../../../hooks/useRoleGuard'

interface Stats {
  totalVehicles:    number
  openAccidents:    number
  criticalAccidents:number
  activeAlerts:     number
  criticalAlerts:   number
  inspThisWeek:     number
  pendingUsers:     number
  pendingClosures:  number
  pendingUploads:   number
}

interface RecentAccident {
  id: string
  asset_no: string
  site: string
  severity: string
  status: string
  accident_type: string
  incident_date: string
}

interface ActiveAlert {
  id: string
  asset_no: string
  site: string
  severity: string
  message: string
  alert_type: string
  created_at: string
}

const GREETING = () => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function AdminDashboardScreen() {
  const { allowed, loading: guardLoading } = useElevatedGuard()
  const { profile } = useAuth()
  const { t } = useLanguage()
  const router = useRouter()

  const [stats, setStats]         = useState<Stats | null>(null)
  const [accidents, setAccidents] = useState<RecentAccident[]>([])
  const [alerts, setAlerts]       = useState<ActiveAlert[]>([])
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    const weekStr = weekAgo.toISOString().split('T')[0]

    const [
      vehiclesRes, accidentsRes, alertsRes, inspRes, usersRes,
      recentAccRes, activeAlertRes, closuresRes, uploadsRes,
    ] = await Promise.all([
      supabase.from('vehicle_fleet').select('id', { count: 'exact', head: true }),
      supabase.from('accidents').select('severity, status'),
      supabase.from('alerts').select('severity', { count: 'exact' }).eq('resolved', false).eq('is_active', true),
      supabase.from('inspections').select('id', { count: 'exact', head: true }).gte('created_at', weekStr),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('approved', false),
      supabase.from('accidents')
        .select('id, asset_no, site, severity, status, accident_type, incident_date')
        .in('status', ['reported', 'under_review'])
        .in('severity', ['severe', 'fatal'])
        .order('created_at', { ascending: false })
        .limit(4),
      supabase.from('alerts')
        .select('id, asset_no, site, severity, message, alert_type, created_at')
        .eq('resolved', false)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.from('accidents').select('id', { count: 'exact', head: true }).eq('closure_status', 'pending_closure'),
      supabase.from('pending_uploads').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])

    const accData = accidentsRes.data ?? []
    setStats({
      totalVehicles:     vehiclesRes.count ?? 0,
      openAccidents:     accData.filter(a => a.status !== 'closed').length,
      criticalAccidents: accData.filter(a => a.severity === 'fatal' || a.severity === 'severe').length,
      activeAlerts:      alertsRes.count ?? 0,
      criticalAlerts:    (alertsRes.data ?? []).filter(a => a.severity === 'critical' || a.severity === 'high').length,
      inspThisWeek:      inspRes.count ?? 0,
      pendingUsers:      usersRes.count ?? 0,
      pendingClosures:   closuresRes.count ?? 0,
      pendingUploads:    uploadsRes.count ?? 0,
    })
    setAccidents((recentAccRes.data ?? []) as RecentAccident[])
    setAlerts((activeAlertRes.data ?? []) as ActiveAlert[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  if (guardLoading || !allowed || loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#4c1d95" />
        <View style={styles.loader}><ActivityIndicator size="large" color="#7c3aed" /></View>
      </SafeAreaView>
    )
  }

  const roleLabel = profile?.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1).replace('_', ' ')
    : 'Admin'

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#4c1d95" />

      {/* ── Purple header ─────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{GREETING()}, {profile?.full_name?.split(' ')[0] ?? 'Admin'}</Text>
            <View style={styles.roleBadge}>
              <Ionicons name="shield-checkmark" size={11} color="#a78bfa" />
              <Text style={styles.roleText}>{roleLabel}</Text>
            </View>
          </View>
          <Text style={styles.dateText}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
        </View>

        {/* ── KPI strip ──────────────────────────────────────────────────── */}
        <View style={styles.kpiStrip}>
          <KpiPill icon="car-outline"       label="Fleet"     value={stats!.totalVehicles}    color="#a78bfa" />
          <KpiPill icon="warning-outline"   label="Open Acc"  value={stats!.openAccidents}    color="#fbbf24" alert={stats!.openAccidents > 0} />
          <KpiPill icon="notifications-outline" label="Alerts" value={stats!.activeAlerts}  color="#f87171" alert={stats!.criticalAlerts > 0} />
          <KpiPill icon="clipboard-outline" label="Insp/Wk"   value={stats!.inspThisWeek}    color="#34d399" />
          <KpiPill icon="lock-closed-outline" label="Closures" value={stats!.pendingClosures} color="#fbbf24" alert={stats!.pendingClosures > 0} />
          {isAdmin(profile?.role) && (
            <KpiPill icon="people-outline"  label="Pending"   value={stats!.pendingUsers}     color="#60a5fa" alert={stats!.pendingUsers > 0} />
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7c3aed" />}
      >
        {/* ── Quick actions ─────────────────────────────────────────────── */}
        <View style={styles.quickRow}>
          <QuickAction
            icon="sparkles-outline"
            label="AI Chat"
            sublabel="Ask fleet AI"
            color="#7c3aed"
            bg="#f5f3ff"
            onPress={() => router.push('/(app)/admin/ai-chat')}
          />
          {isAdmin(profile?.role) && (
            <QuickAction
              icon="people-outline"
              label="Users"
              sublabel={stats!.pendingUsers > 0 ? `${stats!.pendingUsers} pending` : 'Manage'}
              color="#2563eb"
              bg="#eff6ff"
              badge={stats!.pendingUsers > 0 ? stats!.pendingUsers : undefined}
              onPress={() => router.push('/(app)/admin/users')}
            />
          )}
          {isAdmin(profile?.role) && (
            <QuickAction
              icon="cloud-upload-outline"
              label="Approvals"
              sublabel={stats!.pendingUploads > 0 ? `${stats!.pendingUploads} pending` : 'Uploads'}
              color="#16a34a"
              bg="#f0fdf4"
              badge={stats!.pendingUploads > 0 ? stats!.pendingUploads : undefined}
              onPress={() => router.push('/(app)/admin/approvals')}
            />
          )}
          <QuickAction
            icon="warning-outline"
            label="Accidents"
            sublabel={`${stats!.openAccidents} open`}
            color="#dc2626"
            bg="#fff5f5"
            badge={stats!.criticalAccidents > 0 ? stats!.criticalAccidents : undefined}
            onPress={() => router.push('/(app)/accident/dashboard')}
          />
        </View>

        {/* ── Closures awaiting approval (elevated) ────────────────────── */}
        {stats!.pendingClosures > 0 && (
          <TouchableOpacity
            style={styles.closureBanner}
            onPress={() => router.push('/(app)/accident/dashboard')}
            activeOpacity={0.85}
          >
            <View style={styles.closureIcon}>
              <Ionicons name="lock-closed-outline" size={18} color="#b45309" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.closureTitle}>
                {stats!.pendingClosures} accident closure{stats!.pendingClosures > 1 ? 's' : ''} awaiting approval
              </Text>
              <Text style={styles.closureSub}>Tap to review and approve closures</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#fbbf24" />
          </TouchableOpacity>
        )}

        {/* ── Pending approval banner (admin only) ─────────────────────── */}
        {isAdmin(profile?.role) && stats!.pendingUsers > 0 && (
          <TouchableOpacity
            style={styles.approvalBanner}
            onPress={() => router.push('/(app)/admin/users')}
            activeOpacity={0.85}
          >
            <View style={styles.approvalIcon}>
              <Ionicons name="person-add-outline" size={18} color="#2563eb" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.approvalTitle}>
                {stats!.pendingUsers} user{stats!.pendingUsers > 1 ? 's' : ''} awaiting approval
              </Text>
              <Text style={styles.approvalSub}>Tap to review and approve access</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#93c5fd" />
          </TouchableOpacity>
        )}

        {/* ── Critical accidents queue ──────────────────────────────────── */}
        {accidents.length > 0 && (
          <SectionCard
            title="Critical Accidents"
            icon="flame-outline"
            iconColor="#dc2626"
            onViewAll={() => router.push('/(app)/accident/dashboard')}
          >
            {accidents.map(acc => {
              const sevColor = SEVERITY_COLORS[acc.severity as keyof typeof SEVERITY_COLORS] ?? '#94a3b8'
              const stColor  = STATUS_COLORS[acc.status as keyof typeof STATUS_COLORS] ?? '#94a3b8'
              return (
                <TouchableOpacity
                  key={acc.id}
                  style={styles.accRow}
                  onPress={() => router.push(`/(app)/accident/${acc.id}`)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.accStrip, { backgroundColor: sevColor }]} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={styles.accTop}>
                      <Text style={styles.accAsset}>{acc.asset_no}</Text>
                      <Text style={styles.accSite}>{acc.site}</Text>
                    </View>
                    <View style={styles.accBottom}>
                      <View style={[styles.miniChip, { backgroundColor: sevColor + '18' }]}>
                        <Text style={[styles.miniChipText, { color: sevColor }]}>{acc.severity}</Text>
                      </View>
                      <View style={[styles.miniChip, { backgroundColor: stColor + '18' }]}>
                        <Text style={[styles.miniChipText, { color: stColor }]}>{acc.status.replace('_', ' ')}</Text>
                      </View>
                      <Text style={styles.accDate}>{acc.incident_date}</Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color="#cbd5e1" />
                </TouchableOpacity>
              )
            })}
          </SectionCard>
        )}

        {/* ── Active alerts ─────────────────────────────────────────────── */}
        {alerts.length > 0 && (
          <SectionCard title="Active Alerts" icon="notifications-outline" iconColor="#f59e0b">
            {alerts.map((al, i) => {
              const sevColor =
                al.severity === 'critical' || al.severity === 'high' ? '#dc2626'
                : al.severity === 'medium' ? '#f59e0b'
                : '#64748b'
              return (
                <View
                  key={al.id}
                  style={[styles.alertRow, i < alerts.length - 1 && styles.alertRowBorder]}
                >
                  <View style={[styles.alertDot, { backgroundColor: sevColor }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.alertMsg} numberOfLines={2}>{al.message}</Text>
                    <Text style={styles.alertMeta}>{al.asset_no} · {al.site}</Text>
                  </View>
                  <View style={[styles.miniChip, { backgroundColor: sevColor + '18' }]}>
                    <Text style={[styles.miniChipText, { color: sevColor }]}>{al.severity ?? 'alert'}</Text>
                  </View>
                </View>
              )
            })}
          </SectionCard>
        )}

        {/* ── No critical items ─────────────────────────────────────────── */}
        {accidents.length === 0 && alerts.length === 0 && stats!.pendingUsers === 0 && (
          <View style={styles.allClear}>
            <Ionicons name="checkmark-circle" size={52} color="#34d399" />
            <Text style={styles.allClearTitle}>All Clear</Text>
            <Text style={styles.allClearSub}>No critical accidents, alerts, or pending approvals</Text>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiPill({ icon, label, value, color, alert }: {
  icon: string; label: string; value: number; color: string; alert?: boolean
}) {
  return (
    <View style={styles.kpiPill}>
      <Ionicons name={icon as any} size={14} color={color} />
      <Text style={[styles.kpiPillValue, { color: alert ? '#fbbf24' : '#fff' }]}>{value}</Text>
      <Text style={styles.kpiPillLabel}>{label}</Text>
    </View>
  )
}

function QuickAction({ icon, label, sublabel, color, bg, badge, onPress }: {
  icon: string; label: string; sublabel: string; color: string; bg: string; badge?: number; onPress: () => void
}) {
  return (
    <TouchableOpacity style={[styles.quickCard, { backgroundColor: bg }]} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.quickIconWrap, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon as any} size={22} color={color} />
        {badge != null && (
          <View style={[styles.badge, { backgroundColor: color }]}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.quickLabel, { color }]}>{label}</Text>
      <Text style={styles.quickSub}>{sublabel}</Text>
    </TouchableOpacity>
  )
}

function SectionCard({ title, icon, iconColor, children, onViewAll }: {
  title: string; icon: string; iconColor: string; children: React.ReactNode; onViewAll?: () => void
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon as any} size={15} color={iconColor} />
        <Text style={styles.sectionTitle}>{title}</Text>
        {onViewAll && (
          <TouchableOpacity onPress={onViewAll} style={styles.viewAll}>
            <Text style={styles.viewAllText}>View all</Text>
            <Ionicons name="chevron-forward" size={12} color="#7c3aed" />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#f8f5ff' },
  loader:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:  { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },

  // Header
  header: {
    backgroundColor: '#4c1d95',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18,
    gap: 16,
  },
  headerTop:   { flexDirection: 'row', alignItems: 'flex-start' },
  greeting:    { fontSize: 18, fontWeight: '800', color: '#fff' },
  roleBadge:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  roleText:    { fontSize: 11, color: '#a78bfa', fontWeight: '600' },
  dateText:    { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: '500' },

  // KPI strip
  kpiStrip:   { flexDirection: 'row', gap: 8 },
  kpiPill:    { flex: 1, alignItems: 'center', gap: 3 },
  kpiPillValue:{ fontSize: 16, fontWeight: '800', color: '#fff' },
  kpiPillLabel:{ fontSize: 9, color: 'rgba(255,255,255,0.55)', fontWeight: '600', textAlign: 'center' },

  // Quick actions
  quickRow: { flexDirection: 'row', gap: 10 },
  quickCard: {
    flex: 1, borderRadius: 16, padding: 14, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  quickIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { fontSize: 9, color: '#fff', fontWeight: '800' },
  quickLabel: { fontSize: 13, fontWeight: '800' },
  quickSub:   { fontSize: 10, color: '#94a3b8', fontWeight: '500' },

  // Approval banner
  approvalBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#eff6ff', borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: '#bfdbfe',
  },
  approvalIcon:  { width: 36, height: 36, borderRadius: 10, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },

  closureBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fffbeb', borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: '#fde68a',
  },
  closureIcon:  { width: 36, height: 36, borderRadius: 10, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center' },
  closureTitle: { fontSize: 13, fontWeight: '700', color: '#92400e' },
  closureSub:   { fontSize: 11, color: '#b45309', marginTop: 1 },
  approvalTitle: { fontSize: 13, fontWeight: '700', color: '#1e40af' },
  approvalSub:   { fontSize: 11, color: '#3b82f6', marginTop: 1 },

  // Sections
  section: {
    backgroundColor: '#fff', borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a', flex: 1 },
  sectionBody:  { paddingVertical: 4 },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { fontSize: 11, color: '#7c3aed', fontWeight: '700' },

  // Accident rows
  accRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingRight: 14,
    borderBottomWidth: 1, borderBottomColor: '#f8fafc', gap: 10,
  },
  accStrip: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  accTop:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accAsset: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  accSite:  { fontSize: 11, color: '#64748b' },
  accBottom:{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  accDate:  { fontSize: 10, color: '#94a3b8' },

  // Alert rows
  alertRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, paddingBottom: 12 },
  alertRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  alertDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  alertMsg:  { fontSize: 12, color: '#374151', fontWeight: '500', lineHeight: 17 },
  alertMeta: { fontSize: 11, color: '#94a3b8' },

  // Chips
  miniChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  miniChipText: { fontSize: 10, fontWeight: '700' },

  // All clear
  allClear:      { alignItems: 'center', paddingVertical: 48, gap: 10 },
  allClearTitle: { fontSize: 18, fontWeight: '800', color: '#374151' },
  allClearSub:   { fontSize: 13, color: '#94a3b8', textAlign: 'center' },
})
