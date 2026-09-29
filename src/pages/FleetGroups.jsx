/**
 * FleetGroups (route /fleet-groups) - Fleet Groups / holding-company hierarchy,
 * rebuilt on the shared page kit to the owner's light reference design.
 *
 * Runs on the `fleet_groups` table (V189). A group records its name, code,
 * type, parent, region, manager, a typed asset COUNT, budget and status; it
 * does NOT record a list of member assets. Per-group figures that need real
 * assets (utilisation, issues, members, performance) therefore come from the
 * site register: a group whose name or code is a registered site owns the
 * assets registered at that site, and a parent owns its subtree's sites. The
 * rule lives in src/lib/fleetGroupsView.js and is stated on screen. A group
 * with no matched site shows N/A for those figures, never 0.
 *
 * Kept from the previous page: create / edit / delete, the hierarchy (register
 * is in hierarchy order, indented by depth), data-quality findings, Excel and
 * PDF export of the filtered register, loading / error+Retry / not-provisioned
 * states. Budgets in different currencies are never summed.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Users, CheckCircle2, Truck, BarChart3, AlertTriangle, Plus, MoreVertical, Search,
  Pencil, Trash2, Gauge, CalendarCheck, Wrench, FileText, MoreHorizontal, ChevronRight,
  ArrowRight, MapPin, Layers, Building2, User, Calendar, Clock, Network, Bookmark,
  RefreshCw, X, Loader2, Save, FileSpreadsheet, Info,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import {
  Card, CardState, Kpi, PageHero, Donut, Pager, MeterCell, KitTable, fmtInt,
} from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listFleetGroups, createFleetGroup, updateFleetGroup, deleteFleetGroup, GROUP_TYPES,
} from '../lib/api/fleetGroups'
import { loadGroupSites, loadMemberFleet, loadMemberSignals } from '../lib/api/fleetGroupSignals'
import { siteRegionMap } from '../lib/api/sites'
import {
  filterGroups, groupRegisterRows, buildGroupKpis, buildGroupInsights,
  groupExportRows, GROUP_EXPORT_COLUMNS, groupTypeLabel,
} from '../lib/fleetGroupsAnalytics'
import {
  matchGroupSites, regionForGroup, membersFor, latestUtilByAsset, utilizationFor,
  issuesFor, issueHeadline, hierarchyOrder, compositionSegments, lastMonths,
  monthlyUtilization, tyresByAsset, assetKey,
} from '../lib/fleetGroupsView'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { isMissingRelation } from '../lib/api/_client'
import './FleetGroups.css'

const EMPTY_FORM = {
  group_name: '', group_code: '', group_type: '', parent_group: '',
  manager: '', region: '', asset_count: '', budget: '', currency: '', active: true, notes: '',
}

const TYPE_TONE = {
  holding: 'info', subsidiary: 'fg-purple', division: 'good', depot: 'orange', cost_center: 'warn', custom: 'muted',
}
const DONUT_COLORS = ['#16a34a', '#f59e0b', '#0d9488', '#2563eb', '#db2777', '#eab308', '#92400e', '#0f766e', '#7c3aed', '#64748b']
const MEMBERS_RULE = 'Fleet groups store an asset count, not a member list. Members are the assets registered at the site whose name or code matches the group (a parent group includes the sites of every group beneath it).'
const ISSUE_RULE = 'Open issues on member assets: open corrective actions, fitted tyres rated Critical, and active maintenance plans past their due date. Groups with no matched site cannot be assessed.'
const VIEWS_KEY = 'fleetGroups.views.v1'

function readViews() {
  try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function writeViews(v) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)) } catch { /* storage unavailable: views stay for this visit only */ }
}

function relTime(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return 'N/A'
  const m = Math.round((now - t) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 31) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtDate = (iso) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'
}

