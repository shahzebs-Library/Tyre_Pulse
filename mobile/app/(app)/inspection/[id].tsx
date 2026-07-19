import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  StatusBar, ActivityIndicator, useWindowDimensions, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../../lib/supabase'
import { toUserMessage } from '../../../lib/safeError'
import { useLanguage } from '../../../contexts/LanguageContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { radius, spacing, typography, elevation, Theme } from '../../../lib/theme'
import VehicleTyreDiagram from '../../../components/VehicleTyreDiagram'
import { getPositionsForVehicle, TyrePositionData } from '../../../lib/types'
import { shareInspectionPdf, conditionColor, conditionLabel } from '../../../lib/inspectionReportPdf'

interface Inspection {
  id: string
  title: string | null
  site: string | null
  asset_no: string | null
  vehicle_type: string | null
  inspector: string | null
  inspection_date: string | null
  status: string | null
  notes: string | null
  locked: boolean | null
  tyre_conditions: Record<string, TyrePositionData> | null
}

export default function InspectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t, isRTL } = useLanguage()
  const { theme } = useTheme()
  const styles = useMemo(() => makeStyles(theme), [theme])
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [insp, setInsp] = useState<Inspection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  const textAlign = isRTL ? 'right' : 'left'

  // Build a PDF of this inspection (asset/site/date/inspector + per-position
  // conditions coloured by condition + notes) and open the device share sheet.
  const sharePdf = useCallback(async () => {
    if (!insp || sharing) return
    setSharing(true)
    try {
      await shareInspectionPdf(insp)
    } catch (e: any) {
      Alert.alert(t('common.shareFailed'), toUserMessage(e, t('common.shareError')))
    } finally {
      setSharing(false)
    }
  }, [insp, sharing])

  // Load guarded end-to-end: a network rejection or query error surfaces a
  // retryable error state instead of spinning forever or crashing.
  const load = useCallback(async () => {
    if (!id) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr } = await supabase.from('inspections')
        .select('id,title,site,asset_no,vehicle_type,inspector,inspection_date,status,notes,locked,tyre_conditions')
        .eq('id', id).single()
      if (qErr) throw qErr
      setInsp((data as Inspection) ?? null)
    } catch (e: any) {
      setInsp(null)
      setError(toUserMessage(e, t('modules.inspectionDetail.loadError')))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const conditions = insp?.tyre_conditions ?? {}
  const positions = insp
    ? (getPositionsForVehicle(insp.vehicle_type ?? '') ?? Object.keys(conditions))
    : []
  const shownPositions = positions.length ? positions : Object.keys(conditions)

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
      />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color={theme.color.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { textAlign }]} numberOfLines={1}>{t('modules.inspectionDetail.title')}</Text>
        {insp && !loading && !error ? (
          <TouchableOpacity
            onPress={sharePdf}
            style={styles.shareBtn}
            disabled={sharing}
            activeOpacity={0.85}
          >
            {sharing
              ? <ActivityIndicator size="small" color={theme.color.onPrimary} />
              : (
                <>
                  <Ionicons name="share-outline" size={16} color={theme.color.onPrimary} />
                  <Text style={styles.shareBtnText}>{t('common.sharePdf')}</Text>
                </>
              )}
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={theme.color.primary} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={48} color={theme.color.danger.base} />
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load} activeOpacity={0.85}>
            <Ionicons name="refresh" size={16} color={theme.color.onPrimary} />
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : !insp ? (
        <View style={styles.empty}>
          <Ionicons name="document-outline" size={48} color={theme.color.borderStrong} />
          <Text style={styles.emptyText}>{t('modules.inspectionDetail.notFound')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={[styles.cardTop, isRTL && styles.rowR]}>
              <Text style={[styles.iTitle, { textAlign }]} numberOfLines={2}>{insp.title}</Text>
              {insp.locked && (
                <View style={styles.lockBadge}>
                  <Ionicons name="lock-closed" size={11} color={theme.color.textSecondary} />
                  <Text style={styles.lockText}>{t('modules.inspectionDetail.locked')}</Text>
                </View>
              )}
            </View>
            <View style={styles.metaGrid}>
              <Meta theme={theme} icon="bus-outline" label={t('modules.inspectionDetail.asset')} value={insp.asset_no} />
              <Meta theme={theme} icon="location-outline" label={t('modules.inspectionDetail.site')} value={insp.site} />
              <Meta theme={theme} icon="calendar-outline" label={t('modules.inspectionDetail.date')} value={insp.inspection_date} />
              <Meta theme={theme} icon="person-outline" label={t('modules.inspectionDetail.inspector')} value={insp.inspector} />
            </View>
          </View>

          {shownPositions.length > 0 && (
            <View style={styles.card}>
              <Text style={[styles.section, { textAlign }]}>{t('modules.inspectionDetail.tyreLayout')}</Text>
              <View style={{ alignItems: 'center' }}>
                <VehicleTyreDiagram
                  vehicleType={insp.vehicle_type ?? ''}
                  positions={shownPositions}
                  tyreData={conditions}
                  selectedPosition={null}
                  onPositionPress={() => {}}
                  width={Math.min(width - 64, 300)}
                />
              </View>
            </View>
          )}

          <View style={styles.card}>
            <Text style={[styles.section, { textAlign }]}>{`${t('modules.inspectionDetail.conditions')} (${Object.keys(conditions).length})`}</Text>
            {Object.keys(conditions).length === 0 ? (
              <Text style={styles.muted}>{t('modules.inspectionDetail.noData')}</Text>
            ) : (
              Object.entries(conditions).map(([pos, c]: [string, any]) => {
                const rc = conditionColor(c?.condition ?? c?.risk)
                const meta = [
                  c?.tread_depth_mm ? `${c.tread_depth_mm}mm` : (c?.tread_depth != null ? `${c.tread_depth}mm` : null),
                  c?.pressure_psi ? `${c.pressure_psi} psi` : (c?.pressure != null ? `${c.pressure} psi` : null),
                  c?.brand,
                  c?.serial_number ?? c?.serial,
                ].filter(Boolean).join(' · ') || '-'
                return (
                  <View key={pos} style={[styles.condRow, isRTL && styles.rowR]}>
                    <View style={[styles.posDot, { backgroundColor: rc }]}><Text style={styles.posText}>{pos}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.condTitle, { textAlign, color: rc }]}>
                        {conditionLabel(c)}
                      </Text>
                      <Text style={[styles.condMeta, { textAlign }]}>{meta}</Text>
                    </View>
                    <View style={[styles.condChip, { backgroundColor: rc }]}>
                      <Text style={styles.condChipText}>{conditionLabel(c)}</Text>
                    </View>
                  </View>
                )
              })
            )}
          </View>

          {insp.notes ? (
            <View style={styles.card}>
              <Text style={[styles.section, { textAlign }]}>{t('modules.inspectionDetail.notes')}</Text>
              <Text style={[styles.notes, { textAlign }]}>{insp.notes}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function Meta({ theme, icon, label, value }: { theme: Theme; icon: string; label: string; value: string | null | undefined }) {
  const styles = makeStyles(theme)
  return (
    <View style={styles.meta}>
      <View style={styles.metaIcon}>
        <Ionicons name={icon as any} size={15} color={theme.color.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue} numberOfLines={1}>{value || '-'}</Text>
      </View>
    </View>
  )
}

function makeStyles(theme: Theme) {
  const c = theme.color
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    rowR: { flexDirection: 'row-reverse' },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, padding: spacing.lg },
    backBtn: {
      width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.surface,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border,
    },
    title: { ...typography.h2, color: c.text, flex: 1 },
    shareBtn: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 1,
      backgroundColor: c.primary, borderRadius: radius.md,
      paddingHorizontal: spacing.md, height: 40, minWidth: 44, justifyContent: 'center',
    },
    shareBtnText: { color: c.onPrimary, fontSize: 13, fontWeight: '800' },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing['4xl'] },
    card: {
      backgroundColor: c.surface, borderRadius: radius.xl, padding: spacing.lg,
      borderWidth: 1, borderColor: c.border, gap: spacing.md,
      ...elevation(theme, 1),
    },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    iTitle: { flex: 1, ...typography.title, color: c.text },
    lockBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.surfaceAlt,
      borderRadius: radius.sm - 2, paddingHorizontal: spacing.sm, paddingVertical: 3,
    },
    lockText: { fontSize: 10, fontWeight: '800', color: c.textSecondary },
    metaGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: spacing.sm },
    meta: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', width: '46%' },
    metaIcon: {
      width: 32, height: 32, borderRadius: radius.sm, backgroundColor: c.primarySoft,
      alignItems: 'center', justifyContent: 'center',
    },
    metaLabel: { ...typography.micro, color: c.textMuted, textTransform: 'uppercase' },
    metaValue: { fontSize: 14, color: c.text, fontWeight: '700' },
    section: { ...typography.h3, color: c.text },
    muted: { fontSize: 13, color: c.textMuted },
    condRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm,
      borderTopWidth: 1, borderTopColor: c.border,
    },
    posDot: {
      minWidth: 44, height: 34, borderRadius: radius.sm, paddingHorizontal: spacing.sm,
      alignItems: 'center', justifyContent: 'center',
    },
    posText: { fontSize: 12, fontWeight: '800', color: '#fff' },
    condTitle: { fontSize: 14, fontWeight: '700', color: c.text, textTransform: 'capitalize' },
    condMeta: { fontSize: 12, color: c.textMuted, marginTop: 1 },
    condChip: {
      paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm - 2,
      alignSelf: 'center',
    },
    condChipText: { fontSize: 11, fontWeight: '800', color: '#fff', textTransform: 'capitalize' },
    notes: { fontSize: 14, color: c.textSecondary, lineHeight: 20 },
    empty: { alignItems: 'center', paddingVertical: spacing['5xl'], gap: spacing.sm + 2, paddingHorizontal: spacing.lg },
    emptyText: { ...typography.title, color: c.textMuted, textAlign: 'center' },
    retryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2,
      backgroundColor: c.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg,
      height: 44, marginTop: spacing.sm,
    },
    retryText: { color: c.onPrimary, fontSize: 14, fontWeight: '700' },
  })
}
