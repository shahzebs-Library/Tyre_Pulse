import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Modal, TextInput,
  RefreshControl, StatusBar, ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRealtime } from '../../hooks/useRealtime'
import { canInspect } from '../../lib/permissions'

interface Rca {
  id: string
  asset_no: string | null
  tyre_serial: string | null
  brand: string | null
  site: string | null
  failure_date: string | null
  km_at_failure: number | null
  root_cause: string | null
  contributing_factors: string[] | null
  created_at: string | null
}

const FACTORS = [
  'Under-inflation', 'Over-inflation', 'Overload', 'Misalignment',
  'Road hazard', 'Manufacturing defect', 'Driver behaviour', 'Worn out', 'Brake issue',
]

export default function RcaScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const router = useRouter()
  const params = useLocalSearchParams<{ asset?: string; site?: string; serial?: string; brand?: string }>()
  const [rows, setRows] = useState<Rca[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // form
  const [asset, setAsset] = useState(params.asset ?? '')
  const [serial, setSerial] = useState(params.serial ?? '')
  const [brand, setBrand] = useState(params.brand ?? '')
  const [site, setSite] = useState(params.site ?? profile?.site ?? '')
  const [km, setKm] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [factors, setFactors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'
  const mayCreate = canInspect(profile?.role)

  const load = useCallback(async () => {
    let q = supabase
      .from('rca_records')
      .select('id,asset_no,tyre_serial,brand,site,failure_date,km_at_failure,root_cause,contributing_factors,created_at')
      .order('created_at', { ascending: false })
      .limit(300)
    if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
    const { data } = await q
    setRows((data as Rca[]) ?? [])
    setLoading(false)
  }, [profile?.country])

  useEffect(() => { load() }, [load])
  useRealtime('rca_records', load)
  useEffect(() => { if (params.asset || params.serial) setShowForm(true) }, [params.asset, params.serial])

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  function toggleFactor(f: string) {
    setFactors(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  async function create() {
    if (saving) return
    if (!rootCause.trim()) { Alert.alert('Missing root cause', 'Describe the identified root cause.'); return }
    setSaving(true)
    const { error } = await supabase.from('rca_records').insert({
      asset_no: asset.trim() || null,
      tyre_serial: serial.trim() || null,
      brand: brand.trim() || null,
      site: site.trim() || null,
      failure_date: new Date().toISOString().split('T')[0],
      km_at_failure: km ? Number(km) : null,
      root_cause: rootCause.trim(),
      contributing_factors: factors.length ? factors : null,
      country: profile?.country ?? null,
      created_by: profile?.id ?? null,
    })
    setSaving(false)
    if (error) { Alert.alert('Could not save', error.message); return }
    setShowForm(false); setRootCause(''); setFactors([]); setKm(''); setSerial('')
    load()
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { textAlign }]}>Root Cause Analysis</Text>
          <Text style={[styles.sub, { textAlign }]}>{rows.length} record{rows.length === 1 ? '' : 's'}</Text>
        </View>
        {mayCreate && (
          <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
          ListEmptyComponent={<View style={styles.empty}><Ionicons name="search-outline" size={48} color="#cbd5e1" /><Text style={styles.emptyText}>No analyses yet</Text></View>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.rcaIcon}><Ionicons name="git-network-outline" size={18} color="#7c3aed" /></View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.cardTitle, { textAlign }]}>{item.asset_no ?? 'Unknown'}{item.brand ? ` · ${item.brand}` : ''}</Text>
                <Text style={[styles.cardCause, { textAlign }]} numberOfLines={3}>{item.root_cause}</Text>
                <View style={[styles.badges, isRTL && styles.rowR]}>
                  {(item.contributing_factors ?? []).slice(0, 3).map(f => (
                    <View key={f} style={styles.factorBadge}><Text style={styles.factorText}>{f}</Text></View>
                  ))}
                </View>
                <Text style={[styles.cardMeta, { textAlign }]}>
                  {[item.site, item.failure_date, item.km_at_failure != null ? `${item.km_at_failure} km` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={[styles.sheetHead, isRTL && styles.rowR]}>
              <Text style={styles.sheetTitle}>New Analysis</Text>
              <TouchableOpacity onPress={() => setShowForm(false)}><Ionicons name="close" size={24} color="#64748b" /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Asset No.</Text>
                  <TextInput style={styles.input} placeholder="TM-001" placeholderTextColor="#94a3b8" value={asset} onChangeText={setAsset} autoCapitalize="characters" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Serial</Text>
                  <TextInput style={styles.input} placeholder="Tyre serial" placeholderTextColor="#94a3b8" value={serial} onChangeText={setSerial} autoCapitalize="characters" />
                </View>
              </View>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Brand</Text>
                  <TextInput style={styles.input} placeholder="Brand" placeholderTextColor="#94a3b8" value={brand} onChangeText={setBrand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Km at failure</Text>
                  <TextInput style={styles.input} placeholder="km" placeholderTextColor="#94a3b8" value={km} onChangeText={setKm} keyboardType="numeric" />
                </View>
              </View>
              <Text style={styles.label}>Contributing factors</Text>
              <View style={styles.chipRow}>
                {FACTORS.map(f => (
                  <TouchableOpacity key={f} style={[styles.chip, factors.includes(f) && styles.chipActive]} onPress={() => toggleFactor(f)}>
                    <Text style={[styles.chipText, factors.includes(f) && styles.chipTextActive]}>{f}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Root cause</Text>
              <TextInput style={[styles.input, styles.textarea]} placeholder="What caused the failure…" placeholderTextColor="#94a3b8" value={rootCause} onChangeText={setRootCause} multiline />
              <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={create} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Save Analysis</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  rowR: { flexDirection: 'row-reverse' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  sub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  newBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  rcaIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(124,58,237,0.1)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  cardCause: { fontSize: 12.5, color: '#475569' },
  cardMeta: { fontSize: 11, color: '#94a3b8' },
  badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  factorBadge: { backgroundColor: 'rgba(124,58,237,0.08)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  factorText: { fontSize: 10, fontWeight: '700', color: '#7c3aed' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#94a3b8' },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#f0f5f1', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, maxHeight: '90%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  label: { fontSize: 13, fontWeight: '700', color: '#475569', marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#0f172a', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  chipActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  chipTextActive: { color: '#fff' },
  submit: { backgroundColor: '#7c3aed', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 20, marginBottom: 12 },
  submitText: { fontSize: 16, fontWeight: '800', color: '#fff' },
})
