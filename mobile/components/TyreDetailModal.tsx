/**
 * TyreDetailModal
 *
 * Focused popup for a single tyre position. Opened by tapping a tyre on the
 * vehicle diagram or a row in the position list - it shows only that tyre's
 * information and editable fields, with a clear iconic condition header.
 */

import { useMemo } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, Pressable,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TyrePositionData } from '../lib/types'
import { CONDITION_META } from '../lib/tyreConditions'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { radius, spacing, typography, elevation, Theme } from '../lib/theme'
import { Button } from './ui'
import TyreEditor from './TyreEditor'

interface Props {
  visible: boolean
  position: string | null
  data: TyrePositionData | null
  onChange: (updated: TyrePositionData) => void
  onClose: () => void
}

export default function TyreDetailModal({ visible, position, data, onChange, onClose }: Props) {
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(theme), [theme])

  if (!position || !data) {
    // Still mount the Modal so the open/close animation is consistent.
    return <Modal visible={false} transparent animationType="slide" onRequestClose={onClose} />
  }

  const meta = CONDITION_META[data.condition]
  const posName = t(`positions.${position}`)
  const textAlign = isRTL ? 'right' : 'left'

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Tap the dimmed backdrop to dismiss */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        {/* Bottom padding tracks the safe-area inset so the Done button clears
            the Android system navigation bar / iOS home indicator. */}
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
          {/* Grab handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={[styles.header, isRTL && styles.headerRTL]}>
            <View style={[styles.positionBadge, { backgroundColor: meta.tint, borderColor: meta.borderColor }]}>
              <Text style={[styles.positionCode, { color: meta.color }]}>{position}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.posName, { textAlign }]} numberOfLines={1}>{posName}</Text>
              <View style={[styles.conditionPill, { backgroundColor: meta.tint, borderColor: meta.borderColor }, isRTL && styles.headerRTL]}>
                <Ionicons name={meta.icon as any} size={14} color={meta.color} />
                <Text style={[styles.conditionText, { color: meta.color }]}>
                  {t(meta.i18nKey)}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={22} color={theme.color.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Editable detail — flexShrink lets the list shrink to the space left
              after the fixed header/handle/Done button so it can always scroll
              internally (older/short screens with the keyboard open). */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator
            nestedScrollEnabled
            bounces
            overScrollMode="always"
          >
            <TyreEditor data={data} onChange={onChange} />
          </ScrollView>

          {/* Done */}
          <Button
            label={t('tyre.done')}
            icon="checkmark"
            size="lg"
            full
            onPress={onClose}
            style={styles.doneBtn}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: c.overlay },
    sheetWrap: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
      paddingHorizontal: spacing.xl, paddingTop: spacing.md - 2,
      paddingBottom: Platform.OS === 'ios' ? 34 : spacing.xl,
      maxHeight: '90%',
      borderTopWidth: 1, borderColor: c.border,
      ...elevation(theme, 3),
    },
    handle: {
      alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
      backgroundColor: c.borderStrong, marginBottom: spacing.md,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.md },
    headerRTL: { flexDirection: 'row-reverse' },
    positionBadge: {
      minWidth: 56, height: 56, borderRadius: radius.lg, borderWidth: 2,
      alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm,
    },
    positionCode: { fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
    posName: { ...typography.h3, color: c.text },
    conditionPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
      alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 4,
      borderRadius: radius.pill, borderWidth: 1,
    },
    conditionText: { fontSize: 13, fontWeight: '800' },
    closeBtn: {
      width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { paddingBottom: spacing['2xl'] },
    doneBtn: { marginTop: spacing.sm },
  })
}
