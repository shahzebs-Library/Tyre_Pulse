/**
 * TyreDetailModal
 *
 * Focused popup for a single tyre position. Opened by tapping a tyre on the
 * vehicle diagram or a row in the position list — it shows only that tyre's
 * information and editable fields, with a clear iconic condition header.
 */

import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, Pressable,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { TyrePositionData } from '../lib/types'
import { CONDITION_META } from '../lib/tyreConditions'
import { useLanguage } from '../contexts/LanguageContext'
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
        <View style={styles.sheet}>
          {/* Grab handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={[styles.header, isRTL && styles.headerRTL]}>
            <View style={[styles.positionBadge, { backgroundColor: meta.tint, borderColor: meta.color }]}>
              <Text style={[styles.positionCode, { color: meta.color }]}>{position}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.posName, { textAlign }]} numberOfLines={1}>{posName}</Text>
              <View style={[styles.conditionPill, isRTL && styles.headerRTL]}>
                <Ionicons name={meta.icon as any} size={14} color={meta.color} />
                <Text style={[styles.conditionText, { color: meta.color }]}>
                  {t(meta.i18nKey)}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Editable detail */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TyreEditor data={data} onChange={onChange} />
          </ScrollView>

          {/* Done */}
          <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.9}>
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text style={styles.doneBtnText}>{t('tyre.done')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.55)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center', width: 40, height: 5, borderRadius: 3,
    backgroundColor: '#e2e8f0', marginBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 14 },
  headerRTL: { flexDirection: 'row-reverse' },
  positionBadge: {
    minWidth: 52, height: 52, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
  positionCode: { fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  posName: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  conditionPill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  conditionText: { fontSize: 13, fontWeight: '700' },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: 16 },
  doneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#16a34a', borderRadius: 14, height: 52, marginTop: 6,
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