/** Popover menu positioned against the viewport so a scrolling table never clips it. */
function Menu({ label, trigger, items, className = 'cc-icon-btn', align = 'right', children }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const pop = useRef(null)
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 4, left: align === 'right' ? undefined : r.left, right: align === 'right' ? window.innerWidth - r.right : undefined })
  }, [align])
  useEffect(() => {
    if (!open) return undefined
    place()
    const onDoc = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, place])
  useEffect(() => { if (open) pop.current?.querySelector('button,a,input')?.focus() }, [open, pos])
  return (
    <>
      <button ref={btn} type="button" className={className} aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
        {trigger}
      </button>
      {open && pos && (
        <div ref={pop} className="fg-menu" role="menu" style={{ top: pos.top, left: pos.left, right: pos.right }} onClick={(e) => e.stopPropagation()}>
          {children}
          {(items || []).filter(Boolean).map((it) => (
            <button key={it.label} type="button" role="menuitem" className={`fg-menu-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick() }}>
              {it.icon && <it.icon size={14} aria-hidden="true" />} {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function TypePill({ type }) {
  if (!type) return <span className="cc-na">N/A</span>
  return <span className={`cc-pill ${TYPE_TONE[type] || 'muted'}`}>{groupTypeLabel(type)}</span>
}

/** Monthly utilisation bars (0 to 100%). A month with no snapshot is a gap. */
function UtilBars({ series }) {
  const W = 290; const H = 160; const L = 32; const B = 24; const T = 8
  const plotH = H - B - T
  const step = (W - L) / Math.max(series.length, 1)
  const barW = Math.min(34, step * 0.56)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fg-bars" role="img"
      aria-label={series.map((s) => `${s.label} ${s.value == null ? 'no data' : `${Math.round(s.value)}%`}`).join(', ')}>
      {[0, 25, 50, 75, 100].map((v) => {
        const y = T + plotH - (v / 100) * plotH
        return (
          <g key={v}>
            <line x1={L} x2={W} y1={y} y2={y} className="fg-grid" />
            <text x={L - 6} y={y + 3} textAnchor="end" className="fg-axis">{v}%</text>
          </g>
        )
      })}
      {series.map((s, i) => {
        const x = L + i * step + (step - barW) / 2
        const h = s.value == null ? 0 : (Math.max(0, Math.min(100, s.value)) / 100) * plotH
        return (
          <g key={s.month}>
            {s.value == null
              ? <text x={x + barW / 2} y={T + plotH - 4} textAnchor="middle" className="fg-axis">N/A</text>
              : <rect x={x} y={T + plotH - h} width={barW} height={h} rx="3" style={{ fill: 'var(--cc-green)' }}><title>{`${s.label}: ${Math.round(s.value)}% from ${s.samples} snapshot(s)`}</title></rect>}
            <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="fg-axis">{s.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

export default function FleetGroups() {
  const { activeCountry, activeCurrency } = useSettings()
  const currency = activeCurrency || 'SAR'
  const countryScope = activeCountry && activeCountry !== 'All' ? activeCountry : ''
  const [params, setParams] = useSearchParams()
  const search = params.get('q') || ''
  const typeFilter = params.get('type') || ''
  const regionFilter = params.get('region') || ''
  const activeFilter = params.get('status') || ''
  const page = Math.max(0, Number(params.get('page')) || 0)
  const pageSize = [10, 25, 50].includes(Number(params.get('size'))) ? Number(params.get('size')) : 10
  const selectedId = params.get('g') || ''

  const setParam = useCallback((patch, keepPage = false) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v === '' || v == null) next.delete(k); else next.set(k, String(v))
      }
      if (!keepPage && !('page' in patch)) next.delete('page')
      return next
    }, { replace: true })
  }, [setParams])

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [checked, setChecked] = useState(() => new Set())

  const [views, setViews] = useState(readViews)
  const [viewName, setViewName] = useState('')

  const [perfMonths, setPerfMonths] = useState(6)
  const [membersGroupId, setMembersGroupId] = useState('')
  const [membersPage, setMembersPage] = useState(0)
  const membersRef = useRef(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listFleetGroups({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load fleet groups.'))
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])
  useEffect(() => { load() }, [load])

  const loading = rows === null && !error
  const all = useMemo(() => rows || [], [rows])

  // Linked registers: site register, member fleet, member signals.
  const [linked, setLinked] = useState({ loading: true, error: null, sites: [], fleet: [], signals: null })
  const [linkNonce, setLinkNonce] = useState(0)
  useEffect(() => {
    if (rows === null) return undefined
    let alive = true
    setLinked((s) => ({ ...s, loading: true, error: null }))
    ;(async () => {
      try {
        const sites = await loadGroupSites({ country: activeCountry })
        const matched = matchGroupSites(rows, sites)
        const siteNames = [...new Set([...matched.values()].flat())]
        const fleet = await loadMemberFleet(siteNames, { country: activeCountry })
        const signals = await loadMemberSignals(fleet.map((a) => a.asset_no), { country: activeCountry })
        if (alive) setLinked({ loading: false, error: null, sites, fleet, signals })
      } catch (e) {
        if (alive) setLinked({ loading: false, error: toUserMessage(e, 'Could not load the linked fleet data.'), sites: [], fleet: [], signals: null })
      }
    })()
    return () => { alive = false }
  }, [rows, activeCountry, linkNonce])
  const retryLinked = () => setLinkNonce((n) => n + 1)

  const regionMap = useMemo(() => siteRegionMap(linked.sites), [linked.sites])
  const matched = useMemo(() => matchGroupSites(all, linked.sites), [all, linked.sites])
  const latestUtil = useMemo(() => latestUtilByAsset(linked.signals?.util || []), [linked.signals])
  const tyreCounts = useMemo(() => tyresByAsset(linked.signals?.tyres || []), [linked.signals])

  // Per-group derived view, keyed by id.
  const derived = useMemo(() => {
    const map = new Map()
    for (const g of all) {
      const sites = matched.get(g.id) || []
      const members = membersFor(sites, linked.fleet, countryScope ? '' : (g.country || ''))
      const util = sites.length ? utilizationFor(members, latestUtil) : { value: null, measured: 0, total: 0 }
      const issues = sites.length && linked.signals ? issuesFor(members, linked.signals) : null
      map.set(g.id, { sites, members, util, issues, region: regionForGroup(g, sites, regionMap) })
    }
    return map
  }, [all, matched, linked.fleet, linked.signals, latestUtil, regionMap, countryScope])

  const kpi = useMemo(() => buildGroupKpis(all, currency), [all, currency])
  const insights = useMemo(() => buildGroupInsights(all, currency), [all, currency])

  const grouped = useMemo(() => {
    const assets = new Map()
    for (const d of derived.values()) for (const a of d.members) assets.set(`${assetKey(a.asset_no)}|${a.country || ''}`, a)
    const list = [...assets.values()]
    const u = utilizationFor(list, latestUtil)
    let withIssues = 0; let assessed = 0
    for (const d of derived.values()) {
      if (d.issues?.total != null) { assessed += 1; if (d.issues.total > 0) withIssues += 1 }
    }
    return { matchedAssets: list.length, util: u, withIssues, assessed }
  }, [derived, latestUtil])

  const regionOptions = useMemo(() => {
    const s = new Set()
    for (const d of derived.values()) if (d.region.region) s.add(d.region.region)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [derived])

  const filtered = useMemo(() => {
    const base = filterGroups(all, { type: typeFilter, active: activeFilter, search })
    return regionFilter ? base.filter((g) => derived.get(g.id)?.region.region === regionFilter) : base
  }, [all, typeFilter, activeFilter, search, regionFilter, derived])

  const register = useMemo(() => {
    const keep = new Set(filtered.map((g) => g.id))
    const enriched = new Map(groupRegisterRows(filtered, all).map((r) => [r.id, r]))
    return hierarchyOrder(all).filter((x) => keep.has(x.row.id)).map((x) => ({ ...enriched.get(x.row.id), depth: x.depth }))
  }, [filtered, all])

  const pages = Math.max(1, Math.ceil(register.length / pageSize))
  const safePage = Math.min(page, pages - 1)
  const pageRows = register.slice(safePage * pageSize, safePage * pageSize + pageSize)

  const selected = useMemo(
    () => all.find((g) => String(g.id) === selectedId) || register[0] || null,
    [all, selectedId, register],
  )
  const selectedReg = useMemo(() => (selected ? groupRegisterRows([selected], all)[0] : null), [selected, all])
  const selD = selected ? derived.get(selected.id) : null

  const membersGroup = all.find((g) => String(g.id) === membersGroupId) || selected
  const membersD = membersGroup ? derived.get(membersGroup.id) : null
  useEffect(() => { setMembersPage(0) }, [membersGroupId, selected?.id])

  const segments = useMemo(() => compositionSegments(all, DONUT_COLORS), [all])
  const segTotal = segments.reduce((s, x) => s + x.count, 0)

  const months = useMemo(() => lastMonths(perfMonths), [perfMonths])
  const perfSeries = useMemo(() => {
    if (!selD) return []
    return monthlyUtilization(selD.members, linked.signals?.util || [], months).map((m) => ({
      ...m, label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' }),
    }))
  }, [selD, linked.signals, months])
  const perfHasData = perfSeries.some((s) => s.value != null)

  const topIssues = useMemo(() => all
    .map((g) => ({ g, iss: derived.get(g.id)?.issues }))
    .filter((x) => x.iss?.total > 0)
    .sort((a, b) => b.iss.total - a.iss.total || String(a.g.group_name).localeCompare(String(b.g.group_name)))
    .slice(0, 5), [all, derived])

  // Exports walk the full filtered register (or the ticked rows), never one page.
  const scopeLabel = countryScope || 'All countries'
  const exportRowsFor = (list) => groupExportRows(list, all, currency)
  const doExcel = async (list = filtered) => {
    setActionError('')
    try {
      await exportToExcel(exportRowsFor(list), GROUP_EXPORT_COLUMNS.map((c) => c.key), GROUP_EXPORT_COLUMNS.map((c) => c.header), reportFileName('Fleet Groups', scopeLabel))
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async (list = filtered) => {
    setActionError('')
    try {
      await exportToPdf(exportRowsFor(list), GROUP_EXPORT_COLUMNS, `Fleet Groups Hierarchy (${scopeLabel})`, reportFileName('Fleet Groups', scopeLabel), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // Create / edit / delete (unchanged behaviour).
  const parentOptions = useMemo(() => [...new Set(all.map((r) => r.group_name).filter(Boolean))].sort(), [all])
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      group_name: r.group_name || '', group_code: r.group_code || '',
      group_type: r.group_type || '', parent_group: r.parent_group || '',
      manager: r.manager || '', region: r.region || '',
      asset_count: r.asset_count ?? '', budget: r.budget ?? '',
      currency: r.currency || '', active: r.active !== false, notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.group_name.trim()) { setFormError('A group name is required.'); return }
    if (form.parent_group && form.parent_group.trim() === form.group_name.trim()) {
      setFormError('A group cannot be its own parent.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        asset_count: form.asset_count === '' ? null : form.asset_count,
        budget: form.budget === '' ? null : form.budget,
        parent_group: form.parent_group || null,
        group_type: form.group_type || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateFleetGroup(editing.id, payload)
      else await createFleetGroup(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the group.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const closeDelete = () => { if (!deleting) { setConfirmDelete(null); setDeleteError('') } }
  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setDeleteError('')
    try {
      const targets = confirmDelete.bulk || [confirmDelete]
      for (const t of targets) await deleteFleetGroup(t.id)
      setConfirmDelete(null)
      setChecked(new Set())
      await load()
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the group.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const selectGroup = (g) => setParam({ g: g.id }, true)
  const hasFilters = search || typeFilter || regionFilter || activeFilter
  const clearFilters = () => setParam({ q: '', type: '', region: '', status: '' })

  const saveView = () => {
    const name = viewName.trim()
    if (!name) return
    const next = [...views.filter((v) => v.name !== name), { name, params: { q: search, type: typeFilter, region: regionFilter, status: activeFilter } }]
    setViews(next); writeViews(next); setViewName('')
  }
  const applyView = (v) => setParam({ q: v.params.q || '', type: v.params.type || '', region: v.params.region || '', status: v.params.status || '' })
  const removeView = (name) => { const next = views.filter((v) => v.name !== name); setViews(next); writeViews(next) }

  const toggle = (id) => setChecked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pageIds = pageRows.map((r) => r.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => checked.has(id))
  const toggleAll = () => setChecked((prev) => {
    const n = new Set(prev)
    if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id))
    return n
  })
  const checkedRows = all.filter((g) => checked.has(g.id))

  const linkedState = { loading: linked.loading, error: linked.error, retry: retryLinked, data: linked.loading ? null : true }
  const noMatches = !linked.loading && ![...derived.values()].some((d) => d.sites.length)

  const kpis = [
    { icon: Users, tone: 't-green', value: kpi.total, label: 'Total Groups', title: `${kpi.inactive} inactive. Depth ${kpi.maxDepth ?? 0}, ${kpi.roots} top-level group(s).` },
    { icon: CheckCircle2, tone: 't-green', value: kpi.active, label: 'Active Groups', title: 'Groups marked active.' },
    { icon: Truck, tone: 't-green', value: kpi.totalAssets, label: 'Grouped Assets', title: kpi.totalAssets == null ? 'No group records an asset count yet.' : `Sum of each group's own recorded asset count (children are not counted twice).${kpi.assetCoverage != null && kpi.assetCoverage < 1 ? ` ${Math.round(kpi.assetCoverage * 100)}% of groups record a count.` : ''}` },
    {
      icon: BarChart3, tone: 't-green', label: 'Avg. Utilization',
      display: linked.loading ? '...' : grouped.util.value == null ? 'N/A' : `${Math.round(grouped.util.value)}%`,
      title: grouped.util.value == null
        ? 'No grouped asset has a telematics utilisation snapshot. Groups link to assets through the site register.'
        : `Mean of the latest telematics utilisation for ${grouped.util.measured} of ${grouped.matchedAssets} grouped asset(s) with a snapshot.`,
    },
    {
      icon: AlertTriangle, tone: 't-red', danger: true, label: 'Groups with Issues',
      display: linked.loading ? '...' : grouped.assessed ? fmtInt(grouped.withIssues) : 'N/A',
      title: `${ISSUE_RULE} ${grouped.assessed} group(s) could be assessed.`,
    },
  ]

  const na = (t = 'N/A') => <span className="cc-na">{t}</span>
  const groupColumns = [
    {
      key: '_sel', sortable: false,
      header: <input type="checkbox" aria-label="Select all groups on this page" checked={allOnPage} onChange={toggleAll} />,
      cell: (r) => <span onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.group_name}`} checked={checked.has(r.id)} onChange={() => toggle(r.id)} /></span>,
    },
    {
      key: 'group_name', header: 'Group Name',
      cell: (r) => (
        <span className="fg-name" style={{ paddingLeft: Math.min(r.depth || 0, 6) * 14 }}>
          {r.depth > 0 && <span className="fg-branch" aria-hidden="true" />}
          <button type="button" className="fg-name-btn" onClick={(e) => { e.stopPropagation(); selectGroup(r) }}>{r.group_name || 'N/A'}</button>
        </span>
      ),
    },
    { key: 'group_code', header: 'Code', cell: (r) => r.group_code || na() },
    { key: 'group_type', header: 'Type', cell: (r) => <TypePill type={r.group_type} /> },
    { key: 'region', header: 'Region', cell: (r) => { const d = derived.get(r.id); return <span title={d?.region.derived ? 'From the site register' : undefined}>{d?.region.region || na()}</span> } },
    {
      key: 'assets', header: 'Assets', align: 'right',
      cell: (r) => (
        <span className="cc-strong" title={r.ownAssets != null && r.ownAssets !== r.rolledAssets ? `${fmtInt(r.ownAssets)} own, ${fmtInt(r.rolledAssets)} including child groups` : 'Recorded asset count, including child groups'}>
          {r.ownAssets == null && !r.rolledAssets ? na() : fmtInt(r.rolledAssets)}
        </span>
      ),
    },
    {
      key: 'util', header: 'Utilization',
      cell: (r) => { const d = derived.get(r.id); return <span title={d?.sites.length ? `${d.util.measured} of ${d.util.total} member asset(s) have a snapshot` : MEMBERS_RULE}>{linked.loading ? na('...') : <MeterCell value={d?.util.value} suffix="%" />}</span> },
    },
    { key: 'status', header: 'Status', cell: (r) => <span className={`cc-pill ${r.isActive ? 'good' : 'muted'}`}>{r.isActive ? 'Active' : 'Inactive'}</span> },
    {
      key: 'issues', header: 'Issues',
      cell: (r) => {
        const d = derived.get(r.id)
        return (
          <span title={d?.issues ? `${d.issues.actions ?? 'N/A'} open action(s), ${d.issues.tyres ?? 'N/A'} critical tyre(s), ${d.issues.pm ?? 'N/A'} overdue plan(s)` : 'No matched site, so issues cannot be measured'}>
            {d?.issues?.total == null ? na(linked.loading ? '...' : 'N/A') : <span className={`fg-count ${d.issues.total > 0 ? 'bad' : 'ok'}`}>{d.issues.total}</span>}
          </span>
        )
      },
    },
    {
      key: '_actions', header: 'Actions', sortable: false,
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu label={`Actions for ${r.group_name}`} className="fg-row-btn" trigger={<MoreHorizontal size={16} aria-hidden="true" />} items={[
            { label: 'View details', icon: Info, onClick: () => selectGroup(r) },
            { label: 'Edit group', icon: Pencil, onClick: () => openEdit(r) },
            { label: 'Delete group', icon: Trash2, danger: true, onClick: () => { setDeleteError(''); setConfirmDelete(r) } },
          ]} />
        </span>
      ),
    },
  ]
  const memberColumns = [
    { key: 'asset_no', header: 'Asset ID', cell: (a) => <Link className="fg-link" to={`/asset-management/${encodeURIComponent(a.asset_no)}`}>{a.asset_no}</Link> },
    { key: 'make', header: 'Make / Model', cell: (a) => [a.make, a.model].filter(Boolean).join(' ') || na() },
    { key: 'fleet_number', header: 'Fleet No.', cell: (a) => a.fleet_number || na() },
    { key: 'site', header: 'Site', cell: (a) => a.site || na() },
    { key: 'tyres', header: 'Tyres', align: 'right', cell: (a) => (linked.signals?.tyres == null ? na() : fmtInt(tyreCounts.get(assetKey(a.asset_no)) || 0)) },
    {
      key: 'status', header: 'Status',
      cell: (a) => {
        const st = a.ops_status || a.status || ''
        const tone = /inactive|scrap|breakdown/i.test(st) ? 'bad' : /maint|repair|idle|reallocation/i.test(st) ? 'warn' : st ? 'good' : 'muted'
        return st ? <span className={`cc-pill ${tone}`}>{st.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</span> : na()
      },
    },
  ]
  return (
    <div className="cc fg-page">
      <PageHero
        title="Fleet Groups"
        lead={<>Organize, monitor and optimize your fleet by group.<span className="fg-lead-2">Group assets by operation, region, customer or any structure that fits your business.</span></>}
        imgLight="/dashboard/hero-groups-light.webp"
        imgDark="/dashboard/hero-groups-dark.webp"
      />

      {notProvisioned && (
        <div className="cc-card fg-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><b>Fleet Groups is not enabled on this database yet.</b><p>Apply MIGRATIONS_V189_FLEET_GROUPS.sql, then reload.</p></div>
        </div>
      )}
      {error && (
        <div className="cc-card fg-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><b>Could not load fleet groups.</b><p>{error}</p></div>
          <button type="button" className="cc-btn-ghost" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && (
        <div className="cc-card fg-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><p>{actionError}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis fg-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      <div className="fg-layout">
        <div className="fg-main">
          <Card
            className="fg-registry"
            title="Group Registry"
            sub="All fleet groups across your organization."
            action={
              <div className="fg-head-actions">
                <Menu label="Saved views" className="cc-btn-ghost" align="right" trigger={<><Bookmark size={14} aria-hidden="true" /> Saved Views</>}>
                  <div className="fg-menu-section">
                    {views.length === 0 && <p className="fg-menu-note">No saved views yet.</p>}
                    {views.map((v) => (
                      <div key={v.name} className="fg-menu-row">
                        <button type="button" role="menuitem" className="fg-menu-item" onClick={() => applyView(v)}>{v.name}</button>
                        <button type="button" className="fg-menu-x" aria-label={`Delete view ${v.name}`} onClick={() => removeView(v.name)}><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                  <form className="fg-menu-save" onSubmit={(e) => { e.preventDefault(); saveView() }}>
                    <label htmlFor="fg-view-name" className="sr-only">View name</label>
                    <input id="fg-view-name" value={viewName} maxLength={40} onChange={(e) => setViewName(e.target.value)} placeholder="Save current filters as..." />
                    <button type="submit" className="cc-btn" disabled={!viewName.trim()}>Save</button>
                  </form>
                </Menu>
                <button type="button" className="cc-btn-primary" onClick={openCreate} disabled={notProvisioned}><Plus size={15} aria-hidden="true" /> Create Group</button>
                <Menu label="More registry actions" trigger={<MoreVertical size={15} aria-hidden="true" />} items={[
                  { label: 'Export Excel', icon: FileSpreadsheet, onClick: () => doExcel(), disabled: !filtered.length },
                  { label: 'Export PDF', icon: FileText, onClick: () => doPdf(), disabled: !filtered.length },
                  { label: refreshing ? 'Refreshing...' : 'Refresh', icon: RefreshCw, onClick: () => { load(); retryLinked() } },
                ]} />
              </div>
            }
          >
            <div className="fg-registry-body">
              <div className="fg-registry-table">
                <div className="cc-filters fg-filters">
                  <div className="cc-search">
                    <Search size={15} aria-hidden="true" />
                    <label htmlFor="fg-search" className="sr-only">Search groups</label>
                    <input id="fg-search" value={search} onChange={(e) => setParam({ q: e.target.value })} placeholder="Search groups by name, code or description..." />
                  </div>
                  <select className="cc-select" aria-label="Group type" value={typeFilter} onChange={(e) => setParam({ type: e.target.value })}>
                    <option value="">All group types</option>
                    {GROUP_TYPES.map((t) => <option key={t} value={t}>{groupTypeLabel(t)}</option>)}
                  </select>
                  <select className="cc-select" aria-label="Region" value={regionFilter} onChange={(e) => setParam({ region: e.target.value })}>
                    <option value="">All regions</option>
                    {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select className="cc-select" aria-label="Status" value={activeFilter} onChange={(e) => setParam({ status: e.target.value })}>
                    <option value="">Status: All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={13} aria-hidden="true" /> Clear</button>}
                </div>

                {checked.size > 0 && (
                  <div className="cc-bulk">
                    <span className="cc-bulk-count">{checked.size} selected</span>
                    <button type="button" className="cc-btn-ghost" onClick={() => doExcel(checkedRows)}><FileSpreadsheet size={14} aria-hidden="true" /> Export selected</button>
                    <button type="button" className="cc-btn-ghost fg-danger" onClick={() => { setDeleteError(''); setConfirmDelete({ bulk: checkedRows, group_name: `${checkedRows.length} groups` }) }}><Trash2 size={14} aria-hidden="true" /> Delete selected</button>
                    <button type="button" className="cc-btn-ghost" onClick={() => setChecked(new Set())}>Clear selection</button>
                  </div>
                )}

                <CardState
                  state={{ loading, error: error && rows === null ? error : null, retry: load, data: rows }}
                  empty={register.length === 0 ? (all.length === 0 ? (notProvisioned ? 'Fleet Groups is not enabled yet.' : 'No groups yet. Create your first group.') : 'No groups match these filters.') : null}
                  lines={8}
                >
                  <KitTable className="fg-table" manualPagination showPagination={false} enableSorting={false}
                    pageIndex={safePage} pageSize={pageSize} pageCount={Math.max(1, Math.ceil(register.length / pageSize))}
                    totalRows={register.length} getRowId={(r) => String(r.id)} onRowClick={selectGroup}
                    rows={pageRows} columns={groupColumns} />
                  <Pager page={safePage} pageSize={pageSize} total={register.length} noun="groups"
                    onPage={(p) => setParam({ page: p || '' }, true)}
                    onPageSize={(s) => setParam({ size: s === 10 ? '' : s })} sizes={[10, 25, 50]} />
                </CardState>
                {insights.length > 0 && (
                  <details className="fg-notes">
                    <summary><Info size={13} aria-hidden="true" /> {insights.length} data note{insights.length === 1 ? '' : 's'}</summary>
                    <ul>{insights.map((s) => <li key={s}>{s}</li>)}</ul>
                  </details>
                )}
              </div>

              <section className="fg-comp" aria-label="Fleet composition by group">
                <div className="cc-card-head">
                  <div>
                    <h3 className="cc-card-title">Fleet Composition by Group</h3>
                    <p className="cc-card-sub">Share of recorded assets.</p>
                  </div>
                </div>
                {loading ? <div className="cc-skel" style={{ height: 200 }} />
                  : segments.length === 0 ? <div className="cc-empty">No group records an asset count yet.</div>
                    : <Donut segments={segments} total={segTotal} centerLabel="Assets"
                      onSelect={(s) => { const g = all.find((x) => x.group_name === s.label); if (g) selectGroup(g) }} />}
              </section>
            </div>
          </Card>

          <div className="fg-bottom">
            <Card
              title="Group Performance"
              sub={selected ? selected.group_name : 'Utilization by month'}
              action={
                <select className="cc-select" aria-label="Performance period" value={perfMonths} onChange={(e) => setPerfMonths(Number(e.target.value))}>
                  <option value={3}>Last 3 months</option>
                  <option value={6}>Last 6 months</option>
                  <option value={12}>Last 12 months</option>
                </select>
              }
            >
              <CardState state={linkedState} lines={4}
                empty={!selected ? 'Select a group to see its performance.'
                  : !selD?.sites.length ? 'This group matches no registered site, so it has no measured members.'
                    : !perfHasData ? 'No telematics utilisation snapshot was captured for this group\'s assets in this period.' : null}>
                <div className="fg-perf">
                  <UtilBars series={perfSeries} />
                  <p className="fg-foot"><span className="fg-dot" aria-hidden="true" /> Utilization (mean of telematics snapshots). No monthly tyre health index is recorded, so none is drawn.</p>
                </div>
              </CardState>
            </Card>

            <Card
              title="Group Members & Assets"
              action={
                <select className="cc-select fg-member-select" aria-label="Group for members" value={membersGroup?.id || ''} onChange={(e) => setMembersGroupId(e.target.value)}>
                  {all.map((g) => <option key={g.id} value={g.id}>{g.group_name}{g.group_code ? ` (${g.group_code})` : ''}</option>)}
                </select>
              }
            >
              <div ref={membersRef} id="fg-members" />
              <CardState state={linkedState} lines={5}
                empty={!membersGroup ? 'No groups yet.'
                  : !membersD?.sites.length ? <span title={MEMBERS_RULE}>No registered site matches this group, so no member assets can be listed. Name the group or its code after a site in Site Management.</span>
                    : membersD.members.length === 0 ? `No assets are registered at ${membersD.sites.join(', ')}.` : null}>
                {membersD && (
                  <>
                    <KitTable compact className="fg-members" getRowId={(a) => String(a.id)}
                      rows={membersD.members.slice(membersPage * 5, membersPage * 5 + 5)} columns={memberColumns} />
                    <div className="fg-card-foot">
                      <span>Showing {fmtInt(Math.min(membersD.members.length, membersPage * 5 + 1))} to {fmtInt(Math.min(membersD.members.length, membersPage * 5 + 5))} of {fmtInt(membersD.members.length)} assets</span>
                      <span className="fg-mini-pager">
                        <button type="button" className="cc-icon-btn" aria-label="Previous members" disabled={membersPage === 0} onClick={() => setMembersPage((p) => p - 1)}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /></button>
                        <button type="button" className="cc-icon-btn" aria-label="Next members" disabled={(membersPage + 1) * 5 >= membersD.members.length} onClick={() => setMembersPage((p) => p + 1)}><ChevronRight size={14} /></button>
                      </span>
                    </div>
                  </>
                )}
              </CardState>
            </Card>

            <Card title="Top Issues by Group" sub="Open right now" action={<span className="fg-info" title={ISSUE_RULE}><Info size={14} aria-label="How issues are counted" /></span>}>
              <CardState state={linkedState} lines={5}
                empty={noMatches ? 'No group matches a registered site, so issues cannot be measured yet.'
                  : topIssues.length === 0 ? 'No open issues on grouped assets.' : null}>
                <ul className="fg-issues">
                  {topIssues.map(({ g, iss }) => (
                    <li key={g.id}>
                      <button type="button" onClick={() => selectGroup(g)}>
                        <span className="fg-issue-name">{g.group_name}</span>
                        <span className="fg-count bad">{iss.total}</span>
                        <span className="fg-issue-text">{issueHeadline(iss)}</span>
                        <ChevronRight size={14} className="cc-chev" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <Link to="/actions" className="cc-link fg-view-all">View all issues <ArrowRight size={13} aria-hidden="true" /></Link>
              </CardState>
            </Card>
          </div>
        </div>

        <aside className="fg-rail">
          <Card title="Group Insights" className="fg-insights">
            {loading ? <CardState state={{ loading: true }} lines={6} />
              : !selected ? <div className="cc-empty">No group selected.</div>
                : (
                  <>
                    <div className="fg-ins-head">
                      <span className="cc-kpi-icon t-green"><Users size={20} aria-hidden="true" /></span>
                      <div className="fg-ins-title">
                        <b>{selected.group_name}</b>
                        <span>{selected.group_code || 'No code'}</span>
                      </div>
                      <span className={`cc-pill ${selected.active !== false ? 'good' : 'muted'}`}>{selected.active !== false ? 'Active' : 'Inactive'}</span>
                    </div>
                    <dl className="fg-ins-list">
                      <div><dt><Layers size={14} aria-hidden="true" /> Type</dt><dd>{selected.group_type ? groupTypeLabel(selected.group_type) : 'N/A'}</dd></div>
                      <div><dt><MapPin size={14} aria-hidden="true" /> Region</dt><dd title={selD?.region.derived ? 'From the site register' : undefined}>{selD?.region.region || 'N/A'}</dd></div>
                      <div><dt><Network size={14} aria-hidden="true" /> Parent</dt><dd>{selected.parent_group || 'Top level'}</dd></div>
                      <div><dt><Truck size={14} aria-hidden="true" /> Assets</dt><dd title="Recorded count including child groups">{selectedReg?.ownAssets == null && !selectedReg?.rolledAssets ? 'N/A' : `${fmtInt(selectedReg?.rolledAssets)} vehicles`}</dd></div>
                      <div><dt><Building2 size={14} aria-hidden="true" /> Sites</dt><dd title={selD?.sites.length ? `${selD.sites.join(', ')}. ${selD.members.length} asset(s) registered there.` : MEMBERS_RULE}>{linked.loading ? '...' : selD?.sites.length ? `${selD.sites.length} site${selD.sites.length === 1 ? '' : 's'}` : 'None matched'}</dd></div>
                      <div><dt><User size={14} aria-hidden="true" /> Manager</dt><dd>{selected.manager || 'N/A'}</dd></div>
                      <div><dt><FileText size={14} aria-hidden="true" /> Budget</dt><dd>{selectedReg?.budgetValue == null ? 'N/A' : formatCurrencyCompact(selectedReg.budgetValue, selected.currency || currency)}</dd></div>
                      <div><dt><Calendar size={14} aria-hidden="true" /> Created</dt><dd>{fmtDate(selected.created_at)}</dd></div>
                      <div><dt><Clock size={14} aria-hidden="true" /> Last updated</dt><dd>{relTime(selected.updated_at)}</dd></div>
                    </dl>
                    <button type="button" className="cc-btn fg-details-btn" onClick={() => { setMembersGroupId(String(selected.id)); membersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}>
                      View Group Details <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </>
                )}
          </Card>

          <Card title="Quick Actions">
            <ul className="fg-quick">
              <li><button type="button" disabled={!selected} onClick={() => selected && openEdit(selected)}><Pencil size={16} aria-hidden="true" /> Edit Group <ChevronRight size={14} className="cc-chev" aria-hidden="true" /></button></li>
              <li><Link to="/fleet-master" title="Members follow each asset's site, which is set in Fleet Master"><Users size={16} aria-hidden="true" /> Manage Members <ChevronRight size={14} className="cc-chev" aria-hidden="true" /></Link></li>
              <li><Link to="/tyre-lifecycle"><Gauge size={16} aria-hidden="true" /> View Tyre Health <ChevronRight size={14} className="cc-chev" aria-hidden="true" /></Link></li>
              <li><Link to="/inspection-planner"><CalendarCheck size={16} aria-hidden="true" /> Schedule Inspection <ChevronRight size={14} className="cc-chev" aria-hidden="true" /></Link></li>
              <li><Link to="/pm-programs"><Wrench size={16} aria-hidden="true" /> Create Maintenance Plan <ChevronRight size={14} className="cc-chev" aria-hidden="true" /></Link></li>
              <li><button type="button" disabled={!filtered.length} onClick={() => doExcel()}><FileText size={16} aria-hidden="true" /> Export Report <ChevronRight size={14} className="cc-chev" aria-hidden="true" /></button></li>
              <li>
                <Menu label="More actions" className="fg-quick-more" align="right" trigger={<><MoreHorizontal size={16} aria-hidden="true" /> More Actions <ChevronRight size={14} className="cc-chev" aria-hidden="true" /></>} items={[
                  { label: 'Export PDF', icon: FileText, onClick: () => doPdf(), disabled: !filtered.length },
                  { label: 'Create group', icon: Plus, onClick: openCreate, disabled: notProvisioned },
                  selected && { label: 'Delete selected group', icon: Trash2, danger: true, onClick: () => { setDeleteError(''); setConfirmDelete(selected) } },
                ]} />
              </li>
            </ul>
          </Card>
        </aside>
      </div>

      {showModal && (
        <Modal open onClose={closeModal} size="lg" title={editing ? 'Edit group' : 'New fleet group'}>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="fg-name">Group name *</label>
                <input id="fg-name" className="input w-full" placeholder="e.g. Gulf Logistics Holding" value={form.group_name} maxLength={200} required onChange={(e) => set('group_name', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Use a site name (or code) to link the group to that site&apos;s assets.</p>
              </div>
              <div>
                <label className="label" htmlFor="fg-code">Group code (optional)</label>
                <input id="fg-code" className="input w-full" placeholder="e.g. GLH-001" value={form.group_code} maxLength={60} onChange={(e) => set('group_code', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fg-type">Type</label>
                <select id="fg-type" className="input w-full" value={form.group_type} onChange={(e) => set('group_type', e.target.value)}>
                  <option value="">Select type</option>
                  {GROUP_TYPES.map((t) => <option key={t} value={t}>{groupTypeLabel(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="fg-parent">Parent group (optional)</label>
                <select id="fg-parent" className="input w-full" value={form.parent_group} onChange={(e) => set('parent_group', e.target.value)}>
                  <option value="">None (top level)</option>
                  {parentOptions
                    .filter((name) => !editing || name !== editing.group_name)
                    .map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="fg-manager">Manager (optional)</label>
                <input id="fg-manager" className="input w-full" placeholder="e.g. A. Rahman" value={form.manager} maxLength={200} onChange={(e) => set('manager', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fg-region">Region (optional)</label>
                <input id="fg-region" className="input w-full" placeholder="e.g. Eastern Province" value={form.region} maxLength={200} onChange={(e) => set('region', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label" htmlFor="fg-assets">Own asset count</label>
                <input id="fg-assets" className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="0" value={form.asset_count} onChange={(e) => set('asset_count', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Descendants roll up automatically.</p>
              </div>
              <div>
                <label className="label" htmlFor="fg-budget">Budget (optional)</label>
                <input id="fg-budget" className="input w-full" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0" value={form.budget} onChange={(e) => set('budget', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="fg-currency">Currency</label>
                <input id="fg-currency" className="input w-full" placeholder={currency} value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fg-notes">Notes (optional)</label>
              <textarea id="fg-notes" className="input w-full min-h-[70px] resize-y" placeholder="e.g. consolidated cost centre for northern depots" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer min-h-[44px]">
              <input type="checkbox" className="accent-indigo-500 h-4 w-4" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Active group
            </label>
            {formError && (
              <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px] sm:min-h-0" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60 min-h-[44px] sm:min-h-0" disabled={saving}>
                {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Create group'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title={confirmDelete.bulk ? 'Delete these groups?' : 'Delete this group?'}
          footer={
            <>
              <button type="button" onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{confirmDelete.group_name || 'Group'}</span>{confirmDelete.group_code ? ` (#${confirmDelete.group_code})` : ''}. Child groups will become top level. This cannot be undone.
          </p>
          {deleteError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-500 mt-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {deleteError}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
