/**
 * ConsoleModuleControl - super-admin Module Control Center (Admin Control
 * Module 8, V258 `modules`).
 *
 * A pure console page (useConsoleAuth for the admin gate; no ConsoleAuthBridge
 * needed). One board to see every product module and set its lifecycle status:
 *   1. First load seeds any missing catalog module (status Live) then lists all.
 *   2. Each module renders as a card: name, category tag, Live / Maintenance /
 *      Off toggle, who it is visible to, and a short note.
 *   3. Status filter (with counts), category filter and free-text search.
 *   4. Bulk action: select several modules -> set Maintenance or Live at once.
 *   5. Dependency guard: taking a module out of service that a still-Live module
 *      depends on opens a confirm modal listing the affected dependents.
 *
 * ENFORCEMENT (V275): ProtectedRoute.ModuleRoute reads this status, so a module
 * set to Maintenance or Off shows an "unavailable" screen to regular users on
 * every route guarded by that module. Admin and Super Admin always pass. The
 * `visible_to` audience is stored only; it is not enforced.
 *
 * Layout: three tabs synced to ?tab= so the page is never a wall of 160 cards:
 *   Modules        - the filterable, paged card board with bulk actions; a
 *                    card's Details opens a side drawer (dependencies both ways,
 *                    maintenance window, status toggle).
 *   Out of service - everything in Maintenance or Off, overdue maintenance
 *                    windows first, one action each (bring it back Live).
 *   Categories     - live / maintenance / off counts per category, sortable
 *                    and exportable.
 *   History        - every recorded status change (module_status_history,
 *                    from 4 Oct 2026): who, when, from what to what and why.
 *
 * Safety (Round 2): switching a module Off needs a reason and the typed word
 * OFF, maintenance needs a reason, and every change is audited. Changes go
 * through admin_set_module_status so the reason is stored; an older database
 * falls back to the plain writer. Phones (the Flutter app) do not read module
 * state today, so Off and Maintenance apply to the web app only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes, RefreshCw, Info, AlertTriangle, CheckCircle2,
  Power, Wrench, Rocket, Sparkles, ShieldCheck, Clock, Layers, PanelRightOpen, History, Table2, LayoutGrid, Smartphone,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listModules, seedFromCatalog,
  dependencyWarnings, MODULE_STATUS_META,
} from '../../lib/api/modulesRegistry'
import { buildNavModuleCatalog } from '../../lib/moduleCatalog'
import { NAV_CATALOG } from '../../components/Layout'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, Segmented, SearchInput,
  Select, Toolbar, LoadingState, EmptyState, ErrorState, Modal,
  Table, THead, Th, Tr, Td, ConfirmImpactDialog,
} from '../components/ui'
import { governingModuleKey } from '../../lib/navAccess'
import { listModuleHistory, setModuleStatusWithReason } from '../../lib/api/moduleHistory'
import { namesFor } from '../../lib/api/consolePlatform'
import { sortRows, useTableSort } from '../../lib/consoleTable'
import ExportButtons from './shared/ExportButtons'
import { ShareChart, STATUS, useChartTheme } from '../components/ui/charts'
import { PageHeader, TabBar, useUrlTab, usePaged, Pager, SideDrawer, Field, Collapsible, fmtRelative, fmtDateTime } from './shared/pageKit'

const TABS = ['modules', 'service', 'categories', 'history']

/** How many sidebar pages each module key governs (who an Off change reaches). */
const NAV_PAGES = (() => {
  const out = {}
  try {
    for (const g of NAV_CATALOG || []) for (const it of g.items || []) {
      const k = governingModuleKey(it.key || it.to)
      if (k) out[k] = (out[k] || 0) + 1
    }
  } catch { /* no catalog: counts stay unknown */ }
  return out
})()

const HISTORY_EXPORT = [
  { key: 'when', header: 'When' }, { key: 'module', header: 'Module' }, { key: 'from', header: 'From' },
  { key: 'to', header: 'To' }, { key: 'by', header: 'Changed by' }, { key: 'reason', header: 'Reason' },
]
const CATEGORY_EXPORT_COLUMNS = [
  { key: 'category', header: 'Category' },
  { key: 'total', header: 'Modules' },
  { key: 'live', header: 'Live' },
  { key: 'maintenance', header: 'Maintenance' },
  { key: 'disabled', header: 'Off' },
  { key: 'beta', header: 'Beta' },
]

// Sort choices for the module cards. Status sorts out-of-service first.
const STATUS_RANK = { disabled: 0, maintenance: 1, beta: 2, live: 3 }
const MODULE_ORDERS = [
  { key: 'name', label: 'Name', field: 'name', dir: 'asc' },
  { key: 'status', label: 'Status', field: 'status', dir: 'asc' },
  { key: 'category', label: 'Category', field: 'category', dir: 'asc' },
  { key: 'updated', label: 'Recently changed', field: 'last_updated', dir: 'desc' },
]
const MODULE_EXPORT_COLUMNS = [
  { key: 'module_id', header: 'Module id' },
  { key: 'name', header: 'Name' },
  { key: 'category', header: 'Category' },
  { key: 'status', header: 'Status' },
  { key: 'visible_to', header: 'Visible to', value: (m) => (Array.isArray(m.visible_to) ? m.visible_to.join(', ') : m.visible_to) },
  { key: 'note', header: 'Note' },
  { key: 'last_updated', header: 'Last changed' },
]

// Kit badge tone for each stored module status.
const STATUS_TONE = { live: 'good', maintenance: 'warning', disabled: 'danger', beta: 'info' }
const STATUS_ICON = { live: Rocket, maintenance: Wrench, disabled: Power, beta: Sparkles }

