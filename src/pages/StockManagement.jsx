import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Save, X, AlertTriangle } from 'lucide-react'

const STATUS_BADGE = {
  OK: 'bg-green-900/50 text-green-300',
  Low: 'bg-yellow-900/50 text-yellow-300',
  Critical: 'bg-red-900/50 text-red-300',
}

const EMPTY_FORM = { site: '', description: '', stock_qty: 0, min_level: 5, critical_level: 3, management_action: '' }

export default function StockManagement() {
  const { profile } = useAuth()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('stock_records').select('*').order('site')
    setRecords(data ?? [])
    setLoading(false)
  }

  function deriveStatus(r) {
    if (r.stock_qty <= r.critical_level) return 'Critical'
    if (r.stock_qty <= r.min_level) return 'Low'
    return 'OK'
  }

  function startAdd() { setForm(EMPTY_FORM); setEditId(null); setShowForm(true); setError('') }
  function startEdit(r) {
    setForm({ site: r.site, description: r.description ?? '', stock_qty: r.stock_qty, min_level: r.min_level, critical_level: r.critical_level, management_action: r.management_action ?? '' })
    setEditId(r.id)
    setShowForm(true)
    setError('')
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const status = deriveStatus(form)
    const payload = { ...form, stock_status: status, updated_by: profile?.id, updated_at: new Date().toISOString() }

    const { error: err } = editId
      ? await supabase.from('stock_records').update(payload).eq('id', editId)
      : await supabase.from('stock_records').insert(payload)

    if (err) { setError(err.message); setSaving(false); return }
    setShowForm(false)
    load()
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Stock Management</h1>
          <p className="text-gray-400 text-sm mt-1">{records.length} sites tracked</p>
        </div>
        <button onClick={startAdd} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Add Stock Record
        </button>
      </div>

      {/* Summary badges */}
      <div className="flex gap-3">
        {['OK', 'Low', 'Critical'].map(s => {
          const count = records.filter(r => deriveStatus(r) === s).length
          return (
            <div key={s} className={`badge px-3 py-1.5 ${STATUS_BADGE[s]}`}>
              {count} {s}
            </div>
          )
        })}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Site', 'Description', 'Stock Qty', 'Min Level', 'Critical Level', 'Reorder Qty', 'Status', 'Action', ''].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-500">Loading…</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-500">No stock records yet</td></tr>
              ) : records.map(r => {
                const status = deriveStatus(r)
                return (
                  <tr key={r.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="table-cell font-medium text-white">{r.site}</td>
                    <td className="table-cell">{r.description ?? '—'}</td>
                    <td className="table-cell">
                      <span className={status === 'Critical' ? 'text-red-400 font-bold' : status === 'Low' ? 'text-yellow-400 font-semibold' : 'text-green-400'}>{r.stock_qty}</span>
                    </td>
                    <td className="table-cell text-gray-400">{r.min_level}</td>
                    <td className="table-cell text-gray-400">{r.critical_level}</td>
                    <td className="table-cell text-gray-400">{r.reorder_qty ?? 0}</td>
                    <td className="table-cell">
                      <span className={`badge ${STATUS_BADGE[status]}`}>{status}</span>
                    </td>
                    <td className="table-cell text-gray-400 text-xs">{r.management_action ?? '—'}</td>
                    <td className="table-cell">
                      <button onClick={() => startEdit(r)} className="text-gray-400 hover:text-blue-400 text-sm transition-colors">Edit</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{editId ? 'Edit' : 'Add'} Stock Record</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
            <form onSubmit={save} className="space-y-3">
              <div><label className="label">Site *</label><input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} required /></div>
              <div><label className="label">Description</label><input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">Stock Qty</label><input type="number" className="input" value={form.stock_qty} onChange={e => setForm(f => ({ ...f, stock_qty: +e.target.value }))} min={0} /></div>
                <div><label className="label">Min Level</label><input type="number" className="input" value={form.min_level} onChange={e => setForm(f => ({ ...f, min_level: +e.target.value }))} min={0} /></div>
                <div><label className="label">Critical Level</label><input type="number" className="input" value={form.critical_level} onChange={e => setForm(f => ({ ...f, critical_level: +e.target.value }))} min={0} /></div>
              </div>
              <div><label className="label">Management Action</label><input className="input" value={form.management_action} onChange={e => setForm(f => ({ ...f, management_action: e.target.value }))} /></div>
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
