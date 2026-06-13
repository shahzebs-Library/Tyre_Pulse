/**
 * Accident Detail View
 *
 * Full-detail read view for a single accident report.
 * - All users: view full report, photo gallery with lightbox
 * - Managers / Directors: update status via bottom-sheet modal
 * - Admin only: delete report (with confirmation), view full audit trail
 */

import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator, Alert, Modal, Image,
  Dimensions, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { supabase } from '../../../lib/supabase'
import AccidentClaimsPanel from '../../../components/AccidentClaimsPanel'
import {
  AccidentRecord, AccidentStatus,
  SEVERITY_COLORS, STATUS_COLORS,
  SEVERITY_ICONS, STATUS_ICONS,
  isAdminOrAbove, isAdmin,
} from '../../../lib/types'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

const STATUS_OPTIONS: AccidentStatus[] = ['reported', 'under_review', 'closed']

const TYPE_ICONS: Record<string, string> = {
  collision:       'car-sport-outline',
  rollover:        'refresh-circle-outline',
  tyre_failure:    'disc-outline',
  mechanical:      'build-outline',
  near_miss:       'warning-outline',
  property_damage: 'business-outline',
  other:           'ellipsis-horizontal-circle-outline',
}

interface AuditRow {
  id: string
  changed_at: string
  action: string
  old_values: Record<string, any> | null
  new_values: Record<string, any> | null
}

