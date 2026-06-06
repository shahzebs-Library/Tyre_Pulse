import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, Plus, Search, X, Save, FileDown, FileText, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip as ChartTooltip, Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, ChartTooltip, Legend)

const STATUSES = [
  'Reported',
  'Under Investigation',
  'Repair In Progress',
  'Awaiting Parts',
  'Awaiting Approval',
  'Insurance Claim',
  'Closed',
]

const SEVERITIES = ['Minor', 'Major', 'Total Loss']

const SEVERITY_BADGE = {
  Minor:        'bg-gray-800 text-gray-300 border border-gray-600',
  Major:        'bg-orange-900/50 text-orange-300 border border-orange-700/50',
  'Total Loss': 'bg-red-900/50 text-red-300 border border-red-700/50',
}

const STATUS_BADGE = {
  'Reported':              'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
  'Under Investigation':   'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  'Repair In Progress':    'bg-orange-900/50 text-orange-300 border border-orange-700/50',
  'Awaiting Parts':        'bg-purple-900/50 text-purple-300 border border-purple-700/50',
  'Awaiting Approval':     'bg-purple-900/50 text-purple-300 border border-purple-700/50',
  'Insurance Claim':       'bg-red-900/50 text-red-300 border border-red-700/50',
  'Closed':                'bg-green-900/50 text-green-300 border border-green-700/50',
}

const EMPTY_FORM = {
  incident_date: '',
  asset_no: '',
  site: '',
  country: '',
  description: '',
  severity: 'Minor',
  status: 'Reported',
  repair_cost: '',
  insurance_claim_no: '',
  inspector: '',
  photos: [],
}

function fmtCurrency(val) {
  if (!val && val !== 0) return '-'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(val)
}

