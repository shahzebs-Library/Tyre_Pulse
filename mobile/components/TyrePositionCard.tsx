import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { TyrePositionData, TyreCondition } from '../lib/types'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'

const CONDITIONS: TyreCondition[] = ['Good', 'Worn', 'Damaged', 'Flat', 'Missing']

/**
 * Tread-depth capture is temporarily disabled in the field workflow. Flip to
 * `true` to restore the input and its summary chip everywhere at once — the
 * underlying data model (`tread_depth_mm`) is left intact.
 */
const SHOW_TREAD_DEPTH = false

const CONDITION_COLORS: Record<TyreCondition, string> = {
  Good:    '#16a34a',
  Worn:    '#f59e0b',
  Damaged: '#ef4444',
  Flat:    '#dc2626',
  Missing: '#6b7280',
}

const CONDITION_KEYS: Record<TyreCondition, string> = {
  Good:    'tyre.good',
  Worn:    'tyre.worn',
  Damaged: 'tyre.damaged',
  Flat:    'tyre.flat',
  Missing: 'tyre.missing',
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

interface Props {
  data: TyrePositionData
  onChange: (updated: TyrePositionData) => void
  /** When true, card expands automatically (e.g. tapped in the SVG diagram) */
  isHighlighted?: boolean
}

export default function TyrePositionCard({ data, onChange, isHighlighted = false }: Props) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const [pickingPhoto, setPickingPhoto] = useState(false)
  const [uploadState, setUploadState] = useState<UploadState>('idle')

  // Auto-expand when diagram highlights this position
  useEffect(() => {
    if (isHighlighted) setExpanded(true)
  }, [isHighlighted])

  function update(partial: Partial<TyrePositionData>) {
    onChange({ ...data, ...partial })
  }

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
        // Set local URI immediately for instant preview
        update({ photo_uri: localUri, photo_url: null })
        // Upload to Supabase Storage in background
        await uploadPhoto(localUri)
      }
    } finally {
      setPickingPhoto(false)
    }
  }

  async function uploadPhoto(localUri: string) {
    setUploadState('uploading')
    try {
      // Fetch the file as a blob
      const response = await fetch(localUri)
      const blob = await response.blob()

      // Build unique storage path
      const ext      = 'jpg'
      const safePosId = data.position.replace(/[^a-zA-Z0-9]/g, '_')
      const path     = `photos/${Date.now()}_${safePosId}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('tyre-photos')
        .upload(path, blob, {
          contentType: 'image/jpeg',
          upsert: true,
        })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('tyre-photos')
        .getPublicUrl(path)

      // Update with permanent URL (keep local URI for display)
      update({ photo_url: urlData.publicUrl })
      setUploadState('done')
    } catch (err) {
      console.warn('[TyrePulse] Photo upload failed:', err)
      // Graceful degradation — local URI retained; upload retried on next edit
      setUploadState('error')
    }
  }

  const conditionColor = CONDITION_COLORS[data.condition]
  const posLabel       = t(`positions.${data.position}`)
  const displayUri     = data.photo_uri   // always use local URI for Image (faster)

  return (
    <View style={[styles.card, isHighlighted && styles.cardHighlighted]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.7}
      >
        <View style={[
          styles.positionBadge,
          isHighlighted && styles.positionBadgeHighlighted,
        ]}>
          <Text style={[
            styles.positionCode,
            isHighlighted && styles.positionCodeHighlighted,
          ]}>
            {data.position}
          </Text>
          <Text style={[
            styles.positionName,
            isHighlighted && styles.positionNameHighlighted,
          ]} numberOfLines={1}>
            {posLabel}
          </Text>
        </View>

        <View style={styles.summary}>
          <View style={[styles.conditionDot, { backgroundColor: conditionColor }]} />
          <Text style={styles.conditionLabel}>{t(CONDITION_KEYS[data.condition])}</Text>
          {data.pressure_psi ? (
            <Text style={styles.metaText}>{data.pressure_psi} PSI</Text>
          ) : null}
          {SHOW_TREAD_DEPTH && data.tread_depth_mm ? (
            <Text style={styles.metaText}>{data.tread_depth_mm}mm</Text>
          ) : null}
          {displayUri ? (
            <View style={styles.photoStatus}>
              <Ionicons
                name={data.photo_url ? 'cloud-done-outline' : 'camera'}
                size={13}
                color={data.photo_url ? '#16a34a' : '#f59e0b'}
              />
            </View>
          ) : null}
        </View>

        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#94a3b8"
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {/* Serial Number */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('tyre.serialNumber')}</Text>
            <TextInput
              style={styles.input}
              value={data.serial_number}
              onChangeText={v => update({ serial_number: v })}
              placeholder={t('tyre.serialPlaceholder')}
              placeholderTextColor="#94a3b8"
              autoCapitalize="characters"
            />
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

          {/* Condition */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('tyre.condition')}</Text>
            <View style={styles.conditionRow}>
              {CONDITIONS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.conditionBtn,
                    data.condition === c && {
                      backgroundColor: CONDITION_COLORS[c],
                      borderColor: CONDITION_COLORS[c],
                    },
                  ]}
                  onPress={() => update({ condition: c })}
                >
                  <Text style={[
                    styles.conditionBtnText,
                    data.condition === c && { color: '#fff' },
                  ]}>
                    {t(CONDITION_KEYS[c])}
                  </Text>
                </TouchableOpacity>
              ))}
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
              <TouchableOpacity
                style={styles.photoBtn}
                onPress={pickPhoto}
                disabled={pickingPhoto}
              >
                {pickingPhoto
                  ? <ActivityIndicator size="small" color="#16a34a" />
                  : <Ionicons name="camera-outline" size={22} color="#16a34a" />
                }
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
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHighlighted: {
    borderColor: '#3b82f6',
    borderWidth: 2,
    shadowColor: '#3b82f6',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  positionBadge: {
    minWidth: 60,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(22,163,74,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(22,163,74,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  positionBadgeHighlighted: {
    backgroundColor: 'rgba(59,130,246,0.10)',
    borderColor: 'rgba(59,130,246,0.4)',
  },
  positionCode: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803d',
    letterSpacing: 0.5,
  },
  positionCodeHighlighted: { color: '#2563eb' },
  positionName: {
    fontSize: 8,
    fontWeight: '600',
    color: '#15803d',
    opacity: 0.75,
    textAlign: 'center',
  },
  positionNameHighlighted: { color: '#2563eb' },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  conditionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  conditionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  metaText: {
    fontSize: 12,
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  photoStatus: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    gap: 14,
  },
  field: { gap: 6 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  uploadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#64748b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  uploadBadgeDone:  { backgroundColor: '#16a34a' },
  uploadBadgeError: { backgroundColor: '#f59e0b' },
  uploadBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },
  textArea: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row' },
  conditionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  conditionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  conditionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(22,163,74,0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(22,163,74,0.25)',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 16,
  },
  photoBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#16a34a',
  },
  photoContainer: {
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: 140,
    borderRadius: 10,
  },
  photoRetake: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  photoRetakeText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
})
