/**
 * Daily Meter Log — driver-facing odometer + engine-hour capture
 *
 * For fleets without telematics (e.g. Egypt), drivers record the actual meter
 * reading each day and photograph the gauge as proof. The odometer reading
 * advances vehicle_fleet.current_km via a server trigger (V213), so "current
 * km" stays real. The write is offline-safe (record queue), and a live "last
 * reading" panel plus a HARD monotonic guard stops fat-finger rollbacks before
 * they enter the fleet's distance history. The asset can be picked by scan
 * (QR / barcode) and its site is auto-filled from the fleet master.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, Platform, KeyboardAvoidingView, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../lib/theme'
import { Screen, Button } from '../../components/ui'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import PhotoCapture from '../../components/PhotoCapture'
import ChecklistReferencePicker from '../../components/ChecklistReferencePicker'
import { extractScanCode, lookupAssetByCode } from '../../lib/assetLookup'
import {
  submitMeterReading, getLastOdometer, todayISODate, LastReading,
} from '../../lib/meterLogs'

// A same-day jump beyond this many km is almost certainly a typo, not a shift.
const IMPLAUSIBLE_DAILY_KM = 2000
// Swallow the same code re-firing many times per second while held on a label.
const RESCAN_COOLDOWN_MS = 2500

export default function MeterLogScreen() {
  const { profile } = useAuth()
  const { isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
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

  // Site is auto-filled from the fleet master, but never over a value the user
  // typed / picked. Once the user edits site, we stop overwriting it.
  const siteTouched = useRef<boolean>(!!params.site || !!profile?.site)

  // In-app barcode scanner (asset picker).
  const [scanOpen, setScanOpen] = useState(false)
  const [torch, setTorch] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()
  const scanLock = useRef(false)
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  const textAlign = isRTL ? 'right' : 'left'
  const dateLocale = isRTL ? 'ar-SA' : 'en-GB'
  const today = todayISODate()

  // When the asset changes: load its last odometer reading AND auto-fill its
  // site from the fleet master (only when the user has not set a site). Both
  // are debounced together so a typed asset does not fire a query per keystroke.
  useEffect(() => {
    const a = assetNo.trim()
    if (!a) { setLast(null); return }
    let cancelled = false
    setLoadingLast(true)
    const h = setTimeout(async () => {
      try {
        const [r, rec] = await Promise.all([
          getLastOdometer(a),
          lookupAssetByCode(a).catch(() => null),
        ])
        if (cancelled) return
        setLast(r)
        const masterSite = rec?.site?.trim()
        if (masterSite && !siteTouched.current) {
          setSite(prev => (prev.trim() ? prev : masterSite))
        }
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
  // HARD guard: a reading below the last one is rejected outright (equal is ok).
  const belowLast = hasKm && last?.odometer_km != null && kmNum < last.odometer_km
  const bigJump = dailyDelta != null && dailyDelta > IMPLAUSIBLE_DAILY_KM
  const lastKmLabel = last?.odometer_km?.toLocaleString() ?? ''

  const onSiteChange = useCallback((v: string) => {
    siteTouched.current = true
    setSite(v)
  }, [])

  // -- Asset scanning ---------------------------------------------------------
  const openScanner = useCallback(async () => {
    if (!permission?.granted) {
      const res = await requestPermission()
      if (!res.granted) {
        Alert.alert(
          'Camera access needed',
          'Allow camera access to scan an asset barcode, or type the asset code by hand.',
        )
        return
      }
    }
    setCameraError(false)
    scanLock.current = false
    lastScanRef.current = { code: '', at: 0 }
    setScanOpen(true)
  }, [permission, requestPermission])

  const closeScanner = useCallback(() => {
    setScanOpen(false)
    setTorch(false)
    scanLock.current = false
  }, [])

  const onBarcodeScanned = useCallback((res: BarcodeScanningResult) => {
    if (scanLock.current) return
    const now = Date.now()
    const code = extractScanCode(res.data)
    if (code && code === lastScanRef.current.code && now - lastScanRef.current.at < RESCAN_COOLDOWN_MS) return
    lastScanRef.current = { code, at: now }
    scanLock.current = true
    ;(async () => {
      let rec = null
      try { rec = await lookupAssetByCode(res.data) } catch { /* offline / no match */ }
      const resolved = rec?.asset_no || code
      if (resolved) {
        setAssetNo(resolved)
        const masterSite = rec?.site?.trim()
        if (masterSite && !siteTouched.current) {
          setSite(prev => (prev.trim() ? prev : masterSite))
        }
      }
      closeScanner()
      if (!resolved) Alert.alert('Nothing scanned', 'Could not read an asset code. Try again or type it in.')
    })()
  }, [closeScanner])

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
    // Hard reject: never allow a reading below the last recorded one.
    if (belowLast) {
      Alert.alert('Reading too low', `Odometer cannot be less than the last reading of ${lastKmLabel} km.`)
      return
    }
    if (!odoPhoto.find(Boolean)) {
      Alert.alert('Photo required', 'Take a photo of the odometer gauge to confirm the reading.')
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
    <Screen padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.nav, isRTL && styles.rowR]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
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
            <View style={[styles.labelRow, isRTL && styles.rowR]}>
              <Text style={[styles.label, styles.labelFlex, { textAlign }]}>Asset / Vehicle *</Text>
              <TouchableOpacity onPress={openScanner} style={styles.scanBtn} activeOpacity={0.85}>
                <Ionicons name="scan-outline" size={16} color={theme.color.primary} />
                <Text style={styles.scanBtnText}>Scan</Text>
              </TouchableOpacity>
            </View>
            <ChecklistReferencePicker
              source="asset"
              value={assetNo}
              onChange={setAssetNo}
              country={profile?.country ?? null}
              placeholder="Scan, select or type the asset…"
            />
            <View style={{ height: 12 }} />
            <Text style={[styles.label, { textAlign }]}>Site</Text>
            <ChecklistReferencePicker
              source="site"
              value={site}
              onChange={onSiteChange}
              country={profile?.country ?? null}
              placeholder="Select the site…"
            />
            <Text style={[styles.help, { textAlign, marginTop: spacing.sm }]}>
              Site auto-fills from the asset's fleet record. You can change it.
            </Text>
          </View>

          {/* Last reading panel */}
          {!!assetNo.trim() && (
            <View style={[styles.lastCard, belowLast && styles.lastCardWarn]}>
              <Ionicons
                name={loadingLast ? 'time-outline' : last ? 'speedometer-outline' : 'help-circle-outline'}
                size={18}
                color={belowLast ? theme.color.danger.base : theme.color.info.base}
              />
              <View style={{ flex: 1 }}>
                {loadingLast ? (
                  <Text style={[styles.lastText, { textAlign }]}>Checking last reading…</Text>
                ) : last?.odometer_km != null ? (
                  <>
                    <Text style={[styles.lastText, { textAlign }]}>
                      Last: {lastKmLabel} km
                      {last.reading_date ? ` · ${new Date(last.reading_date + 'T00:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}` : ''}
                    </Text>
                    {dailyDelta != null && (
                      <Text style={[styles.deltaText, belowLast && { color: theme.color.danger.base }, bigJump && { color: theme.color.warning.base }, { textAlign }]}>
                        {belowLast
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
              style={[styles.input, styles.bigInput, belowLast && styles.inputError, { textAlign }]}
              value={odometer}
              onChangeText={t => setOdometer(t.replace(/[^0-9.]/g, ''))}
              placeholder="e.g. 128450"
              placeholderTextColor={theme.color.textMuted}
              keyboardType="numeric"
            />
            {belowLast && (
              <Text style={[styles.errorText, { textAlign }]}>
                Odometer cannot be less than the last reading of {lastKmLabel} km.
              </Text>
            )}
            <Text style={[styles.help, { textAlign }]}>Photo of the odometer gauge *</Text>
            <PhotoCapture value={odoPhoto} onChange={setOdoPhoto} module="meter-log" tint={theme.color.primary} max={1} label="Photograph gauge" />
          </View>

          {/* Engine hours / hour meter (optional) */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>Engine hours / Hour meter <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.input, { textAlign }]}
              value={engineHours}
              onChangeText={t => setEngineHours(t.replace(/[^0-9.]/g, ''))}
              placeholder="e.g. 4210"
              placeholderTextColor={theme.color.textMuted}
              keyboardType="numeric"
            />
            <Text style={[styles.help, { textAlign }]}>
              {engineHours.trim() !== ''
                ? 'Photo of the hour-meter gauge'
                : 'For generators / plant, enter the hour-meter reading (and add its photo).'}
            </Text>
            {engineHours.trim() !== '' && (
              <PhotoCapture value={hoursPhoto} onChange={setHoursPhoto} module="meter-log" tint={theme.color.info.base} max={1} label="Photograph gauge" />
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
              placeholderTextColor={theme.color.textMuted}
              multiline
              numberOfLines={3}
            />
          </View>

          <Button
            label="Log Reading"
            icon="save-outline"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting || belowLast}
            size="lg"
            full
            style={{ marginTop: spacing.xs }}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Asset barcode / QR scanner */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={closeScanner}>
        <View style={styles.camRoot}>
          <SafeAreaView edges={['top']}>
            <View style={[styles.camNav, isRTL && styles.rowR]}>
              <TouchableOpacity onPress={closeScanner} style={styles.camBtn}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.camTitle}>Scan Asset</Text>
              <TouchableOpacity onPress={() => setTorch(v => !v)} style={styles.camBtn} disabled={cameraError}>
                <Ionicons name={torch ? 'flash' : 'flash-off'} size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {cameraError ? (
            <View style={styles.camFallback}>
              <Ionicons name="camera-outline" size={40} color="#FFFFFF" />
              <Text style={styles.camFallbackTitle}>Camera unavailable</Text>
              <Text style={styles.camFallbackText}>
                The camera could not be started. Close this and type the asset code by hand.
              </Text>
              <Button label="Close" icon="close" variant="secondary" onPress={closeScanner} style={{ marginTop: spacing.lg }} />
            </View>
          ) : (
            <>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                enableTorch={torch}
                onMountError={() => setCameraError(true)}
                barcodeScannerSettings={{
                  barcodeTypes: [
                    'qr', 'code128', 'code39', 'code93', 'ean13', 'ean8',
                    'upc_a', 'upc_e', 'itf14', 'datamatrix', 'pdf417', 'aztec',
                  ],
                }}
                onBarcodeScanned={scanOpen ? onBarcodeScanned : undefined}
              />
              <View style={styles.frameWrap} pointerEvents="none">
                <View style={styles.frame}>
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
                <Text style={styles.frameHint}>Point the camera at the asset barcode or QR label.</Text>
              </View>
            </>
          )}
        </View>
      </Modal>
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    nav: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: c.surface,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    navBack: {
      width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },
    navTitle: { ...typography.title, color: c.text },
    navSub: { ...typography.caption, color: c.textMuted, marginTop: 1 },

    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md },

    card: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
    },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    labelFlex: { flex: 1, marginBottom: 0 },
    label: { ...typography.label, color: c.textSecondary, marginBottom: spacing.sm },
    optional: { ...typography.caption, color: c.textMuted },
    help: { ...typography.caption, color: c.textMuted, marginTop: spacing.md, marginBottom: spacing.sm },

    scanBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md,
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      marginBottom: spacing.sm,
    },
    scanBtnText: { ...typography.caption, fontWeight: '800', color: c.primary },

    input: {
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14, color: c.text,
    },
    inputError: { borderColor: c.danger.base },
    bigInput: { fontSize: 20, fontWeight: '800', paddingVertical: 13, letterSpacing: 0.5 },
    textArea: { minHeight: 76, textAlignVertical: 'top' },
    errorText: { ...typography.caption, fontWeight: '700', color: c.danger.base, marginTop: spacing.sm },

    lastCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.info.soft, borderRadius: radius.md, padding: spacing.md,
      borderWidth: 1, borderColor: c.info.base,
    },
    lastCardWarn: { backgroundColor: c.danger.soft, borderColor: c.danger.base },
    lastText: { ...typography.body, fontWeight: '700', color: c.text },
    deltaText: { ...typography.caption, fontWeight: '700', color: c.info.on, marginTop: 2 },

    // Scanner modal
    camRoot: { flex: 1, backgroundColor: '#000000' },
    camNav: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md, zIndex: 2,
    },
    camBtn: {
      width: 40, height: 40, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center', justifyContent: 'center',
    },
    camTitle: { ...typography.title, color: '#FFFFFF' },
    camFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['2xl'], gap: spacing.sm },
    camFallbackTitle: { ...typography.title, color: '#FFFFFF', marginTop: spacing.md },
    camFallbackText: { ...typography.body, color: 'rgba(255,255,255,0.8)', textAlign: 'center', maxWidth: 300 },

    frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    frame: { width: 240, height: 240, position: 'relative' },
    corner: { position: 'absolute', width: 34, height: 34, borderColor: c.primary },
    cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
    cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
    cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
    cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
    frameHint: {
      color: '#FFFFFF', fontSize: 14, fontWeight: '500', textAlign: 'center',
      marginTop: spacing['2xl'], maxWidth: 280, lineHeight: 20,
      textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6,
    },
  })
}
