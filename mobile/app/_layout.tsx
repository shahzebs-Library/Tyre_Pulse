import 'react-native-url-polyfill/auto'
// Import for its side effect: initialises Sentry (guarded by DSN) before the
// app renders, so early crashes are captured.
import '../lib/sentry'
import { useEffect, useRef, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useFonts } from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AuthProvider } from '../contexts/AuthContext'
import { LanguageProvider } from '../contexts/LanguageContext'
import { ThemeProvider } from '../contexts/ThemeContext'
import { ErrorBoundary } from '../components/ErrorBoundary'
import {
  setupNotificationChannels,
  addNotificationTapHandler,
} from '../lib/notifications'

SplashScreen.preventAutoHideAsync().catch(() => {})

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ ...Ionicons.font })
  const [timedOut, setTimedOut] = useState(false)
  const router = useRouter()
  const notifSubRef = useRef<any>(null)

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 3000)
    return () => clearTimeout(id)
  }, [])

  const ready = fontsLoaded || !!fontError || timedOut

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  // Set up Android notification channels once on boot.
  useEffect(() => {
    setupNotificationChannels()

    // Route notification taps to the relevant screen.
    notifSubRef.current = addNotificationTapHandler((type) => {
      if (type === 'sync_failure' || type === 'sync_success') {
        router.push('/(app)/profile')
      } else if (type === 'inspection_reminder') {
        router.push('/(app)/inspection/new')
      }
    })

    return () => notifSubRef.current?.remove()
  }, [])

  if (!ready) return null

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <LanguageProvider>
              <AuthProvider>
                <Stack screenOptions={{ headerShown: false }} />
              </AuthProvider>
            </LanguageProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  )
}

// NOTE: we deliberately do NOT use Sentry.wrap() on the expo-router root layout
// — wrapping it can detach the provider tree (AuthProvider) from the routed
// screens. Crash capture is instead provided by Sentry.init()'s global JS/native
// handlers (installed via the ../lib/sentry import above) plus the ErrorBoundary,
// which reports React render errors to Sentry itself.
export default RootLayout
