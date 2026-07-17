/**
 * StatTile — KPI number card. Big legible value, icon chip, optional trend.
 * Built for at-a-glance reading in the sun (large bold value, strong contrast).
 */
import { memo } from 'react'
import { View, StyleSheet, ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../contexts/ThemeContext'
import { elevation, radius, spacing, typography } from '../../lib/theme'
import { AppText } from './Text'

type IconName = React.ComponentProps<typeof Ionicons>['name']

export interface StatTileProps {
  label: string
  value: string | number
  icon?: IconName
  tint?: keyof ReturnType<typeof useTheme>['theme']['tint']
  onPress?: () => void
  sublabel?: string
  style?: ViewStyle
}

export const StatTile = memo(function StatTile({ label, value, icon, tint = 'green', onPress, sublabel, style }: StatTileProps) {
  const { theme } = useTheme()
  const t = theme.tint[tint]
  const Wrapper: any = onPress ? require('react-native').TouchableOpacity : View
  return (
    <Wrapper
      activeOpacity={0.85}
      onPress={onPress}
      style={[
        styles.tile,
        {
          backgroundColor: theme.color.surface,
          borderColor: theme.color.border,
          ...elevation(theme, 1),
        },
        style,
      ]}
    >
      {icon ? (
        <View style={[styles.iconChip, { backgroundColor: t.bg }]}>
          <Ionicons name={icon} size={18} color={t.fg} />
        </View>
      ) : null}
      <AppText style={[typography.h1, { color: theme.color.text }]} numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="caption" color="secondary" numberOfLines={1}>{label}</AppText>
      {sublabel ? <AppText variant="micro" color="muted" numberOfLines={1}>{sublabel}</AppText> : null}
    </Wrapper>
  )
})

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: 2,
  },
  iconChip: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
})
