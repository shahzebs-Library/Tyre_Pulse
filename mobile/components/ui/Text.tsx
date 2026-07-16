/**
 * AppText — typography-scale Text bound to the theme.
 *
 * <AppText variant="h2">Title</AppText>
 * <AppText variant="body" color="secondary">meta</AppText>
 */
import { Text, TextProps, StyleSheet } from 'react-native'
import { useTheme } from '../../contexts/ThemeContext'
import { typography } from '../../lib/theme'

type Variant = keyof typeof typography
type ColorKey = 'text' | 'secondary' | 'muted' | 'inverse' | 'primary' | 'danger' | 'success' | 'warning' | 'info'

export interface AppTextProps extends TextProps {
  variant?: Variant
  color?: ColorKey
  center?: boolean
}

export function AppText({
  variant = 'body', color = 'text', center, style, ...rest
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

  return (
    <Text
      {...rest}
      style={[
        typography[variant],
        { color: colorValue },
        center && styles.center,
        style,
      ]}
    />
  )
}

const styles = StyleSheet.create({ center: { textAlign: 'center' } })
