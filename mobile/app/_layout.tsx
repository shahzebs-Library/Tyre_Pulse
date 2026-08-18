import 'react-native-url-polyfill/auto'
// Import for its side effect: initialises Sentry (guarded by DSN) before the
// app renders, so early crashes are captured.
import '../lib/sentry'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  consumePendingNotificationTap,
} from '../lib/notifications'
import { notificationRoute } from '../lib/notificationsInbox'

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
  // A tap can arrive before the <Stack> is mounted (cold start, fonts still
  // loading). Navigating then throws "Attempted to navigate before mounting the
  // Root Layout", so the target is parked here and flushed once we render.
  const navReadyRef = useRef(false)
  const queuedRouteRef = useRef<string | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 3000)
    return () => clearTimeout(id)
  }, [])

  const ready = fontsLoaded || !!fontError || timedOut

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  /** Navigate to a tapped notification's screen, deferring until the router is
   *  mounted. A blank or unknown target STAYS PUT rather than pushing nowhere -
   *  pushing an href with no route is what renders the raw "Unmatched Route"
   *  screen instead of the app. */
  const openRoute = useCallback((route: string | null) => {
    if (typeof route !== 'string' || !route.trim()) return
    if (!navReadyRef.current) {
      queuedRouteRef.current = route
      return
    }
    try {
      router.push(route as never)
    } catch {
      // A tap must never be able to crash the app on launch.
    }
  }, [router])

  // Set up Android notification channels once on boot, and wire notification
  // taps to a screen.
  useEffect(() => {
    setupNotificationChannels()

    /**
     * ONE mapping for every tap: `notificationRoute` is the same function the
     * in-app notifications list uses. This handler used to carry its own copy
     * covering exactly three local types, so every SERVER push - approval
     * requested, job assigned, parts request, QC failed, upload gap, accident -
     * did nothing at all when tapped. Two copies of a routing rule drift; there
     * is now one.
     */
    const onTap = (type: string, data: Record<string, any> = {}) => {
      openRoute(notificationRoute({
        type: type || (data.type as string) || null,
        entity_type: (data.entity_type as string) ?? (data.entityType as string) ?? null,
      }))
    }

    // COLD START: a tap that launched the app is stored natively before any
    // listener exists, so the live listener alone never sees it and the app
    // just opened on Home. Read it first, then listen for warm taps.
    const pending = consumePendingNotificationTap()
    if (pending) onTap(pending.type, pending.data)

    notifSubRef.current = addNotificationTapHandler(onTap)

    return () => notifSubRef.current?.remove()
  }, [openRoute])

  // Flush a tap that arrived before the navigator existed.
  useEffect(() => {
    if (!ready) return
    navReadyRef.current = true
    const queued = queuedRouteRef.current
    queuedRouteRef.current = null
    if (queued) openRoute(queued)
  }, [ready, openRoute])

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
