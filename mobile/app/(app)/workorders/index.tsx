/**
 * Work Orders / Corrective Actions - mobile list
 *
 * Roles:
 *   admin / manager → all sites, can close actions
 *   inspector / tyre_man → own site only, can mark resolved
 *   director → all sites, read-only
 */

import { useState, useCallback, useEffect } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar, ActivityIndicator, TextInput,
  Alert, Modal, ScrollView,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { supabase } from '../../../lib/supabase'
import { saveCommand } from '../../../lib/recordQueue'
import { isAdminOrAbove } from '../../../lib/types'
import { canUpdateWorkOrders } from '../../../lib/permissions'
import { toUserMessage } from '../../../lib/safeError'

type WorkOrderStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed'
type Priority = 'Critical' | 'High' | 'Medium' | 'Low'

interface WorkOrder {
  id: string
  title: string
  priority: Priority | null
  site: string | null
  asset_no: string | null
  tyre_serial: string | null
  assigned_to: string | null
  status: WorkOrderStatus
  description: string | null
  root_cause: string | null
  due_date: string | null
  created_at: string
  closed_at: string | null
}

type FilterStatus = 'all' | WorkOrderStatus
const STATUSES: FilterStatus[] = ['all', 'Open', 'In Progress', 'Resolved', 'Closed']

const PRIORITY_COLOR: Record<string, string> = {
  Critical: '#dc2626', High: '#ea580c', Medium: '#f59e0b', Low: '#16a34a',
}
const STATUS_COLOR: Record<WorkOrderStatus, string> = {
  'Open':        '#dc2626',
  'In Progress': '#f59e0b',
  'Resolved':    '#3b82f6',
  'Closed':      '#6b7280',
}

const STATUS_LABEL_KEY: Record<string, string> = {
  Open: 'modules.workOrdersList.statusOpen',
  'In Progress': 'modules.workOrdersList.statusInProgress',
  Resolved: 'modules.workOrdersList.statusResolved',
  Closed: 'modules.workOrdersList.statusClosed',
}

