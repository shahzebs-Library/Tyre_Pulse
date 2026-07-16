/**
 * ConsoleModuleControl - super-admin Module Control Center (Admin Control
 * Module 8, V258 `modules`).
 *
 * A pure console page (navy + orange theme, useConsoleAuth for the admin gate;
 * no ConsoleAuthBridge needed). One board to see every product module and set
 * its lifecycle status:
 *   1. First load seeds any missing catalog module (status Live) then lists all.
 *   2. Each module renders as a card: name, category tag, Live / Maintenance /
 *      Off segmented toggle, who it is visible to, and a short note.
 *   3. Category filter + free-text search by id or name.
 *   4. Bulk action: select several modules -> set Maintenance or Live at once.
 *   5. Dependency guard: taking a module out of service that a still-Live module
 *      depends on opens a confirm modal listing the affected dependents.
 *
 * HONESTY: status is RECORDED here for administration. App-wide hiding of a
 * module's pages from regular users is being rolled out separately - this screen
 * does NOT hide any route yet, and says so in a banner.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes, RefreshCw, Search, Filter, Info, X, AlertTriangle, CheckCircle2,
  Power, Wrench, Rocket, Sparkles, ShieldAlert,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  listModules, seedFromCatalog, setModuleStatus, bulkSetStatus,
  dependencyWarnings, MODULE_STATUS_META,
} from '../../lib/api/modulesRegistry'
import { toUserMessage } from '../../lib/safeError'

// ── Small building blocks ─────────────────────────────────────────────────────

/** Plain-English tooltip marker sitting next to a technical term. */
function InfoDot({ text }) {
  return (
    <span className="inline-flex align-middle ml-1 text-gray-600 hover:text-gray-300 cursor-help" title={text}>
      <Info size={11} />
    </span>
  )
}

const TONE_BADGE = {
  green: 'text-emerald-300 bg-emerald-900/30 border-emerald-700/40',
  amber: 'text-amber-300 bg-amber-900/30 border-amber-700/40',
  red: 'text-red-300 bg-red-900/30 border-red-700/40',
  blue: 'text-blue-300 bg-blue-900/30 border-blue-700/40',
  gray: 'text-gray-400 bg-gray-800 border-gray-700',
}

