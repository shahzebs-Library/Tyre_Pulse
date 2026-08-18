/**
 * BackButton - the shared, RTL-aware header back control.
 *
 * Every pushed screen gets one, and it can NEVER be a dead press: it delegates
 * to `useGoBack`, which pops history when there is history and otherwise
 * replaces to the screen's real parent (default: the Home hub). A bare
 * `router.back()` silently does nothing after a deep link, a notification tap
 * or a `router.replace`, which is the defect this component exists to remove.
 *
 * Style matches the existing headers across the app (40x40 surface tile with a
 * hairline border), so dropping it into a screen looks native to that screen.
 *
 *   <BackButton />                        // -> back, else /(app)
 *   <BackButton fallback="/(app)/admin" />// -> back, else the admin hub
 */
import { StyleSheet, TouchableOpacity, ViewStyle, StyleProp } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useGoBack } from '../../hooks/useGoBack'
import { APP_HOME } from '../../lib/goBack'
import { radius, elevation } from '../../lib/theme'

export interface BackButtonProps {
  /** Where to land when there is no history to pop. Default: the Home hub. */
  fallback?: string
  /** Icon tint override (e.g. a red accident header). Default: theme text. */
  color?: string
  /** Render the glyph alone, with no tile background / border. */
  plain?: boolean
  size?: number
  style?: StyleProp<ViewStyle>
}

export function BackButton({
  fallback = APP_HOME, color, plain, size = 22, style,
}: BackButtonProps) {
  const { theme } = useTheme()
  const { t, isRTL } = useLanguage()
  const goBack = useGoBack(fallback)

  return (
    <TouchableOpacity
      onPress={goBack}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={[
        styles.btn,
        !plain && {
          backgroundColor: theme.color.surface,
          borderWidth: 1,
          borderColor: theme.color.border,
          ...elevation(theme, 1),
        },
        style,
      ]}
    >
      {/* RTL flips the direction of travel, so the arrow must flip with it. */}
      <Ionicons
        name={isRTL ? 'arrow-forward' : 'arrow-back'}
        size={size}
        color={color ?? theme.color.text}
      />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