export default function WorkOrdersScreen() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const insets = useSafeAreaInsets()
  const statusLabel = (s: string) => (STATUS_LABEL_KEY[s] ? t(STATUS_LABEL_KEY[s]) : s)
  const priorityLabel = (p: string | null) => (p ? t(`modules.priority.${p}`) : '')
  const role     = profile?.role ?? null
  const elevated = isAdminOrAbove(role)
  const canUpdate = canUpdateWorkOrders(role)
  const readOnly  = role === 'director'

  const [orders, setOrders]         = useState<WorkOrder[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('Open')
  const [search, setSearch]         = useState('')
  const [detail, setDetail]         = useState<WorkOrder | null>(null)
  const [updating, setUpdating]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let q = supabase
        .from('corrective_actions')
        .select('id,title,priority,site,asset_no,tyre_serial,assigned_to,status,description,root_cause,due_date,created_at,closed_at')
        .order('created_at', { ascending: false })
        .limit(200)

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (!elevated && profile?.site) q = q.eq('site', profile.site)
      if (search.trim()) q = q.or(`title.ilike.%${search}%,asset_no.ilike.%${search}%,tyre_serial.ilike.%${search}%`)

      const { data, error: qErr } = await q
      if (qErr) throw qErr
      setOrders((data ?? []) as WorkOrder[])
    } catch (e: any) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [statusFilter, search, elevated, profile?.site])

  useEffect(() => { load() }, [load])

  async function onRefresh() { setRefreshing(true); load() }

  async function updateStatus(id: string, newStatus: WorkOrderStatus) {
    if (!canUpdate) return
    setUpdating(true)
    const closedAt = newStatus === 'Closed' ? new Date().toISOString() : null
    const update: Record<string, any> = { id, status: newStatus }
    if (closedAt) update.closed_at = closedAt
    // Typed offline queue: applies immediately when online, enqueues (idempotent
    // replay by id) when offline so corrective-action status changes survive.
    const res = await saveCommand('CORRECTIVE_ACTION_STATUS', update)
    setUpdating(false)
    // optimistic - keep the new status visible even while queued offline
    setOrders(prev => prev.map(o => o.id === id
      ? { ...o, status: newStatus, closed_at: closedAt ?? o.closed_at }
      : o))
    setDetail(null)
    if (res.offline) { Alert.alert(t('modules.workOrdersList.savedOffline'), t('modules.workOrdersList.savedOfflineMsg')); return }
    load()
  }

  const overdue = (o: WorkOrder) => o.due_date && new Date(o.due_date) < new Date() && o.status !== 'Closed' && o.status !== 'Resolved'

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('modules.workOrdersList.title')}</Text>
          <Text style={styles.subtitle}>
            {loading ? t('common.loading') : `${orders.length} ${orders.length !== 1 ? t('modules.workOrdersList.actionsSuffix') : t('modules.workOrdersList.actionSuffix')}${elevated ? '' : ` · ${profile?.site ?? ''}`}`}
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color="#94a3b8" />
        <TextInput
          style={styles.searchInput}
          placeholder={t('modules.workOrdersList.searchPh')}
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Status tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
        {STATUSES.map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.tab, statusFilter === s && styles.tabActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.tabText, statusFilter === s && styles.tabTextActive]}>
              {s === 'all' ? t('modules.workOrdersList.all') : statusLabel(s)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#f59e0b" /></View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={o => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#f59e0b" />}
          ListEmptyComponent={
            error ? (
              <View style={styles.empty}>
                <Ionicons name="cloud-offline-outline" size={48} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>{error}</Text>
                <TouchableOpacity onPress={load} style={{ marginTop: 14, backgroundColor: '#f59e0b', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}>
                  <Text style={{ color: '#fff', fontWeight: '600' }}>{t('common.retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="construct-outline" size={48} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>{t('modules.workOrdersList.none')}</Text>
                <Text style={styles.emptyHint}>
                  {statusFilter === 'Open' ? t('modules.workOrdersList.noneOpenHint') : t('modules.workOrdersList.noneFilterHint')}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => setDetail(item)} activeOpacity={0.75}>
              <View style={[styles.priorityStrip, { backgroundColor: PRIORITY_COLOR[item.priority ?? ''] ?? '#94a3b8' }]} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                  {overdue(item) && (
                    <Ionicons name="alert-circle" size={16} color="#dc2626" style={{ marginLeft: 4 }} />
                  )}
                </View>
                <View style={styles.cardMeta}>
                  {item.asset_no ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="car-outline" size={11} color="#94a3b8" />
                      <Text style={styles.metaText}>{item.asset_no}</Text>
                    </View>
                  ) : null}
                  {item.site ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="location-outline" size={11} color="#94a3b8" />
                      <Text style={styles.metaText}>{item.site}</Text>
                    </View>
                  ) : null}
                  {item.due_date ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="calendar-outline" size={11} color={overdue(item) ? '#dc2626' : '#94a3b8'} />
                      <Text style={[styles.metaText, overdue(item) && { color: '#dc2626' }]}>{t('modules.workOrdersList.due')} {item.due_date.slice(0, 10)}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.cardBottom}>
                  <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[item.status] + '18' }]}>
                    <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>{statusLabel(item.status)}</Text>
                  </View>
                  {item.priority ? (
                    <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLOR[item.priority] + '18' }]}>
                      <Text style={[styles.priorityText, { color: PRIORITY_COLOR[item.priority] }]}>{priorityLabel(item.priority)}</Text>
                    </View>
                  ) : null}
                  {item.assigned_to ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="person-outline" size={11} color="#94a3b8" />
                      <Text style={styles.metaText} numberOfLines={1}>{item.assigned_to}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={15} color="#cbd5e1" />
            </TouchableOpacity>
          )}
        />
      )}

      {/* Detail modal */}
      {detail && (
        <Modal visible animationType="slide" transparent onRequestClose={() => setDetail(null)}>
          <View style={styles.sheetBackdrop}>
            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
              <View style={styles.sheetHandle} />
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.detailTitle}>{detail.title}</Text>
                <View style={styles.badgeRow}>
                  <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[detail.status] + '20' }]}>
                    <Text style={[styles.statusText, { color: STATUS_COLOR[detail.status] }]}>{statusLabel(detail.status)}</Text>
                  </View>
                  {detail.priority ? (
                    <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLOR[detail.priority] + '20' }]}>
                      <Text style={[styles.priorityText, { color: PRIORITY_COLOR[detail.priority] }]}>{priorityLabel(detail.priority)}</Text>
                    </View>
                  ) : null}
                </View>
                {detail.asset_no ? <DRow label={t('modules.workOrdersList.asset')} value={detail.asset_no} /> : null}
                {detail.site     ? <DRow label={t('modules.workOrdersList.site')}  value={detail.site} /> : null}
                {detail.tyre_serial ? <DRow label={t('modules.workOrdersList.tyreSerial')} value={detail.tyre_serial} /> : null}
                {detail.assigned_to ? <DRow label={t('modules.workOrdersList.assignedTo')} value={detail.assigned_to} /> : null}
                {detail.due_date ? <DRow label={t('modules.workOrdersList.dueDate')} value={detail.due_date.slice(0, 10)} /> : null}
                {detail.created_at ? <DRow label={t('modules.workOrdersList.created')} value={new Date(detail.created_at).toLocaleDateString()} /> : null}
                {detail.description ? (
                  <View style={styles.textBlock}>
                    <Text style={styles.textBlockLabel}>{t('modules.workOrdersList.description')}</Text>
                    <Text style={styles.textBlockValue}>{detail.description}</Text>
                  </View>
                ) : null}
                {detail.root_cause ? (
                  <View style={styles.textBlock}>
                    <Text style={styles.textBlockLabel}>{t('modules.workOrdersList.rootCause')}</Text>
                    <Text style={styles.textBlockValue}>{detail.root_cause}</Text>
                  </View>
                ) : null}

                {/* Status actions */}
                {canUpdate && !readOnly && detail.status !== 'Closed' && (
                  <View style={styles.actionSection}>
                    <Text style={styles.actionLabel}>{t('modules.workOrdersList.updateStatus')}</Text>
                    <View style={styles.actionBtns}>
                      {(['In Progress', 'Resolved', 'Closed'] as WorkOrderStatus[])
                        .filter(s => s !== detail.status)
                        .map(s => (
                          <TouchableOpacity
                            key={s}
                            style={[styles.actionBtn, { borderColor: STATUS_COLOR[s] }]}
                            onPress={() => {
                              Alert.alert(t('modules.workOrdersList.updateStatus'), `${t('modules.workOrdersList.updateStatusPrefix')} "${statusLabel(s)}"?`, [
                                { text: t('common.cancel'), style: 'cancel' },
                                { text: t('common.confirm'), onPress: () => updateStatus(detail.id, s) },
                              ])
                            }}
                            disabled={updating}
                          >
                            <Text style={[styles.actionBtnText, { color: STATUS_COLOR[s] }]}>{statusLabel(s)}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  </View>
                )}
              </ScrollView>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setDetail(null)}>
                <Text style={styles.closeBtnText}>{t('modules.workOrdersList.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  )
}

function DRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={dStyles.row}>
      <Text style={dStyles.label}>{label}</Text>
      <Text style={dStyles.value}>{value}</Text>
    </View>
  )
}

const dStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  label: { fontSize: 13, color: '#64748b' },
  value: { fontSize: 13, color: '#0f172a', fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
})

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#fff7ed' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  title:    { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 10, marginBottom: 4,
    backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  searchInput: { flex: 1, fontSize: 13, color: '#0f172a', padding: 0 },

  tabScroll: { flexGrow: 0 },
  tabRow:    { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  tabActive:    { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  tabText:      { fontSize: 12, fontWeight: '700', color: '#94a3b8' },
  tabTextActive:{ color: '#fff' },

  list:  { paddingHorizontal: 16, paddingBottom: 40, gap: 10, paddingTop: 4 },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  priorityStrip: { width: 4, alignSelf: 'stretch' },
  cardBody:      { flex: 1, padding: 12, gap: 6 },
  cardTop:       { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle:     { fontSize: 14, fontWeight: '700', color: '#0f172a', flex: 1 },
  cardMeta:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cardBottom:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  metaItem:      { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText:      { fontSize: 11, color: '#94a3b8' },
  statusBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText:    { fontSize: 11, fontWeight: '800' },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  priorityText:  { fontSize: 11, fontWeight: '700' },

  empty:      { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptyHint:  { fontSize: 13, color: '#94a3b8', textAlign: 'center' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36, maxHeight: '85%',
  },
  sheetHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 12 },
  detailTitle:  { fontSize: 17, fontWeight: '800', color: '#0f172a', marginBottom: 10 },
  badgeRow:     { flexDirection: 'row', gap: 8, marginBottom: 12 },
  textBlock:    { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  textBlockLabel: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  textBlockValue: { fontSize: 13, color: '#0f172a' },
  actionSection:{ marginTop: 16 },
  actionLabel:  { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 8 },
  actionBtns:   { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, alignItems: 'center',
  },
  actionBtnText: { fontSize: 13, fontWeight: '700' },
  closeBtn:     { backgroundColor: '#f1f5f9', borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  closeBtnText: { fontSize: 15, fontWeight: '700', color: '#374151' },
})
