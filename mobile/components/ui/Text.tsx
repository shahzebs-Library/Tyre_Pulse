/**
 * AppText - typography-scale Text bound to the theme.
 *
 * <AppText variant="h2">Title</AppText>
 * <AppText variant="body" color="secondary">meta</AppText>
 */
import { Text, TextProps, TextStyle, StyleSheet, I18nManager } from 'react-native'
import { useTheme } from '../../contexts/ThemeContext'
import { typography } from '../../lib/theme'
import { textStart, textEnd } from '../../lib/rtl'

type Variant = keyof typeof typography
type ColorKey = 'text' | 'secondary' | 'muted' | 'inverse' | 'primary' | 'danger' | 'success' | 'warning' | 'info'
/** Reading-direction aware alignment: 'start'/'end' flip under RTL. */
type Align = 'start' | 'center' | 'end'

export interface AppTextProps extends TextProps {
  variant?: Variant
  color?: ColorKey
  center?: boolean
  /**
   * Reading-direction alignment. 'start' = left in LTR / right in RTL.
   * Additive and opt-in: when omitted, alignment is unchanged (natural), so
   * existing LTR screens are visually identical.
   */
  align?: Align
}

export function AppText({
  variant = 'body', color = 'text', center, align, style, ...rest
}: AppTextProps) {
  const { theme } = useTheme()
  const c = theme.color
  const colorValue =
    color === 'secondary' ? c.textSecondary
    : color === 'muted' ? c.textMuted
    : color === 'inverse' ? c.textInverse
    : color === 'primary' ? c.primaryDark
    : color === 'danger' ? c.danger.base
    : color === 'success' ? c.success.base
    : color === 'warning' ? c.warning.base
    : color === 'info' ? c.info.base
    : c.text

  const isRTL = I18nManager.isRTL
  const alignStyle: TextStyle | null =
    align === 'center' ? styles.center
    : align === 'start' ? { textAlign: textStart(isRTL) }
    : align === 'end' ? { textAlign: textEnd(isRTL) }
    : null

  return (
    <Text
      {...rest}
      style={[
        typography[variant],
        { color: colorValue },
        center && styles.center,
        alignStyle,
        style,
      ]}
    />
  )
}

const styles = StyleSheet.create({ center: { textAlign: 'center' } })
