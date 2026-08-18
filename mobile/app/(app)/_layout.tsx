import { useEffect, useState, useCallback } from 'react'
import { Tabs, Redirect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { View, Text, StyleSheet, TouchableOpacity, DeviceEventEmitter, Linking } from 'react-native'
import { getPendingCount } from '../../lib/offlineQueue'
import { getPendingRecordCount } from '../../lib/recordQueue'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { ActivityIndicator } from 'react-native'
import { useNetworkSync } from '../../hooks/useNetworkSync'
import { useRealtime } from '../../hooks/useRealtime'
import { supabase } from '../../lib/supabase'
import { TAB_BAR } from '../../lib/permissions'
import { checkUpdateRequired } from '../../lib/appVersionGate'
import { useTheme } from '../../contexts/ThemeContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Emitted by the Home screen whenever it recounts the offline queues, so the
// tab badge updates the instant a sync finishes (must match index.tsx).
const PENDING_SYNC_EVENT = 'tyrepulse:pending-sync-changed'

// Custom tab bar icon with active background pill
function TabIcon({
  name, focused, activeTint, inactiveColor,
}: { name: string; focused: boolean; activeTint: string; inactiveColor: string }) {
  return (
    <View style={[styles.iconWrap, focused && { backgroundColor: activeTint + '22' }]}>
      <Ionicons
        name={name as any}
        size={22}
        color={focused ? activeTint : inactiveColor}
      />
    </View>
  )
}

export default function AppLayout() {
  const {
    user, loading, profile, profileLoading, profileError, retryProfile,
    signOut, canAccess,
  } = useAuth()
  const { t } = useLanguage()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const [accidentBadge, setAccidentBadge] = useState(0)
  const [homeBadge, setHomeBadge] = useState(0)
  const [updateRequired, setUpdateRequired] = useState(false)

  // Check once per app session, after sign-in. Never blocks rendering: it starts
  // false and only flips if the server explicitly reports this build too old.
  useEffect(() => {
    if (!user) return
    let alive = true
    checkUpdateRequired()
      .then((req) => { if (alive) setUpdateRequired(req) })
      .catch(() => { /* fail open - never lock a field user out over a version check */ })
    return () => { alive = false }
  }, [user])

  useNetworkSync()

  const loadBadges = useCallback(async () => {
    if (!user) return
    try {
      const cc = profile?.country
      const withC = (q: any) => cc ? q.or(`country.eq.${cc},country.is.null`) : q
      const acc = await withC(
        supabase.from('accidents').select('id', { count: 'exact', head: true }).neq('status', 'closed'),
      )
      setAccidentBadge(acc.count ?? 0)
    } catch {
      // Badge count failed - keep the last known value, never crash the shell.
    }
  }, [user, profile?.country])

  useEffect(() => { loadBadges() }, [loadBadges])
  useRealtime('accidents', loadBadges, { enabled: !!user })

  // Home tab badge = LIVE offline-queue pending count (inspections + typed
  // record commands), mirroring what the Home screen and SyncBanner count.
  // The old badge counted open corrective actions + critical tyres, which are
  // fleet-wide facts a user cannot clear, so the red dot never went away.
  const refreshPendingBadge = useCallback(async () => {
    try {
      const [insp, recs] = await Promise.all([getPendingCount(), getPendingRecordCount()])
      setHomeBadge(insp + recs)
    } catch {
      // Storage read failed - keep the last known value
    }
  }, [])

  useEffect(() => {
    refreshPendingBadge()
    // Instant update whenever the Home screen recounts (e.g. after "Sync now").
    const sub = DeviceEventEmitter.addListener(PENDING_SYNC_EVENT, (total?: number) => {
      if (typeof total === 'number') setHomeBadge(total)
      else refreshPendingBadge()
    })
    return () => sub.remove()
  }, [refreshPendingBadge])

  // While a badge is showing, poll cheaply (AsyncStorage read) so background
  // auto-syncs (useNetworkSync) clear it with no user action; stops at 0.
  const hasPendingBadge = homeBadge > 0
  useEffect(() => {
    if (!hasPendingBadge) return
    const id = setInterval(refreshPendingBadge, 5000)
    return () => clearInterval(id)
  }, [hasPendingBadge, refreshPendingBadge])

  // Finding #3: do NOT render protected routes until the profile is loaded and
  // validated. While the auth session OR the profile is still resolving, show
  // the splash - never redirect to login yet, never flash app content.
  if (loading || profileLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.color.bg }}>
        <ActivityIndicator size="large" color={theme.color.primary} />
      </View>
    )
  }

  if (!user) return <Redirect href="/(auth)/login" />

  // Minimum-version gate. An admin can require everyone onto a newer build once
  // a fix has shipped, so a tester who never updated stops reporting bugs that
  // were already fixed. Fail-open: no minimum set, or any error reading it, and
  // this is false, so the app opens exactly as before.
  if (updateRequired) return <UpdateRequiredGate onSignOut={signOut} />


  // Authenticated but the profile could not be verified (hard fetch error).
  // FAIL CLOSED: block all protected content behind a safe retry screen; a
  // Sign out escape hatch is always offered.
  if (profileError) {
    return <ProfileErrorGate onRetry={retryProfile} onSignOut={signOut} />
  }

  // Access gate - admin controls entry. A locked or not-yet-approved account
  // cannot use the app until an admin grants/restores access.
  if (profile && (profile.approved === false || profile.locked === true)) {
    return <AccessGate locked={profile.locked === true} onSignOut={signOut} />
  }

  return (
    <Tabs
      /*
       * THE BACK-NAVIGATION FIX. Read this before changing it.
       *
       * Every screen in this app is a TAB route in THIS navigator - the
       * checklist list, the checklist fill screen, History, the approval
       * queues, the admin sub-pages, all of them. There is no nested Stack.
       *
       * @react-navigation/routers TabRouter defaults `backBehavior` to
       * 'firstRoute', and its getRouteHistory() then builds a history of
       * exactly [routes[0], currentRoute]. routes[0] is `index` = HOME. So on
       * EVERY screen `router.canGoBack()` reported true and `router.back()`
       * popped straight to Home - the product owner's "it jumps to Home",
       * reported three times.
       *
       * That is also why three previous fixes were partial: each one tuned the
       * FALLBACK inside backTo(), but the fallback was never reached. canGoBack
       * was true, so backTo always took the back() branch, and back() always
       * landed on Home whatever the fallback said.
       *
       * 'history' makes the router accumulate REAL visit history (de-duplicated
       * by route key, so it stays bounded by the screen count) and GO_BACK pops
       * the screen the user actually came from. Home -> Checklists -> a
       * checklist -> Back now returns to Checklists.
       *
       * NOT 'fullHistory': it also restores route params, but it de-dupes only
       * the last entry, so an A->B->A->B loop grows the history without bound.
       * These are single-instance tab routes, so a dynamic screen already holds
       * its latest params anyway.
       *
       * DO NOT remove this prop. Without it back() is hardwired to Home and no
       * amount of per-screen fallback tuning can fix it.
       */
      backBehavior="history"
      // Re-check the pending count on every tab focus change, so returning to
      // any tab after an offline save or a sync refreshes the Home badge.
      screenListeners={{ focus: () => { refreshPendingBadge() } }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.primary,
        tabBarInactiveTintColor: theme.color.textMuted,
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: theme.color.surface,
            borderTopColor: theme.color.border,
            shadowColor: theme.color.shadow,
            // Sit ABOVE the phone's system navigation bar (gesture pill or the
            // back/home/recents buttons). A fixed height overrides React
            // Navigation's automatic safe-area inset, so add it back here.
            height: 60 + insets.bottom,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ],
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      {TAB_BAR.map(tab => {
        // Grant-aware gating: a tab tied to a module follows the effective
        // access (role default + per-user grant overlay + admin/super); tabs
        // with no moduleKey (Home, Profile) are always visible.
        const allowed = tab.moduleKey ? canAccess(tab.moduleKey) : true
        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.labelKey),
              tabBarIcon: ({ focused }) => (
                <TabIcon
                  name={focused
                    ? tab.icon.replace('-outline', '')
                    : tab.icon}
                  focused={focused}
                  activeTint={tab.activeTint ?? theme.color.primary}
                  inactiveColor={theme.color.textMuted}
                />
              ),
              tabBarActiveTintColor: tab.activeTint ?? theme.color.primary,
              tabBarBadge:
                tab.name === 'accident/dashboard' && accidentBadge > 0 ? accidentBadge
                : tab.name === 'index' && homeBadge > 0 ? homeBadge
                : undefined,
              tabBarBadgeStyle: { backgroundColor: '#dc2626', fontSize: 10, fontWeight: '700' },
              // Only PRIMARY tabs appear in the bar; secondary destinations stay
              // declared (no stray auto-tab) but are reached from the Home hub.
              href: (tab.primary && allowed) ? undefined : null,
            }}
          />
        )
      })}

      {/* Hidden routes - reachable via router.push but never in the tab bar */}
      {/* NOTE: `washing` is NOT listed here. It is declared `primary: true` in
          TAB_BAR, so the loop above already renders it as a bottom tab. A second
          declaration here used to override that back to href:null, which took the
          tab off the bar and left the screen reachable only by scrolling the Home
          hub - the reason no wash was ever logged. Never re-add a Tabs.Screen for
          a name TAB_BAR already declares; the later declaration silently wins. */}
      <Tabs.Screen name="scanner"         options={{ href: null }} />
      <Tabs.Screen name="workshop"        options={{ href: null }} />
      <Tabs.Screen name="calendar"        options={{ href: null }} />
      <Tabs.Screen name="maintenance"     options={{ href: null }} />
      <Tabs.Screen name="tasks"           options={{ href: null }} />
      <Tabs.Screen name="alerts"          options={{ href: null }} />
      <Tabs.Screen name="notifications"   options={{ href: null }} />
      <Tabs.Screen name="vehicles"        options={{ href: null }} />
      <Tabs.Screen name="team"            options={{ href: null }} />
      <Tabs.Screen name="work-orders"     options={{ href: null }} />
      <Tabs.Screen name="report-issue"    options={{ href: null }} />
      <Tabs.Screen name="tyre-change"     options={{ href: null }} />
      <Tabs.Screen name="stock"           options={{ href: null }} />
      <Tabs.Screen name="rca"             options={{ href: null }} />
      <Tabs.Screen name="overview"        options={{ href: null }} />
      <Tabs.Screen name="inspection/[id]" options={{ href: null }} />
      <Tabs.Screen name="inspection/approvals/index" options={{ href: null }} />
      <Tabs.Screen name="inspection/approvals/[id]" options={{ href: null }} />
      <Tabs.Screen name="accident/report" options={{ href: null }} />
      <Tabs.Screen name="accident/[id]"   options={{ href: null }} />
      <Tabs.Screen name="accident/case"   options={{ href: null }} />
      <Tabs.Screen name="admin/ai-chat"   options={{ href: null }} />
      <Tabs.Screen name="admin/access"    options={{ href: null }} />
      <Tabs.Screen name="admin/users"     options={{ href: null }} />
      <Tabs.Screen name="admin/approvals" options={{ href: null }} />
      <Tabs.Screen name="admin/sites"     options={{ href: null }} />
      <Tabs.Screen name="records/[id]"    options={{ href: null }} />
      <Tabs.Screen name="history"         options={{ href: null }} />
      <Tabs.Screen name="serial-search"   options={{ href: null }} />
      <Tabs.Screen name="checklists/index"                        options={{ href: null }} />
      <Tabs.Screen name="checklists/[templateId]"                 options={{ href: null }} />
      <Tabs.Screen name="checklists/history"                      options={{ href: null }} />
      <Tabs.Screen name="checklists/approvals/index"              options={{ href: null }} />
      <Tabs.Screen name="checklists/approvals/[submissionId]"     options={{ href: null }} />
    </Tabs>
  )
}

