/**
 * Console Admin Roles (Module 7, V256) - the super-admin registry of WHO may
 * administer the console and at what level. Reads/writes `admin_users` through
 * the thin `src/lib/api/adminUsers.js` service (security-definer RPCs + RLS).
 *
 * HONEST SCOPE NOTE (surfaced in the UI too): today the /console sign-in gate
 * still requires is_super_admin. The regional_admin / viewer levels are stored
 * here for the progressive rollout of scoped console access; they are not yet
 * enforced at the door. The UI never claims enforcement that does not exist.
 */
import { useEffect, useState, useCallback } from 'react'
import {
  ShieldCheck, Search, RefreshCw, Trash2, Plus, X as XClose,
  Info, Globe, CheckCircle, AlertTriangle, UserCog, Save,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  ADMIN_ROLE_VALUES, listAdminUsers, setAdminUser, removeAdminUser, searchProfiles,
} from '../../lib/api/adminUsers'

// Plain-English description of each console admin level (shown by the picker).
const ROLE_META = {
  super_admin: {
    label: 'Super Admin',
    desc: 'Full access to every console module, all regions, and all administration actions.',
    badge: 'text-red-300 bg-red-900/30 border-red-700/40',
  },
  regional_admin: {
    label: 'Regional Admin',
    desc: 'Manages only their assigned region(s): view dashboards and resolve or restore records within those regions.',
    badge: 'text-orange-300 bg-orange-900/30 border-orange-700/40',
  },
  viewer: {
    label: 'Viewer',
    desc: 'Read-only access to console dashboards. Cannot change, resolve, or restore anything.',
    badge: 'text-blue-300 bg-blue-900/30 border-blue-700/40',
  },
}

const EMPTY_FORM = { id: null, user: null, role: 'viewer', regions: [], note: '', active: true }

