/**
 * Site Management — the operational view of every site/branch the fleet runs
 * from. The governed `sites` master is typically near-empty, so this page
 * MERGES it with the real, authoritative set of sites derived from distinct
 * `vehicle_fleet.site` values (buildSiteRollup) and shows, per site, its asset
 * count, active-asset count, country/region, governance state, and — on expand
 * — its actual assets (deep-linked to the asset detail page).
 *
 * Honest states throughout: real loading / error / empty. No fabricated data.
 * Admin/Manager can promote a derived site into the governed master or edit an
 * existing one (writes go through the org-RLS-guarded sites service).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MapPin, Truck, Search, RefreshCw, ChevronDown, ChevronRight,
  AlertTriangle, Globe, Plus, Edit2, X, Save, ToggleLeft, ToggleRight,
  FileSpreadsheet, Layers, CheckCircle2, Activity, Eye, ShieldCheck,
} from 'lucide-react'
import { SkeletonCards } from '../components/ui/Skeleton'
import PageHeader from '../components/ui/PageHeader'
import * as sitesApi from '../lib/api/sites'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const fmt = (n) => (n == null || isNaN(Number(n)) ? '-' : Number(n).toLocaleString('en-US'))

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const colors = {
    blue:   { bg: 'from-blue-900/30 to-blue-800/10',   border: 'border-blue-800/30',   icon: 'text-blue-400' },
    green:  { bg: 'from-green-900/30 to-green-800/10',  border: 'border-green-800/30',  icon: 'text-green-400' },
    purple: { bg: 'from-purple-900/30 to-purple-800/10',border: 'border-purple-800/30', icon: 'text-purple-400' },
    yellow: { bg: 'from-yellow-900/30 to-yellow-800/10',border: 'border-yellow-800/30', icon: 'text-yellow-400' },
    teal:   { bg: 'from-teal-900/30 to-teal-800/10',    border: 'border-teal-800/30',   icon: 'text-teal-400' },
  }
  const c = colors[color] ?? colors.blue
  return (
    <div className={`bg-gradient-to-br ${c.bg} rounded-xl border ${c.border} p-5 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-widest font-medium">{label}</span>
        <Icon className={`w-5 h-5 ${c.icon}`} />
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight">{value ?? '-'}</p>
      {sub && <p className="text-xs text-[var(--text-muted)]">{sub}</p>}
    </div>
  )
}

// ── Governed-site editor ─────────────────────────────────────────────────────
function SiteModal({ site, onSaved, onClose }) {
  const [form, setForm] = useState(() => site ?? sitesApi.emptySite())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function handleSave() {
    if (!form.country?.trim()) { setError('A country is required.'); return }
    if (!form.name?.trim()) { setError('A site name is required.'); return }
    setSaving(true); setError('')
    try {
      await sitesApi.upsertSite(form)
      onSaved()
    } catch (e) {
      setError(toUserMessage(e, 'Could not save site.'))
      setSaving(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-[var(--surface-1)] rounded-2xl border border-[var(--border-dim)] w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-dim)]">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-400" /> {site?.siteId ? 'Edit Site' : 'Add / Promote Site'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Site Name *</label>
              <input value={form.name ?? ''} onChange={e => set('name', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Country *</label>
              <input value={form.country ?? ''} onChange={e => set('country', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Site Type</label>
              <select value={form.site_type ?? 'other'} onChange={e => set('site_type', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                {sitesApi.SITE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Site Code</label>
              <input value={form.site_code ?? ''} onChange={e => set('site_code', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Region</label>
              <input value={form.region ?? ''} onChange={e => set('region', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">City</label>
              <input value={form.city ?? ''} onChange={e => set('city', e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-[var(--text-secondary)]">Status</label>
            <button onClick={() => set('active', form.active === false ? true : false)} className="flex items-center gap-2">
              {form.active !== false
                ? <ToggleRight className="w-8 h-8 text-green-400" />
                : <ToggleLeft className="w-8 h-8 text-[var(--text-dim)]" />}
              <span className={`text-sm font-medium ${form.active !== false ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>
                {form.active !== false ? 'Active' : 'Inactive'}
              </span>
            </button>
          </div>
          {error && <p className="text-red-400 text-xs bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex justify-end gap-3 px-5 pb-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[var(--surface-2)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-3)]">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function SiteManagement() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const role = profile?.role
  const canManage = role === 'Admin' || role === 'Manager' || role === 'Director'

  const [rollup, setRollup] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const [search, setSearch] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterGoverned, setFilterGoverned] = useState('')
  const [filterActive, setFilterActive] = useState('')
  const [expanded, setExpanded] = useState({})
  const [editSite, setEditSite] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const [master, assets] = await Promise.all([
        sitesApi.listSites({ country: activeCountry }),
        sitesApi.listSiteAssets({ country: activeCountry }),
      ])
      setRollup(sitesApi.buildSiteRollup(master ?? [], assets ?? []))
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not load sites.'))
      setRollup([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load, refreshKey])

  // ── filters ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...rollup]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.country ?? '').toLowerCase().includes(q) ||
        (s.region ?? '').toLowerCase().includes(q) ||
        (s.city ?? '').toLowerCase().includes(q))
    }
    if (filterCountry) list = list.filter(s => s.country === filterCountry)
    if (filterGoverned === 'governed') list = list.filter(s => s.governed)
    if (filterGoverned === 'derived') list = list.filter(s => !s.governed)
    if (filterActive === 'active') list = list.filter(s => s.active)
    if (filterActive === 'inactive') list = list.filter(s => !s.active)
    return list
  }, [rollup, search, filterCountry, filterGoverned, filterActive])

  const countryOptions = useMemo(() => [...new Set(rollup.map(s => s.country).filter(Boolean))].sort(), [rollup])

  const kpis = useMemo(() => {
    const totalAssets = rollup.reduce((s, r) => s + r.assetCount, 0)
    const activeAssets = rollup.reduce((s, r) => s + r.activeAssetCount, 0)
    const governed = rollup.filter(r => r.governed).length
    const derived = rollup.filter(r => !r.governed).length
    const countries = new Set(rollup.map(r => r.country).filter(Boolean)).size
    return { total: rollup.length, governed, derived, totalAssets, activeAssets, countries }
  }, [rollup])

  function handleExport() {
    exportToExcel(
      filtered.map(s => ({
        name: s.name,
        country: s.country ?? '',
        region: s.region ?? '',
        city: s.city ?? '',
        type: s.siteType ?? '',
        governed: s.governed ? 'Master' : 'Derived',
        active: s.active ? 'Active' : 'Inactive',
        assets: s.assetCount,
        active_assets: s.activeAssetCount,
      })),
      ['name', 'country', 'region', 'city', 'type', 'governed', 'active', 'assets', 'active_assets'],
      ['Site', 'Country', 'Region', 'City', 'Type', 'Source', 'Status', 'Assets', 'Active Assets'],
      `sites_${new Date().toISOString().slice(0, 10)}`,
      'Sites',
    )
  }

  const toggle = (name) => setExpanded(p => ({ ...p, [name]: !p[name] }))

  return (
    <div className="text-[var(--text-primary)]">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        <PageHeader
          title="Site Management"
          subtitle="Every operational site — governed master + sites derived from live fleet data"
          icon={MapPin}
          actions={<>
            <button onClick={() => setRefreshKey(k => k + 1)}
              className="p-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-bright)]">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-green-400 hover:text-green-300 text-sm border border-[var(--border-bright)]">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
            {canManage && (
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
                <Plus className="w-4 h-4" /> Add Site
              </button>
            )}
          </>}
        />

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
          <KpiCard icon={MapPin} label="Total Sites" value={fmt(kpis.total)} sub={`${kpis.countries} countries`} color="blue" />
          <KpiCard icon={ShieldCheck} label="Governed" value={fmt(kpis.governed)} sub="in sites master" color="green" />
          <KpiCard icon={Layers} label="Derived" value={fmt(kpis.derived)} sub="from fleet data only" color="yellow" />
          <KpiCard icon={Truck} label="Total Assets" value={fmt(kpis.totalAssets)} sub="across all sites" color="purple" />
          <KpiCard icon={Activity} label="Active Assets" value={fmt(kpis.activeAssets)} sub="operational" color="teal" />
          <KpiCard icon={Globe} label="Countries" value={fmt(kpis.countries)} color="blue" />
        </div>

        {/* Search & filters */}
        <div className="card">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by site, country, region, city..."
                className="w-full bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg pl-10 pr-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-gray-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select value={filterCountry} onChange={e => setFilterCountry(e.target.value)}
                className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                <option value="">All countries</option>
                {countryOptions.map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={filterGoverned} onChange={e => setFilterGoverned(e.target.value)}
                className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                <option value="">All sources</option>
                <option value="governed">Master</option>
                <option value="derived">Derived</option>
              </select>
              <select value={filterActive} onChange={e => setFilterActive(e.target.value)}
                className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500">
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <SkeletonCards count={6} />
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <AlertTriangle className="w-12 h-12 mb-3 text-red-400" />
            <p className="text-red-300 font-medium">Could not load sites</p>
            <p className="text-[var(--text-muted)] text-sm mt-1 max-w-md">{loadError}</p>
            <button onClick={() => setRefreshKey(k => k + 1)} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg">
              <RefreshCw size={16} /> Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--text-dim)]">
            <MapPin className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No sites found. Adjust filters, or assets have no site assigned yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(s => {
              const isOpen = !!expanded[s.name]
              return (
                <div key={`${s.country}|${s.name}`} className="bg-[var(--surface-1)] rounded-xl border border-[var(--border-dim)] overflow-hidden">
                  <button onClick={() => toggle(s.name)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[var(--surface-2)] transition-colors text-left">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.active ? 'bg-blue-900/30 text-blue-400' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'}`}>
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[var(--text-primary)]">{s.name}</span>
                        {s.governed
                          ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-900/40 text-green-300 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Master</span>
                          : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-900/40 text-yellow-300">Derived</span>}
                        {!s.active && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--surface-2)] text-[var(--text-muted)]">Inactive</span>}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                        {[s.country, s.region, s.city, s.siteType].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-5 shrink-0">
                      <div className="text-right">
                        <p className="text-lg font-bold text-[var(--text-primary)] leading-none">{fmt(s.assetCount)}</p>
                        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">assets</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-lg font-bold text-green-400 leading-none">{fmt(s.activeAssetCount)}</p>
                        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">active</p>
                      </div>
                      {canManage && (
                        <span onClick={(e) => { e.stopPropagation(); setEditSite(s) }}
                          className="p-1.5 rounded-lg hover:bg-[var(--surface-3)] text-[var(--text-secondary)] hover:text-yellow-400 cursor-pointer" title="Edit / promote to master">
                          <Edit2 className="w-4 h-4" />
                        </span>
                      )}
                      {isOpen ? <ChevronDown className="w-5 h-5 text-[var(--text-muted)]" /> : <ChevronRight className="w-5 h-5 text-[var(--text-muted)]" />}
                    </div>
                  </button>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-[var(--border-dim)]">
                        {s.assets.length ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border-dim)]">
                                  {['Asset No', 'Fleet No', 'Type', 'Current KM', 'Status', ''].map(h => (
                                    <th key={h} className="px-5 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {s.assets.map(a => (
                                  <tr key={a.id ?? a.asset_no} className="border-b border-[var(--border-dim)] hover:bg-[var(--surface-2)] transition-colors">
                                    <td className="px-5 py-2.5 font-mono font-semibold text-blue-300">{a.asset_no}</td>
                                    <td className="px-5 py-2.5 text-[var(--text-secondary)]">{a.fleet_number ?? '-'}</td>
                                    <td className="px-5 py-2.5 text-[var(--text-secondary)]">{a.vehicle_type ?? '-'}</td>
                                    <td className="px-5 py-2.5 text-[var(--text-secondary)]">{a.current_km != null && a.current_km !== '' ? `${fmt(a.current_km)} km` : '-'}</td>
                                    <td className="px-5 py-2.5">
                                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${a.active !== false ? 'bg-green-900/50 text-green-300' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'}`}>
                                        {a.active !== false ? 'Active' : 'Inactive'}
                                      </span>
                                    </td>
                                    <td className="px-5 py-2.5 text-right">
                                      <button onClick={() => navigate(`/assets/${encodeURIComponent(a.asset_no)}`)}
                                        className="p-1.5 rounded-lg hover:bg-[var(--surface-3)] text-[var(--text-secondary)] hover:text-blue-400" title="View asset">
                                        <Eye className="w-4 h-4" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="px-5 py-6 text-center text-[var(--text-muted)] text-sm flex items-center justify-center gap-2">
                            <CheckCircle2 className="w-4 h-4" /> Governed site with no assets assigned yet.
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {(showAdd || editSite) && (
          <SiteModal
            site={editSite ? {
              siteId: editSite.siteId, name: editSite.name, country: editSite.country,
              region: editSite.region, city: editSite.city, site_type: editSite.siteType,
              site_code: '', active: editSite.active,
            } : null}
            onClose={() => { setShowAdd(false); setEditSite(null) }}
            onSaved={() => { setShowAdd(false); setEditSite(null); setRefreshKey(k => k + 1) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
