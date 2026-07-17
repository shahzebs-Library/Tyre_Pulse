/**
 * Preventive Maintenance — due list + record-service (mobile companion to the
 * web PM module, V253).
 *
 * The workshop tech standing at the vehicle sees what is due/overdue and closes
 * out the service on the spot: meter reading, costs, findings, outcome. The
 * write goes through the atomic SECURITY DEFINER RPC `record_pm_service`
 * (insert history row + advance the schedule + monotonic meter guard) so the
 * phone can never desync a plan — the server owns the maths. Online-only by
 * design: the RPC is transactional and role-gated (Admin/Manager/Director)
 * server-side, so there is no offline queue for it.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, Platform, KeyboardAvoidingView, Modal, RefreshControl,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme, spacing, radius, typography, StatusKind } from '../../lib/theme'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import {
  Screen, Card, AppText, Badge, Button, StatTile, EmptyState, ErrorState, Loading,
} from '../../components/ui'

// ── Types ────────────────────────────────────────────────────────────────────

interface PmPlan {
  id: string
  name: string | null
  asset_no: string | null
  asset_category: string | null
  site: string | null
  status: string | null
  interval_type: string | null
  interval_value: number | null
  meter_source: string | null
  meter_interval: number | null
  next_due: string | null
  next_due_meter: number | null
  priority: string | null
  estimated_cost: number | null
}

type DueBand = 'overdue' | 'due_soon' | 'ok' | 'none'

const DUE_SOON_DAYS = 14
const OUTCOMES = ['completed', 'partial', 'deferred', 'failed'] as const

// ── Pure helpers ─────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Whole days from today to the plan's next_due (negative = overdue). */
function daysToDue(nextDue: string | null): number | null {
  if (!nextDue) return null
  const due = Date.parse(String(nextDue).slice(0, 10) + 'T00:00:00Z')
  const now = Date.parse(todayISO() + 'T00:00:00Z')
  if (!Number.isFinite(due)) return null
  return Math.round((due - now) / 86_400_000)
}

function dueBand(plan: PmPlan): DueBand {
  const d = daysToDue(plan.next_due)
  if (d == null) return 'none'
  if (d < 0) return 'overdue'
  if (d <= DUE_SOON_DAYS) return 'due_soon'
  return 'ok'
}

const BAND_KIND: Record<DueBand, StatusKind> = {
  overdue: 'critical', due_soon: 'warning', ok: 'success', none: 'neutral',
}

const PRIORITY_KIND: Record<string, StatusKind> = {
  critical: 'critical', high: 'danger', medium: 'warning', low: 'neutral',
}

function meterUnit(source: string | null): string {
  if (source === 'odometer') return 'km'
  if (source === 'engine_hours') return 'h'
  return ''
}

