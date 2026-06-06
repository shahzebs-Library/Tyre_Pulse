import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { Plus, Save, X, CheckCircle, Clock, AlertCircle, Download, FileText, Camera } from 'lucide-react'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_ICON = {
  Open:        <AlertCircle size={14} className="text-red-400" />,
  'In Progress': <Clock size={14} className="text-yellow-400" />,
  Closed:      <CheckCircle size={14} className="text-green-400" />,
}

const PRIORITY_BADGE = {
  High:   'bg-red-900/50 text-red-300 border border-red-700/50',
  Medium: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
  Low:    'bg-blue-900/50 text-blue-300 border border-blue-700/50',
}

const EMPTY_FORM = {
  title: '', priority: 'Medium', site: '', description: '', assigned_to: '',
  status: 'Open', asset_no: '', tyre_serial: '', root_cause: '', due_date: '',
}

function overdueDays(due_date, status) {
  if (!due_date || status === 'Closed') return null
  const diff = new Date() - new Date(due_date)
  const days = Math.floor(diff / (1000 * 86400))
  return days > 0 ? days : null
}

export default function CorrectiveActions() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const [actions, setActions]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [overdueOnly, setOverdueOnly]   = useState(false)
  const [priorityFilter, setPriorityFilter] = useState('')
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [editId, setEditId]       = useState(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const photoRef = useRef(null)

  function handlePhoto(e, setter) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setter(f => ({ ...f, photo_data: ev.target.result }))
    reader.readAsDataURL(file)
  }

  useEffect(() => { load() }, [statusFilter, activeCountry])

  async function load() {
    setLoading(true)
    let q = supabase.from('corrective_actions').select('*').order('created_at', { ascending: false })
    if (statusFilter) q = q.eq('status', statusFilter)
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    const { data } = await q
    setActions(data ?? [])
    setLoading(false)
  }

  function startAdd(prefill = {}) {
    setForm({ ...EMPTY_FORM, ...prefill })
    setEditId(null)
    setShowForm(true)
    setError('')
  }

  function startEdit(a) {
    setForm({
      title:        a.title,
      priority:     a.priority,
      site:         a.site ?? '',
      description:  a.description ?? '',
      assigned_to:  a.assigned_to ?? '',
      status:       a.status,
      asset_no:     a.asset_no ?? '',
      tyre_serial:  a.tyre_serial ?? '',
      root_cause:   a.root_cause ?? '',
      due_date:     a.due_date ? a.due_date.split('T')[0] : '',
    })
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
      due_date: form.due_date || null,
      created_by: editId ? undefined : profile?.id,
      ...(form.status === 'Closed'
        ? { closed_by: profile?.id, closed_at: new Date().toISOString() }
        : { closed_by: null, closed_at: null }),
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
    await supabase.from('corrective_actions').update({
      status: 'Closed',
      closed_by: profile?.id,
      closed_at: new Date().toISOString(),
    }).eq('id', id)
    load()
  }

  const filtered = useMemo(() => {
    let arr = actions
    if (priorityFilter) arr = arr.filter(a => a.priority === priorityFilter)
    if (overdueOnly)    arr = arr.filter(a => overdueDays(a.due_date, a.status) !== null)
    return arr
  }, [actions, priorityFilter, overdueOnly])

  const counts = useMemo(() => {
    const c = { Open: 0, 'In Progress': 0, Closed: 0 }
    actions.forEach(a => { if (c[a.status] !== undefined) c[a.status]++ })
    return c
  }, [actions])

  const overdueCount = useMemo(() =>
    actions.filter(a => overdueDays(a.due_date, a.status) !== null).length,
    [actions]
  )

  const sites = useMemo(() => [...new Set(actions.map(a => a.site).filter(Boolean))].sort(), [actions])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Corrective Actions</h1>
          <p className="text-gray-400 text-sm mt-1">
            {actions.length} total
            {overdueCount > 0 && (
              <span className="ml-2 text-xs px-2 py-0.5 bg-red-900/40 text-red-400 border border-red-700/50 rounded-full">
                {overdueCount} overdue
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportToExcel(
              filtered,
              ['title','site','priority','status','due_date'],
              ['Title','Site','Priority','Status','Due Date'],
              'TyrePulse_CorrectiveActions'
            )}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Download size={14}/> Excel
          </button>
          <button
            onClick={() => exportToPdf(
              filtered,
              [{key:'title',header:'Title'},{key:'site',header:'Site'},{key:'priority',header:'Priority'},{key:'status',header:'Status'},{key:'due_date',header:'Due Date'}],
              'Corrective Actions',
              'TyrePulse_CorrectiveActions',
              'landscape'
            )}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <FileText size={14}/> PDF
          </button>
          <button onClick={() => startAdd()} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New Action
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {[['', 'All'], ['Open', 'Open'], ['In Progress', 'In Progress'], ['Closed', 'Closed']].map(([val, label]) => (
          <button key={val} onClick={() => setStatusFilter(val)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === val ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {label} {val && <span className="ml-1 text-xs opacity-70">{counts[val] ?? 0}</span>}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-2">
          {['High', 'Medium', 'Low'].map(p => (
            <button key={p} onClick={() => setPriorityFilter(priorityFilter === p ? '' : p)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                priorityFilter === p
                  ? PRIORITY_BADGE[p] + ' ring-1 ring-white/20'
                  : 'bg-gray-800 text-gray-400 border-gray-700'
              }`}>
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOverdueOnly(!overdueOnly)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            overdueOnly ? 'bg-red-900/40 text-red-400 border-red-700/50' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
          }`}
        >
          Overdue {overdueCount > 0 && `(${overdueCount})`}
        </button>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No actions found</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(a => {
            const od = overdueDays(a.due_date, a.status)
            return (
              <div key={a.id} className={`card transition-colors ${od ? 'border-red-800/50' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {STATUS_ICON[a.status]}
                      <h3 className="font-semibold text-white">{a.title}{a.photo_data && <Camera className="inline w-3 h-3 ml-1.5 text-gray-500" title="Has photo" />}</h3>
                      <span className={`badge text-xs ${PRIORITY_BADGE[a.priority]}`}>{a.priority}</span>
                      <span className="text-xs text-gray-500">{a.status}</span>
                      {od && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-700/50 font-medium">
                          {od}d overdue
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
                      {a.site && <span>📍 {a.site}</span>}
                      {a.assigned_to && <span>👤 {a.assigned_to}</span>}
                      {a.asset_no && <span>🚛 {a.asset_no}</span>}
                      {a.due_date && (
                        <span className={od ? 'text-red-400' : 'text-gray-400'}>
                          📅 Due: {a.due_date.split('T')[0]}
                        </span>
                      )}
                      <span>🗓 Created: {new Date(a.created_at).toLocaleDateString()}</span>
                    </div>
                    {a.description && (
                      <p className="text-sm text-gray-400 mt-2 line-clamp-2">{a.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <select
                      value={a.status}
                      onChange={async e => {
                        const newStatus = e.target.value
                        await supabase.from('corrective_actions').update({
                          status: newStatus,
                          ...(newStatus === 'Closed' ? { closed_at: new Date().toISOString() } : {}),
                        }).eq('id', a.id)
                        load()
                      }}
                      className={`text-xs border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500/50 transition-colors cursor-pointer ${
                        a.status === 'Closed' ? 'bg-green-900/30 text-green-300 border-green-700/40'
                        : a.status === 'In Progress' ? 'bg-yellow-900/30 text-yellow-300 border-yellow-700/40'
                        : 'bg-red-900/30 text-red-300 border-red-700/40'
                      }`}
                    >
                      <option value="Open">Open</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Closed">Closed</option>
                    </select>
                    <button onClick={() => startEdit(a)} className="text-gray-400 hover:text-blue-400 text-sm transition-colors">Edit</button>
                  </div>
                </div>
              </div>
            )
          })}
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
              <div>
                <label className="label">Title *</label>
                <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
              </div>
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
                <div>
                  <label className="label">Site</label>
                  <input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} list="ca-sites" />
                  <datalist id="ca-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                <div>
                  <label className="label">Due Date</label>
                  <input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Assigned To</label>
                  <input className="input" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Asset No</label>
                  <input className="input" value={form.asset_no} onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Tyre Serial</label>
                <input className="input" value={form.tyre_serial} onChange={e => setForm(f => ({ ...f, tyre_serial: e.target.value }))} />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="label">Root Cause</label>
                <textarea className="input" rows={2} value={form.root_cause} onChange={e => setForm(f => ({ ...f, root_cause: e.target.value }))} />
              </div>
              {/* Photo */}
              <div>
                <label className="label">Photo / Evidence</label>
                <div className="flex items-center gap-3">
                  <button type="button"
                    onClick={() => photoRef.current?.click()}
                    className="btn-secondary text-sm flex items-center gap-2 px-3 py-2">
                    <Camera size={14} /> {form?.photo_data ? 'Change Photo' : 'Attach Photo'}
                  </button>
                  {form?.photo_data && (
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, photo_data: null }))}
                      className="text-xs text-red-400 hover:text-red-300">
                      Remove
                    </button>
                  )}
                  <input ref={photoRef} type="file" accept="image/*" className="hidden"
                    onChange={e => handlePhoto(e, setForm)} />
                </div>
                {form?.photo_data && (
                  <img src={form.photo_data} alt="Evidence" className="mt-2 rounded-lg max-h-40 border border-gray-700 object-cover" />
                )}
              </div>
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