/** Status pill for a module: icon + text, never colour alone. */
function StatusBadge({ status }) {
  const meta = MODULE_STATUS_META[status] || { label: status || 'Unknown' }
  return <Badge tone={STATUS_TONE[status] || 'default'} icon={STATUS_ICON[status]}>{meta.label}</Badge>
}

const VISIBLE_LABEL = {
  all: 'Everyone',
  admin_only: 'Admins only',
  specific_roles: 'Specific roles',
}

// The three lifecycle states surfaced by the quick toggle. 'beta' is a valid
// stored status (shown as a badge) but is not one of the toggle buttons.
const TOGGLE = [
  { status: 'live', label: 'Live', icon: Rocket, on: 'bg-emerald-600 text-white', off: 'text-emerald-300 hover:bg-emerald-900/30' },
  { status: 'maintenance', label: 'Maintenance', icon: Wrench, on: 'bg-amber-600 text-white', off: 'text-amber-300 hover:bg-amber-900/30' },
  { status: 'disabled', label: 'Off', icon: Power, on: 'bg-red-600 text-white', off: 'text-red-300 hover:bg-red-900/30' },
]

/** Live / Maintenance / Off toggle for one module. */
function StatusToggle({ current, disabled, onPick, name }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-800 overflow-hidden" role="group" aria-label={`Status for ${name}`}>
      {TOGGLE.map((t) => {
        const active = current === t.status
        const Icon = t.icon
        return (
          <button
            key={t.status}
            type="button"
            aria-pressed={active}
            disabled={disabled || active}
            onClick={() => onPick(t.status)}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500
              ${active ? t.on : `bg-gray-900/40 ${t.off}`} ${disabled && !active ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Icon size={11} aria-hidden="true" /> {t.label}
          </button>
        )
      })}
    </div>
  )
}

