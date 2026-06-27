import { Tabs, Redirect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { View, ActivityIndicator } from 'react-native'
import { useNetworkSync } from '../../hooks/useNetworkSync'
import { TAB_BAR } from '../../lib/permissions'

export default function AppLayout() {
  const { user, loading, profile } = useAuth()
  const { t } = useLanguage()

  // Auto-sync the offline inspection queue whenever network connectivity returns
  useNetworkSync()

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f5f1' }}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    )
  }

  if (!user) return <Redirect href="/(auth)/login" />

  const role = profile?.role ?? null

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#16a34a',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: 'rgba(0,0,0,0.08)',
          borderTopWidth: 1,
          paddingBottom: 4,
          height: 62,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: -2,
        },
      }}
    >
      {/* Tab bar is rendered from the RBAC descriptor — navigation auto-adjusts
          to the signed-in user's role. Routes the role cannot access are kept
          registered but hidden (href:null) so deep-links still resolve safely. */}
      {TAB_BAR.map(tab => {
        const allowed = tab.visible(role)
        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.labelKey),
              ...(tab.activeTint ? { tabBarActiveTintColor: tab.activeTint } : {}),
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={tab.icon as any}
                  size={size}
                  color={focused && tab.activeTint ? tab.activeTint : color}
                />
              ),
              // Hide the tab entirely for roles that lack access, without
              // unmounting the route (deep-links / programmatic nav still work).
              href: allowed ? undefined : null,
            }}
          />
        )
      })}

      {/* Hidden routes — reachable via router.push but never in the tab bar */}
      <Tabs.Screen name="scanner"            options={{ href: null }} />
      <Tabs.Screen name="accident/report"    options={{ href: null }} />
      <Tabs.Screen name="accident/[id]"      options={{ href: null }} />
      <Tabs.Screen name="admin/ai-chat"      options={{ href: null }} />
      <Tabs.Screen name="admin/users"        options={{ href: null }} />
      <Tabs.Screen name="records/[id]"       options={{ href: null }} />
    </Tabs>
  )
}