export default function AccidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()

  const [accident, setAccident]             = useState<AccidentRecord | null>(null)
  const [auditLog, setAuditLog]             = useState<AuditRow[]>([])
  const [loading, setLoading]               = useState(true)
  const [statusLoading, setStatusLoading]   = useState(false)
  const [deleting, setDeleting]             = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [lightboxIndex, setLightboxIndex]   = useState<number | null>(null)
  const [analyzing, setAnalyzing]           = useState(false)
  const [aiResult, setAiResult]             = useState<string | null>(null)
  const [showAiModal, setShowAiModal]       = useState(false)

  const role           = profile?.role ?? null
  const canChangeStatus = isAdminOrAbove(role)
  const canDelete       = isAdmin(role)
  const canSeeAudit     = isAdminOrAbove(role)

  const load = useCallback(async () => {
    if (!id) return
    const [accRes, auditRes] = await Promise.all([
      supabase.from('accidents').select('*').eq('id', id).single(),
      canSeeAudit
        ? supabase
            .from('accident_audit_log')
            .select('id, changed_at, action, old_values, new_values')
            .eq('accident_id', id)
            .order('changed_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
    ])

    if (accRes.error || !accRes.data) {
      Alert.alert('Error', 'Could not load accident report.')
      router.back()
      return
    }
    setAccident(accRes.data as AccidentRecord)
    setAuditLog((auditRes.data ?? []) as AuditRow[])
    setLoading(false)
  }, [id, canSeeAudit])

  useEffect(() => { load() }, [load])

  async function updateStatus(newStatus: AccidentStatus) {
    if (!accident) return
    setStatusLoading(true)
    setShowStatusModal(false)
    const { error } = await supabase
      .from('accidents')
      .update({ status: newStatus })
      .eq('id', accident.id)

    if (error) {
      Alert.alert('Error', 'Failed to update status.')
    } else {
      setAccident(prev => prev ? { ...prev, status: newStatus } : prev)
      // Reload audit log
      const { data } = await supabase
        .from('accident_audit_log')
        .select('id, changed_at, action, old_values, new_values')
        .eq('accident_id', accident.id)
        .order('changed_at', { ascending: false })
        .limit(20)
      if (data) setAuditLog(data as AuditRow[])
    }
    setStatusLoading(false)
  }

  async function analyzeWithAI() {
    if (!accident) return
    setAnalyzing(true)
    setShowAiModal(true)
    setAiResult(null)

    const prompt = `You are a fleet accident investigator and tyre engineer. Analyze this accident report and provide a structured assessment.

ACCIDENT REPORT:
- Asset / Vehicle: ${accident.asset_no}
- Site: ${accident.site}
- Date: ${accident.incident_date} ${accident.incident_time ?? ''}
- Location: ${accident.location ?? 'Not specified'}
- Type: ${accident.accident_type.replace('_', ' ')}
- Severity: ${accident.severity.toUpperCase()}
- Description: ${accident.description ?? 'Not provided'}
- Injuries: ${accident.injuries ? `Yes — ${accident.injury_count} persons` : 'No'}
- Third Party Involved: ${accident.third_party_involved ? 'Yes' : 'No'}
- Police Report: ${accident.police_report_no ?? 'None'}
- Damage Description: ${accident.damage_description ?? 'Not specified'}
- Estimated Damage Cost: ${accident.estimated_damage_cost ? `SAR ${accident.estimated_damage_cost}` : 'Not estimated'}

Provide your analysis in exactly this structure:

## Root Cause
[Identify the most likely primary cause]

## Contributing Factors
[List 2-4 specific contributing factors]

## Risk Assessment
Risk Level: [Critical / High / Medium / Low]
[Brief justification]

## Immediate Actions Required
[3-5 specific actions that should be taken now]

## Prevention Recommendations
[3-4 systemic changes to prevent recurrence]

## Insurance / Legal Notes
[Any relevant observations about documentation, liability, or reporting]`

    try {
      const { data, error } = await supabase.functions.invoke('chat-ai', {
        body: {
          system: 'You are TyrePulse\'s Tyre Engineer and fleet accident investigator. Provide expert, actionable analysis.',
          user: prompt,
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
        },
      })
      setAiResult(error ? 'Unable to reach AI. Check your connection and try again.' : (data?.content ?? 'No analysis generated.'))
    } catch {
      setAiResult('Network error. Please try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete Report',
      'This will permanently delete the accident report and all audit history. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true)
            const { error } = await supabase.from('accidents').delete().eq('id', accident!.id)
            setDeleting(false)
            if (error) {
              Alert.alert('Error', 'Failed to delete report.')
            } else {
              router.back()
            }
          },
        },
      ]
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff5f5" />
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#dc2626" />
        </View>
      </SafeAreaView>
    )
  }

  if (!accident) return null

  const sevColor    = SEVERITY_COLORS[accident.severity]
  const statusColor = STATUS_COLORS[accident.status]
  const photos: string[] = Array.isArray(accident.photos) ? accident.photos.filter(Boolean) : []

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff5f5" />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, isRTL && { flexDirection: 'row-reverse' }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{t('accident.detailTitle')}</Text>
          <Text style={styles.headerSub}>#{accident.id.slice(0, 8).toUpperCase()}</Text>
        </View>

        {/* Status badge — tappable for managers/admins */}
        <TouchableOpacity
          style={[styles.statusBadge, { backgroundColor: statusColor + '18', borderColor: statusColor + '50' }]}
          onPress={() => canChangeStatus && setShowStatusModal(true)}
          activeOpacity={canChangeStatus ? 0.7 : 1}
        >
          {statusLoading
            ? <ActivityIndicator size="small" color={statusColor} />
            : <>
                <Ionicons name={STATUS_ICONS[accident.status] as any} size={13} color={statusColor} />
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {t(`accident.statuses.${accident.status}`)}
                </Text>
                {canChangeStatus && (
                  <Ionicons name="chevron-down" size={11} color={statusColor} style={{ marginLeft: 2 }} />
                )}
              </>
          }
        </TouchableOpacity>

        {/* Admin: delete button */}
        {canDelete && (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={confirmDelete}
            disabled={deleting}
          >
            {deleting
              ? <ActivityIndicator size="small" color="#dc2626" />
              : <Ionicons name="trash-outline" size={18} color="#dc2626" />
            }
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* ── Hero severity card ────────────────────────────────────────────── */}
        <View style={[styles.heroCard, { borderLeftColor: sevColor, borderLeftWidth: 5 }]}>
          <View style={styles.heroTop}>
            <View style={[styles.sevBadge, { backgroundColor: sevColor + '18', borderColor: sevColor + '40' }]}>
              <Ionicons name={SEVERITY_ICONS[accident.severity] as any} size={13} color={sevColor} />
              <Text style={[styles.sevBadgeText, { color: sevColor }]}>
                {t(`accident.severities.${accident.severity}`).toUpperCase()}
              </Text>
            </View>
            <View style={styles.typeChip}>
              <Ionicons name={TYPE_ICONS[accident.accident_type] as any ?? 'alert-circle-outline'} size={13} color="#475569" />
              <Text style={styles.typeChipText}>{t(`accident.types.${accident.accident_type}`)}</Text>
            </View>
          </View>
          <View style={styles.heroMeta}>
            <MetaItem icon="business-outline"  label={accident.site} />
            <MetaItem icon="car-outline"       label={accident.asset_no} bold />
            <MetaItem icon="calendar-outline"  label={accident.incident_date} />
            {accident.incident_time ? <MetaItem icon="time-outline"     label={accident.incident_time} /> : null}
            {accident.location      ? <MetaItem icon="location-outline" label={accident.location} /> : null}
          </View>
        </View>

        {/* ── Description ───────────────────────────────────────────────────── */}
        {accident.description ? (
          <SectionCard title={t('accident.incidentInfo')} icon="document-text-outline">
            <Text style={styles.descText}>{accident.description}</Text>
          </SectionCard>
        ) : null}

        {/* ── Damage & Injuries ─────────────────────────────────────────────── */}
        <SectionCard title={t('accident.damageInfo')} icon="medkit-outline">
          <InfoRow
            label={t('accident.injuriesLabel')}
            value={accident.injuries ? t('accident.yes') : t('accident.no')}
            highlight={accident.injuries}
          />
          {accident.injuries && accident.injury_count > 0 && (
            <InfoRow label={t('accident.injuryCountLabel')} value={String(accident.injury_count)} />
          )}
          <InfoRow
            label={t('accident.thirdPartyLabel')}
            value={accident.third_party_involved ? t('accident.yes') : t('accident.no')}
          />
          {accident.police_report_no ? (
            <InfoRow label={t('accident.policeReportLabel')} value={accident.police_report_no} />
          ) : null}
          {accident.estimated_damage_cost != null && (
            <InfoRow
              label={t('accident.costLabel')}
              value={`SAR ${Number(accident.estimated_damage_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              highlight
            />
          )}
          {accident.damage_description ? (
            <View style={styles.blockField}>
              <Text style={styles.blockLabel}>{t('accident.damageDescLabel')}</Text>
              <Text style={styles.blockText}>{accident.damage_description}</Text>
            </View>
          ) : null}
        </SectionCard>

        {/* ── Reporter info (admin sees reviewer too) ────────────────────────── */}
        <SectionCard title="Report Info" icon="person-circle-outline">
          <InfoRow label="Reported By"  value={accident.reporter_name ?? '—'} />
          <InfoRow label="Submitted"    value={new Date(accident.created_at).toLocaleString()} />
          {accident.updated_at !== accident.created_at && (
            <InfoRow label="Last Updated" value={new Date(accident.updated_at).toLocaleString()} />
          )}
          {canSeeAudit && accident.reviewed_by && (
            <InfoRow label="Reviewed At" value={accident.reviewed_at ? new Date(accident.reviewed_at).toLocaleString() : '—'} />
          )}
        </SectionCard>

        {/* ── Notes ─────────────────────────────────────────────────────────── */}
        {accident.notes ? (
          <SectionCard title={t('accident.notesLabel')} icon="chatbubble-ellipses-outline">
            <Text style={styles.descText}>{accident.notes}</Text>
          </SectionCard>
        ) : null}

        {/* ── Deep claims module: closure, claim/responsibility, parts, log ──── */}
        <AccidentClaimsPanel accident={accident} onChanged={load} />

        {/* ── Photo gallery ──────────────────────────────────────────────────── */}
        {photos.length > 0 && (
          <SectionCard title={`${t('accident.photosSection')} (${photos.length})`} icon="images-outline">
            <View style={styles.photoGrid}>
              {photos.map((uri, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.photoThumb}
                  onPress={() => setLightboxIndex(idx)}
                  activeOpacity={0.85}
                >
                  <Image source={{ uri }} style={styles.photoImg} resizeMode="cover" />
                  <View style={styles.photoNum}>
                    <Text style={styles.photoNumText}>{idx + 1}</Text>
                  </View>
                  <View style={styles.photoZoomHint}>
                    <Ionicons name="expand-outline" size={12} color="#fff" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </SectionCard>
        )}

        {/* ── Audit Trail (admin / manager / director only) ──────────────────── */}
        {canSeeAudit && auditLog.length > 0 && (
          <SectionCard title="Audit Trail" icon="shield-checkmark-outline">
            {auditLog.map((row, i) => {
              const actionColor =
                row.action === 'status_change' ? '#3b82f6'
                : row.action === 'delete'      ? '#dc2626'
                : '#94a3b8'
              const actionLabel =
                row.action === 'status_change' ? 'Status Changed'
                : row.action === 'delete'       ? 'Deleted'
                : 'Fields Updated'
              const oldStatus = row.old_values?.status
              const newStatus = row.new_values?.status

              return (
                <View key={row.id} style={[styles.auditRow, i < auditLog.length - 1 && styles.auditRowBorder]}>
                  <View style={[styles.auditDot, { backgroundColor: actionColor }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.auditTop}>
                      <Text style={[styles.auditAction, { color: actionColor }]}>{actionLabel}</Text>
                      <Text style={styles.auditTime}>
                        {new Date(row.changed_at).toLocaleDateString()} {new Date(row.changed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    {row.action === 'status_change' && oldStatus && newStatus && (
                      <Text style={styles.auditDetail}>
                        {oldStatus} → {newStatus}
                      </Text>
                    )}
                  </View>
                </View>
              )
            })}
          </SectionCard>
        )}

        <View style={{ height: canChangeStatus ? 96 : 36 }} />
      </ScrollView>

      {/* ── AI Analyze FAB (admin / manager / director) ───────────────────────── */}
      {canChangeStatus && (
        <View style={styles.fabBar}>
          <TouchableOpacity
            style={[styles.analyzeBtn, analyzing && styles.analyzeBtnLoading]}
            onPress={analyzeWithAI}
            disabled={analyzing}
            activeOpacity={0.85}
          >
            {analyzing
              ? <><ActivityIndicator size="small" color="#fff" /><Text style={styles.analyzeBtnText}>Analyzing…</Text></>
              : <><Ionicons name="sparkles-outline" size={18} color="#fff" /><Text style={styles.analyzeBtnText}>Analyze with AI</Text></>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* ── AI Result Modal ───────────────────────────────────────────────────── */}
      <Modal
        visible={showAiModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAiModal(false)}
      >
        <View style={styles.aiModalBackdrop}>
          <View style={styles.aiModalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.aiModalHeader}>
              <View style={styles.aiModalIcon}>
                <Ionicons name="sparkles" size={18} color="#7c3aed" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiModalTitle}>AI Accident Analysis</Text>
                <Text style={styles.aiModalSub}>Tyre Engineer Agent · {accident?.accident_type?.replace('_', ' ')}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAiModal(false)}>
                <Ionicons name="close-circle-outline" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.aiModalBody} showsVerticalScrollIndicator={false}>
              {analyzing || !aiResult
                ? <View style={styles.aiLoading}>
                    <ActivityIndicator size="large" color="#7c3aed" />
                    <Text style={styles.aiLoadingText}>Analyzing accident data…</Text>
                  </View>
                : <Text style={styles.aiResultText}>{aiResult}</Text>
              }
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Status Modal ──────────────────────────────────────────────────────── */}
      <Modal
        visible={showStatusModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setShowStatusModal(false)}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Update Status</Text>
            <Text style={styles.modalSub}>Change the investigation status of this report</Text>
            {STATUS_OPTIONS.map(opt => {
              const c      = STATUS_COLORS[opt]
              const active = opt === accident.status
              const icons  = { reported: 'flag-outline', under_review: 'search-outline', closed: 'checkmark-circle-outline' }
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.statusOption, active && { backgroundColor: c + '14' }]}
                  onPress={() => updateStatus(opt)}
                >
                  <View style={[styles.statusOptionIcon, { backgroundColor: c + '18' }]}>
                    <Ionicons name={icons[opt] as any} size={16} color={c} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.statusOptionText, { color: active ? c : '#374151' }]}>
                      {t(`accident.statuses.${opt}`)}
                    </Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={20} color={c} />}
                </TouchableOpacity>
              )
            })}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowStatusModal(false)}>
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Lightbox ──────────────────────────────────────────────────────────── */}
      <Modal
        visible={lightboxIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxIndex(null)}
      >
        <View style={styles.lightbox}>
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxIndex(null)}>
            <Ionicons name="close-circle" size={36} color="#fff" />
          </TouchableOpacity>
          {lightboxIndex !== null && (
            <>
              <Image
                source={{ uri: photos[lightboxIndex] }}
                style={styles.lightboxImage}
                resizeMode="contain"
              />
              <Text style={styles.lightboxCounter}>{lightboxIndex + 1} / {photos.length}</Text>
              <View style={styles.lightboxNav}>
                {lightboxIndex > 0 && (
                  <TouchableOpacity
                    style={styles.lightboxNavBtn}
                    onPress={() => setLightboxIndex(i => (i ?? 1) - 1)}
                  >
                    <View style={styles.lightboxNavInner}>
                      <Ionicons name="chevron-back" size={24} color="#fff" />
                    </View>
                  </TouchableOpacity>
                )}
                {lightboxIndex < photos.length - 1 && (
                  <TouchableOpacity
                    style={[styles.lightboxNavBtn, styles.lightboxNavRight]}
                    onPress={() => setLightboxIndex(i => (i ?? 0) + 1)}
                  >
                    <View style={styles.lightboxNavInner}>
                      <Ionicons name="chevron-forward" size={24} color="#fff" />
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon as any} size={15} color="#dc2626" />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

function InfoRow({
  label, value, highlight = false,
}: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, highlight && styles.infoValueHighlight]}>{value}</Text>
    </View>
  )
}

function MetaItem({ icon, label, bold }: { icon: string; label: string; bold?: boolean }) {
  return (
    <View style={styles.metaItem}>
      <Ionicons name={icon as any} size={13} color="#94a3b8" />
      <Text style={[styles.metaLabel, bold && { fontWeight: '800', color: '#0f172a' }]}>{label}</Text>
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const PHOTO_SIZE = (SCREEN_WIDTH - 32 - 32 - 16) / 3

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#fff5f5' },
  loader:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:  { flex: 1 },
  content: { padding: 16, gap: 14 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.07)',
    gap: 10,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fef2f2',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  headerSub:   { fontSize: 11, color: '#94a3b8', marginTop: 1 },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
  },
  statusDot:  { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '700' },

  // Hero
  heroCard: {
    backgroundColor: '#fff', borderRadius: 14,
    padding: 16, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  heroTop: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  sevBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  sevBadgeText: { fontSize: 11, fontWeight: '800' },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, backgroundColor: '#f1f5f9',
  },
  typeChipText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  heroMeta:  { gap: 6 },
  metaItem:  { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metaLabel: { fontSize: 13, color: '#475569', fontWeight: '500', flex: 1 },

  // Sections
  section: {
    backgroundColor: '#fff', borderRadius: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  sectionBody:  { padding: 16, gap: 10 },

  // Info rows
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  infoLabel:{ fontSize: 12, color: '#94a3b8', fontWeight: '600', flex: 1 },
  infoValue:{ fontSize: 13, color: '#374151', fontWeight: '600', textAlign: 'right', flex: 2 },
  infoValueHighlight: { color: '#dc2626', fontWeight: '800' },

  blockField: { gap: 4, marginTop: 4 },
  blockLabel: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  blockText:  { fontSize: 13, color: '#374151', lineHeight: 20 },
  descText:   { fontSize: 13, color: '#374151', lineHeight: 21 },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoThumb: {
    width: PHOTO_SIZE, height: PHOTO_SIZE,
    borderRadius: 10, overflow: 'hidden',
    backgroundColor: '#f1f5f9', position: 'relative',
  },
  photoImg: { width: '100%', height: '100%' },
  photoNum: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1,
  },
  photoNumText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  photoZoomHint: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6, padding: 3,
  },

  // Audit trail
  auditRow: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  auditRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  auditDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  auditTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  auditAction: { fontSize: 12, fontWeight: '700' },
  auditTime:   { fontSize: 11, color: '#94a3b8' },
  auditDetail: { fontSize: 11, color: '#64748b', marginTop: 1 },

  // Status modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 36, gap: 6,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  modalSub:   { fontSize: 12, color: '#94a3b8', marginBottom: 4 },
  statusOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 12,
    borderRadius: 12, marginBottom: 2,
  },
  statusOptionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statusOptionText: { fontSize: 14, fontWeight: '600' },
  modalCancel: {
    marginTop: 8, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#f1f5f9', alignItems: 'center',
  },
  modalCancelText: { fontSize: 14, fontWeight: '700', color: '#64748b' },

  // AI Analyze FAB
  fabBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 24 : 16, paddingTop: 12,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f1f5f9',
  },
  analyzeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#7c3aed', borderRadius: 14, paddingVertical: 14,
  },
  analyzeBtnLoading: { backgroundColor: '#a78bfa' },
  analyzeBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },

  // AI Modal
  aiModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  aiModalSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '85%', paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  aiModalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  aiModalIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f5f3ff', alignItems: 'center', justifyContent: 'center' },
  aiModalTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  aiModalSub:   { fontSize: 11, color: '#94a3b8', marginTop: 1, textTransform: 'capitalize' },
  aiModalBody:  { paddingHorizontal: 20, paddingTop: 14 },
  aiLoading:    { alignItems: 'center', paddingVertical: 48, gap: 12 },
  aiLoadingText:{ fontSize: 13, color: '#94a3b8' },
  aiResultText: { fontSize: 13, color: '#374151', lineHeight: 22 },

  // Lightbox
  lightbox: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.96)',
    alignItems: 'center', justifyContent: 'center',
  },
  lightboxClose:   { position: 'absolute', top: 52, right: 20, zIndex: 10 },
  lightboxImage:   { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.2 },
  lightboxCounter: { position: 'absolute', bottom: 60, fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  lightboxNav:     { position: 'absolute', bottom: 44, width: '100%' },
  lightboxNavBtn:  { position: 'absolute', left: 16 },
  lightboxNavRight:{ left: undefined, right: 16 },
  lightboxNavInner:{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 24, padding: 10 },
})
