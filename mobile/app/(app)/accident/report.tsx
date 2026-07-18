/**
 * Accident Report - full field-parity capture (mirrors the web incident form).
 *
 * Sectioned, scrollable, offline-safe form that captures the SAME record the web
 * app writes: Incident, Classification, People & Damage, Liability & GCC case,
 * Insurance & Claim, Repair & Release, and Photos. Constrained vocabularies use
 * clear dropdowns and are mapped to the DB CHECK tokens exactly like the web
 * accidentVocab helpers (severity/status/accident_type are lowercase tokens -
 * a raw label is NEVER written straight to those columns).
 *
 * Visual: Daylight design system (theme tokens, sunlight-legible).
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  View, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Platform,
  KeyboardAvoidingView, Switch, Modal,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { Theme, radius, spacing, statusColor, StatusKind } from '../../../lib/theme'
import { Screen, Card, AppText, Button } from '../../../components/ui'
import { supabase } from '../../../lib/supabase'
import { toUserMessage } from '../../../lib/safeError'
import { saveCommand } from '../../../lib/recordQueue'
import { safeUuid } from '../../../lib/ids'
import { useRoleGuard } from '../../../hooks/useRoleGuard'
import { extractScanCode, lookupAssetByCode } from '../../../lib/assetLookup'
import AccidentPhotoGrid, { AccidentPhotoEntry } from '../../../components/AccidentPhotoGrid'

type IconName = React.ComponentProps<typeof Ionicons>['name']

// ── Vocabulary + DB token maps (inline mirror of src/lib/accidentVocab.js) ─────
// The web app is the single source of truth; these replicate its label lists and
// toDb*/canon* semantics so mobile writes CHECK-constraint-valid tokens.

const SEVERITY_LABELS = ['Minor', 'Moderate', 'Major'] as const
type SeverityLabel = (typeof SEVERITY_LABELS)[number]
const SEV_KIND: Record<SeverityLabel, StatusKind> = {
  Minor: 'success', Moderate: 'warning', Major: 'danger',
}
// Minor/Moderate/Major -> chk_severity tokens minor/moderate/severe.
function toDbSeverity(s: string): string {
  const v = s.trim().toLowerCase()
  return ({ minor: 'minor', moderate: 'moderate', major: 'severe' } as Record<string, string>)[v] || 'minor'
}

const STATUS_LABELS = [
  'Reported', 'Under Investigation', 'Repair In Progress', 'Awaiting Parts',
  'Awaiting Approval', 'Insurance Claim', 'Closed',
]
function toDbStatus(s: string): string {
  const v = s.trim().toLowerCase().replace(/\s+/g, '_')
  return ({
    reported: 'reported', under_investigation: 'under_review',
    repair_in_progress: 'repair_in_progress', awaiting_parts: 'awaiting_parts',
    awaiting_approval: 'awaiting_approval', insurance_claim: 'insurance_claim',
    closed: 'closed',
  } as Record<string, string>)[v] || 'reported'
}

const ACCIDENT_TYPE_LABELS = [
  'Collision', 'Rollover', 'Rear-end', 'Side-swipe', 'Reversing', 'Fire',
  'Vandalism', 'Weather', 'Tyre failure', 'Mechanical', 'Near miss',
  'Property damage', 'Other',
]
const ACCIDENT_TYPE_TOKENS = new Set([
  'collision', 'rollover', 'rear_end', 'side_swipe', 'reversing', 'fire',
  'vandalism', 'weather', 'tyre_failure', 'mechanical', 'near_miss',
  'property_damage', 'other',
])
function toDbAccidentType(s: string): string {
  if (!s) return 'other'
  const k = s.toLowerCase().trim().replace(/[\s-]+/g, '_')
  return ACCIDENT_TYPE_TOKENS.has(k) ? k : 'other'
}

const CURRENT_CONDITION_OPTS = [
  'Running', 'Waiting for approval', 'Under Repair', 'Repair Completed', 'Released', 'Closed',
]
const DAMAGE_CONDITION_OPTS = ['Minor', 'Moderate', 'Major', 'N/A']
const FAULT_STATUS_OPTS = ['Faulty', 'Non-faulty', 'Under review']
const NAJM_STATUS_OPTS = ['Najm report', 'No Najm']
const NAJM_FAULT_OPTS = ['Faulty', 'Non-faulty', 'N/A']
const TAQDEER_STATUS_OPTS = ['Taqdeer report', 'No Taqdeer']
const LIABILITY_RATIO_OPTS = ['0', '50', '100']
const LIABLE_PARTY_OPTS = ['GCC', 'Other Party']
const PAYER_OPTS = ['GCC', 'Insurance', 'Recovery Claim']
const REPAIR_TYPE_OPTS = ['Internal', 'External']
const RECOVERY_DECISION_OPTS = ['Yes', 'No', 'N/A']

const CLAIM_STATUS_OPTS = ['none', 'filed', 'approved', 'rejected', 'settled']
const CLAIM_STATUS_LABELS: Record<string, string> = {
  none: 'No Claim', filed: 'Filed', approved: 'Approved', rejected: 'Rejected', settled: 'Settled',
}
const RECOVERY_SOURCE_OPTS = ['none', 'insurer', 'third_party', 'driver', 'warranty']
const RECOVERY_SOURCE_LABELS: Record<string, string> = {
  none: 'None', insurer: 'Insurer', third_party: 'Third Party', driver: 'Driver', warranty: 'Warranty',
}

const najmHasReport = (v: string) => /report/i.test(v || '') && !/^no/i.test(v || '')
const taqdeerHasReport = (v: string) => /report/i.test(v || '') && !/^no/i.test(v || '')
const recoveryIsYes = (v: string) => (v || '').trim().toLowerCase() === 'yes'
const repairIsInternal = (v: string) => (v || '') === 'Internal'

// Recovered = Claim - Approved - Deductible (spec formula), floored at 0.
function computeRecovered(claim: string, approved: string, deductible: string): number {
  const n = (x: string) => (Number.isFinite(Number(x)) ? Number(x) : 0)
  return Math.max(0, n(claim) - n(approved) - n(deductible))
}

// ── Native date/time picker plumbing ───────────────────────────────────────────
// Stored formats are EXACTLY what the submit payload already writes:
// dates as YYYY-MM-DD (accidents.incident_date etc.), time as HH:mm
// (accidents.incident_time). Formatting is LOCAL-time (never toISOString,
// which is UTC and can shift the calendar day for GCC timezones).
const pad2 = (n: number) => String(n).padStart(2, '0')
const formatDateLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const formatTimeLocal = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
function parseDateValue(v: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v || '').trim())
  // Noon avoids any DST/timezone edge flipping the day inside the picker.
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
  return new Date()
}
function parseTimeValue(v: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v || '').trim())
  const d = new Date()
  if (m) d.setHours(Math.min(23, Number(m[1])), Math.min(59, Number(m[2])), 0, 0)
  return d
}

// Sentinel for the Location dropdown's free-text branch (never persisted).
const OTHER_LOCATION = '__other__'

