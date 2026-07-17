import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity, Modal, TextInput,
  RefreshControl, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { saveCommand } from '../../lib/recordQueue'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme, spacing, radius, typography, elevation, statusColor, StatusKind } from '../../lib/theme'
import { Screen, AppText, Button, Badge, Loading, EmptyState } from '../../components/ui'
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
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const
const PRI_KIND: Record<string, StatusKind> = { Low: 'success', Medium: 'warning', High: 'danger', Critical: 'critical' }
const WO_STATUS_KIND: Record<string, StatusKind> = {
  open: 'info', 'in progress': 'warning', completed: 'success', closed: 'neutral',
}
const NEXT_STATUS: Record<string, string> = { open: 'In Progress', 'in progress': 'Completed' }

export default function WorkOrdersScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
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
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('Medium')
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
    const res = await saveCommand('WORK_ORDER', {
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
    const patch: Record<string, any> = { id: wo.id, status: next }
    if (next === 'In Progress') patch.started_at = new Date().toISOString()
    if (next === 'Completed') patch.completed_at = new Date().toISOString()
    // optimistic - keeps the new status visible even while queued offline
    setRows(prev => prev.map(r => r.id === wo.id ? { ...r, status: next } : r))
    // Typed offline queue: immediate when online, enqueued (idempotent replay by
    // id) when offline so status changes are never lost.
    const res = await saveCommand('WORK_ORDER_STATUS', patch)
    setBusyId(null)
    if (res.offline) { Alert.alert(t('modules.common.offlineSaved')); return }
    load()
  }

  const shown = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter(w => !['completed', 'closed'].includes((w.status ?? '').toLowerCase()))
  }, [rows, filter])
  const openCount = useMemo(() => rows.filter(w => !['completed', 'closed'].includes((w.status ?? '').toLowerCase())).length, [rows])

  if (!allowed) return null

  return (
    <Screen edges={['top']}>
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.workOrders.title')}</AppText>
          <AppText variant="caption" color="muted" style={{ textAlign }}>{openCount} {t('modules.workOrders.active')}</AppText>
        </View>
        {mayEdit && (
          <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)}>
            <Ionicons name="add" size={20} color={theme.color.onPrimary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filters}>
        {(['open', 'all'] as FilterKey[]).map(f => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
            <AppText style={[styles.chipText, filter === f && styles.chipTextActive]}>{f === 'open' ? t('modules.workOrders.filterActive') : t('modules.workOrders.filterAll')}</AppText>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <Loading />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />}
          ListEmptyComponent={<EmptyState icon="construct-outline" title={t('modules.workOrders.none')} />}
          renderItem={({ item }) => {
            const next = NEXT_STATUS[(item.status ?? 'open').toLowerCase()]
            return (
              <View style={styles.card}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={[styles.cardTop, isRTL && styles.rowR]}>
                    <AppText style={[styles.cardTitle, { textAlign }]}>{item.asset_no ?? '-'}</AppText>
                    <AppText variant="micro" color="muted">{item.work_order_no}</AppText>
                  </View>
                  <AppText variant="caption" color="secondary" style={{ textAlign }}>{item.work_type ?? t('modules.workOrders.workFallback')}{item.site ? ` · ${item.site}` : ''}</AppText>
                  {item.description ? <AppText variant="caption" color="muted" style={{ textAlign }} numberOfLines={2}>{item.description}</AppText> : null}
                  <View style={[styles.badges, isRTL && styles.rowR]}>
                    <Badge kind={WO_STATUS_KIND[(item.status ?? 'open').toLowerCase()] ?? 'neutral'}>{item.status ?? t('modules.workOrders.statusOpen')}</Badge>
                    {item.priority ? <Badge kind={PRI_KIND[item.priority] ?? 'neutral'}>{item.priority}</Badge> : null}
                  </View>
                </View>
                {next && mayEdit && (
                  <TouchableOpacity style={styles.advBtn} onPress={() => advance(item)} disabled={busyId === item.id}>
                    {busyId === item.id ? <Loading /> : (
                      <>
                        <Ionicons name="arrow-forward-circle" size={20} color={theme.color.primary} />
                        <AppText style={styles.advText}>{next === 'In Progress' ? t('modules.workOrders.inProgress') : t('modules.workOrders.completed')}</AppText>
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
              <AppText variant="h3">{t('modules.workOrders.new')}</AppText>
              <TouchableOpacity onPress={() => setShowForm(false)}><Ionicons name="close" size={24} color={theme.color.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <AppText style={styles.label}>{t('modules.common.asset')}</AppText>
              <TextInput style={styles.input} placeholder="e.g. TM-001" placeholderTextColor={theme.color.textMuted} value={asset} onChangeText={setAsset} autoCapitalize="characters" />
              <AppText style={styles.label}>{t('modules.workOrders.workType')}</AppText>
              <View style={styles.chipRow}>
                {WORK_TYPES.map(w => (
                  <TouchableOpacity key={w} style={[styles.chip, workType === w && styles.chipActive]} onPress={() => setWorkType(w)}>
                    <AppText style={[styles.chipText, workType === w && styles.chipTextActive]}>{t(`modules.workTypes.${w}`)}</AppText>
                  </TouchableOpacity>
                ))}
              </View>
              <AppText style={styles.label}>{t('modules.common.priority')}</AppText>
              <View style={styles.chipRow}>
                {PRIORITIES.map(p => {
                  const pc = statusColor(theme, PRI_KIND[p]).base
                  return (
                    <TouchableOpacity key={p} style={[styles.chip, priority === p && { backgroundColor: pc, borderColor: pc }]} onPress={() => setPriority(p)}>
                      <AppText style={[styles.chipText, priority === p && styles.chipTextActive]}>{t(`modules.priority.${p}`)}</AppText>
                    </TouchableOpacity>
                  )
                })}
              </View>
              <AppText style={styles.label}>{t('modules.common.details')}</AppText>
              <TextInput style={[styles.input, styles.textarea]} placeholder={t('modules.workOrders.detailsPh')} placeholderTextColor={theme.color.textMuted} value={desc} onChangeText={setDesc} multiline />
              <Button label={t('modules.workOrders.create')} onPress={create} loading={saving} full style={{ marginTop: spacing.xl, marginBottom: spacing.md }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
    backBtn: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    newBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
    filters: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { ...typography.caption, color: c.textSecondary },
    chipTextActive: { color: c.onPrimary },
    list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing['4xl'] },
    card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border, ...elevation(theme, 1) },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { ...typography.title, color: c.text },
    badges: { flexDirection: 'row', gap: spacing.xs, marginTop: 2 },
    advBtn: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 64 },
    advText: { ...typography.micro, color: c.primaryDark },
    modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
    sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'], padding: spacing.lg, maxHeight: '88%' },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    label: { ...typography.label, color: c.textSecondary, marginTop: spacing.md, marginBottom: spacing.sm },
    input: { backgroundColor: c.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, ...typography.body, color: c.text, borderWidth: 1, borderColor: c.borderStrong },
    textarea: { minHeight: 80, textAlignVertical: 'top' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  })
}
