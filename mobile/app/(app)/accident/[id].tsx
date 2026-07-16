/**
 * Accident Detail View
 *
 * Full-detail read view for a single accident report.
 * - All users: view full report, photo gallery with lightbox
 * - Managers / Directors: update status via bottom-sheet modal
 * - Admin only: delete report (with confirmation), view full audit trail
 *
 * Visual: Daylight design system (theme tokens, sunlight-legible).
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  View, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, Image,
  Dimensions, Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { supabase } from '../../../lib/supabase'
import { useRoleGuard } from '../../../hooks/useRoleGuard'
import { Theme, radius, spacing, statusColor, StatusKind } from '../../../lib/theme'
import { Screen, Card, AppText, Badge } from '../../../components/ui'
import AccidentClaimsPanel from '../../../components/AccidentClaimsPanel'
import { describeAuditRow, AuditRow } from '../../../lib/auditDiff'
import { exportAccidentPdf } from '../../../lib/accidentPdf'
import { resolveStorageUrls } from '../../../lib/storageRefs'
import {
  AccidentRecord, AccidentStatus, AccidentSeverity,
  SEVERITY_ICONS, STATUS_ICONS,
  isAdminOrAbove, isAdmin,
} from '../../../lib/types'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

type IconName = React.ComponentProps<typeof Ionicons>['name']

const STATUS_OPTIONS: AccidentStatus[] = ['reported', 'under_review', 'closed']

// Semantic mapping: preserve the MEANING of severity/status while sourcing the
// actual colours from the theme status kinds (sunlight-tuned).
const SEVERITY_KIND: Record<AccidentSeverity, StatusKind> = {
  minor: 'success', moderate: 'warning', severe: 'critical', fatal: 'danger',
}
const STATUS_KIND: Record<AccidentStatus, StatusKind> = {
  reported: 'info', under_review: 'warning', closed: 'neutral',
}

const TYPE_ICONS: Record<string, IconName> = {
  collision:       'car-sport-outline',
  rollover:        'refresh-circle-outline',
  tyre_failure:    'disc-outline',
  mechanical:      'build-outline',
  near_miss:       'warning-outline',
  property_damage: 'business-outline',
  other:           'ellipsis-horizontal-circle-outline',
}

export default function AccidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { allowed, loading: guardLoading } = useRoleGuard(['admin', 'manager', 'director', 'inspector'])
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const c = theme.color
  const styles = useMemo(() => createStyles(theme), [theme])
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
  const [exporting, setExporting]           = useState(false)
  const [photoUrls, setPhotoUrls]           = useState<string[]>([])

  async function handleExportPdf() {
    if (!accident || exporting) return
    setExporting(true)
    try {
      await exportAccidentPdf(accident)
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not generate the PDF.')
    } finally {
      setExporting(false)
    }
  }

  const role           = profile?.role ?? null
  const canChangeStatus = isAdminOrAbove(role)
  const canDelete       = isAdmin(role)
  const canSeeAudit     = isAdminOrAbove(role)

  const load = useCallback(async () => {
    if (!allowed || !id) return
    const [accRes, auditRes] = await Promise.all([
      supabase.from('accidents').select('*').eq('id', id).single(),
      canSeeAudit
        ? supabase.rpc('get_accident_audit', { p_accident_id: id })
        : Promise.resolve({ data: [] }),
    ])

    if (accRes.error || !accRes.data) {
      Alert.alert('Error', 'Could not load accident report.')
      router.back()
      return
    }
    const loadedAccident = accRes.data as AccidentRecord
    setAccident(loadedAccident)
    setPhotoUrls(await resolveStorageUrls(Array.isArray(loadedAccident.photos) ? loadedAccident.photos.filter(Boolean) : []))
    setAuditLog((auditRes.data ?? []) as AuditRow[])
    setLoading(false)
  }, [allowed, id, canSeeAudit])

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
      const { data } = await supabase.rpc('get_accident_audit', { p_accident_id: accident.id })
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
- Injuries: ${accident.injuries ? `Yes - ${accident.injury_count} persons` : 'No'}
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

  if (guardLoading || !allowed || loading) {
    return (
      <Screen>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      </Screen>
    )
  }

  if (!accident) return null

  const sevKind    = SEVERITY_KIND[accident.severity]
  const statusKind = STATUS_KIND[accident.status]
  const statusSc   = statusColor(theme, statusKind)
  const sevSc      = statusColor(theme, sevKind)
  const photos: string[] = photoUrls

  return (
    <Screen>
      {/* -- Header -------------------------------------------------------- */}
      <View style={[styles.header, isRTL && { flexDirection: 'row-reverse' }]}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={22} color={c.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h3" numberOfLines={1}>{t('accident.detailTitle')}</AppText>
          <AppText variant="micro" color="muted">#{accident.id.slice(0, 8).toUpperCase()}</AppText>
        </View>

        {/* Status badge - tappable for managers/admins */}
        <TouchableOpacity
          style={[styles.statusBadge, { backgroundColor: statusSc.soft, borderColor: statusSc.base + '55' }]}
          onPress={() => canChangeStatus && setShowStatusModal(true)}
          activeOpacity={canChangeStatus ? 0.7 : 1}
        >
          {statusLoading
            ? <ActivityIndicator size="small" color={statusSc.base} />
            : <>
                <Ionicons name={STATUS_ICONS[accident.status] as IconName} size={13} color={statusSc.on} />
                <AppText variant="micro" style={{ color: statusSc.on }}>
                  {t(`accident.statuses.${accident.status}`)}
                </AppText>
                {canChangeStatus && (
                  <Ionicons name="chevron-down" size={11} color={statusSc.on} style={{ marginLeft: 2 }} />
                )}
              </>
          }
        </TouchableOpacity>

        {/* Export PDF */}
        <TouchableOpacity style={[styles.iconBtn, { backgroundColor: c.danger.soft }]} onPress={handleExportPdf} disabled={exporting}>
          {exporting
            ? <ActivityIndicator size="small" color={c.danger.base} />
            : <Ionicons name="share-outline" size={18} color={c.danger.base} />}
        </TouchableOpacity>

        {/* Admin: delete button */}
        {canDelete && (
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: c.danger.soft }]}
            onPress={confirmDelete}
            disabled={deleting}
          >
            {deleting
              ? <ActivityIndicator size="small" color={c.danger.base} />
              : <Ionicons name="trash-outline" size={18} color={c.danger.base} />
            }
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

        {/* -- Hero severity card ------------------------------------------ */}
        <Card accent={sevSc.base} style={{ gap: spacing.md }}>
          <View style={styles.heroTop}>
            <Badge kind={sevKind} icon={SEVERITY_ICONS[accident.severity] as IconName} solid>
              {t(`accident.severities.${accident.severity}`).toUpperCase()}
            </Badge>
            <View style={[styles.typeChip, { backgroundColor: c.surfaceAlt }]}>
              <Ionicons name={(TYPE_ICONS[accident.accident_type] ?? 'alert-circle-outline')} size={13} color={c.textSecondary} />
              <AppText variant="caption" color="secondary">{t(`accident.types.${accident.accident_type}`)}</AppText>
            </View>
          </View>
          <View style={styles.heroMeta}>
            <MetaItem icon="business-outline"  label={accident.site} />
            <MetaItem icon="car-outline"       label={accident.asset_no} bold />
            <MetaItem icon="calendar-outline"  label={accident.incident_date} />
            {accident.incident_time ? <MetaItem icon="time-outline"     label={accident.incident_time} /> : null}
            {accident.location      ? <MetaItem icon="location-outline" label={accident.location} /> : null}
          </View>
        </Card>

        {/* -- Description ------------------------------------------------- */}
        {accident.description ? (
          <SectionCard title={t('accident.incidentInfo')} icon="document-text-outline">
            <AppText variant="body" color="secondary">{accident.description}</AppText>
          </SectionCard>
        ) : null}

        {/* -- Damage & Injuries ------------------------------------------ */}
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
              <AppText variant="caption" color="muted">{t('accident.damageDescLabel')}</AppText>
              <AppText variant="body" color="secondary">{accident.damage_description}</AppText>
            </View>
          ) : null}
        </SectionCard>

        {/* -- Reporter info (admin sees reviewer too) -------------------- */}
        <SectionCard title="Report Info" icon="person-circle-outline">
          {accident.driver_name ? (
            <InfoRow label={t('accident.driverLabel')} value={accident.driver_name} />
          ) : null}
          <InfoRow label="Reported By"  value={accident.reporter_name ?? '-'} />
          <InfoRow label="Submitted"    value={new Date(accident.created_at).toLocaleString()} />
          {accident.updated_at !== accident.created_at && (
            <InfoRow label="Last Updated" value={new Date(accident.updated_at).toLocaleString()} />
          )}
          {canSeeAudit && accident.reviewed_by && (
            <InfoRow label="Reviewed At" value={accident.reviewed_at ? new Date(accident.reviewed_at).toLocaleString() : '-'} />
          )}
        </SectionCard>

        {/* -- Notes ------------------------------------------------------ */}
        {accident.notes ? (
          <SectionCard title={t('accident.notesLabel')} icon="chatbubble-ellipses-outline">
            <AppText variant="body" color="secondary">{accident.notes}</AppText>
          </SectionCard>
        ) : null}

        {/* -- Deep claims module: closure, claim/responsibility, parts, log -- */}
        <AccidentClaimsPanel accident={accident} onChanged={load} />

        {/* -- Photo gallery ---------------------------------------------- */}
        {photos.length > 0 && (
          <SectionCard title={`${t('accident.photosSection')} (${photos.length})`} icon="images-outline">
            <View style={styles.photoGrid}>
              {photos.map((uri, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.photoThumb, { backgroundColor: c.surfaceSunken }]}
                  onPress={() => setLightboxIndex(idx)}
                  activeOpacity={0.85}
                >
                  <Image source={{ uri }} style={styles.photoImg} resizeMode="cover" />
                  <View style={styles.photoNum}>
                    <AppText variant="micro" style={{ color: '#fff' }}>{idx + 1}</AppText>
                  </View>
                  <View style={styles.photoZoomHint}>
                    <Ionicons name="expand-outline" size={12} color="#fff" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </SectionCard>
        )}

        {/* -- Activity / Audit (admin / manager / director only) --------- */}
        {canSeeAudit && auditLog.length > 0 && (
          <SectionCard title="Activity - who changed what" icon="shield-checkmark-outline">
            {auditLog.map((row, i) => {
              const actionColor =
                row.action === 'status_change' ? c.info.base
                : row.action === 'delete'      ? c.danger.base
                : row.action?.startsWith('part_') ? theme.tint.violet.fg
                : c.success.base
              const d = describeAuditRow(row)

              return (
                <View key={row.id} style={[styles.auditRow, i < auditLog.length - 1 && styles.auditRowBorder]}>
                  <View style={[styles.auditDot, { backgroundColor: actionColor }]} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={styles.auditTop}>
                      <AppText variant="caption" style={{ color: actionColor }}>{d.title}</AppText>
                      <AppText variant="micro" color="muted">
                        {new Date(row.changed_at).toLocaleDateString()} {new Date(row.changed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </AppText>
                    </View>
                    <AppText variant="micro" color="muted">
                      <Ionicons name="person-outline" size={10} color={c.textMuted} /> {row.actor_name ?? 'User'}
                    </AppText>
                    {d.summary && <AppText variant="micro" color="secondary">{d.summary}</AppText>}
                    {d.lines.map((l, li) => (
                      <AppText key={li} variant="micro" color="secondary">
                        {l.label}: <AppText variant="micro" style={{ color: c.danger.base }}>{l.from}</AppText> to <AppText variant="micro" style={{ color: c.success.base }}>{l.to}</AppText>
                      </AppText>
                    ))}
                  </View>
                </View>
              )
            })}
          </SectionCard>
        )}

        <View style={{ height: canChangeStatus ? 96 : 36 }} />
      </ScrollView>

      {/* -- AI Analyze FAB (admin / manager / director) ------------------- */}
      {canChangeStatus && (
        <View style={[styles.fabBar, { backgroundColor: c.surface, borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[styles.analyzeBtn, { backgroundColor: analyzing ? theme.tint.violet.fg + 'AA' : theme.tint.violet.fg }]}
            onPress={analyzeWithAI}
            disabled={analyzing}
            activeOpacity={0.85}
          >
            {analyzing
              ? <><ActivityIndicator size="small" color="#fff" /><AppText variant="bodyStrong" style={styles.analyzeBtnText}>Analyzing...</AppText></>
              : <><Ionicons name="sparkles-outline" size={18} color="#fff" /><AppText variant="bodyStrong" style={styles.analyzeBtnText}>Analyze with AI</AppText></>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* -- AI Result Modal --------------------------------------------- */}
      <Modal
        visible={showAiModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAiModal(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: c.overlay }]}>
          <View style={[styles.aiModalSheet, { backgroundColor: c.surface }]}>
            <View style={[styles.modalHandle, { backgroundColor: c.borderStrong }]} />
            <View style={[styles.aiModalHeader, { borderBottomColor: c.border }]}>
              <View style={[styles.aiModalIcon, { backgroundColor: theme.tint.violet.bg }]}>
                <Ionicons name="sparkles" size={18} color={theme.tint.violet.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="title">AI Accident Analysis</AppText>
                <AppText variant="micro" color="muted" style={{ textTransform: 'capitalize' }}>Tyre Engineer Agent - {accident?.accident_type?.replace('_', ' ')}</AppText>
              </View>
              <TouchableOpacity onPress={() => setShowAiModal(false)}>
                <Ionicons name="close-circle-outline" size={24} color={c.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.aiModalBody} showsVerticalScrollIndicator={false}>
              {analyzing || !aiResult
                ? <View style={styles.aiLoading}>
                    <ActivityIndicator size="large" color={theme.tint.violet.fg} />
                    <AppText variant="caption" color="muted">Analyzing accident data...</AppText>
                  </View>
                : <AppText variant="body" color="secondary">{aiResult}</AppText>
              }
              <View style={{ height: spacing['2xl'] }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* -- Status Modal ------------------------------------------------ */}
      <Modal
        visible={showStatusModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <TouchableOpacity style={[styles.modalBackdrop, { backgroundColor: c.overlay }]} activeOpacity={1} onPress={() => setShowStatusModal(false)}>
          <View style={[styles.modalSheet, { backgroundColor: c.surface }]}>
            <View style={[styles.modalHandle, { backgroundColor: c.borderStrong }]} />
            <AppText variant="h3">Update Status</AppText>
            <AppText variant="caption" color="muted" style={{ marginBottom: spacing.xs }}>Change the investigation status of this report</AppText>
            {STATUS_OPTIONS.map(opt => {
              const sc     = statusColor(theme, STATUS_KIND[opt])
              const active = opt === accident.status
              const icons: Record<AccidentStatus, IconName> = { reported: 'flag-outline', under_review: 'search-outline', closed: 'checkmark-circle-outline' }
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.statusOption, active && { backgroundColor: sc.soft }]}
                  onPress={() => updateStatus(opt)}
                >
                  <View style={[styles.statusOptionIcon, { backgroundColor: sc.soft }]}>
                    <Ionicons name={icons[opt]} size={17} color={sc.base} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong" style={{ color: active ? sc.on : c.textSecondary }}>
                      {t(`accident.statuses.${opt}`)}
                    </AppText>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={20} color={sc.base} />}
                </TouchableOpacity>
              )
            })}
            <TouchableOpacity style={[styles.modalCancel, { backgroundColor: c.surfaceAlt }]} onPress={() => setShowStatusModal(false)}>
              <AppText variant="bodyStrong" color="secondary">{t('common.cancel')}</AppText>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* -- Lightbox ---------------------------------------------------- */}
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
              <AppText style={styles.lightboxCounter}>{lightboxIndex + 1} / {photos.length}</AppText>
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
    </Screen>
  )
}

// -- Sub-components ---------------------------------------------------------------

function SectionCard({ title, icon, children }: { title: string; icon: IconName; children: React.ReactNode }) {
  const { theme } = useTheme()
  const styles = useMemo(() => createStyles(theme), [theme])
  return (
    <Card padded={false}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={15} color={theme.color.danger.base} />
        <AppText variant="label" style={{ color: theme.color.text }}>{title}</AppText>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </Card>
  )
}

function InfoRow({
  label, value, highlight = false,
}: { label: string; value: string; highlight?: boolean }) {
  const { theme } = useTheme()
  const styles = useMemo(() => createStyles(theme), [theme])
  return (
    <View style={styles.infoRow}>
      <AppText variant="caption" color="muted" style={{ flex: 1 }}>{label}</AppText>
      <AppText
        variant="bodyStrong"
        style={[styles.infoValue, { color: highlight ? theme.color.danger.base : theme.color.textSecondary }]}
      >
        {value}
      </AppText>
    </View>
  )
}

function MetaItem({ icon, label, bold }: { icon: IconName; label: string; bold?: boolean }) {
  const { theme } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Ionicons name={icon} size={13} color={theme.color.textMuted} />
      <AppText variant={bold ? 'bodyStrong' : 'body'} color={bold ? 'text' : 'secondary'} style={{ flex: 1 }}>{label}</AppText>
    </View>
  )
}

