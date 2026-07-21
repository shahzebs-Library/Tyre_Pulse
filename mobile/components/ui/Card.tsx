/**
 * Card — themed surface with hairline border (reads under sun) + optional
 * elevation. Use `onPress` to make it a tappable card.
 */
import { ReactNode } from 'react'
import {
  View, TouchableOpacity, StyleSheet, ViewStyle,
} from 'react-native'
import { useTheme } from '../../contexts/ThemeContext'
import { elevation, radius, spacing } from '../../lib/theme'

export interface CardProps {
  children: ReactNode
  onPress?: () => void
  level?: 0 | 1 | 2 | 3
  padded?: boolean
  style?: ViewStyle
  accent?: string
}

export function Card({
  children, onPress, level = 1, padded = true, style, accent,
}: CardProps) {
  const { theme } = useTheme()
  const base: ViewStyle = {
    backgroundColor: theme.color.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...(padded ? { padding: spacing.lg } : null),
    // Logical start edge so the accent bar sits on the reading side (left in
    // LTR, right in RTL). No-op change for LTR (start == left).
    ...(accent ? { borderStartWidth: 4, borderStartColor: accent } : null),
    ...elevation(theme, level),
  }
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[base, style]}>
        {children}
      </TouchableOpacity>
    )
  }
  return <View style={[base, style]}>{children}</View>
}

export const cardStyles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' } })
