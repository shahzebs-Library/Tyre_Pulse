import { useState } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { UserRole } from '../../lib/types'

const ROLES: UserRole[] = ['tyre_man', 'inspector', 'admin', 'manager', 'director']
const POSITIONS = ['FL', 'FR', 'RL', 'RR', 'RLO', 'RLI', 'RRO', 'RRI', 'Spare']

export default function TyreChangeScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
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
  const [saving, setSaving] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  async function submit() {
    if (saving) return
    if (!assetNo.trim()) { Alert.alert('Missing asset', 'Enter the asset number.'); return }
    if (!position.trim()) { Alert.alert('Missing position', 'Select or enter the tyre position.'); return }
    setSaving(true)
    const today = new Date().toISOString().split('T')[0]
    const sn = serial.trim() || null
    const { error } = await supabase.from('tyre_records').insert({
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
    })
    setSaving(false)
    if (error) { Alert.alert('Could not save', error.message); return }
    Alert.alert('Tyre recorded', 'The new fitment has been saved.', [
      { text: 'Add another', onPress: () => { setPosition(''); setSerial(''); setBrand(''); setSize(''); setCost(''); setKmFit(''); setTread('') } },
      { text: 'Done', onPress: () => router.back() },
    ])
  }

  if (!allowed) return null

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <Text style={[styles.title, { textAlign }]}>Record Tyre Change</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>Asset No.</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="TM-001" placeholderTextColor="#94a3b8" value={assetNo} onChangeText={setAssetNo} autoCapitalize="characters" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>Site</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="Site" placeholderTextColor="#94a3b8" value={site} onChangeText={setSite} />
            </View>
          </View>

          <Text style={[styles.label, { textAlign }]}>Position</Text>
          <View style={styles.chipRow}>
            {POSITIONS.map(p => (
              <TouchableOpacity key={p} style={[styles.chip, position === p && styles.chipActive]} onPress={() => setPosition(p)}>
                <Text style={[styles.chipText, position === p && styles.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={[styles.input, { textAlign, marginTop: 8 }]} placeholder="Or type a custom position" placeholderTextColor="#94a3b8" value={position} onChangeText={setPosition} autoCapitalize="characters" />

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>Brand</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="Brand" placeholderTextColor="#94a3b8" value={brand} onChangeText={setBrand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>Size</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="e.g. 315/80R22.5" placeholderTextColor="#94a3b8" value={size} onChangeText={setSize} />
            </View>
          </View>

          <Text style={[styles.label, { textAlign }]}>Serial No.</Text>
          <TextInput style={[styles.input, { textAlign }]} placeholder="Tyre serial" placeholderTextColor="#94a3b8" value={serial} onChangeText={setSerial} autoCapitalize="characters" />

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>Cost</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="0" placeholderTextColor="#94a3b8" value={cost} onChangeText={setCost} keyboardType="numeric" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>Odometer (km)</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="km" placeholderTextColor="#94a3b8" value={kmFit} onChangeText={setKmFit} keyboardType="numeric" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>Tread (mm)</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="mm" placeholderTextColor="#94a3b8" value={tread} onChangeText={setTread} keyboardType="numeric" />
            </View>
          </View>

          <Text style={[styles.label, { textAlign }]}>Reason for change (optional)</Text>
          <TextInput style={[styles.input, styles.textarea, { textAlign }]} placeholder="e.g. Worn out, puncture, scheduled rotation" placeholderTextColor="#94a3b8" value={removalReason} onChangeText={setRemovalReason} multiline />

          <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="save" size={18} color="#fff" />
                <Text style={styles.submitText}>Save Tyre Change</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  rowR: { flexDirection: 'row-reverse' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  content: { padding: 16, gap: 6, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '700', color: '#475569', marginTop: 10 },
  input: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#0f172a', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 12.5, fontWeight: '700', color: '#64748b' },
  chipTextActive: { color: '#fff' },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#16a34a', borderRadius: 14, padding: 16, marginTop: 22, shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  submitText: { fontSize: 16, fontWeight: '800', color: '#fff' },
})
