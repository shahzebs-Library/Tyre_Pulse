/**
 * Repair Request (RFR) - a driver reports a fault BEFORE any job card exists.
 *
 * WHAT THIS SCREEN IS FOR
 * -----------------------
 * A driver is standing beside a machine that has stopped working. They need to
 * tell the workshop what is wrong, from the yard, possibly with no signal, with
 * gloves on, in the sun. The workshop later converts the request into a job
 * card:  RFR -> Job Card -> MIS store issue -> parts lines.
 *
 * THE RFR NUMBER IS NOT MINTED HERE, AND THAT IS DELIBERATE. Real numbers look
 * like `GC/RFR/0948/1225` (entity / RFR / sequence / MMYY) and the sequence is
 * allocated SERVER-SIDE. A phone that has been offline all day cannot know the
 * next one, so the confirmation says the office issues it. Printing an invented
 * number would hand the driver a reference that matches nothing in the ERP.
 *
 * OFFLINE-FIRST. The write goes through the typed record queue
 * (`REPAIR_REQUEST`), so a request raised with no signal is queued on the device
 * and upserted on one `client_uuid` when the phone reconnects - a lost response
 * can never create two requests for the same fault.
 *
 * LAYOUT: the capture-form archetype. Identify the machine FIRST (scan or
 * search) so everything the register already knows fills itself in, then the
 * fault, then optional meter readings and evidence, then one dominant submit.
 *
 * COLOUR BUDGET (why so little of it): green is the submit and the chosen fault
 * category; the priority ladder colours only the SELECTED chip, so at most one
 * coloured chip is ever on screen; amber is reserved for the meter-rollback
 * notice and the saved-offline chip. Everything else is neutral. Colouring all
 * twelve category chips would make the red priority mean nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  Alert, Platform, KeyboardAvoidingView, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'

import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useModuleGuard } from '../../hooks/useRoleGuard'
import { withModuleGuard, NoAccess } from '../../components/ModuleGuard'
import { Theme, spacing, radius, typography, elevation, HIT, statusColor } from '../../lib/theme'
import { textStart } from '../../lib/rtl'
import { toUserMessage } from '../../lib/safeError'
import { safeUuid } from '../../lib/ids'
import { saveCommand } from '../../lib/recordQueue'
import { extractScanCode, lookupAssetByCode, AssetLookupRecord } from '../../lib/assetLookup'
import { Screen, Card, AppText, Button, Badge, BackButton } from '../../components/ui'
import PhotoCapture from '../../components/PhotoCapture'
import SignaturePad from '../../components/SignaturePad'
import {
  RFR_FAULT_CATEGORIES, RFR_PRIORITIES, RFR_PRIORITY_KIND, RFR_DEFAULT_PRIORITY,
  RfrFaultCategory, RfrPriority, RepairRequestError, RepairRequestWarning,
  validateRepairRequest, buildRepairRequestPayload, assetDescriptionFrom,
} from '../../lib/repairRequest'

/** Swallow the same label re-firing many times a second while held under the lens. */
const RESCAN_COOLDOWN_MS = 2500
/** Debounce before the typed asset code is resolved against the register. */
const LOOKUP_DEBOUNCE_MS = 350

/** Validation code -> locale key. The pure engine returns codes, never prose. */
const ERROR_KEY: Record<RepairRequestError, string> = {
  asset_required: 'modules.rfr.errAsset',
  description_required: 'modules.rfr.errDescription',
  odometer_invalid: 'modules.rfr.errOdoInvalid',
  odometer_negative: 'modules.rfr.errOdoNegative',
  engine_hours_invalid: 'modules.rfr.errHoursInvalid',
  engine_hours_negative: 'modules.rfr.errHoursNegative',
}

const WARNING_KEY: Record<RepairRequestWarning, string> = {
  odometer_below_last: 'modules.rfr.warnOdoBelowLast',
  engine_hours_below_last: 'modules.rfr.warnHoursBelowLast',
}

export default withModuleGuard(RepairRequestScreen, 'repairRequest')

function RepairRequestScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const s = useMemo(() => makeStyles(theme), [theme])
  const params = useLocalSearchParams<{ asset?: string; site?: string }>()
  // No `useRouter` here on purpose: <BackButton> owns leaving this screen (it
  // delegates to backTo(), so it can never be a dead press), and a successful
  // submit deliberately STAYS put and clears the form - a driver in the yard
  // usually has more than one machine to report, and bouncing them to Home
  // after each one is pure friction.

  // Defence in depth. `withModuleGuard` above renders <NoAccess/> before this
  // component ever runs, so this branch is normally unreachable - but it must
  // still SAY "no access" rather than spin or render blank, because `allowed`
  // never becomes true for somebody who is denied.
  const { allowed } = useModuleGuard('repairRequest')

  const textAlign = textStart(isRTL)

  // -- form state -------------------------------------------------------------
  const [assetNo, setAssetNo] = useState(params.asset ? String(params.asset) : '')
  const [master, setMaster] = useState<AssetLookupRecord | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [site, setSite] = useState(params.site ? String(params.site) : (profile?.site ?? ''))
  const [plateNo, setPlateNo] = useState('')
  const [odometer, setOdometer] = useState('')
  const [engineHours, setEngineHours] = useState('')
  const [category, setCategory] = useState<RfrFaultCategory | ''>('')
  const [priority, setPriority] = useState<RfrPriority>(RFR_DEFAULT_PRIORITY)
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [signature, setSignature] = useState<string | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // A field the register filled must never be overwritten by a later lookup,
  // and a value the DRIVER typed must never be overwritten at all.
  const siteTouched = useRef<boolean>(!!profile?.site)
  const plateTouched = useRef(false)

  // -- scanner ----------------------------------------------------------------
  const [scanOpen, setScanOpen] = useState(false)
  const [torch, setTorch] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()
  const scanLock = useRef(false)
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  // ── Resolve the asset against the register ─────────────────────────────────
  // The site / plate / description the register already holds are filled in, so
  // the driver never retypes what the system knows. Nothing is LOCKED: those
  // columns are sparse across the fleet (fleet_number is set on well under half
  // of it, registration_no on fewer still), and a field locked before a value
  // arrives is a field that can never be filled.
  useEffect(() => {
    const code = assetNo.trim()
    if (!code) { setMaster(null); setLookingUp(false); return }
    let cancelled = false
    setLookingUp(true)
    const h = setTimeout(async () => {
      let rec: AssetLookupRecord | null = null
      try { rec = await lookupAssetByCode(code) } catch { rec = null }
      if (cancelled) return
      setMaster(rec)
      setLookingUp(false)
      if (!rec) return
      const masterSite = rec.site?.trim()
      if (masterSite && !siteTouched.current) setSite((p) => (p.trim() ? p : masterSite))
      const plate = rec.registration_no?.trim()
      if (plate && !plateTouched.current) setPlateNo((p) => (p.trim() ? p : plate))
    }, LOOKUP_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(h) }
  }, [assetNo])

  const openScanner = useCallback(async () => {
    if (!permission?.granted) {
      const res = await requestPermission()
      if (!res.granted) {
        Alert.alert(t('modules.rfr.camNeededTitle'), t('modules.rfr.camNeededMsg'))
        return
      }
    }
    setCameraError(false)
    scanLock.current = false
    lastScan.current = { code: '', at: 0 }
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
    if (code && code === lastScan.current.code && now - lastScan.current.at < RESCAN_COOLDOWN_MS) return
    lastScan.current = { code, at: now }
    scanLock.current = true
    ;(async () => {
      let rec: AssetLookupRecord | null = null
      try { rec = await lookupAssetByCode(res.data) } catch { /* offline / no match */ }
      const resolved = rec?.asset_no || code
      if (resolved) setAssetNo(resolved)
      closeScanner()
      if (!resolved) Alert.alert(t('modules.rfr.nothingScannedTitle'), t('modules.rfr.nothingScannedMsg'))
    })()
  }, [closeScanner, t])

  // ── Validation ────────────────────────────────────────────────────────────
  // `current_km` is the only last-reading the fleet register carries; there is
  // NO engine-hours column on vehicle_fleet, so an hours rollback simply cannot
  // be detected here and no warning is invented for it.
  const draft = useMemo(() => ({
    assetNo,
    plateNo,
    assetDescription: assetDescriptionFrom(master),
    site,
    odometer,
    engineHours,
    faultCategory: category,
    priority,
    description,
    photos,
    signature,
  }), [assetNo, plateNo, master, site, odometer, engineHours, category, priority,
    description, photos, signature])

  const check = useMemo(
    () => validateRepairRequest(draft, { odometer: master?.current_km ?? null }),
    [draft, master?.current_km],
  )

  const resetForm = useCallback(() => {
    setAssetNo('')
    setMaster(null)
    setSite(profile?.site ?? '')
    setPlateNo('')
    setOdometer('')
    setEngineHours('')
    setCategory('')
    setPriority(RFR_DEFAULT_PRIORITY)
    setDescription('')
    setPhotos([])
    setSignature(null)
    setSignOpen(false)
    siteTouched.current = !!profile?.site
    plateTouched.current = false
  }, [profile?.site])

  const onSubmit = useCallback(async () => {
    if (submitting) return
    if (!check.ok) {
      Alert.alert(
        t('modules.rfr.cannotSendTitle'),
        check.errors.map((e) => t(ERROR_KEY[e])).join('\n'),
      )
      return
    }
    setSubmitting(true)
    try {
      // ONE stable id: the payload carries it and the queue is handed the same
      // value as its idempotency key, so an immediate insert and any offline
      // replay upsert onto a single row.
      const clientUuid = `rfr_${safeUuid()}`
      const payload = buildRepairRequestPayload(
        draft,
        {
          id: profile?.id ?? null,
          fullName: profile?.full_name ?? null,
          username: profile?.username ?? null,
          country: profile?.country ?? null,
          site: profile?.site ?? null,
        },
        clientUuid,
        new Date().toISOString(),
      )
      const res = await saveCommand('REPAIR_REQUEST', payload, clientUuid)
      if (!res.ok) {
        Alert.alert(t('modules.rfr.saveFailTitle'), toUserMessage(res.error, t('modules.rfr.tryAgain')))
        return
      }
      // The confirmation NEVER shows a number. Offline says so explicitly, so a
      // driver with no signal knows the workshop has not seen it yet.
      Alert.alert(
        res.offline ? t('modules.rfr.queuedTitle') : t('modules.rfr.sentTitle'),
        res.offline ? t('modules.rfr.queuedMsg') : t('modules.rfr.sentMsg'),
        [{ text: t('common.ok'), onPress: () => resetForm() }],
      )
    } catch (e: any) {
      Alert.alert(t('modules.rfr.saveFailTitle'), toUserMessage(e, t('modules.rfr.tryAgain')))
    } finally {
      setSubmitting(false)
    }
  }, [submitting, check, draft, profile, resetForm, t])

  if (!allowed) return <NoAccess />

  const masterLine = master
    ? [master.asset_no, assetDescriptionFrom(master), master.fleet_number]
      .filter(Boolean).join('  |  ')
    : ''

  return (
    <Screen>
      {/* Header. BackButton is the shared control built on backTo(), so it can
          never be a dead press after a deep link, and it flips its own arrow. */}
      <View style={s.nav}>
        <BackButton fallback="/(app)" />
        <View style={s.navText}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.rfr.title')}</AppText>
          <AppText variant="caption" color="muted" style={{ textAlign }}>
            {t('modules.rfr.subtitle')}
          </AppText>
        </View>
      </View>

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          {/* ── 1. The machine ─────────────────────────────────────────────── */}
          <AppText variant="label" color="muted" style={[s.sectionLabel, { textAlign }]}>
            {t('modules.rfr.stepAsset')}
          </AppText>
          <Card>
            <View style={s.assetRow}>
              <TextInput
                style={[s.input, s.flex, { textAlign }]}
                value={assetNo}
                onChangeText={setAssetNo}
                placeholder={t('modules.rfr.assetPh')}
                placeholderTextColor={theme.color.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={openScanner}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('modules.rfr.scan')}
                style={s.scanBtn}
              >
                <Ionicons name="barcode-outline" size={22} color={theme.color.onPrimary} />
              </TouchableOpacity>
            </View>

            {lookingUp ? (
              <AppText variant="caption" color="muted" style={[s.masterLine, { textAlign }]}>
                {t('modules.rfr.checkingAsset')}
              </AppText>
            ) : master ? (
              <View style={s.masterBox}>
                <Ionicons name="car-outline" size={16} color={theme.color.textSecondary} />
                <AppText variant="caption" color="secondary" style={[s.flex, { textAlign }]}>
                  {`${t('modules.rfr.master')} ${masterLine}`}
                </AppText>
              </View>
            ) : assetNo.trim() ? (
              <AppText variant="caption" color="muted" style={[s.masterLine, { textAlign }]}>
                {t('modules.rfr.assetUnknown')}
              </AppText>
            ) : null}

            <View style={s.fieldPair}>
              <View style={s.flex}>
                <AppText variant="label" color="muted" style={[s.fieldLabel, { textAlign }]}>
                  {t('modules.common.site')}
                </AppText>
                <TextInput
                  style={[s.input, { textAlign }]}
                  value={site}
                  onChangeText={(v) => { siteTouched.current = true; setSite(v) }}
                  placeholder={t('modules.rfr.sitePh')}
                  placeholderTextColor={theme.color.textMuted}
                />
              </View>
              <View style={s.flex}>
                <AppText variant="label" color="muted" style={[s.fieldLabel, { textAlign }]}>
                  {t('modules.rfr.plate')}
                </AppText>
                <TextInput
                  style={[s.input, { textAlign }]}
                  value={plateNo}
                  onChangeText={(v) => { plateTouched.current = true; setPlateNo(v) }}
                  placeholder={t('modules.rfr.platePh')}
                  placeholderTextColor={theme.color.textMuted}
                  autoCapitalize="characters"
                />
              </View>
            </View>
          </Card>

          {/* ── 2. The fault ───────────────────────────────────────────────── */}
          <AppText variant="label" color="muted" style={[s.sectionLabel, { textAlign }]}>
            {t('modules.rfr.stepFault')}
          </AppText>
          <Card>
            <AppText variant="label" color="muted" style={[s.fieldLabel, { textAlign }]}>
              {`${t('modules.rfr.category')} ${t('modules.common.optional')}`}
            </AppText>
            <View style={s.chipWrap}>
              {RFR_FAULT_CATEGORIES.map((c) => {
                const on = category === c.token
                return (
                  <TouchableOpacity
                    key={c.token}
                    onPress={() => setCategory(on ? '' : c.token)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[s.chip, on && s.chipOnPrimary]}
                  >
                    <Ionicons
                      name={c.icon}
                      size={15}
                      color={on ? theme.color.onPrimary : theme.color.textSecondary}
                    />
                    <AppText
                      variant="caption"
                      style={{ color: on ? theme.color.onPrimary : theme.color.textSecondary }}
                    >
                      {t(`modules.rfr.faults.${faultKey(c.token)}`)}
                    </AppText>
                  </TouchableOpacity>
                )
              })}
            </View>

            <AppText variant="label" color="muted" style={[s.fieldLabel, s.gapTop, { textAlign }]}>
              {t('modules.common.priority')}
            </AppText>
            <View style={s.chipWrap}>
              {RFR_PRIORITIES.map((p) => {
                const on = priority === p
                // Only the CHOSEN rung is coloured, and it takes the theme's
                // designed status pair, so exactly one coloured chip exists.
                const sc = statusColor(theme, RFR_PRIORITY_KIND[p])
                return (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setPriority(p)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[s.chip, on && { backgroundColor: sc.soft, borderColor: sc.base }]}
                  >
                    <AppText
                      variant="caption"
                      style={{ color: on ? sc.on : theme.color.textSecondary }}
                    >
                      {t(`modules.priority.${p}`)}
                    </AppText>
                  </TouchableOpacity>
                )
              })}
            </View>

            <AppText variant="label" color="muted" style={[s.fieldLabel, s.gapTop, { textAlign }]}>
              {t('modules.rfr.description')}
            </AppText>
            <TextInput
              style={[s.input, s.textarea, { textAlign }]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('modules.rfr.descriptionPh')}
              placeholderTextColor={theme.color.textMuted}
              multiline
            />
          </Card>

          {/* ── 3. Meter readings (optional) ───────────────────────────────── */}
          <AppText variant="label" color="muted" style={[s.sectionLabel, { textAlign }]}>
            {`${t('modules.rfr.stepMeter')} ${t('modules.common.optional')}`}
          </AppText>
          <Card>
            <View style={[s.fieldPair, s.noTop]}>
              <View style={s.flex}>
                <AppText variant="label" color="muted" style={[s.fieldLabel, { textAlign }]}>
                  {t('modules.rfr.odometer')}
                </AppText>
                <TextInput
                  style={[s.input, { textAlign }]}
                  value={odometer}
                  onChangeText={setOdometer}
                  placeholder={t('modules.rfr.odometerPh')}
                  placeholderTextColor={theme.color.textMuted}
                  keyboardType="numeric"
                />
              </View>
              <View style={s.flex}>
                <AppText variant="label" color="muted" style={[s.fieldLabel, { textAlign }]}>
                  {t('modules.rfr.engineHours')}
                </AppText>
                <TextInput
                  style={[s.input, { textAlign }]}
                  value={engineHours}
                  onChangeText={setEngineHours}
                  placeholder={t('modules.rfr.engineHoursPh')}
                  placeholderTextColor={theme.color.textMuted}
                  keyboardType="numeric"
                />
              </View>
            </View>

            {/* A rollback is a WARNING, never a block: a meter can be replaced,
                and refusing the reading would refuse the fault report with it. */}
            {check.warnings.length > 0 ? (
              <View style={s.warnBox}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.color.warning.base} />
                <AppText variant="caption" style={[s.flex, { color: theme.color.warning.on, textAlign }]}>
                  {check.warnings.map((w) => t(WARNING_KEY[w])).join(' ')}
                </AppText>
              </View>
            ) : (
              <AppText variant="caption" color="muted" style={[s.fieldLabel, { textAlign }]}>
                {t('modules.rfr.meterHelp')}
              </AppText>
            )}
          </Card>

          {/* ── 4. Evidence (optional) ─────────────────────────────────────── */}
          <AppText variant="label" color="muted" style={[s.sectionLabel, { textAlign }]}>
            {`${t('modules.rfr.stepEvidence')} ${t('modules.common.optional')}`}
          </AppText>
          <Card>
            <AppText variant="label" color="muted" style={[s.fieldLabel, { textAlign }]}>
              {t('modules.common.photos')}
            </AppText>
            {/* PhotoCapture uploads via uploadModulePhoto, which runs every image
                through prepareForUpload (resize + compress) BEFORE any base64
                read - the fan-out that once OOM-crashed 2 GB handsets. */}
            <PhotoCapture
              value={photos}
              onChange={setPhotos}
              module="repair-request"
              tint={theme.color.primary}
              label={t('modules.common.addPhoto')}
            />

            <View style={s.signHead}>
              <AppText variant="label" color="muted" style={[s.flex, { textAlign }]}>
                {t('modules.rfr.signature')}
              </AppText>
              {signature ? <Badge kind="success" icon="checkmark">{t('modules.rfr.signed')}</Badge> : null}
            </View>

            {signOpen || signature ? (
              // `value` is passed so reopening shows the mark that was drawn.
              // Without it the pad reopens BLANK over a real signature and Clear
              // then erases what the driver only came back to look at.
              //
              // NO `penColor` ON PURPOSE. SignaturePad's own surface is a
              // hardcoded near-white (#f8fafc) in BOTH themes, so passing
              // `theme.color.text` draws near-white ink on a near-white pad in
              // dark mode - an invisible signature. Its default is near-black,
              // which is right against that fixed surface either way. (Four
              // other screens do pass theme.color.text and have this bug today.)
              <SignaturePad
                value={signature}
                onChange={setSignature}
                height={170}
              />
            ) : (
              <Button
                label={t('modules.rfr.addSignature')}
                icon="create-outline"
                variant="secondary"
                onPress={() => setSignOpen(true)}
              />
            )}
          </Card>

          {/* ── Submit ─────────────────────────────────────────────────────── */}
          <View style={s.submitBlock}>
            <Button
              label={t('modules.rfr.send')}
              icon="send"
              size="lg"
              full
              loading={submitting}
              disabled={submitting}
              onPress={onSubmit}
            />
            <View style={s.noteRow}>
              <Ionicons name="information-circle-outline" size={16} color={theme.color.textMuted} />
              <AppText variant="caption" color="muted" style={[s.flex, { textAlign }]}>
                {t('modules.rfr.numberNote')}
              </AppText>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Asset barcode / QR scanner. The backdrop here is a LIVE camera preview,
          not a theme surface, so the fixed dark chrome is correct rather than a
          missed token (the documented exception for camera overlays). */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={closeScanner}>
        <View style={s.camRoot}>
          <SafeAreaView edges={['top']}>
            <View style={s.camNav}>
              <TouchableOpacity
                onPress={closeScanner}
                style={s.camBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </TouchableOpacity>
              <AppText variant="title" style={s.camTitle}>{t('modules.rfr.scanAsset')}</AppText>
              <TouchableOpacity
                onPress={() => setTorch((v) => !v)}
                style={s.camBtn}
                disabled={cameraError}
                accessibilityRole="button"
                accessibilityLabel={t('modules.rfr.torch')}
              >
                <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {cameraError ? (
            <View style={s.camFallback}>
              <Ionicons name="camera-outline" size={40} color="#FFFFFF" />
              <AppText variant="title" style={s.camTitle}>{t('modules.rfr.camUnavailable')}</AppText>
              <AppText variant="body" style={s.camFallbackText}>
                {t('modules.rfr.camUnavailableMsg')}
              </AppText>
              <Button
                label={t('common.close')}
                icon="close"
                variant="secondary"
                onPress={closeScanner}
                style={s.camFallbackBtn}
              />
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
              <View style={s.frameWrap} pointerEvents="none">
                <View style={s.frame}>
                  <View style={[s.corner, s.cornerTL]} />
                  <View style={[s.corner, s.cornerTR]} />
                  <View style={[s.corner, s.cornerBL]} />
                  <View style={[s.corner, s.cornerBR]} />
                </View>
                <AppText variant="body" style={s.frameHint}>{t('modules.rfr.frameHint')}</AppText>
              </View>
            </>
          )}
        </View>
      </Modal>
    </Screen>
  )
}

