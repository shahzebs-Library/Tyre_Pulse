import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, Plus, Search, X, Save, FileText, Download, BarChart2, Eye, Hourglass, Upload, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import AccidentDetailModal from '../components/AccidentDetailModal'
import * as accidentsApi from '../lib/api/accidents'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrency as _fmtCurrencyBase, formatDate, formatMonthYear } from '../lib/formatters'
import { resolveStorageUrl } from '../lib/storageRefs'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip as ChartTooltip, Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, ChartTooltip, Legend)

const BULK_TEMPLATE_COLS = [
  'incident_date',
  'asset_no',
  'site',
  'country',
  'location',
  'liability',
  'case_stage',
  'damage_condition',
  'current_status',
  'action_to_be_taken',
  'responsible_owner',
  'required_action',
  'status_update_date',
  'expected_release_date',
  'description',
  'severity',
  'status',
  'repair_cost',
  'insurance_claim_no',
  'inspector',
]

const BULK_TEMPLATE_EXAMPLE = [
  '2026-06-01', 'TM-001', 'Riyadh', 'KSA', 'GCC Plant',
  '100% Third Party Liability', 'Internal Report Preparation', 'Major Repair',
  'Under Repair', 'Awaiting insurance approval', 'Ms. Fatima',
  'Submit repair invoice', '2026-06-10', '2026-06-20',
  'Rear collision at depot', 'Minor', 'Reported',
  '5000', 'CLM-2026-001', 'John Doe',
]

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

// Mobile writes lowercase values (minor/severe, reported/closed); the web form
// writes title-case. Canonicalise both vocabularies so badges & stats are correct.
const SEVERITY_ALIAS = { minor: 'Minor', moderate: 'Major', major: 'Major', severe: 'Total Loss', fatal: 'Total Loss', 'total loss': 'Total Loss' }
const STATUS_ALIAS = { reported: 'Reported', under_review: 'Under Investigation', under_investigation: 'Under Investigation', closed: 'Closed' }
const canonSeverity = (s) => SEVERITY_ALIAS[String(s || '').toLowerCase()] || s || ''
const canonStatus = (s) => STATUS_ALIAS[String(s || '').toLowerCase().replace(/\s+/g, '_')] || s || ''
const isClosed = (r) => r.closure_status === 'closed' || canonStatus(r.status) === 'Closed'

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

const CHART_OPTS_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: 'var(--panel-2)', titlecolor:'var(--panel-ink)', bodyColor: '#9ca3af', borderColor: 'var(--hairline)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: '#374151' }, beginAtZero: true },
  },
}

const CHART_OPTS_H = {
  ...CHART_OPTS_BASE,
  indexAxis: 'y',
  plugins: {
    ...CHART_OPTS_BASE.plugins,
    legend: { display: false },
  },
}

const CHART_OPTS_STACKED = {
  ...CHART_OPTS_BASE,
  plugins: {
    ...CHART_OPTS_BASE.plugins,
    legend: { display: true, labels: { color: '#9ca3af', font: { size: 11 } } },
  },
  scales: {
    x: { ...CHART_OPTS_BASE.scales.x, stacked: true },
    y: { ...CHART_OPTS_BASE.scales.y, stacked: true },
  },
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
  return formatMonthYear(d)
}

