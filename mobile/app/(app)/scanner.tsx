import { useState, useCallback, useRef, useMemo } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import {
  CameraView, useCameraPermissions, type BarcodeScanningResult,
} from 'expo-camera'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme, spacing, radius, typography, elevation } from '../../lib/theme'
import { Screen, AppText, Button, EmptyState, Loading } from '../../components/ui'
import { extractScanCode } from '../../lib/assetLookup'
import {
  resolveScan, ScanResolution, RouteTarget,
  inspectionForVehicle, tyreChangeForVehicle, viewAssetRoute,
  inspectionForTyre, tyreChangeForTyre, manualSearchRoute,
} from '../../lib/scanRouter'

type ScanState = 'scanning' | 'searching' | 'result'

// Ignore the same code re-firing within this window (barcodes fire many
// times per second while the frame is held on the label).
const RESCAN_COOLDOWN_MS = 2500

import { withModuleGuard } from '../../components/ModuleGuard'

export default withModuleGuard(ScannerScreen, 'scan')

function ScannerScreen() {
  const router = useRouter()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const [permission, requestPermission] = useCameraPermissions()

  const [state, setState] = useState<ScanState>('scanning')
  const [torch, setTorch] = useState(false)
  const [resolved, setResolved] = useState<ScanResolution | null>(null)
  // Set when the camera hardware fails to start (no camera, driver error, etc.)
  // so the screen degrades to manual entry instead of crashing on a black feed.
  const [cameraError, setCameraError] = useState(false)
  const lockRef = useRef(false)
  // Last handled code + time, to swallow rapid duplicate frames of one label.
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  const textAlign = isRTL ? 'right' : 'left'
  const backIcon = isRTL ? 'arrow-forward' : 'arrow-back'

  const onBarcodeScanned = useCallback((res: BarcodeScanningResult) => {
    if (lockRef.current || state !== 'scanning') return

    const now = Date.now()
    const code = extractScanCode(res.data)
    // Debounce: same code seen again within the cooldown is ignored.
    if (code && code === lastScanRef.current.code && now - lastScanRef.current.at < RESCAN_COOLDOWN_MS) {
      return
    }
    lastScanRef.current = { code, at: now }

    lockRef.current = true
    setState('searching')
    resolveScan(res.data)
      .then((r) => { setResolved(r); setState('result') })
      .catch(() => { setResolved({ kind: 'none', code, raw: res.data }); setState('result') })
  }, [state])

  function reset() {
    setResolved(null)
    lockRef.current = false
    // Clear the debounce so an intentional re-scan of the same label works.
    lastScanRef.current = { code: '', at: 0 }
    setState('scanning')
  }

  // Every result action routes through the pure builders in scanRouter so the
  // next screen always lands prefilled with what was scanned (nothing retyped).
  // Guarded so a navigation failure never crashes the scanner - it falls back
  // to a clean scanning state instead.
  function go(target: RouteTarget) {
    try {
      router.replace(target as never)
    } catch {
      reset()
    }
  }

  // -- Permission gates -------------------------------------------------------
  if (!permission) {
    return (
      <Screen padded={false}>
        <View style={styles.centerFill}>
          <Loading label={t('scanner.title')} />
        </View>
      </Screen>
    )
  }

  if (!permission.granted) {
    return (
      <Screen padded={false}>
        <StatusBar
          barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        />
        <View style={[styles.nav, isRTL && styles.navRTL]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={backIcon} size={22} color={theme.color.text} />
          </TouchableOpacity>
          <AppText variant="title">{t('scanner.title')}</AppText>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.centerFill}>
          <EmptyState
            icon="camera-outline"
            title={t('scanner.permissionTitle')}
            message={t('scanner.permissionMessage')}
            actionLabel={t('scanner.grantPermission')}
            onAction={requestPermission}
          />
        </View>
      </Screen>
    )
  }

  // -- Camera hardware failed to mount ----------------------------------------
  if (cameraError) {
    return (
      <Screen padded={false}>
        <StatusBar
          barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        />
        <View style={[styles.nav, isRTL && styles.navRTL]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={backIcon} size={22} color={theme.color.text} />
          </TouchableOpacity>
          <AppText variant="title">{t('scanner.title')}</AppText>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.centerFill}>
          <EmptyState
            icon="camera-outline"
            title={t('scanner.camUnavailable')}
            message={t('scanner.camUnavailableMsg')}
            actionLabel={t('scanner.enterManually')}
            onAction={() => router.replace('/(app)/serial-search')}
          />
        </View>
      </Screen>
    )
  }

  // -- Camera + overlay -------------------------------------------------------
  return (
    <View style={styles.cameraRoot}>
      <StatusBar barStyle="light-content" />
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
        onBarcodeScanned={state === 'scanning' ? onBarcodeScanned : undefined}
      />

      {/* Top bar (over the live camera feed - kept high-contrast on dark) */}
      <SafeAreaView style={styles.overlayTop} edges={['top']}>
        <View style={[styles.nav, isRTL && styles.navRTL]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBackDark}>
            <Ionicons name={backIcon} size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.navTitleDark}>{t('scanner.title')}</Text>
          <TouchableOpacity onPress={() => setTorch(v => !v)} style={styles.navBackDark}>
            <Ionicons name={torch ? 'flash' : 'flash-off'} size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Scan frame */}
      {state === 'scanning' && (
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <Text style={styles.frameHint}>{t('scanner.instruction')}</Text>
        </View>
      )}

      {/* Manual-entry fallback (when a label will not read) */}
      {state === 'scanning' && (
        <SafeAreaView style={styles.overlayBottom} edges={['bottom']}>
          <TouchableOpacity
            style={styles.manualBtn}
            onPress={() => router.push('/(app)/serial-search')}
            activeOpacity={0.85}
          >
            <Ionicons name="keypad-outline" size={18} color="#FFFFFF" />
            <Text style={styles.manualBtnText}>{t('scanner.enterManually')}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}

      {/* Searching */}
      {state === 'searching' && (
        <View style={styles.centerOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <Text style={styles.searchingText}>{t('scanner.searching')}</Text>
        </View>
      )}

      {/* Result sheet (themed surface) */}
      {state === 'result' && resolved && (
        <View style={styles.sheet}>
          {resolved.kind === 'vehicle' && (
            <>
              <View style={[styles.sheetHeader, isRTL && styles.rowRTL]}>
                <View style={[styles.resultBadge, { backgroundColor: theme.tint.green.bg }]}>
                  <Ionicons name="bus" size={20} color={theme.tint.green.fg} />
                </View>
                <AppText variant="label" color="secondary" style={[styles.resultTitle, { textAlign }]}>
                  {t('scanner.vehicleFound')}
                </AppText>
              </View>
              <AppText variant="h1" style={{ textAlign }}>{resolved.vehicle.asset_no}</AppText>
              <AppText variant="body" color="secondary" style={{ textAlign }}>
                {resolved.vehicle.vehicle_type}
                {resolved.vehicle.make ? ` - ${resolved.vehicle.make}` : ''}
                {`  -  ${t('scanner.site')}: ${resolved.vehicle.site}`}
              </AppText>
              <Button
                label={t('scanner.startInspection')}
                icon="clipboard-outline"
                variant="primary"
                full
                style={styles.action}
                onPress={() => go(inspectionForVehicle(resolved.vehicle))}
              />
              <Button
                label={t('scanner.tyreChange')}
                icon="sync-outline"
                variant="secondary"
                full
                onPress={() => go(tyreChangeForVehicle(resolved.vehicle))}
              />
              <Button
                label={t('scanner.viewInFleet')}
                icon="bus-outline"
                variant="ghost"
                full
                onPress={() => go(viewAssetRoute(resolved.vehicle))}
              />
            </>
          )}

          {resolved.kind === 'tyre' && (
            <>
              <View style={[styles.sheetHeader, isRTL && styles.rowRTL]}>
                <View style={[styles.resultBadge, { backgroundColor: theme.tint.green.bg }]}>
                  <Ionicons name="ellipse-outline" size={20} color={theme.tint.green.fg} />
                </View>
                <AppText variant="label" color="secondary" style={[styles.resultTitle, { textAlign }]}>
                  {t('scanner.tyreFound')}
                </AppText>
              </View>
              <AppText variant="h1" style={{ textAlign }}>{resolved.code}</AppText>
              <View style={styles.detailGrid}>
                <Detail label={t('scanner.brand')} value={resolved.tyre.brand} align={textAlign} />
                <Detail label={t('scanner.size')} value={resolved.tyre.size} align={textAlign} />
                <Detail
                  label={t('scanner.position')}
                  value={resolved.tyre.tyre_position ?? resolved.tyre.position}
                  align={textAlign}
                />
                <Detail label={t('scanner.asset')} value={resolved.tyre.asset_no} align={textAlign} />
                <Detail label={t('scanner.site')} value={resolved.tyre.site} align={textAlign} />
                <Detail
                  label={t('scanner.lastReading')}
                  value={
                    resolved.tyre.tread_depth != null
                      ? `${resolved.tyre.tread_depth} mm`
                      : resolved.tyre.pressure_reading != null
                      ? `${resolved.tyre.pressure_reading} PSI`
                      : null
                  }
                  align={textAlign}
                />
              </View>
              {resolved.tyre.asset_no ? (
                <>
                  <Button
                    label={t('scanner.inspectThisTyre')}
                    icon="clipboard-outline"
                    variant="primary"
                    full
                    style={styles.action}
                    onPress={() => go(inspectionForTyre(resolved.tyre, resolved.code))}
                  />
                  <Button
                    label={t('scanner.tyreChange')}
                    icon="sync-outline"
                    variant="secondary"
                    full
                    onPress={() => go(tyreChangeForTyre(resolved.tyre))}
                  />
                </>
              ) : (
                <Button
                  label={t('scanner.openSerialSearch')}
                  icon="search-outline"
                  variant="secondary"
                  full
                  style={styles.action}
                  onPress={() => go(manualSearchRoute(resolved.code))}
                />
              )}
            </>
          )}

          {resolved.kind === 'none' && (
            <>
              <View style={[styles.sheetHeader, isRTL && styles.rowRTL]}>
                <View style={[styles.resultBadge, { backgroundColor: theme.tint.amber.bg }]}>
                  <Ionicons name="help-circle-outline" size={20} color={theme.tint.amber.fg} />
                </View>
                <AppText variant="label" color="secondary" style={[styles.resultTitle, { textAlign }]}>
                  {t('scanner.noMatch')}
                </AppText>
              </View>
              <AppText variant="micro" color="muted" style={[styles.detailLabel, { textAlign }]}>
                {t('scanner.scanned')}
              </AppText>
              <AppText variant="h1" style={{ textAlign }}>{resolved.code || '-'}</AppText>
              <AppText variant="body" color="secondary" style={{ textAlign }}>
                {t('scanner.noMatchHint')}
              </AppText>
              {resolved.code ? (
                <Button
                  label={t('scanner.searchManually')}
                  icon="search-outline"
                  variant="primary"
                  full
                  style={styles.action}
                  onPress={() => go(manualSearchRoute(resolved.code))}
                />
              ) : null}
            </>
          )}

          <Button
            label={t('scanner.scanAgain')}
            icon="scan-outline"
            variant="secondary"
            full
            onPress={reset}
          />
        </View>
      )}
    </View>
  )
}