// Shown when an account is locked or not yet approved by an admin.
/**
 * Shown when an admin has set a minimum version above this build. Deliberately
 * offers no "continue anyway": the point is to stop old builds reporting bugs
 * that are already fixed, and to stop them writing data in an outdated shape.
 * Sign out stays available so a device can be handed to someone else.
 */
function UpdateRequiredGate({ onSignOut }: { onSignOut: () => void }) {
  return (
    <View style={styles.gate}>
      <View style={[styles.gateIcon, { backgroundColor: 'rgba(22,163,74,0.12)' }]}>
        <Ionicons name="arrow-up-circle-outline" size={34} color="#16a34a" />
      </View>
      <Text style={styles.gateTitle}>Update Required</Text>
      <Text style={styles.gateMsg}>
        A newer version of TyrePulse Inspector is available and this one is no
        longer supported. Open Google Play and update to continue. Any work saved
        on this device is safe and will sync after you update.
      </Text>
      <TouchableOpacity style={styles.gateBtn} onPress={() => { openPlayStore() }}>
        <Ionicons name="download-outline" size={18} color="#fff" />
        <Text style={styles.gateBtnText}>Open Google Play</Text>
      </TouchableOpacity>
      <TouchableOpacity style={{ marginTop: 14 }} onPress={onSignOut}>
        <Text style={{ color: '#64748b', fontSize: 14, fontWeight: '600' }}>Sign out</Text>
      </TouchableOpacity>
    </View>
  )
}

