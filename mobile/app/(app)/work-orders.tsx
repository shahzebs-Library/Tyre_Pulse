import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Modal, TextInput,
  RefreshControl, StatusBar, ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { saveRecord } from '../../lib/recordQueue'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRealtime } from '../../hooks/useRealtime'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { canManageWorkOrders } from '../../lib/permissions'

interface WorkOrder {
  id: string
  work_order_no: string | null
  asset_no: string | null
  work_type: string | null
  status: string | null
  priority: string | null
  description: string | null
  site: string | null
  total_cost: number | null
  opened_at: string | null
}

type FilterKey = 'open' | 'all'
const WORK_TYPES = ['Tyre Change', 'Repair', 'Rotation', 'Alignment', 'Inspection', 'Other']
const STATUS_COLOR: Record<string, string> = {
  open: '#2563eb', 'in progress': '#ca8a04', completed: '#16a34a', closed: '#64748b',
}
const PRI_COLOR: Record<string, string> = { Low: '#16a34a', Medium: '#ca8a04', High: '#ea580c', Critical: '#dc2626' }
const NEXT_STATUS: Record<string, string> = { open: 'In Progress', 'in progress': 'Completed' }

export default function WorkOrdersScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const [rows, setRows] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('open')
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // create form
  const [asset, setAsset] = useState('')
  const [workType, setWorkType] = useState('Tyre Change')
  const [priority, setPriority] = useState<keyof typeof PRI_COLOR>('Medium')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const { allowed } = useRoleGuard(['inspector', 'admin', 'manager', 'director'])
  const textAlign = isRTL ? 'right' : 'left'
  const mayEdit = canManageWorkOrders(profile?.role)

  const load = useCallback(async () => {
    let q = supabase
      .from('work_orders')
      .select('id,work_order_no,asset_no,work_type,status,priority,description,site,total_cost,opened_at')
      .order('opened_at', { ascending: false })
      .limit(300)
    if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
    const { data } = await q
    setRows((data as WorkOrder[]) ?? [])
    setLoading(false)
  }, [profile?.country])

  useEffect(() => { load() }, [load])
  useRealtime('work_orders', load)

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  async function create() {
    if (saving) return
    if (!asset.trim()) { Alert.alert(t('modules.workOrders.missingAsset')); return }
    setSaving(true)
    const wono = `WO-${Date.now().toString().slice(-8)}`
    const res = await saveRecord('work_orders', {
      work_order_no: wono,
      asset_no: asset.trim(),
      work_type: workType,
      priority,
      description: desc.trim() || null,
      status: 'Open',
      site: profile?.site ?? null,
      country: profile?.country ?? null,
      technician_name: profile?.full_name ?? profile?.username ?? null,
      opened_at: new Date().toISOString(),
      created_by: profile?.id ?? null,
    })
    setSaving(false)
    if (res.offline) Alert.alert(t('modules.common.offlineSaved'))
    setShowForm(false); setAsset(''); setDesc(''); setWorkType('Tyre Change'); setPriority('Medium')
    load()
  }

  async function advance(wo: WorkOrder) {
    const cur = (wo.status ?? 'open').toLowerCase()
    const next = NEXT_STATUS[cur]
    if (!next || !mayEdit || busyId) return
    setBusyId(wo.id)
    const patch: any = { status: next }
    if (next === 'In Progress') patch.started_at = new Date().toISOString()
    if (next === 'Completed') patch.completed_at = new Date().toISOString()
    const { error } = await supabase.from('work_orders').update(patch).eq('id', wo.id)
    setBusyId(null)
    if (error) { Alert.alert('Update failed', error.message); return }
    load()
  }

  const shown = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter(w => !['completed', 'closed'].includes((w.status ?? '').toLowerCase()))
  }, [rows, filter])
  const openCount = useMemo(() => rows.filter(w => !['completed', 'closed'].includes((w.status ?? '').toLowerCase())).length, [rows])

  if (!allowed) return null

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { textAlign }]}>{t('modules.workOrders.title')}</Text>
          <Text style={[styles.sub, { textAlign }]}>{openCount} {t('modules.workOrders.active')}</Text>
        </View>
        {mayEdit && (
          <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filters}>
        {(['open', 'all'] as FilterKey[]).map(f => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f === 'open' ? t('modules.workOrders.filterActive') : t('modules.workOrders.filterAll')}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
          ListEmptyComponent={<View style={styles.empty}><Ionicons name="construct-outline" size={48} color="#cbd5e1" /><Text style={styles.emptyText}>{t('modules.workOrders.none')}</Text></View>}
          renderItem={({ item }) => {
            const sc = STATUS_COLOR[(item.status ?? 'open').toLowerCase()] ?? '#64748b'
            const pc = PRI_COLOR[item.priority ?? ''] ?? '#64748b'
            const next = NEXT_STATUS[(item.status ?? 'open').toLowerCase()]
            return (
              <View style={styles.card}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={[styles.cardTop, isRTL && styles.rowR]}>
                    <Text style={[styles.cardTitle, { textAlign }]}>{item.asset_no ?? '—'}</Text>
                    <Text style={styles.wono}>{item.work_order_no}</Text>
                  </View>
                  <Text style={[styles.cardMeta, { textAlign }]}>{item.work_type ?? 'Work'}{item.site ? ` · ${item.site}` : ''}</Text>
                  {item.description ? <Text style={[styles.cardDesc, { textAlign }]} numberOfLines={2}>{item.description}</Text> : null}
                  <View style={[styles.badges, isRTL && styles.rowR]}>
                    <View style={[styles.badge, { backgroundColor: sc + '1a' }]}><Text style={[styles.badgeText, { color: sc }]}>{item.status ?? 'Open'}</Text></View>
                    {item.priority ? <View style={[styles.badge, { backgroundColor: pc + '1a' }]}><Text style={[styles.badgeText, { color: pc }]}>{item.priority}</Text></View> : null}
                  </View>
                </View>
                {next && mayEdit && (
                  <TouchableOpacity style={styles.advBtn} onPress={() => advance(item)} disabled={busyId === item.id}>
                    {busyId === item.id ? <ActivityIndicator size="small" color="#16a34a" /> : (
                      <>
                        <Ionicons name="arrow-forward-circle" size={20} color="#16a34a" />
                        <Text style={styles.advText}>{next === 'In Progress' ? t('modules.workOrders.inProgress') : t('modules.workOrders.completed')}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )
          }}
        />
      )}

      {/* Create modal */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={[styles.sheetHead, isRTL && styles.rowR]}>
              <Text style={styles.sheetTitle}>{t('modules.workOrders.new')}</Text>
              <TouchableOpacity onPress={() => setShowForm(false)}><Ionicons name="close" size={24} color="#64748b" /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>{t('modules.common.asset')}</Text>
              <TextInput style={styles.input} placeholder="e.g. TM-001" placeholderTextColor="#94a3b8" value={asset} onChangeText={setAsset} autoCapitalize="characters" />
              <Text style={styles.label}>{t('modules.workOrders.workType')}</Text>
              <View style={styles.chipRow}>
                {WORK_TYPES.map(w => (
                  <TouchableOpacity key={w} style={[styles.chip, workType === w && styles.chipActive]} onPress={() => setWorkType(w)}>
                    <Text style={[styles.chipText, workType === w && styles.chipTextActive]}>{t(`modules.workTypes.${w}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>{t('modules.common.priority')}</Text>
              <View style={styles.chipRow}>
                {(Object.keys(PRI_COLOR) as (keyof typeof PRI_COLOR)[]).map(p => (
                  <TouchableOpacity key={p} style={[styles.chip, priority === p && { backgroundColor: PRI_COLOR[p], borderColor: PRI_COLOR[p] }]} onPress={() => setPriority(p)}>
                    <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{t(`modules.priority.${p}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>{t('modules.common.details')}</Text>
              <TextInput style={[styles.input, styles.textarea]} placeholder="What needs doing…" placeholderTextColor="#94a3b8" value={desc} onChangeText={setDesc} multiline />
              <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={create} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{t('modules.workOrders.create')}</Text>}
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
  newBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  chipTextActive: { color: '#fff' },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  wono: { fontSize: 11, fontWeight: '700', color: '#94a3b8' },
  cardMeta: { fontSize: 12, color: '#64748b' },
  cardDesc: { fontSize: 12, color: '#94a3b8' },
  badges: { flexDirection: 'row', gap: 6, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  advBtn: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 64 },
  advText: { fontSize: 9, fontWeight: '700', color: '#16a34a' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#94a3b8' },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#f0f5f1', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, maxHeight: '88%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  label: { fontSize: 13, fontWeight: '700', color: '#475569', marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#0f172a', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  submit: { backgroundColor: '#16a34a', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 20, marginBottom: 12 },
  submitText: { fontSize: 16, fontWeight: '800', color: '#fff' },
})
