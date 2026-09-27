/**
 * Site Management - the operational view of every site/branch the fleet runs
 * from. The governed `sites` register is typically near-empty, so this page
 * MERGES it with the real set of sites derived from distinct
 * `vehicle_fleet.site` values (buildSiteRollup) and shows, per site, its asset
 * count, active-asset count, country/region, governance state and data gaps.
 * Opening a site lists its actual assets (deep-linked to the asset detail page).
 *
 * KPI strip, assets-by-site and region charts, filters + search, a sortable
 * EnterpriseTable site register, a per-site asset register, Excel/PDF export.
 * Admin/Manager/Director can promote a derived site into the governed register
 * or edit one (writes go through the org-RLS-guarded sites service, whose name
 * normalisation is unchanged). Page figures live in the pure
 * `src/lib/siteManagementAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  MapPin, Truck, Search, RefreshCw, AlertTriangle, Globe, Plus, Edit2, X, Save,
  ToggleLeft, ToggleRight, FileSpreadsheet, FileText, Layers, Activity, Eye, ShieldCheck,
  MapPinOff, Inbox, BarChart3,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import * as sitesApi from '../lib/api/sites'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  EMPTY_SITE_FILTERS, GAP_KEYS, GAP_LABEL, enrichSites, filterSites, siteKpis, topSitesByAssets,
  sitesByRegion, countryOptions, regionOptions, activeSiteFilterCount, siteExportRows, SITE_EXPORT_COLUMNS,
} from '../lib/siteManagementAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const fmt = (n) => (n == null || isNaN(Number(n)) ? 'N/A' : Number(n).toLocaleString('en-US'))
const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

function Kpi({ label, value, icon: Icon, tone, sub, loading }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-3xl font-bold mt-1 tabular-nums ${tone}`}>
        {loading ? <span className="inline-block h-8 w-16 rounded bg-[var(--input-bg)] animate-pulse" aria-label="Loading" /> : (value ?? 'N/A')}
      </p>
      {sub && !loading && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Assets at one site ───────────────────────────────────────────────────────
function SiteAssetsTable({ site, onOpen }) {
  const columns = useMemo(() => [
    { id: 'asset', header: 'Asset No', accessorFn: (a) => a.asset_no || '', size: 130, cell: ({ getValue }) => <span className="font-mono font-semibold text-[var(--brand-bright)]">{getValue() || 'N/A'}</span> },
    { id: 'fleet', header: 'Fleet No', accessorFn: (a) => a.fleet_number || '', size: 110, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'type', header: 'Type', accessorFn: (a) => a.vehicle_type || '', size: 130, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'km', header: 'Current KM', size: 120, sortUndefined: 'last', meta: { align: 'right' },
      accessorFn: (a) => (a.current_km == null || a.current_km === '' ? null : Number(a.current_km)),
      cell: ({ getValue }) => (getValue() == null ? 'N/A' : `${fmt(getValue())} km`),
    },
    {
      id: 'status', header: 'Status', accessorFn: (a) => (a.active !== false ? 'Active' : 'Inactive'), size: 100,
      cell: ({ getValue }) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${getValue() === 'Active' ? 'bg-green-500/15 text-green-300 border-green-500/40' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}>{getValue()}</span>
      ),
    },
    {
      id: 'open', header: '', enableSorting: false, size: 70, meta: { export: false },
      cell: ({ row }) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(row.original) }} className={`${ICON_BTN} hover:text-[var(--brand-bright)]`} aria-label={`View asset ${row.original.asset_no || ''}`}>
          <Eye className="w-4 h-4" />
        </button>
      ),
    },
  ], [onOpen])

  return (
    <EnterpriseTable
      columns={columns}
      data={site.assets || []}
      getRowId={(a) => String(a.id ?? a.asset_no)}
      initialPageSize={25}
      searchPlaceholder="Search assets at this site"
      exportFileName={reportFileName('TyrePulse Site Assets', site.name)}
      onRowClick={onOpen}
      emptyMessage="Governed site with no assets assigned yet."
    />
  )
}

// ── Governed-site editor ─────────────────────────────────────────────────────
function SiteModal({ site, onSaved, onClose }) {
  const [form, setForm] = useState(() => site ?? sitesApi.emptySite())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const close = () => { if (!saving) onClose() }

  async function handleSave(e) {
    e?.preventDefault?.()
    if (!form.country?.trim()) { setError('A country is required.'); return }
    if (!form.name?.trim()) { setError('A site name is required.'); return }
    setSaving(true); setError('')
    try {
      await sitesApi.upsertSite(form)
      onSaved()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save site.'))
      setSaving(false)
    }
  }

  const active = form.active !== false
  return (
    <Modal
      open
      onClose={close}
      title={site?.siteId ? 'Edit Site' : 'Add or Promote Site'}
      subtitle="Saving adds the site to the governed register."
      size="md"
      footer={(
        <>
          <button type="button" onClick={close} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
          <button type="submit" form="site-form" disabled={saving} className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-50">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      )}
    >
      <form id="site-form" onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block"><span className="label">Site name <span className="text-red-400" aria-hidden="true">*</span></span>
            <input className="input w-full min-h-[44px]" value={form.name ?? ''} required onChange={e => set('name', e.target.value)} />
          </label>
          <label className="block"><span className="label">Country <span className="text-red-400" aria-hidden="true">*</span></span>
            <input className="input w-full min-h-[44px]" value={form.country ?? ''} required onChange={e => set('country', e.target.value)} />
          </label>
          <label className="block"><span className="label">Site type</span>
            <select className="input w-full min-h-[44px]" value={form.site_type ?? 'other'} onChange={e => set('site_type', e.target.value)}>
              {sitesApi.SITE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Site code</span>
            <input className="input w-full min-h-[44px]" value={form.site_code ?? ''} onChange={e => set('site_code', e.target.value)} />
          </label>
          <label className="block"><span className="label">Region</span>
            <input className="input w-full min-h-[44px]" value={form.region ?? ''} onChange={e => set('region', e.target.value)} />
          </label>
          <label className="block"><span className="label">City</span>
            <input className="input w-full min-h-[44px]" value={form.city ?? ''} onChange={e => set('city', e.target.value)} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <span className="label mb-0" id="site-status-label">Status</span>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-labelledby="site-status-label"
            onClick={() => set('active', !active)}
            className="flex items-center gap-2 min-h-[44px] px-1 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            {active
              ? <ToggleRight className="w-8 h-8 text-green-400" aria-hidden="true" />
              : <ToggleLeft className="w-8 h-8 text-[var(--text-dim)]" aria-hidden="true" />}
            <span className={`text-sm font-medium ${active ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>{active ? 'Active' : 'Inactive'}</span>
          </button>
        </div>
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
          </div>
        )}
      </form>
    </Modal>
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
  const [notice, setNotice] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [filters, setFilters] = useState(EMPTY_SITE_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const [openSite, setOpenSite] = useState(null)
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
      setUpdatedAt(new Date())
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not load sites.'))
      setRollup([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load, refreshKey])
  const reload = () => setRefreshKey(k => k + 1)

  const failed = Boolean(loadError)
  const enriched = useMemo(() => enrichSites(rollup), [rollup])
  const kpi = useMemo(() => siteKpis(enriched), [enriched])
  const countries = useMemo(() => countryOptions(rollup), [rollup])
  const regions = useMemo(() => regionOptions(rollup), [rollup])
  const filtered = useMemo(() => filterSites(enriched, filters), [enriched, filters])
  const topSites = useMemo(() => topSitesByAssets(filtered), [filtered])
  const byRegion = useMemo(() => sitesByRegion(filtered), [filtered])
  const filterCount = activeSiteFilterCount(filters)

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Total sites', value: kv(fmt(kpi.total)), icon: MapPin, tone: 'text-[var(--text-primary)]', sub: failed ? null : `${kpi.countries} countries` },
    { label: 'Governed', value: failed || kpi.governedPct == null ? null : `${kpi.governedPct}%`, icon: ShieldCheck, tone: 'text-green-400', sub: failed ? null : `${kpi.governed} in register, ${kpi.derived} derived` },
    { label: 'Total assets', value: kv(fmt(kpi.assets)), icon: Truck, tone: 'text-violet-400', sub: failed || kpi.avgAssetsPerSite == null ? null : `${kpi.avgAssetsPerSite} per site with assets` },
    { label: 'Active assets', value: kv(fmt(kpi.activeAssets)), icon: Activity, tone: 'text-teal-400', sub: failed || kpi.activeAssetPct == null ? null : `${kpi.activeAssetPct}% of assets` },
    { label: 'No region set', value: kv(fmt(kpi.noRegion)), icon: MapPinOff, tone: kpi.noRegion ? 'text-amber-400' : 'text-green-400', sub: 'Cannot roll up by region' },
    { label: 'Registered, no assets', value: kv(fmt(kpi.emptyGoverned)), icon: Inbox, tone: 'text-sky-400', sub: 'Governed sites with no fleet' },
  ]

  const doExport = async (kind) => {
    const out = siteExportRows(filtered)
    const keys = SITE_EXPORT_COLUMNS.map(([k]) => k)
    const headers = SITE_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Sites')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name, 'Sites')
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Site Management', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const openAsset = useCallback((a) => navigate(`/asset-management/${encodeURIComponent(a.asset_no)}`), [navigate])

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Site', accessorFn: (s) => s.name, size: 200,
      cell: ({ row }) => {
        const s = row.original
        return (
          <span className="flex flex-col gap-1">
            <span className="font-semibold text-[var(--text-primary)]">{s.name}</span>
            <span className="flex flex-wrap gap-1">
              {s.governed
                ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/15 text-green-300 border border-green-500/40 inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" aria-hidden="true" /> Master</span>
                : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40">Derived</span>}
              {!s.active && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]">Inactive</span>}
            </span>
          </span>
        )
      },
    },
    { id: 'country', header: 'Country', accessorFn: (s) => s.country || '', size: 100, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'region', header: 'Region', accessorFn: (s) => s.region || '', size: 120,
      cell: ({ getValue }) => getValue() || <span className="text-amber-400">Not set</span>,
    },
    { id: 'city', header: 'City', accessorFn: (s) => s.city || '', size: 110, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'type', header: 'Type', accessorFn: (s) => s.siteType || '', size: 100, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'assets', header: 'Assets', accessorFn: (s) => s.assetCount, size: 90, meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{fmt(getValue())}</span> },
    {
      id: 'active', header: 'Active', accessorFn: (s) => s.activeAssetCount, size: 110, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums text-green-400">
          {fmt(row.original.activeAssetCount)}
          {row.original._activePct != null && <span className="block text-[11px] text-[var(--text-muted)]">{row.original._activePct}%</span>}
        </span>
      ),
    },
    {
      id: 'gaps', header: 'Data gaps', accessorFn: (s) => s._gaps.length, size: 170,
      cell: ({ row }) => (row.original._gaps.length
        ? <span className="text-xs text-amber-300">{row.original._gaps.map((g) => GAP_LABEL[g]).join(', ')}</span>
        : <span className="text-xs text-[var(--text-muted)]">None</span>),
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpenSite(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`View assets at ${row.original.name}`}><Eye className="w-4 h-4" /></button>
          {canManage && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setEditSite(row.original) }} className={`${ICON_BTN} hover:text-amber-400`} aria-label={`Edit or promote ${row.original.name}`}><Edit2 className="w-4 h-4" /></button>
          )}
        </div>
      ),
    },
  ], [canManage])

  const siteChart = {
    labels: topSites.map((s) => s.name),
    datasets: [
      { label: 'Active', data: topSites.map((s) => s.active), backgroundColor: withAlpha(colorAt(0), 0.9), borderRadius: 3, maxBarThickness: 24 },
      { label: 'Inactive', data: topSites.map((s) => s.inactive), backgroundColor: withAlpha(colorAt(3), 0.7), borderRadius: 3, maxBarThickness: 24 },
    ],
  }
  const siteOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { labels: { color: 'var(--text-secondary)', boxWidth: 12 } } },
    scales: {
      x: { stacked: true, beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
      y: { stacked: true, ticks: { color: 'var(--text-secondary)' }, grid: { display: false } },
    },
  }
  const regionChart = {
    labels: byRegion.map((r) => r.region),
    datasets: [{ label: 'Assets', data: byRegion.map((r) => r.assets), backgroundColor: byRegion.map((_, i) => colorAt(i)), borderRadius: 4, maxBarThickness: 32 }],
  }
  const regionOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (ctx) => `${byRegion[ctx.dataIndex]?.sites ?? 0} sites` } } },
    scales: {
      x: { ticks: { color: 'var(--text-muted)' }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
    },
  }
  const unavailable = <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Unavailable: sites could not be loaded.</div>

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site Management"
        subtitle="Every operational site: governed master plus sites derived from live fleet data"
        icon={MapPin}
        onRefresh={reload}
        refreshing={loading}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            {canManage && (
              <button type="button" onClick={() => setShowAdd(true)} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
                <Plus size={14} aria-hidden="true" /> Add Site
              </button>
            )}
          </div>
        }
      />

      {loadError && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load sites.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{loadError} The figures below are unavailable until the register loads.</p>
            </div>
          </div>
          <button type="button" onClick={reload} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><BarChart3 size={15} aria-hidden="true" /> Largest sites by assets</h2>
          <div className="h-72">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : topSites.length ? (
                  <div className="h-full" role="img" aria-label={topSites.map((s) => `${s.name}: ${s.active} active, ${s.inactive} inactive`).join('; ')}>
                    <Bar data={siteChart} options={siteOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No sites with assets in this view.</div>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Globe size={15} aria-hidden="true" /> Assets by region</h2>
          <div className="h-72">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : byRegion.length ? (
                  <div className="h-full" role="img" aria-label={byRegion.map((r) => `${r.region}: ${r.sites} sites, ${r.assets} assets`).join('; ')}>
                    <Bar data={regionChart} options={regionOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No sites in this view.</div>}
          </div>
        </div>
      </div>

      {/* Search & filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_1fr_1fr_1fr_1fr_1fr] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Site, country, region, city" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Country</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.country} onChange={(e) => setFilter('country', e.target.value)}>
              <option value="">All countries</option>
              {countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Region</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.region} onChange={(e) => setFilter('region', e.target.value)}>
              <option value="">All regions</option>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Source</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.governed} onChange={(e) => setFilter('governed', e.target.value)}>
              <option value="">All sources</option>
              <option value="governed">Master</option>
              <option value="derived">Derived</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.active} onChange={(e) => setFilter('active', e.target.value)}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Data gap</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.gap} onChange={(e) => setFilter('gap', e.target.value)}>
              <option value="">Any</option>
              {GAP_KEYS.map(g => <option key={g} value={g}>{GAP_LABEL[g]}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">
            <Layers size={12} className="inline mr-1 -mt-0.5" aria-hidden="true" />{filtered.length} of {kpi.total} sites
          </span>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_SITE_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(s) => `${s.country ?? ''}|${s.name}`}
        loading={loading}
        enableGlobalFilter={false}
        enableExport={false}
        initialPageSize={25}
        viewKey="site-management"
        onRowClick={(s) => setOpenSite(s)}
        emptyMessage={
          failed ? 'Sites are unavailable.'
            : kpi.total === 0 ? 'No sites yet. Assets have no site assigned and the site register is empty.'
              : 'No sites match these filters.'
        }
      />

      <Modal
        open={Boolean(openSite)}
        onClose={() => setOpenSite(null)}
        title={openSite ? openSite.name : ''}
        subtitle={openSite ? `${openSite._location || 'Location not set'}. ${fmt(openSite.assetCount)} assets, ${fmt(openSite.activeAssetCount)} active.` : ''}
        size="xl"
        headerExtra={canManage && openSite ? (
          <button type="button" onClick={() => { setEditSite(openSite); setOpenSite(null) }} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <Edit2 size={14} aria-hidden="true" /> {openSite.governed ? 'Edit site' : 'Promote to register'}
          </button>
        ) : null}
      >
        {openSite && (
          openSite.assets?.length
            ? <SiteAssetsTable site={openSite} onOpen={openAsset} />
            : <p className="py-6 text-center text-sm text-[var(--text-muted)]">Governed site with no assets assigned yet.</p>
        )}
      </Modal>

      {(showAdd || editSite) && (
        <SiteModal
          site={editSite ? {
            siteId: editSite.siteId, name: editSite.name, country: editSite.country,
            region: editSite.region, city: editSite.city, site_type: editSite.siteType,
            site_code: '', active: editSite.active,
          } : null}
          onClose={() => { setShowAdd(false); setEditSite(null) }}
          onSaved={() => { setShowAdd(false); setEditSite(null); reload() }}
        />
      )}
    </div>
  )
}
