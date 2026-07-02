import { useEffect, useMemo, useState, useCallback } from 'react'
import { Shield, Search, Save, Loader2, Check, AlertTriangle, RotateCcw, Lock } from 'lucide-react'
import { MODULE_GROUPS, ACCESS_ROLES, ALL_MODULES } from '../lib/moduleCatalog'
import { listGlobalPermissions, saveModulePermissions } from '../lib/api/modulePermissions'

const ROLE_TINT = {
  Admin:      'text-purple-300',
  Manager:    'text-blue-300',
  Director:   'text-indigo-300',
  Reporter:   'text-cyan-300',
  Inspector:  'text-green-300',
  'Tyre Man': 'text-amber-300',
  Driver:     'text-gray-300',
}

const keyOf = (role, mod) => `${role}::${mod}`

/**
 * AccessControlMatrix — editable role × module access grid, grouped by workspace.
 * Admin is always full access (locked). Changes are highlighted, counted, and
 * saved through the Admin-gated set_module_permissions RPC. Non-Admin viewers
 * see it read-only.
 */
export default function AccessControlMatrix({ canEdit }) {
  const [perms, setPerms] = useState({})        // { role: { module: bool } }
  const [draft, setDraft] = useState({})        // same shape, edited
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const map = await listGlobalPermissions()
      // Admin is always granted everything (enforced server-side too).
      const withAdmin = { ...map, Admin: Object.fromEntries(ALL_MODULES.map((m) => [m.key, true])) }
      setPerms(withAdmin)
      setDraft(structuredClone(withAdmin))
    } catch (e) {
      setError(e.message || 'Could not load access settings.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const isOn = (role, mod) => draft[role]?.[mod] === true
  const wasOn = (role, mod) => perms[role]?.[mod] === true

  function toggle(role, mod) {
    if (!canEdit || role === 'Admin') return
    setMsg('')
    setDraft((d) => ({ ...d, [role]: { ...(d[role] || {}), [mod]: !(d[role]?.[mod] === true) } }))
  }

  // Set every module for a role (column bulk action)
  function setRoleAll(role, value) {
    if (!canEdit || role === 'Admin') return
    setMsg('')
    setDraft((d) => ({ ...d, [role]: Object.fromEntries(ALL_MODULES.map((m) => [m.key, value])) }))
  }

  const changes = useMemo(() => {
    const out = []
    for (const role of ACCESS_ROLES) {
      if (role === 'Admin') continue
      for (const m of ALL_MODULES) {
        if (isOn(role, m.key) !== wasOn(role, m.key)) {
          out.push({ role, module_key: m.key, enabled: isOn(role, m.key) })
        }
      }
    }
    return out
  }, [draft, perms]) // eslint-disable-line react-hooks/exhaustive-deps

  const changedSet = useMemo(() => new Set(changes.map((c) => keyOf(c.role, c.module_key))), [changes])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return MODULE_GROUPS
    return MODULE_GROUPS
      .map((g) => ({ ...g, modules: g.modules.filter((m) => m.label.toLowerCase().includes(q) || m.key.includes(q)) }))
      .filter((g) => g.modules.length)
  }, [search])

  async function save() {
    if (!changes.length) return
    setSaving(true); setError(''); setMsg('')
    try {
      const n = await saveModulePermissions(changes)
      setPerms(structuredClone(draft))
      setMsg(`Saved — ${n} access change${n !== 1 ? 's' : ''} applied. Affected users see it on their next load.`)
    } catch (e) {
      setError(e.message || 'Could not save access changes.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="card flex items-center justify-center py-16 text-gray-400">
      <Loader2 className="animate-spin mr-2" size={18} /> Loading access settings…
    </div>
  )

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header + toolbar */}
      <div className="px-5 py-4 border-b border-gray-700/60 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-green-400" />
          <div>
            <h2 className="text-base font-semibold text-white">Access Control</h2>
            <p className="text-xs text-gray-500">Toggle which modules each role can open. Admin always has full access.</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-gray-900/60 border border-gray-800 rounded-lg px-2.5 py-1.5">
            <Search size={13} className="text-gray-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a module…"
              className="bg-transparent text-xs text-gray-200 placeholder-gray-600 focus:outline-none w-36" />
          </div>
          {canEdit && (
            <>
              <button onClick={() => setDraft(structuredClone(perms))} disabled={!changes.length || saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-xs disabled:opacity-40 transition-colors">
                <RotateCcw size={13} /> Reset
              </button>
              <button onClick={save} disabled={!changes.length || saving}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-semibold disabled:opacity-40 transition-colors">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saving ? 'Saving…' : changes.length ? `Save ${changes.length}` : 'Saved'}
              </button>
            </>
          )}
        </div>
      </div>

      {(error || msg) && (
        <div className={`px-5 py-2.5 text-sm flex items-center gap-2 ${error ? 'bg-red-900/25 text-red-300 border-b border-red-800/40' : 'bg-green-900/20 text-green-300 border-b border-green-800/40'}`}>
          {error ? <AlertTriangle size={15} /> : <Check size={15} />} {error || msg}
        </div>
      )}

      {/* Matrix */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-700/60">
              <th className="sticky left-0 bg-gray-900 z-10 text-left px-4 py-3 min-w-52 text-gray-400 font-medium">Module</th>
              {ACCESS_ROLES.map((r) => (
                <th key={r} className="px-3 py-2.5 text-center min-w-24">
                  <div className={`text-xs font-semibold ${ROLE_TINT[r] || 'text-gray-300'}`}>{r}</div>
                  {canEdit && r !== 'Admin' ? (
                    <div className="flex items-center justify-center gap-1 mt-1">
                      <button onClick={() => setRoleAll(r, true)} className="text-[10px] text-gray-500 hover:text-green-400" title={`Grant all to ${r}`}>All</button>
                      <span className="text-gray-700">·</span>
                      <button onClick={() => setRoleAll(r, false)} className="text-[10px] text-gray-500 hover:text-red-400" title={`Revoke all from ${r}`}>None</button>
                    </div>
                  ) : r === 'Admin' ? (
                    <div className="flex items-center justify-center gap-1 mt-1 text-[10px] text-gray-600"><Lock size={9} /> full</div>
                  ) : <div className="h-4 mt-1" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredGroups.map((g) => (
              <FragmentGroup key={g.group} group={g} roles={ACCESS_ROLES} isOn={isOn} toggle={toggle}
                changedSet={changedSet} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-gray-700/60 flex flex-wrap gap-5 text-xs text-gray-500">
        <span className="flex items-center gap-2"><Cell on canEdit={false} /> Access granted</span>
        <span className="flex items-center gap-2"><Cell on={false} canEdit={false} /> No access</span>
        <span className="flex items-center gap-2"><span className="w-6 h-6 rounded-md ring-2 ring-amber-500/70 inline-block" /> Unsaved change</span>
      </div>
    </div>
  )
}

function FragmentGroup({ group, roles, isOn, toggle, changedSet, canEdit }) {
  return (
    <>
      <tr className="bg-gray-800/40">
        <td colSpan={roles.length + 1} className="sticky left-0 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-800/40">
          {group.group}
        </td>
      </tr>
      {group.modules.map((m, i) => (
        <tr key={m.key} className={`border-b border-gray-800/50 hover:bg-gray-800/20 ${i % 2 ? 'bg-gray-900/30' : ''}`}>
          <td className="sticky left-0 bg-inherit px-4 py-2 text-gray-300">{m.label}</td>
          {roles.map((r) => (
            <td key={r} className="px-3 py-2 text-center">
              <button
                type="button"
                onClick={() => toggle(r, m.key)}
                disabled={!canEdit || r === 'Admin'}
                className={changedSet.has(keyOf(r, m.key)) ? 'rounded-md ring-2 ring-amber-500/70' : ''}
                title={r === 'Admin' ? 'Admin always has access' : `${isOn(r, m.key) ? 'Revoke' : 'Grant'} ${m.label} for ${r}`}
              >
                <Cell on={isOn(r, m.key)} canEdit={canEdit && r !== 'Admin'} />
              </button>
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function Cell({ on, canEdit }) {
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md border transition-colors ${
      on
        ? 'bg-green-600/25 border-green-600/50 text-green-300'
        : 'bg-gray-800/60 border-gray-700 text-gray-600'
    } ${canEdit ? 'cursor-pointer hover:brightness-125' : ''}`}>
      {on ? <Check size={14} /> : <span className="w-2 h-0.5 bg-gray-600 rounded" />}
    </span>
  )
}
