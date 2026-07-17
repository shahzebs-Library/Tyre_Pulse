/**
 * TyrePositionCard
 *
 * Compact, glanceable summary row for one tyre position. Tapping it opens the
 * focused TyreDetailModal popup where the readings are recorded. The row shows
 * the iconic condition state, key readings and a "recorded" indicator.
 */

import { memo, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { TyrePositionData } from '../lib/types'
import { CONDITION_META, SHOW_TREAD_DEPTH } from '../lib/tyreConditions'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { radius, spacing, typography, elevation, Theme } from '../lib/theme'

interface Props {
  data: TyrePositionData
  /** Opens the detail popup for this position */
  onPress: () => void
  /** Highlighted when its tyre was just tapped on the diagram */
  isHighlighted?: boolean
}

function TyrePositionCard({ data, onPress, isHighlighted = false }: Props) {
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const meta = CONDITION_META[data.condition]
  const posLabel = t(`positions.${data.position}`)

  const recorded = !!(
    data.serial_number || data.pressure_psi || data.tread_depth_mm ||
    data.notes || data.photo_uri || data.condition !== 'Good'
  )

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isRTL && styles.cardRTL,
        isHighlighted && styles.cardHighlighted,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Position badge */}
      <View style={[styles.positionBadge, { backgroundColor: meta.tint, borderColor: meta.color }]}>
        <Text style={[styles.positionCode, { color: meta.color }]}>{data.position}</Text>
      </View>

      {/* Summary */}
      <View style={styles.summary}>
        <Text style={[styles.posName, { textAlign: isRTL ? 'right' : 'left' }]} numberOfLines={1}>
          {posLabel}
        </Text>
        <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
          <View style={[styles.conditionPill, { backgroundColor: meta.tint, borderColor: meta.borderColor }]}>
            <Text style={styles.conditionEmoji}>{meta.emoji}</Text>
            <Text style={[styles.conditionText, { color: meta.color }]}>{t(meta.i18nKey)}</Text>
          </View>
          {data.pressure_psi ? <Text style={styles.metaChip}>{data.pressure_psi} PSI</Text> : null}
          {SHOW_TREAD_DEPTH && data.tread_depth_mm ? (
            <Text style={styles.metaChip}>{data.tread_depth_mm}mm</Text>
          ) : null}
          {data.photo_uri ? (
            <Ionicons
              name={data.photo_url ? 'cloud-done-outline' : 'camera'}
              size={15}
              color={data.photo_url ? theme.color.success.base : theme.color.warning.base}
            />
          ) : null}
        </View>
      </View>

      {/* Recorded indicator + chevron */}
      {recorded && (
        <View style={styles.recordedDot}>
          <Ionicons name="checkmark" size={13} color={theme.color.onPrimary} />
        </View>
      )}
      <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={theme.color.textMuted} />
    </TouchableOpacity>
  )
}

export default memo(TyrePositionCard)

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      marginBottom: spacing.sm + 2,
      paddingHorizontal: spacing.md + 2,
      paddingVertical: spacing.md,
      borderWidth: 1,
      borderColor: c.border,
      minHeight: 68,
      ...elevation(theme, 1),
    },
    cardRTL: { flexDirection: 'row-reverse' },
    cardHighlighted: {
      borderColor: c.info.base,
      borderWidth: 2,
      backgroundColor: c.info.soft,
    },
    positionBadge: {
      minWidth: 50,
      height: 48,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    positionCode: { fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
    summary: { flex: 1, gap: 5 },
    posName: { ...typography.title, color: c.text },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    metaRowRTL: { flexDirection: 'row-reverse' },
    conditionEmoji: { fontSize: 14 },
    conditionPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.sm, paddingVertical: 4,
      borderRadius: radius.sm, borderWidth: 1,
    },
    conditionText: { fontSize: 12, fontWeight: '800' },
    metaChip: {
      fontSize: 12, fontWeight: '700', color: c.textSecondary,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm - 2,
      overflow: 'hidden',
    },
    recordedDot: {
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: c.success.base, alignItems: 'center', justifyContent: 'center',
    },
  })
}
