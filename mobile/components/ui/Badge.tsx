/**
 * Badge / Pill — soft status chip, high-contrast text for sun readability.
 * <Badge kind="critical">Critical</Badge>
 */
import { View, StyleSheet, ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../contexts/ThemeContext'
import { radius, typography } from '../../lib/theme'
import { StatusKind, statusColor } from '../../lib/theme'
import { AppText } from './Text'

type IconName = React.ComponentProps<typeof Ionicons>['name']

export interface BadgeProps {
  children: string
  kind?: StatusKind
  icon?: IconName
  solid?: boolean
  style?: ViewStyle
}

export function Badge({ children, kind = 'neutral', icon, solid, style }: BadgeProps) {
  const { theme } = useTheme()
  const sc = statusColor(theme, kind)
  const bg = solid ? sc.base : sc.soft
  const fg = solid ? '#FFFFFF' : sc.on
  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} style={styles.icon} /> : null}
      <AppText style={[typography.micro, { color: fg }]}>{children}</AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  icon: { marginRight: 4 },
})
