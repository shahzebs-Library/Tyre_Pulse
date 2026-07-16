/**
 * Shared building blocks: SectionHeader, EmptyState, ErrorState, Loading.
 * Honest states (no fabricated data) with clear calls to action.
 */
import { View, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../contexts/ThemeContext'
import { spacing, typography } from '../../lib/theme'
import { AppText } from './Text'
import { Button } from './Button'

type IconName = React.ComponentProps<typeof Ionicons>['name']

// ── SectionHeader ────────────────────────────────────────────────────────────
export function SectionHeader({
  title, action, onAction, style,
}: { title: string; action?: string; onAction?: () => void; style?: ViewStyle }) {
  const { theme } = useTheme()
  return (
    <View style={[styles.section, style]}>
      <AppText style={[typography.label, { color: theme.color.textMuted, textTransform: 'uppercase' }]}>
        {title}
      </AppText>
      {action && onAction ? (
        <AppText onPress={onAction} style={[typography.label, { color: theme.color.primaryDark }]}>
          {action}
        </AppText>
      ) : null}
    </View>
  )
}

// ── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({
  icon = 'file-tray-outline', title, message, actionLabel, onAction,
}: {
  icon?: IconName; title: string; message?: string; actionLabel?: string; onAction?: () => void
}) {
  const { theme } = useTheme()
  return (
    <View style={styles.center}>
      <View style={[styles.bigIcon, { backgroundColor: theme.color.surfaceAlt }]}>
        <Ionicons name={icon} size={34} color={theme.color.textMuted} />
      </View>
      <AppText variant="h3" center>{title}</AppText>
      {message ? <AppText variant="body" color="muted" center style={styles.msg}>{message}</AppText> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  )
}

// ── ErrorState ───────────────────────────────────────────────────────────────
export function ErrorState({
  message = 'Something went wrong.', onRetry,
}: { message?: string; onRetry?: () => void }) {
  const { theme } = useTheme()
  return (
    <View style={styles.center}>
      <View style={[styles.bigIcon, { backgroundColor: theme.color.danger.soft }]}>
        <Ionicons name="alert-circle-outline" size={34} color={theme.color.danger.base} />
      </View>
      <AppText variant="h3" center>Couldn't load</AppText>
      <AppText variant="body" color="muted" center style={styles.msg}>{message}</AppText>
      {onRetry ? <Button label="Retry" icon="refresh" variant="secondary" onPress={onRetry} style={styles.action} /> : null}
    </View>
  )
}

// ── Loading ──────────────────────────────────────────────────────────────────
export function Loading({ label }: { label?: string }) {
  const { theme } = useTheme()
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.color.primary} />
      {label ? <AppText variant="body" color="muted" style={{ marginTop: spacing.md }}>{label}</AppText> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.xl, marginBottom: spacing.md,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['3xl'], minHeight: 220 },
  bigIcon: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  msg: { marginTop: spacing.xs, maxWidth: 300 },
  action: { marginTop: spacing.xl, minWidth: 180 },
})