/** Open this app's Play Store listing; falls back to the web listing. */
function openPlayStore() {
  const id = 'com.shahzebrahman.tyrepulseinspector'
  Linking.openURL(`market://details?id=${id}`).catch(() => {
    Linking.openURL(`https://play.google.com/store/apps/details?id=${id}`).catch(() => {})
  })
}

function AccessGate({ locked, onSignOut }: { locked: boolean; onSignOut: () => void }) {
  return (
    <View style={styles.gate}>
      <View style={[styles.gateIcon, { backgroundColor: locked ? 'rgba(220,38,38,0.1)' : 'rgba(245,158,11,0.12)' }]}>
        <Ionicons name={locked ? 'lock-closed' : 'hourglass-outline'} size={34} color={locked ? '#dc2626' : '#d97706'} />
      </View>
      <Text style={styles.gateTitle}>{locked ? 'Access Revoked' : 'Awaiting Approval'}</Text>
      <Text style={styles.gateMsg}>
        {locked
          ? 'Your access has been disabled by an administrator. Please contact your admin.'
          : 'Your account is pending admin approval. You will get access once an administrator approves it.'}
      </Text>
      <TouchableOpacity style={styles.gateBtn} onPress={onSignOut}>
        <Ionicons name="log-out-outline" size={18} color="#fff" />
        <Text style={styles.gateBtnText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  )
}

// Shown when the signed-in user's profile could not be verified. Blocks all
// protected content (fail closed) and offers Retry + Sign out.
function ProfileErrorGate({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return (
    <View style={styles.gate}>
      <View style={[styles.gateIcon, { backgroundColor: 'rgba(220,38,38,0.1)' }]}>
        <Ionicons name="cloud-offline-outline" size={34} color="#dc2626" />
      </View>
      <Text style={styles.gateTitle}>Could not verify your account</Text>
      <Text style={styles.gateMsg}>
        We could not verify your account. Check your connection and retry.
      </Text>
      <TouchableOpacity style={styles.gateBtn} onPress={onRetry}>
        <Ionicons name="refresh" size={18} color="#fff" />
        <Text style={styles.gateBtnText}>Retry</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.gateBtnGhost} onPress={onSignOut}>
        <Ionicons name="log-out-outline" size={18} color="#dc2626" />
        <Text style={styles.gateBtnGhostText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  gate: { flex: 1, backgroundColor: '#f0f5f1', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  gateIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  gateTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  gateMsg: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 21 },
  gateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#16a34a', borderRadius: 14, paddingHorizontal: 22, paddingVertical: 13, marginTop: 8 },
  gateBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  gateBtnGhost: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 11 },
  gateBtnGhostText: { fontSize: 15, fontWeight: '800', color: '#dc2626' },
  tabBar: {
    backgroundColor: '#fff',
    borderTopColor: 'rgba(0,0,0,0.06)',
    borderTopWidth: 1,
    // height + paddingBottom are set dynamically from the safe-area inset in the
    // tabBarStyle override so the bar clears the system navigation bar.
    paddingTop: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 12,
  },
  tabItem: {
    paddingTop: 4,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginTop: 2,
  },
  iconWrap: {
    width: 44,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
