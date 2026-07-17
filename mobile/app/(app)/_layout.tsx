import { useEffect, useState, useCallback } from 'react'
import { Tabs, Redirect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { ActivityIndicator } from 'react-native'
import { useNetworkSync } from '../../hooks/useNetworkSync'
import { useRealtime } from '../../hooks/useRealtime'
import { supabase } from '../../lib/supabase'
import { TAB_BAR } from '../../lib/permissions'
import { useTheme } from '../../contexts/ThemeContext'

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
  const { user, loading, profile, signOut, canAccess } = useAuth()
  const { t } = useLanguage()
  const { theme } = useTheme()
  const [accidentBadge, setAccidentBadge] = useState(0)
  const [homeBadge, setHomeBadge] = useState(0)

  useNetworkSync()

  const loadBadges = useCallback(async () => {
    if (!user) return
    const cc = profile?.country
    const withC = (q: any) => cc ? q.or(`country.eq.${cc},country.is.null`) : q
    const [acc, task, alert] = await Promise.all([
      withC(supabase.from('accidents').select('id', { count: 'exact', head: true }).neq('status', 'closed')),
      withC(supabase.from('corrective_actions').select('id', { count: 'exact', head: true }).neq('status', 'Closed')),
      withC(supabase.from('tyre_records').select('id', { count: 'exact', head: true }).eq('risk_level', 'Critical')),
    ])
    setAccidentBadge(acc.count ?? 0)
    setHomeBadge((task.count ?? 0) + (alert.count ?? 0))
  }, [user, profile?.country])

  useEffect(() => { loadBadges() }, [loadBadges])
  useRealtime('accidents', loadBadges, { enabled: !!user })
  useRealtime('corrective_actions', loadBadges, { enabled: !!user })

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.color.bg }}>
        <ActivityIndicator size="large" color={theme.color.primary} />
      </View>
    )
  }

  if (!user) return <Redirect href="/(auth)/login" />

  // Access gate - admin controls entry. A locked or not-yet-approved account
  // cannot use the app until an admin grants/restores access.
  if (profile && (profile.approved === false || profile.locked === true)) {
    return <AccessGate locked={profile.locked === true} onSignOut={signOut} />
  }

  return (
    <Tabs
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
      <Tabs.Screen name="scanner"         options={{ href: null }} />
      <Tabs.Screen name="calendar"        options={{ href: null }} />
      <Tabs.Screen name="tasks"           options={{ href: null }} />
      <Tabs.Screen name="alerts"          options={{ href: null }} />
      <Tabs.Screen name="vehicles"        options={{ href: null }} />
      <Tabs.Screen name="team"            options={{ href: null }} />
      <Tabs.Screen name="work-orders"     options={{ href: null }} />
      <Tabs.Screen name="report-issue"    options={{ href: null }} />
      <Tabs.Screen name="tyre-change"     options={{ href: null }} />
      <Tabs.Screen name="stock"           options={{ href: null }} />
      <Tabs.Screen name="rca"             options={{ href: null }} />
      <Tabs.Screen name="overview"        options={{ href: null }} />
      <Tabs.Screen name="inspection/[id]" options={{ href: null }} />
      <Tabs.Screen name="accident/report" options={{ href: null }} />
      <Tabs.Screen name="accident/[id]"   options={{ href: null }} />
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
      <Tabs.Screen name="checklists/approvals/index"              options={{ href: null }} />
      <Tabs.Screen name="checklists/approvals/[submissionId]"     options={{ href: null }} />
    </Tabs>
  )
}

// Shown when an account is locked or not yet approved by an admin.
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

const styles = StyleSheet.create({
  gate: { flex: 1, backgroundColor: '#f0f5f1', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  gateIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  gateTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  gateMsg: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 21 },
  gateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#16a34a', borderRadius: 14, paddingHorizontal: 22, paddingVertical: 13, marginTop: 8 },
  gateBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  tabBar: {
    backgroundColor: '#fff',
    borderTopColor: 'rgba(0,0,0,0.06)',
    borderTopWidth: 1,
    height: 72,
    paddingBottom: 8,
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
