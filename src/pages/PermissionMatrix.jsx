import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Shield, ShieldAlert, Search, Save, Loader2, Check, X, AlertTriangle,
  RotateCcw, Lock, Info, Eye, Undo2,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { listGlobalPermissions, saveModulePermissions } from '../lib/api/modulePermissions'
import {
  MODULE_GROUPS, ROLES, CAPABILITIES,
  getEffectiveMatrix, setPermission, matrixDiff, diffFromDefaults,
  extractViewChanges, stripView, isEmptyDiff, countDiff,
  getPermissionOverrides, savePermissionOverrides, buildDefaultMatrix,
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
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'Admin'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [baseline, setBaseline] = useState(null)   // last-saved effective matrix
  const [draft, setDraft] = useState(null)          // edited matrix
  const [search, setSearch] = useState('')
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

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return MODULE_GROUPS
    return MODULE_GROUPS
      .map((g) => ({ ...g, modules: g.modules.filter((m) => m.label.toLowerCase().includes(q) || m.key.includes(q)) }))
      .filter((g) => g.modules.length)
  }, [search])

  function toggleCap(role, mod, cap) {
    if (role === 'Admin') return
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
      if (viewChanges.length) await saveModulePermissions(viewChanges)
      await savePermissionOverrides(stripView(diffFromDefaults(nextBaseline)))
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
        <Loader2 className="animate-spin mr-2" size={18} /> Loading permission matrix…
      </div>
    )
  }

  if (error && !draft) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center gap-3">
        <AlertTriangle size={24} className="text-red-400" />
        <p className="text-sm text-red-300">{error}</p>
        <button onClick={load}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:brightness-110">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <Shield size={22} className="text-accent" />
          <div>
            <h1 className="text-h2">Permission Matrix</h1>
            <p className="text-xs text-muted">Per-role, per-module capabilities. Admin always has full access.</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-surface-2 rounded-lg px-2.5 py-1.5"
            style={{ border: '1px solid var(--border-dim)' }}>
            <Search size={13} className="text-dim" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a module…"
              className="bg-transparent text-xs focus:outline-none w-40" style={{ color: 'var(--text-primary)' }} />
            {search && (
              <button onClick={() => setSearch('')} className="text-dim hover:text-secondary"><X size={12} /></button>
            )}
          </div>
          <button onClick={resetAll} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 text-secondary hover:text-brand-bright text-xs disabled:opacity-40"
            style={{ border: '1px solid var(--border-dim)' }}
            title="Set every role and module back to the built-in defaults">
            <RotateCcw size={13} /> Reset all to defaults
          </button>
        </div>
      </div>

      {/* Enforcement status banner */}
      <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 bg-surface-1 text-xs"
        style={{ border: '1px solid var(--border-brand)' }}>
        <Info size={15} className="text-brand-bright mt-0.5 shrink-0" />
        <div className="text-secondary leading-relaxed">
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Enforcement status: </span>
          <span className="font-medium text-brand-bright">View</span> is enforced now, changes save through the
          existing access-control path (module_permissions) and apply on each user's next load.
          <span className="font-medium"> Create, Edit, Delete, Export and Approve</span> are stored here for
          progressive enforcement and do not restrict anything yet, they will activate as modules adopt
          capability checks.
        </div>
      </div>

      {(error || notice) && (
        <div className={`rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 ${
          error ? 'text-red-300' : 'text-green-300'}`}
          style={{ border: `1px solid ${error ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
            background: error ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)' }}>
          {error ? <AlertTriangle size={15} /> : <Check size={15} />} {error || notice}
        </div>
      )}

      {/* Matrix */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-dim)' }}>
                <th className="sticky left-0 z-10 bg-surface-1 text-left px-4 py-3 min-w-56 text-muted font-medium">
                  Module
                </th>
                {ROLES.map((r) => (
                  <th key={r} className="px-3 py-2.5 text-center min-w-28">
                    <div className={`text-xs font-semibold ${ROLE_TINT[r] || 'text-secondary'}`}>{r}</div>
                    {r === 'Admin' && (
                      <div className="flex items-center justify-center gap-1 mt-1 text-[10px] text-dim">
                        <Lock size={9} /> full access
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredGroups.length === 0 && (
                <tr>
                  <td colSpan={ROLES.length + 1} className="px-4 py-10 text-center text-muted text-sm">
                    No modules match “{search}”.
                  </td>
                </tr>
              )}
              {filteredGroups.map((g) => (
                <GroupRows key={g.group} group={g} draft={draft}
                  selected={selected} setSelected={setSelected}
                  unsavedCells={unsavedCells} overriddenCells={overriddenCells}
                  toggleCap={toggleCap} resetModule={resetModule} defaults={defaults} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted"
          style={{ borderTop: '1px solid var(--border-dim)' }}>
          <span className="flex items-center gap-1.5"><Eye size={12} className="text-green-400" /> View granted (enforced)</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex gap-0.5">{[1, 2, 3].map((i) => <i key={i} className="w-1.5 h-1.5 rounded-full bg-brand inline-block" />)}</span>
            Stored capabilities on
          </span>
          <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded-md ring-2 ring-amber-500/70 inline-block" /> Unsaved change</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" /> Differs from default</span>
        </div>
      </div>

      {/* Unsaved-changes bar */}
      {unsavedCount > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl px-5 py-3 shadow-float bg-surface-3"
          style={{ border: '1px solid var(--border-bright)' }}>
          <span className="text-sm text-secondary">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{unsavedCount}</span>
            {' '}unsaved permission change{unsavedCount !== 1 ? 's' : ''}
          </span>
          <button onClick={discard} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 text-secondary hover:text-brand-bright text-xs disabled:opacity-40"
            style={{ border: '1px solid var(--border-dim)' }}>
            <Undo2 size={13} /> Discard
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:brightness-110 disabled:opacity-40">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

function GroupRows({ group, draft, selected, setSelected, unsavedCells, overriddenCells, toggleCap, resetModule, defaults }) {
  return (
    <>
      <tr className="bg-surface-2">
        <td colSpan={ROLES.length + 1}
          className="sticky left-0 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-dim bg-surface-2">
          {group.group}
        </td>
      </tr>
      {group.modules.map((m) => {
        const isDefaultRow = ROLES.every((r) => !overriddenCells.has(cellKey(r, m.key)))
        return (
          <ModuleRow key={m.key} mod={m} draft={draft} selected={selected} setSelected={setSelected}
            unsavedCells={unsavedCells} overriddenCells={overriddenCells}
            toggleCap={toggleCap} resetModule={resetModule} isDefaultRow={isDefaultRow} defaults={defaults} />
        )
      })}
    </>
  )
}

function ModuleRow({ mod, draft, selected, setSelected, unsavedCells, overriddenCells, toggleCap, resetModule, isDefaultRow, defaults }) {
  const expanded = selected?.mod === mod.key
  return (
    <>
      <tr className="hover:bg-surface-2/60" style={{ borderBottom: '1px solid var(--table-cell-border)' }}>
        <td className="sticky left-0 bg-surface-1 px-4 py-2" style={{ color: 'var(--table-cell-text)' }}>
          <div className="flex items-center gap-2">
            <span>{mod.label}</span>
            {!isDefaultRow && (
              <button onClick={() => resetModule(mod.key)} title={`Reset ${mod.label} to defaults for every role`}
                className="text-dim hover:text-brand-bright">
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        </td>
        {ROLES.map((r) => {
          const caps = draft[r][mod.key]
          const storedOn = CAPABILITIES.filter((c) => !c.enforced && caps[c.key]).length
          const isSel = expanded && selected?.role === r
          const locked = r === 'Admin'
          return (
            <td key={r} className="px-3 py-2 text-center">
              <button type="button" disabled={locked}
                onClick={() => setSelected(isSel ? null : { mod: mod.key, role: r })}
                title={locked ? 'Admin always has full access' : `Edit ${mod.label} capabilities for ${r}`}
                className={`relative inline-flex flex-col items-center justify-center w-12 h-9 rounded-md transition-colors ${
                  locked ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:bg-surface-3'
                } ${unsavedCells.has(cellKey(r, mod.key)) ? 'ring-2 ring-amber-500/70' : ''} ${
                  isSel ? 'bg-surface-3' : 'bg-surface-2'}`}
                style={{ border: `1px solid ${isSel ? 'var(--border-bright)' : 'var(--border-dim)'}` }}>
                {caps.view
                  ? <Eye size={13} className="text-green-400" />
                  : <span className="w-2.5 h-0.5 rounded bg-current text-dim" />}
                <span className="flex gap-0.5 mt-1">
                  {CAPABILITIES.filter((c) => !c.enforced).map((c) => (
                    <i key={c.key} className={`w-1 h-1 rounded-full inline-block ${caps[c.key] ? 'bg-brand' : 'bg-surface-3'}`}
                      style={caps[c.key] ? undefined : { border: '1px solid var(--border-dim)' }} />
                  ))}
                </span>
                {overriddenCells.has(cellKey(r, mod.key)) && (
                  <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-blue-400"
                    title="Differs from built-in default" />
                )}
                {locked && <Lock size={8} className="absolute top-0.5 right-0.5 text-dim" />}
                <span className="sr-only">{storedOn} stored capabilities enabled</span>
              </button>
            </td>
          )
        })}
      </tr>

      {/* Expanded capability editor for the selected role in this module */}
      {expanded && selected?.role && (
        <tr className="bg-surface-2/70">
          <td colSpan={ROLES.length + 1} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted mr-1">
                <span className={`font-semibold ${ROLE_TINT[selected.role] || ''}`}>{selected.role}</span>
                {' '}× <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{mod.label}</span>:
              </span>
              {CAPABILITIES.map((c) => {
                const on = draft[selected.role][mod.key][c.key] === true
                const isDefault = defaults[selected.role][mod.key][c.key] === on
                return (
                  <button key={c.key} type="button" onClick={() => toggleCap(selected.role, mod.key, c.key)}
                    title={`${c.description}${c.enforced ? '' : ' (stored, not yet enforced)'}${isDefault ? '' : ', differs from default'}`}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      on ? 'text-green-300' : 'text-dim hover:text-secondary'}`}
                    style={{
                      background: on ? 'rgba(34,197,94,0.12)' : 'var(--btn-2-bg)',
                      border: `1px solid ${on ? 'rgba(34,197,94,0.35)' : isDefault ? 'var(--btn-2-border)' : 'rgba(96,165,250,0.5)'}`,
                    }}>
                    {on ? <Check size={11} /> : <X size={11} />}
                    {c.label}
                    {!c.enforced && (
                      <span className="text-[9px] uppercase tracking-wide opacity-70">stored</span>
                    )}
                  </button>
                )
              })}
              <button onClick={() => setSelected(null)} className="ml-auto text-dim hover:text-secondary" title="Close">
                <X size={14} />
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
