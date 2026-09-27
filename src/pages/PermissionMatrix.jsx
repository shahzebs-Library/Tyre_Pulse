import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Shield, ShieldAlert, Search, Save, Loader2, Check, X, AlertTriangle,
  RotateCcw, Lock, Info, Eye, Undo2, Layers, Users, FileSpreadsheet, FileText, EyeOff,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import {
  flattenModules, matrixStats, filterModules, cellSummary, matrixExportRows,
} from '../lib/permissionMatrixAnalytics'
import { useAuth } from '../contexts/AuthContext'
import { listGlobalPermissions, saveAccessControlMatrix } from '../lib/api/modulePermissions'
import {
  MODULE_GROUPS, ROLES, CAPABILITIES,
  getEffectiveMatrix, setPermission, matrixDiff, diffFromDefaults,
  extractViewChanges, stripView, isEmptyDiff, countDiff,
  getPermissionOverrides, buildDefaultMatrix,
} from '../lib/permissionMatrix'
import { toUserMessage } from '../lib/safeError'

const ROLE_TINT = {
  Admin: 'text-purple-300', Manager: 'text-blue-300', Director: 'text-indigo-300',
  Reporter: 'text-cyan-300', Inspector: 'text-green-300', 'Tyre Man': 'text-amber-300',
  Driver: 'text-secondary',
}

const cellKey = (role, mod) => `${role}::${mod}`

/**
 * PermissionMatrix — admin-only role × module × capability grid (Roadmap #17).
 * `view` saves through the existing set_module_permissions RPC (live enforcement
 * via AuthContext.hasPermission); the other capabilities are stored in
 * app_settings `permission_overrides` for progressive enforcement.
 */
