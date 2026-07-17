import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, StatusBar, Platform,
  KeyboardAvoidingView, useWindowDimensions, Modal, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../contexts/LanguageContext'
import { supabase } from '../../../lib/supabase'
import { enqueueInspection } from '../../../lib/offlineQueue'
import { clientId } from '../../../lib/ids'
import * as Network from 'expo-network'
import { captureInspectionLocation, LocationStatus } from '../../../lib/location'
import { uploadAllPositionPhotos } from '../../../lib/photoUpload'
import TyrePositionCard from '../../../components/TyrePositionCard'
import TyreDetailModal from '../../../components/TyreDetailModal'
import VehicleTyreDiagram from '../../../components/VehicleTyreDiagram'
import { useRoleGuard } from '../../../hooks/useRoleGuard'
import { useTheme } from '../../../contexts/ThemeContext'
import { spacing, radius, elevation, Theme } from '../../../lib/theme'
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
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
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
  // Site dropdown (replaces the old chip grid): open state + in-picker search.
  const [sitePickerOpen, setSitePickerOpen] = useState(false)
  const [siteSearch, setSiteSearch] = useState('')
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

  // Manual-entry guard: flag when a hand-typed asset does not match any vehicle
  // in the selected site's fleet, and surface the closest real asset. This
  // catches transposed/mis-keyed codes (e.g. "PM123" typed for "MP123") that
  // would otherwise silently create a generic vehicle with the wrong tyre layout.
  const manualAssetCheck = useMemo(() => {
    const raw = manualAsset.trim().toUpperCase()
    if (!raw || vehicles.length === 0) return { known: true, suggestion: null as string | null }
    const known = vehicles.some(v => v.asset_no?.toUpperCase() === raw)
    if (known) return { known: true, suggestion: null }
    // Closest match: same characters in any order, or a shared prefix/suffix.
    const sorted = [...raw].sort().join('')
    const suggestion = vehicles.find(v => {
      const a = v.asset_no?.toUpperCase() ?? ''
      return [...a].sort().join('') === sorted || a.includes(raw) || raw.includes(a)
    })?.asset_no ?? null
    return { known: false, suggestion }
  }, [manualAsset, vehicles])

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

  // Preselect the vehicle when arriving from the scanner or asset list (asset
  // param). Match is trimmed + case-insensitive so a scanned code always lands
  // on its vehicle; if the asset genuinely isn't in the loaded site fleet, carry
  // it into manual entry so the inspector never has to retype what they scanned.
  useEffect(() => {
    if (!params.asset || selectedVehicle || loadingVehicles) return
    const want = String(params.asset).trim().toLowerCase()
    const match = vehicles.find(v => (v.asset_no ?? '').trim().toLowerCase() === want)
    if (match) {
      setSelectedVehicle(match)
    } else if (vehicles.length && !useManualEntry && !manualAsset) {
      setUseManualEntry(true)
      setManualAsset(String(params.asset).trim())
    }
  }, [vehicles, loadingVehicles, params.asset, selectedVehicle])

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
    // Reads are best-effort: on any failure we fall back to the profile site (or
    // a free-typed site) so the inspector is never blocked from starting.
    try {
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

      // Auto-select: scanner param -> profile site -> first in list
      const autoSite = params.site ?? profile?.site ?? (all.length === 1 ? all[0].name : '')
      if (autoSite && !selectedSite) {
        setSelectedSite(autoSite)
      } else if (!selectedSite && all.length > 0 && !params.site) {
        // If profile has a site always pre-select it
        const profileSiteEntry = all.find(s => s.name === profile?.site)
        if (profileSiteEntry) setSelectedSite(profileSiteEntry.name)
      }
    } catch {
      // Leave sites empty so the UI shows the type-your-site fallback; still
      // preselect the profile site when we have one.
      if (profile?.site && !selectedSite) setSelectedSite(profile.site)
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
      setVehicles(data ?? [])
      setFilteredVehicles(data ?? [])
    } catch {
      // Surface an honest "no vehicles" state (manual entry stays available)
      // rather than an unhandled rejection.
      setVehicles([])
      setFilteredVehicles([])
    } finally {
      setLoadingVehicles(false)
    }
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
      Alert.alert(t('inspection.alertRequired'), t('inspection.alertEnterAsset'))
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

    // Save guard: never persist an empty inspection. Require the mandatory
    // header fields (site + asset + inspector) AND at least one recorded tyre
    // condition. This blocks the "saved without adding data" case before either
    // the online insert OR the offline queue is touched, so the offline path is
    // unaffected - a valid inspection still queues normally when offline.
    const effectiveVehicle = getEffectiveVehicle()
    const inspectorName = profile?.full_name ?? profile?.username ?? ''
    if (!selectedSite || !effectiveVehicle || !effectiveVehicle.asset_no || !inspectorName.trim()) {
      Alert.alert(t('inspection.alertRequired'), t('inspection.alertSelectVehicle'))
      return
    }
    if (recordedCount === 0) {
      Alert.alert(
        t('inspection.alertRequired'),
        t('inspection.alertRecordTyre'),
      )
      return
    }

    setSubmitting(true)
    if (!effectiveVehicle) { setSubmitting(false); return }

    // Use whatever GPS fix was warmed up on the tyre step. We deliberately do NOT
    // block Save on a fresh capture here - waiting on the GPS radio was the main
    // source of the slow "Save" tap. A null fix simply omits the coordinates and
    // the geotag can be back-filled later; the inspection must save instantly.
    const fix = gpsFix

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

    // One stable client id for BOTH the online attempt and any queued retry, so a
    // lost response after a committed insert can never create a duplicate.
    // safeUuid avoids the `crypto` ReferenceError on older Hermes runtimes that
    // would otherwise abort the save before it could even queue offline.
    const cuid = clientId()
    try {
      const hasLocalPhotos = Object.values(conditionsCopy).some(
        pos => pos.photo_uri && !pos.photo_url
      )
      if (hasLocalPhotos) {
        // Uploads each pending photo and sets photo_url; on failure photo_url
        // stays null - a file:// URI is never written into photo_url.
        await uploadAllPositionPhotos(conditionsCopy, cuid)
      }
      const { error } = await supabase.from('inspections')
        .upsert({ ...resolvedPayload, client_uuid: cuid }, { onConflict: 'client_uuid', ignoreDuplicates: true })
      if (error) throw error
      setStep('submit')
    } catch (err: any) {
      // Decide WHY the online save failed so we never mislabel a server rejection
      // as "offline". A dropped connection → queue silently (expected offline
      // behaviour). A reachable-server error (RLS/validation/constraint) → the
      // device is online, so surface it: still queue so no data is lost, but warn
      // the user instead of leaving a phantom "1 file offline" that can never sync.
      let online = false
      try {
        const net = await Network.getNetworkStateAsync()
        online = !!net.isConnected && net.isInternetReachable !== false
      } catch { online = false }

      // Queue the photo-resolved copy under the SAME client id: already-uploaded
      // photos keep their photo_url (no duplicate upload on sync); still-local
      // URIs retain photo_uri so the offline sync retries the upload.
      await enqueueInspection(resolvedPayload, cuid)

      if (online) {
        const reason = err?.message || err?.error_description || 'Unknown error.'
        Alert.alert(
          t('inspection.saveIssueTitle'),
          `${t('inspection.saveIssueBody')}\n\n${reason}`,
        )
      }
      setStep('submit')
    } finally {
      setSubmitting(false)
    }
  }

  // RBAC gate - render nothing while the guard redirects unauthorised roles.
  if (!allowed) {
    return (
      <SafeAreaView style={[styles.safe, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.color.primary} />
      </SafeAreaView>
    )
  }

  const statusBarStyle = theme.mode === 'dark' ? 'light-content' : 'dark-content'

  // ── Step: HEADER ───────────────────────────────────────────────────────────
  if (step === 'header') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={theme.color.bg} />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.nav, isRTL && styles.navRTL]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
              <Ionicons name={backIcon} size={22} color={theme.color.text} />
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

            {/* ── Site picker (dropdown) ───────────────────────────────────── */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.siteLabel')}</Text>

              {sites.length === 0 ? (
                /* No sites in DB yet - let user type one */
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={selectedSite}
                  onChangeText={v => { setSelectedSite(v); setSelectedVehicle(null) }}
                  placeholder={t('inspection.typeSiteName')}
                  placeholderTextColor={theme.color.textMuted}
                  autoCapitalize="words"
                />
              ) : (
                <TouchableOpacity
                  style={[styles.dropdown, isRTL && styles.dropdownRTL]}
                  onPress={() => { setSiteSearch(''); setSitePickerOpen(true) }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="location-outline" size={18} color={theme.color.primary} />
                  <Text
                    style={[
                      styles.dropdownText,
                      !selectedSite && styles.dropdownPlaceholder,
                      { textAlign, flex: 1 },
                    ]}
                    numberOfLines={1}
                  >
                    {selectedSite || t('inspection.siteSelectPlaceholder')}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={theme.color.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* ── Vehicle picker ───────────────────────────────────────────── */}
            {selectedSite ? (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.vehicleLabel')}</Text>

                {!useManualEntry && (
                  <>
                    <View style={[styles.searchBox, isRTL && styles.searchBoxRTL]}>
                      <Ionicons name="search-outline" size={18} color={theme.color.textMuted} />
                      <TextInput
                        style={[styles.searchInput, { textAlign }]}
                        value={vehicleQuery}
                        onChangeText={setVehicleQuery}
                        placeholder={t('inspection.vehicleSearchPlaceholder')}
                        placeholderTextColor={theme.color.textMuted}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        returnKeyType="search"
                      />
                      {vehicleQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setVehicleQuery('')}>
                          <Ionicons name="close-circle" size={18} color={theme.color.borderStrong} />
                        </TouchableOpacity>
                      )}
                    </View>

                    {loadingVehicles ? (
                      <ActivityIndicator size="small" color={theme.color.primary} style={{ marginTop: 10 }} />
                    ) : shownVehicles.length === 0 ? (
                      <View style={styles.vehicleEmpty}>
                        <Ionicons name="car-outline" size={28} color={theme.color.borderStrong} />
                        <Text style={styles.vehicleEmptyText}>
                          {vehicleQuery ? t('inspection.vehicleNoMatch') : t('inspection.noVehiclesSite')}
                        </Text>
                        {!vehicleQuery && (
                          <TouchableOpacity
                            style={styles.manualEntryBtn}
                            onPress={() => setUseManualEntry(true)}
                          >
                            <Ionicons name="pencil-outline" size={14} color={theme.color.primary} />
                            <Text style={styles.manualEntryText}>{t('inspection.enterAssetManually')}</Text>
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
                                color={selectedVehicle?.id === v.id ? theme.color.onPrimary : theme.color.primary}
                              />
                              <Text style={[styles.vehicleCardAsset, selectedVehicle?.id === v.id && { color: theme.color.onPrimary }]}>
                                {v.asset_no}
                              </Text>
                              <Text style={[styles.vehicleCardType, selectedVehicle?.id === v.id && { color: theme.color.onPrimary, opacity: 0.75 }]}>
                                {v.vehicle_type}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TouchableOpacity
                          style={styles.manualEntryBtn}
                          onPress={() => setUseManualEntry(true)}
                        >
                          <Ionicons name="pencil-outline" size={14} color={theme.color.textMuted} />
                          <Text style={[styles.manualEntryText, { color: theme.color.textMuted }]}>{t('inspection.notListedManual')}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </>
                )}

                {/* Manual asset entry */}
                {useManualEntry && (
                  <View style={{ gap: 10 }}>
                    <View style={styles.manualHeader}>
                      <Text style={styles.manualHeaderText}>{t('inspection.manualEntry')}</Text>
                      <TouchableOpacity onPress={() => setUseManualEntry(false)}>
                        <Text style={{ fontSize: 12, color: theme.color.info.base, fontWeight: '600' }}>{t('inspection.backToList')}</Text>
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={[styles.input, { textAlign }]}
                      value={manualAsset}
                      onChangeText={setManualAsset}
                      placeholder={t('inspection.manualAssetPlaceholder')}
                      placeholderTextColor={theme.color.textMuted}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />

                    {/* Warn when the typed asset isn't in this site's fleet — with a
                        one-tap correction to the closest real asset if we found one. */}
                    {!manualAssetCheck.known && (
                      <View style={[styles.assetWarn, isRTL && styles.navRTL]}>
                        <Ionicons name="alert-circle-outline" size={16} color={theme.color.warning.on} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.assetWarnText, { textAlign }]}>
                            {`"${manualAsset.trim().toUpperCase()}" ${t('inspection.notInFleetMid')} ${selectedSite} ${t('inspection.notInFleetEnd')}`}
                          </Text>
                          {manualAssetCheck.suggestion && (
                            <TouchableOpacity
                              onPress={() => {
                                const match = vehicles.find(v => v.asset_no === manualAssetCheck.suggestion)
                                if (match) { setSelectedVehicle(match); setUseManualEntry(false); setManualAsset('') }
                              }}
                              activeOpacity={0.7}
                            >
                              <Text style={[styles.assetWarnSuggest, { textAlign }]}>
                                {`${t('inspection.didYouMeanA')} ${manualAssetCheck.suggestion}${t('inspection.didYouMeanB')}`}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    )}

                    <Text style={styles.fieldLabel}>{t('inspection.vehicleType')}</Text>
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
                <Ionicons name="bus-outline" size={18} color={theme.color.primary} />
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
                <Ionicons name="person-circle-outline" size={18} color={theme.color.primary} />
                <Text style={[styles.readonlyText, { textAlign }]}>
                  {profile?.full_name ?? profile?.username ?? t('inspection.unknown')}
                  {profile?.employee_id ? `  ·  ID: ${profile.employee_id}` : ''}
                </Text>
              </View>
            </View>

            {/* Date (read-only) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.dateLabel')}</Text>
              <View style={[styles.readonlyField, isRTL && styles.readonlyFieldRTL]}>
                <Ionicons name="calendar-outline" size={18} color={theme.color.primary} />
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
                placeholderTextColor={theme.color.textMuted}
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
                placeholderTextColor={theme.color.textMuted}
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
              <Ionicons name={forwardIcon} size={18} color={theme.color.onPrimary} />
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>

        {/* ── Site dropdown picker ─────────────────────────────────────────── */}
        <Modal
          visible={sitePickerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setSitePickerOpen(false)}
          statusBarTranslucent
        >
          <Pressable style={styles.pickerBackdrop} onPress={() => setSitePickerOpen(false)} />
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <View style={[styles.pickerHeader, isRTL && styles.navRTL]}>
              <Text style={styles.pickerTitle}>{t('inspection.sitePickerTitle')}</Text>
              <TouchableOpacity onPress={() => setSitePickerOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.color.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={[styles.searchBox, isRTL && styles.searchBoxRTL, { marginTop: 4 }]}>
              <Ionicons name="search-outline" size={18} color={theme.color.textMuted} />
              <TextInput
                style={[styles.searchInput, { textAlign }]}
                value={siteSearch}
                onChangeText={setSiteSearch}
                placeholder={t('inspection.siteSearchPlaceholder')}
                placeholderTextColor={theme.color.textMuted}
                autoCorrect={false}
              />
              {siteSearch.length > 0 && (
                <TouchableOpacity onPress={() => setSiteSearch('')}>
                  <Ionicons name="close-circle" size={18} color={theme.color.borderStrong} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              style={styles.pickerList}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {(() => {
                const q = siteSearch.trim().toLowerCase()
                const filtered = q
                  ? sites.filter(s => s.name.toLowerCase().includes(q) || (s.country || '').toLowerCase().includes(q))
                  : sites
                if (filtered.length === 0) {
                  return <Text style={styles.pickerEmpty}>{t('inspection.siteNoMatch')}</Text>
                }
                const byCountry: Record<string, string[]> = {}
                filtered.forEach(s => {
                  const c = s.country || 'Other'
                  if (!byCountry[c]) byCountry[c] = []
                  if (!byCountry[c].includes(s.name)) byCountry[c].push(s.name)
                })
                const multiCountry = Object.keys(byCountry).length > 1
                return Object.entries(byCountry).map(([country, names]) => (
                  <View key={country}>
                    {multiCountry && <Text style={styles.pickerGroupLabel}>{country}</Text>}
                    {names.map(name => {
                      const active = selectedSite === name
                      return (
                        <TouchableOpacity
                          key={name}
                          style={[styles.pickerRow, isRTL && styles.navRTL, active && styles.pickerRowActive]}
                          onPress={() => {
                            setSelectedSite(name)
                            setSelectedVehicle(null)
                            setUseManualEntry(false)
                            setSitePickerOpen(false)
                          }}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name="location-outline"
                            size={18}
                            color={active ? theme.color.primary : theme.color.textMuted}
                          />
                          <Text style={[styles.pickerRowText, { textAlign, flex: 1 }, active && styles.pickerRowTextActive]}>
                            {name}
                          </Text>
                          {active && <Ionicons name="checkmark-circle" size={20} color={theme.color.primary} />}
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                ))
              })()}
            </ScrollView>
          </View>
        </Modal>
      </SafeAreaView>
    )
  }

  // ── Step: TYRES ────────────────────────────────────────────────────────────
  if (step === 'tyres') {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={theme.color.bg} />
        <View style={[styles.nav, isRTL && styles.navRTL]}>
          <TouchableOpacity onPress={() => setStep('header')} style={styles.navBack}>
            <Ionicons name={backIcon} size={22} color={theme.color.text} />
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
                    recordedCount === positions.length && { backgroundColor: theme.color.primary },
                  ]}
                />
              </View>
            </View>
          )}

          <View style={[styles.positionHint, isRTL && styles.positionHintRTL]}>
            <Ionicons name="information-circle-outline" size={15} color={theme.color.textMuted} />
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
                  ? theme.color.success.base
                  : gpsStatus === 'unavailable'
                    ? theme.color.warning.on
                    : theme.color.textMuted
              }
            />
            {gpsStatus === 'capturing' && (
              <ActivityIndicator size="small" color={theme.color.textMuted} />
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

          {/* Save guard: an inspection with no recorded tyre condition cannot be
              saved (prevents empty records). */}
          {recordedCount === 0 && (
            <View style={[styles.validationWarn, isRTL && styles.navRTL]}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.color.warning.on} />
              <Text style={[styles.validationWarnText, { textAlign }]}>
                {t('inspection.validationRecordTyre')}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.nextBtn, (submitting || recordedCount === 0) && styles.nextBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting || recordedCount === 0}
          >
            {submitting
              ? <ActivityIndicator size="small" color={theme.color.onPrimary} />
              : (
                <>
                  <Ionicons name="cloud-upload-outline" size={18} color={theme.color.onPrimary} />
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
        <Ionicons name="checkmark-circle" size={64} color={theme.color.primary} />
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
        <Ionicons name="home-outline" size={18} color={theme.color.onPrimary} />
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
        <Ionicons name="add-circle-outline" size={18} color={theme.color.primary} />
        <Text style={styles.outlineBtnText}>{t('inspection.newInspection')}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing['4xl'] + spacing.sm, gap: spacing.lg },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    gap: spacing.md,
  },
  navRTL: { flexDirection: 'row-reverse' },
  navBack: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: c.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { fontSize: 16, fontWeight: '700', color: c.text, flex: 1 },
  navSubtitle: { fontSize: 11, color: c.textMuted, marginTop: 1 },
  stepPills: { flexDirection: 'row', gap: spacing.xs + 2 },
  stepPill: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: c.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  stepPillActive: { backgroundColor: c.primary },
  stepPillText: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  stepPillTextActive: { fontSize: 12, fontWeight: '700', color: c.onPrimary },
  stepTitle: { fontSize: 20, fontWeight: '800', color: c.text },
  field: { gap: 0 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: c.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.xs },
  chip: {
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: c.surface,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: 'center',
    minWidth: 60,
  },
  chipActive: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: c.text },
  chipTextActive: { color: c.onPrimary },
  chipSub: { fontSize: 10, color: c.textMuted, marginTop: 1 },
  vehicleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: c.primarySoft,
    borderWidth: 1,
    borderColor: c.primary,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  vehicleInfoRTL: { flexDirection: 'row-reverse' },
  vehicleInfoText: { flex: 1, fontSize: 13, fontWeight: '700', color: c.primaryDark },
  vehiclePositionCount: {
    fontSize: 11,
    fontWeight: '700',
    color: c.onPrimary,
    backgroundColor: c.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm - 2,
    overflow: 'hidden',
  },
  readonlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  readonlyFieldRTL: { flexDirection: 'row-reverse' },
  readonlyText: { fontSize: 14, color: c.text, flex: 1 },
  input: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 15,
    color: c.text,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: c.primary,
    borderRadius: radius.lg,
    height: 52,
    ...elevation(theme, 2),
    marginTop: spacing.sm,
  },
  nextBtnDisabled: { opacity: 0.5 },
  nextBtnText: { color: c.onPrimary, fontSize: 16, fontWeight: '700' },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: c.primary,
    borderRadius: radius.lg,
    height: 48,
    minWidth: 200,
  },
  outlineBtnText: { color: c.primary, fontSize: 15, fontWeight: '700' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs + 2,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  searchBoxRTL: { flexDirection: 'row-reverse' },
  searchInput: { flex: 1, fontSize: 15, color: c.text },
  vehicleEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md - 2,
    paddingVertical: spacing.lg,
  },
  vehicleEmptyText: { fontSize: 13, color: c.textMuted, fontWeight: '600' },
  progressWrap: {
    backgroundColor: c.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: c.border,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  progressCount: { fontSize: 13, fontWeight: '800', color: c.text },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: c.surfaceSunken,
    overflow: 'hidden',
  },
  progressFill: {
    height: 10,
    borderRadius: 5,
    backgroundColor: c.warning.base,
  },
  positionHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: c.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  positionHintRTL: { flexDirection: 'row-reverse' },
  positionHintText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 18 },
  gpsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    marginTop: spacing.xs,
  },
  gpsChipRTL: { flexDirection: 'row-reverse' },
  gpsChipOk: {
    backgroundColor: c.success.soft,
    borderColor: c.success.base,
  },
  gpsChipWarn: {
    backgroundColor: c.warning.soft,
    borderColor: c.warning.base,
  },
  gpsChipText: { flex: 1, fontSize: 12, fontWeight: '700', color: c.textSecondary },
  gpsChipTextOk: { color: c.success.on },
  gpsChipTextWarn: { color: c.warning.on },
  gpsRetry: { fontSize: 12, fontWeight: '700', color: c.info.base },
  successIcon: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: 40,
    backgroundColor: c.primarySoft,
  },
  successTitle: { fontSize: 24, fontWeight: '800', color: c.text, marginBottom: spacing.sm },
  successSubtitle: {
    fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: spacing.sm,
  },
  successNote: {
    fontSize: 12,
    color: c.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
    marginTop: spacing.xs,
  },

  // ── Site dropdown + picker modal ─────────────────────────────────────────────
  dropdown: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderStrong,
    borderRadius: radius.md, paddingHorizontal: spacing.md, height: 50,
  },
  dropdownRTL: { flexDirection: 'row-reverse' },
  dropdownText: { fontSize: 15, fontWeight: '700', color: c.text },
  dropdownPlaceholder: { color: c.textMuted, fontWeight: '500' },
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: c.overlay },
  pickerSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: c.surface, borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
    paddingHorizontal: spacing.xl, paddingTop: spacing.md - 2,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.xl, maxHeight: '80%',
    borderTopWidth: 1, borderColor: c.border,
  },
  pickerHandle: {
    alignSelf: 'center', width: 40, height: 5, borderRadius: 3,
    backgroundColor: c.borderStrong, marginBottom: spacing.md,
  },
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.sm,
  },
  pickerTitle: { fontSize: 17, fontWeight: '800', color: c.text },
  pickerList: { marginTop: spacing.md - 2, flexGrow: 0, flexShrink: 1 },
  pickerEmpty: { fontSize: 13, color: c.textMuted, textAlign: 'center', paddingVertical: spacing['2xl'] },
  pickerGroupLabel: {
    fontSize: 10, fontWeight: '700', color: c.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: spacing.md - 2, marginBottom: spacing.xs,
  },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md - 2,
    paddingVertical: spacing.lg - 2, paddingHorizontal: spacing.md, borderRadius: radius.md,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  pickerRowActive: { backgroundColor: c.primarySoft },
  pickerRowText: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
  pickerRowTextActive: { color: c.primaryDark, fontWeight: '800' },

  // ── Site picker ─────────────────────────────────────────────────────────────
  countryLabel: {
    fontSize: 10, fontWeight: '700', color: c.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.xs + 2,
  },
  siteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  siteChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.lg - 2, paddingVertical: spacing.md - 2,
    backgroundColor: c.surface, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: c.border,
    ...elevation(theme, 1),
  },
  siteChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  siteChipText: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
  siteChipTextActive: { color: c.onPrimary },

  // ── Vehicle grid ─────────────────────────────────────────────────────────────
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  vehicleCard: {
    alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.lg - 2, paddingVertical: spacing.md,
    backgroundColor: c.surface, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: c.border, minWidth: 80,
    ...elevation(theme, 1),
  },
  vehicleCardActive: { backgroundColor: c.primary, borderColor: c.primary },
  vehicleCardAsset: { fontSize: 13, fontWeight: '800', color: c.text },
  vehicleCardType:  { fontSize: 10, color: c.textMuted, fontWeight: '600' },

  // ── Manual entry ─────────────────────────────────────────────────────────────
  manualEntryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2,
    marginTop: spacing.md - 2, alignSelf: 'center',
  },
  manualEntryText: { fontSize: 13, color: c.primary, fontWeight: '700' },
  manualHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 2,
  },
  manualHeaderText: { fontSize: 13, fontWeight: '700', color: c.text },
  assetWarn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: c.warning.soft,
    borderWidth: 1, borderColor: c.warning.base,
    borderRadius: radius.md, padding: spacing.md - 2,
  },
  assetWarnText: { fontSize: 12, color: c.warning.on, fontWeight: '700', lineHeight: 17 },
  assetWarnSuggest: { fontSize: 12, color: c.primaryDark, fontWeight: '800', marginTop: spacing.xs },
  validationWarn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: c.warning.soft,
    borderWidth: 1, borderColor: c.warning.base,
    borderRadius: radius.md, padding: spacing.md - 2, marginTop: spacing.xs,
  },
  validationWarnText: { flex: 1, fontSize: 12, color: c.warning.on, fontWeight: '700', lineHeight: 17 },
  })
}