const ACC_TYPE_ICONS: Record<string, IconName> = {
  Collision: 'car-sport-outline', Rollover: 'refresh-circle-outline',
  'Rear-end': 'return-down-back-outline', 'Side-swipe': 'swap-horizontal-outline',
  Reversing: 'arrow-undo-outline', Fire: 'flame-outline', Vandalism: 'hammer-outline',
  Weather: 'thunderstorm-outline', 'Tyre failure': 'disc-outline', Mechanical: 'build-outline',
  'Near miss': 'warning-outline', 'Property damage': 'business-outline', Other: 'ellipsis-horizontal-circle-outline',
}

// ── Extended (field-parity) form state, kept separate from the base AccidentDraft
//    so we do not have to change the shared lib/types.ts contract. ──────────────
interface ExtraForm {
  plate_number: string
  vehicle_type: string
  severityLabel: SeverityLabel
  typeLabel: string
  statusLabel: string
  current_status: string
  damage_condition: string
  fault_status: string
  gcc_liability_ratio: string
  najm_status: string
  najm_fault: string
  taqdeer_status: string
  taqdeer_no: string
  liable_party: string
  payer: string
  responsible_party: string
  insurer: string
  policy_no: string
  insurance_claim_no: string
  claim_status: string
  claim_amount: string
  claim_approved_amount: string
  deductible: string
  recovered_amount: string
  recovery_status: string
  recovery_source: string
  recovery_date: string
  recovery_reference: string
  amount_transfer: string
  repair_type: string
  workshop_name: string
  workshop_location: string
  repair_cost: string
  expected_release_date: string
  release_date: string
}

function emptyExtra(): ExtraForm {
  return {
    plate_number: '', vehicle_type: '',
    severityLabel: 'Minor', typeLabel: 'Collision', statusLabel: 'Reported',
    current_status: '', damage_condition: '',
    fault_status: '', gcc_liability_ratio: '', najm_status: '', najm_fault: '',
    taqdeer_status: '', taqdeer_no: '', liable_party: '', payer: '', responsible_party: '',
    insurer: '', policy_no: '', insurance_claim_no: '', claim_status: '',
    claim_amount: '', claim_approved_amount: '', deductible: '', recovered_amount: '',
    recovery_status: '', recovery_source: '', recovery_date: '', recovery_reference: '', amount_transfer: '',
    repair_type: '', workshop_name: '', workshop_location: '', repair_cost: '',
    expected_release_date: '', release_date: '',
  }
}

// Base (already offline-safe) fields that stay in local state.
interface BaseForm {
  site: string
  asset_no: string
  vehicle_id: string | null
  country: string
  incident_date: string
  incident_time: string
  location: string
  description: string
  driver_name: string
  injuries: boolean
  injury_count: string
  third_party_involved: boolean
  police_report_no: string
  damage_description: string
  estimated_damage_cost: string
  notes: string
}
function emptyBase(): BaseForm {
  const now = new Date()
  return {
    site: '', asset_no: '', vehicle_id: null, country: '',
    incident_date: now.toISOString().split('T')[0],
    incident_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    location: '', description: '', driver_name: '',
    injuries: false, injury_count: '0', third_party_involved: false,
    police_report_no: '', damage_description: '', estimated_damage_cost: '', notes: '',
  }
}

interface FleetVehicle {
  id: string
  site: string
  asset_no: string
  vehicle_type: string
  registration_no?: string | null
  fleet_number?: string | null
  country?: string | null
}

const isUploadedPhoto = (u?: string | null): boolean =>
  !!u && (u.startsWith('tp-storage://') || u.startsWith('http'))

