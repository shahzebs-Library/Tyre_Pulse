import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel } from '../lib/exportUtils'
import * as XLSX from 'xlsx'
import {
  Search, Plus, Edit2, Trash2, Save, X, AlertTriangle,
  FileSpreadsheet, Download, Upload, Truck, ChevronLeft, ChevronRight
} from 'lucide-react'

const PAGE_SIZE = 25

const STATUS_OPTIONS = ['Active', 'Inactive', 'Retired', 'Transferred']

const EMPTY_FORM = (country = 'KSA') => ({
  asset_no: '',
  fleet_number: '',
  make: '',
  model: '',
  vehicle_type: '',
  year: '',
  status: 'Active',
  department: '',
  operator_name: '',
  site: '',
  country,
  expected_km_per_tyre: '',
  min_days_between_changes: 30,
  max_tyres_per_day: 2,
  tyre_size: '',
  tyre_brand_preferred: '',
  monthly_tyre_budget: '',
  notes: '',
})

const UPLOAD_COL_MAP = {
  'Asset No':              'asset_no',
  'Fleet Number':          'fleet_number',
  'Make':                  'make',
  'Model':                 'model',
  'Vehicle Type':          'vehicle_type',
  'Year':                  'year',
  'Operator':              'operator_name',
  'Site':                  'site',
  'Country':               'country',
  'Expected KM/Tyre':      'expected_km_per_tyre',
  'Min Days':              'min_days_between_changes',
  'Tyre Size':             'tyre_size',
  'Status':                'status',
}

const TEMPLATE_HEADERS = Object.keys(UPLOAD_COL_MAP)

const EXPORT_COLS = [
  { key: 'asset_no',                header: 'Asset No',          width: 24 },
  { key: 'fleet_number',            header: 'Fleet No',          width: 20 },
  { key: 'make',                    header: 'Make',              width: 22 },
  { key: 'model',                   header: 'Model',             width: 22 },
  { key: 'vehicle_type',            header: 'Type',              width: 22 },
  { key: 'year',                    header: 'Year',              width: 12 },
  { key: 'site',                    header: 'Site',              width: 24 },
  { key: 'operator_name',           header: 'Operator',          width: 26 },
  { key: 'status',                  header: 'Status',            width: 18 },
  { key: 'expected_km_per_tyre',    header: 'Expected KM/Tyre',  width: 22 },
  { key: 'min_days_between_changes',header: 'Min Days',          width: 16 },
  { key: 'tyre_size',               header: 'Tyre Size',         width: 20 },
  { key: 'monthly_tyre_budget',     header: 'Monthly Budget',    width: 20 },
  { key: 'notes',                   header: 'Notes',             width: 36 },
]

