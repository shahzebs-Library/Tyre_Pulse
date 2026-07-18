import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  View, FlatList, StyleSheet, TouchableOpacity, Modal, TextInput,
  RefreshControl, ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'
import { saveCommand } from '../../lib/recordQueue'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useRealtime } from '../../hooks/useRealtime'
import { useRoleGuard } from '../../hooks/useRoleGuard'
import { canDoRca } from '../../lib/permissions'
import { spacing, radius, typography, Theme } from '../../lib/theme'
import { Screen, AppText, EmptyState, Loading } from '../../components/ui'
import PhotoCapture from '../../components/PhotoCapture'

interface Rca {
  id: string
  asset_no: string | null
  tyre_serial: string | null
  brand: string | null
  site: string | null
  failure_date: string | null
  km_at_failure: number | null
  root_cause: string | null
  contributing_factors: string[] | null
  created_at: string | null
}

const FACTORS = [
  'Under-inflation', 'Over-inflation', 'Overload', 'Misalignment',
  'Road hazard', 'Manufacturing defect', 'Driver behaviour', 'Worn out', 'Brake issue',
]

export default function RcaScreen() {
  const { profile } = useAuth()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const c = theme.color
  const params = useLocalSearchParams<{ asset?: string; site?: string; serial?: string; brand?: string }>()
  const [rows, setRows] = useState<Rca[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // form
  const [asset, setAsset] = useState(params.asset ?? '')
  const [serial, setSerial] = useState(params.serial ?? '')
  const [brand, setBrand] = useState(params.brand ?? '')
  const [site, setSite] = useState(params.site ?? profile?.site ?? '')
  const [km, setKm] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [factors, setFactors] = useState<string[]>([])
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const { allowed } = useRoleGuard(['inspector', 'admin', 'manager', 'director'])
  const textAlign = isRTL ? 'right' : 'left'
  const mayCreate = canDoRca(profile?.role)

  const load = useCallback(async () => {
    let q = supabase
      .from('rca_records')
      .select('id,asset_no,tyre_serial,brand,site,failure_date,km_at_failure,root_cause,contributing_factors,created_at')
      .order('created_at', { ascending: false })
      .limit(300)
    if (profile?.country) q = q.or(`country.eq.${profile.country},country.is.null`)
    const { data } = await q
    setRows((data as Rca[]) ?? [])
    setLoading(false)
  }, [profile?.country])

  useEffect(() => { load() }, [load])
  useRealtime('rca_records', load)
  useEffect(() => { if (params.asset || params.serial) setShowForm(true) }, [params.asset, params.serial])

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false) }

  function toggleFactor(f: string) {
    setFactors(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  async function create() {
    if (saving) return
    if (!rootCause.trim()) { Alert.alert(t('modules.rca.missingCause')); return }
    setSaving(true)
    const res = await saveCommand('RCA', {
      asset_no: asset.trim() || null,
      tyre_serial: serial.trim() || null,
      brand: brand.trim() || null,
      site: site.trim() || null,
      failure_date: new Date().toISOString().split('T')[0],
      km_at_failure: km ? Number(km) : null,
      root_cause: rootCause.trim(),
      contributing_factors: factors.length ? factors : null,
      photos: photos.filter(Boolean).length ? photos.filter(Boolean) : null,
      country: profile?.country ?? null,
      created_by: profile?.id ?? null,
    })
    setSaving(false)
    if (res.offline) Alert.alert(t('modules.common.offlineSaved'))
    setShowForm(false); setRootCause(''); setFactors([]); setKm(''); setSerial(''); setPhotos([])
    load()
  }

  if (!allowed) return null

  return (
    <Screen>
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={c.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <AppText variant="h2" style={{ textAlign }}>{t('modules.rca.title')}</AppText>
          <AppText variant="caption" color="secondary" style={{ textAlign, marginTop: 2 }}>{rows.length} {t('modules.rca.records')}</AppText>
        </View>
        {mayCreate && (
          <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)}>
            <Ionicons name="add" size={20} color={c.onPrimary} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <Loading />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
          ListEmptyComponent={<EmptyState icon="search-outline" title={t('modules.rca.none')} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.rcaIcon}><Ionicons name="git-network-outline" size={18} color={theme.tint.violet.fg} /></View>
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="bodyStrong" style={{ textAlign }}>{item.asset_no ?? t('modules.rca.unknown')}{item.brand ? ` · ${item.brand}` : ''}</AppText>
                <AppText variant="caption" color="secondary" style={{ textAlign }} numberOfLines={3}>{item.root_cause}</AppText>
                <View style={[styles.badges, isRTL && styles.rowR]}>
                  {(item.contributing_factors ?? []).slice(0, 3).map(f => (
                    <View key={f} style={styles.factorBadge}><AppText style={[typography.micro, { color: theme.tint.violet.fg }]}>{f}</AppText></View>
                  ))}
                </View>
                <AppText variant="micro" color="muted" style={{ textAlign }}>
                  {[item.site, item.failure_date, item.km_at_failure != null ? `${item.km_at_failure} km` : null].filter(Boolean).join(' · ')}
                </AppText>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView style={styles.modalWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={[styles.sheetHead, isRTL && styles.rowR]}>
              <AppText variant="h3">{t('modules.rca.new')}</AppText>
              <TouchableOpacity onPress={() => setShowForm(false)}><Ionicons name="close" size={24} color={c.textSecondary} /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <AppText style={styles.label}>{t('modules.common.asset')}</AppText>
                  <TextInput style={styles.input} placeholder="TM-001" placeholderTextColor={c.textMuted} value={asset} onChangeText={setAsset} autoCapitalize="characters" />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText style={styles.label}>{t('modules.common.serial')}</AppText>
                  <TextInput style={styles.input} placeholder={t('modules.rca.serialPh')} placeholderTextColor={c.textMuted} value={serial} onChangeText={setSerial} autoCapitalize="characters" />
                </View>
              </View>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <AppText style={styles.label}>{t('modules.common.brand')}</AppText>
                  <TextInput style={styles.input} placeholder={t('modules.rca.brandPh')} placeholderTextColor={c.textMuted} value={brand} onChangeText={setBrand} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText style={styles.label}>{t('modules.rca.kmFailure')}</AppText>
                  <TextInput style={styles.input} placeholder={t('modules.rca.kmPh')} placeholderTextColor={c.textMuted} value={km} onChangeText={setKm} keyboardType="numeric" />
                </View>
              </View>
              <AppText style={styles.label}>{t('modules.rca.factors')}</AppText>
              <View style={styles.chipRow}>
                {FACTORS.map(f => (
                  <TouchableOpacity key={f} style={[styles.chip, factors.includes(f) && styles.chipActive]} onPress={() => toggleFactor(f)}>
                    <AppText style={[typography.caption, factors.includes(f) ? styles.chipTextActive : styles.chipText]}>{t(`modules.factors.${f}`)}</AppText>
                  </TouchableOpacity>
                ))}
              </View>
              <AppText style={styles.label}>{t('modules.rca.rootCause')}</AppText>
              <TextInput style={[styles.input, styles.textarea]} placeholder={t('modules.rca.rootCausePh')} placeholderTextColor={c.textMuted} value={rootCause} onChangeText={setRootCause} multiline />
              <AppText style={styles.label}>{t('modules.common.photos')}</AppText>
              <PhotoCapture value={photos} onChange={setPhotos} module="rca" tint={theme.tint.violet.fg} />
              <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={create} disabled={saving}>
                {saving ? <Ionicons name="ellipsis-horizontal" size={20} color={c.onPrimary} /> : <AppText style={[typography.title, { color: c.onPrimary }]}>{t('modules.rca.save')}</AppText>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    rowR: { flexDirection: 'row-reverse' },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
    backBtn: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    newBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
    list: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing['4xl'] },
    card: { flexDirection: 'row', gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
    rcaIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: theme.tint.violet.bg, alignItems: 'center', justifyContent: 'center' },
    badges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    factorBadge: { backgroundColor: theme.tint.violet.bg, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2 },
    modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
    sheet: { backgroundColor: c.bg, borderTopLeftRadius: radius['2xl'], borderTopRightRadius: radius['2xl'], padding: spacing.lg, maxHeight: '90%' },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    label: { ...typography.label, color: c.textSecondary, marginTop: spacing.md, marginBottom: spacing.sm },
    input: { backgroundColor: c.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 14, color: c.text, borderWidth: 1, borderColor: c.border },
    textarea: { minHeight: 90, textAlignVertical: 'top' },
    row2: { flexDirection: 'row', gap: spacing.sm },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { color: c.textSecondary },
    chipTextActive: { color: c.onPrimary },
    submit: { backgroundColor: c.primary, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.md },
  })
}
