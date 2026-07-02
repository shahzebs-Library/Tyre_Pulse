/**
 * TyreEditor
 *
 * The editable detail body for a single tyre position: serial, pressure,
 * iconic condition picker, photo capture (with background upload to Supabase
 * Storage) and notes. Shared by the position list popup so the capture logic
 * lives in exactly one place.
 */

import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { TyrePositionData } from '../lib/types'
import { CONDITION_META, CONDITIONS, SHOW_TREAD_DEPTH } from '../lib/tyreConditions'
import { lookupTyreBySerial, TyreLookupRecord } from '../lib/tyreLookup'
import { useLanguage } from '../contexts/LanguageContext'
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
      const response = await fetch(localUri)
      const blob = await response.blob()

      const ext       = 'jpg'
      const safePosId = data.position.replace(/[^a-zA-Z0-9]/g, '_')
      const path      = `photos/${Date.now()}_${safePosId}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('tyre-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })

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
            placeholderTextColor="#94a3b8"
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
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="search" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        {/* Matched master record */}
        {lookupState === 'found' && matched && (
          <View style={styles.matchCard}>
            <View style={styles.matchHeader}>
              <Ionicons name="checkmark-circle" size={15} color="#16a34a" />
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
                <Ionicons name="speedometer-outline" size={14} color="#16a34a" />
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
            placeholderTextColor="#94a3b8"
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
                placeholderTextColor="#94a3b8"
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
              <Text style={styles.uploadBadgeText}>Uploading…</Text>
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
              ? <ActivityIndicator size="small" color="#16a34a" />
              : <Ionicons name="camera-outline" size={22} color="#16a34a" />}
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
          placeholderTextColor="#94a3b8"
          multiline
          numberOfLines={2}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  field: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    fontSize: 12, fontWeight: '600', color: '#64748b',
    letterSpacing: 0.3, textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#0f172a',
  },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  row: { flexDirection: 'row' },
  serialRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lookupBtn: {
    width: 44, height: 42, borderRadius: 10,
    backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center',
  },
  matchCard: {
    marginTop: 8, gap: 6,
    backgroundColor: 'rgba(22,163,74,0.06)',
    borderWidth: 1, borderColor: 'rgba(22,163,74,0.25)',
    borderRadius: 10, padding: 10,
  },
  matchHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  matchTitle: {
    fontSize: 11, fontWeight: '700', color: '#15803d',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  matchMeta: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  matchAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(22,163,74,0.3)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 2,
  },
  matchActionText: { fontSize: 12, fontWeight: '700', color: '#16a34a' },
  matchNone: { marginTop: 8, fontSize: 12, color: '#94a3b8', fontStyle: 'italic' },
  conditionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  conditionBtn: {
    flexGrow: 1, flexBasis: '30%',
    alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  conditionEmoji: { fontSize: 22, lineHeight: 26 },
  conditionBtnText: { fontSize: 11, fontWeight: '700', color: '#64748b' },
  uploadBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#64748b', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12,
  },
  uploadBadgeDone:  { backgroundColor: '#16a34a' },
  uploadBadgeError: { backgroundColor: '#f59e0b' },
  uploadBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(22,163,74,0.06)', borderWidth: 1.5, borderColor: 'rgba(22,163,74,0.25)',
    borderStyle: 'dashed', borderRadius: 10, paddingVertical: 16,
  },
  photoBtnText: { fontSize: 14, fontWeight: '600', color: '#16a34a' },
  photoContainer: { borderRadius: 10, overflow: 'hidden', position: 'relative' },
  photo: { width: '100%', height: 160, borderRadius: 10 },
  photoRetake: {
    position: 'absolute', bottom: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  photoRetakeText: { fontSize: 12, color: '#fff', fontWeight: '600' },
})
