import { useState, useEffect, useCallback, useRef } from 'react'
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
import TyrePositionCard from '../../../components/TyrePositionCard'
import VehicleTyreDiagram from '../../../components/VehicleTyreDiagram'
import {
  VehicleFleet, TyrePositionData,
  getPositionsForVehicle, emptyTyrePosition,
} from '../../../lib/types'

type Step = 'header' | 'tyres' | 'submit'

export default function NewInspectionScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const router = useRouter()
  const params = useLocalSearchParams<{ site?: string; asset?: string }>()

  const [step, setStep] = useState<Step>('header')
  const [sites, setSites] = useState<string[]>([])
  const [vehicles, setVehicles] = useState<VehicleFleet[]>([])
  const [filteredVehicles, setFilteredVehicles] = useState<VehicleFleet[]>([])
  const [selectedSite, setSelectedSite] = useState(params.site ?? profile?.site ?? '')
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleFleet | null>(null)
  const [odometer, setOdometer] = useState('')
  const [headerNotes, setHeaderNotes] = useState('')
  const [loadingVehicles, setLoadingVehicles] = useState(false)
  const [positions, setPositions] = useState<string[]>([])
  const [tyreData, setTyreData] = useState<Record<string, TyrePositionData>>({})
  const [submitting, setSubmitting] = useState(false)

  const { width: screenWidth } = useWindowDimensions()
  const [highlightedPosition, setHighlightedPosition] = useState<string | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const backIcon = isRTL ? 'arrow-forward' : 'arrow-back'
  const forwardIcon = isRTL ? 'arrow-back' : 'arrow-forward'

  function handleDiagramPositionPress(position: string) {
    // Clear any pending timer so re-tapping the same tyre re-highlights
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    setHighlightedPosition(position)
    // Auto-clear highlight after 4 s so the card can be re-collapsed normally
    highlightTimerRef.current = setTimeout(() => setHighlightedPosition(null), 4000)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    }
  }, [])

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
    if (selectedVehicle) {
      const pos = getPositionsForVehicle(selectedVehicle.vehicle_type)
      setPositions(pos)
      const initialData: Record<string, TyrePositionData> = {}
      pos.forEach(p => { initialData[p] = emptyTyrePosition(p) })
      setTyreData(initialData)
    }
  }, [selectedVehicle])

  async function loadSites() {
    const { data } = await supabase
      .from('vehicle_fleet')
      .select('site')
      .order('site')
    if (data) {
      const unique = [...new Set(data.map(r => r.site).filter(Boolean))] as string[]
      setSites(unique)
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
    if (!selectedVehicle) {
      Alert.alert(t('inspection.alertRequired'), t('inspection.alertSelectVehicle'))
      return false
    }
    return true
  }

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)

    const inspectionDate = new Date().toISOString().split('T')[0]
    const odo = odometer.trim()
    const notes = [odo ? `Odometer: ${odo} km` : '', headerNotes.trim()]
      .filter(Boolean)
      .join('\n')
    const payload = {
      title: `Daily Tyre Inspection — ${selectedSite} — ${inspectionDate}`,
      site: selectedSite,
      asset_no: selectedVehicle!.asset_no,
      vehicle_type: selectedVehicle!.vehicle_type,
      inspector: profile?.full_name ?? profile?.username ?? 'Inspector',
      created_by: profile?.id ?? null,
      inspection_date: inspectionDate,
      scheduled_date: inspectionDate,
      inspection_type: 'Routine',
      tyre_conditions: tyreData,
      notes,
      status: 'Done',
    }

    try {
      const { error } = await supabase.from('inspections').insert(payload)
      if (error) throw error
      setStep('submit')
    } catch {
      await enqueueInspection(payload)
      setStep('submit')
    } finally {
      setSubmitting(false)
    }
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

            {/* Site */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.siteLabel')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                <View style={styles.chipRow}>
                  {sites.map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, selectedSite === s && styles.chipActive]}
                      onPress={() => { setSelectedSite(s); setSelectedVehicle(null) }}
                    >
                      <Text style={[styles.chipText, selectedSite === s && styles.chipTextActive]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Vehicle */}
            {selectedSite ? (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { textAlign }]}>{t('inspection.vehicleLabel')}</Text>
                {loadingVehicles ? (
                  <ActivityIndicator size="small" color="#16a34a" style={{ marginTop: 8 }} />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                    <View style={styles.chipRow}>
                      {filteredVehicles.map(v => (
                        <TouchableOpacity
                          key={v.id}
                          style={[styles.chip, selectedVehicle?.id === v.id && styles.chipActive]}
                          onPress={() => setSelectedVehicle(v)}
                        >
                          <Text style={[styles.chipText, selectedVehicle?.id === v.id && styles.chipTextActive]}>
                            {v.asset_no}
                          </Text>
                          <Text style={[styles.chipSub, selectedVehicle?.id === v.id && { color: 'rgba(255,255,255,0.7)' }]}>
                            {v.vehicle_type}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </View>
            ) : null}

            {/* Selected vehicle info */}
            {selectedVehicle && (
              <View style={[styles.vehicleInfo, isRTL && styles.vehicleInfoRTL]}>
                <Ionicons name="bus-outline" size={18} color="#16a34a" />
                <Text style={[styles.vehicleInfoText, { textAlign }]}>
                  {selectedVehicle.asset_no} · {selectedVehicle.vehicle_type}
                  {selectedVehicle.make ? ` · ${selectedVehicle.make}` : ''}
                </Text>
                <Text style={styles.vehiclePositionCount}>
                  {getPositionsForVehicle(selectedVehicle.vehicle_type).length} {t('inspection.tyres')}
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
              style={[styles.nextBtn, (!selectedSite || !selectedVehicle) && styles.nextBtnDisabled]}
              onPress={() => validateHeader() && setStep('tyres')}
              disabled={!selectedSite || !selectedVehicle}
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
              selectedPosition={highlightedPosition}
              onPositionPress={handleDiagramPositionPress}
              width={screenWidth - 32}
            />
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
              onChange={data => handleTyreUpdate(pos, data)}
              isHighlighted={highlightedPosition === pos}
            />
          ))}

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
})
