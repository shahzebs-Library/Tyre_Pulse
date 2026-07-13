/**
 * Site & Vehicle Fleet Management
 *
 * Admins and managers can:
 *  - Add / edit / deactivate sites with country grouping
 *  - Add / edit / deactivate vehicles for each site
 *
 * Access: admin · manager
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, StatusBar, Modal, Platform, KeyboardAvoidingView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useElevatedGuard } from '../../../hooks/useRoleGuard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Site {
  id: string
  name: string
  country: string
  region: string | null
  city: string | null
  active: boolean
}

interface Vehicle {
  id: string
  asset_no: string
  vehicle_type: string
  make: string | null
  model: string | null
  site: string
  country: string | null
  status: string | null
  is_active: boolean
}

const VEHICLE_TYPES = ['Truck', 'Bus', 'Trailer', 'Crane', 'Forklift', 'Pickup', 'SUV', 'Van', 'Tanker', 'Other']
const COUNTRIES = ['Saudi Arabia', 'UAE', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Pakistan', 'Egypt', 'Other']

// ── Main ─────────────────────────────────────────────────────────────────────

export default function SitesManagementScreen() {
  const { allowed, loading: guardLoading } = useElevatedGuard()
  const { profile } = useAuth()
  const router = useRouter()

  const [tab, setTab] = useState<'sites' | 'vehicles'>('sites')
  const [sites, setSites] = useState<Site[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSiteFilter, setSelectedSiteFilter] = useState<string>('all')

  // Site modal
  const [siteModal, setSiteModal] = useState(false)
  const [editingSite, setEditingSite] = useState<Site | null>(null)
  const [siteName, setSiteName] = useState('')
  const [siteCountry, setSiteCountry] = useState('Saudi Arabia')
  const [siteRegion, setSiteRegion] = useState('')
  const [siteCity, setSiteCity] = useState('')
  const [savingSite, setSavingSite] = useState(false)

  // Vehicle modal
  const [vehicleModal, setVehicleModal] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null)
  const [vAsset, setVAsset] = useState('')
  const [vType, setVType] = useState('Truck')
  const [vMake, setVMake] = useState('')
  const [vModel, setVModel] = useState('')
  const [vSite, setVSite] = useState('')
  const [savingVehicle, setSavingVehicle] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [sitesRes, vehiclesRes] = await Promise.all([
      supabase.from('sites').select('*').order('country').order('name'),
      supabase.from('vehicle_fleet').select('id,asset_no,vehicle_type,make,model,site,country,status,is_active').order('site').order('asset_no'),
    ])
    setSites((sitesRes.data ?? []) as Site[])
    setVehicles((vehiclesRes.data ?? []) as Vehicle[])
    setLoading(false)
  }, [])

  useEffect(() => { if (allowed) load() }, [load, allowed])

  // ── Derived rollups (real asset counts per site) ────────────────────────────
  const countBySite = useMemo(() => {
    const m: Record<string, { total: number; active: number }> = {}
    for (const v of vehicles) {
      const name = (v.site ?? '').trim()
      if (!name) continue
      if (!m[name]) m[name] = { total: 0, active: 0 }
      m[name].total += 1
      if (v.is_active !== false) m[name].active += 1
    }
    return m
  }, [vehicles])

  const masterNames = useMemo(
    () => new Set(sites.map(s => (s.name ?? '').trim().toLowerCase())),
    [sites],
  )

  // Sites that exist in the fleet but are NOT in the governed master — the real
  // operational sites the master is missing. Admins can promote them in one tap.
  const derivedSites = useMemo(() => {
    const seen = new Set<string>()
    const out: { name: string; country: string | null; total: number; active: number }[] = []
    for (const v of vehicles) {
      const name = (v.site ?? '').trim()
      if (!name) continue
      const k = name.toLowerCase()
      if (masterNames.has(k) || seen.has(k)) continue
      seen.add(k)
      const c = countBySite[name]
      out.push({ name, country: v.country ?? null, total: c?.total ?? 0, active: c?.active ?? 0 })
    }
    return out.sort((a, b) => b.total - a.total)
  }, [vehicles, masterNames, countBySite])

  function promoteSite(name: string, country: string | null) {
    setEditingSite(null)
    setSiteName(name)
    setSiteCountry(country || 'Saudi Arabia')
    setSiteRegion(''); setSiteCity('')
    setSiteModal(true)
  }

  // ── Site CRUD ──────────────────────────────────────────────────────────────

  function openAddSite() {
    setEditingSite(null)
    setSiteName(''); setSiteCountry('Saudi Arabia'); setSiteRegion(''); setSiteCity('')
    setSiteModal(true)
  }

  function openEditSite(site: Site) {
    setEditingSite(site)
    setSiteName(site.name); setSiteCountry(site.country); setSiteRegion(site.region ?? ''); setSiteCity(site.city ?? '')
    setSiteModal(true)
  }

  async function saveSite() {
    if (!siteName.trim()) { Alert.alert('Required', 'Site name is required.'); return }
    setSavingSite(true)
    try {
      if (editingSite) {
        const { error } = await supabase.from('sites').update({
          name: siteName.trim(), country: siteCountry, region: siteRegion || null, city: siteCity || null,
        }).eq('id', editingSite.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('sites').insert({
          name: siteName.trim(), country: siteCountry, region: siteRegion || null, city: siteCity || null,
          created_by: profile?.id,
        })
        if (error) throw error
      }
      setSiteModal(false)
      load()
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save site.')
    } finally {
      setSavingSite(false)
    }
  }

  async function toggleSiteActive(site: Site) {
    await supabase.from('sites').update({ active: !site.active }).eq('id', site.id)
    load()
  }

  // ── Vehicle CRUD ───────────────────────────────────────────────────────────

  function openAddVehicle() {
    setEditingVehicle(null)
    setVAsset(''); setVType('Truck'); setVMake(''); setVModel('')
    setVSite(sites.find(s => s.active)?.name ?? '')
    setVehicleModal(true)
  }

  function openEditVehicle(v: Vehicle) {
    setEditingVehicle(v)
    setVAsset(v.asset_no); setVType(v.vehicle_type); setVMake(v.make ?? ''); setVModel(v.model ?? '')
    setVSite(v.site)
    setVehicleModal(true)
  }

  async function saveVehicle() {
    if (!vAsset.trim()) { Alert.alert('Required', 'Asset number is required.'); return }
    if (!vSite) { Alert.alert('Required', 'Please assign a site.'); return }
    setSavingVehicle(true)
    try {
      const country = sites.find(s => s.name === vSite)?.country ?? null
      if (editingVehicle) {
        const { error } = await supabase.from('vehicle_fleet').update({
          asset_no: vAsset.trim().toUpperCase(), vehicle_type: vType,
          make: vMake || null, model: vModel || null, site: vSite, country,
        }).eq('id', editingVehicle.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('vehicle_fleet').insert({
          asset_no: vAsset.trim().toUpperCase(), vehicle_type: vType,
          make: vMake || null, model: vModel || null, site: vSite, country,
          status: 'active', is_active: true, created_by: profile?.id,
        })
        if (error) throw error
      }
      setVehicleModal(false)
      load()
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save vehicle.')
    } finally {
      setSavingVehicle(false)
    }
  }

  async function toggleVehicleActive(v: Vehicle) {
    await supabase.from('vehicle_fleet').update({ is_active: !v.is_active }).eq('id', v.id)
    load()
  }

  async function deleteVehicle(v: Vehicle) {
    Alert.alert('Delete Vehicle', `Remove ${v.asset_no} from fleet?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('vehicle_fleet').delete().eq('id', v.id)
          load()
        },
      },
    ])
  }

  if (guardLoading) return <View style={s.center}><ActivityIndicator size="large" color="#16a34a" /></View>
  if (!allowed) return (
    <SafeAreaView style={s.safe}>
      <View style={s.center}>
        <Ionicons name="lock-closed-outline" size={48} color="#94a3b8" />
        <Text style={s.accessDenied}>Admin or Manager access required</Text>
      </View>
    </SafeAreaView>
  )

  // Group sites by country
  const byCountry: Record<string, Site[]> = {}
  sites.forEach(site => {
    const c = site.country || 'Other'
    if (!byCountry[c]) byCountry[c] = []
    byCountry[c].push(site)
  })

  // Filter vehicles
  const filteredVehicles = selectedSiteFilter === 'all'
    ? vehicles
    : vehicles.filter(v => v.site === selectedSiteFilter)

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#f0fdf4" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.back}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
        <Text style={s.title}>Sites & Fleet</Text>
        <TouchableOpacity
          style={s.addBtn}
          onPress={tab === 'sites' ? openAddSite : openAddVehicle}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'sites' && s.tabBtnActive]}
          onPress={() => setTab('sites')}
        >
          <Ionicons name="location-outline" size={16} color={tab === 'sites' ? '#16a34a' : '#94a3b8'} />
          <Text style={[s.tabLabel, tab === 'sites' && s.tabLabelActive]}>Sites ({sites.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'vehicles' && s.tabBtnActive]}
          onPress={() => setTab('vehicles')}
        >
          <Ionicons name="bus-outline" size={16} color={tab === 'vehicles' ? '#16a34a' : '#94a3b8'} />
          <Text style={[s.tabLabel, tab === 'vehicles' && s.tabLabelActive]}>Vehicles ({vehicles.length})</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#16a34a" /></View>
      ) : tab === 'sites' ? (

        /* ── SITES TAB ──────────────────────────────────────────────────────── */
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {sites.length === 0 && (
            <View style={s.empty}>
              <Ionicons name="location-outline" size={48} color="#cbd5e1" />
              <Text style={s.emptyTitle}>No sites yet</Text>
              <Text style={s.emptySub}>Tap + to add your first site</Text>
            </View>
          )}
          {Object.entries(byCountry).map(([country, countrySites]) => (
            <View key={country}>
              <View style={s.countryHeader}>
                <Ionicons name="globe-outline" size={14} color="#64748b" />
                <Text style={s.countryName}>{country}</Text>
                <Text style={s.countryCount}>{countrySites.length} sites</Text>
              </View>
              {countrySites.map(site => (
                <View key={site.id} style={[s.siteRow, !site.active && s.inactiveRow]}>
                  <View style={[s.siteIconWrap, { backgroundColor: site.active ? '#f0fdf4' : '#f8fafc' }]}>
                    <Ionicons name="location" size={18} color={site.active ? '#16a34a' : '#94a3b8'} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.siteName, !site.active && { color: '#94a3b8' }]}>{site.name}</Text>
                    {(site.city || site.region) && (
                      <Text style={s.siteMeta}>{[site.city, site.region].filter(Boolean).join(' · ')}</Text>
                    )}
                    <Text style={s.siteMeta}>
                      {countBySite[site.name]?.total ?? 0} assets · {countBySite[site.name]?.active ?? 0} active
                    </Text>
                  </View>
                  {!site.active && <Text style={s.inactiveTag}>Inactive</Text>}
                  <TouchableOpacity style={s.iconBtn} onPress={() => openEditSite(site)}>
                    <Ionicons name="create-outline" size={18} color="#64748b" />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.iconBtn} onPress={() => toggleSiteActive(site)}>
                    <Ionicons name={site.active ? 'eye-off-outline' : 'eye-outline'} size={18} color={site.active ? '#94a3b8' : '#16a34a'} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ))}

          {/* Sites present in the fleet but not yet in the governed master */}
          {derivedSites.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <View style={s.countryHeader}>
                <Ionicons name="alert-circle-outline" size={14} color="#ca8a04" />
                <Text style={[s.countryName, { color: '#ca8a04' }]}>Not in master — from fleet data</Text>
                <Text style={s.countryCount}>{derivedSites.length} sites</Text>
              </View>
              {derivedSites.map(d => (
                <View key={`derived-${d.name}`} style={s.siteRow}>
                  <View style={[s.siteIconWrap, { backgroundColor: '#fefce8' }]}>
                    <Ionicons name="location-outline" size={18} color="#ca8a04" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.siteName}>{d.name}</Text>
                    <Text style={s.siteMeta}>{[d.country, `${d.total} assets · ${d.active} active`].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <TouchableOpacity style={s.promoteBtn} onPress={() => promoteSite(d.name, d.country)}>
                    <Ionicons name="add" size={14} color="#16a34a" />
                    <Text style={s.promoteBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

      ) : (

        /* ── VEHICLES TAB ───────────────────────────────────────────────────── */
        <>
          {/* Site filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={s.filterRow}>
            <TouchableOpacity
              style={[s.filterChip, selectedSiteFilter === 'all' && s.filterChipActive]}
              onPress={() => setSelectedSiteFilter('all')}
            >
              <Text style={[s.filterChipText, selectedSiteFilter === 'all' && s.filterChipTextActive]}>All</Text>
            </TouchableOpacity>
            {sites.filter(s => s.active).map(site => (
              <TouchableOpacity
                key={site.id}
                style={[s.filterChip, selectedSiteFilter === site.name && s.filterChipActive]}
                onPress={() => setSelectedSiteFilter(site.name)}
              >
                <Text style={[s.filterChipText, selectedSiteFilter === site.name && s.filterChipTextActive]}>{site.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {filteredVehicles.length === 0 && (
              <View style={s.empty}>
                <Ionicons name="bus-outline" size={48} color="#cbd5e1" />
                <Text style={s.emptyTitle}>No vehicles{selectedSiteFilter !== 'all' ? ` for ${selectedSiteFilter}` : ''}</Text>
                <Text style={s.emptySub}>Tap + to add a vehicle to the fleet</Text>
              </View>
            )}
            {filteredVehicles.map(v => (
              <View key={v.id} style={[s.vehicleRow, !v.is_active && s.inactiveRow]}>
                <View style={[s.vehicleIconWrap, { backgroundColor: v.is_active ? '#f0fdf4' : '#f8fafc' }]}>
                  <Ionicons name="bus-outline" size={20} color={v.is_active ? '#16a34a' : '#94a3b8'} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[s.vehicleAsset, !v.is_active && { color: '#94a3b8' }]}>{v.asset_no}</Text>
                    <View style={s.typeBadge}>
                      <Text style={s.typeBadgeText}>{v.vehicle_type}</Text>
                    </View>
                  </View>
                  <Text style={s.vehicleMeta}>
                    {[v.make, v.model, v.site].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {!v.is_active && <Text style={s.inactiveTag}>Off</Text>}
                <TouchableOpacity style={s.iconBtn} onPress={() => openEditVehicle(v)}>
                  <Ionicons name="create-outline" size={18} color="#64748b" />
                </TouchableOpacity>
                <TouchableOpacity style={s.iconBtn} onPress={() => toggleVehicleActive(v)}>
                  <Ionicons name={v.is_active ? 'eye-off-outline' : 'eye-outline'} size={18} color={v.is_active ? '#94a3b8' : '#16a34a'} />
                </TouchableOpacity>
                <TouchableOpacity style={s.iconBtn} onPress={() => deleteVehicle(v)}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </>
      )}

      {/* ── Site modal ──────────────────────────────────────────────────────── */}
      <Modal visible={siteModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSiteModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView style={m.safe}>
            <View style={m.header}>
              <TouchableOpacity onPress={() => setSiteModal(false)}>
                <Ionicons name="close" size={24} color="#0f172a" />
              </TouchableOpacity>
              <Text style={m.title}>{editingSite ? 'Edit Site' : 'Add Site'}</Text>
              <TouchableOpacity style={m.saveBtn} onPress={saveSite} disabled={savingSite}>
                {savingSite ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={m.content} keyboardShouldPersistTaps="handled">
              <Text style={m.label}>Site Name *</Text>
              <TextInput style={m.input} value={siteName} onChangeText={setSiteName} placeholder="e.g. NHC, Riyadh Depot" placeholderTextColor="#94a3b8" autoCapitalize="words" />

              <Text style={m.label}>Country *</Text>
              <View style={m.chipRow}>
                {COUNTRIES.map(c => (
                  <TouchableOpacity key={c} style={[m.chip, siteCountry === c && m.chipActive]} onPress={() => setSiteCountry(c)}>
                    <Text style={[m.chipText, siteCountry === c && m.chipTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={m.label}>City</Text>
              <TextInput style={m.input} value={siteCity} onChangeText={setSiteCity} placeholder="e.g. Riyadh" placeholderTextColor="#94a3b8" />

              <Text style={m.label}>Region</Text>
              <TextInput style={m.input} value={siteRegion} onChangeText={setSiteRegion} placeholder="e.g. Central Region" placeholderTextColor="#94a3b8" />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Vehicle modal ────────────────────────────────────────────────────── */}
      <Modal visible={vehicleModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVehicleModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView style={m.safe}>
            <View style={m.header}>
              <TouchableOpacity onPress={() => setVehicleModal(false)}>
                <Ionicons name="close" size={24} color="#0f172a" />
              </TouchableOpacity>
              <Text style={m.title}>{editingVehicle ? 'Edit Vehicle' : 'Add Vehicle'}</Text>
              <TouchableOpacity style={m.saveBtn} onPress={saveVehicle} disabled={savingVehicle}>
                {savingVehicle ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.saveBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={m.content} keyboardShouldPersistTaps="handled">
              <Text style={m.label}>Asset / Vehicle Number *</Text>
              <TextInput
                style={m.input} value={vAsset} onChangeText={setVAsset}
                placeholder="e.g. TRK-001, BUS-023" placeholderTextColor="#94a3b8"
                autoCapitalize="characters" autoCorrect={false}
              />

              <Text style={m.label}>Vehicle Type *</Text>
              <View style={m.chipRow}>
                {VEHICLE_TYPES.map(vt => (
                  <TouchableOpacity key={vt} style={[m.chip, vType === vt && m.chipActive]} onPress={() => setVType(vt)}>
                    <Text style={[m.chipText, vType === vt && m.chipTextActive]}>{vt}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={m.label}>Site *</Text>
              <View style={m.chipRow}>
                {sites.filter(s => s.active).map(st => (
                  <TouchableOpacity key={st.id} style={[m.chip, vSite === st.name && m.chipActive]} onPress={() => setVSite(st.name)}>
                    <Text style={[m.chipText, vSite === st.name && m.chipTextActive]}>{st.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={m.label}>Make</Text>
              <TextInput style={m.input} value={vMake} onChangeText={setVMake} placeholder="e.g. Mercedes, Volvo" placeholderTextColor="#94a3b8" />

              <Text style={m.label}>Model</Text>
              <TextInput style={m.input} value={vModel} onChangeText={setVModel} placeholder="e.g. Actros, FH16" placeholderTextColor="#94a3b8" />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#f0fdf4' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  accessDenied: { fontSize: 15, color: '#94a3b8', textAlign: 'center', marginTop: 12 },
  header:  {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  back:    { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  title:   { flex: 1, fontSize: 18, fontWeight: '800', color: '#0f172a' },
  addBtn:  { width: 36, height: 36, borderRadius: 10, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },

  tabBar:  { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tabBtn:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#16a34a' },
  tabLabel: { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
  tabLabelActive: { color: '#16a34a' },

  content: { padding: 16, gap: 10, paddingBottom: Platform.OS === 'ios' ? 32 : 16 },

  // Country group
  countryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  countryName:   { flex: 1, fontSize: 13, fontWeight: '700', color: '#374151' },
  countryCount:  { fontSize: 11, color: '#94a3b8', fontWeight: '600' },

  // Site rows
  siteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  inactiveRow: { opacity: 0.6 },
  siteIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  siteName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  siteMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  inactiveTag: { fontSize: 10, fontWeight: '700', color: '#94a3b8', backgroundColor: '#f1f5f9', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  iconBtn:  { padding: 6 },
  promoteBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  promoteBtnText: { fontSize: 12, fontWeight: '700', color: '#16a34a' },

  // Vehicle rows
  vehicleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  vehicleIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  vehicleAsset: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  vehicleMeta:  { fontSize: 11, color: '#64748b', marginTop: 2 },
  typeBadge:    { backgroundColor: '#f0fdf4', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  typeBadgeText:{ fontSize: 10, fontWeight: '700', color: '#16a34a' },

  // Filter
  filterScroll: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  filterRow:    { flexDirection: 'row', gap: 8, padding: 10 },
  filterChip:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0' },
  filterChipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  filterChipText:   { fontSize: 12, fontWeight: '700', color: '#64748b' },
  filterChipTextActive: { color: '#fff' },

  // Empty
  empty:      { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#94a3b8' },
  emptySub:   { fontSize: 13, color: '#cbd5e1' },
})

const m = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#fff' },
  header:  { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  title:   { flex: 1, fontSize: 17, fontWeight: '800', color: '#0f172a' },
  saveBtn: { backgroundColor: '#16a34a', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  label:   { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  input:   {
    backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#0f172a',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:    { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0' },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText:   { fontSize: 13, fontWeight: '600', color: '#374151' },
  chipTextActive: { color: '#fff' },
})
