/**
 * AccidentPhotoGrid
 *
 * Multi-photo capture grid for accident reports.
 * Each photo is uploaded to the `accident-photos` Supabase Storage bucket.
 * Displays thumbnails in a 3-column grid with delete overlay.
 * Passes back an array of permanent public URLs to the parent.
 */

import { useState } from 'react'
import {
  View, Text, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator,
  ScrollView,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { uploadAccidentPhoto } from '../lib/photoUpload'
import { useLanguage } from '../contexts/LanguageContext'

const MAX_PHOTOS = 10

interface Props {
  photos: string[]           // array of public URLs (or local URIs before upload)
  localUris: string[]        // parallel array of local preview URIs
  onPhotosChange: (urls: string[], localUris: string[]) => void
  onUploadingChange?: (isUploading: boolean) => void
}

export default function AccidentPhotoGrid({ photos, localUris, onPhotosChange, onUploadingChange }: Props) {
  const { t } = useLanguage()
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

    // Upload in background (base64 → public bucket; reliable in Expo/RN)
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
          <View key={index} style={styles.cell}>
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />

            {/* Upload indicator */}
            {uploadingIndex === index && (
              <View style={styles.uploadingOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}

            {/* Cloud saved indicator */}
            {uploadingIndex !== index && photos[index] && photos[index] !== uri && (
              <View style={styles.cloudBadge}>
                <Ionicons name="cloud-done" size={12} color="#fff" />
              </View>
            )}

            {/* Delete button */}
            {uploadingIndex !== index && (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => removePhoto(index)}
                hitSlop={{ top: 4, right: 4, bottom: 4, left: 4 }}
              >
                <Ionicons name="close-circle" size={20} color="#fff" />
              </TouchableOpacity>
            )}

            {/* Photo number badge */}
            <View style={styles.numBadge}>
              <Text style={styles.numText}>{index + 1}</Text>
            </View>
          </View>
        ))}

        {/* Add button */}
        {photos.length < MAX_PHOTOS && (
          <TouchableOpacity
            style={styles.addCell}
            onPress={addPhoto}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-outline" size={26} color="#dc2626" />
            <Text style={styles.addText}>{t('accident.addPhoto')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {photos.length > 0 && (
        <Text style={styles.countText}>
          {photos.length} / {MAX_PHOTOS} photos
        </Text>
      )}
    </View>
  )
}

const CELL_SIZE = 100

const styles = StyleSheet.create({
  container: { gap: 8 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#f1f5f9',
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
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(22,163,74,0.85)',
    borderRadius: 8,
    padding: 2,
  },
  deleteBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
  },
  numBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  numText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '700',
  },
  addCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(220,38,38,0.3)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(220,38,38,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#dc2626',
    textAlign: 'center',
  },
  countText: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'right',
  },
})