export default function AccidentReportScreen() {
  const { allowed, loading: guardLoading } = useRoleGuard(['admin', 'manager', 'director', 'inspector', 'tyre_man'])
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const c = theme.color
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => createStyles(theme), [theme])
  const router = useRouter()

  // Translate a constrained option LABEL for display only. The stored value
  // stays the English label (mapped to a DB token by toDb*), so tokens never change.
  const tOpt = (v: string) => (v ? t(`accident.report.opts.${v}`) : v)

  const [base, setBase] = useState<BaseForm>(emptyBase())
  const [extra, setExtra] = useState<ExtraForm>(emptyExtra())
  // Categorized photo entries (single doc slots + multi accident photos). The
  // grid keeps them ordered by category; the payload stays a plain string[]
  // of uploaded refs (category is encoded in each ref's storage filename).
  const [photoEntries, setPhotoEntries] = useState<AccidentPhotoEntry[]>([])
  const [photosUploading, setPhotosUploading] = useState(false)
  // Location dropdown: true when the reporter chose "Other" (free-text branch).
  const [locationOther, setLocationOther] = useState(false)
  const [sites, setSites] = useState<string[]>([])
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [manualAsset, setManualAsset] = useState('')
  const [useManualEntry, setUseManualEntry] = useState(false)
  // Search-first asset picker: the fleet list is never dumped; matching assets
  // appear only after the reporter types a search (or scans).
  const [vehicleQuery, setVehicleQuery] = useState('')
  const [savedOffline, setSavedOffline] = useState(false)
  const [success, setSuccess] = useState(false)

  // Once the user edits Recovered manually, stop auto-overwriting it.
  const recoveredTouched = useRef(false)
  // Once the user picks a site manually, an asset pick never overwrites it
  // (web parity: auto-fill only fills empty fields, never a typed value).
  const siteManual = useRef(false)

  const textAlign = isRTL ? 'right' : 'left'

  const setB = (p: Partial<BaseForm>) => setBase(prev => ({ ...prev, ...p }))
  const setX = (p: Partial<ExtraForm>) => setExtra(prev => ({ ...prev, ...p }))

  // Ordered, uploaded-only refs for validation + the submit payload.
  const uploadedPhotoRefs = useMemo(
    () => photoEntries.filter(e => isUploadedPhoto(e.url)).map(e => e.url),
    [photoEntries],
  )

  function goBack() {
    if (router.canGoBack()) router.back()
    else router.replace('/(app)/accident/dashboard')
  }

  // Asset-first flow (web parity): the fleet list loads up front so the reporter
  // searches the VEHICLE first; site/plate/type auto-fill from the picked asset.
  useEffect(() => { if (allowed) { loadSites(); loadVehicles() } }, [allowed])

  // Auto-recompute Recovered = Claim - Approved - Deductible until user overrides.
  useEffect(() => {
    if (recoveredTouched.current) return
    const r = computeRecovered(extra.claim_amount, extra.claim_approved_amount, extra.deductible)
    const next = r > 0 ? String(r) : ''
    if (next !== extra.recovered_amount) setX({ recovered_amount: next })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extra.claim_amount, extra.claim_approved_amount, extra.deductible])

  // Sites are loaded only as choices/suggestions - the SITE VALUE comes from the
  // picked asset's fleet-master row (or a manual tap), never pre-selected here.
  async function loadSites() {
    try {
      const { data: sitesData } = await supabase
        .from('sites').select('name').eq('active', true).order('name')
      if (sitesData && sitesData.length > 0) {
        setSites(sitesData.map((s: any) => s.name as string))
        return
      }
      const { data: fleetData } = await supabase.from('vehicle_fleet').select('site').order('site')
      if (fleetData && fleetData.length > 0) {
        setSites([...new Set(fleetData.map((r: any) => r.site).filter(Boolean))] as string[])
        return
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[accident/report] loadSites failed:', e?.message)
    }
    if (profile?.site) setSites([profile.site])
  }

  // Whole-fleet load (RLS/org-scoped) so the asset search works BEFORE a site is
  // chosen - mirrors the web form's fleetAssets list.
  async function loadVehicles() {
    setLoadingVehicles(true)
    try {
      const { data } = await supabase
        .from('vehicle_fleet')
        .select('id, site, asset_no, vehicle_type, registration_no, fleet_number, country')
        .order('asset_no')
      if (data) setVehicles(data as FleetVehicle[])
    } catch (e: any) {
      if (__DEV__) console.warn('[accident/report] loadVehicles failed:', e?.message)
    } finally {
      setLoadingVehicles(false)
    }
  }

  // Auto-fill from the fleet master on asset pick (web applyAssetMaster parity):
  // Fleet/plate no = fleet_number falling back to registration_no. SITE RULE
  // (deterministic): auto-fill writes site ONLY when the field is still empty
  // AND the user never tapped a site chip - a manual choice always wins and is
  // never overwritten by later asset picks or the debounced manual-asset
  // lookup. Plate/type have no typing surface on mobile, so they always track
  // the picked asset (re-picking a different asset refreshes them).
  function applyAsset(v: {
    asset_no: string; id?: string | null; vehicle_type?: string | null; site?: string | null
    registration_no?: string | null; fleet_number?: string | null; country?: string | null
  }) {
    setBase(prev => ({
      ...prev,
      asset_no: v.asset_no,
      vehicle_id: v.id ?? null,
      site: (siteManual.current || prev.site) ? prev.site : (v.site || ''),
      country: prev.country || v.country || prev.country,
    }))
    setX({
      vehicle_type: v.vehicle_type || '',
      plate_number: v.fleet_number || v.registration_no || '',
    })
  }

  // Debounced manual-asset lookup (reuse lib/assetLookup) -> auto-fill.
  useEffect(() => {
    if (!useManualEntry) return
    const code = extractScanCode(manualAsset)
    if (!code) return
    const h = setTimeout(async () => {
      try {
        const row = await lookupAssetByCode(manualAsset)
        if (row && row.asset_no.toLowerCase() === code.toLowerCase()) {
          // lookup gives site/vehicle_type; pull plate + country in one more read.
          const { data } = await supabase
            .from('vehicle_fleet').select('registration_no, country').eq('id', row.id).limit(1)
          const meta = (data && data[0]) as { registration_no?: string | null; country?: string | null } | undefined
          applyAsset({ ...row, registration_no: meta?.registration_no ?? null, country: meta?.country ?? null })
        }
      } catch (e: any) {
        if (__DEV__) console.warn('[accident/report] asset lookup failed:', e?.message)
      }
    }, 550)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualAsset, useManualEntry])

  function getEffectiveAssetNo(): string {
    return useManualEntry ? manualAsset.trim() : base.asset_no
  }

  function validate(): boolean {
    if (!getEffectiveAssetNo()) { Alert.alert(t('accident.report.alertRequired'), t('accident.report.alertSelectVehicle')); return false }
    if (!base.site) { Alert.alert(t('accident.report.alertRequired'), t('accident.report.alertSelectSite')); return false }
    if (!base.description.trim()) { Alert.alert(t('accident.report.alertRequired'), t('accident.report.alertDescribe')); return false }
    if (uploadedPhotoRefs.length === 0) { Alert.alert(t('accident.report.alertRequired'), t('accident.report.alertAttachPhoto')); return false }
    return true
  }

  const num = (v: string) => (v !== '' && v != null ? Number(v) : null)

  async function handleSubmit() {
    if (!validate()) return
    if (submitting || photosUploading) return
    setSubmitting(true)
    try {
      const effectiveAsset = getEffectiveAssetNo()
      const yes = recoveryIsYes(extra.recovery_status)
      const internal = repairIsInternal(extra.repair_type)
      const payload = {
        // Incident
        site: base.site,
        asset_no: effectiveAsset,
        vehicle_id: base.vehicle_id ?? null,
        plate_number: extra.plate_number || null,
        vehicle_type: extra.vehicle_type || null,
        reported_by: profile?.id ?? null,
        reporter_name: profile?.full_name ?? profile?.username ?? null,
        incident_date: base.incident_date,
        incident_time: base.incident_time || null,
        location: base.location || null,
        driver_name: base.driver_name?.trim() || null,
        description: base.description.trim(),
        country: base.country || profile?.country || null,
        // Classification (label -> DB CHECK token)
        accident_type: toDbAccidentType(extra.typeLabel),
        severity: toDbSeverity(extra.severityLabel),
        status: toDbStatus(extra.statusLabel),
        current_status: extra.current_status || null,
        damage_condition: extra.damage_condition || null,
        // People & damage
        injuries: base.injuries,
        injury_count: parseInt(base.injury_count) || 0,
        third_party_involved: base.third_party_involved,
        police_report_no: base.police_report_no || null,
        damage_description: base.damage_description || null,
        estimated_damage_cost: num(base.estimated_damage_cost),
        // Liability & GCC case
        fault_status: extra.fault_status || null,
        gcc_liability_ratio: num(extra.gcc_liability_ratio),
        najm_status: extra.najm_status || null,
        najm_fault: najmHasReport(extra.najm_status) ? (extra.najm_fault || null) : null,
        taqdeer_status: extra.taqdeer_status || null,
        taqdeer_no: taqdeerHasReport(extra.taqdeer_status) ? (extra.taqdeer_no || null) : null,
        liable_party: extra.liable_party || null,
        payer: extra.payer || null,
        responsible_party: extra.responsible_party || null,
        // Insurance & claim
        insurer: extra.insurer || null,
        policy_no: extra.policy_no || null,
        insurance_claim_no: extra.insurance_claim_no || null,
        claim_status: extra.claim_status || null,
        claim_amount: num(extra.claim_amount),
        claim_approved_amount: num(extra.claim_approved_amount),
        deductible: num(extra.deductible),
        recovered_amount: num(extra.recovered_amount),
        // Cost recovery (gated on Recovery = Yes)
        recovery_status: extra.recovery_status || 'N/A',
        recovery_source: yes ? (extra.recovery_source || 'none') : 'none',
        recovery_date: yes ? (extra.recovery_date || null) : null,
        recovery_reference: yes ? (extra.recovery_reference || null) : null,
        amount_transfer: yes ? num(extra.amount_transfer) : null,
        // Repair & release
        repair_type: extra.repair_type || null,
        workshop_name: extra.workshop_name || null,
        workshop_location: extra.workshop_location || null,
        repair_cost: internal ? num(extra.repair_cost) : null,
        expected_release_date: extra.expected_release_date || null,
        release_date: extra.release_date || null,
        // Photos + notes - plain string[] of uploaded refs, ordered by category
        // (license/resident/registration/najm/taqdeer first, accident photos
        // last); the category also lives in each ref's storage filename prefix,
        // so the recordQueue allow-list and web rendering are untouched.
        photos: uploadedPhotoRefs,
        notes: base.notes || null,
      }

      const res = await saveCommand('REPORT_ACCIDENT', payload, safeUuid())
      if (!res.ok) throw new Error(res.error || t('common.tryAgain'))
      setSavedOffline(!!res.offline)
      setSuccess(true)
    } catch (err: any) {
      Alert.alert(t('accident.report.alertSubmissionFailed'), toUserMessage(err, t('common.tryAgain')))
    } finally {
      setSubmitting(false)
    }
  }

  const inputStyle = [styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]

  if (guardLoading || !allowed) {
    return (
      <Screen>
        <View style={styles.loader}><ActivityIndicator size="large" color={c.primary} /></View>
      </Screen>
    )
  }

  // -- SUCCESS ---------------------------------------------------------------
  if (success) {
    return (
      <Screen>
        <View style={styles.successWrap}>
          <View style={[styles.successIcon, { backgroundColor: c.danger.soft }]}>
            <Ionicons name="shield-checkmark" size={72} color={c.danger.base} />
          </View>
          <AppText variant="h1" center>{t('accident.report.successTitle')}</AppText>
          <AppText variant="body" color="secondary" center style={{ marginTop: spacing.xs }}>
            {t('accident.report.successSubtitle')}
          </AppText>
          {savedOffline && (
            <View style={[styles.offlineNote, { backgroundColor: c.warning.soft }]}>
              <Ionicons name="cloud-offline-outline" size={16} color={c.warning.base} />
              <AppText variant="caption" style={{ flex: 1, color: c.warning.on }}>
                {t('accident.report.successOffline')}
              </AppText>
            </View>
          )}
          <AppText variant="caption" color="muted" center style={{ marginTop: spacing.md }}>
            {getEffectiveAssetNo()} - {base.site}{'\n'}{base.incident_date}
          </AppText>
          <Button label={t('accident.report.successBackHome')} icon="home-outline" variant="danger" size="lg"
            onPress={() => router.replace('/(app)')} style={{ marginTop: spacing['2xl'], minWidth: 220 }} />
          <Button label={t('accident.report.successNewReport')} icon="add-circle-outline" variant="secondary"
            onPress={() => {
              setBase(emptyBase()); setExtra(emptyExtra())
              setPhotoEntries([]); setLocationOther(false)
              setManualAsset(''); setUseManualEntry(false)
              recoveredTouched.current = false; siteManual.current = false; setSuccess(false)
            }}
            style={{ marginTop: spacing.md, minWidth: 220 }} />
        </View>
      </Screen>
    )
  }

  const canSubmit = !submitting && !photosUploading &&
    !!base.site && !!getEffectiveAssetNo() && uploadedPhotoRefs.length > 0

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* -- Header -- */}
        <View style={[styles.nav, isRTL && { flexDirection: 'row-reverse' }]}>
          <TouchableOpacity onPress={goBack} style={styles.navBack}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={c.danger.base} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <AppText variant="h3" style={{ textAlign }}>{t('accident.report.header')}</AppText>
            {getEffectiveAssetNo() ? (
              <AppText variant="caption" color="muted" style={{ textAlign }}>
                {getEffectiveAssetNo()}{base.site ? ` - ${base.site}` : ''}
              </AppText>
            ) : null}
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* ========== INCIDENT ========== */}
          {/* Field order mirrors the web incident form: Asset first (drives the
              auto-fill), then Date, Time, Site, Location, Driver, Description. */}
          <Section title={t('accident.report.secIncident')} icon="alert-circle-outline" styles={styles} c={c}>
            {/* Vehicle / Asset - picking one auto-fills site + fleet no + type */}
            <Field label={t('accident.report.vehicle')} styles={styles} textAlign={textAlign}>
              {loadingVehicles ? (
                <ActivityIndicator size="small" color={c.danger.base} style={{ marginTop: spacing.sm }} />
              ) : useManualEntry ? (
                <View style={{ gap: spacing.sm }}>
                  <TextInput style={[inputStyle, { textAlign }]} value={manualAsset} onChangeText={setManualAsset}
                    placeholder={t('accident.report.phEnterAsset')} placeholderTextColor={c.textMuted} autoCapitalize="characters" />
                  <TouchableOpacity onPress={() => { setUseManualEntry(false); setManualAsset(''); setX({ plate_number: '', vehicle_type: '' }) }} style={styles.manualToggle}>
                    <Ionicons name="list-outline" size={14} color={c.danger.base} />
                    <AppText variant="caption" style={{ color: c.danger.base }}>{t('accident.report.phSelectFromList')}</AppText>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {/* Search box - assets appear only after a query */}
                  <View style={[styles.searchBox, { borderColor: c.borderStrong, backgroundColor: c.surface }]}>
                    <Ionicons name="search-outline" size={16} color={c.textMuted} />
                    <TextInput
                      style={[styles.searchInput, { color: c.text, textAlign }]}
                      value={vehicleQuery}
                      onChangeText={setVehicleQuery}
                      placeholder={t('accident.report.phSearchVehicle')}
                      placeholderTextColor={c.textMuted}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />
                    {vehicleQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setVehicleQuery('')}>
                        <Ionicons name="close-circle" size={16} color={c.borderStrong} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {(() => {
                    const q = vehicleQuery.trim().toLowerCase()
                    const matches = q
                      ? vehicles.filter(v =>
                          v.asset_no?.toLowerCase().includes(q) ||
                          v.vehicle_type?.toLowerCase().includes(q) ||
                          v.registration_no?.toLowerCase().includes(q) ||
                          v.fleet_number?.toLowerCase().includes(q) ||
                          v.site?.toLowerCase().includes(q))
                      : []
                    if (!q) {
                      return (
                        <AppText variant="caption" color="muted">{t('accident.report.phSearchToBegin')}</AppText>
                      )
                    }
                    if (matches.length === 0) {
                      return <AppText variant="caption" color="muted">{t('accident.report.phNoVehicleMatch')}</AppText>
                    }
                    // keyboardShouldPersistTaps is NOT inherited from the outer
                    // ScrollView - without it the first chip tap while the
                    // search keyboard is open only dismisses the keyboard.
                    return (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                        <View style={styles.chipRow}>
                          {matches.map(v => {
                            const active = base.asset_no === v.asset_no
                            return (
                              <TouchableOpacity key={v.id}
                                style={[styles.chip, { borderColor: c.border, backgroundColor: c.surface }, active && { borderColor: c.danger.base, backgroundColor: c.danger.base }]}
                                onPress={() => applyAsset(v)}>
                                <AppText variant="caption" style={{ color: active ? '#fff' : c.textSecondary }}>{v.asset_no}</AppText>
                                <AppText variant="micro" style={{ color: active ? 'rgba(255,255,255,0.75)' : c.textMuted, marginTop: 2 }}>
                                  {[v.vehicle_type, v.site].filter(Boolean).join(' - ')}
                                </AppText>
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                      </ScrollView>
                    )
                  })()}

                  <TouchableOpacity onPress={() => { setUseManualEntry(true); setB({ asset_no: '', vehicle_id: null }); setX({ plate_number: '', vehicle_type: '' }) }} style={styles.manualToggle}>
                    <Ionicons name="create-outline" size={14} color={c.danger.base} />
                    <AppText variant="caption" style={{ color: c.danger.base }}>{t('accident.report.phEnterAssetManually')}</AppText>
                  </TouchableOpacity>
                </View>
              )}
              {/* Master context line (web "Master:" parity): type + fleet/plate no */}
              {(extra.plate_number || extra.vehicle_type) ? (
                <AppText variant="micro" color="muted" style={{ marginTop: 4 }}>
                  {t('accident.report.phMaster')} {extra.vehicle_type || t('accident.report.phTypeNa')}{extra.plate_number ? ` - ${t('accident.report.phFleetNo')} ${extra.plate_number}` : ''}
                </AppText>
              ) : null}
            </Field>

            {/* Date & time - native calendar/clock pickers; stored formats stay
                YYYY-MM-DD and HH:mm exactly as the submit payload expects. */}
            <View style={styles.row}>
              <DateField label={t('accident.report.date')} value={base.incident_date}
                onChange={v => setB({ incident_date: v })} mode="date" flex />
              <View style={{ width: spacing.md }} />
              <DateField label={t('accident.report.time')} value={base.incident_time}
                onChange={v => setB({ incident_time: v })} mode="time" flex />
            </View>

            {/* Site - auto-filled from the picked asset; a manual tap always wins.
                keyboardShouldPersistTaps: see the vehicle chip row note. */}
            <Field label={t('accident.report.site')} styles={styles} textAlign={textAlign}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.chipRow}>
                  {(base.site && !sites.includes(base.site) ? [base.site, ...sites] : sites).map(s => {
                    const active = base.site === s
                    return (
                      <TouchableOpacity key={s}
                        style={[styles.chip, { borderColor: c.border, backgroundColor: c.surface }, active && { borderColor: c.danger.base, backgroundColor: c.danger.base }]}
                        onPress={() => { siteManual.current = true; setB({ site: s }) }}>
                        <AppText variant="caption" style={{ color: active ? '#fff' : c.textSecondary }}>{s}</AppText>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </ScrollView>
            </Field>

            {/* Location - labeled dropdown (site list + Other free-text branch),
                same bottom-sheet style as every other constrained field. */}
            <Dropdown label={t('accident.report.location')}
              value={locationOther ? OTHER_LOCATION : base.location}
              options={[...sites, OTHER_LOCATION]}
              display={v => (v === OTHER_LOCATION ? tOpt('Other') : v)}
              onSelect={v => {
                if (v === OTHER_LOCATION) { setLocationOther(true); setB({ location: '' }) }
                else { setLocationOther(false); setB({ location: v }) }
              }}
              placeholder={t('accident.report.phWhereHappen')} clearable />
            {locationOther && (
              <TextInput style={[inputStyle, { textAlign }]} value={base.location} onChangeText={v => setB({ location: v })}
                placeholder={t('accident.report.phWhereHappen')} placeholderTextColor={c.textMuted} autoFocus />
            )}

            <Field label={t('accident.report.driver')} styles={styles} textAlign={textAlign}>
              <TextInput style={[inputStyle, { textAlign }]} value={base.driver_name} onChangeText={v => setB({ driver_name: v })}
                placeholder={t('accident.report.phDriverName')} placeholderTextColor={c.textMuted} autoCapitalize="words" />
            </Field>

            <Field label={t('accident.report.description')} styles={styles} textAlign={textAlign}>
              <TextInput style={[inputStyle, styles.textArea, { textAlign }]} value={base.description} onChangeText={v => setB({ description: v })}
                placeholder={t('accident.report.phDescribeHappen')} placeholderTextColor={c.textMuted} multiline numberOfLines={4} />
            </Field>
          </Section>

          {/* ========== CLASSIFICATION ========== */}
          <Section title={t('accident.report.secClassification')} icon="pricetags-outline" styles={styles} c={c}>
            <Dropdown label={t('accident.report.accidentType')} value={extra.typeLabel} options={ACCIDENT_TYPE_LABELS}
              onSelect={v => setX({ typeLabel: v })} placeholder={t('accident.report.phSelectType')} display={tOpt} />
            {/* Severity as 3-band chips */}
            <Field label={t('accident.report.severity')} styles={styles} textAlign={textAlign}>
              <View style={styles.sevRow}>
                {SEVERITY_LABELS.map(sev => {
                  const active = extra.severityLabel === sev
                  const sc = statusColor(theme, SEV_KIND[sev])
                  return (
                    <TouchableOpacity key={sev}
                      style={[styles.sevChip, { borderColor: c.border, backgroundColor: c.surface }, active && { backgroundColor: sc.base, borderColor: sc.base }]}
                      onPress={() => setX({ severityLabel: sev })}>
                      <AppText variant="caption" style={{ color: active ? '#fff' : c.textSecondary }}>{tOpt(sev)}</AppText>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Field>
            <Dropdown label={t('accident.report.status')} value={extra.statusLabel} options={STATUS_LABELS}
              onSelect={v => setX({ statusLabel: v })} placeholder={t('accident.report.phSelectStatus')} display={tOpt} />
            <Dropdown label={t('accident.report.currentCondition')} value={extra.current_status} options={CURRENT_CONDITION_OPTS}
              onSelect={v => setX({ current_status: v })} placeholder={t('accident.report.phSelectCondition')} display={tOpt} clearable />
          </Section>

          {/* ========== PEOPLE & DAMAGE ========== */}
          <Section title={t('accident.report.secPeopleDamage')} icon="medkit-outline" styles={styles} c={c}>
            <View style={[styles.toggleRow, isRTL && { flexDirection: 'row-reverse' }]}>
              <AppText variant="bodyStrong" style={{ flex: 1, textAlign }}>{t('accident.report.injuries')}</AppText>
              <Switch value={base.injuries} onValueChange={v => setB({ injuries: v, injury_count: v ? base.injury_count : '0' })}
                trackColor={{ false: c.borderStrong, true: c.danger.soft }} thumbColor={base.injuries ? c.danger.base : c.textMuted} />
            </View>
            {base.injuries && (
              <Field label={t('accident.report.injuryCount')} styles={styles} textAlign={textAlign}>
                <TextInput style={[inputStyle, { textAlign }]} value={base.injury_count} onChangeText={v => setB({ injury_count: v })}
                  placeholder="0" placeholderTextColor={c.textMuted} keyboardType="number-pad" />
              </Field>
            )}
            <View style={[styles.toggleRow, isRTL && { flexDirection: 'row-reverse' }]}>
              <AppText variant="bodyStrong" style={{ flex: 1, textAlign }}>{t('accident.report.thirdParty')}</AppText>
              <Switch value={base.third_party_involved} onValueChange={v => setB({ third_party_involved: v })}
                trackColor={{ false: c.borderStrong, true: c.danger.soft }} thumbColor={base.third_party_involved ? c.danger.base : c.textMuted} />
            </View>
            <Field label={t('accident.report.policeReportNo')} styles={styles} textAlign={textAlign}>
              <TextInput style={[inputStyle, { textAlign }]} value={base.police_report_no} onChangeText={v => setB({ police_report_no: v })}
                placeholder={t('modules.common.optional')} placeholderTextColor={c.textMuted} autoCapitalize="characters" />
            </Field>
            <Dropdown label={t('accident.report.damageCondition')} value={extra.damage_condition} options={DAMAGE_CONDITION_OPTS}
              onSelect={v => setX({ damage_condition: v })} placeholder={t('accident.report.phSelect')} display={tOpt} clearable />
            <Field label={t('accident.report.damageDescription')} styles={styles} textAlign={textAlign}>
              <TextInput style={[inputStyle, styles.textArea, { textAlign }]} value={base.damage_description} onChangeText={v => setB({ damage_description: v })}
                placeholder={t('accident.report.phWhatDamaged')} placeholderTextColor={c.textMuted} multiline numberOfLines={3} />
            </Field>
            <Field label={t('accident.report.estDamageCost')} styles={styles} textAlign={textAlign}>
              <TextInput style={[inputStyle, { textAlign }]} value={base.estimated_damage_cost} onChangeText={v => setB({ estimated_damage_cost: v })}
                placeholder="0.00" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" />
            </Field>
          </Section>

          {/* ========== LIABILITY & GCC CASE ========== */}
          <Section title={t('accident.report.secLiabilityGcc')} icon="shield-checkmark-outline" styles={styles} c={c}>
            <Dropdown label={t('accident.report.faultStatus')} value={extra.fault_status} options={FAULT_STATUS_OPTS}
              onSelect={v => setX({ fault_status: v })} placeholder={t('accident.report.phSelect')} display={tOpt} clearable />
            <Dropdown label={t('accident.report.gccLiability')} value={extra.gcc_liability_ratio}
              options={LIABILITY_RATIO_OPTS} display={v => `${v}%`}
              onSelect={v => setX({ gcc_liability_ratio: v })} placeholder={t('accident.report.phSelect')} clearable />
            <Dropdown label={t('accident.report.najmReport')} value={extra.najm_status} options={NAJM_STATUS_OPTS}
              onSelect={v => setX({ najm_status: v, najm_fault: najmHasReport(v) ? extra.najm_fault : '' })} placeholder={t('accident.report.phSelect')} display={tOpt} clearable />
            {najmHasReport(extra.najm_status) && (
              <Dropdown label={t('accident.report.najmFault')} value={extra.najm_fault} options={NAJM_FAULT_OPTS}
                onSelect={v => setX({ najm_fault: v })} placeholder={t('accident.report.phSelect')} display={tOpt} clearable />
            )}
            <Dropdown label={t('accident.report.taqdeerReport')} value={extra.taqdeer_status} options={TAQDEER_STATUS_OPTS}
              onSelect={v => setX({ taqdeer_status: v, taqdeer_no: taqdeerHasReport(v) ? extra.taqdeer_no : '' })} placeholder={t('accident.report.phSelect')} display={tOpt} clearable />
            {taqdeerHasReport(extra.taqdeer_status) && (
              <Field label={t('accident.report.taqdeerNo')} styles={styles} textAlign={textAlign}>
                <TextInput style={[inputStyle, { textAlign }]} value={extra.taqdeer_no} onChangeText={v => setX({ taqdeer_no: v })}
                  placeholder={t('accident.report.phEstimationRef')} placeholderTextColor={c.textMuted} />
              </Field>
            )}
            <Dropdown label={t('accident.report.liableParty')} value={extra.liable_party} options={LIABLE_PARTY_OPTS}
              onSelect={v => setX({ liable_party: v })} placeholder={t('accident.report.phSelect')} display={tOpt} clearable />
            <Dropdown label={t('accident.report.whoPays')} value={extra.payer} options={PAYER_OPTS}
              onSelect={v => setX({ payer: v })} placeholder={t('accident.report.phSelect')} display={tOpt} clearable />
            <Field label={t('accident.report.responsibleParty')} styles={styles} textAlign={textAlign}>
              <TextInput style={[inputStyle, { textAlign }]} value={extra.responsible_party} onChangeText={v => setX({ responsible_party: v })}
                placeholder={t('accident.report.phWhoAtFault')} placeholderTextColor={c.textMuted} />
            </Field>
          </Section>

          {/* ========== INSURANCE & CLAIM ========== */}
          <Section title={t('accident.report.secInsuranceClaim')} icon="briefcase-outline" styles={styles} c={c}>
            <Field label={t('accident.report.insurer')} styles={styles} textAlign={textAlign}>
              <TextInput style={[inputStyle, { textAlign }]} value={extra.insurer} onChangeText={v => setX({ insurer: v })}
                placeholder={t('accident.report.phInsuranceCompany')} placeholderTextColor={c.textMuted} />
            </Field>
            <View style={styles.row}>
              <Field label={t('accident.report.policyNo')} styles={styles} textAlign={textAlign} flex>
                <TextInput style={[inputStyle, { textAlign }]} value={extra.policy_no} onChangeText={v => setX({ policy_no: v })}
                  placeholder={t('accident.report.phPolicy')} placeholderTextColor={c.textMuted} />
              </Field>
              <View style={{ width: spacing.md }} />
              <Field label={t('accident.report.claimNo')} styles={styles} textAlign={textAlign} flex>
                <TextInput style={[inputStyle, { textAlign }]} value={extra.insurance_claim_no} onChangeText={v => setX({ insurance_claim_no: v })}
                  placeholder={t('accident.report.phClaim')} placeholderTextColor={c.textMuted} />
              </Field>
            </View>
            <Dropdown label={t('accident.report.claimStatus')} value={extra.claim_status} options={CLAIM_STATUS_OPTS}
              display={v => tOpt(CLAIM_STATUS_LABELS[v] ?? v)} onSelect={v => setX({ claim_status: v })} placeholder={t('accident.report.phSelect')} clearable />
            <View style={styles.row}>
              <Field label={t('accident.report.claimAmount')} styles={styles} textAlign={textAlign} flex>
                <TextInput style={[inputStyle, { textAlign }]} value={extra.claim_amount} onChangeText={v => setX({ claim_amount: v })}
                  placeholder="0.00" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" />
              </Field>
              <View style={{ width: spacing.md }} />
              <Field label={t('accident.report.approved')} styles={styles} textAlign={textAlign} flex>
                <TextInput style={[inputStyle, { textAlign }]} value={extra.claim_approved_amount} onChangeText={v => setX({ claim_approved_amount: v })}
                  placeholder="0.00" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" />
              </Field>
            </View>
            <View style={styles.row}>
              <Field label={t('accident.report.deductible')} styles={styles} textAlign={textAlign} flex>
                <TextInput style={[inputStyle, { textAlign }]} value={extra.deductible} onChangeText={v => setX({ deductible: v })}
                  placeholder="0.00" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" />
              </Field>
              <View style={{ width: spacing.md }} />
              <Field label={t('accident.report.recoveredAuto')} styles={styles} textAlign={textAlign} flex>
                <TextInput style={[inputStyle, { textAlign }]} value={extra.recovered_amount}
                  onChangeText={v => { recoveredTouched.current = true; setX({ recovered_amount: v }) }}
                  placeholder="0.00" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" />
              </Field>
            </View>
            <AppText variant="micro" color="muted">{t('accident.report.recoveredFormula')}</AppText>

            {/* Recovery gate */}
            <Dropdown label={t('accident.report.costRecovery')} value={extra.recovery_status} options={RECOVERY_DECISION_OPTS}
              onSelect={v => setX({ recovery_status: v })} placeholder={t('accident.report.phSelect')} display={tOpt} clearable />
            {recoveryIsYes(extra.recovery_status) && (
              <>
                <Dropdown label={t('accident.report.recoverySource')} value={extra.recovery_source} options={RECOVERY_SOURCE_OPTS}
                  display={v => tOpt(RECOVERY_SOURCE_LABELS[v] ?? v)} onSelect={v => setX({ recovery_source: v })} placeholder={t('accident.report.phSelect')} clearable />
                <View style={styles.row}>
                  <DateField label={t('accident.report.recoveryDate')} value={extra.recovery_date}
                    onChange={v => setX({ recovery_date: v })} mode="date" flex allowClear />
                  <View style={{ width: spacing.md }} />
                  <Field label={t('accident.report.amountTransfer')} styles={styles} textAlign={textAlign} flex>
                    <TextInput style={[inputStyle, { textAlign }]} value={extra.amount_transfer} onChangeText={v => setX({ amount_transfer: v })}
                      placeholder="0.00" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" />
                  </Field>
                </View>
                <Field label={t('accident.report.recoveryReference')} styles={styles} textAlign={textAlign}>
                  <TextInput style={[inputStyle, { textAlign }]} value={extra.recovery_reference} onChangeText={v => setX({ recovery_reference: v })}
                    placeholder={t('accident.report.phReference')} placeholderTextColor={c.textMuted} />
                </Field>
              </>
            )}
          </Section>

          {/* ========== REPAIR & RELEASE ========== */}
          <Section title={t('accident.report.secRepairRelease')} icon="construct-outline" styles={styles} c={c}>
            <Dropdown label={t('accident.report.repairType')} value={extra.repair_type} options={REPAIR_TYPE_OPTS}
              onSelect={v => setX({ repair_type: v })} placeholder={t('accident.report.phSelect')} display={tOpt} clearable />
            {repairIsInternal(extra.repair_type) ? (
              <Dropdown label={t('accident.report.workshopLocation')} value={extra.workshop_location} options={sites}
                onSelect={v => setX({ workshop_location: v })} placeholder={t('accident.report.phSelectGccSite')} clearable />
            ) : (
              <Field label={t('accident.report.workshopLocation')} styles={styles} textAlign={textAlign}>
                <TextInput style={[inputStyle, { textAlign }]} value={extra.workshop_location} onChangeText={v => setX({ workshop_location: v })}
                  placeholder={t('accident.report.phWorkshopLocName')} placeholderTextColor={c.textMuted} />
              </Field>
            )}
            <Field label={t('accident.report.workshopName')} styles={styles} textAlign={textAlign}>
              <TextInput style={[inputStyle, { textAlign }]} value={extra.workshop_name} onChangeText={v => setX({ workshop_name: v })}
                placeholder={repairIsInternal(extra.repair_type) ? t('accident.report.phGccWorkshop') : t('accident.report.phExtWorkshopName')} placeholderTextColor={c.textMuted} />
            </Field>
            {repairIsInternal(extra.repair_type) && (
              <Field label={t('accident.report.repairCost')} styles={styles} textAlign={textAlign}>
                <TextInput style={[inputStyle, { textAlign }]} value={extra.repair_cost} onChangeText={v => setX({ repair_cost: v })}
                  placeholder="0.00" placeholderTextColor={c.textMuted} keyboardType="decimal-pad" />
              </Field>
            )}
            <View style={styles.row}>
              <DateField label={t('accident.report.expectedRelease')} value={extra.expected_release_date}
                onChange={v => setX({ expected_release_date: v })} mode="date" flex allowClear />
              <View style={{ width: spacing.md }} />
              <DateField label={t('accident.report.releaseDate')} value={extra.release_date}
                onChange={v => setX({ release_date: v })} mode="date" flex allowClear />
            </View>
          </Section>

          {/* ========== PHOTOS ========== */}
          <Section title={t('accident.report.secPhotos')} icon="images-outline" styles={styles} c={c}>
            <AppText variant="caption" color="muted" style={{ textAlign }}>{t('accident.report.attachPhotoHint')}</AppText>
            <View style={{ marginTop: spacing.sm }}>
              <AccidentPhotoGrid entries={photoEntries} onChange={setPhotoEntries}
                onUploadingChange={setPhotosUploading} />
            </View>
            {photosUploading && (
              <View style={styles.uploadingRow}>
                <ActivityIndicator size="small" color={c.danger.base} />
                <AppText variant="caption" color="muted">{t('accident.report.uploadingPhoto')}</AppText>
              </View>
            )}
            <Field label={t('accident.report.notes')} styles={styles} textAlign={textAlign}>
              <TextInput style={[inputStyle, styles.textArea, { textAlign }]} value={base.notes} onChangeText={v => setB({ notes: v })}
                placeholder={t('accident.report.phExtraContext')} placeholderTextColor={c.textMuted} multiline numberOfLines={3} />
            </Field>
          </Section>

          <Button label={submitting ? t('accident.report.btnSubmitting') : t('accident.report.btnSubmit')} icon="cloud-upload-outline"
            variant="danger" size="lg" full loading={submitting} disabled={!canSubmit}
            onPress={handleSubmit} style={{ marginTop: spacing.xs }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

// ── Reusable pieces ────────────────────────────────────────────────────────────

function Section({
  title, icon, children, styles, c,
}: { title: string; icon: IconName; children: React.ReactNode; styles: any; c: Theme['color'] }) {
  return (
    <Card padded={false}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={15} color={c.danger.base} />
        <AppText variant="label" style={{ color: c.text }}>{title}</AppText>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </Card>
  )
}

function Field({
  label, children, styles, textAlign, flex,
}: { label: string; children: React.ReactNode; styles: any; textAlign: 'left' | 'right'; flex?: boolean }) {
  return (
    <View style={[styles.field, flex && { flex: 1 }]}>
      <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{label}</AppText>
      {children}
    </View>
  )
}

/**
 * Native date/time field: read-only input showing the stored value, tapping it
 * opens the platform calendar (mode="date") or clock (mode="time"). Android
 * renders the picker conditionally as a dialog (fires onChange once, then
 * closes); iOS shows an inline spinner with a Done row. Stored formats are
 * unchanged: YYYY-MM-DD for dates, HH:mm for time.
 */
function DateField({
  label, value, onChange, mode = 'date', flex, allowClear,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mode?: 'date' | 'time'
  flex?: boolean
  allowClear?: boolean
}) {
  const { theme } = useTheme()
  const { t } = useLanguage()
  const c = theme.color
  const styles = useMemo(() => createStyles(theme), [theme])
  const [open, setOpen] = useState(false)
  const parsed = mode === 'date' ? parseDateValue(value) : parseTimeValue(value)
  const commit = (d: Date) => onChange(mode === 'date' ? formatDateLocal(d) : formatTimeLocal(d))
  const onPicked = (event: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS !== 'ios') setOpen(false) // Android dialog: single onChange, then close
    if (event.type === 'set' && d) commit(d)
  }
  return (
    <View style={[styles.field, flex && { flex: 1 }]}>
      <AppText variant="micro" color="secondary" style={styles.fieldLabel}>{label}</AppText>
      <TouchableOpacity style={[styles.select, { backgroundColor: c.surface, borderColor: c.border }]}
        onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Ionicons name={mode === 'date' ? 'calendar-outline' : 'time-outline'} size={16} color={c.textSecondary} />
        <AppText variant="body" style={{ flex: 1, color: value ? c.text : c.textMuted }}>
          {value || (mode === 'date' ? 'YYYY-MM-DD' : 'HH:MM')}
        </AppText>
        {allowClear && !!value ? (
          <TouchableOpacity onPress={() => { setOpen(false); onChange('') }}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Ionicons name="close-circle" size={16} color={c.borderStrong} />
          </TouchableOpacity>
        ) : (
          <Ionicons name="chevron-down" size={16} color={c.textSecondary} />
        )}
      </TouchableOpacity>
      {open && (
        <>
          <DateTimePicker value={parsed} mode={mode} is24Hour
            display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={onPicked} />
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={[styles.ddCancel, { backgroundColor: c.surfaceAlt }]}
              onPress={() => { if (!value) commit(parsed); setOpen(false) }}>
              <AppText variant="bodyStrong" color="secondary">{t('common.done')}</AppText>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  )
}

/** Clear bottom-sheet dropdown for constrained vocabularies. */
function Dropdown({
  label, value, options, onSelect, placeholder, display, clearable,
}: {
  label: string
  value: string
  options: readonly string[]
  onSelect: (v: string) => void
  placeholder?: string
  display?: (v: string) => string
  clearable?: boolean
}) {
  const { theme } = useTheme()
  const { t } = useLanguage()
  const c = theme.color
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => createStyles(theme), [theme])
  const [open, setOpen] = useState(false)
  const shown = value ? (display ? display(value) : value) : ''
  return (
    <View style={styles.field}>
      <AppText variant="micro" color="secondary" style={styles.fieldLabel}>{label}</AppText>
      <TouchableOpacity style={[styles.select, { backgroundColor: c.surface, borderColor: c.border }]} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <AppText variant="body" style={{ flex: 1, color: shown ? c.text : c.textMuted }}>{shown || placeholder || t('accident.report.phSelect')}</AppText>
        <Ionicons name="chevron-down" size={18} color={c.textSecondary} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={[styles.ddBackdrop, { backgroundColor: c.overlay }]} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={[styles.ddSheet, { backgroundColor: c.surface, paddingBottom: Math.max(insets.bottom, 24) }]}>
            <View style={[styles.ddHandle, { backgroundColor: c.borderStrong }]} />
            <AppText variant="h3" style={{ marginBottom: spacing.sm }}>{label}</AppText>
            <ScrollView style={{ maxHeight: 360 }}>
              {/* Deselect row - visually distinct (muted + eraser icon) so it can
                  never be read as one of the actual values. */}
              {clearable && (
                <TouchableOpacity
                  style={[styles.ddOption, styles.ddClearRow, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
                  onPress={() => { onSelect(''); setOpen(false) }}>
                  <Ionicons name="backspace-outline" size={16} color={c.textMuted} />
                  <AppText variant="caption" color="muted" style={{ flex: 1, fontStyle: 'italic' }}>
                    {t('accident.report.clearSelection')}
                  </AppText>
                  {!value && <Ionicons name="checkmark-circle" size={20} color={c.danger.base} />}
                </TouchableOpacity>
              )}
              {options.map(opt => {
                const active = opt === value
                return (
                  <TouchableOpacity key={opt} style={[styles.ddOption, active && { backgroundColor: c.danger.soft }]} onPress={() => { onSelect(opt); setOpen(false) }}>
                    <AppText variant="body" style={{ flex: 1, color: active ? c.danger.on : c.textSecondary }}>{display ? display(opt) : opt}</AppText>
                    {active && <Ionicons name="checkmark-circle" size={20} color={c.danger.base} />}
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.ddCancel, { backgroundColor: c.surfaceAlt }]} onPress={() => setOpen(false)}>
              <AppText variant="bodyStrong" color="secondary">{t('accident.report.ddClose')}</AppText>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

function createStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.lg },

    nav: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border, gap: spacing.md,
    },
    navBack: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.danger.soft, alignItems: 'center', justifyContent: 'center' },

    sectionHeader: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm + 2,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    sectionBody: { padding: spacing.lg, gap: spacing.md },

    field: { gap: 6 },
    fieldLabel: { textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 15 },
    textArea: { minHeight: 84, textAlignVertical: 'top' },
    row: { flexDirection: 'row' },

    select: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    },

    sevRow: { flexDirection: 'row', gap: spacing.sm },
    sevChip: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm + 2, borderRadius: radius.pill, borderWidth: 1.5 },

    chipRow: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.xs },
    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44,
    },
    searchInput: { flex: 1, fontSize: 15 },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.md - 2, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center' },

    manualToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
    uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },

    toggleRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.surface, borderRadius: radius.md,
      padding: spacing.md, borderWidth: 1, borderColor: c.border,
    },

    // Dropdown sheet
    ddBackdrop: { flex: 1, justifyContent: 'flex-end' },
    ddSheet: { borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'], padding: spacing.xl, paddingBottom: 36 },
    ddHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
    ddOption: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, marginBottom: 2,
    },
    ddClearRow: { borderWidth: 1, borderStyle: 'dashed', gap: spacing.sm, marginBottom: spacing.sm, paddingVertical: spacing.sm + 2 },
    ddCancel: { marginTop: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center' },

    successWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing['2xl'] },
    successIcon: { width: 108, height: 108, borderRadius: 54, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
    offlineNote: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, maxWidth: 340,
    },
  })
}
