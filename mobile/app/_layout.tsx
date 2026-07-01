import 'react-native-url-polyfill/auto'
import { useEffect, useRef, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useFonts } from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AuthProvider } from '../contexts/AuthContext'
import { LanguageProvider } from '../contexts/LanguageContext'
import { ErrorBoundary } from '../components/ErrorBoundary'
import {
  setupNotificationChannels,
  addNotificationTapHandler,
} from '../lib/notifications'

SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
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
          <LanguageProvider>
            <AuthProvider>
              <Stack screenOptions={{ headerShown: false }} />
            </AuthProvider>
          </LanguageProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  )
}
