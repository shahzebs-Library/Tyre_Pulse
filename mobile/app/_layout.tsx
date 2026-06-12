import 'react-native-url-polyfill/auto'
import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useFonts } from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AuthProvider } from '../contexts/AuthContext'
import { LanguageProvider } from '../contexts/LanguageContext'

SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  // Preload the icon font so glyphs (camera, person, etc.) render reliably
  // in release builds instead of showing as blank boxes on first paint.
  const [fontsLoaded, fontError] = useFonts({ ...Ionicons.font })

  // Safety net: never block app startup on font loading. Proceed after a short
  // timeout (or on error) so the app can never hang on a blank splash screen.
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 3000)
    return () => clearTimeout(id)
  }, [])

  const ready = fontsLoaded || !!fontError || timedOut

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LanguageProvider>
          <AuthProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </AuthProvider>
        </LanguageProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
