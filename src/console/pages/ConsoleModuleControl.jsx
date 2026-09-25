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
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes, RefreshCw, Info, AlertTriangle, CheckCircle2,
  Power, Wrench, Rocket, Sparkles, ShieldCheck, Clock,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listModules, seedFromCatalog, setModuleStatus, bulkSetStatus,
  dependencyWarnings, MODULE_STATUS_META,
} from '../../lib/api/modulesRegistry'
import { buildNavModuleCatalog } from '../../lib/moduleCatalog'
import { NAV_CATALOG } from '../../components/Layout'
import { toUserMessage } from '../../lib/safeError'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Code, Btn, Segmented, SearchInput,
  Select, Toolbar, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import { ShareChart, STATUS, useChartTheme } from '../components/ui/charts'

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

export default function ConsoleModuleControl() {
  const { admin } = useConsoleAuth()
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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Seed from the COMPLETE navigable-module catalog (curated base modules +
      // every real sidebar item), so Module Control covers the whole app.
      await seedFromCatalog(buildNavModuleCatalog(NAV_CATALOG))
      const rows = await listModules()
      setModules(rows)
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => {
    const set = new Set()
    for (const m of modules) if (m.category) set.add(m.category)
    return Array.from(set).sort()
  }, [modules])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return modules.filter((m) => {
      if (category !== 'all' && m.category !== category) return false
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (!q) return true
      return (
        String(m.module_id || '').toLowerCase().includes(q) ||
        String(m.name || '').toLowerCase().includes(q)
      )
    })
  }, [modules, search, category, statusFilter])

  const counts = useMemo(() => {
    const c = { live: 0, maintenance: 0, disabled: 0, beta: 0 }
    for (const m of modules) if (c[m.status] != null) c[m.status] += 1
    return c
  }, [modules])

  const outOfService = counts.maintenance + counts.disabled

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
    // even when nothing depends on it.
    if (warnings.length > 0 || status === 'disabled') {
      setConfirm({ scope, ids, status, warnings })
    } else {
      applyStatus(scope, ids, status)
    }
  }

  async function applyStatus(scope, ids, status, opts = {}) {
    setConfirm(null)
    setMaintModal(null)
    setError(null)
    try {
      if (scope === 'bulk') {
        setSavingBulk(true)
        if (status === 'maintenance') {
          // Per-module so the shared window (ETA + note) persists on each row.
          for (const id of ids) await setModuleStatus(id, status, opts)
        } else {
          await bulkSetStatus(ids, status)
        }
      } else {
        setBusyId(ids[0])
        await setModuleStatus(ids[0], status, opts)
      }
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
      setError(toUserMessage(err))
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

  const filtersActive = search.trim() || category !== 'all' || statusFilter !== 'all'
  function clearFilters() { setSearch(''); setCategory('all'); setStatusFilter('all') }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>
            <Boxes size={18} className="text-orange-400" /> Module Control Center
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {admin?.full_name ? `Signed in as ${admin.full_name}. ` : ''}
            Turn product modules Live, into Maintenance, or Off across the platform.
          </p>
        </div>
        <Btn icon={RefreshCw} onClick={load} busy={loading}>Refresh</Btn>
      </header>

      <Note icon={ShieldCheck} tone="accent">
        A module set to Maintenance or Off shows an "unavailable" screen to regular users on every page
        guarded by that module. Admins and Super Admins always pass so they can verify it. The
        "Visible to" audience on each card is recorded only and is not enforced.
      </Note>

      <ErrorState message={!loading ? error : null} onRetry={load} />

      {/* Status overview */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-3 lg:col-span-2 content-start">
          <StatTile label="Live" value={loading ? 'N/A' : counts.live} tone="good" icon={Rocket}
            active={statusFilter === 'live'} onClick={() => setStatusFilter(statusFilter === 'live' ? 'all' : 'live')} />
          <StatTile label="Maintenance" value={loading ? 'N/A' : counts.maintenance} tone="warning" icon={Wrench}
            active={statusFilter === 'maintenance'} onClick={() => setStatusFilter(statusFilter === 'maintenance' ? 'all' : 'maintenance')} />
          <StatTile label="Off" value={loading ? 'N/A' : counts.disabled} tone="danger" icon={Power}
            active={statusFilter === 'disabled'} onClick={() => setStatusFilter(statusFilter === 'disabled' ? 'all' : 'disabled')} />
          <StatTile label="Beta" value={loading ? 'N/A' : counts.beta} tone="muted" icon={Sparkles}
            active={statusFilter === 'beta'} onClick={() => setStatusFilter(statusFilter === 'beta' ? 'all' : 'beta')} />
        </div>
        <Panel>
          <PanelHeader title="Modules by status"
            subtitle={loading ? 'Loading' : `${outOfService} of ${modules.length} out of service`} />
          {loading ? <LoadingState rows={2} /> : (
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

      {/* Toolbar: status, search, category */}
      <Toolbar>
        <Segmented
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { key: 'all', label: 'All', count: modules.length },
            { key: 'live', label: 'Live', count: counts.live },
            { key: 'maintenance', label: 'Maintenance', count: counts.maintenance },
            { key: 'disabled', label: 'Off', count: counts.disabled },
            ...(counts.beta ? [{ key: 'beta', label: 'Beta', count: counts.beta }] : []),
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search by module id or name" className="flex-1 min-w-[200px]" />
        <Select
          value={category}
          onChange={setCategory}
          options={[{ value: 'all', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
          ariaLabel="Filter by category"
          className="w-48"
        />
      </Toolbar>

      {/* Bulk action bar */}
      {!loading && filtered.length > 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
          selectedIds.length > 0 ? 'border-orange-800/40 bg-orange-950/20' : 'border-gray-800 bg-gray-900/50'}`}>
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible}
              className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 accent-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
            {selectedIds.length > 0
              ? <span className="text-orange-200 font-semibold">{selectedIds.length} selected</span>
              : `Select all ${filtered.length} shown`}
          </label>
          {selectedIds.length > 0 && (
            <Toolbar>
              <Btn icon={Wrench} onClick={() => requestStatus('bulk', selectedIds, 'maintenance')} busy={savingBulk}>
                Set Maintenance
              </Btn>
              <Btn icon={Rocket} variant="good" onClick={() => requestStatus('bulk', selectedIds, 'live')} busy={savingBulk}>
                Set Live
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((m) => (
            <ModuleCard
              key={m.module_id}
              module={m}
              busy={busyId === m.module_id}
              checked={selected.has(m.module_id)}
              onToggleSelect={() => toggleSelected(m.module_id)}
              onPick={(status) => requestStatus('one', [m.module_id], status)}
            />
          ))}
        </div>
      )}

      {/* Dependency confirm modal */}
      <ConfirmModal
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && applyStatus(confirm.scope, confirm.ids, confirm.status)}
      />

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
        onCancel={() => setMaintModal(null)}
        onConfirm={() => maintModal && applyStatus(maintModal.scope, maintModal.ids, 'maintenance', { until: maintUntil, note: maintNote })}
      />
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function ModuleCard({ module: m, busy, checked, onToggleSelect, onPick }) {
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
        <span className="text-[10px] text-gray-500 flex items-center gap-1"
          title="Who this module is intended for. Recorded only; not enforced.">
          Visible to: {VISIBLE_LABEL[m.visible_to] || m.visible_to || 'Everyone'}
          <Info size={11} className="text-gray-500" aria-hidden="true" />
        </span>
      </div>
    </div>
  )
}

const FIELD_LABEL = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1'
const FIELD_INPUT = 'w-full h-9 bg-gray-900 border border-gray-800 rounded-lg px-3 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-700 focus-visible:ring-2 focus-visible:ring-orange-500'

function MaintenanceModal({ open, count, until, note, warnings, busy, onUntil, onNote, onCancel, onConfirm }) {
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
          <Btn variant="primary" icon={Wrench} onClick={onConfirm} busy={busy}>Set maintenance</Btn>
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
