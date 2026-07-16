/**
 * Button — themed, large touch target (min 48pt), sunlight-legible.
 * Variants: primary (filled green), secondary (surface + border), danger,
 * ghost (text only). Optional leading Ionicon. Loading + disabled states.
 */
import { ActivityIndicator, TouchableOpacity, StyleSheet, ViewStyle, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../contexts/ThemeContext'
import { HIT, radius, spacing, typography } from '../../lib/theme'
import { AppText } from './Text'

type IconName = React.ComponentProps<typeof Ionicons>['name']
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'md' | 'lg' | 'sm'

export interface ButtonProps {
  label: string
  onPress?: () => void
  variant?: Variant
  size?: Size
  icon?: IconName
  loading?: boolean
  disabled?: boolean
  full?: boolean
  style?: ViewStyle
}

export function Button({
  label, onPress, variant = 'primary', size = 'md', icon,
  loading, disabled, full, style,
}: ButtonProps) {
  const { theme } = useTheme()
  const c = theme.color
  const isFilled = variant === 'primary' || variant === 'danger'
  const bg =
    variant === 'primary' ? c.primary
    : variant === 'danger' ? c.danger.base
    : variant === 'secondary' ? c.surface
    : 'transparent'
  const fg = isFilled ? c.onPrimary : c.text
  const height = size === 'lg' ? 56 : size === 'sm' ? 40 : HIT
  const off = disabled || loading

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={off ? undefined : onPress}
      disabled={off}
      style={[
        styles.base,
        {
          backgroundColor: bg,
          height,
          borderRadius: radius.md,
          borderWidth: variant === 'secondary' ? 1.5 : 0,
          borderColor: c.borderStrong,
          opacity: off ? 0.55 : 1,
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.xl,
        },
        full && styles.full,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 19} color={fg} /> : null}
          <AppText
            style={[
              size === 'sm' ? typography.label : typography.bodyStrong,
              { color: fg },
            ]}
          >
            {label}
          </AppText>
        </View>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  full: { alignSelf: 'stretch' },
})
