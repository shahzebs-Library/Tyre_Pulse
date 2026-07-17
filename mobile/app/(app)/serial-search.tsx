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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useLanguage } from '../../contexts/LanguageContext'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { lookupTyreBySerial, sanitizeSerial, TyreLookupRecord } from '../../lib/tyreLookup'
import { extractScanCode } from '../../lib/assetLookup'

type SearchState = 'idle' | 'searching' | 'found' | 'empty' | 'error'

export default function SerialSearchScreen() {
  const router = useRouter()
  const { t, isRTL } = useLanguage()
  const { allowed } = useRoleGuard(['inspector', 'tyre_man', 'admin', 'manager', 'director'])
  // Prefill from a scan handoff (scanner "Search manually" passes ?q=<code>).
  const params = useLocalSearchParams<{ q?: string }>()

  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>('idle')
  const [tyre, setTyre] = useState<TyreLookupRecord | null>(null)
  // The exact serial that produced the current result — passed on to inspection.
  const [resolvedCode, setResolvedCode] = useState('')

  const textAlign = isRTL ? 'right' : 'left'
  const backIcon = isRTL ? 'arrow-forward' : 'arrow-back'

  const runSearch = useCallback(async (override?: string) => {
    // Unwrap URL/QR/JSON payloads, then keep only safe serial chars.
    const code = sanitizeSerial(extractScanCode(override ?? query))
    if (!code) return
    setState('searching')
    setTyre(null)
    setResolvedCode(code)
    try {
      const found = await lookupTyreBySerial(code)
      if (found) {
        setTyre(found)
        setState('found')
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
    setResolvedCode('')
    setState('idle')
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
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
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
              <Text style={[styles.resultSerial, { textAlign }]}>{resolvedCode}</Text>

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
})
