import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const STATUS_CONFIG = {
  Scheduled:    { color: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700/50' },
  'In Progress':{ color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700/50' },
  Done:         { color: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700/50' },
  Overdue:      { color: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700/50' },
  Cancelled:    { color: 'text-gray-400',   bg: 'bg-gray-800',      border: 'border-gray-700' },
}

const TYPES = ['Routine', 'Pressure', 'Visual', 'Full', 'Pre-Trip']
const STATUSES = ['Scheduled', 'In Progress', 'Done', 'Overdue', 'Cancelled']

const EMPTY_FORM = {
  title: '', inspection_type: 'Routine', site: '', asset_no: '', tyre_serial: '',
  scheduled_date: '', status: 'Scheduled', findings: '', inspector: '', notes: '',
}

export default function Inspections() {
  const { profile } = useAuth()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm]       = useState(null)   // null=closed | {}=new | {..r}=edit
  const [saving, setSaving]   = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSite, setFilterSite]     = useState('all')
  const [search, setSearch]             = useState('')
  const [deleteId, setDeleteId]         = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('inspections')
      .select('*')
      .order('scheduled_date', { ascending: true })
    // Mark overdue in memory
    const today = new Date().toISOString().split('T')[0]
    const enriched = (data || []).map(r => ({
      ...r,
      status: r.status !== 'Done' && r.status !== 'Cancelled' && r.scheduled_date < today
        ? 'Overdue' : r.status
    }))
    setRows(enriched)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const sites = useMemo(() => [...new Set(rows.map(r => r.site).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(() => {
    let r = rows
    if (filterStatus !== 'all') r = r.filter(x => x.status === filterStatus)
    if (filterSite !== 'all')   r = r.filter(x => x.site === filterSite)
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x =>
        x.title?.toLowerCase().includes(q) ||
        x.site?.toLowerCase().includes(q) ||
        x.asset_no?.toLowerCase().includes(q) ||
        x.tyre_serial?.toLowerCase().includes(q)
      )
    }
    return r
  }, [rows, filterStatus, filterSite, search])

  const counts = useMemo(() => {
    const c = { all: rows.length, Scheduled: 0, 'In Progress': 0, Done: 0, Overdue: 0, Cancelled: 0 }
    rows.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    return c
  }, [rows])

  async function save() {
    if (!form.title?.trim()) return
    if (!form.site?.trim()) return
    if (!form.scheduled_date) return
    setSaving(true)
    const payload = {
      ...form,
      created_by: profile?.id ?? null,
    }
    delete payload.id

    let error
    if (form.id) {
      ;({ error } = await supabase.from('inspections').update(payload).eq('id', form.id))
    } else {
      ;({ error } = await supabase.from('inspections').insert(payload))
    }
    if (!error) { setForm(null); await load() }
    setSaving(false)
  }

  async function markDone(id) {
    await supabase.from('inspections').update({
      status: 'Done',
      completed_date: new Date().toISOString().split('T')[0],
    }).eq('id', id)
    await load()
  }

  async function confirmDelete() {
    await supabase.from('inspections').delete().eq('id', deleteId)
    setDeleteId(null)
    await load()
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading inspections…</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Inspections</h1>
          <p className="text-gray-400 text-sm mt-1">Schedule, track and complete tyre inspections</p>
        </div>
        <button className="btn-primary text-sm" onClick={() => setForm(EMPTY_FORM)}>
          + Schedule Inspection
        </button>
      </div>

      {/* Status summary */}
      <div className="flex flex-wrap gap-2">
        {[['all', 'All', 'bg-gray-800 text-gray-300 border-gray-700'],
          ['Overdue', 'Overdue', 'bg-red-900/30 text-red-400 border-red-700/50'],
          ['Scheduled', 'Scheduled', 'bg-blue-900/30 text-blue-400 border-blue-700/50'],
          ['In Progress', 'In Progress', 'bg-yellow-900/30 text-yellow-400 border-yellow-700/50'],
          ['Done', 'Done', 'bg-green-900/30 text-green-400 border-green-700/50'],
        ].map(([val, label, cls]) => (
          <button
            key={val}
            onClick={() => setFilterStatus(val)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${cls} ${filterStatus === val ? 'ring-2 ring-white/20' : 'opacity-70 hover:opacity-100'}`}
          >
            {label} ({counts[val] ?? 0})
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          className="input flex-1 min-w-48"
          placeholder="Search title, site, asset, serial…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input w-44" value={filterSite} onChange={e => setFilterSite(e.target.value)}>
          <option value="all">All Sites</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="pb-2 pr-4">Title</th>
              <th className="pb-2 pr-4">Type</th>
              <th className="pb-2 pr-4">Site</th>
              <th className="pb-2 pr-4">Asset</th>
              <th className="pb-2 pr-4">Scheduled</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Inspector</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.Scheduled
              return (
                <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                  <td className="py-2 pr-4 text-white font-medium">{r.title}</td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{r.inspection_type}</td>
                  <td className="py-2 pr-4 text-gray-300">{r.site}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-400">{r.asset_no || '—'}</td>
                  <td className="py-2 pr-4 text-gray-400">{r.scheduled_date}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{r.inspector || '—'}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-1">
                      {r.status !== 'Done' && r.status !== 'Cancelled' && (
                        <button
                          onClick={() => markDone(r.id)}
                          title="Mark as Done"
                          className="text-xs px-2 py-1 rounded bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-700/50 transition-colors"
                        >
                          ✓ Done
                        </button>
                      )}
                      <button
                        onClick={() => setForm({ ...r })}
                        className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteId(r.id)}
                        className="text-xs px-2 py-1 rounded bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-800/50 transition-colors"
                      >
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-500">No inspections found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {form !== null && (
        <Modal onClose={() => setForm(null)}>
          <h3 className="text-lg font-bold text-white mb-5">
            {form.id ? 'Edit Inspection' : 'Schedule Inspection'}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="label">Title *</label>
              <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Monthly Pressure Check — Site A" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Type</label>
                <select className="input" value={form.inspection_type} onChange={e => setForm(f => ({ ...f, inspection_type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Site *</label>
                <input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} placeholder="Site name" list="insp-sites" />
                <datalist id="insp-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="label">Scheduled Date *</label>
                <input type="date" className="input" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Asset No</label>
                <input className="input" value={form.asset_no} onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))} placeholder="e.g. CM-0123" />
              </div>
              <div>
                <label className="label">Tyre Serial</label>
                <input className="input" value={form.tyre_serial} onChange={e => setForm(f => ({ ...f, tyre_serial: e.target.value }))} placeholder="Serial number" />
              </div>
            </div>
            <div>
              <label className="label">Inspector</label>
              <input className="input" value={form.inspector} onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))} placeholder="Name of inspector" />
            </div>
            <div>
              <label className="label">Findings</label>
              <textarea className="input h-20 resize-none" value={form.findings} onChange={e => setForm(f => ({ ...f, findings: e.target.value }))} placeholder="Inspection findings…" />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input h-16 resize-none" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes…" />
            </div>
            {form.status === 'Done' && (
              <div>
                <label className="label">Completed Date</label>
                <input type="date" className="input" value={form.completed_date || ''} onChange={e => setForm(f => ({ ...f, completed_date: e.target.value }))} />
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={() => setForm(null)} className="btn-secondary flex-1">Cancel</button>
            <button onClick={save} disabled={saving || !form.title?.trim() || !form.site?.trim() || !form.scheduled_date}
              className="btn-primary flex-1 disabled:opacity-50">
              {saving ? 'Saving…' : form.id ? 'Save Changes' : 'Schedule'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <Modal onClose={() => setDeleteId(null)}>
          <p className="text-white font-semibold mb-2">Delete this inspection?</p>
          <p className="text-gray-400 text-sm mb-5">This action cannot be undone.</p>
          <div className="flex gap-3">
            <button onClick={() => setDeleteId(null)} className="btn-secondary flex-1">Cancel</button>
            <button onClick={confirmDelete} className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700">Delete</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
        {children}
      </div>
    </div>
  )
}
