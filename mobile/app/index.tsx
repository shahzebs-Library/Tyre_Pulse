import { Redirect, useRouter } from 'expo-router'
import { View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'

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
 *
 * THE SAME SCREEN NOW ALSO CATCHES A FAILED READ. A Keystore call that refuses
 * used to reach supabase-js as "there is no session", which put a signed-in
 * field worker on the login screen - and most of them do not know their own
 * username or password, so that is a person who simply cannot get back in.
 * AuthContext now tells a failed read apart from a genuinely empty one and sends
 * the failed case here, where Try again is the primary action.
 */
export default function Index() {
  const { user, loading, sessionTimedOut, retrySession } = useAuth()
  const { t } = useLanguage()
  const router = useRouter()

  // t() returns the raw key path when a translation is missing in every locale.
  // These keys are handed to whoever owns locales/*.json, so until they land the
  // fallback is what a field user reads - never "session.restoreTitle".
  const tx = (key: string, fallback: string) => {
    const value = t(key)
    return value === key ? fallback : value
  }

  if (sessionTimedOut) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{tx('session.restoreTitle', 'Taking longer than usual')}</Text>
        <Text style={styles.body}>
          {tx(
            'session.restoreBody',
            'We could not open your saved sign in on this device. You are still signed in and your work is safe. Try again, or sign in to continue.',
          )}
        </Text>
        <TouchableOpacity
          style={styles.primary}
          onPress={() => { retrySession() }}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>{tx('session.tryAgain', 'Try again')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondary}
          onPress={() => router.replace('/(auth)/login')}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>{tx('session.signIn', 'Sign in')}</Text>
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
