import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel } from '../lib/exportUtils'
import { sanitizeSearchTerm } from '../lib/searchFilter'
import { canAddResource } from '../lib/api/billing'
import {
  Search, Plus, Edit2, Trash2, Save, X, AlertTriangle,
  FileSpreadsheet, Download, Upload, Truck, ClipboardCheck
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { Illustration } from '../components/illustrations'
import { vehicleArt } from '../lib/brand/vehicleArt'
import { useReportMeta } from '../hooks/useReportMeta'
import PageHeader from '../components/ui/PageHeader'
import CustomFieldsPanel from '../components/CustomFieldsPanel'

const DEFAULT_PAGE_SIZE = 25

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
  'Fleet No':              'fleet_number',
  'Make':                  'make',
  'Model':                 'model',
  'Vehicle Type':          'vehicle_type',
  'Year':                  'year',
  'Operator':              'operator_name',
  'Site':                  'site',
  'Country':               'country',
  'Department':            'department',
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
const TABS = ['records', 'bulkUpload']

export default function FleetMaster() {
  const reportMeta = useReportMeta('Fleet Master')
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const { t } = useLanguage()

  // ── data ─────────────────────────────────────────────────────────────────────
  const [records, setRecords]   = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading]   = useState(true)
  const [sites, setSites]       = useState([])

  // ── filters ──────────────────────────────────────────────────────────────────
  const [search, setSearch]         = useState('')
  // Debounced copy that actually drives the query, so we don't fire a Supabase
  // request on every keystroke (was one round-trip per character).
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  // Monotonic request id: only the newest loadRecords() response is applied, so a
  // slow earlier query can't overwrite a faster later one (out-of-order race).
  const reqIdRef = useRef(0)

  // ── modal state ──────────────────────────────────────────────────────────────
  const [editRecord, setEditRecord]           = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget]       = useState(null)
  const [saving, setSaving]                   = useState(false)
  const [formError, setFormError]             = useState('')
  const [atLimit, setAtLimit]                 = useState(false)
  const [deleteError, setDeleteError]         = useState('')
  const [form, setForm]                       = useState(() => EMPTY_FORM())

  // ── multi-select bulk delete (Admin only) ─────────────────────────────────────
  const isAdmin = (profile?.role || '').toLowerCase() === 'admin'
  // TanStack-style selection map ({ [rowId]: true }); persists across pages.
  const [rowSelection, setRowSelection]       = useState({})
  const selectedIds = useMemo(() => new Set(Object.keys(rowSelection)), [rowSelection])
  const [bulkDeleteOpen, setBulkDeleteOpen]   = useState(false)
  const [bulkError, setBulkError]             = useState('')
  const [bulkBusy, setBulkBusy]               = useState(false)

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
  // Debounce the search box: reset to page 0 and reload 300ms after typing stops.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => { loadRecords() }, [page, pageSize, debouncedSearch, siteFilter, statusFilter, activeCountry])

  async function loadSites() {
    const { data } = await supabase.from('vehicle_fleet').select('site').not('site', 'is', null)
    setSites([...new Set((data ?? []).map(r => r.site))].sort())
  }

  const loadRecords = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    let q = supabase
      .from('vehicle_fleet')
      .select('*', { count: 'exact' })
      .order('asset_no', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (debouncedSearch) { const s = sanitizeSearchTerm(debouncedSearch); q = q.or(`asset_no.ilike.%${s}%,fleet_number.ilike.%${s}%,make.ilike.%${s}%,model.ilike.%${s}%`) }
    if (siteFilter)   q = q.eq('site', siteFilter)
    if (statusFilter) q = q.eq('status', statusFilter)
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)

    try {
      const { data, count } = await q
      if (myReq !== reqIdRef.current) return   // a newer request superseded this one
      setRecords(data ?? [])
      setTotal(count ?? 0)
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [page, pageSize, debouncedSearch, siteFilter, statusFilter, activeCountry])

  const totalPages = Math.ceil(total / pageSize)

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
  async function openAdd() {
    setForm(EMPTY_FORM(activeCountry !== 'All' ? activeCountry : 'KSA'))
    setEditRecord({})
    setFormError('')
    // Proactively surface a reached plan cap so the Save button is disabled with a
    // visible reason, instead of appearing active and silently failing on submit.
    setAtLimit(false)
    try { if (!(await canAddResource('vehicles'))) setAtLimit(true) } catch { /* fail open */ }
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
    setAtLimit(false)  // edits never add to the count
  }

  async function saveRecord(e) {
    e.preventDefault()
    if (!form.asset_no.trim()) { setFormError(t('fleetmaster.form.required')); return }
    setSaving(true)
    setFormError('')

    // Plan entitlement: only gate NEW vehicles (edits never add to the count).
    // Server-authoritative via org_can_add(); fails open on any RPC error so a
    // transient failure never blocks a legitimate edit/create.
    if (!editRecord?.id) {
      const allowed = await canAddResource('vehicles')
      if (!allowed) {
        setFormError(t('fleetmaster.form.planLimit'))
        setSaving(false)
        return
      }
    }

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
    setDeleteError('')
    try {
      const { data, error } = await supabase
        .from('vehicle_fleet').delete().eq('id', deleteTarget.id).select('id')
      if (error) throw error
      if ((data?.length ?? 0) === 0) {
        throw new Error(t('fleetmaster.delete.errNoPermission'))
      }
      setShowDeleteConfirm(false)
      setDeleteTarget(null)
      loadRecords()
      loadSites()
    } catch (e) {
      setDeleteError(e.message || t('fleetmaster.delete.errFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function confirmBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkBusy(true)
    setBulkError('')
    try {
      const ids = [...selectedIds]
      let deleted = 0
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const { data, error } = await supabase
          .from('vehicle_fleet').delete().in('id', chunk).select('id')
        if (error) throw error
        deleted += data?.length ?? 0
      }
      if (deleted === 0) {
        throw new Error(t('fleetmaster.bulkDelete.errNoPermission'))
      }
      setBulkDeleteOpen(false)
      setRowSelection({})
      loadRecords()
      loadSites()
    } catch (e) {
      setBulkError(e.message || t('fleetmaster.bulkDelete.errFailed'))
    } finally {
      setBulkBusy(false)
    }
  }

  // ── export ────────────────────────────────────────────────────────────────────
  async function fetchAll() {
    const { data } = await fetchAllPages((from, to) => {
      let q = supabase.from('vehicle_fleet').select('*').order('asset_no').order('id').range(from, to)
      if (search)       { const s = sanitizeSearchTerm(search); q = q.or(`asset_no.ilike.%${s}%,fleet_number.ilike.%${s}%,make.ilike.%${s}%,model.ilike.%${s}%`) }
      if (siteFilter)   q = q.eq('site', siteFilter)
      if (statusFilter) q = q.eq('status', statusFilter)
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      return q
    })
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
  async function downloadTemplate() {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS])
    ws['!cols'] = TEMPLATE_HEADERS.map(h => ({ wch: Math.max(h.length + 4, 18) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Fleet Master Template')
    XLSX.writeFile(wb, 'FleetMaster_Template.xlsx')
  }

  // ── bulk upload handlers ──────────────────────────────────────────────────────
  async function handleUploadFile(e) {
    const XLSX = await import('xlsx')
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
        if (data.length < 2) { setUploadError(t('fleetmaster.upload.errEmpty')); return }
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
        setUploadError(t('fleetmaster.upload.errParseFailed', { message: err.message }))
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
    setPage(0)
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

  // ── EnterpriseTable column definitions (TanStack v8) ─────────────────────────
  const tableColumns = useMemo(() => [
    {
      accessorKey: 'asset_no',
      header: t('fleetmaster.columns.assetNo'),
      cell: ({ getValue }) => (
        <span className="font-medium text-[var(--text-primary)] font-mono text-xs">{getValue() ?? '-'}</span>
      ),
    },
    {
      accessorKey: 'fleet_number',
      header: t('fleetmaster.columns.fleetNo'),
      cell: ({ getValue }) => getValue() ?? '-',
    },
    {
      id: 'make_model',
      accessorFn: r => [r.make, r.model].filter(Boolean).join(' '),
      header: t('fleetmaster.columns.makeModel'),
      cell: ({ row }) => {
        const r = row.original
        return r.make || r.model
          ? <span>{[r.make, r.model].filter(Boolean).join(' ')}</span>
          : <span className="text-yellow-500 text-xs">{t('fleetmaster.table.missing')}</span>
      },
    },
    {
      accessorKey: 'vehicle_type',
      header: t('fleetmaster.columns.type'),
      cell: ({ getValue }) => {
        const type = getValue()
        return (
          <span className="flex items-center gap-2">
            <Illustration
              name={vehicleArt(type)}
              size={32}
              title={type || 'Vehicle'}
              className="shrink-0 opacity-80"
            />
            <span>{type ?? '-'}</span>
          </span>
        )
      },
    },
    {
      accessorKey: 'year',
      header: t('fleetmaster.columns.year'),
      cell: ({ getValue }) => getValue() ?? '-',
    },
    {
      accessorKey: 'site',
      header: t('fleetmaster.columns.site'),
      cell: ({ getValue }) => getValue() ?? '-',
    },
    {
      accessorKey: 'operator_name',
      header: t('fleetmaster.columns.operator'),
      cell: ({ getValue }) => (
        <span className="block max-w-[120px] truncate">{getValue() ?? '-'}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: t('fleetmaster.columns.status'),
      cell: ({ getValue }) => {
        const status = getValue()
        return (
          <span className={`badge ${STATUS_BADGE[status] ?? 'bg-gray-800 text-gray-400'}`}>{status ?? '-'}</span>
        )
      },
    },
    {
      id: 'policy',
      header: t('fleetmaster.columns.policy'),
      enableSorting: false,
      accessorFn: r => [
        r.min_days_between_changes ? `${r.min_days_between_changes}d` : '',
        r.expected_km_per_tyre ? `${r.expected_km_per_tyre.toLocaleString()} km` : '',
      ].filter(Boolean).join(' / '),
      cell: ({ row }) => {
        const r = row.original
        return (
          <span className="text-xs text-gray-500">
            {r.min_days_between_changes ? `${r.min_days_between_changes}d` : '-'}
            {r.expected_km_per_tyre ? ` / ${r.expected_km_per_tyre.toLocaleString()} km` : ''}
            {!r.min_days_between_changes && !r.expected_km_per_tyre && (
              <span className="text-orange-500 text-xs">{t('fleetmaster.table.noPolicy')}</span>
            )}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center gap-2">
            <button onClick={() => navigate(`/vehicle/${encodeURIComponent(r.asset_no)}`)} className="text-gray-400 hover:text-[var(--accent)] transition-colors" title="Open Vehicle 360">
              <Truck size={15} />
            </button>
            <button onClick={() => navigate(`/inspections?asset=${encodeURIComponent(r.asset_no)}`)} className="text-gray-400 hover:text-green-400 transition-colors" title={t('fleetmaster.table.startChecklist')}>
              <ClipboardCheck size={15} />
            </button>
            <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-yellow-400 transition-colors" title={t('fleetmaster.table.edit')}>
              <Edit2 size={15} />
            </button>
            {canDelete && (
              <button onClick={() => confirmDelete(r)} className="text-gray-400 hover:text-red-400 transition-colors" title={t('fleetmaster.table.delete')}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )
      },
    },
  ], [t, canDelete, navigate]) // openEdit/confirmDelete are stable page-level functions

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('fleetmaster.title')}
        subtitle={t('fleetmaster.subtitle', { count: total.toLocaleString() })}
        icon={Truck}
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => navigate('/data-intake?module=fleet')}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Upload size={15} /> {t('fleetmaster.actions.importDataIntake')}
          </button>
          <button onClick={openAdd} className="btn-secondary flex items-center gap-2 text-sm">
            <Plus size={15} /> {t('fleetmaster.actions.addVehicle')}
          </button>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2 text-sm">
            <FileSpreadsheet size={15} className="text-green-400" /> {t('fleetmaster.actions.exportExcel')}
          </button>
          <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={15} className="text-blue-400" /> {t('fleetmaster.actions.template')}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('fleetmaster.summary.totalVehicles'), value: summary.total,        color: 'text-blue-400' },
          { label: t('fleetmaster.summary.active'),        value: summary.active,       color: 'text-green-400' },
          { label: t('fleetmaster.summary.missingSpecs'),  value: summary.missingSpecs, color: 'text-yellow-400' },
          { label: t('fleetmaster.summary.noPolicySet'),   value: summary.noPolicy,     color: 'text-orange-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-gray-400 text-sm mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 gap-1">
        {TABS.map((tabKey, i) => (
          <button
            key={tabKey}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === i
                ? 'border-green-500 text-green-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t(`fleetmaster.tabs.${tabKey}`)}
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
                  placeholder={t('fleetmaster.filters.searchPlaceholder')}
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(0) }}
                />
              </div>
              <select className="input w-auto min-w-36" value={siteFilter} onChange={e => { setSiteFilter(e.target.value); setPage(0) }}>
                <option value="">{t('fleetmaster.filters.allSites')}</option>
                {sites.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="input w-auto min-w-36" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
                <option value="">{t('fleetmaster.filters.allStatuses')}</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Bulk selection bar (Admin only) */}
          {isAdmin && selectedIds.size > 0 && (
            <div className="flex items-center justify-between gap-3 bg-blue-950/30 border border-blue-800/50 rounded-xl px-4 py-2.5">
              <span className="text-sm text-blue-200">{t('fleetmaster.bulkBar.selected', { count: selectedIds.size })}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setRowSelection({})} className="text-xs text-gray-400 hover:text-white px-2 py-1">{t('fleetmaster.bulkBar.clear')}</button>
                <button onClick={() => { setBulkError(''); setBulkDeleteOpen(true) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">
                  <Trash2 size={14} /> {t('fleetmaster.bulkBar.delete', { count: selectedIds.size })}
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <EnterpriseTable
            reportMeta={reportMeta}
            columns={tableColumns}
            data={records}
            getRowId={r => String(r.id)}
            loading={loading}
            emptyMessage={t('fleetmaster.table.noVehicles')}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableRowSelection={isAdmin}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            manualPagination
            pageIndex={page}
            pageCount={totalPages}
            totalRows={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={size => { setPageSize(size); setPage(0) }}
            paginationLabel={({ from, to, total: totalCount }) =>
              t('fleetmaster.pagination.showing', { from, to, total: totalCount.toLocaleString() })}
            exportFileName={`TyrePulse_FleetMaster_${new Date().toISOString().slice(0, 10)}`}
          />
        </>
      )}

      {/* ── Tab: Bulk Upload ──────────────────────────────────────────────── */}
      {activeTab === 1 && (
        <div className="space-y-4 max-w-4xl">
          <div className="card">
            <h2 className="text-base font-semibold text-white mb-1">{t('fleetmaster.upload.heading')}</h2>
            <p className="text-xs text-gray-400 mb-4">
              {t('fleetmaster.upload.description')}
            </p>
            <p className="text-xs text-gray-500 mb-4">
              {t('fleetmaster.upload.intakeCenterPrefix')}{' '}
              <button
                type="button"
                onClick={() => navigate('/data-intake?module=fleet')}
                className="text-green-400 hover:text-green-300 underline underline-offset-2"
              >
                {t('fleetmaster.upload.intakeCenterLink')}
              </button>{' '}
              {t('fleetmaster.upload.intakeCenterSuffix')}
            </p>

            {uploadStep === 'idle' && (
              <div>
                <div
                  className="border-2 border-dashed border-gray-700 hover:border-blue-600 transition-colors cursor-pointer text-center py-12 rounded-xl"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={36} className="text-gray-500 mx-auto mb-3" />
                  <p className="text-white font-medium mb-1">{t('fleetmaster.upload.dropHere')}</p>
                  <p className="text-sm text-gray-400">{t('fleetmaster.upload.orBrowse')}</p>
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUploadFile} />
                </div>
                {uploadError && <p className="text-red-400 text-sm mt-3">{uploadError}</p>}
                <div className="mt-4">
                  <p className="text-xs text-gray-500 mb-2">{t('fleetmaster.upload.expectedColumns')}</p>
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
                  <span>· {t('fleetmaster.upload.rowsToUpsert', { count: uploadRows.length.toLocaleString() })}</span>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white mb-2">{t('fleetmaster.upload.previewTitle')}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          {['asset_no', 'fleet_number', 'make', 'model', 'vehicle_type', 'year', 'site', 'status'].map(f => (
                            <th key={f} className="table-header capitalize">{t(`fleetmaster.upload.previewCols.${f}`)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {uploadPreview.map((row, i) => (
                          <tr key={i}>
                            {['asset_no', 'fleet_number', 'make', 'model', 'vehicle_type', 'year', 'site', 'status'].map(f => (
                              <td key={f} className="table-cell">{String(row[f] ?? '-')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={runBulkUpload} className="btn-primary flex items-center gap-2">
                    <Upload size={15} /> {t('fleetmaster.upload.upsertVehicles', { count: uploadRows.length.toLocaleString() })}
                  </button>
                  <button onClick={resetUpload} className="btn-secondary">{t('fleetmaster.upload.cancel')}</button>
                </div>
              </div>
            )}

            {uploadStep === 'uploading' && (
              <div className="text-center py-12">
                <div className="animate-spin h-10 w-10 rounded-full border-2 border-gray-700 border-t-blue-500 mx-auto mb-4" />
                <p className="text-white font-medium">{t('fleetmaster.upload.uploading')}</p>
              </div>
            )}

            {uploadStep === 'done' && uploadResult && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-green-900/50 flex items-center justify-center">
                    <FileSpreadsheet size={16} className="text-green-400" />
                  </div>
                  <h3 className="text-white font-semibold">{t('fleetmaster.upload.complete')}</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="rounded-lg p-3 border border-green-800 bg-green-900/20">
                    <p className="text-2xl font-bold text-green-400">{uploadResult.upserted}</p>
                    <p className="text-xs text-green-300 mt-0.5">{t('fleetmaster.upload.recordsUpserted')}</p>
                  </div>
                  <div className="rounded-lg p-3 border border-red-800 bg-red-900/20">
                    <p className="text-2xl font-bold text-red-400">{uploadResult.failed}</p>
                    <p className="text-xs text-red-300 mt-0.5">{t('fleetmaster.upload.failed')}</p>
                  </div>
                </div>
                <button onClick={resetUpload} className="btn-secondary">{t('fleetmaster.upload.uploadAnother')}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ──────────────────────────────────────────────── */}
      {editRecord !== null && (
        <Modal title={editRecord.id ? t('fleetmaster.form.editTitle') : t('fleetmaster.form.addTitle')} onClose={() => setEditRecord(null)} wide>
          {formError && (
            <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{formError}</div>
          )}
          <form onSubmit={saveRecord} className="space-y-5">

            {/* Section 1: Vehicle Identity */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">{t('fleetmaster.form.sectionIdentity')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('fleetmaster.form.assetNo')} <span className="text-red-400">*</span></label>
                  <input className="input" value={form.asset_no} onChange={F('asset_no')} required placeholder={t('fleetmaster.form.placeholders.assetNo')} />
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.fleetNumber')}</label>
                  <input className="input" value={form.fleet_number} onChange={F('fleet_number')} placeholder={t('fleetmaster.form.placeholders.fleetNumber')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="label">{t('fleetmaster.form.make')}</label>
                  <input className="input" value={form.make} onChange={F('make')} placeholder={t('fleetmaster.form.placeholders.make')} />
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.model')}</label>
                  <input className="input" value={form.model} onChange={F('model')} placeholder={t('fleetmaster.form.placeholders.model')} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="label">{t('fleetmaster.form.vehicleType')}</label>
                  <input className="input" value={form.vehicle_type} onChange={F('vehicle_type')} placeholder={t('fleetmaster.form.placeholders.vehicleType')} />
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.year')}</label>
                  <input type="number" className="input" value={form.year} onChange={F('year')} placeholder={t('fleetmaster.form.placeholders.year')} min={1990} max={2100} />
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.status')}</label>
                  <select className="input" value={form.status} onChange={F('status')}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 2: Assignment */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem' }}>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">{t('fleetmaster.form.sectionAssignment')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('fleetmaster.form.department')}</label>
                  <input className="input" value={form.department} onChange={F('department')} placeholder={t('fleetmaster.form.placeholders.department')} />
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.operatorName')}</label>
                  <input className="input" value={form.operator_name} onChange={F('operator_name')} placeholder={t('fleetmaster.form.placeholders.operatorName')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="label">{t('fleetmaster.form.site')}</label>
                  <input className="input" list="fleet-site-list" value={form.site} onChange={F('site')} placeholder={t('fleetmaster.form.placeholders.site')} />
                  <datalist id="fleet-site-list">{sites.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.country')}</label>
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
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">{t('fleetmaster.form.sectionPolicy')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label">{t('fleetmaster.form.expectedKmPerTyre')}</label>
                  <input type="number" className="input" value={form.expected_km_per_tyre} onChange={F('expected_km_per_tyre')} placeholder={t('fleetmaster.form.placeholders.expectedKm')} min={0} />
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.minDaysBetweenChanges')}</label>
                  <input type="number" className="input" value={form.min_days_between_changes} onChange={F('min_days_between_changes')} placeholder={t('fleetmaster.form.placeholders.minDays')} min={0} />
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.maxTyresPerDay')}</label>
                  <input type="number" className="input" value={form.max_tyres_per_day} onChange={F('max_tyres_per_day')} placeholder={t('fleetmaster.form.placeholders.maxTyres')} min={1} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="label">{t('fleetmaster.form.tyreSize')}</label>
                  <input className="input" value={form.tyre_size} onChange={F('tyre_size')} placeholder={t('fleetmaster.form.placeholders.tyreSize')} />
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.preferredBrand')}</label>
                  <input className="input" value={form.tyre_brand_preferred} onChange={F('tyre_brand_preferred')} placeholder={t('fleetmaster.form.placeholders.brand')} />
                </div>
                <div>
                  <label className="label">{t('fleetmaster.form.monthlyBudget', { currency: activeCurrency })}</label>
                  <input type="number" className="input" value={form.monthly_tyre_budget} onChange={F('monthly_tyre_budget')} placeholder={t('fleetmaster.form.placeholders.budget')} min={0} />
                </div>
              </div>
              <div className="mt-3">
                <label className="label">{t('fleetmaster.form.notes')}</label>
                <textarea className="input" rows={2} value={form.notes} onChange={F('notes')} placeholder={t('fleetmaster.form.placeholders.notes')} />
              </div>
            </div>

            {editRecord.id && (
              <CustomFieldsPanel data={editRecord.custom_data} title={t('fleetmaster.form.customFieldsTitle')} />
            )}

            {atLimit && !editRecord.id && (
              <div className="bg-amber-900/30 border border-amber-700 text-amber-300 rounded-lg px-4 py-2 text-sm">
                {t('fleetmaster.form.planLimit')}
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving || (atLimit && !editRecord.id)} className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <Save size={15} /> {saving ? t('fleetmaster.form.saving') : t('fleetmaster.form.save')}
              </button>
              <button type="button" onClick={() => setEditRecord(null)} className="btn-secondary">{t('fleetmaster.form.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Delete Confirmation ───────────────────────────────────────────── */}
      {showDeleteConfirm && deleteTarget && (
        <Modal title={t('fleetmaster.delete.title')} onClose={() => { setShowDeleteConfirm(false); setDeleteTarget(null); setDeleteError('') }}>
          <div className="flex gap-3 mb-4">
            <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[var(--text-primary)] font-medium">{t('fleetmaster.delete.question', { assetNo: deleteTarget.asset_no })}</p>
              <p className="text-gray-400 text-sm mt-1">{t('fleetmaster.delete.warning')}</p>
            </div>
          </div>
          {deleteError && (
            <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{deleteError}</p>
          )}
          <div className="flex gap-3">
            <button onClick={deleteRecord} disabled={saving} className="btn-danger flex items-center gap-2 disabled:opacity-50">
              <Trash2 size={15} /> {saving ? t('fleetmaster.delete.deleting') : t('fleetmaster.delete.confirm')}
            </button>
            <button onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); setDeleteError('') }} className="btn-secondary">{t('fleetmaster.delete.cancel')}</button>
          </div>
        </Modal>
      )}

      {/* ── Bulk Delete Confirmation (Admin only) ─────────────────────────── */}
      {bulkDeleteOpen && (
        <Modal title={t('fleetmaster.bulkDelete.title')} onClose={() => { if (!bulkBusy) { setBulkDeleteOpen(false); setBulkError('') } }}>
          <div className="flex gap-3 mb-4">
            <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[var(--text-primary)] font-medium">{t('fleetmaster.bulkDelete.question', { count: selectedIds.size })}</p>
              <p className="text-gray-400 text-sm mt-1">{t('fleetmaster.bulkDelete.warning')}</p>
            </div>
          </div>
          {bulkError && (
            <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{bulkError}</p>
          )}
          <div className="flex gap-3">
            <button onClick={confirmBulkDelete} disabled={bulkBusy} className="btn-danger flex items-center gap-2 disabled:opacity-50">
              <Trash2 size={15} /> {bulkBusy ? t('fleetmaster.bulkDelete.deleting') : t('fleetmaster.bulkDelete.confirm', { count: selectedIds.size })}
            </button>
            <button onClick={() => { setBulkDeleteOpen(false); setBulkError('') }} disabled={bulkBusy} className="btn-secondary">{t('fleetmaster.bulkDelete.cancel')}</button>
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
        className={`bg-surface-1 border border-[var(--border-dim)] rounded-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} p-6 my-4 shadow-float`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-[var(--text-primary)] transition-colors"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