export default function PermissionMatrix() {
  const { profile, isSuperAdmin, refreshAccess } = useAuth()
  const isAdmin = profile?.role === 'Admin' || isSuperAdmin

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [baseline, setBaseline] = useState(null)   // last-saved effective matrix
  const [draft, setDraft] = useState(null)          // edited matrix
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [selected, setSelected] = useState(null)    // { mod, role } — expanded capability editor

  const defaults = useMemo(() => buildDefaultMatrix(), [])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [viewMap, overrides] = await Promise.all([
        listGlobalPermissions(),
        getPermissionOverrides(),
      ])
      const effective = getEffectiveMatrix(overrides, viewMap)
      setBaseline(effective)
      setDraft(structuredClone(effective))
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the permission matrix.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])

  const unsavedDiff = useMemo(
    () => (baseline && draft ? matrixDiff(baseline, draft) : {}),
    [baseline, draft],
  )
  const unsavedCount = useMemo(() => countDiff(unsavedDiff), [unsavedDiff])

  // role::module keys with any unsaved change (amber ring)
  const unsavedCells = useMemo(() => {
    const s = new Set()
    for (const [role, mods] of Object.entries(unsavedDiff))
      for (const mod of Object.keys(mods)) s.add(cellKey(role, mod))
    return s
  }, [unsavedDiff])

  // role::module keys deviating from hardcoded defaults (override dot)
  const overriddenCells = useMemo(() => {
    if (!draft) return new Set()
    const d = diffFromDefaults(draft)
    const s = new Set()
    for (const [role, mods] of Object.entries(d))
      for (const mod of Object.keys(mods)) s.add(cellKey(role, mod))
    return s
  }, [draft])

  const allModules = useMemo(() => flattenModules(MODULE_GROUPS), [])
  const filteredModules = useMemo(() => filterModules(allModules, {
    search, group: groupFilter, state: stateFilter,
  }, { matrix: draft, roles: ROLES, overridden: overriddenCells, unsaved: unsavedCells }),
  [allModules, search, groupFilter, stateFilter, draft, overriddenCells, unsavedCells])
  const stats = useMemo(
    () => (draft ? matrixStats(draft, ROLES, allModules, CAPABILITIES, overriddenCells, unsavedCells) : null),
    [draft, allModules, overriddenCells, unsavedCells],
  )

  function exportMatrix(kind) {
    const rows = matrixExportRows(filteredModules, draft, ROLES, CAPABILITIES)
    const keys = ['group', 'module', ...ROLES]
    const headers = ['Group', 'Module', ...ROLES]
    const name = reportFileName('Permission Matrix')
    if (kind === 'excel') exportToExcel(rows, keys, headers, name, 'Permission Matrix')
    else exportToPdf(rows, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Permission Matrix', name, 'landscape')
  }

  const columns = useMemo(() => {
    if (!draft) return []
    const moduleCol = {
      id: 'module', header: 'Module', accessorFn: (m) => m.label,
      cell: ({ row }) => {
        const m = row.original
        const isDefaultRow = ROLES.every((r) => !overriddenCells.has(cellKey(r, m.key)))
        return (
          <div className="flex items-center gap-1 min-w-[12rem]">
            <div className="min-w-0">
              <p className="truncate" style={{ color: 'var(--table-cell-text)' }}>{m.label}</p>
              <p className="text-[11px] text-dim truncate">{m.group}</p>
            </div>
            {!isDefaultRow && (
              <button type="button" onClick={(e) => { e.stopPropagation(); resetModule(m.key) }} aria-label={`Reset ${m.label} to defaults for every role`}
                className="ml-auto min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-dim hover:text-brand-bright focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)]">
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        )
      },
    }
    const roleCols = ROLES.map((r) => ({
      id: `role:${r}`,
      header: r,
      enableSorting: false,
      accessorFn: (m) => cellSummary(draft, r, m.key, CAPABILITIES),
      meta: { align: 'center', exportHeader: r },
      cell: ({ row }) => {
        const m = row.original
        const caps = draft[r][m.key]
        const locked = r === 'Admin'
        const isSel = selected?.mod === m.key && selected?.role === r
        const unsaved = unsavedCells.has(cellKey(r, m.key))
        const overridden = overriddenCells.has(cellKey(r, m.key))
        const summary = cellSummary(draft, r, m.key, CAPABILITIES)
        return (
          <button type="button" disabled={locked}
            onClick={(e) => { e.stopPropagation(); setSelected(isSel ? null : { mod: m.key, role: r }) }}
            aria-pressed={isSel}
            aria-label={locked ? `${r}: full access to ${m.label}` : `${m.label} for ${r}: ${summary}${unsaved ? ', unsaved' : ''}${overridden ? ', differs from default' : ''}. Edit`}
            className={`relative inline-flex flex-col items-center justify-center min-w-[48px] min-h-[44px] rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${
              locked ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:bg-surface-3'
            } ${unsaved ? 'ring-2 ring-amber-500/70' : ''} ${isSel ? 'bg-surface-3' : 'bg-surface-2'}`}
            style={{ border: `1px solid ${isSel ? 'var(--border-bright)' : 'var(--border-dim)'}` }}>
            {caps.view
              ? <Eye size={14} className="text-green-400" aria-hidden="true" />
              : <EyeOff size={14} className="text-dim" aria-hidden="true" />}
            <span className="flex gap-0.5 mt-1" aria-hidden="true">
              {CAPABILITIES.filter((c) => !c.enforced).map((c) => (
                <i key={c.key} className={`w-1 h-1 rounded-full inline-block ${caps[c.key] ? 'bg-brand' : 'bg-surface-3'}`}
                  style={caps[c.key] ? undefined : { border: '1px solid var(--border-dim)' }} />
              ))}
            </span>
            {overridden && <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-blue-400" aria-hidden="true" />}
            {locked && <Lock size={8} className="absolute top-0.5 right-0.5 text-dim" aria-hidden="true" />}
          </button>
        )
      },
    }))
    return [moduleCol, ...roleCols]
  }, [draft, selected, unsavedCells, overriddenCells]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleCap(role, mod, cap) {
    if (role === 'Admin' || cap === 'delete') return
    setNotice('')
    setDraft((d) => setPermission(d, role, mod, cap, !(d[role]?.[mod]?.[cap] === true)))
  }

  function resetModule(mod) {
    setNotice('')
    setDraft((d) => {
      let next = d
      for (const role of ROLES) {
        if (role === 'Admin') continue
        for (const c of CAPABILITIES) {
          next = setPermission(next, role, mod, c.key, defaults[role][mod][c.key])
        }
      }
      return next
    })
  }

  function resetAll() {
    setNotice('')
    setDraft(structuredClone(defaults))
  }

  function discard() {
    setNotice('')
    setSelected(null)
    setDraft(structuredClone(baseline))
  }

  async function save() {
    if (isEmptyDiff(unsavedDiff) || saving) return
    setSaving(true); setError(''); setNotice('')
    const prevBaseline = baseline
    const nextBaseline = structuredClone(draft)
    // Optimistic: commit locally first, roll back on failure.
    setBaseline(nextBaseline)
    try {
      const viewChanges = extractViewChanges(unsavedDiff)
      await saveAccessControlMatrix({
        viewChanges,
        overrides: stripView(diffFromDefaults(nextBaseline)),
      })
      await refreshAccess?.()
      setNotice(
        viewChanges.length
          ? `Saved. ${viewChanges.length} view change${viewChanges.length !== 1 ? 's' : ''} take effect on each user's next load; other capabilities are stored for progressive enforcement.`
          : 'Saved. Capability changes are stored for progressive enforcement.',
      )
    } catch (e) {
      setBaseline(prevBaseline)
      setError(toUserMessage(e, 'Could not save permission changes. Your edits are still here, try again.'))
    } finally {
      setSaving(false)
    }
  }

  // ── Access guard ────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center px-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <ShieldAlert size={28} className="text-red-400" />
        </div>
        <h2 className="text-h3 mb-1">Admins only</h2>
        <p className="text-sm text-muted max-w-md">
          The Permission Matrix controls what every role can see and do across the platform.
          Ask an administrator if a role needs different access.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="card flex items-center justify-center py-20 text-muted">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading permission matrix
      </div>
    )
  }

  if (error && !draft) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center gap-3">
        <AlertTriangle size={24} className="text-red-400" />
        <p className="text-sm text-red-300">{error}</p>
        <button type="button" onClick={load}
          className="min-h-[44px] px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:brightness-110">
          Retry
        </button>
      </div>
    )
  }

  const selectedModule = selected ? allModules.find((m) => m.key === selected.mod) : null

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <Shield size={22} className="text-accent" aria-hidden="true" />
          <div>
            <h1 className="text-h2">Permission Matrix</h1>
            <p className="text-xs text-muted">Per-role, per-module capabilities. Admin always has full access.</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => exportMatrix('excel')} disabled={!filteredModules.length}
            className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-surface-2 text-secondary hover:text-brand-bright text-xs disabled:opacity-40"
            style={{ border: '1px solid var(--border-dim)' }}>
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button type="button" onClick={() => exportMatrix('pdf')} disabled={!filteredModules.length}
            className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-surface-2 text-secondary hover:text-brand-bright text-xs disabled:opacity-40"
            style={{ border: '1px solid var(--border-dim)' }}>
            <FileText size={13} /> PDF
          </button>
          <button type="button" onClick={resetAll} disabled={saving}
            className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-surface-2 text-secondary hover:text-brand-bright text-xs disabled:opacity-40"
            style={{ border: '1px solid var(--border-dim)' }}
            title="Set every role and module back to the built-in defaults">
            <RotateCcw size={13} /> Reset all to defaults
          </button>
        </div>
      </div>

      {/* Enforcement status banner */}
      <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 bg-surface-1 text-xs"
        style={{ border: '1px solid var(--border-brand)' }}>
        <Info size={15} className="text-brand-bright mt-0.5 shrink-0" aria-hidden="true" />
        <div className="text-secondary leading-relaxed">
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Enforcement status: </span>
          <span className="font-medium text-brand-bright">View</span> is enforced now, changes save through the
          existing access-control path (module_permissions) and apply on each user's next load.
          <span className="font-medium"> Create, Edit, Delete, Export and Approve</span> are stored here for
          progressive enforcement and do not restrict anything yet, they will activate as modules adopt
          capability checks.
        </div>
      </div>

      {/* KPI strip */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: 'Modules', value: stats.modules, hint: `${stats.editableRoles} editable roles`, icon: Layers },
            { label: 'View grants', value: stats.viewGrants, hint: stats.viewCoverage == null ? 'N/A' : `${stats.viewCoverage}% of role and module cells`, icon: Eye },
            { label: 'Stored capabilities on', value: stats.storedOn, hint: 'Not yet enforced', icon: Users },
            { label: 'Modules differing from default', value: stats.overriddenModules, icon: Info, onClick: () => setStateFilter(stateFilter === 'overridden' ? 'all' : 'overridden'), active: stateFilter === 'overridden' },
            { label: 'Modules with unsaved edits', value: stats.unsavedModules, icon: AlertTriangle, onClick: () => setStateFilter(stateFilter === 'unsaved' ? 'all' : 'unsaved'), active: stateFilter === 'unsaved' },
          ].map((k) => {
            const Icon = k.icon
            const inner = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted">{k.label}</p>
                  <Icon size={15} className="text-dim" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: 'var(--text-primary)' }}>{k.value}</p>
                {k.hint && <p className="text-[11px] text-muted mt-0.5">{k.hint}</p>}
              </>
            )
            return k.onClick ? (
              <button type="button" key={k.label} onClick={k.onClick} aria-pressed={k.active}
                className={`card text-left min-h-[44px] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${k.active ? 'ring-2 ring-[var(--brand-bright)]' : ''}`}>
                {inner}
              </button>
            ) : <div key={k.label} className="card">{inner}</div>
          })}
        </div>
      )}

      {(error || notice) && (
        <div role={error ? 'alert' : 'status'} className={`rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 ${
          error ? 'text-red-300' : 'text-green-300'}`}
          style={{ border: `1px solid ${error ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
            background: error ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)' }}>
          {error ? <AlertTriangle size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />} {error || notice}
        </div>
      )}

      {/* Filters */}
      <div className="card flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a module"
            aria-label="Find a module" className="input pl-9 w-full min-h-[44px]" />
        </div>
        <select className="input min-h-[44px]" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Module group">
          <option value="">All groups</option>
          {MODULE_GROUPS.map((g) => <option key={g.group} value={g.group}>{g.group}</option>)}
        </select>
        <select className="input min-h-[44px]" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} aria-label="Module state">
          <option value="all">All modules</option>
          <option value="overridden">Differs from default</option>
          <option value="unsaved">Unsaved edits</option>
          <option value="hidden">No role can view</option>
        </select>
        {(search || groupFilter || stateFilter !== 'all') && (
          <button type="button" onClick={() => { setSearch(''); setGroupFilter(''); setStateFilter('all') }}
            className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-surface-2 text-secondary text-xs"
            style={{ border: '1px solid var(--border-dim)' }}>
            <X size={13} /> Clear
          </button>
        )}
        <span className="text-xs text-muted ml-auto" aria-live="polite">{filteredModules.length} of {allModules.length} modules</span>
      </div>

      {/* Capability editor for the selected cell */}
      {selected && selectedModule && (
        <CapabilityEditor role={selected.role} mod={selectedModule} draft={draft} defaults={defaults}
          toggleCap={toggleCap} onClose={() => setSelected(null)} />
      )}

      {/* Matrix */}
      <EnterpriseTable
        columns={columns}
        data={filteredModules}
        getRowId={(m) => m.key}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        stickyFirstColumn
        initialPageSize={100}
        pageSizeOptions={[50, 100, 250]}
        exportFileName={reportFileName('Permission Matrix')}
        emptyMessage={search ? `No modules match "${search}".` : 'No modules match these filters.'}
      />

      {/* Legend */}
      <div className="px-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-1.5"><Eye size={12} className="text-green-400" aria-hidden="true" /> View granted (enforced)</span>
        <span className="flex items-center gap-1.5"><EyeOff size={12} className="text-dim" aria-hidden="true" /> No view</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex gap-0.5" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className="w-1.5 h-1.5 rounded-full bg-brand inline-block" />)}</span>
          Stored capabilities on
        </span>
        <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded-md ring-2 ring-amber-500/70 inline-block" aria-hidden="true" /> Unsaved change</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" aria-hidden="true" /> Differs from default</span>
      </div>

      {/* Unsaved-changes bar */}
      {unsavedCount > 0 && (
        <div role="region" aria-label="Unsaved changes"
          className="fixed bottom-4 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-40 flex flex-wrap items-center gap-3 rounded-2xl px-5 py-3 shadow-float bg-surface-3"
          style={{ border: '1px solid var(--border-bright)' }}>
          <span className="text-sm text-secondary">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{unsavedCount}</span>
            {' '}unsaved permission change{unsavedCount !== 1 ? 's' : ''}
          </span>
          <button type="button" onClick={discard} disabled={saving}
            className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-surface-2 text-secondary hover:text-brand-bright text-xs disabled:opacity-40"
            style={{ border: '1px solid var(--border-dim)' }}>
            <Undo2 size={13} /> Discard
          </button>
          <button type="button" onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 min-h-[44px] rounded-lg bg-accent text-white text-xs font-semibold hover:brightness-110 disabled:opacity-40">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

function CapabilityEditor({ role, mod, draft, defaults, toggleCap, onClose }) {
  return (
    <div className="card" role="group" aria-label={`${mod.label} capabilities for ${role}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted mr-1">
          <span className={`font-semibold ${ROLE_TINT[role] || ''}`}>{role}</span>
          {' '}for <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{mod.label}</span>:
        </span>
        {CAPABILITIES.map((c) => {
          const on = draft[role][mod.key][c.key] === true
          const protectedDelete = c.key === 'delete'
          const isDefault = defaults[role][mod.key][c.key] === on
          return (
            <button key={c.key} type="button" disabled={protectedDelete} onClick={() => toggleCap(role, mod.key, c.key)}
              aria-pressed={on}
              title={protectedDelete ? 'Delete is reserved for Admin and Super Admin' : `${c.description}${c.enforced ? '' : ' (stored, not yet enforced)'}${isDefault ? '' : ', differs from default'}`}
              className={`flex items-center gap-1.5 px-3 min-h-[44px] rounded-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${
                on ? 'text-green-300' : 'text-dim hover:text-secondary'}`}
              style={{
                background: on ? 'rgba(34,197,94,0.12)' : 'var(--btn-2-bg)',
                border: `1px solid ${on ? 'rgba(34,197,94,0.35)' : isDefault ? 'var(--btn-2-border)' : 'rgba(96,165,250,0.5)'}`,
              }}>
              {on ? <Check size={11} aria-hidden="true" /> : <X size={11} aria-hidden="true" />}
              {c.label}
              {protectedDelete ? (
                <span className="text-[10px] uppercase tracking-wide opacity-70">admin only</span>
              ) : !c.enforced && (
                <span className="text-[10px] uppercase tracking-wide opacity-70">stored</span>
              )}
            </button>
          )
        })}
        <button type="button" onClick={onClose} aria-label="Close capability editor"
          className="ml-auto min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-dim hover:text-secondary">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