/** Safe local-time label for a stored maintenance ETA. */
function formatUntil(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleModuleControl({ tabParam = 'tab' } = {}) {
  const { admin, logAction } = useConsoleAuth()
  const [view, setView] = useState('table')
  const [history, setHistory] = useState({ state: 'loading', rows: [], names: {} })
  const [offReq, setOffReq] = useState(null) // { scope, ids, warnings }
  const [maintReason, setMaintReason] = useState('')
  const [actionError, setActionError] = useState('')
  const [flash, setFlash] = useState('')
  const theme = useChartTheme()
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [savingBulk, setSavingBulk] = useState(false)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState(() => new Set())

  // Pending status change awaiting dependency confirmation.
  // { scope: 'one'|'bulk', ids: string[], status, warnings: string[] }
  const [confirm, setConfirm] = useState(null)

  // Maintenance-window capture (V278). { scope, ids } while collecting the
  // optional ETA + note before applying the 'maintenance' status.
  const [maintModal, setMaintModal] = useState(null)
  const [maintUntil, setMaintUntil] = useState('')
  const [maintNote, setMaintNote] = useState('')
  const [tab, setTab] = useUrlTab(TABS, 'modules', tabParam)
  const [openId, setOpenId] = useState(null)
  const [readAt, setReadAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Seed from the COMPLETE navigable-module catalog (curated base modules +
      // every real sidebar item), so Module Control covers the whole app.
      await seedFromCatalog(buildNavModuleCatalog(NAV_CATALOG))
      const rows = await listModules()
      setModules(rows)
      setReadAt(Date.now())
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Status history is read on its own: a failure only hides "changed by".
  const loadHistory = useCallback(async () => {
    try {
      const rows = await listModuleHistory({ limit: 500 })
      const names = await namesFor(rows.map((r) => r.changed_by)).catch(() => ({}))
      setHistory({ state: 'ok', rows, names })
    } catch {
      setHistory({ state: 'error', rows: [], names: {} })
    }
  }, [])
  useEffect(() => { loadHistory() }, [loadHistory])
  const lastChange = useMemo(() => {
    const m = {}
    for (const r of history.rows) if (!m[r.module_id]) m[r.module_id] = r
    return m
  }, [history.rows])
  const whoText = (r) => (r ? (history.names[r.changed_by] || (r.changed_by ? 'Unknown person' : 'Scheduled change')) : null)

  const categories = useMemo(() => {
    const set = new Set()
    for (const m of modules) if (m.category) set.add(m.category)
    return Array.from(set).sort()
  }, [modules])

  const [order, setOrder] = useState('name')
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const found = modules.filter((m) => {
      if (category !== 'all' && m.category !== category) return false
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (!q) return true
      return (
        String(m.module_id || '').toLowerCase().includes(q) ||
        String(m.name || '').toLowerCase().includes(q)
      )
    })
    const spec = MODULE_ORDERS.find((o) => o.key === order) || MODULE_ORDERS[0]
    return sortRows(found, { key: spec.field, dir: spec.dir }, {
      name: (m) => m.name || m.module_id,
      status: (m) => STATUS_RANK[m.status] ?? 9,
    })
  }, [modules, search, category, statusFilter, order])

  const counts = useMemo(() => {
    const c = { live: 0, maintenance: 0, disabled: 0, beta: 0 }
    for (const m of modules) if (c[m.status] != null) c[m.status] += 1
    return c
  }, [modules])

  const outOfService = counts.maintenance + counts.disabled
  const paged = usePaged(filtered, 24)

  // Out of service, worst first: a maintenance window already past its ETA,
  // then Off, then Maintenance. The reference time is the moment of the read.
  const serviceRows = useMemo(() => {
    const ref = readAt || 0
    return modules
      .filter((m) => m.status === 'maintenance' || m.status === 'disabled')
      .map((m) => {
        const t = m.maintenance_until ? new Date(m.maintenance_until).getTime() : NaN
        const overdue = m.status === 'maintenance' && Number.isFinite(t) && ref > 0 && t < ref
        return { ...m, overdue, rank: overdue ? 0 : m.status === 'disabled' ? 1 : 2 }
      })
      .sort((a, b) => a.rank - b.rank || String(a.name || a.module_id).localeCompare(String(b.name || b.module_id)))
  }, [modules, readAt])
  const overdueWindows = serviceRows.filter((m) => m.overdue).length

  const categoryRows = useMemo(() => {
    const m = new Map()
    for (const x of modules) {
      const k = x.category || 'Uncategorised'
      const e = m.get(k) || { category: k, total: 0, live: 0, maintenance: 0, disabled: 0, beta: 0 }
      e.total += 1
      if (e[x.status] != null) e[x.status] += 1
      m.set(k, e)
    }
    return [...m.values()]
  }, [modules])
  const { sort: catSort, onSort: onCatSort } = useTableSort({ key: 'total', dir: 'desc' })
  const sortedCategories = useMemo(() => sortRows(categoryRows, catSort), [categoryRows, catSort])

  const byId = useMemo(() => new Map(modules.map((m) => [m.module_id, m])), [modules])
  const openModule = openId ? byId.get(openId) : null
  const openDeps = useMemo(() => (Array.isArray(openModule?.depends_on) ? openModule.depends_on : []), [openModule])
  const openDependents = useMemo(() => (openModule
    ? modules.filter((m) => Array.isArray(m.depends_on) && m.depends_on.includes(openModule.module_id))
    : []), [modules, openModule])

  const shareParts = useMemo(() => {
    const pal = STATUS[theme]
    const parts = [
      { label: 'Live', value: counts.live, color: pal.good },
      { label: 'Maintenance', value: counts.maintenance, color: pal.medium },
      { label: 'Off', value: counts.disabled, color: pal.critical },
    ]
    if (counts.beta) parts.push({ label: 'Beta', value: counts.beta, color: pal.low })
    return parts
  }, [counts, theme])

  // ── Status changes ──────────────────────────────────────────────────────────

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function requestStatus(scope, ids, status) {
    // Moving INTO maintenance collects an optional ETA + note first (the
    // dependency warnings are surfaced inside that same modal).
    if (status === 'maintenance') {
      setMaintUntil('')
      setMaintNote('')
      setMaintReason('')
      setActionError('')
      setMaintModal({ scope, ids })
      return
    }
    // Gather dependency warnings across every module being taken out of service.
    const warnings = []
    for (const id of ids) {
      for (const w of dependencyWarnings(modules, id, status)) {
        if (!warnings.includes(w)) warnings.push(w)
      }
    }
    // Switching a module Off hides it from every user, so it always asks first,
    // even when nothing depends on it, with a reason and the typed word OFF.
    if (status === 'disabled') {
      setActionError('')
      setOffReq({ scope, ids, warnings })
      return
    }
    if (warnings.length > 0) {
      setConfirm({ scope, ids, status, warnings })
    } else {
      applyStatus(scope, ids, status)
    }
  }

  async function applyStatus(scope, ids, status, opts = {}) {
    setError(null)
    setActionError('')
    const reason = (opts.reason || '').trim() || (status === 'live' ? 'Brought back live from Module Control' : '')
    try {
      if (scope === 'bulk') setSavingBulk(true)
      else setBusyId(ids[0])
      const res = await setModuleStatusWithReason(ids, status, { until: opts.until, note: opts.note, reason })
      setConfirm(null)
      setMaintModal(null)
      setOffReq(null)
      try {
        await logAction?.('module_status', null, 'module', { modules: ids.slice(0, 50), count: ids.length, to: status, reason, recorded: res.recorded })
      } catch { /* audit is best effort */ }
      setFlash(`${ids.length === 1 ? (byId.get(ids[0])?.name || ids[0]) : `${ids.length} modules`} set to ${(MODULE_STATUS_META[status] || { label: status }).label}.${res.recorded ? '' : ' The reason could not be stored (older database); the change is in the console audit log.'}`)
      loadHistory()
      // Optimistic local update so the board reflects the change immediately,
      // including the maintenance window (cleared when not in maintenance).
      const maintenance = status === 'maintenance'
      let untilIso = null
      if (maintenance && opts.until) {
        const d = new Date(opts.until)
        if (!Number.isNaN(d.getTime())) untilIso = d.toISOString()
      }
      const noteVal = maintenance && opts.note != null && String(opts.note).trim()
        ? String(opts.note).trim()
        : null
      const idSet = new Set(ids)
      const stamp = new Date().toISOString()
      setModules((prev) => prev.map((m) => (
        idSet.has(m.module_id)
          ? { ...m, status, last_updated: stamp, maintenance_until: untilIso, maintenance_note: noteVal }
          : m
      )))
      if (scope === 'bulk') setSelected(new Set())
    } catch (err) {
      const msg = toUserMessage(err)
      if (offReq || maintModal) setActionError(msg)
      else setError(msg)
    } finally {
      setBusyId(null)
      setSavingBulk(false)
    }
  }

  // Dependency warnings for the modules currently pending a maintenance window.
  const maintWarnings = useMemo(() => {
    if (!maintModal) return []
    const out = []
    for (const id of maintModal.ids) {
      for (const w of dependencyWarnings(modules, id, 'maintenance')) {
        if (!out.includes(w)) out.push(w)
      }
    }
    return out
  }, [maintModal, modules])

  const selectedIds = useMemo(
    () => filtered.filter((m) => selected.has(m.module_id)).map((m) => m.module_id),
    [filtered, selected],
  )

  const allVisibleSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.module_id))

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filtered.forEach((m) => next.delete(m.module_id))
      else filtered.forEach((m) => next.add(m.module_id))
      return next
    })
  }

  // A failed registry read is "could not check", never a row of zero counts.
  const countsKnown = !loading && !(error && modules.length === 0)
  const countVal = (n) => (countsKnown ? n : 'N/A')
  const pickStatusTile = (key) => { setStatusFilter(statusFilter === key ? 'all' : key); setTab('modules') }

  const filtersActive = search.trim() || category !== 'all' || statusFilter !== 'all'
  function clearFilters() { setSearch(''); setCategory('all'); setStatusFilter('all') }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-7xl">
      <PageHeader icon={Boxes} title="Module Control Center"
        purpose={`${admin?.full_name ? `Signed in as ${admin.full_name}. ` : ''}Turn product modules Live, into Maintenance, or Off across the platform.`}
        refreshedAt={readAt} onRefresh={load} refreshing={loading} />

      <Collapsible icon={ShieldCheck} title="How module status is enforced"
        subtitle="Maintenance and Off block regular users; Admins always pass. Visible to is recorded only.">
        <Note icon={ShieldCheck} tone="accent">
          A module set to Maintenance or Off shows an "unavailable" screen to regular users on every page
          guarded by that module. Admins and Super Admins always pass so they can verify it. The
          "Visible to" audience on each card is recorded only and is not enforced.
        </Note>
        <div className="mt-2">
          <Note icon={Smartphone}>
            Phones: the Flutter app does not read module status today, so Maintenance and Off apply to the web
            app only. The phone screens are controlled from Access Control and Mobile App.
          </Note>
        </div>
      </Collapsible>

      <ErrorState message={!loading ? error : null} onRetry={load} />
      {flash && <Note icon={CheckCircle2} tone="accent">{flash}</Note>}

      {/* Status overview */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-3 lg:col-span-2 content-start">
          <StatTile label="Live" value={countVal(counts.live)} tone="good" icon={Rocket}
            active={tab === 'modules' && statusFilter === 'live'} onClick={() => pickStatusTile('live')}
            sub={countsKnown ? undefined : loading ? 'Loading' : 'Could not check'} />
          <StatTile label="Maintenance" value={countVal(counts.maintenance)} tone="warning" icon={Wrench}
            active={tab === 'modules' && statusFilter === 'maintenance'} onClick={() => pickStatusTile('maintenance')}
            sub={countsKnown ? undefined : loading ? 'Loading' : 'Could not check'} />
          <StatTile label="Off" value={countVal(counts.disabled)} tone="danger" icon={Power}
            active={tab === 'modules' && statusFilter === 'disabled'} onClick={() => pickStatusTile('disabled')}
            sub={countsKnown ? undefined : loading ? 'Loading' : 'Could not check'} />
          <StatTile label="Beta" value={countVal(counts.beta)} tone="muted" icon={Sparkles}
            active={tab === 'modules' && statusFilter === 'beta'} onClick={() => pickStatusTile('beta')}
            sub={countsKnown ? undefined : loading ? 'Loading' : 'Could not check'} />
          {!loading && overdueWindows > 0 && (
            <div className="col-span-2">
              <Note icon={Clock} tone="warning">
                {overdueWindows} maintenance window{overdueWindows === 1 ? ' is' : 's are'} past the expected return time.{' '}
                <button type="button" onClick={() => setTab('service')} className="underline hover:text-amber-100 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Review</button>
              </Note>
            </div>
          )}
        </div>
        <Panel>
          <PanelHeader title="Modules by status"
            subtitle={loading ? 'Loading' : countsKnown ? `${outOfService} of ${modules.length} out of service` : 'Could not check'} />
          {loading ? <LoadingState rows={2} /> : !countsKnown ? (
            <EmptyState icon={Boxes} title="Could not check" reason="The module registry could not be read, so no split is shown rather than zeros." />
          ) : (
            <ShareChart
              parts={shareParts}
              height={140}
              center={{ value: modules.length, label: 'modules' }}
              summary={`${counts.live} live, ${counts.maintenance} in maintenance, ${counts.disabled} off, ${counts.beta} beta`}
              emptyText="No modules registered yet."
            />
          )}
        </Panel>
      </div>

      <TabBar tabs={[
        { key: 'modules', label: 'Modules', count: loading ? undefined : modules.length },
        { key: 'service', label: 'Out of service', count: loading ? undefined : outOfService },
        { key: 'categories', label: 'Categories', count: loading ? undefined : categoryRows.length },
        { key: 'history', label: 'History', count: history.state === 'ok' ? history.rows.length : undefined },
      ]} value={tab} onChange={setTab} label="Module control sections" />

      {tab === 'modules' && (<>
      {/* Toolbar: status, search, category */}
      <Toolbar>
        <Segmented
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel="Filter by status"
          role="group"
          options={[
            { key: 'all', label: 'All', count: modules.length },
            { key: 'live', label: 'Live', count: counts.live },
            { key: 'maintenance', label: 'Maintenance', count: counts.maintenance },
            { key: 'disabled', label: 'Off', count: counts.disabled },
            ...(counts.beta ? [{ key: 'beta', label: 'Beta', count: counts.beta }] : []),
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search by module id or name" className="w-full sm:flex-1 sm:min-w-[200px]" />
        <Select
          value={category}
          onChange={setCategory}
          options={[{ value: 'all', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
          ariaLabel="Filter by category"
          className="w-full sm:w-48"
        />
        <Select value={order} onChange={setOrder} ariaLabel="Sort modules by" className="w-full sm:w-40"
          options={MODULE_ORDERS.map((o) => ({ value: o.key, label: `Sort: ${o.label}` }))} />
        <Segmented value={view} onChange={setView} ariaLabel="Board layout" role="group" options={[
          { key: 'table', label: <><Table2 size={13} aria-hidden="true" />Table</> },
          { key: 'cards', label: <><LayoutGrid size={13} aria-hidden="true" />Cards</> },
        ]} />
        <ExportButtons rows={filtered} columns={MODULE_EXPORT_COLUMNS} title="Module Control" />
      </Toolbar>
      <p className="sr-only" aria-live="polite">
        {loading ? 'Loading modules' : countsKnown ? `${filtered.length} of ${modules.length} modules shown` : 'Modules could not be read'}
      </p>

      {/* Bulk action bar */}
      {!loading && filtered.length > 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
          selectedIds.length > 0 ? 'border-orange-800/40 bg-orange-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible}
              className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 accent-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
            {selectedIds.length > 0
              ? <span className="text-orange-200 font-semibold">{selectedIds.length} selected</span>
              : `Select all ${filtered.length} matching`}
          </label>
          {selectedIds.length > 0 && (
            <Toolbar>
              <Btn icon={Wrench} onClick={() => requestStatus('bulk', selectedIds, 'maintenance')} busy={savingBulk}>
                Set Maintenance
              </Btn>
              <Btn icon={Rocket} variant="good" onClick={() => requestStatus('bulk', selectedIds, 'live')} busy={savingBulk}>
                Set Live
              </Btn>
              <Btn icon={Power} variant="danger" onClick={() => requestStatus('bulk', selectedIds, 'disabled')} busy={savingBulk}>
                Turn off
              </Btn>
              <Btn variant="quiet" onClick={() => setSelected(new Set())}>Clear</Btn>
            </Toolbar>
          )}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <LoadingState label="Loading modules" rows={6} />
      ) : modules.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Boxes}
            title={error ? 'Modules could not be loaded' : 'No modules registered yet'}
            reason={error
              ? 'The module registry could not be read, so nothing is shown. Retry above.'
              : 'The module registry is empty or has not been provisioned. Refresh to seed it from the product catalog.'}
            action={<Btn icon={RefreshCw} onClick={load}>Refresh</Btn>}
          />
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Boxes}
            title="No modules match your filters"
            reason={`${modules.length} modules are registered; none match the current status, category or search.`}
            action={filtersActive ? <Btn onClick={clearFilters}>Clear filters</Btn> : null}
          />
        </Panel>
      ) : view === 'table' ? (
        <Panel flush>
          <Table>
            <THead>
              <Th><span className="sr-only">Select</span></Th>
              <Th>Module</Th><Th>Status</Th><Th>Category</Th><Th>Back by</Th><Th>Last change</Th>
              <Th align="right">Pages</Th><Th align="right">Action</Th>
            </THead>
            <tbody>
              {paged.rows.map((m) => {
                const last = lastChange[m.module_id]
                const pages = NAV_PAGES[m.module_id]
                const overdue = m.status === 'maintenance' && m.maintenance_until && readAt && new Date(m.maintenance_until).getTime() < readAt
                return (
                  <Tr key={m.module_id}>
                    <Td>
                      <input type="checkbox" checked={selected.has(m.module_id)} onChange={() => toggleSelected(m.module_id)}
                        aria-label={`Select ${m.name || m.module_id}`} className="accent-orange-500" />
                    </Td>
                    <Td className="min-w-[11rem]">
                      <p className="text-gray-100">{m.name || m.module_id}</p>
                      <p className="text-[11px] text-gray-500 font-mono">{m.module_id}</p>
                    </Td>
                    <Td nowrap><StatusBadge status={m.status} />{overdue && <span className="block mt-0.5"><Badge tone="danger" icon={Clock}>Past return</Badge></span>}</Td>
                    <Td className="text-gray-400">{m.category || 'N/A'}</Td>
                    <Td nowrap className="text-gray-400">{m.status === 'maintenance' ? (formatUntil(m.maintenance_until) || 'Not set') : 'N/A'}</Td>
                    <Td className="text-gray-400">
                      {last
                        ? <>{fmtRelative(last.changed_at)}<span className="block text-[11px] text-gray-500">{whoText(last)}</span></>
                        : m.last_updated
                          ? <>{fmtRelative(m.last_updated)}<span className="block text-[11px] text-gray-500" title="Status changes were not attributed to a person before 4 Oct 2026">Person not recorded</span></>
                          : 'Not stored'}
                    </Td>
                    <Td align="right" className="tabular-nums text-gray-400">{pages ?? 'N/A'}</Td>
                    <Td align="right" nowrap>
                      <span className="inline-flex gap-1">
                        {m.status !== 'live' && (
                          <Btn size="xs" variant="good" icon={Rocket} busy={busyId === m.module_id}
                            onClick={() => requestStatus('one', [m.module_id], 'live')}>Live</Btn>
                        )}
                        {m.status !== 'maintenance' && (
                          <Btn size="xs" icon={Wrench} onClick={() => requestStatus('one', [m.module_id], 'maintenance')}>Maint</Btn>
                        )}
                        <Btn size="xs" variant="quiet" icon={PanelRightOpen} onClick={() => setOpenId(m.module_id)}
                          aria-label={`Details for ${m.name || m.module_id}`}>Details</Btn>
                      </span>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
          <Pager paged={paged} label="modules" />
        </Panel>
      ) : (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {paged.rows.map((m) => (
              <ModuleCard
                key={m.module_id}
                module={m}
                busy={busyId === m.module_id}
                checked={selected.has(m.module_id)}
                onToggleSelect={() => toggleSelected(m.module_id)}
                onPick={(status) => requestStatus('one', [m.module_id], status)}
                onOpen={() => setOpenId(m.module_id)}
              />
            ))}
          </div>
          <Pager paged={paged} label="modules" />
        </div>
      )}
      </>)}

      {tab === 'service' && (
        <Panel>
          <PanelHeader icon={Wrench} title="Out of service"
            subtitle="Every module in Maintenance or Off. Maintenance windows past their expected return come first." />
          {loading ? <LoadingState label="Loading modules" /> : error && modules.length === 0 ? (
            <ErrorState message={error} onRetry={load} />
          ) : serviceRows.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Every module is available"
              reason="Nothing is in Maintenance or Off, so no regular user is blocked." />
          ) : (
            <ul className="space-y-2">
              {serviceRows.map((m) => (
                <li key={m.module_id} className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-gray-100 font-medium">{m.name || m.module_id}</span>
                      <StatusBadge status={m.status} />
                      {m.overdue && <Badge tone="danger" icon={Clock}>Past expected return</Badge>}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {m.maintenance_until && formatUntil(m.maintenance_until) ? `Expected back by ${formatUntil(m.maintenance_until)}. ` : ''}
                      {m.maintenance_note || (m.status === 'disabled' ? 'Switched off; users cannot open it.' : 'No note recorded.')}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Btn size="xs" icon={PanelRightOpen} onClick={() => setOpenId(m.module_id)}>Details</Btn>
                    <Btn size="xs" variant="good" icon={Rocket} busy={busyId === m.module_id}
                      onClick={() => requestStatus('one', [m.module_id], 'live')}>Set Live</Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'categories' && (
        <Panel>
          <PanelHeader icon={Layers} title="Modules by category"
            subtitle="Where the out-of-service modules sit. Select a category to open its modules."
            actions={<ExportButtons rows={sortedCategories} columns={CATEGORY_EXPORT_COLUMNS} title="Module Control by Category" />} />
          {loading ? <LoadingState label="Loading modules" /> : sortedCategories.length === 0 ? (
            <EmptyState icon={Layers} title={error ? 'Modules could not be loaded' : 'No modules registered yet'}
              reason={error ? 'The module registry could not be read.' : 'Refresh to seed the registry from the product catalog.'} />
          ) : (
            <Table>
              <THead>
                <Th sortKey="category" sort={catSort} onSort={onCatSort}>Category</Th>
                <Th sortKey="total" sort={catSort} onSort={onCatSort} align="right">Modules</Th>
                <Th sortKey="live" sort={catSort} onSort={onCatSort} align="right">Live</Th>
                <Th sortKey="maintenance" sort={catSort} onSort={onCatSort} align="right">Maintenance</Th>
                <Th sortKey="disabled" sort={catSort} onSort={onCatSort} align="right">Off</Th>
                <Th sortKey="beta" sort={catSort} onSort={onCatSort} align="right">Beta</Th>
              </THead>
              <tbody>
                {sortedCategories.map((c) => (
                  <Tr key={c.category} ariaLabel={`Show ${c.category} modules`}
                    onClick={() => { setCategory(c.category === 'Uncategorised' ? 'all' : c.category); setStatusFilter('all'); setSearch(''); setTab('modules') }}>
                    <Td><span className="text-gray-200">{c.category}</span></Td>
                    <Td align="right" className="tabular-nums">{c.total}</Td>
                    <Td align="right" className="tabular-nums text-emerald-300">{c.live}</Td>
                    <Td align="right" className={`tabular-nums ${c.maintenance ? 'text-amber-300' : 'text-gray-500'}`}>{c.maintenance}</Td>
                    <Td align="right" className={`tabular-nums ${c.disabled ? 'text-red-300' : 'text-gray-500'}`}>{c.disabled}</Td>
                    <Td align="right" className="tabular-nums text-gray-400">{c.beta}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {tab === 'history' && (
        <HistoryPanel history={history} byId={byId} whoText={whoText} onRetry={loadHistory} />
      )}

      <SideDrawer open={!!openModule} onClose={() => setOpenId(null)} title={openModule?.name || openModule?.module_id || 'Module'}
        subtitle={openModule ? `Module ${openModule.module_id}` : ''}>
        {openModule && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={openModule.status} />
              {openModule.category && <Badge tone="quiet">{openModule.category}</Badge>}
            </div>
            <StatusToggle current={openModule.status} disabled={busyId === openModule.module_id}
              onPick={(status) => requestStatus('one', [openModule.module_id], status)} name={openModule.name || openModule.module_id} />
            <dl>
              <Field label="Visible to">{VISIBLE_LABEL[openModule.visible_to] || openModule.visible_to || 'Everyone'} (recorded only)</Field>
              <Field label="Roles">{Array.isArray(openModule.roles) && openModule.roles.length ? openModule.roles.join(', ') : 'N/A'}</Field>
              <Field label="Note">{openModule.note || 'N/A'}</Field>
              <Field label="Maintenance until">{formatUntil(openModule.maintenance_until) || 'N/A'}</Field>
              <Field label="Maintenance note">{openModule.maintenance_note || 'N/A'}</Field>
              <Field label="Last changed">{formatUntil(openModule.last_updated) || 'N/A'}</Field>
              <Field label="Changed by">{whoText(lastChange[openModule.module_id]) || (history.state === 'error' ? 'N/A (history not readable)' : 'Not recorded: no status change since attribution started on 4 Oct 2026')}</Field>
              <Field label="Sidebar pages it governs">{NAV_PAGES[openModule.module_id] ?? 'N/A (not a sidebar module)'}</Field>
            </dl>
            <div className="rounded-lg border border-red-900/40 bg-red-950/15 p-3 space-y-2">
              <p className="text-xs font-semibold text-red-300">Switch off</p>
              <p className="text-[11px] text-gray-400">
                Regular users on {NAV_PAGES[openModule.module_id] ?? 'its'} {NAV_PAGES[openModule.module_id] === 1 ? 'page' : 'pages'} see an unavailable screen.
                Admins still get in. Needs a reason and the typed word OFF.
              </p>
              <Btn size="xs" variant="danger" icon={Power} disabled={openModule.status === 'disabled'}
                onClick={() => requestStatus('one', [openModule.module_id], 'disabled')}>Turn off</Btn>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Depends on</p>
              {openDeps.length === 0 ? <p className="text-xs text-gray-500">Nothing recorded.</p> : (
                <div className="flex flex-wrap gap-1.5">
                  {openDeps.map((d) => {
                    const dm = byId.get(d)
                    return <Badge key={d} tone={STATUS_TONE[dm?.status] || 'default'}>{dm?.name || d}</Badge>
                  })}
                </div>
              )}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Used by</p>
              {openDependents.length === 0 ? <p className="text-xs text-gray-500">No module depends on this one.</p> : (
                <div className="flex flex-wrap gap-1.5">
                  {openDependents.map((dm) => <Badge key={dm.module_id} tone={STATUS_TONE[dm.status] || 'default'}>{dm.name || dm.module_id}</Badge>)}
                </div>
              )}
            </div>
          </>
        )}
      </SideDrawer>

      {/* Dependency confirm modal */}
      <ConfirmModal
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && applyStatus(confirm.scope, confirm.ids, confirm.status)}
      />

      <ConfirmImpactDialog open={!!offReq} danger requireReason typedWord="OFF" busy={savingBulk || busyId != null}
        error={actionError}
        title={offReq && offReq.ids.length > 1 ? `Turn off ${offReq.ids.length} modules?` : 'Turn this module off?'}
        confirmLabel="Turn off"
        onCancel={() => setOffReq(null)}
        onConfirm={({ reason }) => offReq && applyStatus(offReq.scope, offReq.ids, 'disabled', { reason })}
        impact={offReq ? {
          tone: 'danger',
          what: offReq.ids.length > 1 ? `${offReq.ids.length} modules will be switched off.` : `${byId.get(offReq.ids[0])?.name || offReq.ids[0]} will be switched off.`,
          change: 'Regular users get an unavailable screen on every page guarded by these modules until they are set back to Live.',
          who: `Every non-admin web user of ${offReq.ids.reduce((n, id) => n + (NAV_PAGES[id] || 0), 0)} sidebar pages. Admins and super admins still get in. The Flutter app is not affected.`,
          undo: 'Yes. Set it back to Live from the Out of service tab. The change and your reason are kept in History.',
        } : null}>
        {offReq?.warnings?.length > 0 && (
          <Note icon={AlertTriangle} tone="warning">
            <p className="font-semibold mb-1">Other Live modules depend on this:</p>
            <ul className="space-y-0.5">{offReq.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </Note>
        )}
      </ConfirmImpactDialog>

      {/* Maintenance window modal */}
      <MaintenanceModal
        open={!!maintModal}
        count={maintModal?.ids.length || 0}
        until={maintUntil}
        note={maintNote}
        warnings={maintWarnings}
        busy={savingBulk || busyId != null}
        onUntil={setMaintUntil}
        onNote={setMaintNote}
        reason={maintReason}
        onReason={setMaintReason}
        error={actionError}
        onCancel={() => setMaintModal(null)}
        onConfirm={() => maintModal && applyStatus(maintModal.scope, maintModal.ids, 'maintenance', { until: maintUntil, note: maintNote, reason: maintReason })}
      />
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function ModuleCard({ module: m, busy, checked, onToggleSelect, onPick, onOpen }) {
  const name = m.name || m.module_id
  return (
    <div className={`rounded-xl border p-3.5 transition-colors ${checked ? 'border-orange-800/50 bg-orange-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
      <div className="flex items-start gap-2.5 min-w-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleSelect}
          className="mt-1 h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 accent-orange-500 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          aria-label={`Select ${name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-100 truncate min-w-0" title={name}>{name}</p>
            <StatusBadge status={m.status} />
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Code>{m.module_id}</Code>
            {m.category && <Badge tone="quiet">{m.category}</Badge>}
          </div>
        </div>
      </div>

      {m.note && <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">{m.note}</p>}

      {m.status === 'maintenance' && (m.maintenance_until || m.maintenance_note) && (
        <div className="mt-2">
          <Note icon={Clock} tone="warning">
            {m.maintenance_until && formatUntil(m.maintenance_until) && (
              <p>Expected back by {formatUntil(m.maintenance_until)}</p>
            )}
            {m.maintenance_note && <p className="mt-0.5 opacity-80">{m.maintenance_note}</p>}
          </Note>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <StatusToggle current={m.status} disabled={busy} onPick={onPick} name={name} />
        {onOpen && <Btn size="xs" variant="quiet" icon={PanelRightOpen} onClick={onOpen}>Details</Btn>}
        <span className="text-[10px] text-gray-500 flex items-center gap-1"
          title="Who this module is intended for. Recorded only; not enforced.">
          Visible to: {VISIBLE_LABEL[m.visible_to] || m.visible_to || 'Everyone'}
          <Info size={11} className="text-gray-500" aria-hidden="true" />
        </span>
      </div>
    </div>
  )
}

const FIELD_LABEL = 'block text-[11px] font-semibold text-gray-400 mb-1'
const FIELD_INPUT = 'w-full h-9 bg-gray-900 border border-gray-800 rounded-lg px-3 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-700 focus-visible:ring-2 focus-visible:ring-orange-500'

function MaintenanceModal({ open, count, until, note, warnings, busy, onUntil, onNote, onCancel, onConfirm, reason = '', onReason, error }) {
  return (
    <Modal
      open={open}
      title="Set maintenance"
      subtitle={count > 1 ? `${count} modules` : 'One module'}
      onClose={onCancel}
      width="max-w-md"
      footer={(
        <>
          <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" icon={Wrench} onClick={onConfirm} busy={busy} disabled={onReason ? reason.trim().length < 3 : false}>Set maintenance</Btn>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-xs text-gray-400 leading-relaxed">
          {count > 1 ? `${count} modules` : 'This module'} will show an "Under maintenance" screen to
          regular users. Add an optional expected return time and a short note (both are shown to users).
        </p>
        <div>
          <label className={FIELD_LABEL} htmlFor="maint-until">Maintenance until (optional)</label>
          <input id="maint-until" type="datetime-local" value={until}
            onChange={(e) => onUntil(e.target.value)} className={FIELD_INPUT} />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="maint-note">Note (optional)</label>
          <input id="maint-note" type="text" value={note} maxLength={200}
            onChange={(e) => onNote(e.target.value)}
            placeholder="e.g. Upgrading the analytics engine" className={FIELD_INPUT} />
        </div>
        {onReason && (
          <div>
            <label className={FIELD_LABEL} htmlFor="maint-reason">Reason (required, kept in History)</label>
            <input id="maint-reason" type="text" value={reason} maxLength={500}
              onChange={(e) => onReason(e.target.value)} placeholder="Why is it going into maintenance?" className={FIELD_INPUT} />
          </div>
        )}
        <p className="text-[11px] text-gray-400">Who is affected: regular web users of {count > 1 ? 'these modules' : 'this module'}. Admins still get in. The Flutter app is not affected.</p>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {warnings.length > 0 && (
          <Note icon={AlertTriangle} tone="warning">
            <p className="font-semibold mb-1">Other Live modules depend on this:</p>
            <ul className="space-y-0.5">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </Note>
        )}
      </div>
    </Modal>
  )
}

function ConfirmModal({ confirm, onCancel, onConfirm }) {
  const meta = confirm ? (MODULE_STATUS_META[confirm.status] || { label: confirm.status }) : null
  const hasWarnings = !!confirm?.warnings?.length
  return (
    <Modal
      open={!!confirm}
      title={hasWarnings || !confirm ? 'Dependency check' : 'Turn this off?'}
      onClose={onCancel}
      width="max-w-md"
      footer={(
        <>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant={confirm?.status === 'disabled' ? 'danger' : 'primary'} icon={CheckCircle2} onClick={onConfirm}>
            {hasWarnings ? 'Apply anyway' : 'Turn off'}
          </Btn>
        </>
      )}
    >
      {confirm && !hasWarnings && (
        <p className="text-xs text-gray-300 leading-relaxed">
          You are about to switch {confirm.ids.length > 1 ? `${confirm.ids.length} modules` : 'this module'}{' '}
          <span className="font-semibold text-gray-100">{meta.label}</span>. Users will no longer be able to open it
          until it is set back to Live. Nothing else depends on it.
        </p>
      )}
      {confirm && hasWarnings && (
        <div className="space-y-3">
          <p className="text-xs text-gray-300 leading-relaxed">
            You are about to set {confirm.ids.length > 1 ? `${confirm.ids.length} modules` : 'this module'} to{' '}
            <span className="font-semibold text-gray-100">{meta.label}</span>. Other modules that are still Live
            depend on what you are taking out of service:
          </p>
          <Note icon={AlertTriangle} tone="warning">
            <ul className="space-y-1">
              {confirm.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </Note>
          <p className="text-[11px] text-gray-500">
            Those modules may not work correctly while this one is out of service.
          </p>
        </div>
      )}
    </Modal>
  )
}

function HistoryPanel({ history, byId, whoText, onRetry }) {
  const [q, setQ] = useState('')
  const [to, setTo] = useState('all')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return history.rows.filter((r) => (to === 'all' || r.new_status === to)
      && (!needle || [r.module_id, byId.get(r.module_id)?.name, r.reason].some((t) => String(t || '').toLowerCase().includes(needle))))
  }, [history.rows, q, to, byId])
  const paged = usePaged(rows, 25, `${q}|${to}`)
  const label = (st) => (MODULE_STATUS_META[st] || { label: st || 'N/A' }).label
  const exportRows = rows.map((r) => ({
    when: fmtDateTime(r.changed_at), module: byId.get(r.module_id)?.name || r.module_id,
    from: label(r.old_status), to: label(r.new_status), by: whoText(r), reason: r.reason || 'Not recorded',
  }))
  return (
    <Panel>
      <PanelHeader icon={History} title="Status history"
        subtitle="Every recorded status change since 4 Oct 2026: who made it, when and why. Scheduled changes from Feature Flags show as Scheduled change."
        actions={(
          <Toolbar>
            <SearchInput value={q} onChange={setQ} placeholder="Search module or reason" className="w-full sm:w-52" ariaLabel="Search history" />
            <Select value={to} onChange={setTo} ariaLabel="Changed to" className="w-40" options={[
              { value: 'all', label: 'Any new status' }, { value: 'live', label: 'To Live' },
              { value: 'maintenance', label: 'To Maintenance' }, { value: 'disabled', label: 'To Off' },
            ]} />
            <ExportButtons rows={exportRows} columns={HISTORY_EXPORT} title="Module status history" />
          </Toolbar>
        )} />
      {history.state === 'loading' ? <LoadingState label="Reading history" rows={4} /> : history.state === 'error' ? (
        <ErrorState message="The status history could not be read. Only Admins and super admins can read it." onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title={history.rows.length ? 'No change matches' : 'No status change recorded yet'}
          reason={history.rows.length ? 'Clear the search or the filter.' : 'Recording started on 4 Oct 2026. Changes made from now on appear here.'} />
      ) : (
        <>
          <Table>
            <THead><Th>When</Th><Th>Module</Th><Th>Change</Th><Th>By</Th><Th>Reason</Th></THead>
            <tbody>
              {paged.rows.map((r) => (
                <Tr key={r.id}>
                  <Td nowrap className="text-gray-300">{fmtDateTime(r.changed_at)}</Td>
                  <Td className="text-gray-200">{byId.get(r.module_id)?.name || r.module_id}</Td>
                  <Td nowrap><StatusBadge status={r.old_status} /> <span className="text-gray-500">to</span> <StatusBadge status={r.new_status} /></Td>
                  <Td className="text-gray-400">{whoText(r)}</Td>
                  <Td className="text-gray-400">{r.reason || 'Not recorded'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager paged={paged} label="changes" />
        </>
      )}
    </Panel>
  )
}
