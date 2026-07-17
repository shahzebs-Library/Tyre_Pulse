/**
 * Accident Report - 3-step form
 *
 * Step 1: Incident Details  (site, vehicle, date/time, location, type, severity, description)
 * Step 2: Damage & People   (injuries, third party, police report, damage desc, cost)
 * Step 3: Photos + Submit   (multi-photo capture, min 1, submit to Supabase)
 *
 * Visual: Daylight design system (theme tokens, sunlight-legible).
 */

import { useState, useEffect, useMemo } from 'react'
import {
  View, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Platform,
  KeyboardAvoidingView, Switch,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { Theme, radius, spacing, statusColor, StatusKind } from '../../../lib/theme'
import { Screen, Card, AppText, Button } from '../../../components/ui'
import { supabase } from '../../../lib/supabase'
import { saveCommand } from '../../../lib/recordQueue'
import { safeUuid } from '../../../lib/ids'
import { useRoleGuard } from '../../../hooks/useRoleGuard'
import AccidentPhotoGrid from '../../../components/AccidentPhotoGrid'
import {
  VehicleFleet, AccidentDraft, AccidentType, AccidentSeverity,
  emptyAccidentDraft, SEVERITY_ICONS,
} from '../../../lib/types'

type Step = 'step1' | 'step2' | 'step3' | 'success'
type IconName = React.ComponentProps<typeof Ionicons>['name']

const TYPES: AccidentType[] = [
  'collision', 'rollover', 'tyre_failure',
  'mechanical', 'near_miss', 'property_damage', 'other',
]
const SEVERITIES: AccidentSeverity[] = ['minor', 'moderate', 'severe', 'fatal']

const SEVERITY_KIND: Record<AccidentSeverity, StatusKind> = {
  minor: 'success', moderate: 'warning', severe: 'critical', fatal: 'danger',
}

// A photo counts as "uploaded" once it holds a permanent reference - either a
// private-bucket storage ref (tp-storage://, resolved to a signed URL on
// display) or a legacy public URL. Empty strings are un-uploaded placeholders.
const isUploadedPhoto = (u?: string | null): boolean =>
  !!u && (u.startsWith('tp-storage://') || u.startsWith('http'))

export default function AccidentReportScreen() {
  const { allowed, loading: guardLoading } = useRoleGuard(['admin', 'manager', 'director', 'inspector', 'tyre_man'])
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const c = theme.color
  const styles = useMemo(() => createStyles(theme), [theme])
  const router = useRouter()

  const [step, setStep] = useState<Step>('step1')
  const [draft, setDraft] = useState<AccidentDraft>(emptyAccidentDraft())
  const [photoUrls, setPhotoUrls]         = useState<string[]>([])
  const [photoLocalUris, setPhotoLocalUris] = useState<string[]>([])
  const [photosUploading, setPhotosUploading] = useState(false)
  const [sites, setSites]                 = useState<string[]>([])
  const [vehicles, setVehicles]           = useState<VehicleFleet[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(false)
  const [submitting, setSubmitting]       = useState(false)
  const [manualAsset, setManualAsset]     = useState('')
  const [useManualEntry, setUseManualEntry] = useState(false)
  const [savedOffline, setSavedOffline]   = useState(false)

  const textAlign   = isRTL ? 'right' : 'left'
  const backIcon: IconName    = isRTL ? 'arrow-forward' : 'arrow-back'

  useEffect(() => { if (allowed) loadSites() }, [allowed])
  useEffect(() => {
    if (allowed && draft.site) loadVehicles(draft.site)
  }, [allowed, draft.site])

  async function loadSites() {
    try {
      // 1. Try sites table (primary source)
      const { data: sitesData } = await supabase
        .from('sites').select('name').eq('active', true).order('name')
      if (sitesData && sitesData.length > 0) {
        const names = sitesData.map((s: any) => s.name as string)
        setSites(names)
        // Auto-select: profile.site match -> single site -> nothing
        const profMatch = profile?.site && names.includes(profile.site) ? profile.site : null
        const autoSite = profMatch ?? (names.length === 1 ? names[0] : null)
        if (autoSite) update({ site: autoSite })
        return
      }
      // 2. Fallback: vehicle_fleet.site
      const { data: fleetData } = await supabase
        .from('vehicle_fleet').select('site').order('site')
      if (fleetData && fleetData.length > 0) {
        const unique = [...new Set(fleetData.map((r: any) => r.site).filter(Boolean))] as string[]
        setSites(unique)
        const profMatch = profile?.site && unique.includes(profile.site) ? profile.site : null
        const autoSite = profMatch ?? (unique.length === 1 ? unique[0] : null)
        if (autoSite) update({ site: autoSite })
        return
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[accident/report] loadSites failed:', e?.message)
    }
    // 3. Fallback: profile.site only (also covers a failed lookup above)
    if (profile?.site) {
      setSites([profile.site])
      update({ site: profile.site })
    }
  }

  async function loadVehicles(site: string) {
    setLoadingVehicles(true)
    try {
      const { data } = await supabase
        .from('vehicle_fleet')
        .select('id, site, asset_no, vehicle_type, make, model')
        .eq('site', site)
        .order('asset_no')
      if (data) setVehicles(data)
    } catch (e: any) {
      if (__DEV__) console.warn('[accident/report] loadVehicles failed:', e?.message)
    } finally {
      setLoadingVehicles(false)
    }
  }

  function update(partial: Partial<AccidentDraft>) {
    setDraft(prev => ({ ...prev, ...partial }))
  }

  // -- Validation ------------------------------------------------------------

  function getEffectiveAssetNo(): string {
    return useManualEntry ? manualAsset.trim() : draft.asset_no
  }

  function validateStep1(): boolean {
    if (!draft.site) {
      Alert.alert(t('accident.alertRequired'), t('accident.alertSelectSite'))
      return false
    }
    if (!getEffectiveAssetNo()) {
      Alert.alert(t('accident.alertRequired'), t('accident.alertSelectVehicle'))
      return false
    }
    if (!draft.description.trim()) {
      Alert.alert(t('accident.alertRequired'), t('accident.alertDesc'))
      return false
    }
    return true
  }

  function validateStep3(): boolean {
    const uploadedPhotos = photoUrls.filter(isUploadedPhoto)
    if (uploadedPhotos.length === 0) {
      Alert.alert(t('accident.alertRequired'), t('accident.alertPhoto'))
      return false
    }
    return true
  }

  // -- Submit ----------------------------------------------------------------

  async function handleSubmit() {
    if (!validateStep3()) return
    if (submitting) return
    setSubmitting(true)

    try {
      const effectiveAsset = getEffectiveAssetNo()
      const selectedVehicle = vehicles.find(v => v.asset_no === effectiveAsset)
      const payload = {
        site:                   draft.site,
        asset_no:               effectiveAsset,
        vehicle_id:             selectedVehicle?.id ?? null,
        reported_by:            profile?.id ?? null,
        reporter_name:          profile?.full_name ?? profile?.username ?? null,
        incident_date:          draft.incident_date,
        incident_time:          draft.incident_time || null,
        location:               draft.location || null,
        accident_type:          draft.accident_type,
        severity:               draft.severity,
        description:            draft.description.trim(),
        injuries:               draft.injuries,
        injury_count:           parseInt(draft.injury_count) || 0,
        third_party_involved:   draft.third_party_involved,
        police_report_no:       draft.police_report_no || null,
        damage_description:     draft.damage_description || null,
        estimated_damage_cost:  draft.estimated_damage_cost
                                  ? parseFloat(draft.estimated_damage_cost)
                                  : null,
        photos:                 photoUrls.filter(isUploadedPhoto),
        notes:                  draft.notes || null,
        status:                 'reported',
        country:                profile?.country ?? null,
        driver_name:            draft.driver_name?.trim() || null,
      }

      // Offline-safe: route through the typed record queue like every other
      // write. Inserts immediately when online, queues + auto-syncs when not -
      // a report filed at a crash scene with no signal is never lost. The stable
      // client id makes a replayed insert idempotent (V215 accidents.client_uuid).
      const res = await saveCommand('REPORT_ACCIDENT', payload, safeUuid())
      if (!res.ok) throw new Error(res.error || 'Please try again.')
      setSavedOffline(!!res.offline)
      setStep('success')
    } catch (err: any) {
      Alert.alert('Submission Failed', err.message ?? 'Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // -- Step header -----------------------------------------------------------

  function NavBar({
    titleKey, onBack,
  }: { titleKey: string; onBack: () => void }) {
    const stepNum = step === 'step1' ? 1 : step === 'step2' ? 2 : 3
    return (
      <View style={[styles.nav, isRTL && { flexDirection: 'row-reverse' }]}>
        <TouchableOpacity onPress={onBack} style={styles.navBack}>
          <Ionicons name={backIcon} size={22} color={c.danger.base} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h3" style={{ textAlign }}>{t(titleKey)}</AppText>
          {draft.asset_no ? (
            <AppText variant="caption" color="muted" style={{ textAlign }}>
              {draft.asset_no} - {draft.site}
            </AppText>
          ) : null}
        </View>
        <View style={styles.stepPills}>
          {[1, 2, 3].map(n => {
            const active = n === stepNum
            const done = n < stepNum
            return (
              <View
                key={n}
                style={[
                  styles.stepPill,
                  { backgroundColor: active || done ? c.danger.base : c.danger.soft },
                ]}
              >
                {done
                  ? <Ionicons name="checkmark" size={13} color="#fff" />
                  : <AppText variant="micro" style={{ color: active ? '#fff' : c.danger.on }}>{n}</AppText>}
              </View>
            )
          })}
        </View>
      </View>
    )
  }

  const inputStyle = [styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]

  if (guardLoading || !allowed) {
    return (
      <Screen>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      </Screen>
    )
  }

  // -- STEP 1: Incident Details ---------------------------------------------
  if (step === 'step1') {
    return (
      <Screen>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <NavBar titleKey="accident.step1Title" onBack={() => router.back()} />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

            {/* Severity header card */}
            <Card style={{ padding: spacing.md }}>
              <AppText variant="micro" color="muted" style={{ textTransform: 'uppercase', marginBottom: spacing.sm }}>
                Severity
              </AppText>
              <View style={styles.severityRow}>
                {SEVERITIES.map(sev => {
                  const active = draft.severity === sev
                  const sc = statusColor(theme, SEVERITY_KIND[sev])
                  return (
                    <TouchableOpacity
                      key={sev}
                      style={[
                        styles.severityChip,
                        { borderColor: c.border, backgroundColor: c.surface },
                        active && { backgroundColor: sc.base, borderColor: sc.base },
                      ]}
                      onPress={() => update({ severity: sev })}
                    >
                      <Ionicons
                        name={SEVERITY_ICONS[sev] as IconName}
                        size={16}
                        color={active ? '#fff' : sc.base}
                      />
                      <AppText variant="caption" style={{ color: active ? '#fff' : c.textSecondary }}>
                        {t(`accident.severities.${sev}`)}
                      </AppText>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Card>

            {/* Site */}
            <View style={styles.field}>
              <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.siteLabel')}</AppText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  {sites.map(s => {
                    const active = draft.site === s
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[styles.chip, { borderColor: c.border, backgroundColor: c.surface }, active && { borderColor: c.danger.base, backgroundColor: c.danger.base }]}
                        onPress={() => { update({ site: s, asset_no: '', vehicle_id: null }); setVehicles([]) }}
                      >
                        <AppText variant="caption" style={{ color: active ? '#fff' : c.textSecondary }}>{s}</AppText>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </ScrollView>
            </View>

            {/* Vehicle */}
            {draft.site ? (
              <View style={styles.field}>
                <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.vehicleLabel')}</AppText>
                {loadingVehicles ? (
                  <ActivityIndicator size="small" color={c.danger.base} style={{ marginTop: spacing.sm }} />
                ) : useManualEntry ? (
                  <View style={{ gap: spacing.sm }}>
                    <TextInput
                      style={[inputStyle, { textAlign }]}
                      value={manualAsset}
                      onChangeText={setManualAsset}
                      placeholder="Enter asset / vehicle number"
                      placeholderTextColor={c.textMuted}
                      autoCapitalize="characters"
                    />
                    <TouchableOpacity
                      onPress={() => { setUseManualEntry(false); setManualAsset('') }}
                      style={styles.manualToggle}
                    >
                      <Ionicons name="list-outline" size={14} color={c.danger.base} />
                      <AppText variant="caption" style={{ color: c.danger.base }}>Select from list</AppText>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    {vehicles.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.chipRow}>
                          {vehicles.map(v => {
                            const active = draft.asset_no === v.asset_no
                            return (
                              <TouchableOpacity
                                key={v.id}
                                style={[styles.chip, { borderColor: c.border, backgroundColor: c.surface }, active && { borderColor: c.danger.base, backgroundColor: c.danger.base }]}
                                onPress={() => update({ asset_no: v.asset_no, vehicle_id: v.id })}
                              >
                                <AppText variant="caption" style={{ color: active ? '#fff' : c.textSecondary }}>
                                  {v.asset_no}
                                </AppText>
                                <AppText variant="micro" style={{ color: active ? 'rgba(255,255,255,0.75)' : c.textMuted, marginTop: 2 }}>
                                  {v.vehicle_type}
                                </AppText>
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                      </ScrollView>
                    ) : (
                      <AppText variant="caption" color="muted">No vehicles registered for this site.</AppText>
                    )}
                    <TouchableOpacity
                      onPress={() => { setUseManualEntry(true); update({ asset_no: '', vehicle_id: null }) }}
                      style={styles.manualToggle}
                    >
                      <Ionicons name="create-outline" size={14} color={c.danger.base} />
                      <AppText variant="caption" style={{ color: c.danger.base }}>Enter asset number manually</AppText>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : null}

            {/* Date & Time row */}
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.dateLabel')}</AppText>
                <TextInput
                  style={[inputStyle, { textAlign }]}
                  value={draft.incident_date}
                  onChangeText={v => update({ incident_date: v })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={c.textMuted}
                />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={[styles.field, { flex: 1 }]}>
                <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.timeLabel')}</AppText>
                <TextInput
                  style={[inputStyle, { textAlign }]}
                  value={draft.incident_time}
                  onChangeText={v => update({ incident_time: v })}
                  placeholder="HH:MM"
                  placeholderTextColor={c.textMuted}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>

            {/* Location */}
            <View style={styles.field}>
              <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.locationLabel')}</AppText>
              <TextInput
                style={[inputStyle, { textAlign }]}
                value={draft.location}
                onChangeText={v => update({ location: v })}
                placeholder={t('accident.locationPlaceholder')}
                placeholderTextColor={c.textMuted}
              />
            </View>

            {/* Accident Type */}
            <View style={styles.field}>
              <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.typeLabel')}</AppText>
              <View style={styles.typeGrid}>
                {TYPES.map(type => {
                  const active = draft.accident_type === type
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[styles.typeChip, { borderColor: c.danger.base + '55', backgroundColor: c.danger.soft }, active && { backgroundColor: c.danger.base, borderColor: c.danger.base }]}
                      onPress={() => update({ accident_type: type })}
                    >
                      <Ionicons
                        name={TYPE_ICONS[type]}
                        size={16}
                        color={active ? '#fff' : c.danger.base}
                      />
                      <AppText variant="caption" style={{ color: active ? '#fff' : c.danger.on }}>
                        {t(`accident.types.${type}`)}
                      </AppText>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            {/* Description */}
            <View style={styles.field}>
              <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.descLabel')}</AppText>
              <TextInput
                style={[inputStyle, styles.textArea, { textAlign }]}
                value={draft.description}
                onChangeText={v => update({ description: v })}
                placeholder={t('accident.descPlaceholder')}
                placeholderTextColor={c.textMuted}
                multiline
                numberOfLines={4}
              />
            </View>

            <Button
              label={t('accident.nextBtn')}
              icon="arrow-forward"
              variant="danger"
              size="lg"
              full
              disabled={!draft.site || !getEffectiveAssetNo()}
              onPress={() => validateStep1() && setStep('step2')}
              style={{ marginTop: spacing.xs }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    )
  }

  // -- STEP 2: Damage & People ----------------------------------------------
  if (step === 'step2') {
    return (
      <Screen>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <NavBar titleKey="accident.step2Title" onBack={() => setStep('step1')} />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

            {/* Driver involved */}
            <View style={styles.field}>
              <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.driverLabel')}</AppText>
              <TextInput
                style={[inputStyle, { textAlign }]}
                value={draft.driver_name}
                onChangeText={v => update({ driver_name: v })}
                placeholder={t('accident.driverPlaceholder')}
                placeholderTextColor={c.textMuted}
                autoCapitalize="words"
              />
            </View>

            {/* Injuries toggle */}
            <View style={[styles.toggleRow, isRTL && { flexDirection: 'row-reverse' }]}>
              <AppText variant="bodyStrong" style={{ flex: 1, textAlign }}>{t('accident.injuriesLabel')}</AppText>
              <Switch
                value={draft.injuries}
                onValueChange={v => update({ injuries: v, injury_count: v ? draft.injury_count : '0' })}
                trackColor={{ false: c.borderStrong, true: c.danger.soft }}
                thumbColor={draft.injuries ? c.danger.base : c.textMuted}
              />
            </View>

            {draft.injuries && (
              <View style={styles.field}>
                <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.injuryCountLabel')}</AppText>
                <TextInput
                  style={[inputStyle, { textAlign }]}
                  value={draft.injury_count}
                  onChangeText={v => update({ injury_count: v })}
                  placeholder={t('accident.injuryCountPlaceholder')}
                  placeholderTextColor={c.textMuted}
                  keyboardType="number-pad"
                />
              </View>
            )}

            {/* Third party toggle */}
            <View style={[styles.toggleRow, isRTL && { flexDirection: 'row-reverse' }]}>
              <AppText variant="bodyStrong" style={{ flex: 1, textAlign }}>{t('accident.thirdPartyLabel')}</AppText>
              <Switch
                value={draft.third_party_involved}
                onValueChange={v => update({ third_party_involved: v })}
                trackColor={{ false: c.borderStrong, true: c.danger.soft }}
                thumbColor={draft.third_party_involved ? c.danger.base : c.textMuted}
              />
            </View>

            {/* Police report no */}
            <View style={styles.field}>
              <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.policeReportLabel')}</AppText>
              <TextInput
                style={[inputStyle, { textAlign }]}
                value={draft.police_report_no}
                onChangeText={v => update({ police_report_no: v })}
                placeholder={t('accident.policeReportPlaceholder')}
                placeholderTextColor={c.textMuted}
                autoCapitalize="characters"
              />
            </View>

            {/* Damage description */}
            <View style={styles.field}>
              <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.damageDescLabel')}</AppText>
              <TextInput
                style={[inputStyle, styles.textArea, { textAlign }]}
                value={draft.damage_description}
                onChangeText={v => update({ damage_description: v })}
                placeholder={t('accident.damageDescPlaceholder')}
                placeholderTextColor={c.textMuted}
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Estimated cost */}
            <View style={styles.field}>
              <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.costLabel')}</AppText>
              <View style={[styles.inputWithPrefix, { backgroundColor: c.surface, borderColor: c.border }, isRTL && { flexDirection: 'row-reverse' }]}>
                <View style={[styles.inputPrefix, { backgroundColor: c.surfaceAlt, borderRightColor: c.border }]}>
                  <AppText variant="caption" color="secondary">SAR</AppText>
                </View>
                <TextInput
                  style={[styles.inputInner, { color: c.text, textAlign }]}
                  value={draft.estimated_damage_cost}
                  onChangeText={v => update({ estimated_damage_cost: v })}
                  placeholder={t('accident.costPlaceholder')}
                  placeholderTextColor={c.textMuted}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {/* Notes */}
            <View style={styles.field}>
              <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.notesLabel')}</AppText>
              <TextInput
                style={[inputStyle, styles.textArea, { textAlign }]}
                value={draft.notes}
                onChangeText={v => update({ notes: v })}
                placeholder={t('accident.notesPlaceholder')}
                placeholderTextColor={c.textMuted}
                multiline
                numberOfLines={3}
              />
            </View>

            <Button
              label={t('accident.nextBtn')}
              icon="arrow-forward"
              variant="danger"
              size="lg"
              full
              onPress={() => setStep('step3')}
              style={{ marginTop: spacing.xs }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    )
  }

  // -- STEP 3: Photos + Submit ----------------------------------------------
  if (step === 'step3') {
    const canSubmit = !submitting && !photosUploading && photoUrls.filter(isUploadedPhoto).length > 0
    return (
      <Screen>
        <NavBar titleKey="accident.step3Title" onBack={() => setStep('step2')} />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

          {/* Summary card */}
          <Card accent={statusColor(theme, SEVERITY_KIND[draft.severity]).base} style={{ gap: spacing.xs }}>
            <View style={styles.summaryRow}>
              <View style={[styles.severityBadge, { backgroundColor: statusColor(theme, SEVERITY_KIND[draft.severity]).base }]}>
                <AppText variant="micro" style={{ color: '#fff' }}>{t(`accident.severities.${draft.severity}`)}</AppText>
              </View>
              <AppText variant="bodyStrong">{t(`accident.types.${draft.accident_type}`)}</AppText>
            </View>
            <AppText variant="caption" color="secondary">{draft.asset_no} - {draft.site}</AppText>
            <AppText variant="caption" color="muted">{draft.incident_date}{draft.incident_time ? '  ' + draft.incident_time : ''}</AppText>
            {draft.location ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="location-outline" size={12} color={c.textMuted} />
                <AppText variant="caption" color="muted">{draft.location}</AppText>
              </View>
            ) : null}
          </Card>

          {/* Photos */}
          <View style={styles.field}>
            <AppText variant="micro" color="secondary" style={[styles.fieldLabel, { textAlign }]}>{t('accident.photosLabel')}</AppText>
            <AppText variant="caption" color="muted" style={{ textAlign }}>{t('accident.photosHint')}</AppText>
            <View style={{ marginTop: spacing.sm }}>
              <AccidentPhotoGrid
                photos={photoUrls}
                localUris={photoLocalUris}
                onPhotosChange={(urls, uris) => { setPhotoUrls(urls); setPhotoLocalUris(uris) }}
                onUploadingChange={setPhotosUploading}
              />
            </View>
            {photosUploading && (
              <View style={styles.uploadingRow}>
                <ActivityIndicator size="small" color={c.danger.base} />
                <AppText variant="caption" color="muted">Uploading photo...</AppText>
              </View>
            )}
          </View>

          <Button
            label={submitting ? t('accident.submitting') : t('accident.submitBtn')}
            icon="cloud-upload-outline"
            variant="danger"
            size="lg"
            full
            loading={submitting}
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={{ marginTop: spacing.xs }}
          />
        </ScrollView>
      </Screen>
    )
  }

  // -- SUCCESS ---------------------------------------------------------------
  return (
    <Screen>
      <View style={styles.successWrap}>
        <View style={[styles.successIcon, { backgroundColor: c.danger.soft }]}>
          <Ionicons name="shield-checkmark" size={72} color={c.danger.base} />
        </View>
        <AppText variant="h1" center>{t('accident.submittedTitle')}</AppText>
        <AppText variant="body" color="secondary" center style={{ marginTop: spacing.xs }}>{t('accident.submittedSubtitle')}</AppText>
        {savedOffline && (
          <View style={[styles.offlineNote, { backgroundColor: c.warning.soft }]}>
            <Ionicons name="cloud-offline-outline" size={16} color={c.warning.base} />
            <AppText variant="caption" style={{ flex: 1, color: c.warning.on }}>Saved on device - it will sync automatically when back online.</AppText>
          </View>
        )}
        <AppText variant="caption" color="muted" center style={{ marginTop: spacing.md }}>
          {getEffectiveAssetNo()} - {draft.site}{'\n'}
          {draft.incident_date}
        </AppText>

        <Button
          label={t('accident.backHome')}
          icon="home-outline"
          variant="danger"
          size="lg"
          onPress={() => router.replace('/(app)')}
          style={{ marginTop: spacing['2xl'], minWidth: 220 }}
        />
        <Button
          label={t('accident.newReport')}
          icon="add-circle-outline"
          variant="secondary"
          onPress={() => {
            setDraft(emptyAccidentDraft())
            setPhotoUrls([])
            setPhotoLocalUris([])
            setStep('step1')
          }}
          style={{ marginTop: spacing.md, minWidth: 220 }}
        />
      </View>
    </Screen>
  )
}

// -- Type icon map ----------------------------------------------------------------
const TYPE_ICONS: Record<AccidentType, IconName> = {
  collision:       'car-sport-outline',
  rollover:        'refresh-circle-outline',
  tyre_failure:    'disc-outline',
  mechanical:      'build-outline',
  near_miss:       'warning-outline',
  property_damage: 'business-outline',
  other:           'ellipsis-horizontal-circle-outline',
}

function createStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    loader:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll:  { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.lg },

    // Nav
    nav: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      backgroundColor: c.surface,
      borderBottomWidth: 1, borderBottomColor: c.border,
      gap: spacing.md,
    },
    navBack: {
      width: 38, height: 38, borderRadius: 12,
      backgroundColor: c.danger.soft,
      alignItems: 'center', justifyContent: 'center',
    },
    stepPills: { flexDirection: 'row', gap: 5 },
    stepPill: {
      width: 26, height: 26, borderRadius: 13,
      alignItems: 'center', justifyContent: 'center',
    },

    // Fields
    field: { gap: 6 },
    fieldLabel: { textTransform: 'uppercase', letterSpacing: 0.5 },
    input: {
      borderWidth: 1.5, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.md,
      fontSize: 15,
    },
    textArea: { minHeight: 88, textAlignVertical: 'top' },
    row: { flexDirection: 'row' },

    // Severity chips
    severityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    severityChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.pill, borderWidth: 1.5,
    },

    // Accident type chips
    typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    typeChip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.md, borderWidth: 1.5,
    },

    // Vehicle / site chips
    chipRow: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.md - 2,
      borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center',
    },

    // Manual entry
    manualToggle: {
      flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm,
    },

    // Upload progress
    uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },

    // Toggle rows
    toggleRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.surface, borderRadius: radius.md,
      padding: spacing.md, borderWidth: 1, borderColor: c.border,
    },

    // Input with prefix
    inputWithPrefix: {
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1.5, borderRadius: radius.md, overflow: 'hidden',
    },
    inputPrefix: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.md,
      borderRightWidth: 1,
    },
    inputInner: {
      flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 15,
    },

    // Summary card (step 3)
    summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    severityBadge: {
      paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.md,
    },

    // Success
    successWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing['2xl'] },
    successIcon: {
      width: 108, height: 108, borderRadius: 54,
      alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl,
    },
    offlineNote: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, maxWidth: 340,
    },
  })
}
