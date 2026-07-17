import { useState, useMemo } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../lib/theme'
import { Screen, Button } from '../../components/ui'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { saveCommand } from '../../lib/recordQueue'
import PhotoCapture from '../../components/PhotoCapture'
import { UserRole } from '../../lib/types'

const ROLES: UserRole[] = ['tyre_man', 'inspector', 'admin', 'manager', 'director']
const POSITIONS = ['FL', 'FR', 'RL', 'RR', 'RLO', 'RLI', 'RRO', 'RRI', 'Spare']

export default function TyreChangeScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const router = useRouter()
  const params = useLocalSearchParams<{ asset?: string; site?: string; position?: string }>()
  const { allowed } = useRoleGuard(ROLES)

  const [assetNo, setAssetNo] = useState(params.asset ?? '')
  const [site, setSite] = useState(params.site ?? profile?.site ?? '')
  const [position, setPosition] = useState(params.position ?? '')
  const [brand, setBrand] = useState('')
  const [size, setSize] = useState('')
  const [serial, setSerial] = useState('')
  const [cost, setCost] = useState('')
  const [kmFit, setKmFit] = useState('')
  const [tread, setTread] = useState('')
  const [removalReason, setRemovalReason] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  async function submit() {
    if (saving) return
    if (!assetNo.trim()) { Alert.alert(t('modules.tyreChange.savedTitle'), t('modules.tyreChange.missingAsset')); return }
    if (!position.trim()) { Alert.alert(t('modules.tyreChange.savedTitle'), t('modules.tyreChange.missingPosition')); return }
    setSaving(true)
    const today = new Date().toISOString().split('T')[0]
    const sn = serial.trim() || null
    const res = await saveCommand('TYRE_CHANGE', {
      asset_no: assetNo.trim(),
      site: site.trim() || null,
      country: profile?.country ?? null,
      position: position.trim(),
      brand: brand.trim() || null,
      size: size.trim() || null,
      serial_no: sn, serial_number: sn, tyre_serial: sn,
      cost_per_tyre: cost ? Number(cost) : null,
      qty: 1,
      km_at_fitment: kmFit ? Number(kmFit) : null,
      tread_depth: tread ? Number(tread) : null,
      fitment_date: today,
      issue_date: today,
      risk_level: 'Low',
      category: 'Tyre Change',
      removal_reason: removalReason.trim() || null,
      photos: photos.filter(Boolean).length ? photos.filter(Boolean) : null,
    })
    setSaving(false)
    Alert.alert(res.offline ? t('modules.common.offlineSaved') : t('modules.tyreChange.savedTitle'), t('modules.tyreChange.savedMsg'), [
      { text: t('modules.tyreChange.addAnother'), onPress: () => { setPosition(''); setSerial(''); setBrand(''); setSize(''); setCost(''); setKmFit(''); setTread(''); setPhotos([]) } },
      { text: t('modules.common.done'), onPress: () => router.back() },
    ])
  }

  if (!allowed) return null

  return (
    <Screen padded={false}>
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { textAlign }]}>{t('modules.tyreChange.title')}</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>{t('modules.common.asset')}</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="TM-001" placeholderTextColor={theme.color.textMuted} value={assetNo} onChangeText={setAssetNo} autoCapitalize="characters" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>{t('modules.common.site')}</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder={t('modules.tyreChange.sitePh')} placeholderTextColor={theme.color.textMuted} value={site} onChangeText={setSite} />
            </View>
          </View>

          <Text style={[styles.label, { textAlign }]}>{t('modules.tyreChange.position')}</Text>
          <View style={styles.chipRow}>
            {POSITIONS.map(p => (
              <TouchableOpacity key={p} style={[styles.chip, position === p && styles.chipActive]} onPress={() => setPosition(p)}>
                <Text style={[styles.chipText, position === p && styles.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={[styles.input, { textAlign, marginTop: spacing.sm }]} placeholder={t('modules.tyreChange.customPosition')} placeholderTextColor={theme.color.textMuted} value={position} onChangeText={setPosition} autoCapitalize="characters" />

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>{t('modules.common.brand')}</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder={t('modules.tyreChange.brandPh')} placeholderTextColor={theme.color.textMuted} value={brand} onChangeText={setBrand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>{t('modules.tyreChange.size')}</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder={t('modules.tyreChange.sizePh')} placeholderTextColor={theme.color.textMuted} value={size} onChangeText={setSize} />
            </View>
          </View>

          <Text style={[styles.label, { textAlign }]}>{t('modules.common.serial')}</Text>
          <TextInput style={[styles.input, { textAlign }]} placeholder={t('modules.tyreChange.serialPh')} placeholderTextColor={theme.color.textMuted} value={serial} onChangeText={setSerial} autoCapitalize="characters" />

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>{t('modules.tyreChange.cost')}</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="0" placeholderTextColor={theme.color.textMuted} value={cost} onChangeText={setCost} keyboardType="numeric" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>{t('modules.tyreChange.odometer')}</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="km" placeholderTextColor={theme.color.textMuted} value={kmFit} onChangeText={setKmFit} keyboardType="numeric" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>{t('modules.tyreChange.tread')}</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="mm" placeholderTextColor={theme.color.textMuted} value={tread} onChangeText={setTread} keyboardType="numeric" />
            </View>
          </View>

          <Text style={[styles.label, { textAlign }]}>{`${t('modules.tyreChange.reason')} ${t('modules.common.optional')}`}</Text>
          <TextInput style={[styles.input, styles.textarea, { textAlign }]} placeholder={t('modules.tyreChange.reasonPh')} placeholderTextColor={theme.color.textMuted} value={removalReason} onChangeText={setRemovalReason} multiline />

          <Text style={[styles.label, { textAlign }]}>{`${t('modules.common.photos')} ${t('modules.common.optional')}`}</Text>
          <PhotoCapture value={photos} onChange={setPhotos} module="tyre-change" tint={theme.color.info.base} />

          <Button
            label={t('modules.tyreChange.save')}
            icon="save"
            onPress={submit}
            loading={saving}
            disabled={saving}
            size="lg"
            full
            style={{ marginTop: spacing['2xl'] }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    backBtn: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    title: { ...typography.h2, color: c.text },
    content: { padding: spacing.lg, gap: spacing.xs, paddingBottom: spacing['4xl'] },
    label: { ...typography.label, color: c.textSecondary, marginTop: spacing.sm },
    input: { backgroundColor: c.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 14, color: c.text, borderWidth: 1, borderColor: c.border },
    textarea: { minHeight: 80, textAlignVertical: 'top' },
    row2: { flexDirection: 'row', gap: spacing.sm },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { ...typography.caption, fontWeight: '700', color: c.textMuted },
    chipTextActive: { color: c.onPrimary },
  })
}
