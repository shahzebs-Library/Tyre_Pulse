/**
 * Upload Approvals (mobile, admin-only)
 *
 * Reviews the shared `pending_uploads` queue (uploads submitted by non-admins
 * from the web). Approve inserts the staged rows into their target table; reject
 * marks the batch rejected. Mirrors the web Upload Approvals screen.
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, RefreshControl, TextInput, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { useAdminGuard } from '../../../hooks/useRoleGuard'
import { COUNTRIES } from '../../../lib/types'

interface PendingUpload {
  id: string
  batch_id: string
  uploader_name: string | null
  country: string | null
  upload_type: string
  target_table: string
  file_name: string | null
  row_count: number
  rows: any[]
  status: string
  review_note: string | null
  created_at: string
}

const TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  tyres: { label: 'Tyre Records', icon: 'document-text-outline', color: '#16a34a' },
  stock: { label: 'Stock',        icon: 'cube-outline',          color: '#0891b2' },
}
const BATCH = 500

export default function UploadApprovalsScreen() {
  const { allowed, loading: guardLoading } = useAdminGuard()
  const { profile } = useAuth()
  const router = useRouter()

  const [items, setItems]     = useState<PendingUpload[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [acting, setActing]   = useState<string | null>(null)
  const [search, setSearch]   = useState('')
  const [tab, setTab]         = useState<'pending' | 'history'>('pending')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('pending_uploads')
      .select('id, batch_id, uploader_name, country, upload_type, target_table, file_name, row_count, rows, status, review_note, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems((data ?? []) as PendingUpload[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!allowed) return
    const ch = supabase
      .channel('realtime:pending_uploads_mobile')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_uploads' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [allowed, load])

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  function approve(p: PendingUpload) {
    Alert.alert(
      'Approve Upload',
      `Insert ${p.row_count} ${TYPE_META[p.upload_type]?.label ?? 'records'} into ${p.country ?? '—'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setActing(p.id)
            const rows = Array.isArray(p.rows) ? p.rows : []
            for (let i = 0; i < rows.length; i += BATCH) {
              const { error } = await supabase.from(p.target_table).insert(rows.slice(i, i + BATCH))
              if (error) { setActing(null); Alert.alert('Insert failed', error.message); return }
            }
            const { error: updErr } = await supabase.from('pending_uploads')
              .update({ status: 'approved', reviewed_by: profile?.id, reviewed_at: new Date().toISOString() })
              .eq('id', p.id)
            setActing(null)
            if (updErr) Alert.alert('Error', updErr.message)
            else { setItems(prev => prev.map(x => x.id === p.id ? { ...x, status: 'approved' } : x)) }
          },
        },
      ]
    )
  }

  // Quick correction on mobile: re-stamp the whole batch (and every row) to the
  // right country before approving. Detailed per-cell edits are on the web.
  function correctCountry(p: PendingUpload) {
    Alert.alert(
      'Set Country for Batch',
      `Currently: ${p.country ?? 'none'}. This stamps every row with the chosen country.`,
      [
        ...COUNTRIES.map(c => ({
          text: c,
          onPress: async () => {
            setActing(p.id)
            const newRows = (Array.isArray(p.rows) ? p.rows : []).map(r => ({ ...r, country: c }))
            const { error } = await supabase.from('pending_uploads')
              .update({ rows: newRows, country: c }).eq('id', p.id)
            setActing(null)
            if (error) Alert.alert('Error', error.message)
            else setItems(prev => prev.map(x => x.id === p.id ? { ...x, rows: newRows, country: c } : x))
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    )
  }

  function reject(p: PendingUpload) {
    Alert.alert(
      'Reject Upload',
      `Reject "${p.file_name ?? 'this upload'}" (${p.row_count} rows)? The data will not be imported.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setActing(p.id)
            const { error } = await supabase.from('pending_uploads')
              .update({ status: 'rejected', reviewed_by: profile?.id, reviewed_at: new Date().toISOString() })
              .eq('id', p.id)
            setActing(null)
            if (error) Alert.alert('Error', error.message)
            else setItems(prev => prev.map(x => x.id === p.id ? { ...x, status: 'rejected' } : x))
          },
        },
      ]
    )
  }

  const pending = items.filter(i => i.status === 'pending')
  const list = tab === 'pending' ? pending : items.filter(i => i.status !== 'pending')
  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => q
    ? list.filter(p =>
        (p.file_name ?? '').toLowerCase().includes(q) ||
        (p.uploader_name ?? '').toLowerCase().includes(q) ||
        (p.country ?? '').toLowerCase().includes(q))
    : list, [list, q])

  if (guardLoading || !allowed || loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor="#065f46" />
        <View style={styles.loader}><ActivityIndicator size="large" color="#16a34a" /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#065f46" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Upload Approvals</Text>
          <Text style={styles.headerSub}>{pending.length} awaiting · {pending.reduce((a, p) => a + (p.row_count || 0), 0).toLocaleString()} rows</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#94a3b8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search file, uploader, country…"
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
      </View>

      <View style={styles.filterRow}>
        {([['pending', `Pending (${pending.length})`], ['history', 'History']] as const).map(([key, label]) => (
          <TouchableOpacity key={key} style={[styles.filterTab, tab === key && styles.filterTabActive]} onPress={() => setTab(key)}>
            <Text style={[styles.filterTabText, tab === key && styles.filterTabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
      >
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-outline" size={52} color="#86efac" />
            <Text style={styles.emptyTitle}>{tab === 'pending' ? 'Nothing to approve' : 'No history yet'}</Text>
            <Text style={styles.emptyHint}>
              {tab === 'pending' ? 'Uploads submitted by non-admins appear here.' : 'Approved and rejected uploads will show here.'}
            </Text>
          </View>
        ) : (
          filtered.map(p => {
            const meta = TYPE_META[p.upload_type] ?? TYPE_META.tyres
            const busy = acting === p.id
            return (
              <View key={p.id} style={styles.card}>
                <View style={[styles.typeStrip, { backgroundColor: meta.color }]} />
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <View style={[styles.typeIcon, { backgroundColor: meta.color + '1a' }]}>
                      <Ionicons name={meta.icon as any} size={18} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fileName} numberOfLines={1}>{p.file_name || 'Untitled upload'}</Text>
                      <Text style={styles.metaLine}>
                        {(p.row_count || 0).toLocaleString()} rows · {meta.label}
                      </Text>
                    </View>
                    {p.status !== 'pending' && (
                      <View style={[styles.statusBadge, { backgroundColor: p.status === 'approved' ? '#dcfce7' : '#fee2e2' }]}>
                        <Text style={[styles.statusText, { color: p.status === 'approved' ? '#16a34a' : '#dc2626' }]}>
                          {p.status === 'approved' ? 'Approved' : 'Rejected'}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.chips}>
                    <View style={styles.chip}><Ionicons name="person-outline" size={11} color="#64748b" /><Text style={styles.chipText}>{p.uploader_name || 'Unknown'}</Text></View>
                    {p.status === 'pending' ? (
                      <TouchableOpacity style={[styles.chip, styles.chipEditable]} onPress={() => correctCountry(p)} disabled={busy}>
                        <Ionicons name="earth-outline" size={11} color="#0891b2" />
                        <Text style={[styles.chipText, { color: '#0891b2', fontWeight: '700' }]}>{p.country || 'Set country'}</Text>
                        <Ionicons name="chevron-down" size={10} color="#0891b2" />
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.chip}><Ionicons name="earth-outline" size={11} color="#64748b" /><Text style={styles.chipText}>{p.country || '—'}</Text></View>
                    )}
                    <View style={styles.chip}><Ionicons name="time-outline" size={11} color="#64748b" /><Text style={styles.chipText}>{new Date(p.created_at).toLocaleDateString()}</Text></View>
                  </View>

                  {p.status === 'pending' && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity style={styles.rejectBtn} onPress={() => reject(p)} disabled={busy}>
                        {busy ? <ActivityIndicator size="small" color="#dc2626" />
                          : <><Ionicons name="close-outline" size={16} color="#dc2626" /><Text style={styles.rejectBtnText}>Reject</Text></>}
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.approveBtn} onPress={() => approve(p)} disabled={busy}>
                        {busy ? <ActivityIndicator size="small" color="#fff" />
                          : <><Ionicons name="checkmark-outline" size={16} color="#fff" /><Text style={styles.approveBtnText}>Approve</Text></>}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            )
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#f0fdf4' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content:{ padding: 16, gap: 10, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#065f46', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn:    { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  headerTitle:{ fontSize: 17, fontWeight: '800', color: '#fff' },
  headerSub:  { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 1 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  searchInput:{ flex: 1, fontSize: 13, color: '#0f172a', padding: 0 },
  filterRow:  { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  filterTab:  { flex: 1, paddingVertical: 10, alignItems: 'center' },
  filterTabActive: { borderBottomWidth: 2, borderBottomColor: '#16a34a' },
  filterTabText: { fontSize: 12, fontWeight: '600', color: '#94a3b8' },
  filterTabTextActive: { color: '#16a34a', fontWeight: '800' },
  card:   { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  typeStrip: { width: 4 },
  cardBody:  { flex: 1, padding: 14, gap: 10 },
  cardTop:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  typeIcon:  { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  fileName:  { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  metaLine:  { fontSize: 11, color: '#64748b', marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText:  { fontSize: 10, fontWeight: '700' },
  chips:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#f8fafc' },
  chipEditable: { backgroundColor: '#ecfeff', borderWidth: 1, borderColor: '#a5f3fc' },
  chipText: { fontSize: 11, color: '#64748b' },
  actionRow:  { flexDirection: 'row', gap: 8, marginTop: 2 },
  rejectBtn:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: '#fecaca', backgroundColor: '#fff5f5' },
  rejectBtnText: { fontSize: 13, fontWeight: '700', color: '#dc2626' },
  approveBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 10, backgroundColor: '#16a34a' },
  approveBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  empty:      { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptyHint:  { fontSize: 13, color: '#94a3b8', textAlign: 'center', paddingHorizontal: 20 },
})
