/**
 * Accident Report — 3-step form
 *
 * Step 1: Incident Details  (site, vehicle, date/time, location, type, severity, description)
 * Step 2: Damage & People   (injuries, third party, police report, damage desc, cost)
 * Step 3: Photos + Submit   (multi-photo capture, min 1, submit to Supabase)
 */

import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, StatusBar, Platform,
  KeyboardAvoidingView, Switch, useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { supabase } from '../../../lib/supabase'
import AccidentPhotoGrid from '../../../components/AccidentPhotoGrid'
import {
  VehicleFleet, AccidentDraft, AccidentType, AccidentSeverity,
  emptyAccidentDraft, ACCIDENT_TYPE_LABELS, SEVERITY_COLORS, SEVERITY_ICONS,
} from '../../../lib/types'

type Step = 'step1' | 'step2' | 'step3' | 'success'

const TYPES: AccidentType[] = [
  'collision', 'rollover', 'tyre_failure',
  'mechanical', 'near_miss', 'property_damage', 'other',
]
const SEVERITIES: AccidentSeverity[] = ['minor', 'moderate', 'severe', 'fatal']

export default function AccidentReportScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const { width: screenWidth } = useWindowDimensions()

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

  const textAlign   = isRTL ? 'right' : 'left'
  const backIcon    = isRTL ? 'arrow-forward' : 'arrow-back'
  const forwardIcon = isRTL ? 'arrow-back' : 'arrow-forward'

  useEffect(() => { loadSites() }, [])
  useEffect(() => {
    if (draft.site) loadVehicles(draft.site)
  }, [draft.site])

  async function loadSites() {
    // 1. Try sites table (primary source)
    const { data: sitesData } = await supabase
      .from('sites').select('name').eq('active', true).order('name')
    if (sitesData && sitesData.length > 0) {
      const names = sitesData.map((s: any) => s.name as string)
      setSites(names)
      // Auto-select: profile.site match → single site → nothing
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
    // 3. Fallback: profile.site only
    if (profile?.site) {
      setSites([profile.site])
      update({ site: profile.site })
    }
  }

  async function loadVehicles(site: string) {
    setLoadingVehicles(true)
    const { data } = await supabase
      .from('vehicle_fleet')
      .select('id, site, asset_no, vehicle_type, make, model')
      .eq('site', site)
      .order('asset_no')
    if (data) setVehicles(data)
    setLoadingVehicles(false)
  }

  function update(partial: Partial<AccidentDraft>) {
    setDraft(prev => ({ ...prev, ...partial }))
  }

  // ── Validation ────────────────────────────────────────────────────────────

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
    const uploadedPhotos = photoUrls.filter(u => u && u.startsWith('http'))
    if (uploadedPhotos.length === 0) {
      Alert.alert(t('accident.alertRequired'), t('accident.alertPhoto'))
      return false
    }
    return true
  }

  // ── Submit ────────────────────────────────────────────────────────────────

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
        photos:                 photoUrls.filter(u => u && u.startsWith('http')),
        notes:                  draft.notes || null,
        status:                 'reported',
      }

      const { error } = await supabase.from('accidents').insert(payload)
      if (error) throw error
      setStep('success')
    } catch (err: any) {
      Alert.alert('Submission Failed', err.message ?? 'Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step headers ──────────────────────────────────────────────────────────

  function NavBar({
    titleKey, canGoBack, onBack,
  }: { titleKey: string; canGoBack: boolean; onBack: () => void }) {
    const stepNum = step === 'step1' ? 1 : step === 'step2' ? 2 : 3
    return (
      <View style={[styles.nav, isRTL && styles.navRTL]}>
        <TouchableOpacity onPress={onBack} style={styles.navBack}>
          <Ionicons name={backIcon} size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.navTitle, { textAlign }]}>{t(titleKey)}</Text>
          {draft.asset_no ? (
            <Text style={[styles.navSubtitle, { textAlign }]}>
              {draft.asset_no} · {draft.site}
            </Text>
          ) : null}
        </View>
        <View style={styles.stepPills}>
          {[1, 2, 3].map(n => (
            <View key={n} style={[styles.stepPill, n === stepNum && styles.stepPillActive]}>
              <Text style={n === stepNum ? styles.stepPillTextActive : styles.stepPillText}>
                {n}
              </Text>
            </View>
          ))}
        </View>
      </View>
    )
  }

  // ── STEP 1: Incident Details ───────────────────────────────────────────────
  if (step === 'step1') {
    const selectedVehicle = vehicles.find(v => v.asset_no === draft.asset_no) ?? null

    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff5f5" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <NavBar
            titleKey="accident.step1Title"
            canGoBack
            onBack={() => router.back()}
          />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

            {/* Severity header card */}
            <View style={styles.severityRow}>
              {SEVERITIES.map(sev => (
                <TouchableOpacity
                  key={sev}
                  style={[
                    styles.severityChip,
                    draft.severity === sev && {
                      backgroundColor: SEVERITY_COLORS[sev],
                      borderColor: SEVERITY_COLORS[sev],
                    },
                  ]}
                  onPress={() => update({ severity: sev })}
                >
                  <Ionicons
                    name={SEVERITY_ICONS[sev] as any}
                    size={16}
                    color={draft.severity === sev ? '#fff' : SEVERITY_COLORS[sev]}
                  />
                  <Text style={[
                    styles.severityChipText,
                    draft.severity === sev && { color: '#fff' },
                  ]}>
                    {t(`accident.severities.${sev}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Site */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.siteLabel')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  {sites.map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, draft.site === s && styles.chipActive]}
                      onPress={() => { update({ site: s, asset_no: '', vehicle_id: null }); setVehicles([]) }}
                    >
                      <Text style={[styles.chipText, draft.site === s && styles.chipTextActive]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Vehicle */}
            {draft.site ? (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.vehicleLabel')}</Text>
                {loadingVehicles ? (
                  <ActivityIndicator size="small" color="#dc2626" style={{ marginTop: 8 }} />
                ) : useManualEntry ? (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      style={[styles.input, { textAlign }]}
                      value={manualAsset}
                      onChangeText={setManualAsset}
                      placeholder="Enter asset / vehicle number"
                      placeholderTextColor="#94a3b8"
                      autoCapitalize="characters"
                    />
                    <TouchableOpacity
                      onPress={() => { setUseManualEntry(false); setManualAsset('') }}
                      style={styles.manualToggle}
                    >
                      <Ionicons name="list-outline" size={14} color="#dc2626" />
                      <Text style={styles.manualToggleText}>Select from list</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    {vehicles.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View style={styles.chipRow}>
                          {vehicles.map(v => (
                            <TouchableOpacity
                              key={v.id}
                              style={[styles.chip, draft.asset_no === v.asset_no && styles.chipActive]}
                              onPress={() => update({ asset_no: v.asset_no, vehicle_id: v.id })}
                            >
                              <Text style={[styles.chipText, draft.asset_no === v.asset_no && styles.chipTextActive]}>
                                {v.asset_no}
                              </Text>
                              <Text style={[styles.chipSub, draft.asset_no === v.asset_no && { color: 'rgba(255,255,255,0.7)' }]}>
                                {v.vehicle_type}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                    ) : (
                      <Text style={styles.hintText}>No vehicles registered for this site.</Text>
                    )}
                    <TouchableOpacity
                      onPress={() => { setUseManualEntry(true); update({ asset_no: '', vehicle_id: null }) }}
                      style={styles.manualToggle}
                    >
                      <Ionicons name="create-outline" size={14} color="#dc2626" />
                      <Text style={styles.manualToggleText}>Enter asset number manually</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : null}

            {/* Date & Time row */}
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.dateLabel')}</Text>
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={draft.incident_date}
                  onChangeText={v => update({ incident_date: v })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94a3b8"
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.timeLabel')}</Text>
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={draft.incident_time}
                  onChangeText={v => update({ incident_time: v })}
                  placeholder="HH:MM"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>

            {/* Location */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.locationLabel')}</Text>
              <TextInput
                style={[styles.input, { textAlign }]}
                value={draft.location}
                onChangeText={v => update({ location: v })}
                placeholder={t('accident.locationPlaceholder')}
                placeholderTextColor="#94a3b8"
              />
            </View>

            {/* Accident Type */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.typeLabel')}</Text>
              <View style={styles.typeGrid}>
                {TYPES.map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.typeChip, draft.accident_type === type && styles.typeChipActive]}
                    onPress={() => update({ accident_type: type })}
                  >
                    <Ionicons
                      name={TYPE_ICONS[type]}
                      size={16}
                      color={draft.accident_type === type ? '#fff' : '#dc2626'}
                    />
                    <Text style={[
                      styles.typeChipText,
                      draft.accident_type === type && { color: '#fff' },
                    ]}>
                      {t(`accident.types.${type}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Description */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.descLabel')}</Text>
              <TextInput
                style={[styles.input, styles.textArea, { textAlign }]}
                value={draft.description}
                onChangeText={v => update({ description: v })}
                placeholder={t('accident.descPlaceholder')}
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={4}
              />
            </View>

            <TouchableOpacity
              style={[styles.nextBtn, (!draft.site || !getEffectiveAssetNo()) && styles.nextBtnDisabled]}
              onPress={() => validateStep1() && setStep('step2')}
              disabled={!draft.site || !getEffectiveAssetNo()}
            >
              <Text style={styles.nextBtnText}>{t('accident.nextBtn')}</Text>
              <Ionicons name={forwardIcon} size={18} color="#fff" />
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  // ── STEP 2: Damage & People ────────────────────────────────────────────────
  if (step === 'step2') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff5f5" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <NavBar
            titleKey="accident.step2Title"
            canGoBack
            onBack={() => setStep('step1')}
          />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

            {/* Injuries toggle */}
            <View style={[styles.toggleRow, isRTL && styles.toggleRowRTL]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.injuriesLabel')}</Text>
              </View>
              <Switch
                value={draft.injuries}
                onValueChange={v => update({ injuries: v, injury_count: v ? draft.injury_count : '0' })}
                trackColor={{ false: '#e2e8f0', true: '#fca5a5' }}
                thumbColor={draft.injuries ? '#dc2626' : '#94a3b8'}
              />
            </View>

            {draft.injuries && (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.injuryCountLabel')}</Text>
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={draft.injury_count}
                  onChangeText={v => update({ injury_count: v })}
                  placeholder={t('accident.injuryCountPlaceholder')}
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                />
              </View>
            )}

            {/* Third party toggle */}
            <View style={[styles.toggleRow, isRTL && styles.toggleRowRTL]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.thirdPartyLabel')}</Text>
              </View>
              <Switch
                value={draft.third_party_involved}
                onValueChange={v => update({ third_party_involved: v })}
                trackColor={{ false: '#e2e8f0', true: '#fca5a5' }}
                thumbColor={draft.third_party_involved ? '#dc2626' : '#94a3b8'}
              />
            </View>

            {/* Police report no */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.policeReportLabel')}</Text>
              <TextInput
                style={[styles.input, { textAlign }]}
                value={draft.police_report_no}
                onChangeText={v => update({ police_report_no: v })}
                placeholder={t('accident.policeReportPlaceholder')}
                placeholderTextColor="#94a3b8"
                autoCapitalize="characters"
              />
            </View>

            {/* Damage description */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.damageDescLabel')}</Text>
              <TextInput
                style={[styles.input, styles.textArea, { textAlign }]}
                value={draft.damage_description}
                onChangeText={v => update({ damage_description: v })}
                placeholder={t('accident.damageDescPlaceholder')}
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Estimated cost */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.costLabel')}</Text>
              <View style={[styles.inputWithPrefix, isRTL && styles.inputWithPrefixRTL]}>
                <Text style={styles.inputPrefix}>SAR</Text>
                <TextInput
                  style={[styles.inputInner, { textAlign }]}
                  value={draft.estimated_damage_cost}
                  onChangeText={v => update({ estimated_damage_cost: v })}
                  placeholder={t('accident.costPlaceholder')}
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {/* Notes */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.notesLabel')}</Text>
              <TextInput
                style={[styles.input, styles.textArea, { textAlign }]}
                value={draft.notes}
                onChangeText={v => update({ notes: v })}
                placeholder={t('accident.notesPlaceholder')}
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={3}
              />
            </View>

            <TouchableOpacity
              style={styles.nextBtn}
              onPress={() => setStep('step3')}
            >
              <Text style={styles.nextBtnText}>{t('accident.nextBtn')}</Text>
              <Ionicons name={forwardIcon} size={18} color="#fff" />
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  // ── STEP 3: Photos + Submit ────────────────────────────────────────────────
  if (step === 'step3') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff5f5" />
        <NavBar
          titleKey="accident.step3Title"
          canGoBack
          onBack={() => setStep('step2')}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>

          {/* Summary card */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={[styles.severityBadge, { backgroundColor: SEVERITY_COLORS[draft.severity] }]}>
                <Text style={styles.severityBadgeText}>{t(`accident.severities.${draft.severity}`)}</Text>
              </View>
              <Text style={styles.summaryType}>{t(`accident.types.${draft.accident_type}`)}</Text>
            </View>
            <Text style={styles.summaryVehicle}>{draft.asset_no} · {draft.site}</Text>
            <Text style={styles.summaryDate}>{draft.incident_date}{draft.incident_time ? '  ' + draft.incident_time : ''}</Text>
            {draft.location ? <Text style={styles.summaryLocation}>📍 {draft.location}</Text> : null}
          </View>

          {/* Photos */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { textAlign }]}>{t('accident.photosLabel')}</Text>
            <Text style={[styles.hintText, { textAlign }]}>{t('accident.photosHint')}</Text>
            <View style={{ marginTop: 10 }}>
              <AccidentPhotoGrid
                photos={photoUrls}
                localUris={photoLocalUris}
                onPhotosChange={(urls, uris) => { setPhotoUrls(urls); setPhotoLocalUris(uris) }}
                onUploadingChange={setPhotosUploading}
              />
            </View>
            {photosUploading && (
              <View style={styles.uploadingRow}>
                <ActivityIndicator size="small" color="#dc2626" />
                <Text style={styles.uploadingText}>Uploading photo…</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[
              styles.submitBtn,
              (submitting || photosUploading || photoUrls.filter(u => u?.startsWith('http')).length === 0) && styles.nextBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={submitting || photosUploading || photoUrls.filter(u => u?.startsWith('http')).length === 0}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
            }
            <Text style={styles.nextBtnText}>
              {submitting ? t('accident.submitting') : t('accident.submitBtn')}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── SUCCESS ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.safe, styles.successSafe]}>
      <View style={styles.successIcon}>
        <Ionicons name="shield-checkmark" size={72} color="#dc2626" />
      </View>
      <Text style={styles.successTitle}>{t('accident.submittedTitle')}</Text>
      <Text style={styles.successSubtitle}>{t('accident.submittedSubtitle')}</Text>
      <Text style={styles.successMeta}>
        {getEffectiveAssetNo()} · {draft.site}{'\n'}
        {draft.incident_date}
      </Text>

      <TouchableOpacity
        style={[styles.nextBtn, { marginTop: 28, minWidth: 220 }]}
        onPress={() => router.replace('/(app)')}
      >
        <Ionicons name="home-outline" size={18} color="#fff" />
        <Text style={styles.nextBtnText}>{t('accident.backHome')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.outlineBtn, { marginTop: 12 }]}
        onPress={() => {
          setDraft(emptyAccidentDraft())
          setPhotoUrls([])
          setPhotoLocalUris([])
          setStep('step1')
        }}
      >
        <Ionicons name="add-circle-outline" size={18} color="#dc2626" />
        <Text style={styles.outlineBtnText}>{t('accident.newReport')}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}

// ── Type icon map ──────────────────────────────────────────────────────────────
const TYPE_ICONS: Record<AccidentType, any> = {
  collision:       'car-sport-outline',
  rollover:        'refresh-circle-outline',
  tyre_failure:    'disc-outline',
  mechanical:      'build-outline',
  near_miss:       'warning-outline',
  property_damage: 'business-outline',
  other:           'ellipsis-horizontal-circle-outline',
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#fff5f5' },
  successSafe: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  scroll:  { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 16 },

  // Nav
  nav: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.07)',
    gap: 12,
  },
  navRTL: { flexDirection: 'row-reverse' },
  navBack: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#fef2f2',
    alignItems: 'center', justifyContent: 'center',
  },
  navTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  navSubtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },
  stepPills: { flexDirection: 'row', gap: 5 },
  stepPill: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#fee2e2',
    alignItems: 'center', justifyContent: 'center',
  },
  stepPillActive: { backgroundColor: '#dc2626' },
  stepPillText: { fontSize: 11, fontWeight: '700', color: '#f87171' },
  stepPillTextActive: { fontSize: 11, fontWeight: '700', color: '#fff' },

  // Fields
  field: { gap: 6 },
  fieldLabel: {
    fontSize: 12, fontWeight: '700', color: '#64748b',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  hintText: { fontSize: 12, color: '#94a3b8' },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#0f172a',
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row' },

  // Severity chips
  severityRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    padding: 12, backgroundColor: '#fff',
    borderRadius: 12, borderWidth: 1, borderColor: '#fee2e2',
  },
  severityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  severityChipText: { fontSize: 12, fontWeight: '700', color: '#374151' },

  // Accident type chips
  typeGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(220,38,38,0.25)',
    backgroundColor: 'rgba(220,38,38,0.04)',
  },
  typeChipActive: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  typeChipText: { fontSize: 12, fontWeight: '600', color: '#dc2626' },

  // Vehicle chips
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0',
    backgroundColor: '#fff', alignItems: 'center',
  },
  chipActive: { borderColor: '#dc2626', backgroundColor: '#dc2626' },
  chipText: { fontSize: 13, fontWeight: '700', color: '#374151' },
  chipTextActive: { color: '#fff' },
  chipSub: { fontSize: 10, color: '#94a3b8', marginTop: 2 },

  // Manual entry
  manualToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8,
  },
  manualToggleText: { fontSize: 12, color: '#dc2626', fontWeight: '600' },

  // Upload progress
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  uploadingText: { fontSize: 12, color: '#94a3b8' },

  // Toggle rows
  toggleRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: '#e2e8f0',
  },
  toggleRowRTL: { flexDirection: 'row-reverse' },

  // Input with prefix
  inputWithPrefix: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0',
    borderRadius: 10, overflow: 'hidden',
  },
  inputWithPrefixRTL: { flexDirection: 'row-reverse' },
  inputPrefix: {
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#f8fafc', fontSize: 13,
    fontWeight: '700', color: '#64748b',
    borderRightWidth: 1, borderRightColor: '#e2e8f0',
  },
  inputInner: {
    flex: 1, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#0f172a',
  },

  // Summary card (step 3)
  summaryCard: {
    backgroundColor: '#fff', borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: '#fecaca',
    gap: 6,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  severityBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  severityBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  summaryType: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  summaryVehicle: { fontSize: 13, color: '#64748b' },
  summaryDate: { fontSize: 12, color: '#94a3b8' },
  summaryLocation: { fontSize: 12, color: '#64748b' },

  // Buttons
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#dc2626',
    paddingVertical: 15, borderRadius: 14,
    shadowColor: '#dc2626', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  nextBtnDisabled: { backgroundColor: '#e2e8f0', shadowOpacity: 0 },
  nextBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#dc2626',
    paddingVertical: 15, borderRadius: 14,
    shadowColor: '#dc2626', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1.5, borderColor: '#fca5a5',
    paddingVertical: 13, borderRadius: 14, backgroundColor: '#fff',
  },
  outlineBtnText: { fontSize: 14, fontWeight: '700', color: '#dc2626' },

  // Success
  successIcon: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#fef2f2',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  successTitle: { fontSize: 22, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  successSubtitle: { fontSize: 14, color: '#64748b', textAlign: 'center', marginTop: 6 },
  successMeta: {
    fontSize: 13, color: '#94a3b8', textAlign: 'center',
    marginTop: 12, lineHeight: 20,
  },
})
