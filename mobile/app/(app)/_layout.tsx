import { Tabs, Redirect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { View, Text, StyleSheet } from 'react-native'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { ActivityIndicator } from 'react-native'
import { useNetworkSync } from '../../hooks/useNetworkSync'
import { TAB_BAR } from '../../lib/permissions'

// Custom tab bar icon with active background pill
function TabIcon({
  name, color, focused, activeTint,
}: { name: string; color: string; focused: boolean; activeTint?: string }) {
  const activeColor = activeTint ?? '#16a34a'
  return (
    <View style={[styles.iconWrap, focused && { backgroundColor: activeColor + '18' }]}>
      <Ionicons
        name={name as any}
        size={22}
        color={focused ? activeColor : '#94a3b8'}
      />
    </View>
  )
}

export default function AppLayout() {
  const { user, loading, profile } = useAuth()
  const { t } = useLanguage()

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
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      {TAB_BAR.map(tab => {
        const allowed = tab.visible(role)
        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: t(tab.labelKey),
              tabBarIcon: ({ color, focused }) => (
                <TabIcon
                  name={focused
                    ? tab.icon.replace('-outline', '')
                    : tab.icon}
                  color={color}
                  focused={focused}
                  activeTint={tab.activeTint}
                />
              ),
              tabBarActiveTintColor: tab.activeTint ?? '#16a34a',
              href: allowed ? undefined : null,
            }}
          />
        )
      })}

      {/* Hidden routes */}
      <Tabs.Screen name="scanner"         options={{ href: null }} />
      <Tabs.Screen name="tasks"           options={{ href: null }} />
      <Tabs.Screen name="alerts"          options={{ href: null }} />
      <Tabs.Screen name="vehicles"        options={{ href: null }} />
      <Tabs.Screen name="team"            options={{ href: null }} />
      <Tabs.Screen name="accident/report" options={{ href: null }} />
      <Tabs.Screen name="accident/[id]"   options={{ href: null }} />
      <Tabs.Screen name="admin/ai-chat"   options={{ href: null }} />
      <Tabs.Screen name="admin/users"     options={{ href: null }} />
    </Tabs>
  )
}

const styles = StyleSheet.create({
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
