import { Tabs, Redirect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { View, ActivityIndicator } from 'react-native'
import { isAdminOrAbove } from '../../lib/types'
import { useNetworkSync } from '../../hooks/useNetworkSync'

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

  const elevated = isAdminOrAbove(profile?.role ?? null)

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
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="inspection/new"
        options={{
          title: t('tabs.inspect'),
          tabBarIcon: ({ color, size }) => <Ionicons name="clipboard-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="accident/dashboard"
        options={{
          title: t('tabs.accident'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name="warning-outline" size={size} color={focused ? '#dc2626' : color} />
          ),
          tabBarActiveTintColor: '#dc2626',
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('tabs.history'),
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
        }}
      />
      {/* Admin tab — visible only to Admin / Manager / Director */}
      <Tabs.Screen
        name="admin/index"
        options={{
          title: 'Admin',
          tabBarActiveTintColor: '#7c3aed',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name="shield-outline" size={size} color={focused ? '#7c3aed' : color} />
          ),
          // Hide entirely for non-elevated roles without removing the route
          tabBarButton: elevated ? undefined : () => null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
      {/* Hidden routes — accessible via router.push but not in tab bar */}
      <Tabs.Screen name="scanner"           options={{ href: null }} />
      <Tabs.Screen name="accident/report"   options={{ href: null }} />
      <Tabs.Screen name="accident/[id]"     options={{ href: null }} />
      <Tabs.Screen name="admin/ai-chat"     options={{ href: null }} />
      <Tabs.Screen name="admin/users"       options={{ href: null }} />
    </Tabs>
  )
}