function Detail({ label, value, align }: { label: string; value: string | null; align: 'left' | 'right' }) {
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  return (
    <View style={styles.detailItem}>
      <AppText variant="micro" color="muted" style={[styles.detailLabel, { textAlign: align }]}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={{ textAlign: align }}>{value || '-'}</AppText>
    </View>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing['2xl'] },
    cameraRoot: { flex: 1, backgroundColor: '#000000' },

    nav: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    },
    navRTL: { flexDirection: 'row-reverse' },
    rowRTL: { flexDirection: 'row-reverse' },
    navBack: {
      width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },
    // Over the live camera feed - stays translucent-dark for legibility.
    navBackDark: {
      width: 40, height: 40, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center', justifyContent: 'center',
    },
    navTitleDark: { ...typography.title, color: '#FFFFFF' },
    overlayTop: { position: 'absolute', top: 0, left: 0, right: 0 },
    overlayBottom: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      alignItems: 'center', paddingBottom: spacing.xl,
    },
    manualBtn: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.lg,
      paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
      borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    },
    manualBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

    frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    frame: { width: 250, height: 250, position: 'relative' },
    corner: { position: 'absolute', width: 36, height: 36, borderColor: c.primary },
    cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
    cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
    cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
    cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
    frameHint: {
      color: '#FFFFFF', fontSize: 14, fontWeight: '500', textAlign: 'center',
      marginTop: spacing['2xl'], maxWidth: 280, lineHeight: 20,
      textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6,
    },

    centerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
    searchingText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },

    sheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: c.surface, borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'],
      padding: spacing['2xl'], paddingBottom: Platform.OS === 'ios' ? spacing['4xl'] : spacing['3xl'],
      gap: spacing.lg, borderTopWidth: 1, borderColor: c.border,
      ...elevation(theme, 3),
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    resultBadge: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
    resultTitle: { flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
    action: { marginTop: spacing.xs },

    detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    detailItem: {
      width: '47%', backgroundColor: c.surfaceAlt, borderRadius: radius.sm, padding: spacing.md,
      borderWidth: 1, borderColor: c.border, gap: 2,
    },
    detailLabel: { textTransform: 'uppercase', letterSpacing: 0.4 },
  })
}
