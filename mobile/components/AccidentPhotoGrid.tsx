/**
 * AccidentPhotoGrid - CATEGORIZED accident evidence capture.
 *
 * Single-photo document slots (Driving License / Resident ID / Vehicle
 * Registration / Najm Report / Taqdeer Estimation) + a multi-photo "Accident
 * Photos" section. Each slot is a labeled card with camera/gallery pick,
 * thumbnail preview and replace/remove actions.
 *
 * Persistence model (server-compatible by design): every photo is uploaded to
 * the PRIVATE `accident-photos` bucket and stored as the SAME plain string ref
 * (tp-storage://...) the accidents.photos jsonb already carries - kept a plain
 * string array, ordered documents-first then accident photos, with the
 * category encoded in the storage filename prefix (license_/resident_/
 * registration_/najm_/taqdeer_/accident_). recordQueue's allow-list and the
 * web gallery rendering are untouched.
 *
 * Visual: Daylight design system (theme tokens, sunlight-legible).
 */

import { useRef, useState } from 'react'
import {
  View, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system'
import { supabase } from '../lib/supabase'
import { storageRef } from '../lib/storageRefs'
import { prepareForUpload } from '../lib/photoUpload'
import { safeImageSrc } from '../lib/safeUrl'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { radius, spacing } from '../lib/theme'
import { AppText } from './ui'

type IconName = React.ComponentProps<typeof Ionicons>['name']

export type AccidentPhotoCategory =
  | 'license' | 'resident_id' | 'registration' | 'najm' | 'taqdeer' | 'accident'

export interface AccidentPhotoEntry {
  category: AccidentPhotoCategory
  /** Permanent storage ref (tp-storage://...) once uploaded; '' while pending. */
  url: string
  /** Local file:// URI kept for instant thumbnail preview. */
  localUri: string
}

const MAX_ACCIDENT_PHOTOS = 10

/** Fixed persistence order: document slots first, accident photos last. */
const CATEGORY_ORDER: AccidentPhotoCategory[] = [
  'license', 'resident_id', 'registration', 'najm', 'taqdeer', 'accident',
]

/** Filename prefix per category (encodes the category server-side). */
const CATEGORY_PREFIX: Record<AccidentPhotoCategory, string> = {
  license: 'license', resident_id: 'resident', registration: 'registration',
  najm: 'najm', taqdeer: 'taqdeer', accident: 'accident',
}

const SINGLE_SLOTS: { category: AccidentPhotoCategory; icon: IconName; labelKey: string }[] = [
  { category: 'license', icon: 'card-outline', labelKey: 'accident.report.photoLicense' },
  { category: 'resident_id', icon: 'person-circle-outline', labelKey: 'accident.report.photoResidentId' },
  { category: 'registration', icon: 'document-text-outline', labelKey: 'accident.report.photoRegistration' },
  { category: 'najm', icon: 'shield-checkmark-outline', labelKey: 'accident.report.photoNajm' },
  { category: 'taqdeer', icon: 'calculator-outline', labelKey: 'accident.report.photoTaqdeer' },
]

// ── Category-aware upload (mirrors lib/photoUpload.uploadAccidentPhoto: same
//    bucket, size limit, base64 path and tp-storage:// ref; only the filename
//    gains the category prefix). Picker quality stays 0.55 as before. ─────────
const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif'])
const MAX_DECODE_BYTES = 12 * 1024 * 1024 // hard cap on the file we base64-decode

async function uploadCategorizedPhoto(
  localUri: string,
  category: AccidentPhotoCategory,
): Promise<string | null> {
  if (!localUri || !localUri.startsWith('file://')) return null
  try {
    // Resize/compress first (shared helper) so the base64 decode stays small (avoids OOM).
    const uploadUri = await prepareForUpload(localUri)

    const rawExt = uploadUri.split('.').pop()?.toLowerCase() ?? 'jpg'
    if (!ALLOWED_EXTS.has(rawExt)) return null
    const ext = rawExt === 'heic' || rawExt === 'heif' ? 'jpg' : rawExt
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'

    const info = await FileSystem.getInfoAsync(uploadUri)
    if (info.exists && (info as any).size > MAX_DECODE_BYTES) return null

    const { data: { user } } = await supabase.auth.getUser()
    const uid = user?.id?.slice(0, 8) ?? 'anon'
    const rand = Math.random().toString(36).slice(2, 6)
    const path = `accidents/${uid}/${CATEGORY_PREFIX[category]}_${Date.now()}_${rand}.${ext}`

    const base64 = await FileSystem.readAsStringAsync(uploadUri, { encoding: 'base64' })
    const bytes = decodeBase64(base64)

    const { error } = await supabase.storage
      .from('accident-photos')
      .upload(path, bytes, { contentType, upsert: false })
    if (error) {
      if (__DEV__) console.warn('[AccidentPhotoGrid] upload error:', error.message)
      return null
    }
    return storageRef('accident-photos', path)
  } catch (err: any) {
    if (__DEV__) console.warn('[AccidentPhotoGrid] upload failed:', err?.message)
    return null
  }
}

function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i)
  return bytes
}

