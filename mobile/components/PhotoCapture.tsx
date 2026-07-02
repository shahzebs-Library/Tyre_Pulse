/**
 * PhotoCapture
 *
 * Reusable multi-photo capture grid. Captures via camera and uploads each image
 * to the PRIVATE `tyre-photos` bucket (module-scoped), reporting back an array
 * of tp-storage:// references (resolved to short-lived signed URLs on display).
 * Used by Report Issue, RCA and Tyre Change.
 *
 * Offline-safe: if an upload can't complete (no connection), the local file://
 * URI is KEPT in the value array rather than discarded, so the photo is never
 * lost. The typed record queue (recordQueue) re-uploads any pending file:// URI
 * before the record is inserted - matching the inspection queue's behaviour.
 */
import { useState } from 'react'
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { uploadModulePhoto } from '../lib/photoUpload'
import * as ImagePicker from 'expo-image-picker'

interface Props {
  value: string[]                       // tp-storage:// refs, or file:// URIs pending upload
  onChange: (urls: string[]) => void
  /** Module slug used for the storage path + bucket scoping. */
  module?: string
  tint?: string
  max?: number
  label?: string
}

const isPending = (u?: string) => !!u && u.startsWith('file://')

export default function PhotoCapture({ value, onChange, module = 'module', tint = '#16a34a', max = 6, label = 'Add Photo' }: Props) {
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
    onChange([...value, uri])          // keep the local URI so nothing is lost

    setUploadingIndex(idx)
    try {
      const ref = await uploadModulePhoto(uri, module, idx)
      // On success store the permanent ref; on failure (e.g. offline) KEEP the
      // local file:// URI - the record queue re-uploads it before insert.
      const next = [...value, ref || uri]
      onChange(next)
      if (!ref) {
        Alert.alert(
          'Saved offline',
          'Photo will upload automatically when you are back online.',
        )
      }
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
          {uploadingIndex !== index && url && !isPending(url) ? (
            <View style={styles.cloud}><Ionicons name="cloud-done" size={12} color="#fff" /></View>
          ) : null}
          {uploadingIndex !== index && isPending(url) ? (
            <View style={styles.pending}><Ionicons name="cloud-offline" size={12} color="#fff" /></View>
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
  pending: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(245,158,11,0.9)', borderRadius: 8, padding: 2 },
  del: { position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10 },
  add: { width: SIZE, height: SIZE, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  addText: { fontSize: 10.5, fontWeight: '700', textAlign: 'center' },
})
