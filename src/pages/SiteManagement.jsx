/**
 * Site Management (/sites) - every operational site: the governed `sites`
 * register merged with the sites that actually appear on `vehicle_fleet`
 * (buildSiteRollup). Built on the shared page kit to the owner's mockup:
 * hero, KPI strip, site map, utilisation, insights, site directory, health,
 * site types and quick actions.
 *
 * Every figure comes from recorded data. Site capacity is not recorded
 * anywhere, so the capacity card shows telematics utilisation and says so.
 * Definitions live in src/lib/siteOperations.js; the directory filters live in
 * the URL. Admin/Manager/Director add, edit or promote sites through the
 * org-RLS-guarded sites service (name normalisation unchanged).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  MapPin, CheckCircle2, BarChart3, ShieldCheck, Truck, Plus, Minus, Search, Filter, MoreHorizontal,
  Building2, Wrench, ClipboardCheck, Download, ChevronRight, ShieldAlert, AlertTriangle, RefreshCw,
  Edit2, Eye, X, Save, ToggleLeft, ToggleRight, FileText, FileSpreadsheet, ArrowUp, ArrowDown,
  ChevronsUpDown, Upload, MapPinOff, Boxes,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import {
  useCard, Card, ViewAll, CardState, Tabs, Kpi, PageHero, Donut, Pager, MeterCell, KitTable, fmtInt, fmtPct,
} from '../components/commandCenter/kit'
import { WORLD_LAND_PATH, WORLD_W, WORLD_H, project } from '../components/commandCenter/worldLand'
import { COUNTRY_POINTS, utilizationByMonth, monthLabel, changePct } from '../lib/commandCenter'
import * as sitesApi from '../lib/api/sites'
import { listSiteFleetOps, listSiteUtilization, listSiteInspectionDates } from '../lib/api/siteOperations'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { enrichSites, filterSites, countryOptions, regionOptions, GAP_KEYS, GAP_LABEL } from '../lib/siteManagementAnalytics'
import {
  SITE_STATUSES, STATUS_META, STATUS_RULE, COMPLIANCE_RULE, UTILIZATION_RULE, countryFlag,
  enrichOperational, statusCounts, operationalKpis, healthSummary, siteTypeSegments, countryBubbles,
  siteInsights, sortSites, SITE_OPS_EXPORT_COLUMNS, siteOpsExportRows,
} from '../lib/siteOperations'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import './SiteManagement.css'

const fmt = (n) => (n == null || isNaN(Number(n)) ? 'N/A' : Number(n).toLocaleString('en-US'))
const FILTER_KEYS = ['q', 'status', 'country', 'region', 'source', 'gap']

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
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(row.original) }} className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-bright)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]" aria-label={`View asset ${row.original.asset_no || ''}`}>
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

// ── Site locations map ───────────────────────────────────────────────────────
function SiteMap({ state, bubbles, counts, country, countries, onCountry }) {
  const [zoom, setZoom] = useState(1)
  const points = useMemo(() => bubbles
    .map((b) => ({ ...b, xy: COUNTRY_POINTS[b.country] ? project(...COUNTRY_POINTS[b.country]) : null }))
    .filter((b) => b.xy), [bubbles])
  const unplaced = bubbles.filter((b) => !COUNTRY_POINTS[b.country]).reduce((n, b) => n + b.total, 0)
  const view = useMemo(() => {
    if (!points.length) return [0, 0, WORLD_W, WORLD_H]
    const xs = points.map((p) => p.xy[0]); const ys = points.map((p) => p.xy[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const w = Math.max(300, (Math.max(...xs) - Math.min(...xs)) * 3) / zoom
    const h = w * 0.52
    return [cx - w / 2, cy - h / 2, w, h]
  }, [points, zoom])
  const max = Math.max(1, ...points.map((p) => p.total))
  return (
    <Card area="sm-a-map" title="Site Locations" sub="Sites by country and operational status"
      action={(
        <select className="cc-select" aria-label="Country" value={country} onChange={(e) => onCountry(e.target.value)}>
          <option value="">All countries</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}>
      <CardState state={state} empty={state.data && !bubbles.length ? 'No sites to place on the map yet.' : null} lines={6}>
        <div className="cc-map sm-map">
          <svg viewBox={view.join(' ')} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Sites by country: ${points.map((p) => `${p.country} ${p.total}`).join(', ')}`}>
            <path d={WORLD_LAND_PATH} fill="var(--cc-land)" stroke="var(--cc-land-stroke)" strokeWidth={0.4 / zoom} vectorEffect="non-scaling-stroke" />
            {points.map((p) => {
              const r = (7 + 9 * Math.sqrt(p.total / max)) * view[2] / 520
              const sel = country && country === p.country
              return (
                <g key={p.country} className="sm-bubble" role="button" tabIndex={0} aria-label={`${p.country}: ${p.total} sites. Filter the directory`}
                  onClick={() => onCountry(sel ? '' : p.country)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCountry(sel ? '' : p.country) } }}>
                  <circle cx={p.xy[0]} cy={p.xy[1]} r={r * 1.7} fill="var(--cc-green)" opacity={sel ? 0.3 : 0.16} />
                  <circle cx={p.xy[0]} cy={p.xy[1]} r={r} fill="var(--cc-green-strong)" stroke={sel ? 'var(--cc-ink)' : 'var(--cc-green)'} strokeWidth={r * 0.18} />
                  <text x={p.xy[0]} y={p.xy[1]} dy="0.35em" textAnchor="middle" fontSize={r * 0.95} fontWeight="700" fill="#fff">{p.total}</text>
                  <title>{`${p.country}: ${p.total} sites (${p.active} active, ${p.limited} limited, ${p.inactive} inactive)`}</title>
                </g>
              )
            })}
          </svg>
          <div className="cc-map-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.4))}><Plus size={14} /></button>
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.35, z / 1.4))}><Minus size={14} /></button>
          </div>
          <div className="cc-map-legend" title={STATUS_RULE}>
            {SITE_STATUSES.map((s) => (
              <div key={s.key}><span className="cc-dot" style={{ background: s.color }} />{s.label}<span>{fmtInt(counts[s.key])}</span></div>
            ))}
          </div>
          {unplaced > 0 && <p className="sm-map-note">{unplaced} {unplaced === 1 ? 'site has' : 'sites have'} no mappable country</p>}
        </div>
      </CardState>
    </Card>
  )
}

// ── Capacity and usage (utilisation; capacity is not recorded) ───────────────
function UtilRing({ value }) {
  const size = 150; const stroke = 20; const r = (size - stroke) / 2; const c = 2 * Math.PI * r
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="sm-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cc-track)" strokeWidth={stroke} />
        {value != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--cc-green-strong)" strokeWidth={stroke}
            strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="butt" />
        )}
      </svg>
      <div className="sm-ring-label"><b>{fmtPct(value)}</b><span>Avg. utilization</span></div>
    </div>
  )
}

function CapacityCard({ util, series, avg, utilAssets, siteAssets }) {
  const idle = avg == null ? null : Math.max(0, 100 - avg)
  return (
    <Card area="sm-a-cap" title="Site Capacity & Usage" action={<ViewAll to="/fleet-utilization" label="View utilization" />}>
      <CardState state={util} empty={util.data && !utilAssets ? 'No telematics utilisation is recorded for assets at these sites yet.' : null} lines={5}>
        <div className="sm-cap-top">
          <UtilRing value={avg} />
          <div className="cc-legend">
            <div className="cc-legend-row" title={UTILIZATION_RULE}>
              <span className="cc-square" style={{ background: 'var(--cc-green-strong)' }} /><span>Utilised time</span><b>{fmtPct(avg)}</b><span />
            </div>
            <div className="cc-legend-row">
              <span className="cc-square" style={{ background: 'var(--cc-track)' }} /><span>Not utilised</span><b>{fmtPct(idle)}</b><span />
            </div>
            <p className="sm-cap-note">{fmtInt(utilAssets)} of {fmtInt(siteAssets)} site assets report telematics. Site capacity is not recorded, so usage is shown as asset utilisation.</p>
          </div>
        </div>
        <h3 className="sm-subhead">Site Utilization Trend</h3>
        {series.length ? (
          <div className="sm-bars" role="img" aria-label={series.map((p) => `${monthLabel(p.month)} ${p.value}%`).join(', ')}>
            <div className="sm-bars-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
            {series.map((p) => (
              <div key={p.month} className="sm-bar-col" title={`${monthLabel(p.month)}: ${p.value}%`}>
                <div className="sm-bar-track"><i style={{ height: `${Math.max(0, Math.min(100, p.value))}%` }} /></div>
                <span>{monthLabel(p.month)}</span>
              </div>
            ))}
          </div>
        ) : <p className="cc-na">No dated utilisation readings to trend.</p>}
      </CardState>
    </Card>
  )
}

// ── Insights ─────────────────────────────────────────────────────────────────
const INSIGHT_ICON = { shield: ShieldAlert, alert: AlertTriangle, chart: BarChart3, clipboard: ClipboardCheck, pin: MapPinOff, plus: Plus }
function InsightsCard({ state, items, onAction }) {
  return (
    <Card area="sm-a-ins" title="Smart Insights">
      <CardState state={state} empty={state.data && !items.length ? 'Nothing needs attention across these sites.' : null} lines={5}>
        <div className="sm-ins-list">
          {items.map((it) => {
            const Icon = INSIGHT_ICON[it.icon] || AlertTriangle
            return (
              <button key={it.key} type="button" className="cc-insight" onClick={() => onAction(it.action)}>
                <span className={`cc-row-icon t-${it.tone}`}><Icon size={17} aria-hidden="true" /></span>
                <span className="cc-row-main"><b>{it.title}</b><small>{it.meta}</small></span>
                <ChevronRight size={15} className="cc-chev" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </CardState>
    </Card>
  )
}

// ── Row action menu (fixed position so the table scroll cannot clip it) ──────
function RowMenu({ site, canManage, onView, onEdit }) {
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const menu = useRef(null)
  useEffect(() => {
    if (!pos) return undefined
    const close = (e) => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) setPos(null) }
    const esc = (e) => { if (e.key === 'Escape') { setPos(null); btn.current?.focus() } }
    const shut = () => setPos(null)
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    window.addEventListener('scroll', shut, true); window.addEventListener('resize', shut)
    menu.current?.querySelector('button')?.focus()
    return () => {
      document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', shut, true); window.removeEventListener('resize', shut)
    }
  }, [pos])
  const open = (e) => {
    e.stopPropagation()
    if (pos) { setPos(null); return }
    const r = btn.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 190) })
  }
  const pick = (fn) => (e) => { e.stopPropagation(); setPos(null); fn(site) }
  return (
    <>
      <button ref={btn} type="button" className="cc-icon-btn sm-menu-btn" aria-haspopup="menu" aria-expanded={Boolean(pos)} aria-label={`Actions for ${site.name}`} onClick={open}>
        <MoreHorizontal size={16} />
      </button>
      {pos && (
        <div ref={menu} role="menu" className="sm-menu" style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={pick(onView)}><Eye size={14} aria-hidden="true" /> View assets</button>
          {canManage && <button type="button" role="menuitem" onClick={pick(onEdit)}><Edit2 size={14} aria-hidden="true" /> {site.governed ? 'Edit site' : 'Promote to register'}</button>}
        </div>
      )}
    </>
  )
}

const COLS = [
  { key: 'name', label: 'Site Name' }, { key: 'code', label: 'Code' }, { key: 'country', label: 'Country' },
  { key: 'type', label: 'Type' }, { key: 'assets', label: 'Assets' }, { key: 'util', label: 'Utilization', title: UTILIZATION_RULE },
  { key: 'compliance', label: 'Compliance', title: COMPLIANCE_RULE }, { key: 'status', label: 'Status', title: STATUS_RULE },
]

// ── Main ─────────────────────────────────────────────────────────────────────
export default function SiteManagement() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const role = profile?.role
  const canManage = role === 'Admin' || role === 'Manager' || role === 'Director'

  const [params, setParams] = useSearchParams()
  const f = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])), [params])
  const setF = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
      return next
    }, { replace: true })
  }, [setParams])

  const [refreshKey, setRefreshKey] = useState(0)
  const reload = () => setRefreshKey((k) => k + 1)
  const [notice, setNotice] = useState('')
  const [openSite, setOpenSite] = useState(null)
  const [editSite, setEditSite] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showFilters, setShowFilters] = useState(() => ['region', 'source', 'gap'].some((k) => params.get(k)))
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState(() => new Set())
  const dirRef = useRef(null)

  const sites = useCard(async () => {
    const [master, fleet] = await Promise.all([
      sitesApi.listSites({ country: activeCountry }),
      listSiteFleetOps({ country: activeCountry }),
    ])
    return { master: master ?? [], fleet: fleet.rows, opsKnown: fleet.opsKnown }
  }, [activeCountry, refreshKey])
  const util = useCard(() => listSiteUtilization({ country: activeCountry }), [activeCountry, refreshKey])
  const insp = useCard(() => listSiteInspectionDates({ country: activeCountry }), [activeCountry, refreshKey])

  const opsKnown = Boolean(sites.data?.opsKnown)
  const all = useMemo(() => {
    if (!sites.data) return []
    const rollup = sitesApi.buildSiteRollup(sites.data.master, sites.data.fleet)
    return enrichOperational(enrichSites(rollup), {
      masterRows: sites.data.master, utilRows: util.data || [], inspectionRows: insp.data || null, opsKnown,
    })
  }, [sites.data, util.data, insp.data, opsKnown])

  const countries = useMemo(() => countryOptions(all), [all])
  const regions = useMemo(() => regionOptions(all), [all])
  const scoped = useMemo(() => (f.country ? all.filter((s) => s.country === f.country) : all), [all, f.country])
  const kpi = useMemo(() => operationalKpis(scoped), [scoped])
  const health = useMemo(() => healthSummary(scoped, { opsKnown, inspectionsKnown: Boolean(insp.data) }), [scoped, opsKnown, insp.data])
  const counts = useMemo(() => statusCounts(scoped), [scoped])
  const bubbles = useMemo(() => countryBubbles(all), [all])
  const allCounts = useMemo(() => statusCounts(all), [all])
  const types = useMemo(() => siteTypeSegments(scoped), [scoped])
  const insights = useMemo(() => siteInsights(scoped, { health }), [scoped, health])

  const siteAssetKeys = useMemo(() => {
    const set = new Set()
    for (const s of scoped) for (const a of s.assets || []) set.add(`${String(a.asset_no || '').trim().toUpperCase()}|${a.country || ''}`)
    return set
  }, [scoped])
  const trend = useMemo(() => {
    const rows = (util.data || []).filter((r) => {
      const code = String(r.asset_no || '').trim().toUpperCase()
      return siteAssetKeys.has(`${code}|${r.country || ''}`)
    })
    return utilizationByMonth(rows, 6).series
  }, [util.data, siteAssetKeys])
  const utilTrend = trend.length >= 2 ? changePct(trend[trend.length - 1].value, trend[trend.length - 2].value) : null

  // Everything except the status tab, so each tab can show its own count.
  const base = useMemo(() => filterSites(all, { search: f.q, country: f.country, region: f.region, governed: f.source, gap: f.gap, active: '' }),
    [all, f.q, f.country, f.region, f.source, f.gap])
  const filtered = useMemo(() => sortSites(f.status ? base.filter((s) => s._status === f.status) : base, sort.col, sort.dir), [base, f.status, sort])
  const tabCounts = useMemo(() => statusCounts(base), [base])
  useEffect(() => { setPage(0) }, [f.q, f.country, f.region, f.source, f.gap, f.status, pageSize])
  const sortHead = (c) => (
    <button type="button" className="sm-sort-btn" title={c.title} onClick={() => toggleSort(c.key)}
      aria-label={`Sort by ${c.label}`}>
      {c.label}
      {sort.col === c.key ? (sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : <ChevronsUpDown size={12} aria-hidden="true" className="sm-sort-idle" />}
    </button>
  )
  const na = (title) => <span className="cc-na" title={title}>N/A</span>
  const siteCell = {
    name: (s) => (
      <span className="sm-site-name">
        <span className={`sm-site-icon${s.governed ? '' : ' sm-site-derived'}`} title={s.governed ? 'In the site register' : 'Found on fleet records only, not in the site register'}>
          <Building2 size={13} aria-hidden="true" />
        </span>
        <span className="cc-strong">{s.name}</span>
        {!s.governed && <span className="sr-only">(not in the site register)</span>}
      </span>
    ),
    code: (s) => s._code || na(),
    country: (s) => (s.country ? <span>{countryFlag(s.country) && <span aria-hidden="true" className="sm-flag">{countryFlag(s.country)}</span>}{s.country}</span> : na()),
    type: (s) => (s.siteType ? <span className="sm-cap">{s.siteType}</span> : na('Site type not recorded')),
    assets: (s) => <span className="cc-strong">{fmtInt(s.assetCount)}</span>,
    util: (s) => <span title={s._utilAssets ? `${s._utilAssets} assets with telematics` : 'No telematics readings'}><MeterCell value={s._util} suffix="%" /></span>,
    compliance: (s) => <span title={s._assessed ? `${s._assessed} assets assessed, ${s._expiredAssets} with an expired document` : 'No document expiry dates recorded'}>{fmtPct(s._compliance)}</span>,
    status: (s) => { const st = STATUS_META[s._status]; return <span className={`cc-pill ${st?.tone || 'muted'}`}><span className="cc-dot" style={{ background: st?.color }} aria-hidden="true" />{st?.label || 'N/A'}</span> },
  }
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize)
  const extraFilters = ['region', 'source', 'gap'].filter((k) => f[k]).length

  const openAsset = useCallback((a) => navigate(`/asset-management/${encodeURIComponent(a.asset_no)}`), [navigate])
  const toggleSort = (col) => setSort((s) => (s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'name' || col === 'code' || col === 'country' || col === 'type' ? 'asc' : 'desc' }))
  const rowKey = (s) => `${s.country ?? ''}|${s.name}`
  const allOnPage = pageRows.length > 0 && pageRows.every((s) => selected.has(rowKey(s)))
  const togglePage = () => setSelected((prev) => {
    const next = new Set(prev)
    if (allOnPage) pageRows.forEach((s) => next.delete(rowKey(s))); else pageRows.forEach((s) => next.add(rowKey(s)))
    return next
  })
  const toggleRow = (s) => setSelected((prev) => { const n = new Set(prev); const k = rowKey(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const doExport = async (kind, rows = filtered) => {
    const out = siteOpsExportRows(rows, GAP_LABEL)
    const keys = SITE_OPS_EXPORT_COLUMNS.map(([k]) => k)
    const headers = SITE_OPS_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Sites')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name, 'Sites')
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Site Management', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const scrollToDirectory = () => dirRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const onInsight = (a) => {
    if (!a) return
    if (a.type === 'status') { setF({ status: a.value }); scrollToDirectory() }
    else if (a.type === 'gap') { setF({ gap: a.value }); setShowFilters(true); scrollToDirectory() }
    else if (a.type === 'sort') { setSort({ col: a.value, dir: 'asc' }); scrollToDirectory() }
    else if (a.type === 'site') setOpenSite(a.value)
    else if (a.type === 'route') navigate(a.value)
  }

  const kpiLoading = sites.loading && !sites.data
  const failed = Boolean(sites.error)
  const kv = (v) => (failed ? null : v)

  const siteColumns = [
    {
      key: '_sel', sortable: false,
      header: <input type="checkbox" aria-label="Select all sites on this page" checked={allOnPage} onChange={togglePage} />,
      cell: (s) => <span onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.has(rowKey(s))} onChange={() => toggleRow(s)} /></span>,
    },
    ...COLS.map((c) => ({ key: c.key, sortable: false, header: sortHead(c), cell: siteCell[c.key] })),
    {
      key: '_actions', sortable: false, header: 'Actions',
      cell: (s) => <span onClick={(e) => e.stopPropagation()}><RowMenu site={s} canManage={canManage} onView={setOpenSite} onEdit={setEditSite} /></span>,
    },
  ]

  return (
    <div className="cc sm-page">
      <PageHero
        hello="Site Management"
        title="Connected Sites. Greater Uptime."
        lead="Manage sites, capacity, assets and compliance across your operations."
        imgLight="/dashboard/hero-sites-light.webp"
        imgDark="/dashboard/hero-sites-dark.webp"
      />

      {notice && (
        <div className="cc-card sm-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="cc-icon-btn" onClick={() => setNotice('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis sm-kpis">
        <Kpi icon={MapPin} tone="t-green" loading={kpiLoading} display={kv(fmtInt(kpi.total)) ?? 'N/A'} label="Total Sites"
          title={`${fmtInt(countries.length)} countries. Register sites plus sites found on fleet records.`} onClick={() => { setF({ status: '' }); scrollToDirectory() }} />
        <Kpi icon={CheckCircle2} tone="t-green" loading={kpiLoading} display={kv(fmtInt(kpi.active)) ?? 'N/A'} label="Active Sites"
          title={STATUS_RULE} onClick={() => { setF({ status: 'active' }); scrollToDirectory() }} />
        <Kpi icon={BarChart3} tone="t-green" loading={kpiLoading || (util.loading && !util.data)} display={util.error ? 'N/A' : fmtPct(kpi.avgUtil)} label="Avg. Site Utilization"
          trend={utilTrend} title={`${UTILIZATION_RULE} ${fmtInt(kpi.utilAssets)} assets report telematics.${utilTrend != null ? ' Arrow: change from the previous month.' : ''}`} to="/fleet-utilization" />
        <Kpi icon={ShieldCheck} tone="t-green" loading={kpiLoading} display={kv(fmtPct(kpi.complianceRate)) ?? 'N/A'} label="Compliance Rate"
          title={`${COMPLIANCE_RULE} ${fmtInt(kpi.assessedAssets)} assets assessed.${opsKnown ? '' : ' Document expiry dates are not provisioned.'}`}
          onClick={() => { setSort({ col: 'compliance', dir: 'asc' }); scrollToDirectory() }} />
        <Kpi icon={Truck} tone="t-green" loading={kpiLoading} display={kv(fmtInt(kpi.assets)) ?? 'N/A'} label="Assets Assigned"
          title="Fleet assets whose record names one of these sites." to="/fleet-master" />
      </div>

      {sites.error && (
        <div className="cc-card sm-notice sm-error" role="alert">
          <span><AlertTriangle size={15} aria-hidden="true" /> Could not load sites. {sites.error}</span>
          <button type="button" className="cc-btn" onClick={reload}>Retry</button>
        </div>
      )}

      <div className="sm-grid">
        <SiteMap state={sites} bubbles={bubbles} counts={allCounts} country={f.country} countries={countries} onCountry={(c) => setF({ country: c })} />
        <CapacityCard util={util} series={trend} avg={kpi.avgUtil} utilAssets={kpi.utilAssets} siteAssets={kpi.assets} />
        <InsightsCard state={sites} items={insights} onAction={onInsight} />

        <section className="cc-card sm-a-dir" ref={dirRef} aria-label="Site directory">
          <div className="cc-card-head">
            <h2 className="cc-card-title">Site Directory <span className="sm-muted">({fmtInt(filtered.length)} sites)</span></h2>
            <div className="sm-head-actions">
              <button type="button" className="cc-icon-btn" onClick={reload} aria-label="Refresh sites" title="Refresh"><RefreshCw size={14} className={sites.loading ? 'animate-spin' : ''} /></button>
              <button type="button" className="cc-icon-btn" onClick={() => doExport('excel')} disabled={!filtered.length} aria-label="Export sites to Excel" title="Excel"><FileSpreadsheet size={14} /></button>
              <button type="button" className="cc-icon-btn" onClick={() => doExport('pdf')} disabled={!filtered.length} aria-label="Export sites to PDF" title="PDF"><FileText size={14} /></button>
              {canManage && <Link to="/data-intake" className="cc-icon-btn" aria-label="Import sites and regions (Data Intake, Sites and Regions tab)" title="Import sites and regions"><Upload size={14} /></Link>}
            </div>
          </div>
          <div className="sm-dir-bar">
            <label className="cc-search">
              <Search size={15} aria-hidden="true" />
              <input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Search sites, country, region, city or type" aria-label="Search sites" />
            </label>
            <div className="sm-status-tabs">
              <Tabs label="Site status" value={f.status || 'all'} onChange={(k) => setF({ status: k === 'all' ? '' : k })}
                tabs={[{ key: 'all', label: 'All', count: tabCounts.all }, ...SITE_STATUSES.map((s) => ({ key: s.key, label: s.label, count: tabCounts[s.key] }))]} />
            </div>
            <button type="button" className="cc-btn-ghost" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
              <Filter size={14} aria-hidden="true" /> Filters{extraFilters ? ` (${extraFilters})` : ''}
            </button>
          </div>
          {showFilters && (
            <div className="cc-filters sm-filter-panel">
              <label className="cc-field"><span>Region</span>
                <select className="cc-select" value={f.region} onChange={(e) => setF({ region: e.target.value })}>
                  <option value="">All regions</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="cc-field"><span>Source</span>
                <select className="cc-select" value={f.source} onChange={(e) => setF({ source: e.target.value })}>
                  <option value="">All sources</option><option value="governed">Site register</option><option value="derived">Fleet records only</option>
                </select>
              </label>
              <label className="cc-field"><span>Data gap</span>
                <select className="cc-select" value={f.gap} onChange={(e) => setF({ gap: e.target.value })}>
                  <option value="">Any</option>{GAP_KEYS.map((g) => <option key={g} value={g}>{GAP_LABEL[g]}</option>)}
                </select>
              </label>
              {FILTER_KEYS.some((k) => f[k]) && (
                <button type="button" className="cc-btn-ghost" onClick={() => setF(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])))}><X size={14} aria-hidden="true" /> Clear all</button>
              )}
            </div>
          )}
          {selected.size > 0 && (
            <div className="cc-bulk">
              <span className="cc-bulk-count">{selected.size} selected</span>
              <button type="button" className="cc-btn-ghost" onClick={() => doExport('excel', all.filter((s) => selected.has(rowKey(s))))}><Download size={14} aria-hidden="true" /> Export selected</button>
              <button type="button" className="cc-btn-ghost" onClick={() => setSelected(new Set())}><X size={14} aria-hidden="true" /> Clear</button>
            </div>
          )}
          <CardState state={sites} empty={sites.data && !filtered.length ? (all.length ? 'No sites match these filters.' : 'No sites yet. Assets have no site assigned and the site register is empty.') : null} lines={8}>
            <KitTable className="sm-table" manualPagination showPagination={false} enableSorting={false}
              pageIndex={page} pageSize={pageSize} pageCount={Math.max(1, Math.ceil(filtered.length / pageSize))}
              totalRows={filtered.length} onPageChange={setPage} getRowId={(s) => rowKey(s)}
              onRowClick={(s) => setOpenSite(s)} rows={pageRows} columns={siteColumns} />
            <Pager page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={setPageSize} noun="sites" />
          </CardState>
        </section>

        <Card area="sm-a-hlt" title="Site Health Overview">
          <CardState state={sites} lines={4}>
            <div className="sm-health">
              <div className="sm-hl" title={`Sites where no assessed asset has an expired document, out of ${health.assessedSites} sites with recorded expiry dates.`}>
                <span className="cc-row-icon t-green"><ShieldCheck size={17} aria-hidden="true" /></span>
                <div><b>{fmtPct(health.compliantPct)}</b><small>Compliant sites</small></div>
              </div>
              <button type="button" className="sm-hl" onClick={() => { setSort({ col: 'compliance', dir: 'asc' }); scrollToDirectory() }} title="Sites with at least one asset whose insurance, MVIP or operating card has expired.">
                <span className="cc-row-icon t-red"><ShieldAlert size={17} aria-hidden="true" /></span>
                <div><b>{fmtInt(health.atRisk)}</b><small>At risk sites</small></div>
              </button>
              <div className="sm-hl" title={opsKnown ? 'Sites with at least one asset whose operational status is breakdown.' : 'Operational status is not provisioned, so this cannot be measured.'}>
                <span className="cc-row-icon t-blue"><Wrench size={17} aria-hidden="true" /></span>
                <div><b>{fmtInt(health.inMaintenance)}</b><small>Sites with breakdowns</small></div>
              </div>
              <Link className="sm-hl" to="/inspection-planner" title={health.inspectionsDue == null ? 'Inspection history could not be read.' : `Assets last inspected over 30 days ago, across ${health.inspectionSites} sites. Assets never inspected are not counted.`}>
                <span className="cc-row-icon t-amber"><ClipboardCheck size={17} aria-hidden="true" /></span>
                <div><b>{fmtInt(health.inspectionsDue)}</b><small>Inspections due</small></div>
              </Link>
            </div>
          </CardState>
        </Card>

        <Card area="sm-a-typ" title="Site Types Distribution">
          <CardState state={sites} empty={sites.data && !scoped.length ? 'No sites yet.' : null} lines={4}>
            <div className="sm-types"><Donut segments={types} total={scoped.length} centerLabel="Total sites" /></div>
            {types.some((t) => t.label === 'Not recorded') && <p className="sm-cap-note">Sites found only on fleet records have no type until they are added to the register.</p>}
          </CardState>
        </Card>

        <Card area="sm-a-qa" title="Quick Actions">
          <div className="sm-qa">
            <button type="button" className="cc-insight" onClick={() => setShowAdd(true)} disabled={!canManage} title={canManage ? undefined : 'Only Admin, Manager or Director can add sites'}>
              <span className="cc-row-icon t-green"><Plus size={17} aria-hidden="true" /></span>
              <span className="cc-row-main"><b>Add New Site</b><small>Create and configure a new site</small></span>
              <ChevronRight size={15} className="cc-chev" aria-hidden="true" />
            </button>
            <Link className="cc-insight" to="/fleet-master">
              <span className="cc-row-icon t-green"><Boxes size={17} aria-hidden="true" /></span>
              <span className="cc-row-main"><b>Bulk Asset Assignment</b><small>Assign assets to sites in Fleet Master</small></span>
              <ChevronRight size={15} className="cc-chev" aria-hidden="true" />
            </Link>
            <Link className="cc-insight" to="/inspection-planner">
              <span className="cc-row-icon t-green"><ClipboardCheck size={17} aria-hidden="true" /></span>
              <span className="cc-row-main"><b>Schedule Site Inspection</b><small>Plan inspections and audits</small></span>
              <ChevronRight size={15} className="cc-chev" aria-hidden="true" />
            </Link>
            <button type="button" className="cc-insight" onClick={() => doExport('excel')} disabled={!filtered.length}>
              <span className="cc-row-icon t-green"><Download size={17} aria-hidden="true" /></span>
              <span className="cc-row-main"><b>Download Site Report</b><small>Excel of the sites shown, with utilisation and compliance</small></span>
              <ChevronRight size={15} className="cc-chev" aria-hidden="true" />
            </button>
          </div>
        </Card>
      </div>

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
            site_code: editSite._code || '', active: editSite.active,
          } : null}
          onClose={() => { setShowAdd(false); setEditSite(null) }}
          onSaved={() => { setShowAdd(false); setEditSite(null); reload() }}
        />
      )}
    </div>
  )
}