export default function Accidents() {
  const { profile } = useAuth()
  const { activeCountry, activeCurrency, appSettings } = useSettings()
  const fmtCurrency = (val) => _fmtCurrencyBase(val, activeCurrency, 0)
  const navigate = useNavigate()

  const [tab, setTab]                  = useState('incidents')
  const [records, setRecords]          = useState([])
  const [loading, setLoading]          = useState(true)
  const [error, setError]              = useState('')
  const [showModal, setShowModal]      = useState(false)
  const [editId, setEditId]            = useState(null)
  const [saving, setSaving]            = useState(false)
  const [formError, setFormError]      = useState('')
  const [form, setForm]                = useState(EMPTY_FORM)

  const [search, setSearch]                    = useState('')
  const [filterSite, setFilterSite]            = useState('')
  const [filterSeverity, setFilterSeverity]    = useState('')
  const [filterStatus, setFilterStatus]        = useState('')
  const [filterFrom, setFilterFrom]            = useState('')
  const [filterTo, setFilterTo]                = useState('')
  const [statusFunnel, setStatusFunnel]        = useState('')
  const [onlyPendingClosure, setOnlyPendingClosure] = useState(false)
  const [detailId, setDetailId]                = useState(null)

  // Asset search combobox
  const [fleetAssets, setFleetAssets]          = useState([])
  const [assetQuery, setAssetQuery]            = useState('')
  const [showAssetDrop, setShowAssetDrop]      = useState(false)
  const assetDropRef                           = useRef(null)

  // Bulk upload
  const [showBulk, setShowBulk]               = useState(false)
  const [bulkRows, setBulkRows]               = useState([])
  const [bulkFile, setBulkFile]               = useState(null)
  const [bulkImporting, setBulkImporting]     = useState(false)
  const [bulkResult, setBulkResult]           = useState(null) // { added, skipped, errors[] }
  const bulkInputRef                          = useRef(null)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    // Paginate past the 1000-row cap so the list AND its exports are complete.
    const { data, error: err } = await accidentsApi.listAllAccidentsForPage({ country: activeCountry })
    if (err) setError(err.message)
    else setRecords(data ?? [])
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { loadRecords() }, [loadRecords])

  // Load fleet assets for search combobox
  useEffect(() => {
    accidentsApi.listAccidentFleet()
      .then((data) => setFleetAssets(data ?? []))
      .catch(() => setFleetAssets([]))
  }, [])

  // Close asset dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (assetDropRef.current && !assetDropRef.current.contains(e.target)) setShowAssetDrop(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const assetSuggestions = useMemo(() => {
    if (!assetQuery.trim()) return []
    const q = assetQuery.toLowerCase()
    return fleetAssets.filter(a =>
      a.asset_no?.toLowerCase().includes(q) ||
      a.vehicle_type?.toLowerCase().includes(q) ||
      a.site?.toLowerCase().includes(q)
    ).slice(0, 10)
  }, [assetQuery, fleetAssets])

  function selectAsset(asset) {
    setForm(f => ({
      ...f,
      asset_no: asset.asset_no,
      site:     asset.site     || f.site,
      country:  asset.country  || f.country,
    }))
    setAssetQuery(asset.asset_no)
    setShowAssetDrop(false)
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([BULK_TEMPLATE_COLS, BULK_TEMPLATE_EXAMPLE])
    // Column widths
    ws['!cols'] = BULK_TEMPLATE_COLS.map(() => ({ wch: 22 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Accidents Template')
    XLSX.writeFile(wb, 'TyrePulse_Accidents_Template.xlsx')
  }

  function parseBulkFile(file) {
    setBulkFile(file)
    setBulkResult(null)
    const reader = new FileReader()
    reader.onload = async e => {
      const XLSX = await import('xlsx')
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })

        const toISO = (val) => {
          if (val === '' || val === null || val === undefined) return ''
          if (val instanceof Date) return val.toISOString().split('T')[0]
          if (typeof val === 'number') {
            const d = XLSX.SSF.parse_date_code(val)
            return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : ''
          }
          return String(val).trim()
        }
        const txt = (v) => { const s = String(v ?? '').trim(); return s || null }

        const rows = raw.map((r, i) => {
          // Normalise headers: lowercase, collapse any non-alphanumeric to '_'
          const norm = {}
          Object.entries(r).forEach(([k, v]) => {
            const key = String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
            if (key) norm[key] = v
          })
          const pick = (...keys) => { for (const k of keys) { if (norm[k] !== undefined && norm[k] !== '') return norm[k] } return '' }

          const incident_date = toISO(pick('incident_date', 'accident_date', 'date'))
          const asset_no = String(pick('asset_no', 'assets_no', 'asset', 'asset_number', 'vehicle', 'vehicle_no', 'plate') || '').trim()

          return {
            _row: i + 2,
            _valid: !!(incident_date && asset_no),
            incident_date,
            asset_no,
            site:                 txt(pick('site', 'branch', 'plant')),
            country:              txt(pick('country')),
            location:             txt(pick('location')),
            description:          txt(pick('description', 'remarks')),
            severity:             pick('severity') || 'Minor',
            status:               pick('status') || 'Reported',
            repair_cost:          pick('repair_cost') !== '' ? (Number(pick('repair_cost')) || null) : null,
            estimated_damage_cost: pick('estimated_damage_cost', 'estimated_cost') !== '' ? (Number(pick('estimated_damage_cost', 'estimated_cost')) || null) : null,
            liable_party:         txt(pick('liable_party', 'liability', 'liable')),
            insurer:              txt(pick('insurer')),
            policy_no:            txt(pick('policy_no', 'insurance_claim_no', 'claim_no')),
            inspector:            txt(pick('inspector')),
            // ── Claims tracker fields ──
            case_stage:           txt(pick('case_stage', 'current_case_stage', 'stage')),
            damage_condition:     txt(pick('damage_condition')),
            current_status:       txt(pick('current_status')),
            action_to_be_taken:   txt(pick('action_to_be_taken', 'action')),
            responsible_owner:    txt(pick('responsible_owner', 'owner', 'responsible')),
            required_action:      txt(pick('required_action')),
            status_update_date:   toISO(pick('status_update_date', 'status_update')) || null,
            expected_release_date: toISO(pick('expected_release_date', 'expected_release')) || null,
          }
        })
        setBulkRows(rows)
      } catch (err) {
        setBulkResult({ added: 0, skipped: 0, errors: [`Parse error: ${err.message}`] })
      }
    }
    reader.readAsBinaryString(file)
  }

  async function importBulk() {
    const valid = bulkRows.filter(r => r._valid)
    if (!valid.length) return
    setBulkImporting(true)
    setBulkResult(null)
    const payload = valid.map(({ _row, _valid, ...r }) => ({ ...r, created_by: profile?.id }))
    const { error: err } = await accidentsApi.createAccidentForPage(payload)
    const skipped = bulkRows.filter(r => !r._valid).length
    if (err) {
      setBulkResult({ added: 0, skipped, errors: [err.message] })
    } else {
      setBulkResult({ added: valid.length, skipped, errors: [] })
      loadRecords()
    }
    setBulkImporting(false)
  }

  const sites = useMemo(() => [...new Set(records.map(r => r.site).filter(Boolean))].sort(), [records])

  const stats = useMemo(() => {
    const total  = records.length
    const open   = records.filter(r => !isClosed(r)).length
    const insur  = records.filter(r => canonStatus(r.status) === 'Insurance Claim' || (r.claim_status && r.claim_status !== 'none')).length
    const cost   = records.reduce((s, r) => s + (Number(r.repair_cost) || 0) + (Number(r.parts_cost) || 0), 0)
    const closed = records.filter(r => isClosed(r))
    let avgDays  = 0
    if (closed.length > 0) {
      const total_days = closed.reduce((sum, r) => {
        if (r.created_at && r.updated_at) {
          return sum + Math.max(0, (new Date(r.updated_at) - new Date(r.created_at)) / 86400000)
        }
        return sum
      }, 0)
      avgDays = Math.round(total_days / closed.length)
    }
    return { total, open, insur, cost, avgDays }
  }, [records])

  // Monthly incidents chart (incidents tab)
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
      tooltip: { backgroundColor: 'var(--panel-2)', titlecolor:'var(--panel-ink)', bodyColor: '#9ca3af', borderColor: 'var(--hairline)', borderWidth: 1 },
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

  // ---- Analytics data ----

  // Top 5 assets by incident count
  const topAssetsChart = useMemo(() => {
    const counts = {}
    records.forEach(r => {
      if (r.asset_no) counts[r.asset_no] = (counts[r.asset_no] ?? 0) + 1
    })
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    return {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: 'Incidents',
        data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(234,88,12,0.7)',
        borderColor: '#ea580c',
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [records])

  // Monthly severity stacked bar
  const severityMonthlyChart = useMemo(() => {
    const keys = last12MonthKeys()
    const bySev = {}
    SEVERITIES.forEach(s => {
      bySev[s] = {}
      keys.forEach(k => { bySev[s][k] = 0 })
    })
    records.forEach(r => {
      const k = monthKey(r.incident_date)
      if (k && bySev[r.severity] && bySev[r.severity][k] !== undefined) bySev[r.severity][k]++
    })
    const colors = { Minor: 'rgba(107,114,128,0.7)', Major: 'rgba(234,88,12,0.7)', 'Total Loss': 'rgba(220,38,38,0.7)' }
    const borders = { Minor: '#6b7280', Major: '#ea580c', 'Total Loss': '#dc2626' }
    return {
      labels: keys.map(k => monthLabel(k)),
      datasets: SEVERITIES.map(s => ({
        label: s,
        data: keys.map(k => bySev[s][k]),
        backgroundColor: colors[s],
        borderColor: borders[s],
        borderWidth: 1,
        borderRadius: 2,
      })),
    }
  }, [records])

  // Incidents by site
  const bySiteChart = useMemo(() => {
    const counts = {}
    records.forEach(r => {
      if (r.site) counts[r.site] = (counts[r.site] ?? 0) + 1
    })
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    return {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: 'Incidents',
        data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(59,130,246,0.7)',
        borderColor: '#3b82f6',
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [records])

  // Status funnel data for analytics
  const funnelStatuses = [
    'Reported',
    'Under Investigation',
    'Repair In Progress',
    'Awaiting Parts',
    'Awaiting Approval',
    'Insurance Claim',
    'Closed',
  ]
  const funnelData = useMemo(() => {
    const total = records.length || 1
    return funnelStatuses.map(s => ({
      status: s,
      count: statusCounts[s] ?? 0,
      pct: Math.round(((statusCounts[s] ?? 0) / total) * 100),
    }))
  }, [records, statusCounts])

  // ---- Claims & cost-recovery analytics (V19 module) ----
  const claimAnalytics = useMemo(() => {
    let totalClaim = 0, totalApproved = 0, totalParts = 0, totalRepair = 0, totalDeductible = 0, totalRecovered = 0
    const byStatus = { none: 0, filed: 0, approved: 0, rejected: 0, settled: 0 }
    const byRecovery = { pending: 0, partial: 0, recovered: 0, written_off: 0 }
    const byPayer = {}
    let pendingClosure = 0, closedApproved = 0
    records.forEach(r => {
      totalClaim      += Number(r.claim_amount) || 0
      totalApproved   += Number(r.claim_approved_amount) || 0
      totalParts      += Number(r.parts_cost) || 0
      totalRepair     += Number(r.repair_cost) || 0
      totalDeductible += Number(r.deductible) || 0
      totalRecovered  += Number(r.recovered_amount) || 0
      const cs = r.claim_status || 'none'
      if (byStatus[cs] !== undefined) byStatus[cs]++
      const rs = r.recovery_status || 'pending'
      if (byRecovery[rs] !== undefined) byRecovery[rs]++
      const cost = (Number(r.repair_cost) || 0) + (Number(r.parts_cost) || 0)
      if (cost > 0) { const p = r.payer || 'Unassigned'; byPayer[p] = (byPayer[p] || 0) + cost }
      if (r.closure_status === 'pending_closure') pendingClosure++
      if (r.closure_status === 'closed') closedApproved++
    })
    const grossCost   = totalRepair + totalParts
    const recovery    = grossCost > 0 ? Math.round((totalRecovered / grossCost) * 100) : 0
    const netExposure = Math.max(0, grossCost - totalRecovered)
    return {
      totalClaim, totalApproved, totalParts, totalRepair, totalDeductible, totalRecovered,
      grossCost, recovery, netExposure, byStatus, byRecovery, byPayer, pendingClosure, closedApproved,
    }
  }, [records])

  const claimStatusChart = useMemo(() => {
    const order = ['filed', 'approved', 'settled', 'rejected', 'none']
    const labels = { none: 'No Claim', filed: 'Filed', approved: 'Approved', rejected: 'Rejected', settled: 'Settled' }
    const colors = { none: '#6b7280', filed: '#3b82f6', approved: '#16a34a', rejected: '#dc2626', settled: '#9333ea' }
    return {
      labels: order.map(k => labels[k]),
      datasets: [{
        label: 'Claims',
        data: order.map(k => claimAnalytics.byStatus[k] ?? 0),
        backgroundColor: order.map(k => colors[k] + 'b3'),
        borderColor: order.map(k => colors[k]),
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [claimAnalytics])

  const payerCostChart = useMemo(() => {
    const sorted = Object.entries(claimAnalytics.byPayer).sort((a, b) => b[1] - a[1]).slice(0, 6)
    return {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: 'Cost',
        data: sorted.map(([, v]) => v),
        backgroundColor: 'rgba(168,85,247,0.7)',
        borderColor: '#a855f7',
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [claimAnalytics])

  const pendingClosures = useMemo(
    () => records.filter(r => r.closure_status === 'pending_closure').length,
    [records],
  )

  // ---- Incidents tab filtered data ----
  const filtered = useMemo(() => {
    let arr = records
    if (onlyPendingClosure) arr = arr.filter(r => r.closure_status === 'pending_closure')
    if (statusFunnel)   arr = arr.filter(r => r.status === statusFunnel)
    if (filterStatus)   arr = arr.filter(r => r.status === filterStatus)
    if (filterSeverity) arr = arr.filter(r => r.severity === filterSeverity)
    if (filterSite)     arr = arr.filter(r => r.site === filterSite)
    if (filterFrom)     arr = arr.filter(r => r.incident_date >= filterFrom)
    if (filterTo)       arr = arr.filter(r => r.incident_date <= filterTo)
    if (search.trim()) {
      const q = search.toLowerCase()
      arr = arr.filter(r =>
        (r.asset_no ?? '').toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )
    }
    return arr
  }, [records, search, filterSite, filterSeverity, filterStatus, filterFrom, filterTo, statusFunnel, onlyPendingClosure])

  function openAdd() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setFormError('')
    setAssetQuery('')
    setShowModal(true)
  }

  function openEdit(row) {
    setAssetQuery(row.asset_no ?? '')
    setForm({
      incident_date:      row.incident_date ? row.incident_date.split('T')[0] : '',
      asset_no:           row.asset_no ?? '',
      site:               row.site ?? '',
      country:            row.country ?? '',
      description:        row.description ?? '',
      severity:           row.severity ?? 'Minor',
      status:             row.status ?? 'Reported',
      repair_cost:        row.repair_cost ?? '',
      insurance_claim_no: row.insurance_claim_no ?? '',
      inspector:          row.inspector ?? '',
      photos:             row.photos ?? [],
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
      ? await accidentsApi.updateAccidentForPage(editId, payload)
      : await accidentsApi.createAccidentForPage(payload)
    if (err) { setFormError(err.message); setSaving(false); return }
    setShowModal(false)
    loadRecords()
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this incident record?')) return
    await accidentsApi.deleteAccident(id)
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

  // Full export - every incident + claim + recovery + cost field ("everything").
  const EXPORT_FIELDS = [
    ['incident_date', 'Date', r => r.incident_date],
    ['asset_no', 'Asset', r => r.asset_no],
    ['site', 'Site', r => r.site],
    ['country', 'Country', r => r.country],
    ['severity', 'Severity', r => canonSeverity(r.severity)],
    ['status', 'Status', r => canonStatus(r.status)],
    ['closure_status', 'Closure', r => r.closure_status],
    ['responsible_party', 'Responsible', r => r.responsible_party],
    ['liable_party', 'Liable', r => r.liable_party],
    ['payer', 'Who Pays', r => r.payer],
    ['driver_name', 'Driver', r => r.driver_name],
    ['insurer', 'Insurer', r => r.insurer],
    ['policy_no', 'Policy/Claim No', r => r.policy_no],
    ['claim_status', 'Claim Status', r => r.claim_status],
    ['claim_amount', 'Claim Amount', r => r.claim_amount],
    ['claim_approved_amount', 'Approved', r => r.claim_approved_amount],
    ['deductible', 'Deductible', r => r.deductible],
    ['recovery_status', 'Recovery Status', r => r.recovery_status],
    ['recovered_amount', 'Recovered', r => r.recovered_amount],
    ['recovery_source', 'Recovery Source', r => r.recovery_source],
    ['recovery_date', 'Recovery Date', r => r.recovery_date],
    ['recovery_reference', 'Recovery Ref', r => r.recovery_reference],
    ['repair_cost', 'Repair Cost', r => r.repair_cost],
    ['estimated_damage_cost', 'Est. Damage', r => r.estimated_damage_cost],
    ['parts_cost', 'Parts Cost', r => r.parts_cost],
    ['net_cost', 'Net Cost', r => Math.max(0, (Number(r.repair_cost) || Number(r.estimated_damage_cost) || 0) + (Number(r.parts_cost) || 0) - (Number(r.recovered_amount) || 0))],
    ['location', 'Location', r => r.location],
    ['case_stage', 'Case Stage', r => r.case_stage],
    ['damage_condition', 'Damage Condition', r => r.damage_condition],
    ['current_status', 'Current Status', r => r.current_status],
    ['action_to_be_taken', 'Action To Be Taken', r => r.action_to_be_taken],
    ['responsible_owner', 'Responsible Owner', r => r.responsible_owner],
    ['required_action', 'Required Action', r => r.required_action],
    ['status_update_date', 'Status Update', r => r.status_update_date],
    ['expected_release_date', 'Expected Release', r => r.expected_release_date],
    ['inspector', 'Inspector', r => r.inspector],
    ['reporter_name', 'Reported By', r => r.reporter_name],
  ]
  const exportCols    = EXPORT_FIELDS.map(f => f[0])
  const exportHeaders = EXPORT_FIELDS.map(f => f[1])
  const exportPdfCols = EXPORT_FIELDS.map(([key, header]) => ({ key, header }))
  const exportRows = useMemo(
    () => filtered.map(r => {
      const o = {}
      EXPORT_FIELDS.forEach(([k, , get]) => { o[k] = get(r) ?? '' })
      return o
    }),
    [filtered],
  )

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader
          title="Accidents & Incidents"
          subtitle={`${records.length} total incidents`}
          icon={AlertOctagon}
        />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => exportToExcel(exportRows, exportCols, exportHeaders, `TyrePulse_Accidents_${new Date().toISOString().slice(0,10)}`, 'Accidents', {
              title: 'Accident & Claims Tracker',
              currency: activeCurrency,
              company: appSettings?.company_name,
              dateRange: (filterFrom || filterTo) ? `${filterFrom || '…'} to ${filterTo || '…'}` : 'All dates',
              meta: { Scope: activeCountry !== 'All' ? activeCountry : 'All countries' },
            })}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Download size={14} /> Excel
          </button>
          <button
            onClick={() => exportToPdf(exportRows, exportPdfCols, 'Accident & Claims Tracker', `TyrePulse_Accidents_${new Date().toISOString().slice(0,10)}`, 'landscape', appSettings?.company_name || '', { currency: activeCurrency })}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <FileText size={14} /> PDF
          </button>
          <button
            onClick={() => navigate('/data-intake?module=accident')}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Upload size={15} /> Import via Data Intake Center
          </button>
          <button
            onClick={() => { setShowBulk(true); setBulkRows([]); setBulkFile(null); setBulkResult(null) }}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Upload size={14} /> Bulk Upload
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New Incident
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 -mt-1">
        New: controlled, validated, audited accident &amp; insurance import with private evidence attachments and duplicate detection.
      </p>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">{error}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        <button
          onClick={() => setTab('incidents')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            tab === 'incidents'
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          Incidents
        </button>
        <button
          onClick={() => setTab('analytics')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
            tab === 'analytics'
              ? 'border-green-500 text-green-400'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <BarChart2 size={14} /> Analytics
        </button>
      </div>

      {/* ===== INCIDENTS TAB ===== */}
      {tab === 'incidents' && (
        <>
          {/* Closures awaiting approval */}
          {pendingClosures > 0 && (
            <button
              onClick={() => setOnlyPendingClosure(v => !v)}
              className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                onlyPendingClosure
                  ? 'bg-yellow-900/40 border-yellow-600'
                  : 'bg-yellow-900/20 border-yellow-700/50 hover:bg-yellow-900/30'
              }`}
            >
              <Hourglass size={18} className="text-yellow-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-yellow-200">
                  {pendingClosures} closure{pendingClosures > 1 ? 's' : ''} awaiting approval
                </p>
                <p className="text-xs text-yellow-500/80">Tap to {onlyPendingClosure ? 'show all incidents' : 'review and approve closures'}</p>
              </div>
              {onlyPendingClosure && <X size={14} className="text-yellow-400" />}
            </button>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.07, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
              <div className="card text-center">
                <p className="text-2xl font-bold text-white">{stats.total}</p>
                <p className="text-xs text-gray-400 mt-1">Total Incidents</p>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.07, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
              <div className="card text-center">
                <p className="text-2xl font-bold text-orange-400">{stats.open}</p>
                <p className="text-xs text-gray-400 mt-1">Open</p>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.07, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
              <div className="card text-center">
                <p className="text-2xl font-bold text-red-400">{stats.insur}</p>
                <p className="text-xs text-gray-400 mt-1">Insurance Claims</p>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.07, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
              <div className="card text-center">
                <p className="text-2xl font-bold text-green-400">{fmtCurrency(stats.cost)}</p>
                <p className="text-xs text-gray-400 mt-1">Total Repair Cost</p>
              </div>
            </motion.div>
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
                        {row.incident_date ? formatDate(row.incident_date, activeCountry) : '-'}
                      </td>
                      <td className="table-cell font-medium text-white">{row.asset_no || '-'}</td>
                      <td className="table-cell">{row.site || '-'}</td>
                      <td className="table-cell">
                        {row.severity && (
                          <span className={`badge text-xs ${SEVERITY_BADGE[canonSeverity(row.severity)] ?? 'bg-gray-800 text-gray-300'}`}>
                            {canonSeverity(row.severity)}
                          </span>
                        )}
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-col gap-1 items-start">
                          {row.status && (
                            <span className={`badge text-xs ${STATUS_BADGE[canonStatus(row.status)] ?? 'bg-gray-800 text-gray-300'}`}>
                              {canonStatus(row.status)}
                            </span>
                          )}
                          {row.closure_status === 'pending_closure' && (
                            <span className="badge text-xs bg-yellow-900/50 text-yellow-300 border border-yellow-700/50 flex items-center gap-1">
                              <Hourglass size={10} /> Pending Closure
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="table-cell whitespace-nowrap">{fmtCurrency(row.repair_cost)}</td>
                      <td className="table-cell">{row.inspector || '-'}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setDetailId(row.id)} className="text-gray-400 hover:text-green-400 text-xs transition-colors flex items-center gap-1"><Eye size={12} /> Open</button>
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
        </>
      )}

      {/* ===== ANALYTICS TAB ===== */}
      {tab === 'analytics' && (
        <div className="space-y-4">
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="card text-center">
              <p className="text-2xl font-bold text-white">{stats.total}</p>
              <p className="text-xs text-gray-400 mt-1">Total Incidents</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-orange-400">{stats.open}</p>
              <p className="text-xs text-gray-400 mt-1">Open</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-blue-400">{stats.avgDays}</p>
              <p className="text-xs text-gray-400 mt-1">Avg Days to Close</p>
            </div>
            <div className="card text-center">
              <p className="text-xl font-bold text-green-400">{fmtCurrency(stats.cost)}</p>
              <p className="text-xs text-gray-400 mt-1">Total Repair Cost</p>
            </div>
            <div className="card text-center">
              <p className="text-2xl font-bold text-red-400">{stats.insur}</p>
              <p className="text-xs text-gray-400 mt-1">Insurance Claims</p>
            </div>
          </div>

          {/* Top 5 assets + by site */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <p className="text-sm font-semibold text-gray-300 mb-3">Top 5 Assets by Incidents</p>
              {topAssetsChart.labels.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-6">No data</p>
              ) : (
                <div style={{ height: 200 }}>
                  <Bar data={topAssetsChart} options={CHART_OPTS_H} />
                </div>
              )}
            </div>
            <div className="card">
              <p className="text-sm font-semibold text-gray-300 mb-3">Incidents by Site</p>
              {bySiteChart.labels.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-6">No data</p>
              ) : (
                <div style={{ height: 200 }}>
                  <Bar data={bySiteChart} options={CHART_OPTS_H} />
                </div>
              )}
            </div>
          </div>

          {/* Monthly severity breakdown */}
          <div className="card">
            <p className="text-sm font-semibold text-gray-300 mb-3">Monthly Severity Breakdown (last 12 months)</p>
            <div style={{ height: 220 }}>
              <Bar data={severityMonthlyChart} options={CHART_OPTS_STACKED} />
            </div>
          </div>

          {/* Claims & cost recovery */}
          <div className="card">
            <p className="text-sm font-semibold text-gray-300 mb-3">Claims & Cost Recovery</p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
              <div className="text-center">
                <p className="text-lg font-bold text-white">{fmtCurrency(claimAnalytics.grossCost)}</p>
                <p className="text-[11px] text-gray-400 mt-1">Gross Cost (repair + parts)</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-blue-400">{fmtCurrency(claimAnalytics.totalClaim)}</p>
                <p className="text-[11px] text-gray-400 mt-1">Total Claimed</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-green-400">{fmtCurrency(claimAnalytics.totalRecovered)}</p>
                <p className="text-[11px] text-gray-400 mt-1">Recovered</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-orange-400">{fmtCurrency(claimAnalytics.netExposure)}</p>
                <p className="text-[11px] text-gray-400 mt-1">Net After Recovery</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-purple-400">{fmtCurrency(claimAnalytics.totalParts)}</p>
                <p className="text-[11px] text-gray-400 mt-1">Parts Cost</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-yellow-400">{claimAnalytics.pendingClosure}</p>
                <p className="text-[11px] text-gray-400 mt-1">Pending Closures</p>
              </div>
            </div>

            {/* Recovery rate bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">Insurance recovery rate</span>
                <span className="text-sm font-semibold text-gray-200">{claimAnalytics.recovery}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, claimAnalytics.recovery)}%`,
                    background: claimAnalytics.recovery >= 75 ? '#16a34a' : claimAnalytics.recovery >= 40 ? '#ca8a04' : '#dc2626',
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Claim Status Breakdown</p>
                <div style={{ height: 180 }}><Bar data={claimStatusChart} options={chartOpts} /></div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Cost by Responsible Payer</p>
                {payerCostChart.labels.length === 0
                  ? <p className="text-gray-500 text-sm text-center py-12">No payer cost data</p>
                  : <div style={{ height: 180 }}><Bar data={payerCostChart} options={CHART_OPTS_H} /></div>}
              </div>
            </div>
          </div>

          {/* Status funnel */}
          <div className="card">
            <p className="text-sm font-semibold text-gray-300 mb-4">Status Funnel</p>
            <div className="space-y-3">
              {funnelData.map(({ status, count, pct }) => (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`badge text-xs ${STATUS_BADGE[status] ?? 'bg-gray-800 text-gray-300'}`}>{status}</span>
                    <span className="text-sm text-gray-300">{count} <span className="text-gray-500 text-xs">({pct}%)</span></span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: status === 'Closed' ? '#16a34a'
                          : status === 'Insurance Claim' ? '#dc2626'
                          : status === 'Reported' ? '#ca8a04'
                          : status === 'Under Investigation' ? '#2563eb'
                          : '#9333ea',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
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
                <div className="relative" ref={assetDropRef}>
                  <label className="label">Asset No *</label>
                  <div className="relative">
                    <input
                      className="input pr-8" required
                      placeholder="Type to search…"
                      value={assetQuery}
                      onChange={e => {
                        setAssetQuery(e.target.value)
                        setForm(f => ({ ...f, asset_no: e.target.value }))
                        setShowAssetDrop(true)
                      }}
                      onFocus={() => setShowAssetDrop(true)}
                      autoComplete="off"
                    />
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                  </div>
                  {showAssetDrop && assetSuggestions.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                      {assetSuggestions.map(a => (
                        <button
                          key={a.asset_no}
                          type="button"
                          onMouseDown={() => selectAsset(a)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors flex items-center justify-between gap-3"
                        >
                          <span className="text-white font-mono text-sm">{a.asset_no}</span>
                          <span className="text-gray-400 text-xs truncate">{[a.vehicle_type, a.site].filter(Boolean).join(' · ')}</span>
                        </button>
                      ))}
                    </div>
                  )}
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
                        <PhotoPreview src={src} alt={`Photo ${i + 1}`} className="h-16 w-16 object-cover rounded border border-gray-700" />
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

      {/* Deep claims detail (timeline, parts, claim, closure workflow) */}
      {detailId && (
        <AccidentDetailModal
          accidentId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={loadRecords}
        />
      )}

      {/* ── Bulk Upload Modal ───────────────────────────────────────────────── */}
      {showBulk && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
          onClick={() => setShowBulk(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl p-6 my-4 space-y-5"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Upload size={18} className="text-green-400" /> Bulk Upload Incidents
                </h2>
                <p className="text-xs text-gray-400 mt-1">Upload an Excel or CSV file to import multiple incidents at once.</p>
              </div>
              <button onClick={() => setShowBulk(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            {/* Step 1 - download template */}
            <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-200">Step 1 - Download Template</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                Use the official template to ensure correct column mapping. Required columns:
                <span className="text-gray-300 font-mono"> incident_date</span>,
                <span className="text-gray-300 font-mono"> asset_no</span>.
                All other columns are optional.
              </p>
              <div className="flex flex-wrap gap-2">
                {BULK_TEMPLATE_COLS.map(c => (
                  <span key={c} className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-700 text-gray-300 border border-gray-600">{c}</span>
                ))}
              </div>
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white font-medium transition-colors"
              >
                <Download size={14} /> Download Template (.xlsx)
              </button>
            </div>

            {/* Step 2 - upload file */}
            <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-200">Step 2 - Upload Your File</p>
              <input
                ref={bulkInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) parseBulkFile(e.target.files[0]) }}
              />
              <button
                type="button"
                onClick={() => bulkInputRef.current?.click()}
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-200 font-medium transition-colors"
              >
                <Upload size={14} /> {bulkFile ? bulkFile.name : 'Choose Excel / CSV file'}
              </button>
              {bulkFile && (
                <p className="text-xs text-gray-400">
                  {bulkRows.length} row{bulkRows.length !== 1 ? 's' : ''} parsed ·{' '}
                  <span className="text-green-400">{bulkRows.filter(r => r._valid).length} valid</span>
                  {bulkRows.filter(r => !r._valid).length > 0 && (
                    <> · <span className="text-red-400">{bulkRows.filter(r => !r._valid).length} invalid (missing date or asset_no)</span></>
                  )}
                </p>
              )}
            </div>

            {/* Preview table */}
            {bulkRows.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-gray-700">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-800/80">
                      <th className="table-header py-2 px-3">Row</th>
                      <th className="table-header py-2 px-3">Date</th>
                      <th className="table-header py-2 px-3">Asset</th>
                      <th className="table-header py-2 px-3">Site</th>
                      <th className="table-header py-2 px-3">Severity</th>
                      <th className="table-header py-2 px-3">Status</th>
                      <th className="table-header py-2 px-3">Cost</th>
                      <th className="table-header py-2 px-3">Valid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.slice(0, 50).map(r => (
                      <tr key={r._row} className={`border-t border-gray-800 ${r._valid ? '' : 'bg-red-950/20'}`}>
                        <td className="px-3 py-1.5 text-gray-500">{r._row}</td>
                        <td className="px-3 py-1.5 text-gray-300 font-mono">{r.incident_date || '-'}</td>
                        <td className="px-3 py-1.5 text-white font-medium">{r.asset_no || '-'}</td>
                        <td className="px-3 py-1.5 text-gray-400">{r.site || '-'}</td>
                        <td className="px-3 py-1.5 text-gray-400">{r.severity}</td>
                        <td className="px-3 py-1.5 text-gray-400">{r.status}</td>
                        <td className="px-3 py-1.5 text-gray-400">{r.repair_cost ?? '-'}</td>
                        <td className="px-3 py-1.5 text-center">
                          {r._valid
                            ? <CheckCircle2 size={13} className="text-green-400 mx-auto" />
                            : <AlertCircle size={13} className="text-red-400 mx-auto" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bulkRows.length > 50 && (
                  <p className="text-xs text-gray-500 text-center py-2">Showing first 50 of {bulkRows.length} rows</p>
                )}
              </div>
            )}

            {/* Result banner */}
            {bulkResult && (
              <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border text-sm ${
                bulkResult.errors.length
                  ? 'bg-red-950/30 border-red-700/50 text-red-300'
                  : 'bg-green-950/30 border-green-700/50 text-green-300'
              }`}>
                {bulkResult.errors.length
                  ? <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  : <CheckCircle2 size={16} className="shrink-0 mt-0.5" />}
                <div>
                  {bulkResult.added > 0 && <p>{bulkResult.added} incident{bulkResult.added !== 1 ? 's' : ''} imported successfully.</p>}
                  {bulkResult.skipped > 0 && <p className="text-yellow-400">{bulkResult.skipped} row{bulkResult.skipped !== 1 ? 's' : ''} skipped (missing required fields).</p>}
                  {bulkResult.errors.map((e, i) => <p key={i} className="text-red-300">{e}</p>)}
                </div>
              </div>
            )}

            {/* Action row */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={importBulk}
                disabled={bulkImporting || bulkRows.filter(r => r._valid).length === 0}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
              >
                {bulkImporting
                  ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Importing…</>
                  : <><CheckCircle2 size={14} /> Import {bulkRows.filter(r => r._valid).length} Valid Rows</>}
              </button>
              <button type="button" onClick={() => setShowBulk(false)} className="btn-secondary text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PhotoPreview({ src, alt, className }) {
  const [resolved, setResolved] = useState(src)

  useEffect(() => {
    let mounted = true
    resolveStorageUrl(src).then(url => {
      if (mounted) setResolved(url || '')
    })
    return () => { mounted = false }
  }, [src])

  if (!resolved) {
    return <div className={`${className} bg-gray-800 flex items-center justify-center text-[10px] text-gray-500`}>Photo</div>
  }

  return <img src={resolved} alt={alt} className={className} />
}
