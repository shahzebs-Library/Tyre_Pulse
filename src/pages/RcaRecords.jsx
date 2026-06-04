import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Save, X, Search } from 'lucide-react'

const EMPTY_FORM = {
  asset_no: '', tyre_serial: '', brand: '', site: '',
  failure_date: '', km_at_failure: '', hours_at_failure: '',
  root_cause: '', contributing_factors: '', ai_analysis: '',
}

export default function RcaRecords() {
  const { profile } = useAuth()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedRecord, setSelectedRecord] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('rca_records').select('*').order('created_at', { ascending: false })
    setRecords(data ?? [])
    setLoading(false)
  }

  function startAdd() { setForm(EMPTY_FORM); setEditId(null); setShowForm(true); setError('') }
  function startEdit(r) {
    setForm({
      asset_no: r.asset_no ?? '', tyre_serial: r.tyre_serial ?? '', brand: r.brand ?? '',
      site: r.site ?? '', failure_date: r.failure_date ?? '',
      km_at_failure: r.km_at_failure ?? '', hours_at_failure: r.hours_at_failure ?? '',
      root_cause: r.root_cause ?? '',
      contributing_factors: Array.isArray(r.contributing_factors) ? r.contributing_factors.join(', ') : '',
      ai_analysis: r.ai_analysis ?? '',
    })
    setEditId(r.id)
    setShowForm(true)
    setError('')
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      ...form,
      km_at_failure: form.km_at_failure ? +form.km_at_failure : null,
      hours_at_failure: form.hours_at_failure ? +form.hours_at_failure : null,
      contributing_factors: form.contributing_factors
        ? form.contributing_factors.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      created_by: editId ? undefined : profile?.id,
    }
    const { error: err } = editId
      ? await supabase.from('rca_records').update(payload).eq('id', editId)
      : await supabase.from('rca_records').insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    setShowForm(false)
    load()
    setSaving(false)
  }

  const filtered = records.filter(r =>
    !search || [r.asset_no, r.tyre_serial, r.brand, r.site, r.root_cause]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Root Cause Analysis</h1>
          <p className="text-gray-400 text-sm mt-1">{records.length} RCA records</p>
        </div>
        <button onClick={startAdd} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New RCA
        </button>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" placeholder="Search asset, serial, brand, site…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No RCA records found</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <div key={r.id} className="card hover:border-gray-700 transition-colors cursor-pointer" onClick={() => setSelectedRecord(r)}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-white">{r.asset_no ?? '—'}</span>
                    {r.tyre_serial && <span className="text-xs text-gray-400">Serial: {r.tyre_serial}</span>}
                    {r.brand && <span className="badge bg-blue-900/50 text-blue-300">{r.brand}</span>}
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                    {r.site && <span>📍 {r.site}</span>}
                    {r.failure_date && <span>🗓 Failed: {r.failure_date}</span>}
                    {r.km_at_failure && <span>📏 {r.km_at_failure.toLocaleString()} km</span>}
                  </div>
                  {r.root_cause && (
                    <p className="text-sm text-gray-300 mt-2 line-clamp-2"><span className="text-gray-500">Root Cause: </span>{r.root_cause}</p>
                  )}
                  {Array.isArray(r.contributing_factors) && r.contributing_factors.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {r.contributing_factors.map((f, i) => (
                        <span key={i} className="badge bg-gray-800 text-gray-400 text-xs">{f}</span>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={e => { e.stopPropagation(); startEdit(r) }} className="text-gray-400 hover:text-blue-400 text-sm transition-colors flex-shrink-0">Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selectedRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedRecord(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">RCA Detail</h2>
              <button onClick={() => setSelectedRecord(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            <dl className="space-y-3 text-sm">
              {[
                ['Asset No', selectedRecord.asset_no],
                ['Tyre Serial', selectedRecord.tyre_serial],
                ['Brand', selectedRecord.brand],
                ['Site', selectedRecord.site],
                ['Failure Date', selectedRecord.failure_date],
                ['KM at Failure', selectedRecord.km_at_failure?.toLocaleString()],
                ['Hours at Failure', selectedRecord.hours_at_failure?.toLocaleString()],
                ['Root Cause', selectedRecord.root_cause],
                ['AI Analysis', selectedRecord.ai_analysis],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-gray-500 mb-0.5">{k}</dt>
                  <dd className="text-gray-200">{v}</dd>
                </div>
              ))}
              {Array.isArray(selectedRecord.contributing_factors) && selectedRecord.contributing_factors.length > 0 && (
                <div>
                  <dt className="text-gray-500 mb-1">Contributing Factors</dt>
                  <dd className="flex gap-1 flex-wrap">
                    {selectedRecord.contributing_factors.map((f, i) => (
                      <span key={i} className="badge bg-gray-800 text-gray-300">{f}</span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto" onClick={() => setShowForm(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6 my-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{editId ? 'Edit' : 'New'} RCA Record</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
            <form onSubmit={save} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Asset No</label><input className="input" value={form.asset_no} onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))} /></div>
                <div><label className="label">Tyre Serial</label><input className="input" value={form.tyre_serial} onChange={e => setForm(f => ({ ...f, tyre_serial: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Brand</label><input className="input" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} /></div>
                <div><label className="label">Site</label><input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">Failure Date</label><input type="date" className="input" value={form.failure_date} onChange={e => setForm(f => ({ ...f, failure_date: e.target.value }))} /></div>
                <div><label className="label">KM at Failure</label><input type="number" className="input" value={form.km_at_failure} onChange={e => setForm(f => ({ ...f, km_at_failure: e.target.value }))} /></div>
                <div><label className="label">Hours at Failure</label><input type="number" className="input" value={form.hours_at_failure} onChange={e => setForm(f => ({ ...f, hours_at_failure: e.target.value }))} /></div>
              </div>
              <div><label className="label">Root Cause</label><textarea className="input" rows={3} value={form.root_cause} onChange={e => setForm(f => ({ ...f, root_cause: e.target.value }))} /></div>
              <div><label className="label">Contributing Factors (comma-separated)</label><input className="input" value={form.contributing_factors} onChange={e => setForm(f => ({ ...f, contributing_factors: e.target.value }))} placeholder="e.g. Overloading, Poor inflation, Road hazards" /></div>
              <div><label className="label">AI Analysis</label><textarea className="input" rows={3} value={form.ai_analysis} onChange={e => setForm(f => ({ ...f, ai_analysis: e.target.value }))} /></div>
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
