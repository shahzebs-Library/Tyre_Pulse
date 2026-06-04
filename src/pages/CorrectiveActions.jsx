import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Save, X, CheckCircle, Clock, AlertCircle } from 'lucide-react'

const STATUS_ICON = {
  Open: <AlertCircle size={14} className="text-red-400" />,
  'In Progress': <Clock size={14} className="text-yellow-400" />,
  Closed: <CheckCircle size={14} className="text-green-400" />,
}

const PRIORITY_BADGE = {
  High: 'bg-red-900/50 text-red-300 border border-red-700/50',
  Medium: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
  Low: 'bg-blue-900/50 text-blue-300 border border-blue-700/50',
}

const EMPTY_FORM = { title: '', priority: 'Medium', site: '', description: '', assigned_to: '', status: 'Open', asset_no: '', tyre_serial: '', root_cause: '' }

export default function CorrectiveActions() {
  const { profile } = useAuth()
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)

  useEffect(() => { load() }, [statusFilter])

  async function load() {
    setLoading(true)
    let q = supabase.from('corrective_actions').select('*').order('created_at', { ascending: false })
    if (statusFilter) q = q.eq('status', statusFilter)
    const { data } = await q
    setActions(data ?? [])
    setLoading(false)
  }

  function startAdd() { setForm(EMPTY_FORM); setEditId(null); setShowForm(true); setError('') }
  function startEdit(a) {
    setForm({ title: a.title, priority: a.priority, site: a.site ?? '', description: a.description ?? '', assigned_to: a.assigned_to ?? '', status: a.status, asset_no: a.asset_no ?? '', tyre_serial: a.tyre_serial ?? '', root_cause: a.root_cause ?? '' })
    setEditId(a.id)
    setShowForm(true)
    setError('')
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      ...form,
      created_by: editId ? undefined : profile?.id,
      ...(form.status === 'Closed' && !editId ? { closed_by: profile?.id, closed_at: new Date().toISOString() } : {}),
    }
    const { error: err } = editId
      ? await supabase.from('corrective_actions').update(payload).eq('id', editId)
      : await supabase.from('corrective_actions').insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    setShowForm(false)
    load()
    setSaving(false)
  }

  async function closeAction(id) {
    await supabase.from('corrective_actions').update({ status: 'Closed', closed_by: profile?.id, closed_at: new Date().toISOString() }).eq('id', id)
    load()
  }

  const counts = { Open: 0, 'In Progress': 0, Closed: 0 }
  actions.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++ })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Corrective Actions</h1>
          <p className="text-gray-400 text-sm mt-1">{actions.length} actions</p>
        </div>
        <button onClick={startAdd} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Action
        </button>
      </div>

      {/* Status filters */}
      <div className="flex gap-2">
        {[['', 'All'], ['Open', 'Open'], ['In Progress', 'In Progress'], ['Closed', 'Closed']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setStatusFilter(val)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === val ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
          >
            {label} {val && <span className="ml-1 text-xs opacity-70">{counts[val] ?? 0}</span>}
          </button>
        ))}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : actions.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No actions found</div>
      ) : (
        <div className="space-y-3">
          {actions.map(a => (
            <div key={a.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {STATUS_ICON[a.status]}
                    <h3 className="font-semibold text-white">{a.title}</h3>
                    <span className={`badge ${PRIORITY_BADGE[a.priority]}`}>{a.priority}</span>
                    <span className="text-xs text-gray-500">{a.status}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
                    {a.site && <span>📍 {a.site}</span>}
                    {a.assigned_to && <span>👤 {a.assigned_to}</span>}
                    {a.asset_no && <span>🚛 {a.asset_no}</span>}
                    <span>🗓 {new Date(a.created_at).toLocaleDateString()}</span>
                  </div>
                  {a.description && (
                    <p className="text-sm text-gray-400 mt-2 line-clamp-2">{a.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => startEdit(a)} className="text-gray-400 hover:text-blue-400 text-sm transition-colors">Edit</button>
                  {a.status !== 'Closed' && (
                    <button onClick={() => closeAction(a.id)} className="text-gray-400 hover:text-green-400 text-sm transition-colors">Close</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto" onClick={() => setShowForm(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6 my-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{editId ? 'Edit' : 'New'} Corrective Action</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
            <form onSubmit={save} className="space-y-3">
              <div><label className="label">Title *</label><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Priority</label>
                  <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                    {['High', 'Medium', 'Low'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {['Open', 'In Progress', 'Closed'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Site</label><input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} /></div>
                <div><label className="label">Assigned To</label><input className="input" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Asset No</label><input className="input" value={form.asset_no} onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))} /></div>
                <div><label className="label">Tyre Serial</label><input className="input" value={form.tyre_serial} onChange={e => setForm(f => ({ ...f, tyre_serial: e.target.value }))} /></div>
              </div>
              <div><label className="label">Description</label><textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div><label className="label">Root Cause</label><textarea className="input" rows={2} value={form.root_cause} onChange={e => setForm(f => ({ ...f, root_cause: e.target.value }))} /></div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={16} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
