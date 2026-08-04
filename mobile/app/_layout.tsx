import 'react-native-url-polyfill/auto'
// Import for its side effect: initialises Sentry (guarded by DSN) before the
// app renders, so early crashes are captured.
import '../lib/sentry'
import { useEffect, useRef, useState } from 'react'
import { Stack, useRouter, usePathname } from 'expo-router'
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

/**
 * Error boundary scoped to the current route. Re-keying on the pathname means a
 * screen that throws is contained to itself and recovers the moment the user
 * navigates somewhere else, instead of leaving the whole app on an error screen
 * whose Reset button just re-runs the same crash.
 *
 * It must sit INSIDE the providers: keying anything that wraps AuthProvider
 * would remount the session on every navigation and re-fetch the profile each
 * time a user changes screen.
 */
function ScreenBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
}

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
                {/* SCREEN-LEVEL BOUNDARY - this is what makes a crash survivable.
                    The outer boundary catches everything, but it sits ABOVE the
                    providers, so once it trips the whole app is the error screen
                    and its Reset re-renders the very screen that just threw -
                    straight back into the same crash. That is a real stuck state,
                    and Play Console shows it happening: a JavascriptException on
                    build 34 that takes the app down.
                    Keying an inner boundary on the route means a crash is scoped
                    to the screen that caused it, and simply navigating elsewhere
                    clears it - the providers, the session and any queued field
                    work all stay mounted. The web app carries the identical fix
                    for the identical reason (see PROJECT_MEMORY). */}
                <ScreenBoundary>
                  <Stack screenOptions={{ headerShown: false }} />
                </ScreenBoundary>
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
