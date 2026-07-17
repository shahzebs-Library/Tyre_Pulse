/**
 * Home Screen - access-aware mission control (Daylight design system)
 *
 * Every quick action is gated by the effective access resolver
 * `useAuth().canAccess(moduleKey)` = role default + per-user grant overlay +
 * admin/super. An access change (grant / revoke) reflects on Home immediately,
 * with no re-login, because AuthContext re-pulls grants in realtime.
 *
 * Quick actions are grouped into labelled sections (Field / Fleet / Maintenance
 * / Management / Admin); a section renders only when the user can reach at least
 * one of its actions, so the hub stays tidy for every role.
 *
 * Loading strategy: offline queue from AsyncStorage (instant), then DB data in
 * parallel (skeleton while waiting). Visuals: design-system tokens
 * (light-first, sunlight-readable).
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { getQueue, getPendingCount, syncQueue } from '../../lib/offlineQueue'
import { supabase } from '../../lib/supabase'
import SyncBanner from '../../components/SyncBanner'
import { SkeletonBox, SkeletonStatRow, SkeletonList } from '../../components/SkeletonLoader'
import { isAdminOrAbove, UserRole } from '../../lib/types'
import { ModuleKey } from '../../lib/permissions'
import { Screen, StatTile, AppText } from '../../components/ui'
import { Theme, spacing, radius, typography, elevation } from '../../lib/theme'

// ── Types ─────────────────────────────────────────────────────────────────────

type TintKey = keyof Theme['tint']

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

// ── Access-aware quick actions ─────────────────────────────────────────────────
//
// One declarative registry. Each entry maps to a `ModuleKey`, so visibility is
// resolved by `canAccess(module)` (role default + grant overlay). Grouped into
// labelled sections; the grid renders sections in this order.

type SectionKey = 'Field' | 'Fleet' | 'Maintenance' | 'Management' | 'Admin'

const SECTION_ORDER: SectionKey[] = ['Field', 'Fleet', 'Maintenance', 'Management', 'Admin']

interface QuickAction {
  module: ModuleKey
  section: SectionKey
  icon: string
  label: string
  sublabel: string
  route: string
  tint: TintKey
}

// The `inspect` action is deliberately surfaced as the big primary CTA (not in
// the grid) so it is never duplicated; every other module lives in a section.
const QUICK_ACTIONS: QuickAction[] = [
  // Field ---------------------------------------------------------------------
  { module: 'scan',        section: 'Field', icon: 'scan-outline',            label: 'Scan Asset',    sublabel: 'Barcode / QR code',    route: '/(app)/scanner',            tint: 'blue'   },
  { module: 'serial',      section: 'Field', icon: 'barcode-outline',         label: 'Serial Search', sublabel: 'Find tyre by serial',  route: '/(app)/serial-search',      tint: 'blue'   },
  { module: 'tyreChange',  section: 'Field', icon: 'swap-horizontal-outline', label: 'Tyre Change',   sublabel: 'Record a change',      route: '/(app)/tyre-change',        tint: 'teal'   },
  { module: 'checklists',  section: 'Field', icon: 'checkbox-outline',        label: 'Checklists',    sublabel: 'Fill & submit checks', route: '/(app)/checklists',   tint: 'green'  },
  { module: 'meter',       section: 'Field', icon: 'speedometer-outline',     label: 'Meter Log',     sublabel: 'Daily odometer / hrs', route: '/(app)/meter-logs',         tint: 'blue'   },
  { module: 'reportIssue', section: 'Field', icon: 'megaphone-outline',       label: 'Report Issue',  sublabel: 'Flag a problem',       route: '/(app)/report-issue',       tint: 'amber'  },
  // Fleet ---------------------------------------------------------------------
  { module: 'records',     section: 'Fleet', icon: 'layers-outline',          label: 'Tyre Records',  sublabel: 'Browse all records',   route: '/(app)/records',      tint: 'violet' },
  { module: 'vehicles',    section: 'Fleet', icon: 'car-outline',             label: 'Vehicles',      sublabel: 'Fleet assets',         route: '/(app)/vehicles',           tint: 'blue'   },
  { module: 'history',     section: 'Fleet', icon: 'time-outline',            label: 'History',       sublabel: 'Recent activity',      route: '/(app)/history',            tint: 'slate'  },
  { module: 'alerts',      section: 'Fleet', icon: 'notifications-outline',   label: 'Alerts',        sublabel: 'Critical tyres',       route: '/(app)/alerts',             tint: 'red'    },
  { module: 'calendar',    section: 'Fleet', icon: 'calendar-outline',        label: 'Calendar',      sublabel: 'Scheduled work',       route: '/(app)/calendar',           tint: 'blue'   },
  // Maintenance ---------------------------------------------------------------
  { module: 'accidents',      section: 'Maintenance', icon: 'warning-outline',      label: 'Accidents',   sublabel: 'Incident overview',   route: '/(app)/accident/dashboard', tint: 'red'    },
  { module: 'reportAccident', section: 'Maintenance', icon: 'alert-circle-outline', label: 'File Accident', sublabel: 'Report an incident', route: '/(app)/accident/report',   tint: 'red'    },
  { module: 'workorders',     section: 'Maintenance', icon: 'construct-outline',    label: 'Work Orders', sublabel: 'Open actions',        route: '/(app)/workorders',   tint: 'amber'  },
  { module: 'rca',            section: 'Maintenance', icon: 'git-branch-outline',   label: 'Root Cause',  sublabel: 'RCA analysis',        route: '/(app)/rca',                tint: 'violet' },
  { module: 'tasks',          section: 'Maintenance', icon: 'list-outline',         label: 'Tasks',       sublabel: 'Corrective actions',  route: '/(app)/tasks',              tint: 'amber'  },
  { module: 'stock',          section: 'Maintenance', icon: 'cube-outline',         label: 'Stock Count', sublabel: 'Daily stock-take',    route: '/(app)/stock',              tint: 'amber'  },
  // Management ----------------------------------------------------------------
  { module: 'overview',    section: 'Management', icon: 'grid-outline',          label: 'Overview',   sublabel: 'Fleet snapshot',  route: '/(app)/overview',        tint: 'blue'   },
  { module: 'reports',     section: 'Management', icon: 'document-text-outline', label: 'Reports',    sublabel: 'Generate PDF',    route: '/(app)/reports',   tint: 'violet' },
  { module: 'analytics',   section: 'Management', icon: 'bar-chart-outline',     label: 'Analytics',  sublabel: 'Fleet KPIs',      route: '/(app)/analytics', tint: 'blue'   },
  { module: 'ai',          section: 'Management', icon: 'sparkles-outline',      label: 'Fleet AI',   sublabel: 'Ask anything',    route: '/(app)/ai',        tint: 'violet' },
  { module: 'team',        section: 'Management', icon: 'people-outline',        label: 'Team',       sublabel: 'Members',         route: '/(app)/team',            tint: 'teal'   },
  // Admin ---------------------------------------------------------------------
  { module: 'admin',       section: 'Admin', icon: 'shield-outline', label: 'Admin Console', sublabel: 'Console & settings', route: '/(app)/admin', tint: 'slate' },
]

// ── Main screen ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { profile, canAccess } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const router = useRouter()
  const s = useMemo(() => makeStyles(theme), [theme])

  const [pendingCount, setPendingCount]           = useState(0)
  const [recentInspections, setRecentInspections] = useState<InspectionItem[]>([])
  const [refreshing, setRefreshing]               = useState(false)
  const [todayCount, setTodayCount]               = useState(0)
  const [networkLoading, setNetworkLoading]       = useState(true)
  const [fleetHealth, setFleetHealth]             = useState<FleetHealth | null>(null)
  const [fleetLoading, setFleetLoading]           = useState(true)

  const role = profile?.role as UserRole | null | undefined
  const elevated = isAdminOrAbove(role)
  const firstName = profile?.full_name?.split(' ')[0] ?? t('tabs.profile')
  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('home.goodMorning') : hour < 17 ? t('home.goodAfternoon') : t('home.goodEvening')
  const today = new Date().toLocaleDateString(isRTL ? 'ar-SA' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  // Effective access drives what shows. Recomputed whenever grants/role change,
  // so a live grant / revoke reflects here without a re-login.
  const canInspectNow = canAccess('inspect')
  const canScan = canAccess('scan')
  const canHistory = canAccess('history')
  const sections = useMemo(
    () => SECTION_ORDER
      .map(key => ({ key, items: QUICK_ACTIONS.filter(a => a.section === key && canAccess(a.module)) }))
      .filter(sec => sec.items.length > 0),
    [canAccess],
  )

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
    <Screen edges={['top']}>
      <SyncBanner />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <View style={[s.header, isRTL && s.rowReverse]}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color="muted" style={{ textAlign }}>{greeting}</AppText>
            <AppText variant="h1" style={{ textAlign }}>{firstName}</AppText>
            <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>{today}</AppText>
          </View>
          {pendingCount > 0 && (
            <TouchableOpacity style={s.pendingBadge} onPress={() => router.push('/(app)/profile')} activeOpacity={0.85}>
              <Ionicons name="cloud-upload-outline" size={14} color={theme.color.warning.on} />
              <Text style={s.pendingNum}>{pendingCount}</Text>
              <Text style={s.pendingLbl}>{t('home.pending')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Stats row ─────────────────────────────────────────────────────── */}
        {networkLoading ? <SkeletonStatRow /> : (
          <View style={s.statsRow}>
            <StatTile
              icon="calendar-outline"
              value={todayCount.toString()}
              label={t('home.today')}
              tint={todayCount > 0 ? 'green' : 'slate'}
            />
            <StatTile
              icon="cloud-upload-outline"
              value={pendingCount.toString()}
              label={t('home.pendingSync')}
              tint={pendingCount > 0 ? 'amber' : 'slate'}
              onPress={pendingCount > 0 ? () => router.push('/(app)/profile') : undefined}
            />
            <StatTile
              icon="location-outline"
              value={profile?.site ? profile.site.split(' ')[0] : t('home.allSites')}
              label={t('modules.common.site')}
              tint="blue"
            />
          </View>
        )}

        {/* ── Primary CTA (inspect access only) ─────────────────────────────── */}
        {canInspectNow && (
          <TouchableOpacity style={s.ctaButton} onPress={() => router.push('/(app)/inspection/new')} activeOpacity={0.9}>
            <View style={s.ctaIcon}>
              <Ionicons name="add-circle" size={28} color={theme.color.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.ctaTitle}>{t('home.startInspection')}</Text>
              <Text style={s.ctaSubtitle}>{t('home.startSubtitle')}</Text>
            </View>
            <Ionicons name={isRTL ? 'arrow-back-circle' : 'arrow-forward-circle'} size={28} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        )}

        {/* ── Quick Actions, grouped by section (access-gated) ──────────────── */}
        {sections.map(sec => (
          <View key={sec.key}>
            <SectionLabel s={s} theme={theme}>{t(`modules.home.sections.${sec.key}`)}</SectionLabel>
            <View style={s.quickGrid}>
              {sec.items.map(a => (
                <QuickActionCard key={a.module} action={a} s={s} theme={theme} t={t} onPress={() => router.push(a.route as any)} />
              ))}
            </View>
          </View>
        ))}

        {/* ── Fleet Health (elevated roles) ─────────────────────────────────── */}
        {elevated && (
          <View>
            <SectionLabel s={s} theme={theme}>{t('modules.home.fleetHealthWeek')}</SectionLabel>
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
                  <FleetStat s={s} theme={theme} value={fleetHealth.totalVehicles} label={t('modules.home.vehicles')} icon="car-outline" tint="blue" />
                  <FleetStat s={s} theme={theme} value={fleetHealth.criticalCount} label={t('modules.home.critical')} icon="warning-outline" tint="red" alert={fleetHealth.criticalCount > 0} />
                  <FleetStat s={s} theme={theme} value={fleetHealth.openWorkOrders} label={t('modules.home.openActions')} icon="construct-outline" tint="amber" alert={fleetHealth.openWorkOrders > 0} />
                  <FleetStat s={s} theme={theme} value={fleetHealth.inspThisWeek} label={t('modules.home.inspectionsLabel')} icon="clipboard-outline" tint="green" />
                </View>
                {(fleetHealth.criticalCount > 0 || fleetHealth.openWorkOrders > 5) && (
                  <TouchableOpacity
                    style={s.fleetAlert}
                    activeOpacity={0.85}
                    onPress={() => router.push(fleetHealth.criticalCount > 0 ? '/(app)/records' : '/(app)/workorders')}
                  >
                    <Ionicons name="alert-circle-outline" size={15} color={theme.color.danger.base} />
                    <Text style={s.fleetAlertText}>
                      {fleetHealth.criticalCount > 0
                        ? `${fleetHealth.criticalCount} ${t('modules.home.criticalTyres')}`
                        : `${fleetHealth.openWorkOrders} ${t('modules.home.workOrdersReview')}`}
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={theme.color.danger.base} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── Scan shortcut (scan access only) ──────────────────────────────── */}
        {canScan && (
          <TouchableOpacity style={s.scanButton} onPress={() => router.push('/(app)/scanner')} activeOpacity={0.85}>
            <View style={s.scanIcon}>
              <Ionicons name="scan" size={22} color={theme.color.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.scanTitle}>{t('home.scanAsset')}</Text>
              <Text style={s.scanSubtitle}>{t('home.scanSubtitle')}</Text>
            </View>
            <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={theme.color.textMuted} />
          </TouchableOpacity>
        )}

        {/* ── Recent inspections (inspect access only) ──────────────────────── */}
        {canInspectNow && (
        <View>
          <View style={s.sectionHeaderRow}>
            <AppText style={[typography.label, { color: theme.color.textMuted, textTransform: 'uppercase' }]}>
              {t('home.recentInspections')}
            </AppText>
            {canHistory && (
              <TouchableOpacity onPress={() => router.push('/(app)/history')}>
                <Text style={s.sectionLink}>{t('home.viewAll')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {networkLoading ? <SkeletonList count={3} /> : recentInspections.length === 0 ? (
            <View style={s.emptyState}>
              <View style={s.emptyIcon}>
                <Ionicons name="clipboard-outline" size={34} color={theme.color.textMuted} />
              </View>
              <AppText variant="h3" center>{t('home.noInspections')}</AppText>
              <AppText variant="body" color="muted" center style={{ maxWidth: 280 }}>{t('home.noInspectionsHint')}</AppText>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {recentInspections.map(item => (
                <RecentCard key={item.id} item={item} t={t} s={s} theme={theme} />
              ))}
            </View>
          )}
        </View>
        )}
      </ScrollView>
    </Screen>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ children, s, theme }: { children: string; s: Styles; theme: Theme }) {
  return (
    <AppText style={[typography.label, s.sectionTitle, { color: theme.color.textMuted }]}>{children}</AppText>
  )
}

function QuickActionCard({ action, onPress, s, theme, t }: { action: QuickAction; onPress: () => void; s: Styles; theme: Theme; t: (k: string) => string }) {
  const tint = theme.tint[action.tint]
  const sub = t(`modules.home.qa.${action.module}.sub`)
  return (
    <TouchableOpacity style={s.qaCard} onPress={onPress} activeOpacity={0.8}>
      <View style={[s.qaIcon, { backgroundColor: tint.bg }]}>
        <Ionicons name={action.icon as any} size={22} color={tint.fg} />
      </View>
      <Text style={s.qaLabel} numberOfLines={1}>{t(`modules.home.qa.${action.module}.label`)}</Text>
      {sub ? <Text style={s.qaSublabel} numberOfLines={1}>{sub}</Text> : null}
    </TouchableOpacity>
  )
}

function FleetStat({ value, label, icon, tint, alert, s, theme }: {
  value: number; label: string; icon: string; tint: TintKey; alert?: boolean; s: Styles; theme: Theme
}) {
  const tc = theme.tint[tint]
  return (
    <View style={s.fleetStat}>
      <Ionicons name={icon as any} size={16} color={tc.fg} />
      <Text style={[s.fleetNum, { color: alert ? tc.fg : theme.color.text }]}>{value}</Text>
      <Text style={s.fleetLbl}>{label}</Text>
    </View>
  )
}

function RecentCard({ item, t, s, theme }: { item: InspectionItem; t: (k: string) => string; s: Styles; theme: Theme }) {
  const c =
    item.sync_status === 'pending' ? theme.color.warning
    : item.sync_status === 'failed' ? theme.color.danger
    : theme.color.success
  const statusLabel =
    item.sync_status === 'pending' ? t('home.pending')
    : item.sync_status === 'failed' ? t('home.failed')
    : t('home.synced')

  return (
    <View style={s.recentCard}>
      <View style={s.recentIcon}>
        <Ionicons name="document-text-outline" size={18} color={theme.color.primary} />
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
      <View style={[s.syncBadge, { backgroundColor: c.soft }]}>
        <Text style={[s.syncBadgeText, { color: c.on }]}>{statusLabel}</Text>
      </View>
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    scroll:  { flex: 1 },
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['2xl'] },

    // Header
    header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    rowReverse: { flexDirection: 'row-reverse' },
    pendingBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: c.warning.soft,
      borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8,
    },
    pendingNum: { fontSize: 16, fontWeight: '800', color: c.warning.on },
    pendingLbl: { fontSize: 11, color: c.warning.on, fontWeight: '700' },

    // Stats
    statsRow: { flexDirection: 'row', gap: spacing.md },

    // CTA
    ctaButton: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
      backgroundColor: c.primary, borderRadius: radius.xl, padding: spacing.xl,
      ...elevation(theme, 2),
    },
    ctaIcon:     { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
    ctaTitle:    { fontSize: 17, fontWeight: '800', color: c.onPrimary },
    ctaSubtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 2, fontWeight: '600' },

    // Section labels
    sectionTitle:     { textTransform: 'uppercase', marginBottom: spacing.xs },
    sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
    sectionLink:      { fontSize: 13, color: c.primaryDark, fontWeight: '800' },

    // Quick actions
    quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    qaCard: {
      flexGrow: 1, flexBasis: '30%', minWidth: 104,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md, gap: 6,
      borderWidth: 1, borderColor: c.border, minHeight: 104,
      ...elevation(theme, 1),
    },
    qaIcon:     { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    qaLabel:    { fontSize: 13.5, fontWeight: '800', color: c.text, marginTop: 2 },
    qaSublabel: { fontSize: 11, color: c.textMuted, fontWeight: '600' },

    // Fleet health
    fleetCard: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border, gap: spacing.md,
      ...elevation(theme, 1),
    },
    fleetRow:  { flexDirection: 'row', justifyContent: 'space-around' },
    fleetStat: { alignItems: 'center', gap: 4, flex: 1 },
    fleetNum:  { fontSize: 22, fontWeight: '800', color: c.text },
    fleetLbl:  { fontSize: 10.5, color: c.textMuted, fontWeight: '700', textAlign: 'center' },
    fleetAlert:{
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.danger.soft, borderRadius: radius.md, padding: spacing.md,
    },
    fleetAlertText: { flex: 1, fontSize: 12.5, color: c.danger.on, fontWeight: '700' },

    // Scan
    scanButton: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border,
      ...elevation(theme, 1),
    },
    scanIcon:     { width: 44, height: 44, borderRadius: 13, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
    scanTitle:    { fontSize: 15, fontWeight: '800', color: c.text },
    scanSubtitle: { fontSize: 12.5, color: c.textMuted, marginTop: 2, fontWeight: '600' },

    // Recent
    recentCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
      ...elevation(theme, 1),
    },
    recentIcon:  { width: 38, height: 38, borderRadius: 11, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
    recentInfo:  { flex: 1, gap: 3 },
    recentTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    recentMeta:  { fontSize: 11.5, color: c.textMuted, fontWeight: '600' },
    syncBadge:   { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
    syncBadgeText: { fontSize: 11, fontWeight: '800' },

    // Empty
    emptyState: { alignItems: 'center', paddingVertical: spacing['3xl'], gap: spacing.sm },
    emptyIcon: {
      width: 72, height: 72, borderRadius: 36, backgroundColor: c.surfaceAlt,
      alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
    },
  })
}
