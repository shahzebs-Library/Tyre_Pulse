import { Redirect, useRouter } from 'expo-router'
import { View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useAuth } from '../contexts/AuthContext'

/**
 * App entry. Decides between the app and the login screen once the stored
 * session has been read back.
 *
 * WHY THERE IS A THIRD STATE: reading the session out of the Android Keystore
 * can stall on low-end hardware (Google's own ANR for this build reports a slow
 * binder call blocking the main thread). Previously this screen rendered a
 * spinner with no time limit and no exit - the reported "tap the icon and it
 * just keeps rounding", permanently. AuthContext now bounds that wait; when it
 * is exceeded we show a plain, recoverable screen instead of spinning forever.
 */
export default function Index() {
  const { user, loading, sessionTimedOut, retrySession } = useAuth()
  const router = useRouter()

  if (sessionTimedOut) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Taking longer than usual</Text>
        <Text style={styles.body}>
          We could not finish opening your saved sign-in on this device. Your
          work is safe. Try again, or sign in to continue.
        </Text>
        <TouchableOpacity
          style={styles.primary}
          onPress={() => { retrySession() }}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondary}
          onPress={() => router.replace('/(auth)/login')}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Sign in</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (loading) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator size="large" color="#16a34a" />
      </View>
    )
  }

  return user ? <Redirect href="/(app)" /> : <Redirect href="/(auth)/login" />
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f5f1',
    paddingHorizontal: 28,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#475569',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 26,
  },
  primary: {
    backgroundColor: '#16a34a',
    paddingVertical: 15,
    paddingHorizontal: 34,
    borderRadius: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  secondary: { marginTop: 14, paddingVertical: 12, paddingHorizontal: 24 },
  secondaryText: { color: '#16a34a', fontSize: 15, fontWeight: '600' },
})
