/**
 * PhotoCapture
 *
 * Reusable multi-photo capture grid. Captures via camera, uploads each image
 * to the public `tyre-photos` Supabase Storage bucket, and reports back an
 * array of permanent public URLs. Used by Report Issue, RCA and Tyre Change.
 */
import { useState } from 'react'
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { uploadAccidentPhoto } from '../lib/photoUpload'

interface Props {
  value: string[]                       // permanent public URLs
  onChange: (urls: string[]) => void
  tint?: string
  max?: number
  label?: string
}

export default function PhotoCapture({ value, onChange, tint = '#16a34a', max = 6, label = 'Add Photo' }: Props) {
  // local preview URIs, parallel to `value`
  const [localUris, setLocalUris] = useState<string[]>([])
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)

  async function addPhoto() {
    if (value.length >= max) { Alert.alert('Maximum photos', `Up to ${max} photos.`); return }
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Camera needed', 'Enable camera access to attach photos.'); return }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, allowsEditing: false,
    })
    if (result.canceled || !result.assets[0]) return

    const uri = result.assets[0].uri
    const idx = value.length
    setLocalUris(prev => [...prev, uri])
    onChange([...value, ''])          // placeholder slot for instant preview

    setUploadingIndex(idx)
    try {
      const url = await uploadAccidentPhoto(uri, idx)
      onChange([...value, url || ''])  // replace the placeholder slot at idx
      if (!url) Alert.alert('Upload failed', 'Could not upload photo. Check your connection and retry.')
    } finally {
      setUploadingIndex(null)
    }
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
    setLocalUris(localUris.filter((_, i) => i !== index))
  }

  return (
    <View style={styles.grid}>
      {value.map((url, index) => (
        <View key={index} style={styles.cell}>
          <Image source={{ uri: localUris[index] || url }} style={styles.thumb} resizeMode="cover" />
          {uploadingIndex === index && (
            <View style={styles.overlay}><ActivityIndicator size="small" color="#fff" /></View>
          )}
          {uploadingIndex !== index && url ? (
            <View style={styles.cloud}><Ionicons name="cloud-done" size={12} color="#fff" /></View>
          ) : null}
          {uploadingIndex !== index && (
            <TouchableOpacity style={styles.del} onPress={() => remove(index)} hitSlop={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <Ionicons name="close-circle" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      ))}
      {value.length < max && (
        <TouchableOpacity style={[styles.add, { borderColor: tint + '55', backgroundColor: tint + '0d' }]} onPress={addPhoto} activeOpacity={0.7}>
          <Ionicons name="camera-outline" size={24} color={tint} />
          <Text style={[styles.addText, { color: tint }]}>{label}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const SIZE = 90
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: SIZE, height: SIZE, borderRadius: 10, overflow: 'hidden', position: 'relative', backgroundColor: '#f1f5f9' },
  thumb: { width: '100%', height: '100%' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  cloud: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(22,163,74,0.85)', borderRadius: 8, padding: 2 },
  del: { position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10 },
  add: { width: SIZE, height: SIZE, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  addText: { fontSize: 10.5, fontWeight: '700', textAlign: 'center' },
})
