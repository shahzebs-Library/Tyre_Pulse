/**
 * AccidentPhotoGrid
 *
 * Multi-photo capture grid for accident reports.
 * Each photo is uploaded to the `accident-photos` Supabase Storage bucket.
 * Displays thumbnails in a 3-column grid with delete overlay.
 * Passes back an array of permanent public URLs to the parent.
 *
 * Visual: Daylight design system (theme tokens, sunlight-legible).
 */

import { useState } from 'react'
import {
  View, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { uploadAccidentPhoto } from '../lib/photoUpload'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { radius, spacing } from '../lib/theme'
import { AppText } from './ui'

const MAX_PHOTOS = 10

interface Props {
  photos: string[]           // array of public URLs (or local URIs before upload)
  localUris: string[]        // parallel array of local preview URIs
  onPhotosChange: (urls: string[], localUris: string[]) => void
  onUploadingChange?: (isUploading: boolean) => void
}

export default function AccidentPhotoGrid({ photos, localUris, onPhotosChange, onUploadingChange }: Props) {
  const { t } = useLanguage()
  const { theme } = useTheme()
  const c = theme.color
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)

  async function addPhoto() {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Maximum photos', `You can attach up to ${MAX_PHOTOS} photos per report.`)
      return
    }

    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert(t('accident.cameraPermissionTitle'), t('accident.cameraPermissionMessage'))
      return
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      allowsEditing: false,
    })

    if (result.canceled || !result.assets[0]) return

    const localUri = result.assets[0].uri
    const newIndex = photos.length

    // Add with local URI for instant preview; placeholder for URL
    const newUrls      = [...photos, '']
    const newLocalUris = [...localUris, localUri]
    onPhotosChange(newUrls, newLocalUris)

    // Upload in background (base64 -> public bucket; reliable in Expo/RN)
    setUploadingIndex(newIndex)
    onUploadingChange?.(true)
    try {
      const publicUrl = await uploadAccidentPhoto(localUri, newIndex)
      const finalUrls = [...newUrls]
      // Only store a permanent URL; never persist a local file:// URI to the DB.
      finalUrls[newIndex] = publicUrl || ''
      onPhotosChange(finalUrls, newLocalUris)
      if (!publicUrl) {
        Alert.alert('Upload failed', 'Photo could not be uploaded. Check your connection and retake.')
      }
    } finally {
      setUploadingIndex(null)
      onUploadingChange?.(false)
    }
  }

  function removePhoto(index: number) {
    Alert.alert('Remove Photo', 'Remove this photo from the report?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const newUrls      = photos.filter((_, i) => i !== index)
          const newLocalUris = localUris.filter((_, i) => i !== index)
          onPhotosChange(newUrls, newLocalUris)
        },
      },
    ])
  }

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {/* Photo thumbnails */}
        {localUris.map((uri, index) => (
          <View key={index} style={[styles.cell, { backgroundColor: c.surfaceSunken }]}>
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />

            {/* Upload indicator */}
            {uploadingIndex === index && (
              <View style={styles.uploadingOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}

            {/* Cloud saved indicator */}
            {uploadingIndex !== index && photos[index] && photos[index] !== uri && (
              <View style={[styles.cloudBadge, { backgroundColor: c.success.base }]}>
                <Ionicons name="cloud-done" size={12} color="#fff" />
              </View>
            )}

            {/* Delete button */}
            {uploadingIndex !== index && (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => removePhoto(index)}
                hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
              >
                <Ionicons name="close-circle" size={22} color="#fff" />
              </TouchableOpacity>
            )}

            {/* Photo number badge */}
            <View style={styles.numBadge}>
              <AppText variant="micro" style={styles.numText}>{index + 1}</AppText>
            </View>
          </View>
        ))}

        {/* Add button */}
        {photos.length < MAX_PHOTOS && (
          <TouchableOpacity
            style={[styles.addCell, { borderColor: c.danger.base, backgroundColor: c.danger.soft }]}
            onPress={addPhoto}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-outline" size={28} color={c.danger.base} />
            <AppText variant="micro" center style={{ color: c.danger.on, marginTop: 4 }}>
              {t('accident.addPhoto')}
            </AppText>
          </TouchableOpacity>
        )}
      </View>

      {photos.length > 0 && (
        <AppText variant="caption" color="muted" style={{ textAlign: 'right' }}>
          {photos.length} / {MAX_PHOTOS} photos
        </AppText>
      )}
    </View>
  )
}

const CELL_SIZE = 104

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
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
