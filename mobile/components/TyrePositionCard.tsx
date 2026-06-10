import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, Image,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { TyrePositionData, TyreCondition } from '../lib/types'

const CONDITIONS: TyreCondition[] = ['Good', 'Worn', 'Damaged', 'Flat', 'Missing']

const CONDITION_COLORS: Record<TyreCondition, string> = {
  Good:    '#16a34a',
  Worn:    '#f59e0b',
  Damaged: '#ef4444',
  Flat:    '#dc2626',
  Missing: '#6b7280',
}

interface Props {
  data: TyrePositionData
  onChange: (updated: TyrePositionData) => void
}

export default function TyrePositionCard({ data, onChange }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [pickingPhoto, setPickingPhoto] = useState(false)

  function update(partial: Partial<TyrePositionData>) {
    onChange({ ...data, ...partial })
  }

  async function pickPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Camera permission needed', 'Please allow camera access in your device settings.')
      return
    }
    setPickingPhoto(true)
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: false,
      })
      if (!result.canceled && result.assets[0]) {
        update({ photo_uri: result.assets[0].uri })
      }
    } finally {
      setPickingPhoto(false)
    }
  }

  const conditionColor = CONDITION_COLORS[data.condition]
  const hasData = data.pressure_psi || data.tread_depth_mm || data.serial_number || data.photo_uri

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded(e => !e)} activeOpacity={0.7}>
        <View style={styles.positionBadge}>
          <Text style={styles.positionText}>{data.position}</Text>
        </View>
        <View style={styles.summary}>
          <View style={[styles.conditionDot, { backgroundColor: conditionColor }]} />
          <Text style={styles.conditionLabel}>{data.condition}</Text>
          {data.pressure_psi ? <Text style={styles.metaText}>{data.pressure_psi} PSI</Text> : null}
          {data.tread_depth_mm ? <Text style={styles.metaText}>{data.tread_depth_mm}mm</Text> : null}
          {data.photo_uri ? <Ionicons name="camera" size={14} color="#16a34a" /> : null}
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
            <Text style={styles.label}>Serial Number</Text>
            <TextInput
              style={styles.input}
              value={data.serial_number}
              onChangeText={v => update({ serial_number: v })}
              placeholder="e.g. MH2024001"
              placeholderTextColor="#94a3b8"
              autoCapitalize="characters"
            />
          </View>

          {/* Pressure + Tread row */}
          <View style={styles.row}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Pressure (PSI)</Text>
              <TextInput
                style={styles.input}
                value={data.pressure_psi}
                onChangeText={v => update({ pressure_psi: v })}
                placeholder="100"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Tread Depth (mm)</Text>
              <TextInput
                style={styles.input}
                value={data.tread_depth_mm}
                onChangeText={v => update({ tread_depth_mm: v })}
                placeholder="8.0"
                placeholderTextColor="#94a3b8"
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          {/* Condition */}
          <View style={styles.field}>
            <Text style={styles.label}>Condition</Text>
            <View style={styles.conditionRow}>
              {CONDITIONS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.conditionBtn,
                    data.condition === c && { backgroundColor: CONDITION_COLORS[c], borderColor: CONDITION_COLORS[c] },
                  ]}
                  onPress={() => update({ condition: c })}
                >
                  <Text
                    style={[
                      styles.conditionBtnText,
                      data.condition === c && { color: '#fff' },
                    ]}
                  >
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Photo */}
          <View style={styles.field}>
            <Text style={styles.label}>Photo</Text>
            {data.photo_uri ? (
              <View style={styles.photoContainer}>
                <Image source={{ uri: data.photo_uri }} style={styles.photo} />
                <TouchableOpacity style={styles.photoRetake} onPress={pickPhoto}>
                  <Ionicons name="camera-outline" size={16} color="#fff" />
                  <Text style={styles.photoRetakeText}>Retake</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto} disabled={pickingPhoto}>
                {pickingPhoto
                  ? <ActivityIndicator size="small" color="#16a34a" />
                  : <Ionicons name="camera-outline" size={22} color="#16a34a" />
                }
                <Text style={styles.photoBtnText}>
                  {pickingPhoto ? 'Opening camera…' : 'Take Photo'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Notes */}
          <View style={styles.field}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={data.notes}
              onChangeText={v => update({ notes: v })}
              placeholder="Optional notes for this tyre…"
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  positionBadge: {
    width: 46,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(22,163,74,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(22,163,74,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803d',
    letterSpacing: 0.5,
  },
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
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    gap: 14,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
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
  row: {
    flexDirection: 'row',
  },
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