function monthKey(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function last12MonthKeys() {
  const keys = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

function monthLabel(key) {
  const [year, month] = key.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

export default function Accidents() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const navigate = useNavigate()

  const [records, setRecords]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [showModal, setShowModal]   = useState(false)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [formError, setFormError]   = useState('')
  const [form, setForm]             = useState(EMPTY_FORM)

  const [search, setSearch]               = useState('')
  const [filterSite, setFilterSite]       = useState('')
  const [filterSeverity, setFilterSeverity] = useState('')
  const [filterStatus, setFilterStatus]   = useState('')
  const [filterFrom, setFilterFrom]       = useState('')
  const [filterTo, setFilterTo]           = useState('')
  const [statusFunnel, setStatusFunnel]   = useState('')

  const loadRecords = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('accidents').select('*').order('incident_date', { ascending: false })
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    const { data, error: err } = await q
    if (err) setError(err.message)
    else setRecords(data ?? [])
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { loadRecords() }, [loadRecords])

  const sites = useMemo(() => [...new Set(records.map(r => r.site).filter(Boolean))].sort(), [records])

  const stats = useMemo(() => {
    const total = records.length
    const open = records.filter(r => r.status !== 'Closed').length
    const insur = records.filter(r => r.status === 'Insurance Claim').length
    const cost = records.reduce((s, r) => s + (Number(r.repair_cost) || 0), 0)
    return { total, open, insur, cost }
  }, [records])

  const chartData = useMemo(() => {
    const keys = last12MonthKeys()
    const counts = {}
    keys.forEach(k => { counts[k] = 0 })
    records.forEach(r => {
      const k = monthKey(r.incident_date)
      if (k && counts[k] !== undefined) counts[k]++
    })
    return {
      labels: keys.map(k => monthLabel(k)),
      datasets: [{
        label: 'Incidents',
        data: keys.map(k => counts[k]),
        backgroundColor: 'rgba(22,163,74,0.7)',
        borderColor: '#16a34a',
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [records])

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: '#1f2937', titleColor: '#fff', bodyColor: '#9ca3af', borderColor: '#374151', borderWidth: 1 },
    },
    scales: {
      x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
      y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#374151' }, beginAtZero: true },
    },
  }

  const statusCounts = useMemo(() => {
    const c = {}
    STATUSES.forEach(s => { c[s] = 0 })
    records.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [records])

  const filtered = useMemo(() => {
    let arr = records
    if (statusFunnel) arr = arr.filter(r => r.status === statusFunnel)
    if (filterStatus) arr = arr.filter(r => r.status === filterStatus)
    if (filterSeverity) arr = arr.filter(r => r.severity === filterSeverity)
    if (filterSite) arr = arr.filter(r => r.site === filterSite)
    if (filterFrom) arr = arr.filter(r => r.incident_date >= filterFrom)
    if (filterTo) arr = arr.filter(r => r.incident_date <= filterTo)
    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter(r =>
        (r.asset_no ?? '').toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )
    }
    return arr
  }, [records, search, filterSite, filterSeverity, filterStatus, filterFrom, filterTo, statusFunnel])

  function openAdd() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setFormError('')
    setShowModal(true)
  }

  function openEdit(row) {
    setForm({
      incident_date:     row.incident_date ? row.incident_date.split('T')[0] : '',
      asset_no:          row.asset_no ?? '',
      site:              row.site ?? '',
      country:           row.country ?? '',
      description:       row.description ?? '',
      severity:          row.severity ?? 'Minor',
      status:            row.status ?? 'Reported',
      repair_cost:       row.repair_cost ?? '',
      insurance_claim_no: row.insurance_claim_no ?? '',
      inspector:         row.inspector ?? '',
      photos:            row.photos ?? [],
    })
    setEditId(row.id)
    setFormError('')
    setShowModal(true)
  }

  function handlePhotoFiles(e) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        setForm(f => ({ ...f, photos: [...f.photos, ev.target.result] }))
      }
      reader.readAsDataURL(file)
    })
  }

  function removePhoto(idx) {
    setForm(f => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const payload = {
      incident_date:      form.incident_date || null,
      asset_no:           form.asset_no,
      site:               form.site || null,
      country:            form.country || null,
      description:        form.description || null,
      severity:           form.severity,
      status:             form.status,
      repair_cost:        form.repair_cost !== '' ? Number(form.repair_cost) : null,
      insurance_claim_no: form.insurance_claim_no || null,
      inspector:          form.inspector || null,
      photos:             form.photos.length ? form.photos : null,
    }
    if (!editId) payload.created_by = profile?.id
    const { error: err } = editId
      ? await supabase.from('accidents').update(payload).eq('id', editId)
      : await supabase.from('accidents').insert(payload)
    if (err) { setFormError(err.message); setSaving(false); return }
    setShowModal(false)
    loadRecords()
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this incident record?')) return
    await supabase.from('accidents').delete().eq('id', id)
    loadRecords()
  }

  function raiseAction(row) {
    navigate('/actions', {
      state: {
        prefill: {
          asset_no: row.asset_no,
          site: row.site,
          description: row.description,
        },
      },
    })
  }

  const exportCols = ['incident_date', 'asset_no', 'site', 'severity', 'status', 'repair_cost', 'inspector']
  const exportHeaders = ['Date', 'Asset', 'Site', 'Severity', 'Status', 'Repair Cost', 'Inspector']
  const exportPdfCols = exportCols.map((k, i) => ({ key: k, header: exportHeaders[i] }))

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <AlertOctagon size={22} className="text-orange-400" />
            Accidents &amp; Incidents
          </h1>
          <p className="text-gray-400 text-sm mt-1">{records.length} total incidents</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => exportToExcel(filtered, exportCols, exportHeaders, 'TyrePulse_Accidents')}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Download size={14} /> Excel
          </button>
          <button
            onClick={() => exportToPdf(filtered, exportPdfCols, 'Accidents & Incidents', 'TyrePulse_Accidents', 'landscape')}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <FileText size={14} /> PDF
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New Incident
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">{error}</div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card text-center">
          <p className="text-2xl font-bold text-white">{stats.total}</p>
          <p className="text-xs text-gray-400 mt-1">Total Incidents</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-orange-400">{stats.open}</p>
          <p className="text-xs text-gray-400 mt-1">Open</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-400">{stats.insur}</p>
          <p className="text-xs text-gray-400 mt-1">Insurance Claims</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-400">{fmtCurrency(stats.cost)}</p>
          <p className="text-xs text-gray-400 mt-1">Total Repair Cost</p>
        </div>
      </div>

      {/* Bar chart */}
      <div className="card">
        <p className="text-sm font-semibold text-gray-300 mb-3">Incidents per Month (last 12 months)</p>
        <div style={{ height: 160 }}>
          <Bar data={chartData} options={chartOpts} />
        </div>
      </div>

      {/* Status funnel */}
      <div className="flex flex-wrap gap-2">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setStatusFunnel(statusFunnel === s ? '' : s)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              statusFunnel === s
                ? STATUS_BADGE[s] + ' ring-1 ring-white/20'
                : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
            }`}
          >
            {s} <span className="ml-1 opacity-70">{statusCounts[s]}</span>
          </button>
        ))}
        {statusFunnel && (
          <button onClick={() => setStatusFunnel('')} className="text-xs text-gray-500 hover:text-white px-2">
            <X size={12} className="inline" /> Clear
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input pl-8 text-sm w-48"
            placeholder="Search asset or description"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="input text-sm w-36" value={filterSite} onChange={e => setFilterSite(e.target.value)}>
          <option value="">All Sites</option>
          {sites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input text-sm w-36" value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
          <option value="">All Severities</option>
          {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input text-sm w-44" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" className="input text-sm w-36" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} title="From date" />
        <input type="date" className="input text-sm w-36" value={filterTo} onChange={e => setFilterTo(e.target.value)} title="To date" />
        {(search || filterSite || filterSeverity || filterStatus || filterFrom || filterTo) && (
          <button
            onClick={() => { setSearch(''); setFilterSite(''); setFilterSeverity(''); setFilterStatus(''); setFilterFrom(''); setFilterTo('') }}
            className="text-xs text-gray-500 hover:text-white px-2 flex items-center gap-1"
          >
            <X size={12} /> Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No incidents found</div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header">Date</th>
                <th className="table-header">Asset</th>
                <th className="table-header">Site</th>
                <th className="table-header">Severity</th>
                <th className="table-header">Status</th>
                <th className="table-header">Repair Cost</th>
                <th className="table-header">Inspector</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="border-t border-gray-800 hover:bg-gray-800/30 transition-colors">
                  <td className="table-cell whitespace-nowrap">
                    {row.incident_date ? new Date(row.incident_date).toLocaleDateString() : '-'}
                  </td>
                  <td className="table-cell font-medium text-white">{row.asset_no || '-'}</td>
                  <td className="table-cell">{row.site || '-'}</td>
                  <td className="table-cell">
                    {row.severity && (
                      <span className={`badge text-xs ${SEVERITY_BADGE[row.severity] ?? 'bg-gray-800 text-gray-300'}`}>
                        {row.severity}
                      </span>
                    )}
                  </td>
                  <td className="table-cell">
                    {row.status && (
                      <span className={`badge text-xs ${STATUS_BADGE[row.status] ?? 'bg-gray-800 text-gray-300'}`}>
                        {row.status}
                      </span>
                    )}
                  </td>
                  <td className="table-cell whitespace-nowrap">{fmtCurrency(row.repair_cost)}</td>
                  <td className="table-cell">{row.inspector || '-'}</td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(row)} className="text-gray-400 hover:text-blue-400 text-xs transition-colors">Edit</button>
                      {row.status !== 'Closed' && (
                        <button onClick={() => raiseAction(row)} className="text-gray-400 hover:text-orange-400 text-xs transition-colors whitespace-nowrap">Raise CA</button>
                      )}
                      <button onClick={() => handleDelete(row.id)} className="text-gray-400 hover:text-red-400 text-xs transition-colors">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl p-6 my-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {editId ? 'Edit Incident' : 'New Incident'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{formError}</div>
            )}

            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Incident Date *</label>
                  <input
                    type="date" className="input" required
                    value={form.incident_date}
                    onChange={e => setForm(f => ({ ...f, incident_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Asset No *</label>
                  <input
                    className="input" required
                    value={form.asset_no}
                    onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Site</label>
                  <input
                    className="input" list="acc-sites"
                    value={form.site}
                    onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                  />
                  <datalist id="acc-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                <div>
                  <label className="label">Country</label>
                  <input
                    className="input"
                    value={form.country}
                    onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input" rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Severity</label>
                  <select
                    className="input"
                    value={form.severity}
                    onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                  >
                    {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select
                    className="input"
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  >
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Repair Cost</label>
                  <input
                    type="number" min="0" step="0.01" className="input"
                    value={form.repair_cost}
                    onChange={e => setForm(f => ({ ...f, repair_cost: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Insurance Claim No</label>
                  <input
                    className="input"
                    value={form.insurance_claim_no}
                    onChange={e => setForm(f => ({ ...f, insurance_claim_no: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="label">Inspector</label>
                <input
                  className="input"
                  value={form.inspector}
                  onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))}
                />
              </div>

              <div>
                <label className="label">Photos</label>
                <input
                  type="file" accept="image/*" multiple className="input text-sm py-1.5"
                  onChange={handlePhotoFiles}
                />
                {form.photos.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {form.photos.map((src, i) => (
                      <div key={i} className="relative">
                        <img src={src} alt={`Photo ${i + 1}`} className="h-16 w-16 object-cover rounded border border-gray-700" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute -top-1.5 -right-1.5 bg-red-700 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] hover:bg-red-500"
                        >
                          <X size={8} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={16} /> {saving ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
