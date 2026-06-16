import { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  StatusBar, ActivityIndicator, useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../../lib/supabase'
import { useLanguage } from '../../../contexts/LanguageContext'
import VehicleTyreDiagram from '../../../components/VehicleTyreDiagram'
import { getPositionsForVehicle, TyrePositionData } from '../../../lib/types'

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

const RISK_COLOR: Record<string, string> = {
  none: '#94a3b8', low: '#16a34a', medium: '#ca8a04', high: '#ea580c', critical: '#dc2626',
}

export default function InspectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { isRTL } = useLanguage()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [insp, setInsp] = useState<Inspection | null>(null)
  const [loading, setLoading] = useState(true)

  const textAlign = isRTL ? 'right' : 'left'

  useEffect(() => {
    if (!id) { setLoading(false); return }
    supabase.from('inspections')
      .select('id,title,site,asset_no,vehicle_type,inspector,inspection_date,status,notes,locked,tyre_conditions')
      .eq('id', id).single()
      .then(({ data }) => { setInsp(data as Inspection); setLoading(false) })
  }, [id])

  const conditions = insp?.tyre_conditions ?? {}
  const positions = insp
    ? (getPositionsForVehicle(insp.vehicle_type ?? '') ?? Object.keys(conditions))
    : []
  const shownPositions = positions.length ? positions : Object.keys(conditions)

  function riskOf(c: any): string {
    if (!c) return 'none'
    return String(c.risk ?? c.condition ?? 'none').toLowerCase()
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0f5f1" />
      <View style={[styles.header, isRTL && styles.rowR]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={22} color="#0f172a" />
        </TouchableOpacity>
        <Text style={[styles.title, { textAlign }]} numberOfLines={1}>Inspection</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 40 }} />
      ) : !insp ? (
        <View style={styles.empty}><Ionicons name="document-outline" size={48} color="#cbd5e1" /><Text style={styles.emptyText}>Not found</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={[styles.cardTop, isRTL && styles.rowR]}>
              <Text style={[styles.iTitle, { textAlign }]} numberOfLines={2}>{insp.title}</Text>
              {insp.locked && (
                <View style={styles.lockBadge}><Ionicons name="lock-closed" size={11} color="#64748b" /><Text style={styles.lockText}>Locked</Text></View>
              )}
            </View>
            <View style={styles.metaGrid}>
              <Meta icon="bus-outline" label="Asset" value={insp.asset_no} />
              <Meta icon="location-outline" label="Site" value={insp.site} />
              <Meta icon="calendar-outline" label="Date" value={insp.inspection_date} />
              <Meta icon="person-outline" label="Inspector" value={insp.inspector} />
            </View>
          </View>

          {shownPositions.length > 0 && (
            <View style={styles.card}>
              <Text style={[styles.section, { textAlign }]}>Tyre Layout</Text>
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
            <Text style={[styles.section, { textAlign }]}>Tyre Conditions ({Object.keys(conditions).length})</Text>
            {Object.keys(conditions).length === 0 ? (
              <Text style={styles.muted}>No tyre data recorded.</Text>
            ) : (
              Object.entries(conditions).map(([pos, c]: [string, any]) => {
                const rk = riskOf(c)
                const rc = RISK_COLOR[rk] ?? '#94a3b8'
                return (
                  <View key={pos} style={[styles.condRow, isRTL && styles.rowR]}>
                    <View style={[styles.posDot, { backgroundColor: rc }]}><Text style={styles.posText}>{pos}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.condTitle, { textAlign }]}>
                        {c?.condition ?? c?.risk ?? 'Recorded'}
                      </Text>
                      <Text style={[styles.condMeta, { textAlign }]}>
                        {[c?.tread_depth != null ? `${c.tread_depth}mm` : null, c?.pressure != null ? `${c.pressure} psi` : null, c?.brand, c?.serial].filter(Boolean).join(' · ') || '—'}
                      </Text>
                    </View>
                  </View>
                )
              })
            )}
          </View>

          {insp.notes ? (
            <View style={styles.card}>
              <Text style={[styles.section, { textAlign }]}>Notes</Text>
              <Text style={[styles.notes, { textAlign }]}>{insp.notes}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function Meta({ icon, label, value }: { icon: string; label: string; value: string | null | undefined }) {
  return (
    <View style={styles.meta}>
      <Ionicons name={icon as any} size={14} color="#94a3b8" />
      <View>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue}>{value || '—'}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0f5f1' },
  rowR: { flexDirection: 'row-reverse' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a', flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  iTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#0f172a' },
  lockBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(100,116,139,0.1)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  lockText: { fontSize: 9, fontWeight: '800', color: '#64748b' },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  meta: { flexDirection: 'row', gap: 8, alignItems: 'center', width: '45%' },
  metaLabel: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
  metaValue: { fontSize: 13, color: '#0f172a', fontWeight: '700' },
  section: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  muted: { fontSize: 13, color: '#94a3b8' },
  condRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.04)' },
  posDot: { minWidth: 38, height: 30, borderRadius: 8, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  posText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  condTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a', textTransform: 'capitalize' },
  condMeta: { fontSize: 11.5, color: '#94a3b8' },
  notes: { fontSize: 13, color: '#475569', lineHeight: 19 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#94a3b8' },
})