/**
 * Fault token -> locale key segment. Tokens are stored VERBATIM in English, so
 * the key is derived rather than stored twice (`Drum/Mixer` -> `drumMixer`).
 */
function faultKey(token: string): string {
  const parts = token.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return parts
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('')
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    flex: { flex: 1 },

    // Native RTL mirrors `flexDirection: 'row'` automatically (lib/rtl.ts), so
    // rows are plain `row` here - forcing row-reverse would double-flip them.
    nav: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    },
    navText: { flex: 1 },

    content: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing['5xl'],
      gap: spacing.sm,
    },

    // Section labels are the quiet signposts; the generous gap ABOVE them is
    // what separates one group from the next without adding rules or boxes.
    sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.xs, textTransform: 'uppercase' },

    // -- inputs ---------------------------------------------------------------
    input: {
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      minHeight: HIT,
      ...typography.body,
      color: c.text,
    },
    // Derived, not a magic number: four lines of body text plus the field's own
    // vertical padding. The fault description is the most important input here,
    // so it opens big enough to write a sentence into without scrolling.
    textarea: {
      minHeight: typography.body.lineHeight * 4 + spacing.lg * 2,
      textAlignVertical: 'top',
      paddingTop: spacing.md,
    },
    fieldLabel: { marginBottom: spacing.xs },
    fieldPair: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
    /** A pair that OPENS a card needs no top gap; the card padding is the gap. */
    noTop: { marginTop: 0 },
    gapTop: { marginTop: spacing.lg },

    // -- asset ----------------------------------------------------------------
    assetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    scanBtn: {
      width: HIT, height: HIT, borderRadius: radius.md,
      backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
      ...elevation(theme, 1),
    },
    masterLine: { marginTop: spacing.sm },
    masterBox: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginTop: spacing.sm, padding: spacing.sm,
      borderRadius: radius.sm, backgroundColor: c.surfaceSunken,
    },

    // -- chips ----------------------------------------------------------------
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      // Full HIT, not the 36/38 that is habitual in this app: these are the
      // most-tapped controls on the screen and the hands wear gloves.
      minHeight: HIT,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1.5, borderColor: c.border,
    },
    chipOnPrimary: { backgroundColor: c.primary, borderColor: c.primary },

    // -- meter warning --------------------------------------------------------
    warnBox: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginTop: spacing.md, padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.warning.soft,
      borderWidth: 1, borderColor: c.warning.base,
    },

    // -- signature ------------------------------------------------------------
    signHead: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      marginTop: spacing.lg, marginBottom: spacing.sm,
    },

    // -- submit ---------------------------------------------------------------
    submitBlock: { marginTop: spacing['2xl'], gap: spacing.md },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },

    // -- scanner (fixed dark chrome over a live preview) -----------------------
    camRoot: { flex: 1, backgroundColor: '#000000' },
    camNav: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md, zIndex: 2,
    },
    camBtn: {
      width: HIT, height: HIT, borderRadius: radius.md,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center', justifyContent: 'center',
    },
    camTitle: { color: '#FFFFFF', textAlign: 'center' },
    camFallback: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      padding: spacing['2xl'], gap: spacing.sm,
    },
    camFallbackText: { color: 'rgba(255,255,255,0.85)', textAlign: 'center', maxWidth: 300 },
    camFallbackBtn: { marginTop: spacing.lg },

    frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    frame: { width: 240, height: 240, position: 'relative' },
    corner: { position: 'absolute', width: 34, height: 34, borderColor: c.primary },
    cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: radius.md },
    cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: radius.md },
    cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: radius.md },
    cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: radius.md },
    frameHint: {
      color: '#FFFFFF', textAlign: 'center',
      marginTop: spacing['2xl'], maxWidth: 280,
      textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6,
    },
  })
}
