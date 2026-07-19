/**
 * Screen — themed safe-area page wrapper with matching status bar.
 * Wrap every screen so background + status bar follow the active theme.
 */
import { ReactNode } from 'react'
import { View, StyleSheet, ViewStyle, StatusBar } from 'react-native'
import { SafeAreaView, Edge } from 'react-native-safe-area-context'
import { useTheme } from '../../contexts/ThemeContext'

export interface ScreenProps {
  children: ReactNode
  /** Which edges get safe-area padding. Default top+bottom (tabs handle bottom visually, but keep for stacks). */
  edges?: Edge[]
  /** Background override (else theme canvas). */
  background?: string
  style?: ViewStyle
  padded?: boolean
}

export function Screen({
  children, edges = ['top'], background, style, padded,
}: ScreenProps) {
  const { theme } = useTheme()
  const bg = background ?? theme.color.bg
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
      />
      <View style={[styles.body, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  padded: { paddingHorizontal: 16 },
})
