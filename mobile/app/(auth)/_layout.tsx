import { Stack, Redirect } from 'expo-router'
import { View, ActivityIndicator } from 'react-native'
import { useAuth } from '../../contexts/AuthContext'

export default function AuthLayout() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f5f1' }}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    )
  }

  // Reactively leave the auth stack the moment the user is authenticated,
  // instead of waiting for an unrelated re-render to re-evaluate routing.
  if (user) return <Redirect href="/(app)" />

  return <Stack screenOptions={{ headerShown: false }} />
}