/** Coloured status pill for a module. */
function StatusBadge({ status }) {
  const meta = MODULE_STATUS_META[status] || { label: status || 'Unknown', tone: 'gray' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${TONE_BADGE[meta.tone] || TONE_BADGE.gray}`}>
      {meta.label}
    </span>
  )
}

const VISIBLE_LABEL = {
  all: 'Everyone',
  admin_only: 'Admins only',
  specific_roles: 'Specific roles',
}

// The three lifecycle states surfaced by the segmented toggle. 'beta' is a valid
// stored status (shown as a badge) but is not one of the quick-toggle buttons.
const TOGGLE = [
  { status: 'live', label: 'Live', icon: Rocket, on: 'bg-emerald-600 text-white', off: 'text-emerald-300 hover:bg-emerald-900/30' },
  { status: 'maintenance', label: 'Maintenance', icon: Wrench, on: 'bg-amber-600 text-white', off: 'text-amber-300 hover:bg-amber-900/30' },
  { status: 'disabled', label: 'Off', icon: Power, on: 'bg-red-600 text-white', off: 'text-red-300 hover:bg-red-900/30' },
]

/** Live / Maintenance / Off segmented control for one module. */
function StatusToggle({ current, disabled, onPick }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden">
      {TOGGLE.map((t) => {
        const active = current === t.status
        const Icon = t.icon
        return (
          <button
            key={t.status}
            type="button"
            disabled={disabled || active}
            onClick={() => onPick(t.status)}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-100
              ${active ? t.on : `bg-gray-900/40 ${t.off}`} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Icon size={11} /> {t.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsoleModuleControl() {
  const { admin } = useConsoleAuth()
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [savingBulk, setSavingBulk] = useState(false)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [selected, setSelected] = useState(() => new Set())

  // Pending status change awaiting dependency confirmation.
  // { scope: 'one'|'bulk', ids: string[], status, warnings: string[] }
  const [confirm, setConfirm] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await seedFromCatalog()
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
      if (!q) return true
      return (
        String(m.module_id || '').toLowerCase().includes(q) ||
        String(m.name || '').toLowerCase().includes(q)
      )
    })
  }, [modules, search, category])

  const counts = useMemo(() => {
    const c = { live: 0, maintenance: 0, disabled: 0, beta: 0 }
    for (const m of modules) if (c[m.status] != null) c[m.status] += 1
    return c
  }, [modules])

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
    // Gather dependency warnings across every module being taken out of service.
    const warnings = []
    for (const id of ids) {
      for (const w of dependencyWarnings(modules, id, status)) {
        if (!warnings.includes(w)) warnings.push(w)
      }
    }
    if (warnings.length > 0) {
      setConfirm({ scope, ids, status, warnings })
    } else {
      applyStatus(scope, ids, status)
    }
  }

  async function applyStatus(scope, ids, status) {
    setConfirm(null)
    setError(null)
    try {
      if (scope === 'bulk') {
        setSavingBulk(true)
        await bulkSetStatus(ids, status)
      } else {
        setBusyId(ids[0])
        await setModuleStatus(ids[0], status)
      }
      // Optimistic local update so the board reflects the change immediately.
      const idSet = new Set(ids)
      const stamp = new Date().toISOString()
      setModules((prev) => prev.map((m) => (
        idSet.has(m.module_id) ? { ...m, status, last_updated: stamp } : m
      )))
      if (scope === 'bulk') setSelected(new Set())
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusyId(null)
      setSavingBulk(false)
    }
  }

  const selectedIds = useMemo(
    () => filtered.filter((m) => selected.has(m.module_id)).map((m) => m.module_id),
    [filtered, selected],
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Boxes size={20} className="text-orange-400" /> Module Control Center
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {admin?.full_name ? `Signed in as ${admin.full_name}. ` : ''}
            Turn product modules Live, into Maintenance, or Off across the platform.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Honest enforcement banner */}
      <div className="flex items-start gap-2 rounded-xl border border-blue-800/40 bg-blue-900/15 p-3">
        <ShieldAlert size={16} className="text-blue-300 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-200/90 leading-relaxed">
          Status is recorded here; app-wide hiding of a module from regular users is being rolled out.
          Setting a module to Maintenance or Off saves the decision for the whole platform, but does not
          yet remove the pages from other users. Use this to plan and record module state.
        </p>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile label="Live" value={counts.live} tone="green" icon={Rocket} />
        <SummaryTile label="Maintenance" value={counts.maintenance} tone="amber" icon={Wrench} />
        <SummaryTile label="Off" value={counts.disabled} tone="red" icon={Power} />
        <SummaryTile label="Beta" value={counts.beta} tone="blue" icon={Sparkles} />
      </div>

      {/* Toolbar: search + category filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by module id or name"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-600"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-500" />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="py-1.5 pl-2 pr-7 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:border-orange-600"
          >
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-orange-700/40 bg-orange-900/15 p-3">
          <p className="text-xs text-orange-200 font-semibold">
            {selectedIds.length} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => requestStatus('bulk', selectedIds, 'maintenance')}
              disabled={savingBulk}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-700/80 hover:bg-amber-600 text-white text-[11px] font-semibold disabled:opacity-50"
            >
              <Wrench size={11} /> Set Maintenance
            </button>
            <button
              onClick={() => requestStatus('bulk', selectedIds, 'live')}
              disabled={savingBulk}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-white text-[11px] font-semibold disabled:opacity-50"
            >
              <Rocket size={11} /> Set Live
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-2 py-1 rounded-lg text-gray-400 hover:text-white text-[11px]"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-800/40 bg-red-900/15 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-300" />
            <p className="text-xs text-red-200">{error}</p>
          </div>
          <button onClick={load} className="text-xs text-red-300 hover:text-white underline">Retry</button>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl border border-gray-800 bg-gray-900/40 animate-pulse" />
          ))}
        </div>
      ) : modules.length === 0 ? (
        <EmptyState
          title="No modules registered yet"
          body="The module registry is empty or has not been provisioned. Refresh to seed it from the product catalog."
          onRefresh={load}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No modules match your filters"
          body="Try a different category or clear the search box."
          onRefresh={() => { setSearch(''); setCategory('all') }}
          refreshLabel="Clear filters"
        />
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
      {confirm && (
        <ConfirmModal
          confirm={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => applyStatus(confirm.scope, confirm.ids, confirm.status)}
        />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function SummaryTile({ label, value, tone, icon: Icon }) {
  const ring = {
    green: 'border-emerald-800/40 bg-emerald-900/10 text-emerald-300',
    amber: 'border-amber-800/40 bg-amber-900/10 text-amber-300',
    red: 'border-red-800/40 bg-red-900/10 text-red-300',
    blue: 'border-blue-800/40 bg-blue-900/10 text-blue-300',
  }[tone] || 'border-gray-800 bg-gray-900/40 text-gray-300'
  return (
    <div className={`rounded-xl border p-3 ${ring}`}>
      <Icon size={16} className="mb-1.5 opacity-80" />
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-[11px] font-semibold mt-0.5">{label}</p>
    </div>
  )
}

function ModuleCard({ module: m, busy, checked, onToggleSelect, onPick }) {
  return (
    <div className={`rounded-xl border p-3.5 transition-colors ${checked ? 'border-orange-700/50 bg-orange-900/10' : 'border-gray-800 bg-gray-900/50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleSelect}
            className="mt-1 h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 accent-orange-500 flex-shrink-0"
            aria-label={`Select ${m.name || m.module_id}`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-white truncate">{m.name || m.module_id}</p>
              <StatusBadge status={m.status} />
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[10px] font-mono text-gray-600">{m.module_id}</span>
              {m.category && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                  {m.category}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {m.note && <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">{m.note}</p>}

      <div className="flex items-center justify-between gap-2 mt-3">
        <StatusToggle current={m.status} disabled={busy} onPick={onPick} />
        <span className="text-[10px] text-gray-600 flex items-center gap-1">
          Visible: {VISIBLE_LABEL[m.visible_to] || m.visible_to || 'Everyone'}
          <InfoDot text="Who this module is intended for. Enforcement of visibility is being rolled out." />
        </span>
      </div>
    </div>
  )
}

function EmptyState({ title, body, onRefresh, refreshLabel = 'Refresh' }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center">
      <Boxes size={28} className="mx-auto text-gray-700 mb-3" />
      <p className="text-sm font-semibold text-gray-300">{title}</p>
      <p className="text-xs text-gray-600 mt-1 max-w-md mx-auto">{body}</p>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white text-xs border border-gray-700"
        >
          <RefreshCw size={12} /> {refreshLabel}
        </button>
      )}
    </div>
  )
}

function ConfirmModal({ confirm, onCancel, onConfirm }) {
  const meta = MODULE_STATUS_META[confirm.status] || { label: confirm.status }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" /> Dependency check
          </h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-300 leading-relaxed">
            You are about to set {confirm.ids.length > 1 ? `${confirm.ids.length} modules` : 'this module'} to{' '}
            <span className="font-semibold text-white">{meta.label}</span>. Other modules that are still Live
            depend on what you are taking out of service:
          </p>
          <ul className="space-y-1.5">
            {confirm.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-amber-200">
                <AlertTriangle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                {w}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-500">
            Those modules may not work correctly while this one is out of service.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-800">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-orange-600 hover:bg-orange-500"
          >
            <CheckCircle2 size={13} /> Apply anyway
          </button>
        </div>
      </div>
    </div>
  )
}
