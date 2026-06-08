import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { Plus, Save, X, Search, Download, FileText, Camera, GitBranch } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const CONTRIBUTING_FACTOR_OPTIONS = [
  'Overloading',
  'Road Conditions',
  'Maintenance Failure',
  'Driver Error',
  'Manufacturing Defect',
  'Age/Wear',
  'Under/Overinflation',
  'Heat',
  'Chemical Damage',
]

const FACTOR_COLORS = [
  'bg-orange-900/40 text-orange-300 border-orange-700/50',
  'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  'bg-red-900/40 text-red-300 border-red-700/50',
  'bg-blue-900/40 text-blue-300 border-blue-700/50',
  'bg-purple-900/40 text-purple-300 border-purple-700/50',
  'bg-gray-800 text-gray-300 border-gray-600',
  'bg-cyan-900/40 text-cyan-300 border-cyan-700/50',
  'bg-pink-900/40 text-pink-300 border-pink-700/50',
  'bg-green-900/40 text-green-300 border-green-700/50',
]

const FACTOR_COLOR_MAP = Object.fromEntries(
  CONTRIBUTING_FACTOR_OPTIONS.map((f, i) => [f, FACTOR_COLORS[i % FACTOR_COLORS.length]])
)

const EMPTY_FORM = {
  asset_no: '', tyre_serial: '', brand: '', site: '', country: 'KSA',
  failure_date: '', km_at_failure: '', hours_at_failure: '',
  root_cause: '', contributing_factors: [], ai_analysis: '',
}

