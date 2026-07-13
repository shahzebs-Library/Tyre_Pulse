import { useState, useCallback, useRef } from 'react'
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
import { lookupTyreBySerial, TyreLookupRecord } from '../../lib/tyreLookup'
import { lookupAssetByCode, extractScanCode, AssetLookupRecord } from '../../lib/assetLookup'

type ScanState = 'scanning' | 'searching' | 'result'

type Resolved =
  | { kind: 'vehicle'; code: string; vehicle: AssetLookupRecord }
  | { kind: 'tyre'; code: string; tyre: TyreLookupRecord }
  | { kind: 'none'; code: string }

export default function ScannerScreen() {
  const router = useRouter()
  const { t, isRTL } = useLanguage()
  const [permission, requestPermission] = useCameraPermissions()

  const [state, setState] = useState<ScanState>('scanning')
  const [torch, setTorch] = useState(false)
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const lockRef = useRef(false)

  const textAlign = isRTL ? 'right' : 'left'
  const backIcon = isRTL ? 'arrow-forward' : 'arrow-back'

  const resolveCode = useCallback(async (raw: string) => {
    // Asset codes may arrive wrapped in a URL/JSON label; extract the code.
    const code = extractScanCode(raw)
    if (!code) { reset(); return }

    // 1) Asset / vehicle match (forgiving: exact → case-insensitive → fleet_number)
    const vehicle = await lookupAssetByCode(raw)
    if (vehicle) {
      setResolved({ kind: 'vehicle', code: vehicle.asset_no || code, vehicle })
      setState('result')
      return
    }

    // 2) Tyre serial match (shared resolver - serials span several columns)
    const tyre = await lookupTyreBySerial(code)
    if (tyre) {
      setResolved({ kind: 'tyre', code, tyre })
      setState('result')
      return
    }

    setResolved({ kind: 'none', code })
    setState('result')
  }, [])

  const onBarcodeScanned = useCallback((res: BarcodeScanningResult) => {
    if (lockRef.current || state !== 'scanning') return
    lockRef.current = true
    setState('searching')
    resolveCode(res.data).catch(() => {
      setResolved({ kind: 'none', code: extractScanCode(res.data) })
      setState('result')
    })
  }, [state, resolveCode])

  function reset() {
    setResolved(null)
    lockRef.current = false
    setState('scanning')
  }

  function startInspectionForVehicle(v: AssetLookupRecord) {
    router.replace({
      pathname: '/(app)/inspection/new',
      params: { site: v.site, asset: v.asset_no },
    })
  }

  // Scanned a tyre serial → jump straight into the inspection for its vehicle,
  // pre-filling the matching position's serial and opening its detail popup.
  function startInspectionForTyre(tyre: TyreLookupRecord, code: string) {
    router.replace({
      pathname: '/(app)/inspection/new',
      params: {
        site: tyre.site ?? '',
        asset: tyre.asset_no ?? '',
        tyreSerial: code,
        tyrePosition: tyre.tyre_position ?? tyre.position ?? '',
      },
    })
  }

  // ── Permission gates ───────────────────────────────────────────────────────
  if (!permission) {
    return (
      <SafeAreaView style={styles.safeDark}>
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    )
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safeLight}>
        <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
        <View style={[styles.nav, isRTL && styles.navRTL]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={backIcon} size={22} color="#0f172a" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>{t('scanner.title')}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.permissionBox}>
          <View style={styles.permissionIcon}>
            <Ionicons name="camera-outline" size={40} color="#16a34a" />
          </View>
          <Text style={styles.permissionTitle}>{t('scanner.permissionTitle')}</Text>
          <Text style={styles.permissionMessage}>{t('scanner.permissionMessage')}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
            <Ionicons name="lock-open-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>{t('scanner.grantPermission')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  // ── Camera + overlay ───────────────────────────────────────────────────────
  return (
    <View style={styles.cameraRoot}>
      <StatusBar barStyle="light-content" />
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{
          barcodeTypes: [
            'qr', 'code128', 'code39', 'code93', 'ean13', 'ean8',
            'upc_a', 'upc_e', 'itf14', 'datamatrix', 'pdf417', 'aztec',
          ],
        }}
        onBarcodeScanned={state === 'scanning' ? onBarcodeScanned : undefined}
      />

      {/* Top bar */}
      <SafeAreaView style={styles.overlayTop} edges={['top']}>
        <View style={[styles.nav, isRTL && styles.navRTL]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBackDark}>
            <Ionicons name={backIcon} size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.navTitleDark}>{t('scanner.title')}</Text>
          <TouchableOpacity onPress={() => setTorch(v => !v)} style={styles.navBackDark}>
            <Ionicons name={torch ? 'flash' : 'flash-off'} size={20} color="#fff" />
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

      {/* Searching */}
      {state === 'searching' && (
        <View style={styles.centerOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.searchingText}>{t('scanner.searching')}</Text>
        </View>
      )}

      {/* Result sheet */}
      {state === 'result' && resolved && (
        <View style={styles.sheet}>
          {resolved.kind === 'vehicle' && (
            <>
              <View style={[styles.sheetHeader, isRTL && styles.rowRTL]}>
                <View style={[styles.resultBadge, { backgroundColor: 'rgba(22,163,74,0.12)' }]}>
                  <Ionicons name="bus" size={20} color="#16a34a" />
                </View>
                <Text style={[styles.resultTitle, { textAlign }]}>{t('scanner.vehicleFound')}</Text>
              </View>
              <Text style={[styles.resultAsset, { textAlign }]}>{resolved.vehicle.asset_no}</Text>
              <Text style={[styles.resultMeta, { textAlign }]}>
                {resolved.vehicle.vehicle_type}
                {resolved.vehicle.make ? ` · ${resolved.vehicle.make}` : ''}
                {`  ·  ${t('scanner.site')}: ${resolved.vehicle.site}`}
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => startInspectionForVehicle(resolved.vehicle)}
              >
                <Ionicons name="clipboard-outline" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>{t('scanner.startInspection')}</Text>
              </TouchableOpacity>
            </>
          )}

          {resolved.kind === 'tyre' && (
            <>
              <View style={[styles.sheetHeader, isRTL && styles.rowRTL]}>
                <View style={[styles.resultBadge, { backgroundColor: 'rgba(22,163,74,0.12)' }]}>
                  <Ionicons name="ellipse-outline" size={20} color="#16a34a" />
                </View>
                <Text style={[styles.resultTitle, { textAlign }]}>{t('scanner.tyreFound')}</Text>
              </View>
              <Text style={[styles.resultAsset, { textAlign }]}>{resolved.code}</Text>
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
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => startInspectionForTyre(resolved.tyre, resolved.code)}
                >
                  <Ionicons name="clipboard-outline" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>{t('scanner.inspectThisTyre')}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}

          {resolved.kind === 'none' && (
            <>
              <View style={[styles.sheetHeader, isRTL && styles.rowRTL]}>
                <View style={[styles.resultBadge, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
                  <Ionicons name="help-circle-outline" size={20} color="#f59e0b" />
                </View>
                <Text style={[styles.resultTitle, { textAlign }]}>{t('scanner.noMatch')}</Text>
              </View>
              <Text style={[styles.resultAsset, { textAlign }]}>{resolved.code}</Text>
              <Text style={[styles.resultMeta, { textAlign }]}>{t('scanner.noMatchHint')}</Text>
            </>
          )}

          <TouchableOpacity style={styles.outlineBtn} onPress={reset}>
            <Ionicons name="scan-outline" size={18} color="#16a34a" />
            <Text style={styles.outlineBtnText}>{t('scanner.scanAgain')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

function Detail({ label, value, align }: { label: string; value: string | null; align: 'left' | 'right' }) {
  return (
    <View style={styles.detailItem}>
      <Text style={[styles.detailLabel, { textAlign: align }]}>{label}</Text>
      <Text style={[styles.detailValue, { textAlign: align }]}>{value || '-'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safeDark: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  safeLight: { flex: 1, backgroundColor: '#f0f5f1' },
  cameraRoot: { flex: 1, backgroundColor: '#000' },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  navRTL: { flexDirection: 'row-reverse' },
  rowRTL: { flexDirection: 'row-reverse' },
  navBack: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  navBackDark: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  navTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  navTitleDark: { fontSize: 16, fontWeight: '700', color: '#fff' },
  overlayTop: { position: 'absolute', top: 0, left: 0, right: 0 },

  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 250, height: 250, position: 'relative' },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: '#16a34a' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  frameHint: {
    color: '#fff', fontSize: 14, fontWeight: '500', textAlign: 'center',
    marginTop: 24, maxWidth: 280, lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6,
  },

  centerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12 },
  searchingText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 28, gap: 14,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultBadge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  resultAsset: { fontSize: 24, fontWeight: '800', color: '#0f172a' },
  resultMeta: { fontSize: 14, color: '#64748b', lineHeight: 20 },

  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  detailItem: {
    width: '47%', backgroundColor: '#f8fafc', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#e2e8f0', gap: 2,
  },
  detailLabel: { fontSize: 10, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 },
  detailValue: { fontSize: 14, fontWeight: '600', color: '#0f172a' },

  permissionBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  permissionIcon: {
    width: 80, height: 80, borderRadius: 24, backgroundColor: 'rgba(22,163,74,0.1)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  permissionTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  permissionMessage: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20, maxWidth: 280 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#16a34a', borderRadius: 14, height: 52, marginTop: 6, alignSelf: 'stretch',
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#16a34a', borderRadius: 14, height: 50,
  },
  outlineBtnText: { color: '#16a34a', fontSize: 15, fontWeight: '700' },
})
