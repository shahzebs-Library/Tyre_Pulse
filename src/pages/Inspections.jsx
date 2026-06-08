import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf, exportInspectionDetailPdf } from '../lib/exportUtils'
import { Download, FileText, Camera, ClipboardList, Eye, GraduationCap } from 'lucide-react'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'

const STATUS_CONFIG = {
  Scheduled:    { color: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700/50' },
  'In Progress':{ color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700/50' },
  Done:         { color: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700/50' },
  Overdue:      { color: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700/50' },
  Cancelled:    { color: 'text-gray-400',   bg: 'bg-gray-800',      border: 'border-gray-700' },
}

const SEV_CONFIG = {
  Low:      { color: 'text-green-400',  bg: 'bg-green-900/20',  border: 'border-green-700/40' },
  Medium:   { color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-700/40' },
  High:     { color: 'text-orange-400', bg: 'bg-orange-900/20', border: 'border-orange-700/40' },
  Critical: { color: 'text-red-400',    bg: 'bg-red-900/20',    border: 'border-red-700/40' },
}

const VEHICLE_TYPES = ['Pickup', 'Canter', 'Tri-mixer', 'Concrete pump', 'Wheel loader', 'Skid loader']
const RISK_LEVELS   = ['good', 'warning', 'critical', 'none']

const INSPECTION_TYPES   = ['Routine', 'Pressure', 'Visual', 'Full', 'Pre-Trip']
const OBSERVATION_TYPES  = ['Site Observation']
const TRAINING_TYPES     = ['Safety Training', 'Training Session']
const ALL_TYPES = [...INSPECTION_TYPES, ...OBSERVATION_TYPES, ...TRAINING_TYPES]

const STATUSES = ['Scheduled', 'In Progress', 'Done', 'Overdue', 'Cancelled']
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical']

const EMPTY_FORM = {
  title: '', inspection_type: 'Routine', site: '', asset_no: '', tyre_serial: '',
  scheduled_date: '', status: 'Scheduled', findings: '', inspector: '', notes: '',
  attendees: '', severity: 'Medium', photo_data: null,
  vehicle_type: '', tyre_conditions: {},
}

function isObservationType(t) { return OBSERVATION_TYPES.includes(t) }
function isTrainingType(t)     { return TRAINING_TYPES.includes(t) }

export default function Inspections() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(null)
  const [saving, setSaving]     = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSite, setFilterSite]     = useState('all')
  const [search, setSearch]             = useState('')
  const [deleteId, setDeleteId]         = useState(null)
  const [activeTab, setActiveTab]       = useState('all')
  const [raisingAction, setRaisingAction] = useState(null) // inspection row for raise-action modal
  const [selectedTyre, setSelectedTyre]   = useState(null) // tyre id being edited in the form diagram
  const fileRef = useRef(null)

  async function load() {
    setLoading(true)
    let q = supabase.from('inspections').select('*').order('scheduled_date', { ascending: false })
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    const { data } = await q
    const today = new Date().toISOString().split('T')[0]
    const enriched = (data || []).map(r => ({
      ...r,
      status: r.status !== 'Done' && r.status !== 'Cancelled' && r.scheduled_date < today
        ? 'Overdue' : r.status,
    }))
    setRows(enriched)
    setLoading(false)
  }

  useEffect(() => { load() }, [activeCountry])

  const sites = useMemo(() => [...new Set(rows.map(r => r.site).filter(Boolean))].sort(), [rows])

  const tabFiltered = useMemo(() => {
    if (activeTab === 'inspections') return rows.filter(r => INSPECTION_TYPES.includes(r.inspection_type))
    if (activeTab === 'observations') return rows.filter(r => isObservationType(r.inspection_type))
    if (activeTab === 'training')     return rows.filter(r => isTrainingType(r.inspection_type))
    return rows
  }, [rows, activeTab])

  const filtered = useMemo(() => {
    let r = tabFiltered
    if (filterStatus !== 'all') r = r.filter(x => x.status === filterStatus)
    if (filterSite !== 'all')   r = r.filter(x => x.site === filterSite)
    if (search) {
      const q = search.toLowerCase()
      r = r.filter(x =>
        x.title?.toLowerCase().includes(q) ||
        x.site?.toLowerCase().includes(q) ||
        x.asset_no?.toLowerCase().includes(q) ||
        x.tyre_serial?.toLowerCase().includes(q) ||
        x.inspector?.toLowerCase().includes(q) ||
        x.attendees?.toLowerCase().includes(q)
      )
    }
    return r
  }, [tabFiltered, filterStatus, filterSite, search])

  const counts = useMemo(() => {
    const c = { all: rows.length, inspections: 0, observations: 0, training: 0 }
    rows.forEach(r => {
      if (INSPECTION_TYPES.includes(r.inspection_type)) c.inspections++
      else if (isObservationType(r.inspection_type)) c.observations++
      else if (isTrainingType(r.inspection_type)) c.training++
    })
    return c
  }, [rows])

  const statusCounts = useMemo(() => {
    const c = { all: filtered.length, Scheduled: 0, 'In Progress': 0, Done: 0, Overdue: 0, Cancelled: 0 }
    filtered.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    return c
  }, [filtered])

  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setForm(f => ({ ...f, photo_data: ev.target.result }))
    reader.readAsDataURL(file)
  }

  async function save() {
    if (!form.title?.trim()) return
    if (!form.site?.trim()) return
    if (!form.scheduled_date) return
    setSaving(true)
    const payload = { ...form, created_by: profile?.id ?? null }
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

  async function raiseAction(row, actionTitle) {
    const { data, error } = await supabase.from('corrective_actions').insert({
      title: actionTitle || `Action from: ${row.title}`,
      description: row.findings || row.notes || '',
      site: row.site,
      asset_no: row.asset_no || null,
      priority: row.severity === 'Critical' ? 'Critical' : row.severity === 'High' ? 'High' : 'Medium',
      status: 'Open',
      source: 'Observation',
      created_by: profile?.id ?? null,
    }).select('id').single()
    if (!error && data?.id) {
      await supabase.from('inspections').update({ linked_action_id: data.id }).eq('id', row.id)
      await load()
    }
    setRaisingAction(null)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>

  const tabConfig = [
    { key: 'all',          label: 'All',          icon: null,            count: counts.all },
    { key: 'inspections',  label: 'Inspections',  icon: ClipboardList,   count: counts.inspections },
    { key: 'observations', label: 'Observations', icon: Eye,             count: counts.observations },
    { key: 'training',     label: 'Training',     icon: GraduationCap,   count: counts.training },
  ]

  const defaultType = activeTab === 'observations' ? 'Site Observation'
    : activeTab === 'training' ? 'Safety Training'
    : 'Routine'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Inspections & Observations</h1>
          <p className="text-gray-400 text-sm mt-1">Schedule inspections, record site observations and track training</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => exportToExcel(
              filtered,
              ['inspection_type','title','site','asset_no','scheduled_date','status','severity','inspector','attendees','findings'],
              ['Type','Title','Site','Asset No','Date','Status','Severity','Inspector','Attendees','Findings'],
              'TyrePulse_Inspections'
            )}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Download size={14}/> Excel
          </button>
          <button
            onClick={() => exportToPdf(
              filtered,
              [
                {key:'inspection_type',header:'Type'},
                {key:'title',header:'Title'},
                {key:'site',header:'Site'},
                {key:'asset_no',header:'Asset'},
                {key:'scheduled_date',header:'Date'},
                {key:'status',header:'Status'},
                {key:'severity',header:'Severity'},
                {key:'inspector',header:'Inspector'},
              ],
              'Inspections & Observations',
              'TyrePulse_Inspections',
              'landscape'
            )}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <FileText size={14}/> PDF
          </button>
          <button
            className="btn-primary text-sm"
            onClick={() => setForm({ ...EMPTY_FORM, inspection_type: defaultType })}
          >
            + Add Record
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg w-fit flex-wrap">
        {tabConfig.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === key
                ? 'bg-gray-700 text-white shadow'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {label}
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${activeTab === key ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Status filter pills */}
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
            {label} ({statusCounts[val] ?? 0})
          </button>
        ))}
      </div>

      {/* Search + site filter */}
      <div className="flex flex-wrap gap-3">
        <input className="input flex-1 min-w-48" placeholder="Search title, site, asset, inspector, attendees…"
          value={search} onChange={e => setSearch(e.target.value)} />
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
              <th className="pb-2 pr-3">Type</th>
              <th className="pb-2 pr-3">Title</th>
              <th className="pb-2 pr-3">Site</th>
              <th className="pb-2 pr-3">Asset</th>
              <th className="pb-2 pr-3">Date</th>
              <th className="pb-2 pr-3">Severity</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2 pr-3">Inspector</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const cfg    = STATUS_CONFIG[r.status] || STATUS_CONFIG.Scheduled
              const sevCfg = SEV_CONFIG[r.severity]  || SEV_CONFIG.Medium
              const isObs  = isObservationType(r.inspection_type)
              const isTrn  = isTrainingType(r.inspection_type)
              return (
                <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                      isObs ? 'bg-purple-900/20 text-purple-400 border-purple-700/40'
                      : isTrn ? 'bg-blue-900/20 text-blue-400 border-blue-700/40'
                      : 'bg-gray-800 text-gray-400 border-gray-700'
                    }`}>
                      {r.inspection_type}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-white font-medium max-w-48 truncate" title={r.title}>
                    {r.title}
                    {r.photo_data && <Camera className="inline w-3 h-3 ml-1 text-gray-500" title="Has photo" />}
                    {r.linked_action_id && <ClipboardList className="inline w-3 h-3 ml-1 text-yellow-400" title="Action raised" />}
                  </td>
                  <td className="py-2 pr-3 text-gray-300">{r.site}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-gray-400">{r.asset_no || '—'}</td>
                  <td className="py-2 pr-3 text-gray-400 text-xs">{r.scheduled_date}</td>
                  <td className="py-2 pr-3">
                    {r.severity && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${sevCfg.bg} ${sevCfg.color} ${sevCfg.border}`}>
                        {r.severity}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-400 text-xs">{r.inspector || r.attendees || '—'}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      {r.status !== 'Done' && r.status !== 'Cancelled' && (
                        <button onClick={() => markDone(r.id)}
                          className="text-xs px-2 py-1 rounded bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-700/50 transition-colors">
                          ✓ Done
                        </button>
                      )}
                      {isObs && r.status === 'Done' && !r.linked_action_id && (
                        <button onClick={() => setRaisingAction(r)}
                          className="text-xs px-2 py-1 rounded bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40 border border-yellow-700/40 transition-colors">
                          Raise Action
                        </button>
                      )}
                      {r.linked_action_id && (
                        <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-500 border border-gray-700">
                          Action ✓
                        </span>
                      )}
                      <button onClick={() => setForm({ ...r, tyre_conditions: r.tyre_conditions ?? {} })}
                        className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors">
                        Edit
                      </button>
                      <button onClick={() => exportInspectionDetailPdf(r)}
                        className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors"
                        title="Export detailed PDF with tyre diagram">
                        <FileText size={11} className="inline" />
                      </button>
                      <button onClick={() => setDeleteId(r.id)}
                        className="text-xs px-2 py-1 rounded bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-800/50 transition-colors">
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="py-12 text-center text-gray-500">No records found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Modal */}
      {form !== null && (
        <Modal onClose={() => setForm(null)}>
          <h3 className="text-lg font-bold text-white mb-5">
            {form.id ? 'Edit Record' : 'Add Record'}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="label">Title *</label>
              <input className="input" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Descriptive title…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Type</label>
                <select className="input" value={form.inspection_type}
                  onChange={e => setForm(f => ({ ...f, inspection_type: e.target.value }))}>
                  <optgroup label="Inspections">
                    {INSPECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                  <optgroup label="Observations">
                    {OBSERVATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                  <optgroup label="Training">
                    {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Site *</label>
                <input className="input" value={form.site}
                  onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                  placeholder="Site name" list="insp-sites" />
                <datalist id="insp-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="label">Date *</label>
                <input type="date" className="input" value={form.scheduled_date}
                  onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Asset No</label>
                <input className="input" value={form.asset_no}
                  onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))}
                  placeholder="e.g. CM-0123" />
              </div>
              {!isTrainingType(form.inspection_type) && (
                <div>
                  <label className="label">Severity</label>
                  <select className="input" value={form.severity || 'Medium'}
                    onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                    {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              {isTrainingType(form.inspection_type) && (
                <div>
                  <label className="label">Tyre Serial</label>
                  <input className="input" value={form.tyre_serial}
                    onChange={e => setForm(f => ({ ...f, tyre_serial: e.target.value }))}
                    placeholder="Serial number" />
                </div>
              )}
            </div>

            {/* Tyre diagram — inspections only */}
            {!isObservationType(form.inspection_type) && !isTrainingType(form.inspection_type) && (
              <div>
                <label className="label">Vehicle Type</label>
                <select className="input mb-3" value={form.vehicle_type || ''}
                  onChange={e => { setForm(f => ({ ...f, vehicle_type: e.target.value, tyre_conditions: {} })); setSelectedTyre(null) }}>
                  <option value="">— select to show tyre diagram —</option>
                  {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                {form.vehicle_type && (
                  <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/50">
                    <p className="text-xs text-gray-400 mb-3">Click a tyre to set its condition.</p>
                    <VehicleTyreDiagram
                      vehicleType={form.vehicle_type}
                      tyreData={form.tyre_conditions || {}}
                      onTyreClick={(id) => setSelectedTyre(id === selectedTyre ? null : id)}
                      width={180}
                    />

                    {selectedTyre && (
                      <div className="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
                        <p className="text-xs font-semibold text-white mb-2">Tyre: {selectedTyre}</p>
                        <div className="flex gap-2 flex-wrap mb-2">
                          {RISK_LEVELS.map(r => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setForm(f => ({
                                ...f,
                                tyre_conditions: {
                                  ...f.tyre_conditions,
                                  [selectedTyre]: { ...(f.tyre_conditions?.[selectedTyre] ?? {}), risk: r },
                                },
                              }))}
                              className={`text-xs px-2.5 py-1 rounded border capitalize transition-all ${
                                (form.tyre_conditions?.[selectedTyre]?.risk ?? 'none') === r
                                  ? r === 'good'     ? 'bg-green-600 border-green-500 text-white'
                                  : r === 'warning'  ? 'bg-yellow-600 border-yellow-500 text-white'
                                  : r === 'critical' ? 'bg-red-600 border-red-500 text-white'
                                  :                    'bg-gray-600 border-gray-500 text-white'
                                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-white'
                              }`}
                            >
                              {r === 'none' ? 'No data' : r}
                            </button>
                          ))}
                        </div>
                        <input
                          type="number"
                          className="input text-xs py-1"
                          placeholder="Pressure (PSI)"
                          value={form.tyre_conditions?.[selectedTyre]?.pressure ?? ''}
                          onChange={e => setForm(f => ({
                            ...f,
                            tyre_conditions: {
                              ...f.tyre_conditions,
                              [selectedTyre]: { ...(f.tyre_conditions?.[selectedTyre] ?? {}), pressure: e.target.value },
                            },
                          }))}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {isTrainingType(form.inspection_type) ? (
              <div>
                <label className="label">Attendees</label>
                <input className="input" value={form.attendees || ''}
                  onChange={e => setForm(f => ({ ...f, attendees: e.target.value }))}
                  placeholder="Names or count of attendees" />
              </div>
            ) : (
              <div>
                <label className="label">Inspector / Observer</label>
                <input className="input" value={form.inspector}
                  onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))}
                  placeholder="Name" />
              </div>
            )}

            <div>
              <label className="label">{isTrainingType(form.inspection_type) ? 'Training Content' : 'Findings'}</label>
              <textarea className="input h-20 resize-none" value={form.findings}
                onChange={e => setForm(f => ({ ...f, findings: e.target.value }))}
                placeholder={isTrainingType(form.inspection_type) ? 'Topics covered…' : 'What was found…'} />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input h-16 resize-none" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Additional notes…" />
            </div>

            {/* Photo upload */}
            <div>
              <label className="label">Photo</label>
              <div className="flex items-center gap-3">
                <button type="button"
                  onClick={() => fileRef.current?.click()}
                  className="btn-secondary text-sm flex items-center gap-2 px-3 py-2">
                  <Camera size={14} /> {form.photo_data ? 'Change Photo' : 'Upload Photo'}
                </button>
                {form.photo_data && (
                  <button type="button" onClick={() => setForm(f => ({ ...f, photo_data: null }))}
                    className="text-xs text-red-400 hover:text-red-300">Remove</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={handlePhotoChange} />
              </div>
              {form.photo_data && (
                <img src={form.photo_data} alt="Attached" className="mt-2 rounded-lg max-h-48 border border-gray-700 object-cover" />
              )}
            </div>

            {form.status === 'Done' && (
              <div>
                <label className="label">Completed Date</label>
                <input type="date" className="input" value={form.completed_date || ''}
                  onChange={e => setForm(f => ({ ...f, completed_date: e.target.value }))} />
              </div>
            )}
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={() => setForm(null)} className="btn-secondary flex-1">Cancel</button>
            <button onClick={save}
              disabled={saving || !form.title?.trim() || !form.site?.trim() || !form.scheduled_date}
              className="btn-primary flex-1 disabled:opacity-50">
              {saving ? 'Saving…' : form.id ? 'Save Changes' : 'Add'}
            </button>
          </div>
        </Modal>
      )}

      {/* Raise Corrective Action modal */}
      {raisingAction && (
        <RaiseActionModal
          row={raisingAction}
          onConfirm={(title) => raiseAction(raisingAction, title)}
          onClose={() => setRaisingAction(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteId && (
        <Modal onClose={() => setDeleteId(null)}>
          <p className="text-white font-semibold mb-2">Delete this record?</p>
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

function RaiseActionModal({ row, onConfirm, onClose }) {
  const [title, setTitle] = useState(`Action: ${row.title}`)
  return (
    <Modal onClose={onClose}>
      <h3 className="text-lg font-bold text-white mb-4">Raise Corrective Action</h3>
      <p className="text-gray-400 text-sm mb-4">
        This will create a new corrective action linked to this observation.
      </p>
      <div className="mb-4">
        <label className="label">Action Title</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
      </div>
      <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-400 mb-4 space-y-1">
        <p><span className="text-gray-500">Site:</span> {row.site}</p>
        <p><span className="text-gray-500">Asset:</span> {row.asset_no || '—'}</p>
        <p><span className="text-gray-500">Priority:</span> {row.severity === 'Critical' ? 'Critical' : row.severity === 'High' ? 'High' : 'Medium'}</p>
        {row.findings && <p><span className="text-gray-500">Findings:</span> {row.findings.slice(0, 100)}{row.findings.length > 100 ? '…' : ''}</p>}
      </div>
      <div className="flex gap-3">
        <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button onClick={() => onConfirm(title)} className="btn-primary flex-1">Raise Action</button>
      </div>
    </Modal>
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
