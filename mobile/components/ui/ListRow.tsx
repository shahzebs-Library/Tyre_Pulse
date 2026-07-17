/**
 * ListRow — tappable row: leading icon chip, title + subtitle, optional right
 * accessory (badge / chevron / value). Large touch target.
 */
import { memo, ReactNode } from 'react'
import { View, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../contexts/ThemeContext'
import { HIT, radius, spacing, typography } from '../../lib/theme'
import { AppText } from './Text'

type IconName = React.ComponentProps<typeof Ionicons>['name']

export interface ListRowProps {
  title: string
  subtitle?: string
  icon?: IconName
  tint?: keyof ReturnType<typeof useTheme>['theme']['tint']
  onPress?: () => void
  right?: ReactNode
  chevron?: boolean
  style?: ViewStyle
}

export const ListRow = memo(function ListRow({
  title, subtitle, icon, tint = 'slate', onPress, right, chevron = true, style,
}: ListRowProps) {
  const { theme } = useTheme()
  const t = theme.tint[tint]
  const Wrapper: any = onPress ? TouchableOpacity : View
  return (
    <Wrapper
      activeOpacity={0.8}
      onPress={onPress}
      style={[styles.row, { backgroundColor: theme.color.surface, borderColor: theme.color.border }, style]}
    >
      {icon ? (
        <View style={[styles.iconChip, { backgroundColor: t.bg }]}>
          <Ionicons name={icon} size={19} color={t.fg} />
        </View>
      ) : null}
      <View style={styles.textCol}>
        <AppText style={typography.title} numberOfLines={1}>{title}</AppText>
        {subtitle ? <AppText variant="caption" color="muted" numberOfLines={1}>{subtitle}</AppText> : null}
      </View>
      {right}
      {chevron && onPress ? (
        <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
      ) : null}
    </Wrapper>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HIT + 8,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderRadius: radius.xl,
  },
  iconChip: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  textCol: { flex: 1, minWidth: 0 },
})
