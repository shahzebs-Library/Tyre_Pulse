import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  MapPin, Plus, Save, Loader2, Check, AlertTriangle, Trash2, Search,
  Pencil, X, Power,
} from 'lucide-react'
import { COUNTRIES, COUNTRY_LABEL } from '../contexts/SettingsContext'
import {
  listSites, upsertSite, deleteSite, setSiteActive, emptySite,
  SITE_TYPES,
} from '../lib/api/sites'
import { toUserMessage } from '../lib/safeError'

/**
 * SitesMasterPanel — admin/manager editor for the Sites master (V109). Curate
 * one canonical list of sites/branches per country; every filter and form can
 * then offer the same selectable options (via useSites). Read-only for others.
 */
const TYPE_BADGE = {
  depot: 'bg-blue-900/40 text-blue-300', workshop: 'bg-amber-900/40 text-amber-300',
  warehouse: 'bg-purple-900/40 text-purple-300', camp: 'bg-teal-900/40 text-teal-300',
  branch: 'bg-emerald-900/40 text-emerald-300', project: 'bg-cyan-900/40 text-cyan-300',
  yard: 'bg-orange-900/40 text-orange-300', other: 'bg-slate-800/60 text-slate-300',
}

export default function SitesMasterPanel({ canEdit }) {
  const [country, setCountry] = useState(COUNTRIES[0] || 'KSA')
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [okMsg, setOkMsg]     = useState('')
  const [query, setQuery]     = useState('')
  const [busyId, setBusyId]   = useState(null)
  const [adding, setAdding]   = useState(false)
  const [addForm, setAddForm] = useState(() => emptySite(country))
  const [editId, setEditId]   = useState(null)
  const [editForm, setEditForm] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await listSites({})) }
    catch (e) { setError(toUserMessage(e, 'Could not load sites.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Keep the add-form country in sync with the selected country.
  useEffect(() => { setAddForm((f) => ({ ...f, country })) }, [country])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => String(r.country || '').toLowerCase() === country.toLowerCase())
      .filter((r) => !q || [r.name, r.site_code, r.city].some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  }, [rows, country, query])

  const countByCountry = useMemo(() => {
    const m = {}
    for (const r of rows) { const c = r.country || 'Unassigned'; m[c] = (m[c] || 0) + 1 }
    return m
  }, [rows])

  async function handleAdd() {
    if (!canEdit || !addForm.name.trim()) return
    setBusyId('__add__'); setError(''); setOkMsg('')
    try {
      await upsertSite(addForm)
      setAddForm(emptySite(country)); setAdding(false)
      await load()
      setOkMsg('Site added.')
    } catch (e) { setError(toUserMessage(e, 'Could not add the site.')) }
    finally { setBusyId(null) }
  }

  async function handleSaveEdit() {
    if (!canEdit || !editForm?.name.trim()) return
    setBusyId(editId); setError(''); setOkMsg('')
    try {
      await upsertSite(editForm)
      setEditId(null); setEditForm(null)
      await load()
      setOkMsg('Site updated.')
    } catch (e) { setError(toUserMessage(e, 'Could not update the site.')) }
    finally { setBusyId(null) }
  }

  async function toggleStatus(site) {
    if (!canEdit) return
    setBusyId(site.id); setError(''); setOkMsg('')
    try { await setSiteActive(site.id, site.active === false); await load() }
    catch (e) { setError(toUserMessage(e, 'Could not change status.')) }
    finally { setBusyId(null) }
  }

  async function handleDelete(site) {
    if (!canEdit || !window.confirm(`Delete site “${site.name}” (${site.country})? This cannot be undone.`)) return
    setBusyId(site.id); setError(''); setOkMsg('')
    try { await deleteSite(site.id); await load(); setOkMsg('Site deleted.') }
    catch (e) { setError(toUserMessage(e, 'Could not delete the site.')) }
    finally { setBusyId(null) }
  }

  const field = (form, setForm, key, props = {}) => (
    <input
      value={form[key] || ''}
      disabled={!canEdit}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      className="input text-sm w-full"
      {...props}
    />
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg" style={{ background: 'rgba(59,130,246,0.12)' }}>
            <MapPin size={18} className="text-blue-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Sites Master</h3>
            <p className="text-xs text-gray-500">One canonical list of sites per country: the shared, selectable options used across the app.</p>
          </div>
        </div>
        {canEdit && (
          <button type="button" onClick={() => { setAdding((v) => !v); setError(''); setOkMsg('') }} className="btn-primary text-xs gap-1.5">
            {adding ? <X size={13} /> : <Plus size={13} />} {adding ? 'Cancel' : 'Add site'}
          </button>
        )}
      </div>

      {!canEdit && (
        <div className="flex items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} /> Read-only. Only an admin or manager can edit the sites master.
        </div>
      )}

      {/* Country selector */}
      <div className="flex flex-wrap gap-2">
        {COUNTRIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { setCountry(c); setEditId(null) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              country === c ? 'bg-blue-600/30 text-blue-200 border-blue-600/40' : 'bg-white/[0.02] text-gray-400 border-white/8 hover:text-gray-200'
            }`}
          >
            {COUNTRY_LABEL[c] || c} <span className="opacity-60">({countByCountry[c] || 0})</span>
          </button>
        ))}
      </div>

      {/* Add form */}
      {adding && canEdit && (
        <div className="rounded-xl border border-blue-700/30 bg-blue-950/10 p-3 space-y-3">
          <p className="text-xs font-semibold text-blue-200">New site in {COUNTRY_LABEL[country] || country}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {field(addForm, setAddForm, 'name', { placeholder: 'Site name *' })}
            {field(addForm, setAddForm, 'site_code', { placeholder: 'Code' })}
            <select value={addForm.site_type} onChange={(e) => setAddForm((f) => ({ ...f, site_type: e.target.value }))} className="input text-sm w-full capitalize">
              {SITE_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
            {field(addForm, setAddForm, 'city', { placeholder: 'City' })}
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={handleAdd} disabled={!addForm.name.trim() || busyId === '__add__'} className="btn-primary text-xs gap-1.5 disabled:opacity-40">
              {busyId === '__add__' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save site
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites…" className="input text-sm w-full pl-9" />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Loading sites…</div>
      ) : visible.length === 0 ? (
        <div className="text-center text-sm text-gray-500 py-10 border border-dashed border-white/10 rounded-xl">
          No sites for {COUNTRY_LABEL[country] || country} yet{canEdit ? '. Add the first one above.' : '.'}
        </div>
      ) : (
        <div className="border border-white/8 rounded-xl overflow-hidden divide-y divide-white/5">
          {visible.map((s) => {
            const editing = editId === s.id
            return (
              <div key={s.id} className="px-3 py-2.5">
                {editing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                      {field(editForm, setEditForm, 'name', { placeholder: 'Site name *' })}
                      {field(editForm, setEditForm, 'site_code', { placeholder: 'Code' })}
                      <select value={editForm.site_type} onChange={(e) => setEditForm((f) => ({ ...f, site_type: e.target.value }))} className="input text-sm w-full capitalize">
                        {SITE_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
                      </select>
                      {field(editForm, setEditForm, 'city', { placeholder: 'City' })}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => { setEditId(null); setEditForm(null) }} className="btn-secondary text-xs gap-1.5"><X size={13} /> Cancel</button>
                      <button type="button" onClick={handleSaveEdit} disabled={!editForm?.name.trim() || busyId === s.id} className="btn-primary text-xs gap-1.5 disabled:opacity-40">
                        {busyId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${s.active !== false ? 'text-gray-100' : 'text-gray-500 line-through'}`}>{s.name}</span>
                        {s.site_code && <span className="text-[10px] text-gray-500 font-mono">{s.site_code}</span>}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${TYPE_BADGE[s.site_type] || TYPE_BADGE.other}`}>{s.site_type}</span>
                        {s.active === false && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300">inactive</span>}
                      </div>
                      {s.city && <p className="text-[11px] text-gray-500">{s.city}</p>}
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => toggleStatus(s)} disabled={busyId === s.id} title={s.active !== false ? 'Deactivate' : 'Activate'} className="p-1.5 rounded hover:bg-white/5 text-gray-400 hover:text-amber-300 disabled:opacity-40">
                          {busyId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                        </button>
                        <button type="button" onClick={() => { setEditId(s.id); setEditForm({ ...emptySite(s.country), ...s }) }} title="Edit" className="p-1.5 rounded hover:bg-white/5 text-gray-400 hover:text-blue-300">
                          <Pencil size={13} />
                        </button>
                        <button type="button" onClick={() => handleDelete(s)} disabled={busyId === s.id} title="Delete" className="p-1.5 rounded hover:bg-white/5 text-gray-400 hover:text-red-300 disabled:opacity-40">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {(error || okMsg) && (
        <div className="text-xs pt-1">
          {error
            ? <span className="text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</span>
            : <span className="text-green-400 flex items-center gap-1.5"><Check size={13} /> {okMsg}</span>}
        </div>
      )}
    </div>
  )
}
