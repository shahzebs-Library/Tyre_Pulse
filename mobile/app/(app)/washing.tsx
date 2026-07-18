/**
 * Vehicle Washing - driver-facing wash log.
 *
 * A driver picks the asset (SCAN or SEARCH first, mirroring the meter-log flow),
 * the screen auto-fills and displays the vehicle's details from vehicle_fleet,
 * they choose the wash type, add photos, and save. The wash is ALWAYS dated
 * today (same-day, read-only). The write is offline-safe via the typed record
 * queue (WASH_RECORD), so a wash logged with no signal is never lost.
 *
 * A "Due for wash" section lists vehicles past their wash interval and fires a
 * local reminder (no server cron).
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, Platform, KeyboardAvoidingView, Modal,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme, spacing, radius, typography } from '../../lib/theme'
import { toUserMessage } from '../../lib/safeError'
import { Screen, Button } from '../../components/ui'
import PhotoCapture from '../../components/PhotoCapture'
import ChecklistReferencePicker from '../../components/ChecklistReferencePicker'
import { extractScanCode, lookupAssetByCode, AssetLookupRecord } from '../../lib/assetLookup'
import { submitWash, listRecentWashes, todayISODate, WASH_STATUS_CHOICES } from '../../lib/wash'
import { washDueList, WashDueEntry, WASH_INTERVAL_DAYS } from '../../lib/washSchedule'
import { notifyWashDue } from '../../lib/notifications'

// DB CHECK vocabulary (wash_records.wash_type). Tokens are stored verbatim
// (English); only the display label is translated. Order = quickest-first.
const WASH_TYPES = ['Exterior', 'Interior', 'Full', 'Engine Bay', 'Undercarriage', 'Steam', 'Waterless'] as const
type WashType = typeof WASH_TYPES[number]

// Swallow the same code re-firing many times per second while held on a label.
const RESCAN_COOLDOWN_MS = 2500

export default function WashingScreen() {
  const { profile, canAccess } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const router = useRouter()

  const allowed = canAccess('washing')

  // Translate-with-fallback: use the English literal when a key is not yet in the
  // locale files (avoids shipping raw key paths for the new status/operator UI).
  const tf = useCallback((key: string, fallback: string) => {
    const s = t(key)
    return !s || s === key ? fallback : s
  }, [t])

  const [assetNo, setAssetNo] = useState('')
  const [site, setSite] = useState(profile?.site ?? '')
  const [master, setMaster] = useState<AssetLookupRecord | null>(null)
  const [vehicleType, setVehicleType] = useState('')
  const [washType, setWashType] = useState<WashType | ''>('')
  const [status, setStatus] = useState<string>('In Progress')
  const [operator, setOperator] = useState<string>(profile?.full_name ?? '')
  const [photos, setPhotos] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [bay, setBay] = useState('')
  const [odometer, setOdometer] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [savedFlash, setSavedFlash] = useState<'synced' | 'pending' | null>(null)

  const [due, setDue] = useState<WashDueEntry[]>([])
  const dueNotified = useRef(false)

  // Site auto-fills from the fleet master but never over a value the user set.
  const siteTouched = useRef<boolean>(!!profile?.site)

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
  const todayLabel = new Date().toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })

  // Direct-navigation guard: a user without washing access is bounced home.
  useEffect(() => {
    if (!allowed) router.replace('/')
  }, [allowed])

  // Load recent washes -> derive the "due for wash" list, and fire one local
  // reminder per screen mount when anything is due. Best-effort (never blocks).
  const loadDue = useCallback(async () => {
    try {
      const recs = await listRecentWashes(200)
      const list = washDueList(recs, { intervalDays: WASH_INTERVAL_DAYS, now: today })
      setDue(list)
      if (list.length > 0 && !dueNotified.current) {
        dueNotified.current = true
        notifyWashDue(list.length).catch(() => {})
      }
    } catch {
      setDue([])
    }
  }, [today])

  useEffect(() => { if (allowed) loadDue() }, [allowed, loadDue])

  // When the asset changes: auto-fill vehicle_type + site + country from the
  // fleet master (only when not user-set) and show the master context line.
  useEffect(() => {
    const a = assetNo.trim()
    if (!a) { setMaster(null); return }
    let cancelled = false
    const h = setTimeout(async () => {
      let rec: AssetLookupRecord | null = null
      try { rec = await lookupAssetByCode(a) } catch { rec = null }
      if (cancelled) return
      setMaster(rec)
      if (rec) {
        if (rec.vehicle_type) setVehicleType(prev => (prev.trim() ? prev : rec!.vehicle_type))
        const masterSite = rec.site?.trim()
        if (masterSite && !siteTouched.current) setSite(prev => (prev.trim() ? prev : masterSite))
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(h) }
  }, [assetNo])

  // Auto-dismiss the "logged / pending sync" chip.
  useEffect(() => {
    if (!savedFlash) return
    const h = setTimeout(() => setSavedFlash(null), 4000)
    return () => clearTimeout(h)
  }, [savedFlash])

  const resetForm = useCallback(() => {
    setAssetNo('')
    setSite(profile?.site ?? '')
    setMaster(null)
    setVehicleType('')
    setWashType('')
    setStatus('In Progress')
    setOperator(profile?.full_name ?? '')
    setPhotos([])
    setNotes('')
    setBay('')
    setOdometer('')
    siteTouched.current = !!profile?.site
  }, [profile?.full_name, profile?.site])

  const onSiteChange = useCallback((v: string) => {
    siteTouched.current = true
    setSite(v)
  }, [])

  // -- Asset scanning ---------------------------------------------------------
  const openScanner = useCallback(async () => {
    if (!permission?.granted) {
      const res = await requestPermission()
      if (!res.granted) {
        Alert.alert(t('modules.washing.camNeededTitle'), t('modules.washing.camNeededMsg'))
        return
      }
    }
    setCameraError(false)
    scanLock.current = false
    lastScanRef.current = { code: '', at: 0 }
    setScanOpen(true)
  }, [permission, requestPermission, t])

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
      let rec: AssetLookupRecord | null = null
      try { rec = await lookupAssetByCode(res.data) } catch { /* offline / no match */ }
      const resolved = rec?.asset_no || code
      if (resolved) setAssetNo(resolved)
      closeScanner()
      if (!resolved) Alert.alert(t('modules.washing.nothingScannedTitle'), t('modules.washing.nothingScannedMsg'))
    })()
  }, [closeScanner, t])

  const numOrNull = (v: string): number | null => {
    const s = v.trim()
    if (s === '') return null
    const n = Number(s)
    return Number.isNaN(n) ? null : n
  }

  const doSubmit = useCallback(async () => {
    setSubmitting(true)
    try {
      const res = await submitWash({
        assetNo: assetNo.trim(),
        vehicleType: vehicleType.trim() || null,
        site: site.trim() || null,
        country: profile?.country ?? null,
        createdBy: profile?.id ?? null,
        washDate: today,
        washType: washType || null,
        status,
        washedBy: operator.trim() || null,
        bay: bay.trim() || null,
        odometerKm: numOrNull(odometer),
        notes: notes.trim() || null,
        photos: photos.filter(Boolean),
      })
      resetForm()
      setSavedFlash(res.offline ? 'pending' : 'synced')
      // Refresh the due list so a just-washed asset drops off it.
      loadDue()
    } catch (e: any) {
      Alert.alert(t('modules.washing.saveFailTitle'), toUserMessage(e, t('modules.washing.tryAgain')))
    } finally {
      setSubmitting(false)
    }
  }, [assetNo, vehicleType, site, profile, today, washType, status, operator, bay, odometer, notes, photos, resetForm, loadDue, t])

  function handleSave() {
    if (submitting) return
    if (!assetNo.trim()) { Alert.alert(t('modules.washing.assetRequiredTitle'), t('modules.washing.assetRequiredMsg')); return }
    if (!washType) { Alert.alert(t('modules.washing.typeRequiredTitle'), t('modules.washing.typeRequiredMsg')); return }
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
            <Text style={[styles.navTitle, { textAlign }]}>{t('modules.washing.title')}</Text>
            <Text style={[styles.navSub, { textAlign }]}>{todayLabel}</Text>
          </View>
        </View>

        {savedFlash && (
          <View style={[styles.flash, savedFlash === 'pending' ? styles.flashPending : styles.flashSynced, isRTL && styles.rowR]}>
            <Ionicons
              name={savedFlash === 'pending' ? 'cloud-upload-outline' : 'checkmark-circle'}
              size={16}
              color={savedFlash === 'pending' ? theme.color.warning.base : theme.color.success.base}
            />
            <Text style={[styles.flashText, { color: savedFlash === 'pending' ? theme.color.warning.on : theme.color.success.on, textAlign }]}>
              {savedFlash === 'pending' ? t('modules.washing.savedPending') : t('modules.washing.savedLogged')}
            </Text>
          </View>
        )}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Due for wash */}
          <View style={styles.card}>
            <View style={[styles.labelRow, isRTL && styles.rowR]}>
              <Ionicons name="water-outline" size={16} color={theme.color.info.base} />
              <Text style={[styles.label, styles.labelFlex, { textAlign, marginBottom: 0 }]}>{t('modules.washing.dueTitle')}</Text>
              {due.length > 0 && (
                <View style={styles.duePill}><Text style={styles.duePillText}>{due.length}</Text></View>
              )}
            </View>
            {due.length === 0 ? (
              <View style={[styles.dueEmpty, isRTL && styles.rowR]}>
                <Ionicons name="checkmark-done-outline" size={18} color={theme.color.primary} />
                <Text style={[styles.dueEmptyText, { textAlign }]}>{t('modules.washing.dueNone')}</Text>
              </View>
            ) : (
              <View style={{ gap: 8, marginTop: spacing.sm }}>
                {due.slice(0, 8).map(d => (
                  <TouchableOpacity
                    key={d.asset_no}
                    style={[styles.dueRow, isRTL && styles.rowR]}
                    activeOpacity={0.75}
                    onPress={() => { setAssetNo(d.asset_no); if (d.site && !siteTouched.current) setSite(d.site) }}
                  >
                    <View style={styles.dueIcon}>
                      <Ionicons name="car-outline" size={16} color={theme.color.warning.base} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.dueAsset, { textAlign }]} numberOfLines={1}>{d.asset_no}</Text>
                      <Text style={[styles.dueMeta, { textAlign }]} numberOfLines={1}>
                        {d.days_overdue === 0
                          ? t('modules.washing.dueToday')
                          : `${d.days_overdue} ${t('modules.washing.daysOverdue')}`}
                        {d.site ? ` · ${d.site}` : ''}
                      </Text>
                    </View>
                    <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={theme.color.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Asset + master details */}
          <View style={styles.card}>
            <View style={[styles.labelRow, isRTL && styles.rowR]}>
              <Text style={[styles.label, styles.labelFlex, { textAlign }]}>{t('modules.washing.assetLabel')}</Text>
              <TouchableOpacity onPress={openScanner} style={styles.scanBtn} activeOpacity={0.85}>
                <Ionicons name="scan-outline" size={16} color={theme.color.primary} />
                <Text style={styles.scanBtnText}>{t('modules.washing.scan')}</Text>
              </TouchableOpacity>
            </View>
            <ChecklistReferencePicker
              source="asset"
              value={assetNo}
              onChange={setAssetNo}
              country={profile?.country ?? null}
              placeholder={t('modules.washing.assetPlaceholder')}
            />

            {master && (
              <View style={styles.masterBox}>
                <Text style={[styles.masterLine, { textAlign }]} numberOfLines={2}>
                  {[
                    master.vehicle_type,
                    [master.make, master.model].filter(Boolean).join(' '),
                    master.fleet_number ? `${t('modules.washing.fleetNo')} ${master.fleet_number}` : null,
                    master.site,
                  ].filter(Boolean).join(' · ')}
                </Text>
              </View>
            )}

            <View style={{ height: 12 }} />
            <Text style={[styles.label, { textAlign }]}>{t('modules.washing.site')}</Text>
            <ChecklistReferencePicker
              source="site"
              value={site}
              onChange={onSiteChange}
              country={profile?.country ?? null}
              placeholder={t('modules.washing.sitePlaceholder')}
            />
            <Text style={[styles.help, { textAlign, marginTop: spacing.sm }]}>{t('modules.washing.siteHelp')}</Text>
          </View>

          {/* Date (locked to today) */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>{t('modules.washing.dateLabel')}</Text>
            <View style={[styles.lockedDate, isRTL && styles.rowR]}>
              <Ionicons name="calendar-outline" size={18} color={theme.color.textSecondary} />
              <Text style={[styles.lockedDateText, { textAlign }]}>{t('modules.washing.today')} · {todayLabel}</Text>
              <Ionicons name="lock-closed-outline" size={14} color={theme.color.textMuted} />
            </View>
          </View>

          {/* Wash type */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>{t('modules.washing.typeLabel')}</Text>
            <View style={styles.chipWrap}>
              {WASH_TYPES.map(wt => {
                const active = washType === wt
                const key = wt.replace(/\s+/g, '')
                const tr = t(`modules.washing.types.${key}`)
                const label = tr === `modules.washing.types.${key}` ? wt : tr
                return (
                  <TouchableOpacity
                    key={wt}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setWashType(wt)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* Status (supervisor sets) */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>{tf('modules.washing.statusLabel', 'Status')}</Text>
            <View style={styles.chipWrap}>
              {WASH_STATUS_CHOICES.map(s => {
                const active = status === s
                const key = s.replace(/\s+/g, '')
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setStatus(s)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{tf(`modules.washing.statuses.${key}`, s)}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* Photos */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>{t('modules.washing.photosLabel')} <Text style={styles.optional}>{t('modules.common.optional')}</Text></Text>
            <PhotoCapture value={photos} onChange={setPhotos} module="wash" tint={theme.color.info.base} max={6} label={t('modules.washing.addPhoto')} />
          </View>

          {/* Optional details */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>{t('modules.washing.detailsLabel')} <Text style={styles.optional}>{t('modules.common.optional')}</Text></Text>
            <Text style={[styles.subLabel, { textAlign }]}>{tf('modules.washing.operator', 'Operator name')}</Text>
            <TextInput
              style={[styles.input, { textAlign }]}
              value={operator}
              onChangeText={setOperator}
              placeholder={tf('modules.washing.operatorPlaceholder', 'Who washed the vehicle')}
              placeholderTextColor={theme.color.textMuted}
            />
            <View style={[styles.twoCol, { marginTop: spacing.sm }]}>
              <View style={styles.col}>
                <Text style={[styles.subLabel, { textAlign }]}>{t('modules.washing.bay')}</Text>
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={bay}
                  onChangeText={setBay}
                  placeholder={t('modules.washing.bayPlaceholder')}
                  placeholderTextColor={theme.color.textMuted}
                />
              </View>
              <View style={styles.col}>
                <Text style={[styles.subLabel, { textAlign }]}>{t('modules.washing.odometer')}</Text>
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={odometer}
                  onChangeText={v => setOdometer(v.replace(/[^0-9.]/g, ''))}
                  placeholder={t('modules.washing.odometerPlaceholder')}
                  placeholderTextColor={theme.color.textMuted}
                  keyboardType="numeric"
                />
              </View>
            </View>
          </View>

          {/* Notes */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>{t('modules.washing.notesLabel')} <Text style={styles.optional}>{t('modules.common.optional')}</Text></Text>
            <TextInput
              style={[styles.input, styles.textArea, { textAlign }]}
              value={notes}
              onChangeText={setNotes}
              placeholder={t('modules.washing.notesPlaceholder')}
              placeholderTextColor={theme.color.textMuted}
              multiline
              numberOfLines={3}
            />
          </View>

          <Button
            label={t('modules.washing.save')}
            icon="checkmark-circle-outline"
            onPress={handleSave}
            loading={submitting}
            disabled={submitting}
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
              <Text style={styles.camTitle}>{t('modules.washing.scanAsset')}</Text>
              <TouchableOpacity onPress={() => setTorch(v => !v)} style={styles.camBtn} disabled={cameraError}>
                <Ionicons name={torch ? 'flash' : 'flash-off'} size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {cameraError ? (
            <View style={styles.camFallback}>
              <Ionicons name="camera-outline" size={40} color="#FFFFFF" />
              <Text style={styles.camFallbackTitle}>{t('modules.washing.camUnavailable')}</Text>
              <Text style={styles.camFallbackText}>{t('modules.washing.camUnavailableMsg')}</Text>
              <Button label={t('common.close')} icon="close" variant="secondary" onPress={closeScanner} style={{ marginTop: spacing.lg }} />
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
                <Text style={styles.frameHint}>{t('modules.washing.frameHint')}</Text>
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

    flash: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginHorizontal: spacing.lg, marginTop: spacing.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderRadius: radius.md, borderWidth: 1,
    },
    flashSynced: { backgroundColor: c.success.soft, borderColor: c.success.base },
    flashPending: { backgroundColor: c.warning.soft, borderColor: c.warning.base },
    flashText: { ...typography.caption, fontWeight: '800', flex: 1 },

    scroll: { flex: 1 },
    content: { padding: spacing.lg, paddingBottom: spacing['4xl'], gap: spacing.md },

    card: {
      backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: c.border,
    },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    labelFlex: { flex: 1 },
    label: { ...typography.label, color: c.textSecondary, marginBottom: spacing.sm },
    subLabel: { ...typography.caption, color: c.textMuted, marginBottom: spacing.xs, fontWeight: '700' },
    optional: { ...typography.caption, color: c.textMuted },
    help: { ...typography.caption, color: c.textMuted, marginTop: spacing.md },

    scanBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md,
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      marginBottom: spacing.sm,
    },
    scanBtnText: { ...typography.caption, fontWeight: '800', color: c.primary },

    masterBox: {
      marginTop: spacing.sm, backgroundColor: c.info.soft, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderWidth: 1, borderColor: c.info.base,
    },
    masterLine: { ...typography.caption, fontWeight: '700', color: c.info.on },

    lockedDate: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: c.surfaceAlt, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: 11,
      borderWidth: 1, borderColor: c.border,
    },
    lockedDateText: { ...typography.body, fontWeight: '700', color: c.text, flex: 1 },

    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
    },
    chipActive: { backgroundColor: c.primarySoft, borderColor: c.primary },
    chipText: { ...typography.caption, fontWeight: '700', color: c.textSecondary },
    chipTextActive: { color: c.primaryDark },

    input: {
      backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14, color: c.text,
    },
    textArea: { minHeight: 76, textAlignVertical: 'top' },
    twoCol: { flexDirection: 'row', gap: spacing.md },
    col: { flex: 1 },

    // Due for wash
    duePill: {
      minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm,
      backgroundColor: c.warning.soft, alignItems: 'center',
    },
    duePillText: { ...typography.micro, fontWeight: '800', color: c.warning.on },
    dueEmpty: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm,
    },
    dueEmptyText: { ...typography.caption, fontWeight: '700', color: c.primaryDark, flex: 1 },
    dueRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: c.surfaceAlt, borderRadius: radius.md, padding: spacing.sm,
      borderWidth: 1, borderColor: c.border,
    },
    dueIcon: {
      width: 34, height: 34, borderRadius: radius.sm, backgroundColor: c.warning.soft,
      alignItems: 'center', justifyContent: 'center',
    },
    dueAsset: { ...typography.body, fontWeight: '800', color: c.text },
    dueMeta: { ...typography.micro, color: c.textMuted, marginTop: 1 },

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
