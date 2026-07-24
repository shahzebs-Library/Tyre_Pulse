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
import { useAuth } from '../../contexts/AuthContext'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { isAdmin } from '../../lib/types'
import { lookupTyreBySerial, sanitizeSerial, TyreLookupRecord } from '../../lib/tyreLookup'
import { extractScanCode } from '../../lib/assetLookup'
import { scrapTyreBySerial, unscrapTyreBySerial, getScrapMark, ScrapMark } from '../../lib/tyreScrap'
import { toUserMessage } from '../../lib/safeError'

type SearchState = 'idle' | 'searching' | 'found' | 'empty' | 'error'

import { withModuleGuard } from '../../components/ModuleGuard'

export default withModuleGuard(SerialSearchScreen, 'serial')

function SerialSearchScreen() {
  const router = useRouter()
  const { t, isRTL } = useLanguage()
  const { profile, isSuperAdmin } = useAuth()
  const { allowed } = useRoleGuard(['inspector', 'tyre_man', 'admin', 'manager', 'director'])
  // Only Admin / super-admin may mark or undo a scrap (mirrors the web gate).
  const canScrap = isAdmin(profile?.role) || isSuperAdmin === true
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
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Nav header */}
        <View style={[styles.nav, isRTL && styles.rowR]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name={backIcon} size={22} color="#0f172a" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.navTitle, { textAlign }]}>{t('modules.serialSearch.title')}</Text>
            <Text style={[styles.navSub, { textAlign }]}>{t('modules.serialSearch.subtitle')}</Text>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Search box */}
          <View style={styles.card}>
            <Text style={[styles.label, { textAlign }]}>{t('modules.serialSearch.label')}</Text>
            <View style={[styles.searchRow, isRTL && styles.rowR]}>
              <View style={[styles.inputWrap, isRTL && styles.rowR]}>
                <Ionicons name="barcode-outline" size={18} color="#94a3b8" />
                <TextInput
                  style={[styles.input, { textAlign }]}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('modules.serialSearch.placeholder')}
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={() => runSearch()}
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={clearSearch} hitSlop={8}>
                    <Ionicons name="close-circle-outline" size={18} color="#94a3b8" />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={[styles.searchBtn, !canSearch && styles.searchBtnDisabled]}
                onPress={() => runSearch()}
                disabled={!canSearch}
                activeOpacity={0.88}
              >
                {state === 'searching' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="search-outline" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
            <Text style={[styles.help, { textAlign }]}>
              {t('modules.serialSearch.help')}
            </Text>
          </View>

          {/* Searching */}
          {state === 'searching' && (
            <View style={styles.stateBox}>
              <ActivityIndicator size="large" color="#16a34a" />
              <Text style={styles.stateText}>{t('modules.serialSearch.searching')}</Text>
            </View>
          )}

          {/* Result card */}
          {state === 'found' && tyre && (
            <View style={styles.resultCard}>
              <View style={[styles.resultHeader, isRTL && styles.rowR]}>
                <View style={styles.resultBadge}>
                  <Ionicons name="ellipse-outline" size={20} color="#16a34a" />
                </View>
                <Text style={[styles.resultKicker, { textAlign }]}>{t('modules.serialSearch.found')}</Text>
              </View>
              <View style={[styles.serialRow, isRTL && styles.rowR]}>
                <Text style={[styles.resultSerial, { textAlign }]}>{resolvedCode}</Text>
                {scrapMark && (
                  <View style={styles.scrapBadge}>
                    <Ionicons name="ban-outline" size={13} color="#dc2626" />
                    <Text style={styles.scrapBadgeText}>{t('modules.serialSearch.scrappedBadge')}</Text>
                  </View>
                )}
              </View>

              {scrapMark?.reason ? (
                <Text style={[styles.scrapReasonText, { textAlign }]}>
                  {t('modules.serialSearch.scrapReasonLabel')}: {scrapMark.reason}
                </Text>
              ) : null}

              <View style={styles.detailGrid}>
                <Detail label={t('modules.serialSearch.brand')} value={tyre.brand} align={textAlign} />
                <Detail label={t('modules.serialSearch.size')} value={tyre.size} align={textAlign} />
                <Detail label={t('modules.serialSearch.position')} value={tyre.tyre_position ?? tyre.position} align={textAlign} />
                <Detail label={t('modules.serialSearch.asset')} value={tyre.asset_no} align={textAlign} />
                <Detail label={t('modules.serialSearch.site')} value={tyre.site} align={textAlign} />
                <Detail label={t('modules.serialSearch.lastReading')} value={lastReading} align={textAlign} />
              </View>

              {tyre.asset_no ? (
                <TouchableOpacity style={styles.primaryBtn} onPress={() => inspectThisTyre(tyre)} activeOpacity={0.88}>
                  <Ionicons name="clipboard-outline" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>{t('modules.serialSearch.inspectThis')}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.noAssetNote}>
                  <Ionicons name="alert-circle-outline" size={16} color="#b45309" />
                  <Text style={[styles.noAssetText, { textAlign }]}>
                    {t('modules.serialSearch.noAssetNote')}
                  </Text>
                </View>
              )}

              {/* Scrap controls — Admin / super-admin only */}
              {canScrap && (
                scrapMark ? (
                  <TouchableOpacity
                    style={styles.undoBtn}
                    onPress={undoScrap}
                    disabled={scrapBusy}
                    activeOpacity={0.88}
                  >
                    {scrapBusy ? (
                      <ActivityIndicator size="small" color="#dc2626" />
                    ) : (
                      <Ionicons name="arrow-undo-outline" size={18} color="#dc2626" />
                    )}
                    <Text style={styles.undoBtnText}>{t('modules.serialSearch.undoScrap')}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.scrapBtn}
                    onPress={() => { setScrapReason(''); setScrapModal(true) }}
                    disabled={scrapBusy}
                    activeOpacity={0.88}
                  >
                    <Ionicons name="ban-outline" size={18} color="#fff" />
                    <Text style={styles.scrapBtnText}>{t('modules.serialSearch.markScrap')}</Text>
                  </TouchableOpacity>
                )
              )}
            </View>
          )}

          {/* Empty state */}
          {state === 'empty' && (
            <View style={styles.stateBox}>
              <View style={styles.stateIconMuted}>
                <Ionicons name="search-outline" size={28} color="#94a3b8" />
              </View>
              <Text style={styles.stateTitle}>{t('modules.serialSearch.emptyTitle')}</Text>
              <Text style={styles.stateSub}>
                {t('modules.serialSearch.emptySub')}
              </Text>
              <Text style={[styles.stateCode, { textAlign }]}>{resolvedCode}</Text>
            </View>
          )}

          {/* Error state */}
          {state === 'error' && (
            <View style={styles.stateBox}>
              <View style={styles.stateIconError}>
                <Ionicons name="cloud-offline-outline" size={28} color="#dc2626" />
              </View>
              <Text style={styles.stateTitle}>{t('modules.serialSearch.errorTitle')}</Text>
              <Text style={styles.stateSub}>
                {t('modules.serialSearch.errorSub')}
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => runSearch()} activeOpacity={0.88}>
                <Ionicons name="refresh-outline" size={18} color="#16a34a" />
                <Text style={styles.retryBtnText}>{t('modules.serialSearch.retry')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Idle hint */}
          {state === 'idle' && (
            <View style={styles.stateBox}>
              <View style={styles.stateIconMuted}>
                <Ionicons name="cube-outline" size={28} color="#94a3b8" />
              </View>
              <Text style={styles.stateTitle}>{t('modules.serialSearch.idleTitle')}</Text>
              <Text style={styles.stateSub}>
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
          <View style={styles.modalWrap}>
            <View style={styles.modalCard}>
              <View style={[styles.modalHead, isRTL && styles.rowR]}>
                <Text style={[styles.modalTitle, { textAlign }]}>{t('modules.serialSearch.scrapModalTitle')}</Text>
                <TouchableOpacity onPress={() => !scrapBusy && setScrapModal(false)} hitSlop={8}>
                  <Ionicons name="close" size={22} color="#64748b" />
                </TouchableOpacity>
              </View>
              <Text style={[styles.modalSub, { textAlign }]}>{resolvedCode}</Text>
              <Text style={[styles.modalLabel, { textAlign }]}>{t('modules.serialSearch.scrapReasonLabel')}</Text>
              <TextInput
                style={[styles.modalInput, { textAlign }]}
                value={scrapReason}
                onChangeText={setScrapReason}
                placeholder={t('modules.serialSearch.scrapReasonPlaceholder')}
                placeholderTextColor="#94a3b8"
                multiline
              />
              <TouchableOpacity
                style={[styles.scrapBtn, scrapBusy && styles.searchBtnDisabled]}
                onPress={confirmScrap}
                disabled={scrapBusy}
                activeOpacity={0.88}
              >
                {scrapBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="ban-outline" size={18} color="#fff" />
                )}
                <Text style={styles.scrapBtnText}>{t('modules.serialSearch.confirmScrap')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  help: { fontSize: 11.5, color: '#64748b', marginTop: 10, fontWeight: '500' },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 12, height: 50,
  },
  input: { flex: 1, fontSize: 15, fontWeight: '600', color: '#0f172a', letterSpacing: 0.3 },
  searchBtn: {
    width: 50, height: 50, borderRadius: 12, backgroundColor: '#16a34a',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  searchBtnDisabled: { opacity: 0.5 },

  stateBox: {
    backgroundColor: '#fff', borderRadius: 14, padding: 24, alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  stateText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  stateIconMuted: {
    width: 60, height: 60, borderRadius: 18, backgroundColor: '#f1f5f9',
    alignItems: 'center', justifyContent: 'center',
  },
  stateIconError: {
    width: 60, height: 60, borderRadius: 18, backgroundColor: '#fef2f2',
    alignItems: 'center', justifyContent: 'center',
  },
  stateTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  stateSub: { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 19, maxWidth: 280 },
  stateCode: {
    fontSize: 13, fontWeight: '700', color: '#0f172a', marginTop: 2,
    backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },

  resultCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultBadge: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(22,163,74,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  resultKicker: { flex: 1, fontSize: 13, fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  resultSerial: { fontSize: 24, fontWeight: '800', color: '#0f172a' },

  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  detailItem: {
    width: '47%', backgroundColor: '#f8fafc', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#e2e8f0', gap: 2,
  },
  detailLabel: { fontSize: 10, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 },
  detailValue: { fontSize: 14, fontWeight: '600', color: '#0f172a' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#16a34a', borderRadius: 14, height: 52, alignSelf: 'stretch',
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  noAssetNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#fffbeb', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(180,83,9,0.2)',
  },
  noAssetText: { flex: 1, fontSize: 12.5, color: '#92400e', lineHeight: 18, fontWeight: '600' },

  retryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#16a34a', borderRadius: 14, height: 48, paddingHorizontal: 24, marginTop: 4,
  },
  retryBtnText: { color: '#16a34a', fontSize: 15, fontWeight: '700' },

  serialRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  scrapBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fef2f2', borderWidth: 1, borderColor: 'rgba(220,38,38,0.25)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  scrapBadgeText: { fontSize: 11, fontWeight: '800', color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.4 },
  scrapReasonText: { fontSize: 12.5, color: '#64748b', fontWeight: '600' },

  scrapBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#dc2626', borderRadius: 14, height: 52, alignSelf: 'stretch',
    shadowColor: '#dc2626', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  scrapBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  undoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#dc2626', borderRadius: 14, height: 50, alignSelf: 'stretch',
  },
  undoBtnText: { color: '#dc2626', fontSize: 15, fontWeight: '700' },

  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 32, gap: 10,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#0f172a' },
  modalSub: {
    fontSize: 13, fontWeight: '700', color: '#0f172a',
    backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start',
  },
  modalLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginTop: 4 },
  modalInput: {
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12,
    padding: 12, fontSize: 15, color: '#0f172a', minHeight: 80, textAlignVertical: 'top', marginBottom: 4,
  },
})
