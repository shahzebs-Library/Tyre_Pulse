/**
 * TyreEditor
 *
 * The editable detail body for a single tyre position: serial, pressure,
 * iconic condition picker, photo capture (with background upload to Supabase
 * Storage) and notes. Shared by the position list popup so the capture logic
 * lives in exactly one place.
 */

import { useState, useMemo } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system'
import { TyrePositionData } from '../lib/types'
import { CONDITION_META, CONDITIONS, SHOW_TREAD_DEPTH } from '../lib/tyreConditions'
import { lookupTyreBySerial, TyreLookupRecord } from '../lib/tyreLookup'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { radius, spacing, typography, Theme } from '../lib/theme'
import { supabase } from '../lib/supabase'
import { storageRef } from '../lib/storageRefs'

type UploadState = 'idle' | 'uploading' | 'done' | 'error'
type LookupState = 'idle' | 'searching' | 'found' | 'none'

interface Props {
  data: TyrePositionData
  onChange: (updated: TyrePositionData) => void
}

export default function TyreEditor({ data, onChange }: Props) {
  const { t } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const [pickingPhoto, setPickingPhoto] = useState(false)
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [lookupState, setLookupState] = useState<LookupState>('idle')
  const [matched, setMatched] = useState<TyreLookupRecord | null>(null)

  function update(partial: Partial<TyrePositionData>) {
    onChange({ ...data, ...partial })
  }

  // Resolve the entered serial against the tyre master records to surface the
  // correct brand / size / last reading and avoid mis-keyed data.
  async function runSerialLookup() {
    const serial = data.serial_number.trim()
    if (!serial) { setLookupState('idle'); setMatched(null); return }
    setLookupState('searching')
    try {
      const rec = await lookupTyreBySerial(serial)
      if (rec) { setMatched(rec); setLookupState('found') }
      else { setMatched(null); setLookupState('none') }
    } catch {
      setMatched(null); setLookupState('none')
    }
  }

  const lastPressure = matched?.pressure_reading != null ? String(matched.pressure_reading) : null

  async function pickPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert(t('tyre.cameraPermissionTitle'), t('tyre.cameraPermissionMessage'))
      return
    }
    setPickingPhoto(true)
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.75,
        allowsEditing: false,
      })
      if (!result.canceled && result.assets[0]) {
        const localUri = result.assets[0].uri
        update({ photo_uri: localUri, photo_url: null })
        await uploadPhoto(localUri)
      }
    } finally {
      setPickingPhoto(false)
    }
  }

  async function uploadPhoto(localUri: string) {
    setUploadState('uploading')
    try {
      const rawExt = localUri.split('.').pop()?.toLowerCase() ?? 'jpg'
      const ext = rawExt === 'heic' || rawExt === 'heif' ? 'jpg' : rawExt
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'

      const safePosId = data.position.replace(/[^a-zA-Z0-9_-]/g, '_')
      const path = `photos/${Date.now()}_${safePosId}.${ext}`

      const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' })
      const binaryString = atob(base64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i)

      const { error: uploadError } = await supabase.storage
        .from('tyre-photos')
        .upload(path, bytes, { contentType, upsert: true })

      if (uploadError) throw uploadError

      update({ photo_url: storageRef('tyre-photos', path) })
      setUploadState('done')
    } catch (err) {
      console.warn('[TyrePulse] Photo upload failed:', err)
      setUploadState('error')
    }
  }

  const displayUri = data.photo_uri

  return (
    <View style={styles.body}>
      {/* Serial Number + lookup */}
      <View style={styles.field}>
        <Text style={styles.label}>{t('tyre.serialNumber')}</Text>
        <View style={styles.serialRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={data.serial_number}
            onChangeText={v => { update({ serial_number: v }); if (lookupState !== 'idle') { setLookupState('idle'); setMatched(null) } }}
            onSubmitEditing={runSerialLookup}
            placeholder={t('tyre.serialPlaceholder')}
            placeholderTextColor={theme.color.textMuted}
            autoCapitalize="characters"
            returnKeyType="search"
          />
          <TouchableOpacity
            style={styles.lookupBtn}
            onPress={runSerialLookup}
            disabled={lookupState === 'searching' || !data.serial_number.trim()}
            activeOpacity={0.8}
          >
            {lookupState === 'searching'
              ? <ActivityIndicator size="small" color={theme.color.onPrimary} />
              : <Ionicons name="search" size={18} color={theme.color.onPrimary} />}
          </TouchableOpacity>
        </View>

        {/* Matched master record */}
        {lookupState === 'found' && matched && (
          <View style={styles.matchCard}>
            <View style={styles.matchHeader}>
              <Ionicons name="checkmark-circle" size={15} color={theme.color.success.base} />
              <Text style={styles.matchTitle}>{t('tyre.matchFound')}</Text>
            </View>
            <Text style={styles.matchMeta}>
              {[matched.brand, matched.size, matched.tyre_position ?? matched.position, matched.asset_no]
                .filter(Boolean)
                .join('  ·  ') || '-'}
            </Text>
            {lastPressure && !data.pressure_psi ? (
              <TouchableOpacity
                style={styles.matchAction}
                onPress={() => update({ pressure_psi: lastPressure })}
                activeOpacity={0.8}
              >
                <Ionicons name="speedometer-outline" size={14} color={theme.color.success.base} />
                <Text style={styles.matchActionText}>
                  {t('tyre.useLastPressure')} ({lastPressure} PSI)
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
        {lookupState === 'none' && (
          <Text style={styles.matchNone}>{t('tyre.matchNone')}</Text>
        )}
      </View>

      {/* Pressure (+ Tread when enabled) */}
      <View style={styles.row}>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.label}>{t('tyre.pressure')}</Text>
          <TextInput
            style={styles.input}
            value={data.pressure_psi}
            onChangeText={v => update({ pressure_psi: v })}
            placeholder={t('tyre.pressurePlaceholder')}
            placeholderTextColor={theme.color.textMuted}
            keyboardType="decimal-pad"
          />
        </View>
        {SHOW_TREAD_DEPTH && (
          <>
            <View style={{ width: 12 }} />
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>{t('tyre.treadDepth')}</Text>
              <TextInput
                style={styles.input}
                value={data.tread_depth_mm}
                onChangeText={v => update({ tread_depth_mm: v })}
                placeholder={t('tyre.treadPlaceholder')}
                placeholderTextColor={theme.color.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
          </>
        )}
      </View>

      {/* Condition - emoji + icon picker (matches web ✅⚠️❌🔴) */}
      <View style={styles.field}>
        <Text style={styles.label}>{t('tyre.condition')}</Text>
        <View style={styles.conditionGrid}>
          {CONDITIONS.map(c => {
            const meta = CONDITION_META[c]
            const active = data.condition === c
            return (
              <TouchableOpacity
                key={c}
                style={[
                  styles.conditionBtn,
                  active && {
                    backgroundColor: meta.tint,
                    borderColor: meta.borderColor,
                    borderWidth: 2,
                  },
                ]}
                onPress={() => update({ condition: c })}
                activeOpacity={0.75}
              >
                <Text style={styles.conditionEmoji}>{meta.emoji}</Text>
                <Text style={[styles.conditionBtnText, active && { color: meta.color, fontWeight: '800' }]}>
                  {t(meta.i18nKey)}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>

      {/* Photo */}
      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{t('tyre.photo')}</Text>
          {uploadState === 'uploading' && (
            <View style={styles.uploadBadge}>
              <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.7 }] }} />
              <Text style={styles.uploadBadgeText}>Uploading...</Text>
            </View>
          )}
          {uploadState === 'done' && (
            <View style={[styles.uploadBadge, styles.uploadBadgeDone]}>
              <Ionicons name="checkmark-circle" size={12} color="#fff" />
              <Text style={styles.uploadBadgeText}>Saved to cloud</Text>
            </View>
          )}
          {uploadState === 'error' && (
            <View style={[styles.uploadBadge, styles.uploadBadgeError]}>
              <Ionicons name="warning-outline" size={12} color="#fff" />
              <Text style={styles.uploadBadgeText}>Local only</Text>
            </View>
          )}
        </View>

        {displayUri ? (
          <View style={styles.photoContainer}>
            <Image source={{ uri: displayUri }} style={styles.photo} />
            <TouchableOpacity
              style={styles.photoRetake}
              onPress={pickPhoto}
              disabled={pickingPhoto || uploadState === 'uploading'}
            >
              <Ionicons name="camera-outline" size={16} color="#fff" />
              <Text style={styles.photoRetakeText}>{t('tyre.retake')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto} disabled={pickingPhoto}>
            {pickingPhoto
              ? <ActivityIndicator size="small" color={theme.color.primary} />
              : <Ionicons name="camera-outline" size={22} color={theme.color.primary} />}
            <Text style={styles.photoBtnText}>
              {pickingPhoto ? t('tyre.openingCamera') : t('tyre.takePhoto')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Notes */}
      <View style={styles.field}>
        <Text style={styles.label}>{t('tyre.notes')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={data.notes}
          onChangeText={v => update({ notes: v })}
          placeholder={t('tyre.notesPlaceholder')}
          placeholderTextColor={theme.color.textMuted}
          multiline
          numberOfLines={2}
        />
      </View>
    </View>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    body: { gap: spacing.lg },
    field: { gap: spacing.sm - 2 },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    label: {
      ...typography.label, color: c.textSecondary,
      textTransform: 'uppercase',
    },
    input: {
      backgroundColor: c.surfaceAlt, borderWidth: 1.5, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
      fontSize: 15, fontWeight: '600', color: c.text,
    },
    textArea: { minHeight: 64, textAlignVertical: 'top' },
    row: { flexDirection: 'row' },
    serialRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    lookupBtn: {
      width: 48, height: 48, borderRadius: radius.md,
      backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
    },
    matchCard: {
      marginTop: spacing.sm, gap: spacing.sm - 2,
      backgroundColor: c.success.soft,
      borderWidth: 1, borderColor: c.success.base,
      borderRadius: radius.md, padding: spacing.md,
    },
    matchHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
    matchTitle: {
      ...typography.micro, color: c.success.on,
      textTransform: 'uppercase',
    },
    matchMeta: { fontSize: 13, fontWeight: '700', color: c.text },
    matchAction: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
      alignSelf: 'flex-start',
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.success.base,
      borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, marginTop: 2,
    },
    matchActionText: { fontSize: 12, fontWeight: '800', color: c.success.on },
    matchNone: { marginTop: spacing.sm, fontSize: 12, color: c.textMuted, fontStyle: 'italic' },
    conditionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    conditionBtn: {
      flexGrow: 1, flexBasis: '30%',
      alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      paddingVertical: spacing.lg - 2, paddingHorizontal: spacing.sm,
      borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border,
      backgroundColor: c.surface, minHeight: 74,
    },
    conditionEmoji: { fontSize: 26, lineHeight: 30 },
    conditionBtnText: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
    uploadBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 3,
      backgroundColor: c.neutral.base, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill,
    },
    uploadBadgeDone:  { backgroundColor: c.success.base },
    uploadBadgeError: { backgroundColor: c.warning.base },
    uploadBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
    photoBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
      backgroundColor: c.primarySoft, borderWidth: 1.5, borderColor: c.primary,
      borderStyle: 'dashed', borderRadius: radius.md, paddingVertical: spacing.lg,
    },
    photoBtnText: { fontSize: 15, fontWeight: '700', color: c.primaryDark },
    photoContainer: { borderRadius: radius.md, overflow: 'hidden', position: 'relative' },
    photo: { width: '100%', height: 170, borderRadius: radius.md },
    photoRetake: {
      position: 'absolute', bottom: spacing.sm, right: spacing.sm,
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: 'rgba(0,0,0,0.62)', paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1, borderRadius: radius.pill,
    },
    photoRetakeText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  })
}