export default function RcaRecords() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const navigate    = useNavigate()

  const [records, setRecords]               = useState([])
  const [loading, setLoading]               = useState(true)
  const [showForm, setShowForm]             = useState(false)
  const [form, setForm]                     = useState(EMPTY_FORM)
  const [editId, setEditId]                 = useState(null)
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState('')
  const [search, setSearch]                 = useState('')
  const [filterFrom, setFilterFrom]         = useState('')
  const [filterTo, setFilterTo]             = useState('')
  const [filterRootCause, setFilterRootCause] = useState('')
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
      asset_no:          r.asset_no ?? '',
      tyre_serial:       r.tyre_serial ?? '',
      brand:             r.brand ?? '',
      site:              r.site ?? '',
      country:           r.country ?? 'KSA',
      failure_date:      r.failure_date ?? '',
      km_at_failure:     r.km_at_failure ?? '',
      hours_at_failure:  r.hours_at_failure ?? '',
      root_cause:        r.root_cause ?? '',
      contributing_factors: Array.isArray(r.contributing_factors) ? r.contributing_factors : [],
      ai_analysis:       r.ai_analysis ?? '',
    })
    setEditId(r.id)
    setShowForm(true)
    setError('')
  }

  function toggleFactor(factor) {
    setForm(f => {
      const current = Array.isArray(f.contributing_factors) ? f.contributing_factors : []
      if (current.includes(factor)) {
        return { ...f, contributing_factors: current.filter(x => x !== factor) }
      }
      return { ...f, contributing_factors: [...current, factor] }
    })
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      ...form,
      km_at_failure:        form.km_at_failure    ? +form.km_at_failure    : null,
      hours_at_failure:     form.hours_at_failure ? +form.hours_at_failure : null,
      contributing_factors: Array.isArray(form.contributing_factors) ? form.contributing_factors : [],
      country:              form.country || 'KSA',
      created_by:           editId ? undefined : profile?.id,
    }
    const { error: err } = editId
      ? await supabase.from('rca_records').update(payload).eq('id', editId)
      : await supabase.from('rca_records').insert(payload)
    if (err) { setError(err.message); setSaving(false); return }
    setShowForm(false)
    load()
    setSaving(false)
  }

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
      await supabase.from('rca_records')
        .update({ corrective_action_id: ca.id })
        .eq('id', rca.id)
      await load()
      navigate('/actions')
    }
    setCreatingAction(false)
  }

  // Unique root cause categories from records
  const rootCauseOptions = useMemo(() => {
    const vals = records.map(r => r.root_cause).filter(Boolean)
    return [...new Set(vals)].sort()
  }, [records])

  const filtered = useMemo(() => {
    let arr = records
    if (search) {
      const q = search.toLowerCase()
      arr = arr.filter(r =>
        [r.asset_no, r.tyre_serial, r.brand, r.site, r.root_cause]
          .some(v => v?.toLowerCase().includes(q))
      )
    }
    if (filterFrom) arr = arr.filter(r => r.failure_date && r.failure_date >= filterFrom)
    if (filterTo)   arr = arr.filter(r => r.failure_date && r.failure_date <= filterTo)
    if (filterRootCause) arr = arr.filter(r => r.root_cause === filterRootCause)
    return arr
  }, [records, search, filterFrom, filterTo, filterRootCause])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader
            title="Root Cause Analysis"
            subtitle={`${records.length} RCA records`}
            icon={GitBranch}
          />
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

      {/* Filters row */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9 w-52"
            placeholder="Search asset, serial, brand…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <input
          type="date"
          className="input text-sm w-36"
          title="Failure date from"
          value={filterFrom}
          onChange={e => setFilterFrom(e.target.value)}
        />
        <input
          type="date"
          className="input text-sm w-36"
          title="Failure date to"
          value={filterTo}
          onChange={e => setFilterTo(e.target.value)}
        />
        <select
          className="input text-sm w-48"
          value={filterRootCause}
          onChange={e => setFilterRootCause(e.target.value)}
        >
          <option value="">All Root Causes</option>
          {rootCauseOptions.map(rc => (
            <option key={rc} value={rc}>{rc.length > 40 ? rc.slice(0, 40) + '…' : rc}</option>
          ))}
        </select>
        {(search || filterFrom || filterTo || filterRootCause) && (
          <button
            onClick={() => { setSearch(''); setFilterFrom(''); setFilterTo(''); setFilterRootCause('') }}
            className="text-xs text-gray-500 hover:text-white flex items-center gap-1 px-2"
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : records.length === 0 ? (
        /* Better empty state */
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
            <GitBranch size={32} className="text-gray-600" />
          </div>
          <div className="text-center">
            <p className="text-white font-semibold text-lg">No RCA records yet</p>
            <p className="text-gray-500 text-sm mt-1">Start by linking an RCA to a corrective action</p>
          </div>
          <button onClick={startAdd} className="btn-primary flex items-center gap-2 text-sm mt-2">
            <Plus size={16} /> Create First RCA
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No RCA records match your filters</div>
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
                        CA Linked
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                    {r.site && <span>· {r.site}</span>}
                    {r.failure_date && <span>· Failed: {r.failure_date}</span>}
                    {r.km_at_failure && <span>· {r.km_at_failure.toLocaleString()} km</span>}
                  </div>
                  {r.root_cause && (
                    <p className="text-sm text-gray-300 mt-2 line-clamp-2">
                      <span className="text-gray-500">Root Cause: </span>{r.root_cause}
                    </p>
                  )}
                  {Array.isArray(r.contributing_factors) && r.contributing_factors.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {r.contributing_factors.map((f, i) => (
                        <span
                          key={i}
                          className={`badge text-xs border ${FACTOR_COLOR_MAP[f] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}
                        >
                          {f}
                        </span>
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
                ['Analysis Notes',    selectedRecord.ai_analysis],
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
                      <span
                        key={i}
                        className={`badge border ${FACTOR_COLOR_MAP[f] ?? 'bg-gray-800 text-gray-300 border-gray-700'}`}
                      >
                        {f}
                      </span>
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

              {/* Contributing factors as checkbox chips */}
              <div>
                <label className="label">Contributing Factors</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {CONTRIBUTING_FACTOR_OPTIONS.map(factor => {
                    const selected = Array.isArray(form.contributing_factors) && form.contributing_factors.includes(factor)
                    return (
                      <button
                        key={factor}
                        type="button"
                        onClick={() => toggleFactor(factor)}
                        className={`text-left text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                          selected
                            ? `${FACTOR_COLOR_MAP[factor]} ring-1 ring-white/20`
                            : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-white'
                        }`}
                      >
                        {selected && <span className="mr-1">✓</span>}{factor}
                      </button>
                    )
                  })}
                </div>
              </div>

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
