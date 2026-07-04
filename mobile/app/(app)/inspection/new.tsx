import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, StatusBar, Platform,
  KeyboardAvoidingView, useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { supabase } from '../../../lib/supabase'
import { enqueueInspection } from '../../../lib/offlineQueue'
import { captureInspectionLocation, LocationStatus } from '../../../lib/location'
import { uploadAllPositionPhotos } from '../../../lib/photoUpload'
import TyrePositionCard from '../../../components/TyrePositionCard'
import TyreDetailModal from '../../../components/TyreDetailModal'
import VehicleTyreDiagram from '../../../components/VehicleTyreDiagram'
import { useRoleGuard } from '../../../hooks/useRoleGuard'
import {
  VehicleFleet, TyrePositionData, UserRole, GpsFix,
  getPositionsForVehicle, emptyTyrePosition,
} from '../../../lib/types'

// Roles permitted to record inspections (mirrors permissions.canInspect)
const INSPECT_ROLES: UserRole[] = ['inspector', 'tyre_man', 'admin', 'manager', 'director']

type Step = 'header' | 'tyres' | 'submit'

export default function NewInspectionScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const params = useLocalSearchParams<{
    site?: string; asset?: string; tyreSerial?: string; tyrePosition?: string
  }>()

  // RBAC: only inspection-capable roles may open this screen (defends against
  // deep-links / programmatic navigation; the tab is already role-hidden).
  const { allowed } = useRoleGuard(INSPECT_ROLES)

  const [step, setStep] = useState<Step>('header')
  const [sites, setSites] = useState<{ name: string; country: string }[]>([])
  const [vehicles, setVehicles] = useState<VehicleFleet[]>([])
  const [filteredVehicles, setFilteredVehicles] = useState<VehicleFleet[]>([])
  const [vehicleQuery, setVehicleQuery] = useState('')
  const [selectedSite, setSelectedSite] = useState(params.site ?? profile?.site ?? '')
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleFleet | null>(null)
  const [manualAsset, setManualAsset] = useState('')
  const [manualVehicleType, setManualVehicleType] = useState('Truck')
  const [useManualEntry, setUseManualEntry] = useState(false)
  const [odometer, setOdometer] = useState('')
  const [headerNotes, setHeaderNotes] = useState('')
  const [loadingVehicles, setLoadingVehicles] = useState(false)
  const [positions, setPositions] = useState<string[]>([])
  const [tyreData, setTyreData] = useState<Record<string, TyrePositionData>>({})
  const [submitting, setSubmitting] = useState(false)

  // GPS location tagging: warmed up when the inspector reaches the tyre step so
  // the review chip shows live status and the fix is ready by submit time.
  const [gpsFix, setGpsFix] = useState<GpsFix | null>(null)
  const [gpsStatus, setGpsStatus] = useState<LocationStatus>('idle')
  // Guards the one-shot capture so re-renders on the tyre step don't re-fire it.
  const gpsRequestedRef = useRef(false)

  const { width: screenWidth } = useWindowDimensions()
  // The position whose detail popup is open (also drives the diagram selection).
  const [activePosition, setActivePosition] = useState<string | null>(null)
  // One-shot guard so a scanned tyre only pre-fills once.
  const prefilledRef = useRef(false)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const backIcon = isRTL ? 'arrow-forward' : 'arrow-back'
  const forwardIcon = isRTL ? 'arrow-back' : 'arrow-forward'

  // Live vehicle search over the loaded site fleet.
  const shownVehicles = useMemo(() => {
    const q = vehicleQuery.trim().toLowerCase()
    if (!q) return filteredVehicles
    return filteredVehicles.filter(v =>
      v.asset_no?.toLowerCase().includes(q) ||
      v.vehicle_type?.toLowerCase().includes(q) ||
      v.make?.toLowerCase().includes(q) ||
      v.model?.toLowerCase().includes(q)
    )
  }, [filteredVehicles, vehicleQuery])

  // Progress: how many positions have at least one recorded value.
  const recordedCount = useMemo(() => {
    return positions.reduce((n, pos) => {
      const d = tyreData[pos]
      const touched = !!d && (
        !!d.serial_number || !!d.pressure_psi || !!d.tread_depth_mm ||
        !!d.notes || !!d.photo_uri || d.condition !== 'Good'
      )
      return n + (touched ? 1 : 0)
    }, 0)
  }, [positions, tyreData])

  // Open the focused detail popup for a position (from diagram or list).
  function openTyre(position: string) {
    setActivePosition(position)
  }
  function closeTyre() {
    setActivePosition(null)
  }

  // Attempt a single GPS fix. Never throws and never blocks: on any failure the
  // status flips to 'unavailable' and submit proceeds without coordinates.
  const captureLocation = useCallback(async () => {
    setGpsStatus('capturing')
    const { status, fix } = await captureInspectionLocation()
    setGpsFix(fix)
    setGpsStatus(status)
  }, [])

  // Warm up the location fix once the inspector reaches the tyre step - keeps the
  // permission prompt inside the submit flow while giving the fix time to resolve.
  useEffect(() => {
    if (step === 'tyres' && !gpsRequestedRef.current) {
      gpsRequestedRef.current = true
      void captureLocation()
    }
  }, [step, captureLocation])

  useEffect(() => { loadSites() }, [])

  useEffect(() => {
    if (selectedSite) loadVehicles(selectedSite)
  }, [selectedSite])

  // Preselect the vehicle when arriving from the scanner (asset param).
  useEffect(() => {
    if (params.asset && !selectedVehicle && filteredVehicles.length) {
      const match = filteredVehicles.find(v => v.asset_no === params.asset)
      if (match) setSelectedVehicle(match)
    }
  }, [filteredVehicles, params.asset, selectedVehicle])

  useEffect(() => {
    const v = selectedVehicle ?? (useManualEntry && manualAsset ? getEffectiveVehicle() : null)
    if (v) {
      const pos = getPositionsForVehicle(v.vehicle_type)
      setPositions(pos)
      const initialData: Record<string, TyrePositionData> = {}
      pos.forEach(p => { initialData[p] = emptyTyrePosition(p) })
      setTyreData(initialData)
    }
  }, [selectedVehicle, useManualEntry, manualVehicleType])

  // Pre-fill from a scanned tyre (serial + position). Runs once positions exist.
  useEffect(() => {
    if (prefilledRef.current) return
    const serial = (params.tyreSerial ?? '').toString().trim()
    if (!serial || positions.length === 0) return

    const wanted = (params.tyrePosition ?? '').toString().trim().toLowerCase()
    const target =
      positions.find(p => p.toLowerCase() === wanted) ??
      positions.find(p => t(`positions.${p}`).toLowerCase() === wanted) ??
      null

    prefilledRef.current = true
    setStep('tyres')
    if (target) {
      setTyreData(prev => ({
        ...prev,
        [target]: { ...(prev[target] ?? emptyTyrePosition(target)), serial_number: serial },
      }))
      setActivePosition(target)
    }
  }, [positions, params.tyreSerial, params.tyrePosition, t])

  async function loadSites() {
    // Primary: dedicated sites table (created by migration)
    const { data: sitesData } = await supabase
      .from('sites')
      .select('name, country')
      .eq('active', true)
      .order('country')
      .order('name')

    // Fallback: distinct sites from vehicle_fleet
    const { data: fleetData } = await supabase
      .from('vehicle_fleet')
      .select('site, country')
      .not('site', 'is', null)
      .order('site')

    const fromSitesTable: { name: string; country: string }[] =
      (sitesData ?? []).map((s: any) => ({ name: s.name, country: s.country ?? '' }))

    const fromFleet: { name: string; country: string }[] = []
    const seen = new Set(fromSitesTable.map(s => s.name))
    ;(fleetData ?? []).forEach((r: any) => {
      if (r.site && !seen.has(r.site)) {
        fromFleet.push({ name: r.site, country: r.country ?? '' })
        seen.add(r.site)
      }
    })

    const all = [...fromSitesTable, ...fromFleet]

    // Always include profile site as a fallback entry if not listed
    if (profile?.site && !seen.has(profile.site)) {
      all.unshift({ name: profile.site, country: '' })
    }

    setSites(all)

    // Auto-select: scanner param → profile site → first in list
    const autoSite = params.site ?? profile?.site ?? (all.length === 1 ? all[0].name : '')
    if (autoSite && !selectedSite) {
      setSelectedSite(autoSite)
    } else if (!selectedSite && all.length > 0 && !params.site) {
      // If profile has a site always pre-select it
      const profileSiteEntry = all.find(s => s.name === profile?.site)
      if (profileSiteEntry) setSelectedSite(profileSiteEntry.name)
    }
  }

  async function loadVehicles(site: string) {
    setLoadingVehicles(true)
    const { data } = await supabase
      .from('vehicle_fleet')
      .select('id, site, asset_no, vehicle_type, make, model')
      .eq('site', site)
      .order('asset_no')
    if (data) {
      setVehicles(data)
      setFilteredVehicles(data)
    }
    setLoadingVehicles(false)
  }

  function handleTyreUpdate(position: string, data: TyrePositionData) {
    setTyreData(prev => ({ ...prev, [position]: data }))
  }

  function validateHeader(): boolean {
    if (!selectedSite) {
      Alert.alert(t('inspection.alertRequired'), t('inspection.alertSelectSite'))
      return false
    }
    if (!useManualEntry && !selectedVehicle) {
      Alert.alert(t('inspection.alertRequired'), t('inspection.alertSelectVehicle'))
      return false
    }
    if (useManualEntry && !manualAsset.trim()) {
      Alert.alert(t('inspection.alertRequired'), 'Please enter an asset / vehicle number.')
      return false
    }
    return true
  }

  // When using manual entry, build a synthetic VehicleFleet-like object
  function getEffectiveVehicle(): VehicleFleet | null {
    if (selectedVehicle) return selectedVehicle
    if (useManualEntry && manualAsset.trim()) {
      return {
        id: 'manual',
        asset_no: manualAsset.trim().toUpperCase(),
        vehicle_type: manualVehicleType,
        make: '',
        model: '',
        site: selectedSite,
        country: '',
        region: '',
        status: 'active',
      } as any
    }
    return null
  }

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)

    const effectiveVehicle = getEffectiveVehicle()
    if (!effectiveVehicle) { setSubmitting(false); return }

    // Resolve the GPS fix on the submit path. Usually already warmed from the
    // tyre-step effect; if that hasn't resolved yet, make one bounded attempt.
    // Never blocks the inspection - a null fix simply omits the coordinates.
    let fix = gpsFix
    if (!fix && (gpsStatus === 'idle' || gpsStatus === 'capturing')) {
      setGpsStatus('capturing')
      const result = await captureInspectionLocation()
      fix = result.fix
      setGpsFix(result.fix)
      setGpsStatus(result.status)
    }

    const inspectionDate = new Date().toISOString().split('T')[0]
    const odo = odometer.trim()
    const notes = [odo ? `Odometer: ${odo} km` : '', headerNotes.trim()]
      .filter(Boolean)
      .join('\n')
    const payload = {
      title: `Daily Tyre Inspection - ${selectedSite} - ${inspectionDate}`,
      site: selectedSite,
      asset_no: effectiveVehicle.asset_no,
      vehicle_type: effectiveVehicle.vehicle_type,
      inspector: profile?.full_name ?? profile?.username ?? 'Inspector',
      created_by: profile?.id ?? null,
      inspection_date: inspectionDate,
      scheduled_date: inspectionDate,
      inspection_type: 'Routine',
      tyre_conditions: tyreData,
      notes,
      status: 'Done',
      country: profile?.country ?? null,
      // GPS geotag - folded identically into the online insert and the offline
      // queue so a queued inspection syncs with the same coordinates later.
      gps_lat: fix?.gps_lat ?? null,
      gps_lng: fix?.gps_lng ?? null,
      gps_accuracy: fix?.gps_accuracy ?? null,
      gps_captured_at: fix?.gps_captured_at ?? null,
    }

    // Resolve any photo_uri still lacking a photo_url before the ONLINE insert -
    // the eager per-position upload may have failed, and a dead local file://
    // URI must never be persisted. Deep-copy the map first (same as
    // offlineQueue.syncQueue) so a failure never corrupts component state.
    const conditionsCopy: Record<string, TyrePositionData> = JSON.parse(
      JSON.stringify(payload.tyre_conditions ?? {})
    )
    const resolvedPayload = { ...payload, tyre_conditions: conditionsCopy }

    try {
      const hasLocalPhotos = Object.values(conditionsCopy).some(
        pos => pos.photo_uri && !pos.photo_url
      )
      if (hasLocalPhotos) {
        // Uploads each pending photo and sets photo_url; on failure photo_url
        // stays null - a file:// URI is never written into photo_url.
        await uploadAllPositionPhotos(conditionsCopy, `online_${crypto.randomUUID()}`)
      }
      const { error } = await supabase.from('inspections').insert(resolvedPayload)
      if (error) throw error
      setStep('submit')
    } catch {
      // Queue the photo-resolved copy: already-uploaded photos keep their
      // photo_url (no duplicate upload on sync); still-local URIs retain
      // photo_uri so the offline sync retries the upload.
      await enqueueInspection(resolvedPayload)
      setStep('submit')
    } finally {
      setSubmitting(false)
    }
  }

  // RBAC gate - render nothing while the guard redirects unauthorised roles.
  if (!allowed) {
    return (
      <SafeAreaView style={[styles.safe, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    )
  }

  // ── Step: HEADER ───────────────────────────────────────────────────────────
  if (step === 'header') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.nav, isRTL && styles.navRTL]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
              <Ionicons name={backIcon} size={22} color="#0f172a" />
            </TouchableOpacity>
            <Text style={styles.navTitle}>{t('inspection.navTitle')}</Text>
            <View style={styles.stepPills}>
              <View style={[styles.stepPill, styles.stepPillActive]}>
                <Text style={styles.stepPillTextActive}>{t('inspection.step1')}</Text>
              </View>
              <View style={styles.stepPill}>
                <Text style={styles.stepPillText}>{t('inspection.step2')}</Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={[styles.stepTitle, { textAlign }]}>{t('inspection.stepTitle')}</Text>

            {/* ── Site picker ──────────────────────────────────────────────── */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.siteLabel')}</Text>

              {sites.length === 0 ? (
                /* No sites in DB yet - let user type one */
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={selectedSite}
                  onChangeText={v => { setSelectedSite(v); setSelectedVehicle(null) }}
                  placeholder="Type your site name..."
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="words"
                />
              ) : (
                /* Group by country */
                (() => {
                  const byCountry: Record<string, string[]> = {}
                  sites.forEach(s => {
                    const c = s.country || 'Other'
                    if (!byCountry[c]) byCountry[c] = []
                    byCountry[c].push(s.name)
                  })
                  return Object.entries(byCountry).map(([country, names]) => (
                    <View key={country} style={{ marginTop: 8 }}>
                      {Object.keys(byCountry).length > 1 && (
                        <Text style={styles.countryLabel}>{country}</Text>
                      )}
                      <View style={styles.siteGrid}>
                        {names.map(name => (
                          <TouchableOpacity
                            key={name}
                            style={[styles.siteChip, selectedSite === name && styles.siteChipActive]}
                            onPress={() => { setSelectedSite(name); setSelectedVehicle(null); setUseManualEntry(false) }}
                            activeOpacity={0.75}
                          >
                            <Ionicons
                              name="location-outline"
                              size={13}
                              color={selectedSite === name ? '#fff' : '#64748b'}
                            />
                            <Text style={[styles.siteChipText, selectedSite === name && styles.siteChipTextActive]}>
                              {name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ))
                })()
              )}
            </View>

            {/* ── Vehicle picker ───────────────────────────────────────────── */}
            {selectedSite ? (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.vehicleLabel')}</Text>

                {!useManualEntry && (
                  <>
                    <View style={[styles.searchBox, isRTL && styles.searchBoxRTL]}>
                      <Ionicons name="search-outline" size={18} color="#94a3b8" />
                      <TextInput
                        style={[styles.searchInput, { textAlign }]}
                        value={vehicleQuery}
                        onChangeText={setVehicleQuery}
                        placeholder={t('inspection.vehicleSearchPlaceholder')}
                        placeholderTextColor="#94a3b8"
                        autoCapitalize="characters"
                        autoCorrect={false}
                        returnKeyType="search"
                      />
                      {vehicleQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setVehicleQuery('')}>
                          <Ionicons name="close-circle" size={18} color="#cbd5e1" />
                        </TouchableOpacity>
                      )}
                    </View>

                    {loadingVehicles ? (
                      <ActivityIndicator size="small" color="#16a34a" style={{ marginTop: 10 }} />
                    ) : shownVehicles.length === 0 ? (
                      <View style={styles.vehicleEmpty}>
                        <Ionicons name="car-outline" size={28} color="#cbd5e1" />
                        <Text style={styles.vehicleEmptyText}>
                          {vehicleQuery ? t('inspection.vehicleNoMatch') : 'No vehicles registered for this site.'}
                        </Text>
                        {!vehicleQuery && (
                          <TouchableOpacity
                            style={styles.manualEntryBtn}
                            onPress={() => setUseManualEntry(true)}
                          >
                            <Ionicons name="pencil-outline" size={14} color="#16a34a" />
                            <Text style={styles.manualEntryText}>Enter asset manually</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ) : (
                      <>
                        <View style={styles.vehicleGrid}>
                          {shownVehicles.map(v => (
                            <TouchableOpacity
                              key={v.id}
                              style={[styles.vehicleCard, selectedVehicle?.id === v.id && styles.vehicleCardActive]}
                              onPress={() => setSelectedVehicle(v)}
                              activeOpacity={0.75}
                            >
                              <Ionicons
                                name="bus-outline"
                                size={20}
                                color={selectedVehicle?.id === v.id ? '#fff' : '#16a34a'}
                              />
                              <Text style={[styles.vehicleCardAsset, selectedVehicle?.id === v.id && { color: '#fff' }]}>
                                {v.asset_no}
                              </Text>
                              <Text style={[styles.vehicleCardType, selectedVehicle?.id === v.id && { color: 'rgba(255,255,255,0.75)' }]}>
                                {v.vehicle_type}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TouchableOpacity
                          style={styles.manualEntryBtn}
                          onPress={() => setUseManualEntry(true)}
                        >
                          <Ionicons name="pencil-outline" size={14} color="#64748b" />
                          <Text style={[styles.manualEntryText, { color: '#64748b' }]}>Not listed? Enter manually</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </>
                )}

                {/* Manual asset entry */}
                {useManualEntry && (
                  <View style={{ gap: 10 }}>
                    <View style={styles.manualHeader}>
                      <Text style={styles.manualHeaderText}>Manual entry</Text>
                      <TouchableOpacity onPress={() => setUseManualEntry(false)}>
                        <Text style={{ fontSize: 12, color: '#3b82f6', fontWeight: '600' }}>← Back to list</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={[styles.input, { textAlign }]}
                      value={manualAsset}
                      onChangeText={setManualAsset}
                      placeholder="Asset / Vehicle number (e.g. TRK-001)"
                      placeholderTextColor="#94a3b8"
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />
                    <Text style={styles.fieldLabel}>Vehicle Type</Text>
                    <View style={styles.chipRow}>
                      {['Truck', 'Bus', 'Trailer', 'Crane', 'Forklift', 'Pickup', 'SUV', 'Other'].map(vt => (
                        <TouchableOpacity
                          key={vt}
                          style={[styles.chip, manualVehicleType === vt && styles.chipActive]}
                          onPress={() => setManualVehicleType(vt)}
                        >
                          <Text style={[styles.chipText, manualVehicleType === vt && styles.chipTextActive]}>{vt}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            ) : null}

            {/* Selected vehicle summary */}
            {(selectedVehicle || (useManualEntry && manualAsset.trim())) && (
              <View style={[styles.vehicleInfo, isRTL && styles.vehicleInfoRTL]}>
                <Ionicons name="bus-outline" size={18} color="#16a34a" />
                <Text style={[styles.vehicleInfoText, { textAlign }]}>
                  {selectedVehicle
                    ? `${selectedVehicle.asset_no} · ${selectedVehicle.vehicle_type}${selectedVehicle.make ? ` · ${selectedVehicle.make}` : ''}`
                    : `${manualAsset.trim().toUpperCase()} · ${manualVehicleType} (manual)`}
                </Text>
                <Text style={styles.vehiclePositionCount}>
                  {getPositionsForVehicle(selectedVehicle?.vehicle_type ?? manualVehicleType).length} {t('inspection.tyres')}
                </Text>
              </View>
            )}

            {/* Inspector (read-only) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.inspectorLabel')}</Text>
              <View style={[styles.readonlyField, isRTL && styles.readonlyFieldRTL]}>
                <Ionicons name="person-circle-outline" size={18} color="#16a34a" />
                <Text style={[styles.readonlyText, { textAlign }]}>
                  {profile?.full_name ?? profile?.username ?? 'Unknown'}
                  {profile?.employee_id ? `  ·  ID: ${profile.employee_id}` : ''}
                </Text>
              </View>
            </View>

            {/* Date (read-only) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.dateLabel')}</Text>
              <View style={[styles.readonlyField, isRTL && styles.readonlyFieldRTL]}>
                <Ionicons name="calendar-outline" size={18} color="#16a34a" />
                <Text style={[styles.readonlyText, { textAlign }]}>
                  {new Date().toLocaleDateString(dateLocale, {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                  })}
                </Text>
              </View>
            </View>

            {/* Odometer */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.odometerLabel')}</Text>
              <TextInput
                style={[styles.input, { textAlign }]}
                value={odometer}
                onChangeText={setOdometer}
                placeholder={t('inspection.odometerPlaceholder')}
                placeholderTextColor="#94a3b8"
                keyboardType="numeric"
              />
            </View>

            {/* Notes */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.notesLabel')}</Text>
              <TextInput
                style={[styles.input, styles.textArea, { textAlign }]}
                value={headerNotes}
                onChangeText={setHeaderNotes}
                placeholder={t('inspection.notesPlaceholder')}
                placeholderTextColor="#94a3b8"
                multiline
                numberOfLines={3}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.nextBtn,
                (!selectedSite || (!selectedVehicle && (!useManualEntry || !manualAsset.trim()))) && styles.nextBtnDisabled,
              ]}
              onPress={() => {
                if (validateHeader()) {
                  const v = getEffectiveVehicle()
                  if (v && v.id !== (selectedVehicle?.id)) {
                    // apply manual vehicle to positions
                    const pos = getPositionsForVehicle(v.vehicle_type)
                    setPositions(pos)
                    const initialData: Record<string, TyrePositionData> = {}
                    pos.forEach(p => { initialData[p] = emptyTyrePosition(p) })
                    setTyreData(initialData)
                  }
                  setStep('tyres')
                }
              }}
              disabled={!selectedSite || (!selectedVehicle && (!useManualEntry || !manualAsset.trim()))}
            >
              <Text style={styles.nextBtnText}>{t('inspection.nextButton')}</Text>
              <Ionicons name={forwardIcon} size={18} color="#fff" />
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  // ── Step: TYRES ────────────────────────────────────────────────────────────
  if (step === 'tyres') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
        <View style={[styles.nav, isRTL && styles.navRTL]}>
          <TouchableOpacity onPress={() => setStep('header')} style={styles.navBack}>
            <Ionicons name={backIcon} size={22} color="#0f172a" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.navTitle, { textAlign }]}>{t('inspection.tyrePositionsTitle')}</Text>
            <Text style={[styles.navSubtitle, { textAlign }]}>
              {selectedVehicle?.asset_no} · {selectedSite}
            </Text>
          </View>
          <View style={styles.stepPills}>
            <View style={styles.stepPill}>
              <Text style={styles.stepPillText}>{t('inspection.step1')}</Text>
            </View>
            <View style={[styles.stepPill, styles.stepPillActive]}>
              <Text style={styles.stepPillTextActive}>{t('inspection.step2')}</Text>
            </View>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {/* ── Interactive vehicle tyre diagram ─────────────────────────── */}
          {selectedVehicle && (
            <VehicleTyreDiagram
              vehicleType={selectedVehicle.vehicle_type}
              positions={positions}
              tyreData={tyreData}
              selectedPosition={activePosition}
              onPositionPress={openTyre}
              width={screenWidth - 32}
            />
          )}

          {/* ── Progress ─────────────────────────────────────────────────── */}
          {positions.length > 0 && (
            <View style={styles.progressWrap}>
              <View style={[styles.progressLabelRow, isRTL && styles.navRTL]}>
                <Text style={styles.progressLabel}>{t('inspection.progressLabel')}</Text>
                <Text style={styles.progressCount}>
                  {recordedCount}/{positions.length}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round((recordedCount / positions.length) * 100)}%` },
                    recordedCount === positions.length && { backgroundColor: '#16a34a' },
                  ]}
                />
              </View>
            </View>
          )}

          <View style={[styles.positionHint, isRTL && styles.positionHintRTL]}>
            <Ionicons name="information-circle-outline" size={15} color="#64748b" />
            <Text style={[styles.positionHintText, { textAlign }]}>
              {t('inspection.tyreHint')}
            </Text>
          </View>

          {positions.map(pos => (
            <TyrePositionCard
              key={pos}
              data={tyreData[pos] ?? emptyTyrePosition(pos)}
              onPress={() => openTyre(pos)}
              isHighlighted={activePosition === pos}
            />
          ))}

          {/* ── GPS geotag status ────────────────────────────────────────── */}
          <View
            style={[
              styles.gpsChip,
              isRTL && styles.gpsChipRTL,
              gpsStatus === 'captured' && styles.gpsChipOk,
              gpsStatus === 'unavailable' && styles.gpsChipWarn,
            ]}
          >
            <Ionicons
              name={
                gpsStatus === 'captured'
                  ? 'location'
                  : gpsStatus === 'unavailable'
                    ? 'location-outline'
                    : 'navigate-outline'
              }
              size={15}
              color={
                gpsStatus === 'captured'
                  ? '#16a34a'
                  : gpsStatus === 'unavailable'
                    ? '#b45309'
                    : '#64748b'
              }
            />
            {gpsStatus === 'capturing' && (
              <ActivityIndicator size="small" color="#64748b" />
            )}
            <Text
              style={[
                styles.gpsChipText,
                { textAlign },
                gpsStatus === 'captured' && styles.gpsChipTextOk,
                gpsStatus === 'unavailable' && styles.gpsChipTextWarn,
              ]}
            >
              {gpsStatus === 'captured'
                ? t('inspection.gpsCaptured')
                : gpsStatus === 'unavailable'
                  ? t('inspection.gpsUnavailable')
                  : t('inspection.gpsCapturing')}
            </Text>
            {gpsStatus === 'unavailable' && (
              <TouchableOpacity onPress={() => captureLocation()} hitSlop={8}>
                <Text style={styles.gpsRetry}>{t('inspection.gpsRetry')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.nextBtn, submitting && styles.nextBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : (
                <>
                  <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
                  <Text style={styles.nextBtnText}>{t('inspection.submitButton')}</Text>
                </>
              )
            }
          </TouchableOpacity>
        </ScrollView>

        {/* Focused per-tyre detail popup */}
        <TyreDetailModal
          visible={activePosition !== null}
          position={activePosition}
          data={activePosition ? (tyreData[activePosition] ?? emptyTyrePosition(activePosition)) : null}
          onChange={d => { if (activePosition) handleTyreUpdate(activePosition, d) }}
          onClose={closeTyre}
        />
      </SafeAreaView>
    )
  }

  // ── Step: SUBMIT / SUCCESS ─────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.safe, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
      <View style={styles.successIcon}>
        <Ionicons name="checkmark-circle" size={64} color="#16a34a" />
      </View>
      <Text style={styles.successTitle}>{t('inspection.submittedTitle')}</Text>
      <Text style={styles.successSubtitle}>
        {selectedVehicle?.asset_no} · {selectedSite}
        {'\n'}
        {new Date().toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' })}
      </Text>
      <Text style={styles.successNote}>{t('inspection.offlineNote')}</Text>
      <TouchableOpacity
        style={[styles.nextBtn, { marginTop: 24, minWidth: 200 }]}
        onPress={() => {
          setStep('header')
          setSelectedVehicle(null)
          setOdometer('')
          setHeaderNotes('')
          setTyreData({})
          setActivePosition(null)
          router.replace('/(app)')
        }}
      >
        <Ionicons name="home-outline" size={18} color="#fff" />
        <Text style={styles.nextBtnText}>{t('inspection.backHome')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.outlineBtn, { marginTop: 10 }]}
        onPress={() => {
          setStep('header')
          setSelectedVehicle(null)
          setOdometer('')
          setHeaderNotes('')
          setTyreData({})
          setActivePosition(null)
        }}
      >
        <Ionicons name="add-circle-outline" size={18} color="#16a34a" />
        <Text style={styles.outlineBtnText}>{t('inspection.newInspection')}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 16 },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.07)',
    gap: 12,
  },
  navRTL: { flexDirection: 'row-reverse' },
  navBack: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', flex: 1 },
  navSubtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },
  stepPills: { flexDirection: 'row', gap: 6 },
  stepPill: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  stepPillActive: { backgroundColor: '#16a34a' },
  stepPillText: { fontSize: 12, fontWeight: '700', color: '#94a3b8' },
  stepPillTextActive: { fontSize: 12, fontWeight: '700', color: '#fff' },
  stepTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  field: { gap: 0 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    minWidth: 60,
  },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  chipTextActive: { color: '#fff' },
  chipSub: { fontSize: 10, color: '#94a3b8', marginTop: 1 },
  vehicleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(22,163,74,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(22,163,74,0.2)',
    borderRadius: 12,
    padding: 12,
  },
  vehicleInfoRTL: { flexDirection: 'row-reverse' },
  vehicleInfoText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#15803d' },
  vehiclePositionCount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16a34a',
    backgroundColor: 'rgba(22,163,74,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  readonlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  readonlyFieldRTL: { flexDirection: 'row-reverse' },
  readonlyText: { fontSize: 14, color: '#0f172a', flex: 1 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0f172a',
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16a34a',
    borderRadius: 14,
    height: 52,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
    marginTop: 8,
  },
  nextBtnDisabled: { opacity: 0.5 },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#16a34a',
    borderRadius: 14,
    height: 48,
    minWidth: 200,
  },
  outlineBtnText: { color: '#16a34a', fontSize: 15, fontWeight: '600' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchBoxRTL: { flexDirection: 'row-reverse' },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a' },
  vehicleEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 16,
  },
  vehicleEmptyText: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },
  progressWrap: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  progressCount: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f59e0b',
  },
  positionHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(100,116,139,0.06)',
    borderRadius: 10,
    padding: 12,
  },
  positionHintRTL: { flexDirection: 'row-reverse' },
  positionHintText: { flex: 1, fontSize: 12, color: '#64748b', lineHeight: 18 },
  gpsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(100,116,139,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.15)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  gpsChipRTL: { flexDirection: 'row-reverse' },
  gpsChipOk: {
    backgroundColor: 'rgba(22,163,74,0.08)',
    borderColor: 'rgba(22,163,74,0.2)',
  },
  gpsChipWarn: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderColor: 'rgba(245,158,11,0.25)',
  },
  gpsChipText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#64748b' },
  gpsChipTextOk: { color: '#15803d' },
  gpsChipTextWarn: { color: '#b45309' },
  gpsRetry: { fontSize: 12, fontWeight: '700', color: '#3b82f6' },
  successIcon: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 40,
    backgroundColor: 'rgba(22,163,74,0.1)',
  },
  successTitle: { fontSize: 24, fontWeight: '800', color: '#0f172a', marginBottom: 8 },
  successSubtitle: {
    fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 22, marginBottom: 8,
  },
  successNote: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
    marginTop: 4,
  },

  // ── Site picker ─────────────────────────────────────────────────────────────
  countryLabel: {
    fontSize: 10, fontWeight: '700', color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
  },
  siteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  siteChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1.5, borderColor: '#e2e8f0',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  siteChipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  siteChipText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  siteChipTextActive: { color: '#fff' },

  // ── Vehicle grid ─────────────────────────────────────────────────────────────
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  vehicleCard: {
    alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e2e8f0', minWidth: 80,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  vehicleCardActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  vehicleCardAsset: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  vehicleCardType:  { fontSize: 10, color: '#94a3b8', fontWeight: '500' },

  // ── Manual entry ─────────────────────────────────────────────────────────────
  manualEntryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, alignSelf: 'center',
  },
  manualEntryText: { fontSize: 13, color: '#16a34a', fontWeight: '600' },
  manualHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 2,
  },
  manualHeaderText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
})