export default function ConsoleAdminRoles() {
  const { logAction } = useConsoleAuth()

  const [rows, setRows]       = useState([])
  const [profileMap, setProfileMap] = useState({})   // user_id -> { email, full_name }
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [saving, setSaving]     = useState(false)
  const [formError, setFormError] = useState(null)

  // User picker (searchProfiles)
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [searching, setSearching] = useState(false)

  const [removingId, setRemovingId] = useState(null)
  const [toast, setToast]       = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const data = await listAdminUsers()
      setRows(data)
      const ids = [...new Set(data.map(r => r.user_id).filter(Boolean))]
      if (ids.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', ids)
        const map = {}
        for (const p of profs ?? []) map[p.id] = { email: p.email, full_name: p.full_name }
        setProfileMap(map)
      } else {
        setProfileMap({})
      }
    } catch (e) {
      setError(e?.message || 'Could not load admin roles.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function flashToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  // Debounced profile search for the picker.
  useEffect(() => {
    if (!showForm) return
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      const list = await searchProfiles(query)
      if (alive) { setResults(list); setSearching(false) }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [query, showForm])

  function openAdd() {
    setForm(EMPTY_FORM)
    setQuery(''); setResults([]); setFormError(null)
    setShowForm(true)
  }

  function openEdit(row) {
    const prof = profileMap[row.user_id] || {}
    setForm({
      id: row.id,
      user: { id: row.user_id, email: prof.email, full_name: prof.full_name },
      role: ADMIN_ROLE_VALUES.includes(row.admin_role) ? row.admin_role : 'viewer',
      regions: Array.isArray(row.regions) ? row.regions.filter(Boolean) : [],
      note: row.note ?? '',
      active: row.active !== false,
    })
    setQuery(''); setResults([]); setFormError(null)
    setShowForm(true)
  }

  function pickUser(p) {
    setForm(f => ({ ...f, user: { id: p.id, email: p.email, full_name: p.full_name } }))
    setResults([])
    setQuery('')
  }

  function setRegionsFromText(text) {
    const regions = text
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    setForm(f => ({ ...f, regions }))
  }

  async function handleSave() {
    if (!form.user?.id) { setFormError('Choose a user first.'); return }
    if (!ADMIN_ROLE_VALUES.includes(form.role)) { setFormError('Choose a valid role.'); return }
    setSaving(true); setFormError(null)
    try {
      await setAdminUser({
        userId: form.user.id,
        role: form.role,
        regions: form.role === 'regional_admin' ? form.regions : [],
        note: form.note.trim() ? form.note.trim() : null,
        active: form.active,
      })
      await logAction('set_admin_user', form.user.id, 'admin_user', {
        role: form.role, regions: form.regions, active: form.active,
      })
      setShowForm(false)
      flashToast(`${ROLE_META[form.role].label} saved for ${form.user.email || form.user.id}`)
      load()
    } catch (e) {
      setFormError(e?.message || 'Could not save the admin role.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(row) {
    setRemovingId(row.id)
    try {
      await removeAdminUser(row.id)
      await logAction('remove_admin_user', row.user_id, 'admin_user', { admin_role: row.admin_role })
      flashToast('Admin role removed.')
      load()
    } catch (e) {
      setError(e?.message || 'Could not remove the admin role.')
    } finally {
      setRemovingId(null)
    }
  }

  const nameFor = (uid) => profileMap[uid]?.full_name || 'N/A'
  const emailFor = (uid) => profileMap[uid]?.email || uid

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-orange-400" />
            <h1 className="text-xl font-bold text-white">Admin Roles</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Who may administer the system console, and at what level.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
            style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
            <Plus size={13} /> Add / edit admin
          </button>
        </div>
      </div>

      {/* Honest rollout banner */}
      <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-blue-950/30 border border-blue-800/40">
        <Info size={15} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-200/90 leading-relaxed">
          Console sign-in still requires super-admin. The regional_admin and viewer levels are stored
          here for the progressive rollout of scoped console access, and are not yet enforced at the
          sign-in gate.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/50">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Table / states */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-600 rounded-xl border border-dashed border-gray-800">
          <ShieldCheck size={32} className="mb-2 opacity-30" />
          <p className="text-sm">No admin roles assigned yet</p>
          <button onClick={openAdd} className="mt-3 text-xs text-orange-400 hover:text-orange-300">
            Add the first admin role
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Admin level</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Regions</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Note</th>
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const meta = ROLE_META[row.admin_role] || ROLE_META.viewer
                const regions = Array.isArray(row.regions) ? row.regions.filter(Boolean) : []
                return (
                  <tr key={row.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 flex-shrink-0">
                          {(nameFor(row.user_id) || emailFor(row.user_id) || '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">{nameFor(row.user_id)}</p>
                          <p className="text-gray-500 truncate">{emailFor(row.user_id)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-semibold border ${meta.badge}`} title={meta.desc}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.admin_role === 'super_admin'
                        ? <span className="text-gray-600" title="Super admins are not scoped to regions.">All regions</span>
                        : regions.length === 0
                          ? <span className="text-gray-600">None</span>
                          : (
                            <div className="flex flex-wrap gap-1">
                              {regions.map(r => (
                                <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-300">{r}</span>
                              ))}
                            </div>
                          )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs truncate" title={row.note || ''}>
                      {row.note || 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      {row.active !== false
                        ? <span className="flex items-center gap-1 text-green-400"><CheckCircle size={10} /> Active</span>
                        : <span className="flex items-center gap-1 text-gray-500"><XClose size={10} /> Inactive</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(row)}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-[10px] text-gray-300 hover:text-white transition-colors"
                          title="Edit this admin role">
                          <UserCog size={11} /> Edit
                        </button>
                        <button onClick={() => handleRemove(row)} disabled={removingId === row.id}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-red-900/30 border border-red-700/40 text-[10px] text-red-300 hover:bg-red-900/50 transition-colors disabled:opacity-50"
                          title="Remove this admin role">
                          <Trash2 size={11} /> {removingId === row.id ? 'Removing...' : 'Remove'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 sticky top-0 bg-gray-900">
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} className="text-orange-400" />
                <h2 className="text-sm font-bold text-white">{form.id ? 'Edit admin role' : 'Add admin role'}</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-300"><XClose size={16} /></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/50">
                  <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
                  <p className="text-xs text-red-300">{formError}</p>
                </div>
              )}

              {/* User */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">User</label>
                {form.user ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{form.user.full_name || 'N/A'}</p>
                      <p className="text-[11px] text-gray-500 truncate">{form.user.email || form.user.id}</p>
                    </div>
                    {!form.id && (
                      <button onClick={() => setForm(f => ({ ...f, user: null }))}
                        className="text-[11px] text-gray-400 hover:text-white flex-shrink-0">Change</button>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input value={query} onChange={e => setQuery(e.target.value)} autoFocus
                        placeholder="Search a user by email or name..."
                        className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
                    </div>
                    <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-gray-800 divide-y divide-gray-800/70">
                      {searching ? (
                        <p className="px-3 py-2 text-[11px] text-gray-500">Searching...</p>
                      ) : results.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-gray-600">No matching users.</p>
                      ) : results.map(p => (
                        <button key={p.id} onClick={() => pickUser(p)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-800/60 transition-colors">
                          <p className="text-xs text-white truncate">{p.full_name || 'N/A'}</p>
                          <p className="text-[11px] text-gray-500 truncate">{p.email || p.id} : {p.role || 'no role'}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Role */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Admin level</label>
                <div className="space-y-2">
                  {ADMIN_ROLE_VALUES.map(key => {
                    const meta = ROLE_META[key]
                    const on = form.role === key
                    return (
                      <button key={key} type="button" onClick={() => setForm(f => ({ ...f, role: key }))}
                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                          on ? 'bg-orange-500/10 border-orange-500/50' : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                        }`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${on ? 'border-orange-500' : 'border-gray-600'}`}>
                            {on && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
                          </span>
                          <span className="text-xs font-semibold text-white">{meta.label}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1 ml-5 leading-relaxed">{meta.desc}</p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Regions (regional_admin only) */}
              {form.role === 'regional_admin' && (
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <Globe size={11} /> Regions
                    <span className="text-gray-600 normal-case font-normal" title="Comma-separated region codes this admin manages, e.g. KSA, UAE.">
                      (comma separated)
                    </span>
                  </label>
                  <input value={form.regions.join(', ')} onChange={e => setRegionsFromText(e.target.value)}
                    placeholder="e.g. KSA, UAE, Egypt"
                    className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
                  {form.regions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {form.regions.map(r => (
                        <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 border border-orange-500/40 text-orange-200">{r}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Note */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Note <span className="text-gray-600 normal-case font-normal">(optional)</span>
                </label>
                <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="Why this person has console access"
                  className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
              </div>

              {/* Active */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <button type="button" onClick={() => setForm(f => ({ ...f, active: !f.active }))}
                  className={`relative w-9 h-5 rounded-full transition-colors ${form.active ? 'bg-orange-500' : 'bg-gray-700'}`}
                  aria-pressed={form.active}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.active ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <span className="text-xs text-gray-300">Active</span>
                <span className="text-[11px] text-gray-600" title="Inactive assignments are kept for history but grant no access.">
                  (inactive keeps the record but grants nothing)
                </span>
              </label>
            </div>

            <div className="flex gap-2 px-6 pb-5">
              <button onClick={() => setShowForm(false)} disabled={saving}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
                <Save size={13} /> {saving ? 'Saving...' : 'Save admin role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-3 rounded-xl bg-green-900/90 border border-green-600/50 shadow-2xl">
          <CheckCircle size={15} className="text-green-300" />
          <p className="text-xs text-green-100 font-medium">{toast}</p>
        </div>
      )}
    </div>
  )
}
