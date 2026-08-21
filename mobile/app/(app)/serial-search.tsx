/**
 * Serial No. Search — find a tyre by its serial number
 *
 * A field user types or pastes a tyre serial (bare, or wrapped in a scanned
 * URL/QR/JSON payload) and resolves it to the canonical tyre record via the
 * shared resolver used by the scanner and inspection popup. From a match with a
 * known asset the user jumps straight into an inspection, mirroring how the
 * scanner starts one from a scanned tyre. Reads require connectivity — a lookup
 * that throws surfaces a friendly, retryable error rather than a raw failure.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, StatusBar, Platform, KeyboardAvoidingView,
  Modal, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { Theme } from '../../lib/theme'
import { useAuth } from '../../contexts/AuthContext'
import { useModuleGuard } from '../../hooks/useRoleGuard'
import { lookupTyreBySerial, sanitizeSerial, TyreLookupRecord } from '../../lib/tyreLookup'
import { extractScanCode } from '../../lib/assetLookup'
import { scrapTyreBySerial, unscrapTyreBySerial, getScrapMark, canScrapTyre, canUnscrapTyre, ScrapMark } from '../../lib/tyreScrap'
import { toUserMessage } from '../../lib/safeError'

type SearchState = 'idle' | 'searching' | 'found' | 'empty' | 'error'

import { withModuleGuard } from '../../components/ModuleGuard'
import { backTo } from '../../lib/goBack'

export default withModuleGuard(SerialSearchScreen, 'serial')

function SerialSearchScreen() {
  const router = useRouter()
  const { t, isRTL } = useLanguage()
  const { profile, isSuperAdmin } = useAuth()
  const { theme } = useTheme()
  const s = useMemo(() => makeStyles(theme), [theme])
  // Registry-backed guard: reading MODULES.roles directly had two gaps - it
  // omitted admin (a module's `roles` list never includes it) and it could not
  // see a per-user grant, so both were turned away by this screen.
  const { allowed } = useModuleGuard('serial')
  // Both rights are answered by the SERVER, because the phone cannot tell:
  // normaliseRole collapses unknown custom roles to 'reporter', and per-user
  // capability grants are invisible here. Asking the same functions the RPCs
  // enforce keeps each button and its permission in step.
  //
  // Two questions, not one (V383). Marking a scrap reaches the tyre roles
  // including Tyre Data Collector; undoing one is an administrator action. A
  // single flag would have handed the collector both or neither.
  const [canScrap, setCanScrap] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  useEffect(() => {
    let cancelled = false
    canScrapTyre().then((ok) => { if (!cancelled) setCanScrap(ok) })
    canUnscrapTyre().then((ok) => { if (!cancelled) setCanUndo(ok) })
    return () => { cancelled = true }
  }, [profile?.id, isSuperAdmin])
  // Prefill from a scan handoff (scanner "Search manually" passes ?q=<code>).
  const params = useLocalSearchParams<{ q?: string }>()

  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>('idle')
  const [tyre, setTyre] = useState<TyreLookupRecord | null>(null)
  // The exact serial that produced the current result — passed on to inspection.
  const [resolvedCode, setResolvedCode] = useState('')
  // Scrap status for the resolved serial (null = not scrapped).
  const [scrapMark, setScrapMark] = useState<ScrapMark | null>(null)
  const [scrapModal, setScrapModal] = useState(false)
  const [scrapReason, setScrapReason] = useState('')
  const [scrapBusy, setScrapBusy] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'
  const backIcon = isRTL ? 'arrow-forward' : 'arrow-back'

  const runSearch = useCallback(async (override?: string) => {
    // Unwrap URL/QR/JSON payloads, then keep only safe serial chars.
    const code = sanitizeSerial(extractScanCode(override ?? query))
    if (!code) return
    setState('searching')
    setTyre(null)
    setScrapMark(null)
    setResolvedCode(code)
    try {
      const found = await lookupTyreBySerial(code)
      if (found) {
        setTyre(found)
        setState('found')
        // Best-effort scrap-status lookup; a failure never blocks the result.
        try {
          setScrapMark(await getScrapMark(code))
        } catch {
          setScrapMark(null)
        }
      } else {
        setState('empty')
      }
    } catch {
      setState('error')
    }
  }, [query])

  // On arrival with a prefilled code, populate the box and search once.
  const didPrefill = useRef(false)
  useEffect(() => {
    if (didPrefill.current) return
    const q = typeof params.q === 'string' ? params.q : ''
    if (q && sanitizeSerial(extractScanCode(q))) {
      didPrefill.current = true
      setQuery(q)
      runSearch(q)
    }
  }, [params.q, runSearch])

  function clearSearch() {
    setQuery('')
    setTyre(null)
    setScrapMark(null)
    setResolvedCode('')
    setState('idle')
  }

  async function confirmScrap() {
    const s = resolvedCode
    if (!s || scrapBusy) return
    setScrapBusy(true)
    try {
      await scrapTyreBySerial(s, scrapReason.trim() || null)
      setScrapMark(await getScrapMark(s))
      setScrapModal(false)
      setScrapReason('')
    } catch (err: any) {
      Alert.alert(t('modules.serialSearch.scrapErrorTitle'), toUserMessage(err))
    } finally {
      setScrapBusy(false)
    }
  }

  function undoScrap() {
    const s = resolvedCode
    if (!s || scrapBusy) return
    Alert.alert(
      t('modules.serialSearch.undoConfirmTitle'),
      t('modules.serialSearch.undoConfirmBody'),
      [
        { text: t('modules.serialSearch.cancel'), style: 'cancel' },
        {
          text: t('modules.serialSearch.undoScrap'),
          style: 'destructive',
          onPress: async () => {
            setScrapBusy(true)
            try {
              await unscrapTyreBySerial(s)
              setScrapMark(null)
            } catch (err: any) {
              Alert.alert(t('modules.serialSearch.scrapErrorTitle'), toUserMessage(err))
            } finally {
              setScrapBusy(false)
            }
          },
        },
      ],
    )
  }

  function inspectThisTyre(t: TyreLookupRecord) {
    router.replace({
      pathname: '/(app)/inspection/new',
      params: {
        site: t.site ?? '',
        asset: t.asset_no ?? '',
        tyreSerial: resolvedCode,
        tyrePosition: t.tyre_position ?? t.position ?? '',
      },
    })
  }

  if (!allowed) return null

  const canSearch = sanitizeSerial(extractScanCode(query)).length > 0 && state !== 'searching'

  const lastReading =
    tyre?.tread_depth != null
      ? `${tyre.tread_depth} mm`
      : tyre?.pressure_reading != null
      ? `${tyre.pressure_reading} PSI`
      : null

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Nav header */}
        <View style={[s.nav, isRTL && s.rowR]}>
          <TouchableOpacity onPress={() => backTo(router, '/(app)')} style={s.navBack}>
            <Ionicons name={backIcon} size={22} color={theme.mode === 'dark' ? theme.color.text : '#0f172a'} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[s.navTitle, { textAlign }]}>{t('modules.serialSearch.title')}</Text>
            <Text style={[s.navSub, { textAlign }]}>{t('modules.serialSearch.subtitle')}</Text>
          </View>
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Search box */}
          <View style={s.card}>
            <Text style={[s.label, { textAlign }]}>{t('modules.serialSearch.label')}</Text>
            <View style={[s.searchRow, isRTL && s.rowR]}>
              <View style={[s.inputWrap, isRTL && s.rowR]}>
                <Ionicons name="barcode-outline" size={18} color={theme.color.textMuted} />
                <TextInput
                  style={[s.input, { textAlign }]}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('modules.serialSearch.placeholder')}
                  placeholderTextColor={theme.color.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={() => runSearch()}
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={clearSearch} hitSlop={8}>
                    <Ionicons name="close-circle-outline" size={18} color={theme.color.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[s.searchBtn, !canSearch && s.searchBtnDisabled]}
                onPress={() => runSearch()}
                disabled={!canSearch}
                activeOpacity={0.88}
              >
                {state === 'searching' ? (
                  <ActivityIndicator size="small" color={theme.color.onPrimary} />
                ) : (
                  <Ionicons name="search-outline" size={20} color={theme.color.onPrimary} />
                )}
              </TouchableOpacity>
            </View>
            <Text style={[s.help, { textAlign }]}>
              {t('modules.serialSearch.help')}
            </Text>
          </View>

          {/* Searching */}
          {state === 'searching' && (
            <View style={s.stateBox}>
              <ActivityIndicator size="large" color={theme.color.primary} />
              <Text style={s.stateText}>{t('modules.serialSearch.searching')}</Text>
            </View>
          )}

          {/* Result card */}
          {state === 'found' && tyre && (
            <View style={s.resultCard}>
              <View style={[s.resultHeader, isRTL && s.rowR]}>
                <View style={s.resultBadge}>
                  <Ionicons name="ellipse-outline" size={20} color={theme.color.success.base} />
                </View>
                <Text style={[s.resultKicker, { textAlign }]}>{t('modules.serialSearch.found')}</Text>
              </View>
              <View style={[s.serialRow, isRTL && s.rowR]}>
                <Text style={[s.resultSerial, { textAlign }]}>{resolvedCode}</Text>
                {scrapMark && (
                  <View style={s.scrapBadge}>
                    <Ionicons name="ban-outline" size={13} color={theme.color.danger.base} />
                    <Text style={s.scrapBadgeText}>{t('modules.serialSearch.scrappedBadge')}</Text>
                  </View>
                )}
              </View>

              {scrapMark?.reason ? (
                <Text style={[s.scrapReasonText, { textAlign }]}>
                  {t('modules.serialSearch.scrapReasonLabel')}: {scrapMark.reason}
                </Text>
              ) : null}

              <View style={s.detailGrid}>
                <Detail label={t('modules.serialSearch.brand')} value={tyre.brand} align={textAlign} />
                <Detail label={t('modules.serialSearch.size')} value={tyre.size} align={textAlign} />
                <Detail label={t('modules.serialSearch.position')} value={tyre.tyre_position ?? tyre.position} align={textAlign} />
                <Detail label={t('modules.serialSearch.asset')} value={tyre.asset_no} align={textAlign} />
                <Detail label={t('modules.serialSearch.site')} value={tyre.site} align={textAlign} />
                <Detail label={t('modules.serialSearch.lastReading')} value={lastReading} align={textAlign} />
              </View>

              {tyre.asset_no ? (
                <TouchableOpacity style={s.primaryBtn} onPress={() => inspectThisTyre(tyre)} activeOpacity={0.88}>
                  <Ionicons name="clipboard-outline" size={18} color={theme.color.onPrimary} />
                  <Text style={s.primaryBtnText}>{t('modules.serialSearch.inspectThis')}</Text>
                </TouchableOpacity>
              ) : (
                <View style={s.noAssetNote}>
                  <Ionicons name="alert-circle-outline" size={16} color={theme.mode === 'dark' ? theme.color.warning.base : '#b45309'} />
                  <Text style={[s.noAssetText, { textAlign }]}>
                    {t('modules.serialSearch.noAssetNote')}
                  </Text>
                </View>
              )}

              {/* Gated per action by the server: mark for the tyre roles,
                  undo for administrators. */}
              {scrapMark ? (canUndo && (
                <TouchableOpacity
                  style={s.undoBtn}
                  onPress={undoScrap}
                  disabled={scrapBusy}
                  activeOpacity={0.88}
                >
                  {scrapBusy ? (
                    <ActivityIndicator size="small" color={theme.color.danger.base} />
                  ) : (
                    <Ionicons name="arrow-undo-outline" size={18} color={theme.color.danger.base} />
                  )}
                  <Text style={s.undoBtnText}>{t('modules.serialSearch.undoScrap')}</Text>
                </TouchableOpacity>
              )) : (canScrap && (
                <TouchableOpacity
                  style={s.scrapBtn}
                  onPress={() => { setScrapReason(''); setScrapModal(true) }}
                  disabled={scrapBusy}
                  activeOpacity={0.88}
                >
                  <Ionicons name="ban-outline" size={18} color={theme.color.onPrimary} />
                  <Text style={s.scrapBtnText}>{t('modules.serialSearch.markScrap')}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Empty state */}
          {state === 'empty' && (
            <View style={s.stateBox}>
              <View style={s.stateIconMuted}>
                <Ionicons name="search-outline" size={28} color={theme.color.textMuted} />
              </View>
              <Text style={s.stateTitle}>{t('modules.serialSearch.emptyTitle')}</Text>
              <Text style={s.stateSub}>
                {t('modules.serialSearch.emptySub')}
              </Text>
              <Text style={[s.stateCode, { textAlign }]}>{resolvedCode}</Text>
            </View>
          )}

          {/* Error state */}
          {state === 'error' && (
            <View style={s.stateBox}>
              <View style={s.stateIconError}>
                <Ionicons name="cloud-offline-outline" size={28} color={theme.color.danger.base} />
              </View>
              <Text style={s.stateTitle}>{t('modules.serialSearch.errorTitle')}</Text>
              <Text style={s.stateSub}>
                {t('modules.serialSearch.errorSub')}
              </Text>
              <TouchableOpacity style={s.retryBtn} onPress={() => runSearch()} activeOpacity={0.88}>
                <Ionicons name="refresh-outline" size={18} color={theme.color.primary} />
                <Text style={s.retryBtnText}>{t('modules.serialSearch.retry')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Idle hint */}
          {state === 'idle' && (
            <View style={s.stateBox}>
              <View style={s.stateIconMuted}>
                <Ionicons name="cube-outline" size={28} color={theme.color.textMuted} />
              </View>
              <Text style={s.stateTitle}>{t('modules.serialSearch.idleTitle')}</Text>
              <Text style={s.stateSub}>
                {t('modules.serialSearch.idleSub')}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Scrap reason capture (Admin / super-admin) */}
        <Modal
          visible={scrapModal}
          animationType="slide"
          transparent
          onRequestClose={() => !scrapBusy && setScrapModal(false)}
        >
          <View style={s.modalWrap}>
            <View style={s.modalCard}>
              <View style={[s.modalHead, isRTL && s.rowR]}>
                <Text style={[s.modalTitle, { textAlign }]}>{t('modules.serialSearch.scrapModalTitle')}</Text>
                <TouchableOpacity onPress={() => !scrapBusy && setScrapModal(false)} hitSlop={8}>
                  <Ionicons name="close" size={22} color={theme.color.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={[s.modalSub, { textAlign }]}>{resolvedCode}</Text>
              <Text style={[s.modalLabel, { textAlign }]}>{t('modules.serialSearch.scrapReasonLabel')}</Text>
              <TextInput
                style={[s.modalInput, { textAlign }]}
                value={scrapReason}
                onChangeText={setScrapReason}
                placeholder={t('modules.serialSearch.scrapReasonPlaceholder')}
                placeholderTextColor={theme.color.textMuted}
                multiline
              />
              <TouchableOpacity
                style={[s.scrapBtn, scrapBusy && s.searchBtnDisabled]}
                onPress={confirmScrap}
                disabled={scrapBusy}
                activeOpacity={0.88}
              >
                {scrapBusy ? (
                  <ActivityIndicator size="small" color={theme.color.onPrimary} />
                ) : (
                  <Ionicons name="ban-outline" size={18} color={theme.color.onPrimary} />
                )}
                <Text style={s.scrapBtnText}>{t('modules.serialSearch.confirmScrap')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Detail({ label, value, align }: { label: string; value: string | null; align: 'left' | 'right' }) {
  const { theme } = useTheme()
  const s = useMemo(() => makeStyles(theme), [theme])
  return (
    <View style={s.detailItem}>
      <Text style={[s.detailLabel, { textAlign: align }]}>{label}</Text>
      <Text style={[s.detailValue, { textAlign: align }]}>{value || '-'}</Text>
    </View>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.mode === 'dark' ? c.bg : '#f0f5f1' },
    rowR: { flexDirection: 'row-reverse' },

    nav: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12, backgroundColor: theme.mode === 'dark' ? c.surface : '#fff',
      borderBottomWidth: 1, borderBottomColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.07)',
    },
    navBack: {
      width: 36, height: 36, borderRadius: 10, backgroundColor: theme.mode === 'dark' ? c.surfaceAlt : '#f1f5f9',
      alignItems: 'center', justifyContent: 'center',
    },
    navTitle: { fontSize: 16, fontWeight: '700', color: theme.mode === 'dark' ? c.text : '#0f172a' },
    navSub: { fontSize: 11, color: theme.mode === 'dark' ? c.textSecondary : '#64748b', marginTop: 1 },

    scroll: { flex: 1 },
    content: { padding: 16, paddingBottom: 48, gap: 12 },

    card: {
      backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.06)',
    },
    label: { fontSize: 12, fontWeight: '700', color: theme.mode === 'dark' ? c.textSecondary : '#334155', marginBottom: 8 },
    help: { fontSize: 11.5, color: theme.mode === 'dark' ? c.textMuted : '#64748b', marginTop: 10, fontWeight: '500' },

    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    inputWrap: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: theme.mode === 'dark' ? c.surfaceAlt : '#f8fafc', borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : '#e2e8f0',
      borderRadius: 12, paddingHorizontal: 12, height: 50,
    },
    input: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.mode === 'dark' ? c.text : '#0f172a', letterSpacing: 0.3 },
    searchBtn: {
      width: 50, height: 50, borderRadius: 12, backgroundColor: c.primary,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: c.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
    },
    searchBtnDisabled: { opacity: 0.5 },

    stateBox: {
      backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', borderRadius: 14, padding: 24, alignItems: 'center', gap: 10,
      borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.06)',
    },
    stateText: { fontSize: 14, fontWeight: '600', color: theme.mode === 'dark' ? c.textSecondary : '#64748b' },
    stateIconMuted: {
      width: 60, height: 60, borderRadius: 18, backgroundColor: theme.mode === 'dark' ? c.surfaceAlt : '#f1f5f9',
      alignItems: 'center', justifyContent: 'center',
    },
    stateIconError: {
      width: 60, height: 60, borderRadius: 18, backgroundColor: theme.mode === 'dark' ? c.danger.soft : '#fef2f2',
      alignItems: 'center', justifyContent: 'center',
    },
    stateTitle: { fontSize: 16, fontWeight: '800', color: theme.mode === 'dark' ? c.text : '#0f172a', textAlign: 'center' },
    stateSub: { fontSize: 13, color: theme.mode === 'dark' ? c.textSecondary : '#64748b', textAlign: 'center', lineHeight: 19, maxWidth: 280 },
    stateCode: {
      fontSize: 13, fontWeight: '700', color: theme.mode === 'dark' ? c.text : '#0f172a', marginTop: 2,
      backgroundColor: theme.mode === 'dark' ? c.surfaceAlt : '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    },

    resultCard: {
      backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', borderRadius: 14, padding: 16, gap: 14,
      borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : 'rgba(0,0,0,0.06)',
    },
    resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    resultBadge: {
      width: 40, height: 40, borderRadius: 12, backgroundColor: theme.mode === 'dark' ? c.success.soft : 'rgba(22,163,74,0.12)',
      alignItems: 'center', justifyContent: 'center',
    },
    resultKicker: { flex: 1, fontSize: 13, fontWeight: '600', color: theme.mode === 'dark' ? c.textSecondary : '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
    resultSerial: { fontSize: 24, fontWeight: '800', color: theme.mode === 'dark' ? c.text : '#0f172a' },

    detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    detailItem: {
      width: '47%', backgroundColor: theme.mode === 'dark' ? c.surfaceAlt : '#f8fafc', borderRadius: 10, padding: 10,
      borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : '#e2e8f0', gap: 2,
    },
    detailLabel: { fontSize: 10, fontWeight: '600', color: theme.mode === 'dark' ? c.textMuted : '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 },
    detailValue: { fontSize: 14, fontWeight: '600', color: theme.mode === 'dark' ? c.text : '#0f172a' },

    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.primary, borderRadius: 14, height: 52, alignSelf: 'stretch',
      shadowColor: c.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
    },
    primaryBtnText: { color: c.onPrimary, fontSize: 16, fontWeight: '700' },

    noAssetNote: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: theme.mode === 'dark' ? c.warning.soft : '#fffbeb', borderRadius: 12, padding: 12,
      borderWidth: 1, borderColor: theme.mode === 'dark' ? c.warning.base : 'rgba(180,83,9,0.2)',
    },
    noAssetText: { flex: 1, fontSize: 12.5, color: theme.mode === 'dark' ? c.warning.on : '#92400e', lineHeight: 18, fontWeight: '600' },

    retryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderWidth: 1.5, borderColor: c.primary, borderRadius: 14, height: 48, paddingHorizontal: 24, marginTop: 4,
    },
    retryBtnText: { color: c.primary, fontSize: 15, fontWeight: '700' },

    serialRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
    scrapBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: theme.mode === 'dark' ? c.danger.soft : '#fef2f2', borderWidth: 1, borderColor: theme.mode === 'dark' ? c.danger.base : 'rgba(220,38,38,0.25)',
      borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    },
    scrapBadgeText: { fontSize: 11, fontWeight: '800', color: theme.mode === 'dark' ? c.danger.on : '#dc2626', textTransform: 'uppercase', letterSpacing: 0.4 },
    scrapReasonText: { fontSize: 12.5, color: theme.mode === 'dark' ? c.textSecondary : '#64748b', fontWeight: '600' },

    scrapBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: c.danger.base, borderRadius: 14, height: 52, alignSelf: 'stretch',
      shadowColor: c.danger.base, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
    },
    scrapBtnText: { color: c.onPrimary, fontSize: 16, fontWeight: '700' },
    undoBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderWidth: 1.5, borderColor: c.danger.base, borderRadius: 14, height: 50, alignSelf: 'stretch',
    },
    undoBtnText: { color: c.danger.base, fontSize: 15, fontWeight: '700' },

    modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
    modalCard: {
      backgroundColor: theme.mode === 'dark' ? c.surface : '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 20, paddingBottom: 32, gap: 10,
    },
    modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    modalTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: theme.mode === 'dark' ? c.text : '#0f172a' },
    modalSub: {
      fontSize: 13, fontWeight: '700', color: theme.mode === 'dark' ? c.text : '#0f172a',
      backgroundColor: theme.mode === 'dark' ? c.surfaceAlt : '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start',
    },
    modalLabel: { fontSize: 12, fontWeight: '700', color: theme.mode === 'dark' ? c.textSecondary : '#334155', marginTop: 4 },
    modalInput: {
      backgroundColor: theme.mode === 'dark' ? c.surfaceAlt : '#f8fafc', borderWidth: 1, borderColor: theme.mode === 'dark' ? c.border : '#e2e8f0', borderRadius: 12,
      padding: 12, fontSize: 15, color: theme.mode === 'dark' ? c.text : '#0f172a', minHeight: 80, textAlignVertical: 'top', marginBottom: 4,
    },
  })
}
