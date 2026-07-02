import { useEffect, useState, useCallback } from 'react'
import { Megaphone, Plus, Edit2, Trash2, RefreshCw, Save, X, Eye, EyeOff, AlertTriangle, CheckCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'

const ROLES = ['Admin', 'Manager', 'Director', 'Inspector', 'Tyre Man', 'Reporter', 'Driver']
const TYPES = ['info', 'warning', 'success', 'critical']

const TYPE_STYLE = {
  info:     'text-blue-400 bg-blue-900/20 border-blue-700/40',
  warning:  'text-yellow-400 bg-yellow-900/20 border-yellow-700/40',
  success:  'text-green-400 bg-green-900/20 border-green-700/40',
  critical: 'text-red-400 bg-red-900/20 border-red-700/40',
}

const EMPTY = {
  title: '', message: '', type: 'info', target_roles: [],
  target_org_id: null, active: true, show_until: '',
}

export default function ConsoleAnnouncements() {
  const { logAction, activeOrg } = useConsoleAuth()
  const [list, setList]     = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]   = useState(null)
  const [form, setForm]     = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [orgs, setOrgs]     = useState([])
  const [confirmDel, setConfirmDel] = useState(null)

  useEffect(() => {
    supabase.from('organisations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
    setList(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setForm({ ...EMPTY, target_org_id: activeOrg?.id ?? null })
    setError(null); setModal('create')
  }
  function openEdit(ann) {
    setForm({
      title: ann.title ?? '', message: ann.body ?? '', type: ann.type ?? 'info',
      target_roles: ann.target_roles ?? [], target_org_id: ann.target_org_id ?? null,
      active: ann.active ?? true, show_until: ann.show_until ? ann.show_until.slice(0, 10) : '',
    })
    setError(null); setModal({ type: 'edit', id: ann.id })
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required.'); return }
    if (!form.message.trim()) { setError('Message is required.'); return }
    setSaving(true); setError(null)
    const payload = {
      title: form.title.trim(), body: form.message.trim(), type: form.type,
      target_roles: form.target_roles.length ? form.target_roles : null,
      target_org_id: form.target_org_id || null,
      active: form.active,
      show_until: form.show_until ? new Date(form.show_until + 'T23:59:59Z').toISOString() : null,
    }
    if (modal === 'create') {
      const { data, error: err } = await supabase.from('announcements').insert(payload).select().single()
      if (err) { setError(err.message); setSaving(false); return }
      await logAction('create_announcement', data.id, 'announcement', { title: data.title })
    } else {
      const { error: err } = await supabase.from('announcements').update(payload).eq('id', modal.id)
      if (err) { setError(err.message); setSaving(false); return }
      await logAction('update_announcement', modal.id, 'announcement', { title: payload.title })
    }
    setSaving(false); setModal(null); load()
  }

  async function toggleActive(ann) {
    await supabase.from('announcements').update({ active: !ann.active }).eq('id', ann.id)
    load()
  }

  async function handleDelete(ann) {
    await supabase.from('announcements').delete().eq('id', ann.id)
    await logAction('delete_announcement', ann.id, 'announcement', { title: ann.title })
    setConfirmDel(null); load()
  }

  const toggleRole = (r) =>
    setForm(f => ({ ...f, target_roles: f.target_roles.includes(r) ? f.target_roles.filter(x => x !== r) : [...f.target_roles, r] }))

  const active = list.filter(a => a.active)
  const inactive = list.filter(a => !a.active)

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Announcements</h1>
          <p className="text-sm text-gray-500 mt-0.5">{active.length} active · {inactive.length} inactive</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-50 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
            <Plus size={14} /> New Announcement
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-600">
          <Megaphone size={32} className="mb-2 opacity-30" />
          <p className="text-sm">No announcements yet</p>
          <button onClick={openCreate} className="mt-3 text-xs text-orange-400 hover:text-orange-300">Create the first one →</button>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Active ({active.length})</p>
              <div className="space-y-2">
                {active.map(ann => <AnnCard key={ann.id} ann={ann} orgs={orgs} onEdit={openEdit} onToggle={toggleActive} onDelete={() => setConfirmDel(ann)} />)}
              </div>
            </div>
          )}
          {inactive.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Inactive ({inactive.length})</p>
              <div className="space-y-2 opacity-60">
                {inactive.map(ann => <AnnCard key={ann.id} ann={ann} orgs={orgs} onEdit={openEdit} onToggle={toggleActive} onDelete={() => setConfirmDel(ann)} />)}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-sm font-bold text-white">
                {modal === 'create' ? 'New Announcement' : 'Edit Announcement'}
              </h2>
              <button onClick={() => setModal(null)} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-800/50">
                  <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="field-label">Title *</label>
                  <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="input-dark" placeholder="System maintenance on Saturday..." />
                </div>
                <div>
                  <label className="field-label">Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    className="input-dark">
                    {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Organisation</label>
                  <select value={form.target_org_id ?? ''} onChange={e => setForm(f => ({ ...f, target_org_id: e.target.value || null }))}
                    className="input-dark">
                    <option value="">All Organisations</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Expires</label>
                  <input type="date" value={form.show_until} onChange={e => setForm(f => ({ ...f, show_until: e.target.value }))}
                    className="input-dark" />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                      className="w-4 h-4 accent-orange-500" />
                    <span className="text-xs text-gray-300">Active (visible to users)</span>
                  </label>
                </div>
                <div className="col-span-2">
                  <label className="field-label">Message *</label>
                  <textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                    rows={4} placeholder="Write your announcement message here..."
                    className="input-dark resize-none" />
                </div>
                <div className="col-span-2">
                  <label className="field-label">Target Roles (leave empty = all roles)</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {ROLES.map(r => (
                      <button key={r} type="button" onClick={() => toggleRole(r)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                          form.target_roles.includes(r)
                            ? 'bg-orange-900/40 text-orange-300 border-orange-700/40'
                            : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                        }`}>{r}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-2 px-6 py-4 border-t border-gray-800">
              <button onClick={() => setModal(null)}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#ea580c,#f97316)' }}>
                {saving ? <><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Saving...</> : <><Save size={13} /> Save</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-gray-900 border border-red-800/50 rounded-2xl shadow-2xl p-6">
            <p className="text-sm font-bold text-white mb-2">Delete Announcement?</p>
            <p className="text-xs text-gray-400 mb-5">"{confirmDel.title}" will be permanently deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDel(null)}
                className="flex-1 py-2 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors">Cancel</button>
              <button onClick={() => handleDelete(confirmDel)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold text-white bg-red-700 hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AnnCard({ ann, orgs, onEdit, onToggle, onDelete }) {
  const orgName = orgs.find(o => o.id === ann.target_org_id)?.name
  const expired = ann.show_until && new Date(ann.show_until) < new Date()
  return (
    <div className={`rounded-xl border p-4 ${TYPE_STYLE[ann.type] ?? TYPE_STYLE.info}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase ${TYPE_STYLE[ann.type]}`}>{ann.type}</span>
            {orgName && <span className="text-[10px] text-gray-500">→ {orgName}</span>}
            {expired && <span className="text-[10px] text-red-500">EXPIRED</span>}
            {ann.show_until && !expired && (
              <span className="text-[10px] text-gray-500">
                Expires {new Date(ann.show_until).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-white">{ann.title}</p>
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{ann.body}</p>
          {ann.target_roles && ann.target_roles.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {ann.target_roles.map(r => (
                <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/60 text-gray-500 border border-gray-700">{r}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onToggle(ann)}
            className="p-1.5 rounded hover:bg-black/20 transition-colors" title={ann.active ? 'Deactivate' : 'Activate'}>
            {ann.active ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button onClick={() => onEdit(ann)}
            className="p-1.5 rounded hover:bg-black/20 transition-colors" title="Edit">
            <Edit2 size={13} />
          </button>
          <button onClick={onDelete}
            className="p-1.5 rounded hover:bg-black/20 transition-colors text-red-400" title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