const STATUS_BADGE = {
  Active:      'bg-green-900/50 text-green-300',
  Inactive:    'bg-gray-800 text-gray-400',
  Retired:     'bg-red-900/50 text-red-300',
  Transferred: 'bg-yellow-900/50 text-yellow-300',
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = ['Records', 'Bulk Upload']

export default function FleetMaster() {
  const { profile } = useAuth()
  const { activeCountry, activeCurrency } = useSettings()

  // ── data ─────────────────────────────────────────────────────────────────────
  const [records, setRecords]   = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(0)
  const [loading, setLoading]   = useState(true)
  const [sites, setSites]       = useState([])

  // ── filters ──────────────────────────────────────────────────────────────────
  const [search, setSearch]         = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // ── modal state ──────────────────────────────────────────────────────────────
  const [editRecord, setEditRecord]           = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget]       = useState(null)
  const [saving, setSaving]                   = useState(false)
  const [formError, setFormError]             = useState('')
  const [form, setForm]                       = useState(() => EMPTY_FORM())

  // ── tab ──────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(0)

  // ── bulk upload state ─────────────────────────────────────────────────────────
  const fileRef           = useRef(null)
  const [uploadStep, setUploadStep]       = useState('idle')  // idle|preview|uploading|done
  const [uploadFileName, setUploadFileName] = useState('')
  const [uploadPreview, setUploadPreview] = useState([])
  const [uploadRows, setUploadRows]       = useState([])
  const [uploadResult, setUploadResult]   = useState(null)
  const [uploadError, setUploadError]     = useState('')

  // ── load ─────────────────────────────────────────────────────────────────────
  useEffect(() => { loadSites() }, [])
  useEffect(() => { loadRecords() }, [page, search, siteFilter, statusFilter, activeCountry])

  async function loadSites() {
    const { data } = await supabase.from('vehicle_fleet').select('site').not('site', 'is', null)
    setSites([...new Set((data ?? []).map(r => r.site))].sort())
  }

  const loadRecords = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('vehicle_fleet')
      .select('*', { count: 'exact' })
      .order('asset_no', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search)       q = q.or(`asset_no.ilike.%${search}%,fleet_number.ilike.%${search}%,make.ilike.%${search}%,model.ilike.%${search}%`)
    if (siteFilter)   q = q.eq('site', siteFilter)
    if (statusFilter) q = q.eq('status', statusFilter)
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)

    const { data, count } = await q
    setRecords(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [page, search, siteFilter, statusFilter, activeCountry])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // ── summary cards ─────────────────────────────────────────────────────────────
  const [summary, setSummary] = useState({ total: 0, active: 0, missingSpecs: 0, noPolicy: 0 })

  useEffect(() => {
    async function loadSummary() {
      let q = supabase.from('vehicle_fleet').select('status,make,model,expected_km_per_tyre,min_days_between_changes')
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data } = await q
      const rows = data ?? []
      setSummary({
        total:        rows.length,
        active:       rows.filter(r => r.status === 'Active').length,
        missingSpecs: rows.filter(r => !r.make || !r.model).length,
        noPolicy:     rows.filter(r => !r.expected_km_per_tyre && !r.min_days_between_changes).length,
      })
    }
    loadSummary()
  }, [activeCountry, records])

  // ── add / edit ────────────────────────────────────────────────────────────────
  function openAdd() {
    setForm(EMPTY_FORM(activeCountry !== 'All' ? activeCountry : 'KSA'))
    setEditRecord({})
    setFormError('')
  }

  function openEdit(r) {
    setForm({
      asset_no:                   r.asset_no ?? '',
      fleet_number:               r.fleet_number ?? '',
      make:                       r.make ?? '',
      model:                      r.model ?? '',
      vehicle_type:               r.vehicle_type ?? '',
      year:                       r.year ?? '',
      status:                     r.status ?? 'Active',
      department:                 r.department ?? '',
      operator_name:              r.operator_name ?? '',
      site:                       r.site ?? '',
      country:                    r.country ?? 'KSA',
      expected_km_per_tyre:       r.expected_km_per_tyre ?? '',
      min_days_between_changes:   r.min_days_between_changes ?? 30,
      max_tyres_per_day:          r.max_tyres_per_day ?? 2,
      tyre_size:                  r.tyre_size ?? '',
      tyre_brand_preferred:       r.tyre_brand_preferred ?? '',
      monthly_tyre_budget:        r.monthly_tyre_budget ?? '',
      notes:                      r.notes ?? '',
    })
    setEditRecord(r)
    setFormError('')
  }

  async function saveRecord(e) {
    e.preventDefault()
    if (!form.asset_no.trim()) { setFormError('Asset No is required'); return }
    setSaving(true)
    setFormError('')
    const payload = {
      ...form,
      year:                       form.year !== '' ? +form.year : null,
      expected_km_per_tyre:       form.expected_km_per_tyre !== '' ? +form.expected_km_per_tyre : null,
      min_days_between_changes:   form.min_days_between_changes !== '' ? +form.min_days_between_changes : 30,
      max_tyres_per_day:          form.max_tyres_per_day !== '' ? +form.max_tyres_per_day : 2,
      monthly_tyre_budget:        form.monthly_tyre_budget !== '' ? +form.monthly_tyre_budget : null,
      updated_at:                 new Date().toISOString(),
      created_by:                 profile?.id,
    }
    const { error } = editRecord?.id
      ? await supabase.from('vehicle_fleet').update(payload).eq('id', editRecord.id)
      : await supabase.from('vehicle_fleet').insert(payload)

    if (error) { setFormError(error.message); setSaving(false); return }
    setEditRecord(null)
    loadRecords()
    loadSites()
    setSaving(false)
  }

  // ── delete ────────────────────────────────────────────────────────────────────
  function confirmDelete(r) {
    setDeleteTarget(r)
    setShowDeleteConfirm(true)
  }

  async function deleteRecord() {
    if (!deleteTarget) return
    setSaving(true)
    await supabase.from('vehicle_fleet').delete().eq('id', deleteTarget.id)
    setShowDeleteConfirm(false)
    setDeleteTarget(null)
    loadRecords()
    loadSites()
    setSaving(false)
  }

  // ── export ────────────────────────────────────────────────────────────────────
  async function fetchAll() {
    let q = supabase.from('vehicle_fleet').select('*').order('asset_no')
    if (search)       q = q.or(`asset_no.ilike.%${search}%,fleet_number.ilike.%${search}%,make.ilike.%${search}%,model.ilike.%${search}%`)
    if (siteFilter)   q = q.eq('site', siteFilter)
    if (statusFilter) q = q.eq('status', statusFilter)
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    const { data } = await q
    return data ?? []
  }

  function handleExport() {
    fetchAll().then(rows => {
      exportToExcel(
        rows,
        EXPORT_COLS.map(c => c.key),
        EXPORT_COLS.map(c => c.header),
        `TyrePulse_FleetMaster_${new Date().toISOString().slice(0, 10)}`,
        'Fleet Master'
      )
    })
  }

  // ── download template ─────────────────────────────────────────────────────────
  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS])
    ws['!cols'] = TEMPLATE_HEADERS.map(h => ({ wch: Math.max(h.length + 4, 18) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Fleet Master Template')
    XLSX.writeFile(wb, 'FleetMaster_Template.xlsx')
  }

  // ── bulk upload handlers ──────────────────────────────────────────────────────
  function handleUploadFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFileName(file.name)
    setUploadError('')
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (data.length < 2) { setUploadError('File is empty or has no data rows'); return }
        const headers = data[0].map(String)
        const dataRows = data.slice(1).filter(r => r.some(c => c !== ''))

        // Map rows using UPLOAD_COL_MAP
        const mapped = dataRows.map(row => {
          const obj = {}
          headers.forEach((h, i) => {
            const field = UPLOAD_COL_MAP[h]
            if (field) {
              let val = row[i]
              if (val === '' || val === null || val === undefined) {
                obj[field] = null
              } else if (['year', 'expected_km_per_tyre', 'min_days_between_changes'].includes(field)) {
                obj[field] = +val || null
              } else {
                obj[field] = String(val).trim()
              }
            }
          })
          return obj
        }).filter(r => r.asset_no)

        setUploadRows(mapped)
        setUploadPreview(mapped.slice(0, 5))
        setUploadStep('preview')
      } catch (err) {
        setUploadError('Failed to parse file: ' + err.message)
      }
    }
    reader.readAsBinaryString(file)
  }

  async function runBulkUpload() {
    setUploadStep('uploading')
    const BATCH = 200
    let upserted = 0, failed = 0
    for (let i = 0; i < uploadRows.length; i += BATCH) {
      const batch = uploadRows.slice(i, i + BATCH).map(r => ({
        ...r,
        status: r.status || 'Active',
        country: r.country || (activeCountry !== 'All' ? activeCountry : 'KSA'),
        created_by: profile?.id,
        updated_at: new Date().toISOString(),
      }))
      const { error } = await supabase
        .from('vehicle_fleet')
        .upsert(batch, { onConflict: 'asset_no' })
      if (error) failed += batch.length
      else upserted += batch.length
    }
    setUploadResult({ upserted, failed })
    setUploadStep('done')
    loadRecords()
    loadSites()
  }

  function resetUpload() {
    setUploadStep('idle')
    setUploadFileName('')
    setUploadPreview([])
    setUploadRows([])
    setUploadResult(null)
    setUploadError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function F(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  const canDelete = profile?.role === 'Admin' || profile?.role === 'Manager'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Truck size={22} className="text-green-400" /> Fleet Master
          </h1>
          <p className="text-gray-400 text-sm mt-1">{total.toLocaleString()} vehicles registered</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={15} /> Add Vehicle
          </button>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2 text-sm">
            <FileSpreadsheet size={15} className="text-green-400" /> Export Excel
          </button>
          <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={15} className="text-blue-400" /> Template
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Vehicles',   value: summary.total,        color: 'text-blue-400' },
          { label: 'Active',           value: summary.active,       color: 'text-green-400' },
          { label: 'Missing Specs',    value: summary.missingSpecs, color: 'text-yellow-400' },
          { label: 'No Policy Set',    value: summary.noPolicy,     color: 'text-orange-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-gray-400 text-sm mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 gap-1">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === i
                ? 'border-green-500 text-green-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab: Records ──────────────────────────────────────────────────── */}
      {activeTab === 0 && (
        <>
          {/* Filters */}
          <div className="card">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-48">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-9"
                  placeholder="Search asset, fleet no, make, model…"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0) }}
                />
              </div>
              <select className="input w-auto min-w-36" value={siteFilter} onChange={e => { setSiteFilter(e.target.value); setPage(0) }}>
                <option value="">All Sites</option>
                {sites.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input w-auto min-w-36" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {['Asset No', 'Fleet No', 'Make / Model', 'Type', 'Year', 'Site', 'Operator', 'Status', 'Policy', ''].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={10} className="text-center py-12 text-gray-500">Loading…</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-12 text-gray-500">No vehicles found</td></tr>
                  ) : records.map(r => (
                    <tr key={r.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="table-cell font-medium text-white font-mono text-xs">{r.asset_no ?? '—'}</td>
                      <td className="table-cell text-gray-400">{r.fleet_number ?? '—'}</td>
                      <td className="table-cell">
                        {r.make || r.model
                          ? <span className="text-gray-200">{[r.make, r.model].filter(Boolean).join(' ')}</span>
                          : <span className="text-yellow-500 text-xs">Missing</span>}
                      </td>
                      <td className="table-cell text-gray-400">{r.vehicle_type ?? '—'}</td>
                      <td className="table-cell text-gray-400">{r.year ?? '—'}</td>
                      <td className="table-cell text-gray-400">{r.site ?? '—'}</td>
                      <td className="table-cell text-gray-400 max-w-[120px] truncate">{r.operator_name ?? '—'}</td>
                      <td className="table-cell">
                        <span className={`badge ${STATUS_BADGE[r.status] ?? 'bg-gray-800 text-gray-400'}`}>{r.status ?? '—'}</span>
                      </td>
                      <td className="table-cell text-xs text-gray-500">
                        {r.min_days_between_changes ? `${r.min_days_between_changes}d` : '—'}
                        {r.expected_km_per_tyre ? ` / ${r.expected_km_per_tyre.toLocaleString()} km` : ''}
                        {!r.min_days_between_changes && !r.expected_km_per_tyre && (
                          <span className="text-orange-500 text-xs">No policy</span>
                        )}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-yellow-400 transition-colors" title="Edit">
                            <Edit2 size={15} />
                          </button>
                          {canDelete && (
                            <button onClick={() => confirmDelete(r)} className="text-gray-400 hover:text-red-400 transition-colors" title="Delete">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                <p className="text-sm text-gray-400">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary py-1.5 px-3 disabled:opacity-40"><ChevronLeft size={16} /></button>
                  <span className="text-sm text-gray-400">Page {page + 1} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-secondary py-1.5 px-3 disabled:opacity-40"><ChevronRight size={16} /></button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Tab: Bulk Upload ──────────────────────────────────────────────── */}
      {activeTab === 1 && (
        <div className="space-y-4 max-w-4xl">
          <div className="card">
            <h2 className="text-base font-semibold text-white mb-1">Bulk Upload via Excel</h2>
            <p className="text-xs text-gray-400 mb-4">
              Upload a .xlsx file with fleet vehicle data. Records are upserted on Asset No (existing records updated, new ones created).
              Download the template first to ensure correct column headers.
            </p>

            {uploadStep === 'idle' && (
              <div>
                <div
                  className="border-2 border-dashed border-gray-700 hover:border-blue-600 transition-colors cursor-pointer text-center py-12 rounded-xl"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={36} className="text-gray-500 mx-auto mb-3" />
                  <p className="text-white font-medium mb-1">Drop your .xlsx file here</p>
                  <p className="text-sm text-gray-400">or click to browse</p>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUploadFile} />
                </div>
                {uploadError && <p className="text-red-400 text-sm mt-3">{uploadError}</p>}
                <div className="mt-4">
                  <p className="text-xs text-gray-500 mb-2">Expected columns:</p>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATE_HEADERS.map(h => (
                      <span key={h} className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{h}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {uploadStep === 'preview' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm text-gray-400">
                  <FileSpreadsheet size={16} className="text-blue-400" />
                  <span>{uploadFileName}</span>
                  <span>· {uploadRows.length.toLocaleString()} rows to upsert</span>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white mb-2">Preview (first 5 rows)</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          {['asset_no', 'fleet_number', 'make', 'model', 'vehicle_type', 'year', 'site', 'status'].map(f => (
                            <th key={f} className="table-header capitalize">{f.replace(/_/g, ' ')}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {uploadPreview.map((row, i) => (
                          <tr key={i}>
                            {['asset_no', 'fleet_number', 'make', 'model', 'vehicle_type', 'year', 'site', 'status'].map(f => (
                              <td key={f} className="table-cell">{String(row[f] ?? '—')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={runBulkUpload} className="btn-primary flex items-center gap-2">
                    <Upload size={15} /> Upsert {uploadRows.length.toLocaleString()} Vehicles
                  </button>
                  <button onClick={resetUpload} className="btn-secondary">Cancel</button>
                </div>
              </div>
            )}

            {uploadStep === 'uploading' && (
              <div className="text-center py-12">
                <div className="animate-spin h-10 w-10 rounded-full border-2 border-gray-700 border-t-blue-500 mx-auto mb-4" />
                <p className="text-white font-medium">Upserting fleet records…</p>
              </div>
            )}

            {uploadStep === 'done' && uploadResult && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-green-900/50 flex items-center justify-center">
                    <FileSpreadsheet size={16} className="text-green-400" />
                  </div>
                  <h3 className="text-white font-semibold">Upload Complete</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="rounded-lg p-3 border border-green-800 bg-green-900/20">
                    <p className="text-2xl font-bold text-green-400">{uploadResult.upserted}</p>
                    <p className="text-xs text-green-300 mt-0.5">Records Upserted</p>
                  </div>
                  <div className="rounded-lg p-3 border border-red-800 bg-red-900/20">
                    <p className="text-2xl font-bold text-red-400">{uploadResult.failed}</p>
                    <p className="text-xs text-red-300 mt-0.5">Failed</p>
                  </div>
                </div>
                <button onClick={resetUpload} className="btn-secondary">Upload Another File</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ──────────────────────────────────────────────── */}
      {editRecord !== null && (
        <Modal title={editRecord.id ? 'Edit Vehicle' : 'Add Vehicle'} onClose={() => setEditRecord(null)} wide>
          {formError && (
            <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{formError}</div>
          )}
          <form onSubmit={saveRecord} className="space-y-5">

            {/* Section 1: Vehicle Identity */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Vehicle Identity</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Asset No <span className="text-red-400">*</span></label>
                  <input className="input" value={form.asset_no} onChange={F('asset_no')} required placeholder="e.g. TK-001" />
                </div>
                <div>
                  <label className="label">Fleet Number</label>
                  <input className="input" value={form.fleet_number} onChange={F('fleet_number')} placeholder="e.g. FL-2024-001" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="label">Make</label>
                  <input className="input" value={form.make} onChange={F('make')} placeholder="e.g. Toyota" />
                </div>
                <div>
                  <label className="label">Model</label>
                  <input className="input" value={form.model} onChange={F('model')} placeholder="e.g. Land Cruiser" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="label">Vehicle Type</label>
                  <input className="input" value={form.vehicle_type} onChange={F('vehicle_type')} placeholder="e.g. SUV, Truck" />
                </div>
                <div>
                  <label className="label">Year</label>
                  <input type="number" className="input" value={form.year} onChange={F('year')} placeholder="e.g. 2022" min={1990} max={2100} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input" value={form.status} onChange={F('status')}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 2: Assignment */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem' }}>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Assignment</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Department</label>
                  <input className="input" value={form.department} onChange={F('department')} placeholder="e.g. Operations" />
                </div>
                <div>
                  <label className="label">Operator Name</label>
                  <input className="input" value={form.operator_name} onChange={F('operator_name')} placeholder="Driver / Operator" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="label">Site</label>
                  <input className="input" list="fleet-site-list" value={form.site} onChange={F('site')} placeholder="Select or type…" />
                  <datalist id="fleet-site-list">{sites.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                <div>
                  <label className="label">Country</label>
                  <select className="input" value={form.country} onChange={F('country')}>
                    <option value="KSA">KSA</option>
                    <option value="UAE">UAE</option>
                    <option value="Egypt">Egypt</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Section 3: Tyre Policy */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem' }}>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Tyre Policy</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Expected KM / Tyre</label>
                  <input type="number" className="input" value={form.expected_km_per_tyre} onChange={F('expected_km_per_tyre')} placeholder="e.g. 50000" min={0} />
                </div>
                <div>
                  <label className="label">Min Days Between Changes</label>
                  <input type="number" className="input" value={form.min_days_between_changes} onChange={F('min_days_between_changes')} placeholder="e.g. 30" min={0} />
                </div>
                <div>
                  <label className="label">Max Tyres / Day</label>
                  <input type="number" className="input" value={form.max_tyres_per_day} onChange={F('max_tyres_per_day')} placeholder="e.g. 2" min={1} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="label">Tyre Size</label>
                  <input className="input" value={form.tyre_size} onChange={F('tyre_size')} placeholder="e.g. 265/70R17" />
                </div>
                <div>
                  <label className="label">Preferred Brand</label>
                  <input className="input" value={form.tyre_brand_preferred} onChange={F('tyre_brand_preferred')} placeholder="e.g. Michelin" />
                </div>
                <div>
                  <label className="label">Monthly Tyre Budget ({activeCurrency})</label>
                  <input type="number" className="input" value={form.monthly_tyre_budget} onChange={F('monthly_tyre_budget')} placeholder="e.g. 5000" min={0} />
                </div>
              </div>
              <div className="mt-3">
                <label className="label">Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={F('notes')} placeholder="Any additional notes…" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                <Save size={15} /> {saving ? 'Saving…' : 'Save Vehicle'}
              </button>
              <button type="button" onClick={() => setEditRecord(null)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Delete Confirmation ───────────────────────────────────────────── */}
      {showDeleteConfirm && deleteTarget && (
        <Modal title="Delete Vehicle" onClose={() => { setShowDeleteConfirm(false); setDeleteTarget(null) }}>
          <div className="flex gap-3 mb-4">
            <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-white font-medium">Delete vehicle <span className="font-mono text-blue-400">{deleteTarget.asset_no}</span>?</p>
              <p className="text-gray-400 text-sm mt-1">This removes the fleet record permanently. Tyre history records for this asset are not affected.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={deleteRecord} disabled={saving} className="btn-danger flex items-center gap-2 disabled:opacity-50">
              <Trash2 size={15} /> {saving ? 'Deleting…' : 'Delete Vehicle'}
            </button>
            <button onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null) }} className="btn-secondary">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Shared modal shell ─────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide = false }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={`bg-gray-900 border border-gray-700 rounded-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} p-6 my-4`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