function sortEntries(list: AccidentPhotoEntry[]): AccidentPhotoEntry[] {
  // Stable sort: documents in fixed order first, accident photos keep insertion order.
  return [...list].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  )
}

interface Props {
  entries: AccidentPhotoEntry[]
  onChange: (entries: AccidentPhotoEntry[]) => void
  onUploadingChange?: (isUploading: boolean) => void
}

export default function AccidentPhotoGrid({ entries, onChange, onUploadingChange }: Props) {
  const { t } = useLanguage()
  const { theme } = useTheme()
  const c = theme.color
  // busyKey = the category currently uploading ('accident' covers the multi section).
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // Ref mirror so async upload flows never act on a stale entries array.
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const accidentEntries = entries.filter(e => e.category === 'accident')
  const singleFor = (cat: AccidentPhotoCategory) => entries.find(e => e.category === cat) ?? null

  function setBusy(key: string | null) {
    setBusyKey(key)
    onUploadingChange?.(key != null)
  }

  // ── Pickers (quality 0.55 preserved - legible damage detail, small upload) ──
  async function captureUri(): Promise<string | null> {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert(t('accident.cameraPermissionTitle'), t('accident.cameraPermissionMessage'))
      return null
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.55, allowsEditing: false,
    })
    if (result.canceled || !result.assets[0]) return null
    return result.assets[0].uri
  }

  async function pickUris(limit: number): Promise<string[]> {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert(t('accident.cameraPermissionTitle'), t('accident.cameraPermissionMessage'))
      return []
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.55,
      allowsMultipleSelection: limit > 1, selectionLimit: limit,
    })
    if (result.canceled || !result.assets?.length) return []
    return result.assets.slice(0, limit).map(a => a.uri)
  }

  function chooseSource(onCamera: () => void, onGallery: () => void) {
    Alert.alert(t('accident.addPhoto'), undefined, [
      { text: t('accident.takePhoto'), onPress: onCamera },
      { text: t('accident.chooseFromGallery'), onPress: onGallery },
      { text: t('accident.cancel'), style: 'cancel' },
    ])
  }

  // ── Single document slot: pick/replace then upload ─────────────────────────
  async function setSingle(category: AccidentPhotoCategory, localUri: string) {
    const entry: AccidentPhotoEntry = { category, url: '', localUri }
    let work = sortEntries([...entriesRef.current.filter(e => e.category !== category), entry])
    onChange(work)
    setBusy(category)
    try {
      const ref = await uploadCategorizedPhoto(localUri, category)
      work = work.map(e => (e === entry ? { ...e, url: ref || '' } : e))
      onChange(work)
      if (!ref) Alert.alert(t('common.error'), t('accident.report.photoUploadFailed'))
    } finally {
      setBusy(null)
    }
  }

  function addToSlot(category: AccidentPhotoCategory) {
    chooseSource(
      async () => { const u = await captureUri(); if (u) await setSingle(category, u) },
      async () => { const us = await pickUris(1); if (us[0]) await setSingle(category, us[0]) },
    )
  }

  // ── Multi accident photos: sequential upload keeps arrays consistent ───────
  async function addAccidentPhotos(uris: string[]) {
    let work = [...entriesRef.current]
    for (const uri of uris) {
      if (work.filter(e => e.category === 'accident').length >= MAX_ACCIDENT_PHOTOS) break
      const entry: AccidentPhotoEntry = { category: 'accident', url: '', localUri: uri }
      work = sortEntries([...work, entry])
      onChange(work)
      setBusy('accident')
      try {
        const ref = await uploadCategorizedPhoto(uri, 'accident')
        work = work.map(e => (e === entry ? { ...e, url: ref || '' } : e))
        onChange(work)
        if (!ref) Alert.alert(t('common.error'), t('accident.report.photoUploadFailed'))
      } finally {
        setBusy(null)
      }
    }
  }

  function addAccident() {
    const remaining = MAX_ACCIDENT_PHOTOS - accidentEntries.length
    if (remaining <= 0) {
      Alert.alert(t('accident.report.photoMaxReached'))
      return
    }
    chooseSource(
      async () => { const u = await captureUri(); if (u) await addAccidentPhotos([u]) },
      async () => { const us = await pickUris(remaining); if (us.length) await addAccidentPhotos(us) },
    )
  }

  function removeEntry(entry: AccidentPhotoEntry) {
    Alert.alert(t('accident.report.photoRemove'), t('accident.report.photoRemoveConfirm'), [
      { text: t('accident.cancel'), style: 'cancel' },
      {
        text: t('accident.report.photoRemove'),
        style: 'destructive',
        onPress: () => onChange(entriesRef.current.filter(e => e !== entry)),
      },
    ])
  }

  const previewUri = (e: AccidentPhotoEntry) => safeImageSrc(e.localUri || e.url)

  return (
    <View style={styles.container}>
      {/* ── Document slots (one photo each) ── */}
      {SINGLE_SLOTS.map(slot => {
        const entry = singleFor(slot.category)
        const busy = busyKey === slot.category
        return (
          <View key={slot.category}
            style={[styles.slotRow, { borderColor: c.border, backgroundColor: c.surface }]}>
            {entry ? (
              <View style={[styles.slotThumbWrap, { backgroundColor: c.surfaceSunken }]}>
                <Image source={{ uri: previewUri(entry) }} style={styles.slotThumb} resizeMode="cover" />
                {busy && (
                  <View style={styles.uploadingOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
                {!busy && !!entry.url && (
                  <View style={[styles.cloudBadge, { backgroundColor: c.success.base }]}>
                    <Ionicons name="cloud-done" size={11} color="#fff" />
                  </View>
                )}
              </View>
            ) : (
              <View style={[styles.slotIconWrap, { backgroundColor: c.danger.soft }]}>
                <Ionicons name={slot.icon} size={20} color={c.danger.base} />
              </View>
            )}

            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{t(slot.labelKey)}</AppText>
              <AppText variant="micro" color="muted">{t('modules.common.optional')}</AppText>
            </View>

            {entry ? (
              !busy && (
                <View style={styles.slotActions}>
                  <TouchableOpacity onPress={() => addToSlot(slot.category)}
                    style={[styles.slotActionBtn, { borderColor: c.border }]}
                    hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                    accessibilityLabel={t('accident.report.photoReplace')}>
                    <Ionicons name="camera-reverse-outline" size={18} color={c.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => removeEntry(entry)}
                    style={[styles.slotActionBtn, { borderColor: c.border }]}
                    hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                    accessibilityLabel={t('accident.report.photoRemove')}>
                    <Ionicons name="trash-outline" size={18} color={c.danger.base} />
                  </TouchableOpacity>
                </View>
              )
            ) : (
              <TouchableOpacity onPress={() => addToSlot(slot.category)}
                style={[styles.slotAddBtn, { borderColor: c.danger.base }]}>
                <Ionicons name="add" size={16} color={c.danger.base} />
                <AppText variant="caption" style={{ color: c.danger.base }}>{t('accident.addPhoto')}</AppText>
              </TouchableOpacity>
            )}
          </View>
        )
      })}

      {/* ── Accident photos (multi) ── */}
      <View style={styles.multiHeader}>
        <Ionicons name="images-outline" size={15} color={c.danger.base} />
        <AppText variant="bodyStrong" style={{ flex: 1 }}>{t('accident.report.photoAccident')}</AppText>
        <AppText variant="caption" color="muted">{accidentEntries.length} / {MAX_ACCIDENT_PHOTOS}</AppText>
      </View>
      <View style={styles.grid}>
        {accidentEntries.map((entry, index) => {
          const busy = busyKey === 'accident' && !entry.url && !!entry.localUri &&
            index === accidentEntries.length - 1
          return (
            <View key={`${entry.localUri || entry.url}-${index}`}
              style={[styles.cell, { backgroundColor: c.surfaceSunken }]}>
              <Image source={{ uri: previewUri(entry) }} style={styles.thumb} resizeMode="cover" />

              {busy && (
                <View style={styles.uploadingOverlay}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              )}

              {!busy && !!entry.url && (
                <View style={[styles.cloudBadge, { backgroundColor: c.success.base }]}>
                  <Ionicons name="cloud-done" size={12} color="#fff" />
                </View>
              )}

              {!busy && (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => removeEntry(entry)}
                  hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}>
                  <Ionicons name="close-circle" size={22} color="#fff" />
                </TouchableOpacity>
              )}

              <View style={styles.numBadge}>
                <AppText variant="micro" style={styles.numText}>{index + 1}</AppText>
              </View>
            </View>
          )
        })}

        {accidentEntries.length < MAX_ACCIDENT_PHOTOS && (
          <TouchableOpacity
            style={[styles.addCell, { borderColor: c.danger.base, backgroundColor: c.danger.soft }]}
            onPress={addAccident}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-outline" size={28} color={c.danger.base} />
            <AppText variant="micro" center style={{ color: c.danger.on, marginTop: 4 }}>
              {t('accident.addPhoto')}
            </AppText>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const CELL_SIZE = 104
const SLOT_THUMB = 52

const styles = StyleSheet.create({
  container: { gap: spacing.sm },

  // Document slot cards
  slotRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: 1, borderRadius: radius.lg, padding: spacing.md,
  },
  slotIconWrap: {
    width: SLOT_THUMB, height: SLOT_THUMB, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  slotThumbWrap: {
    width: SLOT_THUMB, height: SLOT_THUMB, borderRadius: radius.md,
    overflow: 'hidden', position: 'relative',
  },
  slotThumb: { width: '100%', height: '100%' },
  slotActions: { flexDirection: 'row', gap: spacing.sm },
  slotActionBtn: {
    width: 34, height: 34, borderRadius: radius.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  slotAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },

  // Multi accident-photo section
  multiHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cloudBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    borderRadius: 8,
    padding: 3,
  },
  deleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
  },
  numBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  numText: {
    color: '#fff',
  },
  addCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
