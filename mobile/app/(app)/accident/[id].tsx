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
  Dimensions,
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
  const { profile, isSuperAdmin } = useAuth()
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
  // Delete is strictly admin-only (or the platform super-admin).
  const canDelete       = isAdmin(role) === true || isSuperAdmin === true
  const canSeeAudit     = isAdminOrAbove(role)

  // Header back must return to the PREVIOUS screen, never Home. Fall back to the
  // accident dashboard when there is no navigation history (deep link / cold open).
  function goBack() {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)/accident/dashboard')
  }

  const load = useCallback(async () => {
    if (!allowed || !id) return
    try {
      const [accRes, auditRes] = await Promise.all([
        supabase.from('accidents').select('*').eq('id', id).single(),
        canSeeAudit
          ? supabase.rpc('get_accident_audit', { p_accident_id: id })
          : Promise.resolve({ data: [] }),
      ])

      if (accRes.error || !accRes.data) {
        Alert.alert('Error', 'Could not load accident report.')
        goBack()
        return
      }
      const loadedAccident = accRes.data as AccidentRecord
      setAccident(loadedAccident)
      // Photo URL resolution is best-effort: a storage hiccup must not blank the report.
      try {
        const refs = Array.isArray(loadedAccident.photos) ? loadedAccident.photos.filter(Boolean) : []
        setPhotoUrls(await resolveStorageUrls(refs))
      } catch (e: any) {
        if (__DEV__) console.warn('[accident/detail] photo resolve failed:', e?.message)
        setPhotoUrls([])
      }
      setAuditLog((auditRes.data ?? []) as AuditRow[])
    } catch (e: any) {
      if (__DEV__) console.warn('[accident/detail] load failed:', e?.message)
      Alert.alert('Error', 'Could not load accident report. Please try again.')
      goBack()
    } finally {
      setLoading(false)
    }
  }, [allowed, id, canSeeAudit])

  useEffect(() => { load() }, [load])

  async function updateStatus(newStatus: AccidentStatus) {
    if (!accident) return
    setStatusLoading(true)
    setShowStatusModal(false)
    try {
      const { error } = await supabase
        .from('accidents')
        .update({ status: newStatus })
        .eq('id', accident.id)

      if (error) {
        Alert.alert('Error', 'Failed to update status.')
      } else {
        setAccident(prev => prev ? { ...prev, status: newStatus } : prev)
        // Reload audit log (best-effort; a status update already succeeded)
        const { data } = await supabase.rpc('get_accident_audit', { p_accident_id: accident.id })
        if (data) setAuditLog(data as AuditRow[])
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[accident/detail] status update failed:', e?.message)
      Alert.alert('Error', 'Failed to update status. Please try again.')
    } finally {
      setStatusLoading(false)
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
            if (!accident) return
            setDeleting(true)
            try {
              const { error } = await supabase.from('accidents').delete().eq('id', accident.id)
              if (error) {
                Alert.alert('Error', 'Failed to delete report.')
              } else {
                goBack()
              }
            } catch (e: any) {
              if (__DEV__) console.warn('[accident/detail] delete failed:', e?.message)
              Alert.alert('Error', 'Failed to delete report. Please try again.')
            } finally {
              setDeleting(false)
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
        <TouchableOpacity style={styles.iconBtn} onPress={goBack}>
          <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={22} color={c.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h3" numberOfLines={1}>{t('accident.detailTitle')}</AppText>
          <AppText variant="micro" color="muted">#{accident.id.slice(0, 8).toUpperCase()}</AppText>
        </View>

        {/* Status badge - display only (status is changed via the clear
            dropdown in the body for managers/admins) */}
        <View style={[styles.statusBadge, { backgroundColor: statusSc.soft, borderColor: statusSc.base + '55' }]}>
          {statusLoading
            ? <ActivityIndicator size="small" color={statusSc.base} />
            : <>
                <Ionicons name={STATUS_ICONS[accident.status] as IconName} size={13} color={statusSc.on} />
                <AppText variant="micro" style={{ color: statusSc.on }}>
                  {t(`accident.statuses.${accident.status}`)}
                </AppText>
              </>
          }
        </View>

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

        {/* -- Status dropdown (managers / admins) ------------------------ */}
        {canChangeStatus && (
          <SectionCard title="Investigation Status" icon="flag-outline">
            <AppText variant="caption" color="muted" style={{ marginBottom: spacing.sm }}>
              Select the current status of this report
            </AppText>
            <TouchableOpacity
              style={[styles.statusDropdown, { backgroundColor: c.surface, borderColor: statusSc.base + '55' }]}
              onPress={() => setShowStatusModal(true)}
              disabled={statusLoading}
              activeOpacity={0.8}
            >
              <View style={[styles.statusDropdownDot, { backgroundColor: statusSc.base }]} />
              <AppText variant="bodyStrong" style={{ flex: 1, color: statusSc.on }}>
                {t(`accident.statuses.${accident.status}`)}
              </AppText>
              {statusLoading
                ? <ActivityIndicator size="small" color={statusSc.base} />
                : <Ionicons name="chevron-down" size={18} color={c.textSecondary} />}
            </TouchableOpacity>
          </SectionCard>
        )}

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

        {/* -- Classification & GCC case --------------------------------- */}
        {(() => {
          const a = accident as any
          const rows: Array<[string, string]> = []
          if (a.plate_number) rows.push(['Plate Number', String(a.plate_number)])
          if (a.vehicle_type) rows.push(['Vehicle Type', String(a.vehicle_type)])
          if (a.current_status) rows.push(['Current Condition', String(a.current_status)])
          if (a.damage_condition) rows.push(['Damage Condition', String(a.damage_condition)])
          if (a.fault_status) rows.push(['Fault Status', String(a.fault_status)])
          if (a.gcc_liability_ratio != null && a.gcc_liability_ratio !== '') rows.push(['GCC Liability', `${Number(a.gcc_liability_ratio)}%`])
          if (a.najm_status) rows.push(['Najm Report', String(a.najm_status)])
          if (a.najm_fault) rows.push(['Najm Fault', String(a.najm_fault)])
          if (a.taqdeer_status) rows.push(['Taqdeer Report', String(a.taqdeer_status)])
          if (a.taqdeer_no) rows.push(['Taqdeer No', String(a.taqdeer_no)])
          if (a.liable_party) rows.push(['Liable Party', String(a.liable_party)])
          if (a.payer) rows.push(['Who Pays', String(a.payer)])
          if (a.responsible_party) rows.push(['Responsible Party', String(a.responsible_party)])
          if (rows.length === 0) return null
          return (
            <SectionCard title="Classification & GCC Case" icon="shield-checkmark-outline">
              {rows.map(([label, value]) => <InfoRow key={label} label={label} value={value} />)}
            </SectionCard>
          )
        })()}

        {/* -- Repair & Release ------------------------------------------ */}
        {(() => {
          const a = accident as any
          const rows: Array<[string, string, boolean]> = []
          if (a.repair_type) rows.push(['Repair Type', String(a.repair_type), false])
          if (a.workshop_name) rows.push(['Workshop', String(a.workshop_name), false])
          if (a.workshop_location) rows.push(['Workshop Location', String(a.workshop_location), false])
          if (a.repair_cost != null) rows.push(['Repair Cost', `SAR ${Number(a.repair_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, true])
          if (a.expected_release_date) rows.push(['Expected Release', String(a.expected_release_date), false])
          if (a.release_date) rows.push(['Release Date', String(a.release_date), false])
          if (rows.length === 0) return null
          return (
            <SectionCard title="Repair & Release" icon="construct-outline">
              {rows.map(([label, value, hl]) => <InfoRow key={label} label={label} value={value} highlight={hl} />)}
            </SectionCard>
          )
        })()}

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

        <View style={{ height: 36 }} />
      </ScrollView>

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

    // Status dropdown (body control)
    statusDropdown: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.md,
      borderRadius: radius.md, borderWidth: 1.5,
    },
    statusDropdownDot: { width: 10, height: 10, borderRadius: 5 },

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