// -- Styles -----------------------------------------------------------------------

const PHOTO_SIZE = (SCREEN_WIDTH - 32 - 32 - 16) / 3

function createStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    loader:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll:  { flex: 1 },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },

    // Header
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      backgroundColor: c.surface,
      borderBottomWidth: 1, borderBottomColor: c.border,
      gap: spacing.sm,
    },
    iconBtn: {
      width: 38, height: 38, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.surfaceAlt,
    },
    statusBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.pill, borderWidth: 1,
    },

    // Hero
    heroTop: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'center' },
    typeChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: spacing.md, paddingVertical: 5,
      borderRadius: radius.pill,
    },
    heroMeta:  { gap: 6 },

    // Sections
    sectionHeader: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm + 2,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    sectionBody:  { padding: spacing.lg, gap: spacing.md },

    // Info rows
    infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
    infoValue:{ textAlign: 'right', flex: 2 },
    blockField: { gap: spacing.xs, marginTop: spacing.xs },

    // Photos
    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    photoThumb: {
      width: PHOTO_SIZE, height: PHOTO_SIZE,
      borderRadius: radius.md, overflow: 'hidden', position: 'relative',
    },
    photoImg: { width: '100%', height: '100%' },
    photoNum: {
      position: 'absolute', bottom: 4, right: 4,
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1,
    },
    photoZoomHint: {
      position: 'absolute', top: 4, right: 4,
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: 6, padding: 3,
    },

    // Audit trail
    auditRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
    auditRowBorder: { borderBottomWidth: 1, borderBottomColor: c.border },
    auditDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
    auditTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

    // Modals shared
    modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
    modalSheet: {
      borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
      padding: spacing.xl, paddingBottom: 36, gap: 6,
    },
    modalHandle: {
      width: 40, height: 4, borderRadius: 2,
      alignSelf: 'center', marginBottom: spacing.md,
    },
    statusOption: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingVertical: spacing.md, paddingHorizontal: spacing.md,
      borderRadius: radius.md, marginBottom: 2,
    },
    statusOptionIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    modalCancel: {
      marginTop: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.md,
      alignItems: 'center',
    },

    // AI Analyze FAB
    fabBar: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      paddingHorizontal: spacing.lg, paddingBottom: Platform.OS === 'ios' ? 24 : spacing.lg, paddingTop: spacing.md,
      borderTopWidth: 1,
    },
    analyzeBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
      borderRadius: radius.md, paddingVertical: spacing.md,
    },
    analyzeBtnText: { color: '#fff' },

    // AI Modal
    aiModalSheet: {
      borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
      maxHeight: '85%', paddingBottom: Platform.OS === 'ios' ? 36 : spacing['2xl'],
    },
    aiModalHeader: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md,
      borderBottomWidth: 1,
    },
    aiModalIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
    aiModalBody:  { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
    aiLoading:    { alignItems: 'center', paddingVertical: 48, gap: spacing.md },

    // Lightbox
    lightbox: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.96)',
      alignItems: 'center', justifyContent: 'center',
    },
    lightboxClose:   { position: 'absolute', top: 52, right: 20, zIndex: 10 },
    lightboxImage:   { width: SCREEN_WIDTH, height: SCREEN_WIDTH * 1.2 },
    lightboxCounter: { position: 'absolute', bottom: 60, color: 'rgba(255,255,255,0.6)' },
    lightboxNav:     { position: 'absolute', bottom: 44, width: '100%' },
    lightboxNavBtn:  { position: 'absolute', left: 16 },
    lightboxNavRight:{ left: undefined, right: 16 },
    lightboxNavInner:{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 24, padding: 10 },
  })
}
