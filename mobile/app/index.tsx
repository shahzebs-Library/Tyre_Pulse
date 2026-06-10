import { Redirect } from 'expo-router'
import { View, ActivityIndicator } from 'react-native'
import { useAuth } from '../contexts/AuthContext'

export default function Index() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f5f1' }}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    )
  }

  return user ? <Redirect href="/(app)" /> : <Redirect href="/(auth)/login" />
}