const toNum = (s: string): number | null => {
  const n = Number(String(s).replace(/,/g, '').trim())
  return Number.isFinite(n) && s.trim() !== '' ? n : null
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function MaintenanceScreen() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const router = useRouter()

  // RPC re-checks Admin/Manager/Director server-side; mirror that gate here.
  const { allowed, loading: guardLoading } = useRoleGuard(['admin', 'manager', 'director'])

  const [plans, setPlans] = useState<PmPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'due' | 'all'>('due')

  // Record-service modal state
  const [target, setTarget] = useState<PmPlan | null>(null)
  const [meterReading, setMeterReading] = useState('')
  const [performedBy, setPerformedBy] = useState('')
  const [workshop, setWorkshop] = useState('')
  const [partsCost, setPartsCost] = useState('')
  const [labourCost, setLabourCost] = useState('')
  const [findings, setFindings] = useState('')
  const [outcome, setOutcome] = useState<string>('completed')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const cc = profile?.country
      let q = supabase
        .from('pm_programs')
        .select(
          'id,name,asset_no,asset_category,site,status,interval_type,interval_value,' +
          'meter_source,meter_interval,next_due,next_due_meter,priority,estimated_cost',
        )
        .eq('status', 'active')
        .order('next_due', { ascending: true, nullsFirst: false })
        .limit(300)
      if (cc) q = q.or(`country.eq.${cc},country.is.null`)
      const { data, error: qErr } = await q
      if (qErr) throw qErr
      setPlans((data ?? []) as unknown as PmPlan[])
    } catch (e: any) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [profile?.country])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    if (filter === 'all') return plans
    return plans.filter(p => { const b = dueBand(p); return b === 'overdue' || b === 'due_soon' })
  }, [plans, filter])

  const counts = useMemo(() => {
    let overdue = 0, soon = 0
    for (const p of plans) {
      const b = dueBand(p)
      if (b === 'overdue') overdue++
      else if (b === 'due_soon') soon++
    }
    return { overdue, soon, active: plans.length }
  }, [plans])

  function openRecord(plan: PmPlan) {
    setTarget(plan)
    setMeterReading('')
    setPerformedBy(profile?.full_name ?? '')
    setWorkshop('')
    setPartsCost('')
    setLabourCost('')
    setFindings('')
    setOutcome('completed')
  }

  async function submitService() {
    if (!target || saving) return
    setSaving(true)
    try {
      const { error: rpcErr } = await supabase.rpc('record_pm_service', {
        p_program_id: target.id,
        p_service_date: todayISO(),
        p_meter_reading: toNum(meterReading),
        p_performed_by: performedBy.trim() || null,
        p_workshop: workshop.trim() || null,
        p_site: target.site || null,
        p_tasks_done: [],
        p_parts_used: [],
        p_parts_cost: toNum(partsCost),
        p_labour_cost: toNum(labourCost),
        p_findings: findings.trim() || null,
        p_outcome: outcome,
        p_work_order_no: null,
        p_notes: null,
      })
      if (rpcErr) throw rpcErr
      setTarget(null)
      Alert.alert(t('modules.pm.savedTitle'), t('modules.pm.savedBody'))
      await load()
    } catch (e: any) {
      Alert.alert(t('common.error'), toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (guardLoading || !allowed) return <Screen><Loading /></Screen>

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)'))}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={22} color={theme.color.text} />
        </TouchableOpacity>
        <AppText variant="h2">{t('modules.pm.title')}</AppText>
      </View>

      {loading ? <Loading /> : error ? (
        <ErrorState message={error} onRetry={() => { setLoading(true); load() }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} />
          }
        >
          {/* KPI strip */}
          <View style={styles.tiles}>
            <StatTile label={t('modules.pm.overdue')} value={counts.overdue} icon="alert-circle-outline" tint={counts.overdue ? 'red' : 'green'} style={styles.tile} />
            <StatTile label={t('modules.pm.dueSoon')} value={counts.soon} icon="time-outline" tint={counts.soon ? 'amber' : 'green'} style={styles.tile} />
            <StatTile label={t('modules.pm.activePlans')} value={counts.active} icon="build-outline" tint="blue" style={styles.tile} />
          </View>

          {/* Filter chips */}
          <View style={styles.chips}>
            {(['due', 'all'] as const).map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.chip, filter === f && styles.chipActive]}
                onPress={() => setFilter(f)}
              >
                <AppText style={filter === f ? styles.chipTextActive : styles.chipText}>
                  {f === 'due' ? t('modules.pm.filterDue') : t('modules.pm.filterAll')}
                </AppText>
              </TouchableOpacity>
            ))}
          </View>

          {visible.length === 0 ? (
            <EmptyState
              icon="build-outline"
              title={t('modules.pm.emptyTitle')}
              message={filter === 'due' ? t('modules.pm.emptyDue') : t('modules.pm.emptyAll')}
            />
          ) : visible.map(plan => {
            const band = dueBand(plan)
            const d = daysToDue(plan.next_due)
            const unit = meterUnit(plan.meter_source)
            return (
              <Card key={plan.id} style={styles.planCard}>
                <View style={styles.planTop}>
                  <View style={styles.planTitleWrap}>
                    <AppText variant="h3" numberOfLines={1}>{plan.name || plan.asset_no || t('modules.pm.plan')}</AppText>
                    <AppText variant="caption" color="muted" numberOfLines={1}>
                      {[plan.asset_no, plan.site, plan.asset_category].filter(Boolean).join(' · ') || '—'}
                    </AppText>
                  </View>
                  <Badge kind={BAND_KIND[band]}>
                    {band === 'overdue'
                      ? `${Math.abs(d!)}${t('modules.pm.daysOverdue')}`
                      : band === 'due_soon'
                        ? `${d}${t('modules.pm.daysLeft')}`
                        : band === 'ok'
                          ? `${d}${t('modules.pm.daysLeft')}`
                          : t('modules.pm.noDate')}
                  </Badge>
                </View>

                <View style={styles.planMeta}>
                  {plan.next_due ? (
                    <AppText variant="caption" color="muted">
                      <Ionicons name="calendar-outline" size={12} /> {String(plan.next_due).slice(0, 10)}
                    </AppText>
                  ) : null}
                  {plan.next_due_meter != null && unit ? (
                    <AppText variant="caption" color="muted">
                      <Ionicons name="speedometer-outline" size={12} /> {plan.next_due_meter} {unit}
                    </AppText>
                  ) : null}
                  {plan.priority ? (
                    <Badge kind={PRIORITY_KIND[plan.priority] ?? 'neutral'}>{plan.priority}</Badge>
                  ) : null}
                </View>

                <Button
                  label={t('modules.pm.recordService')}
                  icon="checkmark-circle-outline"
                  size="sm"
                  onPress={() => openRecord(plan)}
                  style={styles.recordBtn}
                />
              </Card>
            )
          })}
        </ScrollView>
      )}

      {/* Record-service modal */}
      <Modal visible={target != null} animationType="slide" transparent onRequestClose={() => !saving && setTarget(null)}>
        <KeyboardAvoidingView
          style={styles.modalWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <AppText variant="h3" numberOfLines={1} style={styles.modalTitle}>
                {t('modules.pm.recordService')}
              </AppText>
              <TouchableOpacity onPress={() => !saving && setTarget(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={24} color={theme.color.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <AppText variant="caption" color="muted" style={styles.modalSub}>
                {[target?.name, target?.asset_no].filter(Boolean).join(' · ')}
              </AppText>

              {target?.meter_source && target.meter_source !== 'none' ? (
                <>
                  <AppText variant="caption" style={styles.label}>
                    {t('modules.pm.meterReading')} ({meterUnit(target.meter_source)})
                  </AppText>
                  <TextInput
                    style={styles.input}
                    value={meterReading}
                    onChangeText={setMeterReading}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={theme.color.textMuted}
                  />
                </>
              ) : null}

              <AppText variant="caption" style={styles.label}>{t('modules.pm.performedBy')}</AppText>
              <TextInput
                style={styles.input}
                value={performedBy}
                onChangeText={setPerformedBy}
                placeholder={t('modules.pm.performedBy')}
                placeholderTextColor={theme.color.textMuted}
              />

              <AppText variant="caption" style={styles.label}>{t('modules.pm.workshop')}</AppText>
              <TextInput
                style={styles.input}
                value={workshop}
                onChangeText={setWorkshop}
                placeholder={t('modules.pm.workshop')}
                placeholderTextColor={theme.color.textMuted}
              />

              <View style={styles.costRow}>
                <View style={styles.costCol}>
                  <AppText variant="caption" style={styles.label}>{t('modules.pm.partsCost')}</AppText>
                  <TextInput
                    style={styles.input}
                    value={partsCost}
                    onChangeText={setPartsCost}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={theme.color.textMuted}
                  />
                </View>
                <View style={styles.costCol}>
                  <AppText variant="caption" style={styles.label}>{t('modules.pm.labourCost')}</AppText>
                  <TextInput
                    style={styles.input}
                    value={labourCost}
                    onChangeText={setLabourCost}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={theme.color.textMuted}
                  />
                </View>
              </View>

              <AppText variant="caption" style={styles.label}>{t('modules.pm.findings')}</AppText>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={findings}
                onChangeText={setFindings}
                multiline
                numberOfLines={3}
                placeholder={t('modules.pm.findingsHint')}
                placeholderTextColor={theme.color.textMuted}
              />

              <AppText variant="caption" style={styles.label}>{t('modules.pm.outcome')}</AppText>
              <View style={styles.chips}>
                {OUTCOMES.map(o => (
                  <TouchableOpacity
                    key={o}
                    style={[styles.chip, outcome === o && styles.chipActive]}
                    onPress={() => setOutcome(o)}
                  >
                    <AppText style={outcome === o ? styles.chipTextActive : styles.chipText}>
                      {t(`modules.pm.outcome_${o}`)}
                    </AppText>
                  </TouchableOpacity>
                ))}
              </View>

              <Button
                label={saving ? t('common.saving') : t('modules.pm.saveService')}
                icon="checkmark-circle-outline"
                onPress={submitService}
                loading={saving}
                disabled={saving}
                full
                style={styles.saveBtn}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: Theme) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  backBtn: { padding: 2 },
  scroll: { padding: spacing.lg, paddingTop: 0, gap: spacing.md, paddingBottom: spacing.xl },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.pill, borderWidth: 1,
    borderColor: theme.color.border, backgroundColor: theme.color.surface,
  },
  chipActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  chipText: { ...typography.caption, color: theme.color.textMuted },
  chipTextActive: { ...typography.caption, color: '#fff', fontWeight: '600' },
  planCard: { gap: spacing.sm },
  planTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  planTitleWrap: { flex: 1 },
  planMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  recordBtn: { alignSelf: 'flex-start' },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, maxHeight: '88%',
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  modalTitle: { flex: 1 },
  modalSub: { marginBottom: spacing.md },
  label: { color: theme.color.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: theme.color.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    color: theme.color.text, backgroundColor: theme.color.surfaceAlt,
    ...typography.body,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  costRow: { flexDirection: 'row', gap: spacing.md },
  costCol: { flex: 1 },
  saveBtn: { marginTop: spacing.lg, marginBottom: spacing.md },
})
