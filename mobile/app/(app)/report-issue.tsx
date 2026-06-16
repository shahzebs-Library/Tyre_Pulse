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

const ROLES: UserRole[] = ['inspector', 'tyre_man', 'admin', 'manager', 'director']
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const
const PRI_COLOR: Record<string, string> = { Low: '#16a34a', Medium: '#ca8a04', High: '#ea580c', Critical: '#dc2626' }
const DUE_PRESETS = [
  { label: 'No date', days: null as number | null },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
]

export default function ReportIssueScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const router = useRouter()
  const params = useLocalSearchParams<{ asset?: string; site?: string; serial?: string }>()
  const { allowed } = useRoleGuard(ROLES)

  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('Medium')
  const [site, setSite] = useState(params.site ?? profile?.site ?? '')
  const [assetNo, setAssetNo] = useState(params.asset ?? '')
  const [description, setDescription] = useState('')
  const [dueDays, setDueDays] = useState<number | null>(7)
  const [saving, setSaving] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  async function submit() {
    if (saving) return
    if (!title.trim()) { Alert.alert('Missing title', 'Please describe the issue briefly.'); return }
    setSaving(true)
    const due = dueDays != null ? new Date(Date.now() + dueDays * 86400000).toISOString() : null
    const { error } = await supabase.from('corrective_actions').insert({
      title: title.trim(),
      priority,
      site: site.trim() || null,
      asset_no: assetNo.trim() || null,
      tyre_serial: params.serial ?? null,
      description: description.trim() || null,
      status: 'Open',
      assigned_to: profile?.full_name ?? profile?.username ?? null,
      due_date: due,
      country: profile?.country ?? null,
      created_by: profile?.id ?? null,
    })
    setSaving(false)
    if (error) { Alert.alert('Could not submit', error.message); return }
    Alert.alert('Issue raised', 'The corrective action has been created.', [
      { text: 'OK', onPress: () => router.replace('/(app)/tasks') },
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
        <Text style={[styles.title, { textAlign }]}>Report an Issue</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { textAlign }]}>What's the problem?</Text>
          <TextInput
            style={[styles.input, { textAlign }]}
            placeholder="e.g. Rapid wear on front-left tyre"
            placeholderTextColor="#94a3b8"
            value={title}
            onChangeText={setTitle}
          />

          <Text style={[styles.label, { textAlign }]}>Priority</Text>
          <View style={styles.chipRow}>
            {PRIORITIES.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.chip, priority === p && { backgroundColor: PRI_COLOR[p], borderColor: PRI_COLOR[p] }]}
                onPress={() => setPriority(p)}
              >
                <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>Site</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="Site" placeholderTextColor="#94a3b8" value={site} onChangeText={setSite} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { textAlign }]}>Asset No.</Text>
              <TextInput style={[styles.input, { textAlign }]} placeholder="Asset" placeholderTextColor="#94a3b8" value={assetNo} onChangeText={setAssetNo} autoCapitalize="characters" />
            </View>
          </View>

          <Text style={[styles.label, { textAlign }]}>Due in</Text>
          <View style={styles.chipRow}>
            {DUE_PRESETS.map(d => (
              <TouchableOpacity
                key={d.label}
                style={[styles.chip, dueDays === d.days && styles.chipActiveGreen]}
                onPress={() => setDueDays(d.days)}
              >
                <Text style={[styles.chipText, dueDays === d.days && styles.chipTextActive]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { textAlign }]}>Details (optional)</Text>
          <TextInput
            style={[styles.input, styles.textarea, { textAlign }]}
            placeholder="Anything else the team should know…"
            placeholderTextColor="#94a3b8"
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="send" size={18} color="#fff" />
                <Text style={styles.submitText}>Raise Issue</Text>
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
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '700', color: '#475569', marginTop: 10 },
  input: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#0f172a', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  chipActiveGreen: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 12.5, fontWeight: '700', color: '#64748b' },
  chipTextActive: { color: '#fff' },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#16a34a', borderRadius: 14, padding: 16, marginTop: 20, shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  submitText: { fontSize: 16, fontWeight: '800', color: '#fff' },
})
