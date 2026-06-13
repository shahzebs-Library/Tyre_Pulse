/**
 * TyrePositionCard
 *
 * Compact, glanceable summary row for one tyre position. Tapping it opens the
 * focused TyreDetailModal popup where the readings are recorded. The row shows
 * the iconic condition state, key readings and a "recorded" indicator.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { TyrePositionData } from '../lib/types'
import { CONDITION_META, SHOW_TREAD_DEPTH } from '../lib/tyreConditions'
import { useLanguage } from '../contexts/LanguageContext'

interface Props {
  data: TyrePositionData
  /** Opens the detail popup for this position */
  onPress: () => void
  /** Highlighted when its tyre was just tapped on the diagram */
  isHighlighted?: boolean
}

export default function TyrePositionCard({ data, onPress, isHighlighted = false }: Props) {
  const { t, isRTL } = useLanguage()
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
          <View style={styles.conditionPill}>
            <Ionicons name={meta.icon as any} size={14} color={meta.color} />
            <Text style={[styles.conditionText, { color: meta.color }]}>{t(meta.i18nKey)}</Text>
          </View>
          {data.pressure_psi ? <Text style={styles.metaChip}>{data.pressure_psi} PSI</Text> : null}
          {SHOW_TREAD_DEPTH && data.tread_depth_mm ? (
            <Text style={styles.metaChip}>{data.tread_depth_mm}mm</Text>
          ) : null}
          {data.photo_uri ? (
            <Ionicons
              name={data.photo_url ? 'cloud-done-outline' : 'camera'}
              size={14}
              color={data.photo_url ? '#16a34a' : '#f59e0b'}
            />
          ) : null}
        </View>
      </View>

      {/* Recorded indicator + chevron */}
      {recorded && (
        <View style={styles.recordedDot}>
          <Ionicons name="checkmark" size={12} color="#fff" />
        </View>
      )}
      <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color="#cbd5e1" />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardRTL: { flexDirection: 'row-reverse' },
  cardHighlighted: {
    borderColor: '#3b82f6',
    borderWidth: 2,
    shadowColor: '#3b82f6',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  positionBadge: {
    minWidth: 48,
    height: 44,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionCode: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  summary: { flex: 1, gap: 4 },
  posName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaRowRTL: { flexDirection: 'row-reverse' },
  conditionPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  conditionText: { fontSize: 13, fontWeight: '700' },
  metaChip: {
    fontSize: 12, color: '#64748b',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
  },
  recordedDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center',
  },
})
