import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { Plus, Save, X, Search, Download, FileText, Camera } from 'lucide-react'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  asset_no: '', tyre_serial: '', brand: '', site: '', country: 'KSA',
  failure_date: '', km_at_failure: '', hours_at_failure: '',
  root_cause: '', contributing_factors: '', ai_analysis: '',
}

export default function RcaRecords() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const navigate    = useNavigate()
  const [records, setRecords]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [showForm, setShowForm]         = useState(false)
  const [form, setForm]                 = useState(EMPTY_FORM)
  const [editId, setEditId]             = useState(null)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState('')
  const [search, setSearch]             = useState('')
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [creatingAction, setCreatingAction] = useState(false)
  const photoRef = useRef(null)

  function handlePhoto(e, setter) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setter(f => ({ ...f, photo_data: ev.target.result }))
    reader.readAsDataURL(file)
  }

  useEffect(() => { load() }, [activeCountry])

  async function load() {
    setLoading(true)
    let q = supabase
      .from('rca_records')
      .select('*, corrective_action:corrective_action_id(id,title,status)')
      .order('created_at', { ascending: false })
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    const { data } = await q
    setRecords(data ?? [])
    setLoading(false)
  }

  function startAdd() {
    const defaultCountry = activeCountry !== 'All' ? activeCountry : 'KSA'
    setForm({ ...EMPTY_FORM, country: defaultCountry })
    setEditId(null); setShowForm(true); setError('')
  }
  function startEdit(r) {
    setForm({
      asset_no: r.asset_no ?? '', tyre_serial: r.tyre_serial ?? '', brand: r.brand ?? '',
      site: r.site ?? '', country: r.country ?? 'KSA', failure_date: r.failure_date ?? '',
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
      km_at_failure:    form.km_at_failure    ? +form.km_at_failure    : null,
      hours_at_failure: form.hours_at_failure ? +form.hours_at_failure : null,
      contributing_factors: form.contributing_factors
        ? form.contributing_factors.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      country:    form.country || 'KSA',
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

  // Create a linked Corrective Action from an RCA record
  async function createLinkedAction(rca) {
    setCreatingAction(true)
    const payload = {
      title:       `CA for ${rca.asset_no || rca.tyre_serial || 'RCA'} · ${rca.site || ''}`.trim(),
      priority:    'High',
      site:        rca.site ?? '',
      description: rca.root_cause ? `Root cause: ${rca.root_cause}` : '',
      assigned_to: '',
      status:      'Open',
      asset_no:    rca.asset_no ?? '',
      tyre_serial: rca.tyre_serial ?? '',
      root_cause:  rca.root_cause ?? '',
      created_by:  profile?.id ?? null,
    }
    const { data: ca, error: caErr } = await supabase
      .from('corrective_actions')
      .insert(payload)
      .select('id')
      .single()

    if (!caErr && ca) {
      // Link the RCA to the new CA
      await supabase.from('rca_records')
        .update({ corrective_action_id: ca.id })
        .eq('id', rca.id)
      await load()
      navigate('/actions')
    }
    setCreatingAction(false)
  }

  const filtered = records.filter(r =>
    !search || [r.asset_no, r.tyre_serial, r.brand, r.site, r.root_cause]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Root Cause Analysis</h1>
          <p className="text-gray-400 text-sm mt-1">{records.length} RCA records</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportToExcel(
              filtered,
              ['asset_no','tyre_serial','brand','site','failure_date','root_cause'],
              ['Asset No','Tyre Serial','Brand','Site','Failure Date','Root Cause'],
              'TyrePulse_RCA'
            )}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Download size={14}/> Excel
          </button>
          <button
            onClick={() => exportToPdf(
              filtered,
              [{key:'asset_no',header:'Asset No'},{key:'tyre_serial',header:'Tyre Serial'},{key:'brand',header:'Brand'},{key:'site',header:'Site'},{key:'failure_date',header:'Failure Date'},{key:'root_cause',header:'Root Cause'}],
              'Root Cause Analysis Records',
              'TyrePulse_RCA',
              'landscape'
            )}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <FileText size={14}/> PDF
          </button>
          <button onClick={startAdd} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New RCA
          </button>
        </div>
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
            <div key={r.id} className="card hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedRecord(r)}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-white">{r.asset_no ?? '—'}{r.photo_data && <Camera className="inline w-3 h-3 ml-1.5 text-gray-500" title="Has photo" />}</span>
                    {r.tyre_serial && <span className="text-xs text-gray-400">Serial: {r.tyre_serial}</span>}
                    {r.brand && <span className="badge bg-green-900/40 text-green-300 border border-green-700/50">{r.brand}</span>}
                    {r.country && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700">{r.country}</span>}
                    {r.corrective_action && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-700/50">
                        ✓ CA Linked
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                    {r.site && <span>📍 {r.site}</span>}
                    {r.failure_date && <span>🗓 Failed: {r.failure_date}</span>}
                    {r.km_at_failure && <span>📏 {r.km_at_failure.toLocaleString()} km</span>}
                  </div>
                  {r.root_cause && (
                    <p className="text-sm text-gray-300 mt-2 line-clamp-2">
                      <span className="text-gray-500">Root Cause: </span>{r.root_cause}
                    </p>
                  )}
                  {Array.isArray(r.contributing_factors) && r.contributing_factors.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {r.contributing_factors.map((f, i) => (
                        <span key={i} className="badge bg-gray-800 text-gray-400 text-xs border border-gray-700">{f}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); startEdit(r) }}
                    className="text-gray-400 hover:text-green-400 text-sm transition-colors"
                  >
                    Edit
                  </button>
                  {r.corrective_action ? (
                    <button
                      onClick={() => navigate('/actions')}
                      className="text-xs px-2 py-1 rounded bg-green-900/20 text-green-400 border border-green-700/50 hover:bg-green-900/40 transition-colors"
                    >
                      View CA →
                    </button>
                  ) : (
                    <button
                      onClick={() => createLinkedAction(r)}
                      disabled={creatingAction}
                      className="text-xs px-2 py-1 rounded bg-green-900/20 text-green-400 border border-green-700/50 hover:bg-green-900/40 transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      + Create Action
                    </button>
                  )}
                </div>
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
                ['Asset No',          selectedRecord.asset_no],
                ['Tyre Serial',       selectedRecord.tyre_serial],
                ['Brand',             selectedRecord.brand],
                ['Site',              selectedRecord.site],
                ['Failure Date',      selectedRecord.failure_date],
                ['KM at Failure',     selectedRecord.km_at_failure?.toLocaleString()],
                ['Hours at Failure',  selectedRecord.hours_at_failure?.toLocaleString()],
                ['Root Cause',        selectedRecord.root_cause],
                ['AI Analysis',       selectedRecord.ai_analysis],
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
                      <span key={i} className="badge bg-gray-800 text-gray-300 border border-gray-700">{f}</span>
                    ))}
                  </dd>
                </div>
              )}
              {selectedRecord.corrective_action && (
                <div>
                  <dt className="text-gray-500 mb-1">Linked Corrective Action</dt>
                  <dd>
                    <span className="text-green-400">{selectedRecord.corrective_action.title}</span>
                    <span className="ml-2 text-xs text-gray-500">({selectedRecord.corrective_action.status})</span>
                  </dd>
                </div>
              )}
            </dl>
            {!selectedRecord.corrective_action && (
              <div className="mt-4 pt-4 border-t border-gray-800">
                <button
                  onClick={() => { setSelectedRecord(null); createLinkedAction(selectedRecord) }}
                  disabled={creatingAction}
                  className="btn-primary w-full text-sm disabled:opacity-50"
                >
                  {creatingAction ? 'Creating…' : '+ Create Corrective Action from this RCA'}
                </button>
              </div>
            )}
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
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">Brand</label><input className="input" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} /></div>
                <div><label className="label">Site</label><input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} /></div>
                <div>
                  <label className="label">Country</label>
                  <select className="input" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">Failure Date</label><input type="date" className="input" value={form.failure_date} onChange={e => setForm(f => ({ ...f, failure_date: e.target.value }))} /></div>
                <div><label className="label">KM at Failure</label><input type="number" className="input" value={form.km_at_failure} onChange={e => setForm(f => ({ ...f, km_at_failure: e.target.value }))} /></div>
                <div><label className="label">Hours</label><input type="number" className="input" value={form.hours_at_failure} onChange={e => setForm(f => ({ ...f, hours_at_failure: e.target.value }))} /></div>
              </div>
              <div><label className="label">Root Cause</label><textarea className="input" rows={3} value={form.root_cause} onChange={e => setForm(f => ({ ...f, root_cause: e.target.value }))} /></div>
              <div><label className="label">Contributing Factors (comma-separated)</label><input className="input" value={form.contributing_factors} onChange={e => setForm(f => ({ ...f, contributing_factors: e.target.value }))} placeholder="e.g. Overloading, Poor inflation, Road hazards" /></div>
              <div><label className="label">Analysis Notes</label><textarea className="input" rows={3} value={form.ai_analysis} onChange={e => setForm(f => ({ ...f, ai_analysis: e.target.value }))} /></div>
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
