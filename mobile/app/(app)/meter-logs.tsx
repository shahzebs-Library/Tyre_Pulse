/**
 * Daily Meter Log — driver-facing odometer + engine-hour capture
 *
 * For fleets without telematics (e.g. Egypt), drivers record the actual meter
 * reading each day and photograph the gauge as proof. The odometer reading
 * advances vehicle_fleet.current_km via a server trigger (V213), so "current
 * km" stays real. The write is offline-safe (record queue), and a live "last
 * reading" panel plus monotonic validation stops fat-finger rollbacks and
 * implausible jumps before they enter the fleet's distance history.
 */
import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, StatusBar, Platform, KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import PhotoCapture from '../../components/PhotoCapture'
import ChecklistReferencePicker from '../../components/ChecklistReferencePicker'
import {
  submitMeterReading, getLastOdometer, todayISODate, LastReading,
} from '../../lib/meterLogs'

// A same-day jump beyond this many km is almost certainly a typo, not a shift.
const IMPLAUSIBLE_DAILY_KM = 2000

export default function MeterLogScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const router = useRouter()
  const params = useLocalSearchParams<{ asset?: string; site?: string }>()

  const { allowed } = useRoleGuard(['inspector', 'tyre_man', 'reporter', 'admin', 'manager', 'director'])

  const [assetNo, setAssetNo] = useState(params.asset ? String(params.asset) : '')
  const [site, setSite] = useState(params.site ? String(params.site) : (profile?.site ?? ''))
  const [odometer, setOdometer] = useState('')
  const [odoPhoto, setOdoPhoto] = useState<string[]>([])
  const [engineHours, setEngineHours] = useState('')
  const [hoursPhoto, setHoursPhoto] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  const [last, setLast] = useState<LastReading | null>(null)
  const [loadingLast, setLoadingLast] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const today = todayISODate()

  // Load the asset's last odometer reading whenever the asset changes (debounced).
  useEffect(() => {
    const a = assetNo.trim()
    if (!a) { setLast(null); return }
    let cancelled = false
    setLoadingLast(true)
    const h = setTimeout(async () => {
      try {
        const r = await getLastOdometer(a)
        if (!cancelled) setLast(r)
      } catch {
        if (!cancelled) setLast(null)
      } finally {
        if (!cancelled) setLoadingLast(false)
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(h) }
  }, [assetNo])

  const kmNum = Number(odometer)
  const hasKm = odometer.trim() !== '' && !Number.isNaN(kmNum)
  const dailyDelta = hasKm && last?.odometer_km != null ? kmNum - last.odometer_km : null
  const rollback = dailyDelta != null && dailyDelta < 0
  const bigJump = dailyDelta != null && dailyDelta > IMPLAUSIBLE_DAILY_KM

  const doSubmit = useCallback(async () => {
    setSubmitting(true)
    try {
      const hrsRaw = engineHours.trim()
      const hrsNum = hrsRaw === '' ? null : Number(hrsRaw)
      const res = await submitMeterReading({
        assetNo: assetNo.trim(),
        site: site.trim() || null,
        country: profile?.country ?? null,
        createdBy: profile?.id ?? null,
        readingDate: today,
        odometerKm: kmNum,
        odometerPhoto: odoPhoto.find(Boolean) ?? null,
        engineHours: hrsNum != null && !Number.isNaN(hrsNum) ? hrsNum : null,
        hoursPhoto: hoursPhoto.find(Boolean) ?? null,
        notes: notes.trim() || null,
      })
      Alert.alert(
        res.offline ? 'Saved on device' : 'Reading logged',
        res.offline
          ? 'Saved on device — it will sync when back online.'
          : `Odometer ${kmNum.toLocaleString()} km recorded for ${assetNo.trim()}.`,
        [{ text: 'Done', onPress: () => router.back() }],
      )
    } catch (e: any) {
      Alert.alert('Could not log reading', e?.message || 'Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [assetNo, site, profile, today, kmNum, odoPhoto, engineHours, hoursPhoto, notes, router])

  function handleSubmit() {
    if (submitting) return
    if (!assetNo.trim()) { Alert.alert('Asset required', 'Select the vehicle / asset you are logging.'); return }
    if (!hasKm) { Alert.alert('Reading required', 'Enter the current odometer reading (km).'); return }
    if (kmNum < 0) { Alert.alert('Invalid reading', 'Odometer reading cannot be negative.'); return }
    if (!odoPhoto.find(Boolean)) {
      Alert.alert('Photo required', 'Take a photo of the odometer gauge to confirm the reading.')
      return
    }
    if (rollback) {
      Alert.alert(
        'Reading is lower than last',
        `The last recorded reading was ${last?.odometer_km?.toLocaleString()} km. A meter should not go backwards. Log it anyway?`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Log anyway', style: 'destructive', onPress: doSubmit }],
      )
      return
    }
    if (bigJump) {
      Alert.alert(
        'Large jump since last reading',
        `That is ${dailyDelta?.toLocaleString()} km since the last reading — please double-check the number. Log it anyway?`,
        [{ text: 'Re-check', style: 'cancel' }, { text: 'Log anyway', onPress: doSubmit }],
      )
      return
    }
    doSubmit()
  }

  if (!allowed) return null

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.nav, isRTL && styles.rowR]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.navTitle, { textAlign }]}>Daily Meter Log</Text>
            <Text style={[styles.navSub, { textAlign }]}>
              {new Date().toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' })}
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Asset + site */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>Asset / Vehicle *</Text>
            <ChecklistReferencePicker
              source="asset"
              value={assetNo}
              onChange={setAssetNo}
              country={profile?.country ?? null}
              placeholder="Select or type the asset…"
            />
            <View style={{ height: 12 }} />
            <Text style={[styles.label, { textAlign }]}>Site</Text>
            <ChecklistReferencePicker
              source="site"
              value={site}
              onChange={setSite}
              country={profile?.country ?? null}
              placeholder="Select the site…"
            />
          </View>

          {/* Last reading panel */}
          {!!assetNo.trim() && (
            <View style={[styles.lastCard, rollback && styles.lastCardWarn]}>
              <Ionicons
                name={loadingLast ? 'time-outline' : last ? 'speedometer-outline' : 'help-circle-outline'}
                size={18}
                color={rollback ? '#dc2626' : '#0369a1'}
              />
              <View style={{ flex: 1 }}>
                {loadingLast ? (
                  <Text style={[styles.lastText, { textAlign }]}>Checking last reading…</Text>
                ) : last?.odometer_km != null ? (
                  <>
                    <Text style={[styles.lastText, { textAlign }]}>
                      Last: {last.odometer_km.toLocaleString()} km
                      {last.reading_date ? ` · ${new Date(last.reading_date + 'T00:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}` : ''}
                    </Text>
                    {dailyDelta != null && (
                      <Text style={[styles.deltaText, rollback && { color: '#dc2626' }, bigJump && { color: '#b45309' }, { textAlign }]}>
                        {rollback
                          ? `${dailyDelta.toLocaleString()} km (lower than last!)`
                          : `+${dailyDelta.toLocaleString()} km since last`}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={[styles.lastText, { textAlign }]}>No previous reading on record.</Text>
                )}
              </View>
            </View>
          )}

          {/* Odometer */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>Odometer (km) *</Text>
            <TextInput
              style={[styles.input, styles.bigInput, { textAlign }]}
              value={odometer}
              onChangeText={t => setOdometer(t.replace(/[^0-9.]/g, ''))}
              placeholder="e.g. 128450"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
            />
            <Text style={[styles.help, { textAlign }]}>Photo of the odometer gauge *</Text>
            <PhotoCapture value={odoPhoto} onChange={setOdoPhoto} module="meter-log" tint="#16a34a" max={1} label="Photograph gauge" />
          </View>

          {/* Engine hours (optional) */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>Engine hours <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.input, { textAlign }]}
              value={engineHours}
              onChangeText={t => setEngineHours(t.replace(/[^0-9.]/g, ''))}
              placeholder="e.g. 4210"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
            />
            {engineHours.trim() !== '' && (
              <>
                <Text style={[styles.help, { textAlign }]}>Photo of the hour-meter gauge</Text>
                <PhotoCapture value={hoursPhoto} onChange={setHoursPhoto} module="meter-log" tint="#0ea5e9" max={1} label="Photograph gauge" />
              </>
            )}
          </View>

          {/* Notes */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>Notes <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.input, styles.textArea, { textAlign }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything worth noting…"
              placeholderTextColor="#94a3b8"
              multiline
              numberOfLines={3}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.88}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="save-outline" size={18} color="#fff" />
                <Text style={styles.submitText}>Log Reading</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  rowR: { flexDirection: 'row-reverse' },
  nav: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.07)',
  },
  navBack: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  navTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  navSub: { fontSize: 11, color: '#64748b', marginTop: 1 },

  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  label: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 8 },
  optional: { fontSize: 11, fontWeight: '600', color: '#94a3b8' },
  help: { fontSize: 11.5, color: '#64748b', marginTop: 12, marginBottom: 8, fontWeight: '600' },

  input: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0f172a',
  },
  bigInput: { fontSize: 20, fontWeight: '800', paddingVertical: 13, letterSpacing: 0.5 },
  textArea: { minHeight: 76, textAlignVertical: 'top' },

  lastCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f0f9ff', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(3,105,161,0.18)',
  },
  lastCardWarn: { backgroundColor: '#fef2f2', borderColor: 'rgba(220,38,38,0.25)' },
  lastText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  deltaText: { fontSize: 11.5, fontWeight: '700', color: '#0369a1', marginTop: 2 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#16a34a', borderRadius: 14, height: 52, marginTop: 4,
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
