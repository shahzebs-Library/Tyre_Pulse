import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf, exportInspectionDetailPdf } from '../lib/exportUtils'
import { Download, FileText, Camera, ClipboardList, Eye, GraduationCap, CheckSquare, X, Share2, WifiOff, PenLine, Image as ImageIcon, Gauge, Clock, Send, CheckCircle2, ExternalLink, ChevronLeft, ChevronRight, Upload } from 'lucide-react'
import SignaturePad from '../components/SignaturePad'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import VehicleTyreDiagram from '../components/VehicleTyreDiagram'
import { legacyPositionCode } from '../lib/tyrePositions'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useWakeLock, vibrate, shareOrCopy } from '../hooks/useWakeLock'
import { enqueueInspection, syncPendingInspections, getPendingCount } from '../lib/offlineQueue'

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

const VEHICLE_TYPES = ['Pickup', 'Canter', 'Tri-mixer', 'Concrete pump', 'Wheel loader', 'Skid loader', 'Bus', 'Tata', 'Ashok Leyland']
const RISK_LEVELS   = ['good', 'warning', 'critical', 'none']

const INSPECTION_TYPES   = ['Routine', 'Pressure', 'Visual', 'Full', 'Pre-Trip']
const OBSERVATION_TYPES  = ['Site Observation']
const TRAINING_TYPES     = ['Safety Training', 'Training Session']
const ALL_TYPES = [...INSPECTION_TYPES, ...OBSERVATION_TYPES, ...TRAINING_TYPES]

const STATUSES = ['Scheduled', 'In Progress', 'Done', 'Overdue', 'Cancelled']
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical']

// Position IDs must exactly match VehicleTyreDiagram LAYOUTS tyre ids
const TYRE_POSITIONS = {
  'pickup':        ['FL', 'FR', 'RL', 'RR'],
  'wheel loader':  ['FL', 'FR', 'RL', 'RR'],
  'skid loader':   ['FL', 'FR', 'RL', 'RR'],
  'canter':        ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo'],
  'tri-mixer':     ['F1L', 'F1R', 'F2L', 'F2R', 'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro'],
  'concrete pump': ['FL', 'FR', 'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro', 'R3Lo', 'R3Li', 'R3Ri', 'R3Ro'],
  'bus':           ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo'],
  'tata':          ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo'],
  'ashok leyland': ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo'],
}
const DEFAULT_POSITIONS = ['FL', 'FR', 'RL', 'RR']

// Normalise vehicle type to TYRE_POSITIONS key
function normVT(vt) {
  const s = (vt || '').toLowerCase().trim()
  if (s.includes('tri') || s.includes('mixer'))       return 'tri-mixer'
  if (s.includes('concrete') || s.includes('pump'))   return 'concrete pump'
  if (s.includes('wheel') && s.includes('load'))      return 'wheel loader'
  if (s.includes('skid'))                             return 'skid loader'
  if (s.includes('canter'))                           return 'canter'
  if (s.includes('bus'))                              return 'bus'
  if (s.includes('tata'))                             return 'tata'
  if (s.includes('ashok') || s.includes('leyland'))   return 'ashok leyland'
  return 'pickup'
}

// Infer vehicle type from asset number prefix (TM→Tri-mixer, MO→Concrete pump, etc.)
function inferVehicleTypeFromAsset(assetNo) {
  const prefix = ((assetNo || '').match(/^[A-Za-z]+/) || [''])[0].toUpperCase().substring(0, 2)
  const map = { TM: 'Tri-mixer', PM: 'Concrete pump', WL: 'Wheel loader', SL: 'Skid loader', PL: 'Pickup', BH: 'Bus' }
  return map[prefix] || null
}

const EMPTY_FORM = {
  title: '', inspection_type: 'Routine', site: '', asset_no: '', tyre_serial: '',
  scheduled_date: '', status: 'Scheduled', findings: '', inspector: '', notes: '',
  attendees: '', severity: 'Medium', photo_data: null,
  vehicle_type: '', tyre_conditions: {},
}

function isObservationType(t) { return OBSERVATION_TYPES.includes(t) }
function isTrainingType(t)     { return TRAINING_TYPES.includes(t) }

const CHECKLIST_LABELS = {
  en: {
    title: 'Daily Inspection Checklist',
    asset: 'Asset Number',
    position: 'Position',
    pressure: 'Pressure (PSI)',
    condition: 'Condition',
    tread: 'Tread (mm)',
    notes: 'Notes',
    good: 'Good',
    wear: 'Wear',
    damage: 'Damage',
    puncture: 'Puncture',
    save: 'Save Checklist',
    export: 'Export PDF',
    inspector: 'Inspector',
    site: 'Site',
    no_asset: 'Enter asset number to load vehicle',
  },
  ar: {
    title: 'قائمة الفحص اليومي',
    asset: 'رقم الأصل',
    position: 'الموضع',
    pressure: 'الضغط (PSI)',
    condition: 'الحالة',
    tread: 'عمق المداس (مم)',
    notes: 'ملاحظات',
    good: 'جيد',
    wear: 'تآكل',
    damage: 'تلف',
    puncture: 'ثقب',
    save: 'حفظ القائمة',
    export: 'تصدير PDF',
    inspector: 'المفتش',
    site: 'الموقع',
    no_asset: 'أدخل رقم الأصل لتحميل المركبة',
  },
}

// Column widths for the virtual inspection table grid
const INSP_COL_WIDTHS = [110, 200, 110, 110, 100, 90, 100, 120, 240]

// ── Approval email HTML builder ────────────────────────────────────────────────
function buildApprovalEmailHtml({ assetNo, inspector, date, site, odometer, hourMeter, notes, approvalLink, signature }) {
  const sigBlock = signature
    ? `<img src="${signature}" alt="Inspector Signature" style="max-width:220px;border:1px solid #e5e7eb;border-radius:8px;margin-top:8px;" />`
    : '<p style="color:#9ca3af;font-style:italic;">No digital signature captured</p>'

  const rows = [
    ['Asset / Vehicle', assetNo || '—'],
    ['Inspection Date', date || '—'],
    ['Site', site || '—'],
    ['Inspector', inspector || '—'],
    odometer ? ['Odometer (km)', odometer] : null,
    hourMeter ? ['Hour Meter (hrs)', hourMeter] : null,
  ].filter(Boolean)

  const tableRows = rows.map(([k, v]) => `
    <tr>
      <td style="padding:8px 12px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;">${k}</td>
      <td style="padding:8px 12px;color:#111827;font-size:13px;font-weight:600;border-bottom:1px solid #f3f4f6;">${v}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#15803d 0%,#166534 100%);padding:28px 32px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;background:rgba(255,255,255,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:20px;">🔍</span>
        </div>
        <div>
          <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">Tyre Pulse</h1>
          <p style="margin:0;color:#bbf7d0;font-size:13px;">Inspection Approval Request</p>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="margin:0 0 8px;color:#374151;font-size:15px;font-weight:600;">Your approval is required</p>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
        An inspection checklist has been submitted and requires your review and digital signature before it can be finalised.
      </p>

      <!-- Details table -->
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px;">
        <div style="background:#f9fafb;padding:10px 12px;border-bottom:1px solid #e5e7eb;">
          <span style="font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;">Inspection Details</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">${tableRows}</table>
      </div>

      ${notes ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 16px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#166534;">Inspector Notes</p>
        <p style="margin:0;font-size:13px;color:#374151;">${notes}</p>
      </div>` : ''}

      <!-- Inspector Signature -->
      <div style="margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;">Inspector Signature</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
          ${sigBlock}
        </div>
      </div>

      <!-- CTA -->
      <a href="${approvalLink}"
        style="display:block;text-align:center;background:#15803d;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:700;margin-bottom:16px;">
        Review &amp; Sign Inspection →
      </a>

      <p style="margin:0;text-align:center;color:#9ca3af;font-size:12px;">
        This link requires you to be logged in to Tyre Pulse.<br>
        If the button doesn't work, copy this URL: <span style="color:#15803d;word-break:break-all;">${approvalLink}</span>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">Tyre Pulse Fleet Intelligence · This is an automated message</p>
    </div>
  </div>
</body>
</html>`
}

export default function Inspections() {
  const { profile, loading: authLoading } = useAuth()
  const { activeCountry } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const isTyreMan = profile?.role === 'Tyre Man'
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [form, setForm]         = useState(null)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSite, setFilterSite]     = useState('all')
  const [search, setSearch]             = useState('')
  const [deleteId, setDeleteId]         = useState(null)
  const [activeTab, setActiveTab]       = useState('all')
  // Lock TyreMan to checklist tab; switch to checklist if asset param present
  useEffect(() => {
    if (isTyreMan || searchParams.get('asset')) setActiveTab('checklist')
  }, [isTyreMan, searchParams])

  // Approver landing: ?approve=<inspection_id>
  useEffect(() => {
    const approveId = searchParams.get('approve')
    if (!approveId || authLoading) return
    supabase.from('inspections').select('*').eq('id', approveId).single()
      .then(({ data }) => {
        if (data) { setApproveTarget(data); setShowApproveModal(true) }
      })
  }, [searchParams, authLoading])
  const [raisingAction, setRaisingAction] = useState(null)
  const [selectedTyre, setSelectedTyre]   = useState(null)
  const fileRef = useRef(null)

  // Language toggle for checklist tab
  const [lang, setLang] = useState('en')

  // Checklist tab state
  const [clAsset, setClAsset]         = useState('')
  const [clSite, setClSite]           = useState('')
  const [clDate, setClDate]           = useState(new Date().toISOString().split('T')[0])
  const [clInspector, setClInspector] = useState('')
  const [clFleetInfo, setClFleetInfo] = useState(null)
  const [clPositions, setClPositions] = useState([])
  const [clNotes, setClNotes]         = useState('')
  const [clSaving, setClSaving]       = useState(false)
  const [clSaved, setClSaved]         = useState(null)
  const [clError, setClError]         = useState(null)
  const [clLookingUp, setClLookingUp] = useState(false)
  const [clOffline, setClOffline]     = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  // Hour meter + odometer
  const [clOdometer, setClOdometer]   = useState('')
  const [clHourMeter, setClHourMeter] = useState('')
  // Multi-photo
  const [clPhotos, setClPhotos]       = useState([]) // array of base64 strings
  const cameraInputRef                = useRef(null)
  const galleryInputRef               = useRef(null)
  // Signature
  const [clSignature, setClSignature]         = useState(null) // base64 PNG
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  // Approval workflow
  const [clApprovalStatus, setClApprovalStatus] = useState('done') // 'done' | 'pending_approval' | 'approved'
  const [clApproverEmail, setClApproverEmail]   = useState('')
  const [showApprovalForm, setShowApprovalForm] = useState(false)
  const [clSendingEmail, setClSendingEmail]     = useState(false)
  const [clEmailSent, setClEmailSent]           = useState(false)
  // Approver landing modal (when manager opens ?approve=<id> link)
  const [approveTarget, setApproveTarget]       = useState(null)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [approverSig, setApproverSig]           = useState(null)
  const [showApproverPad, setShowApproverPad]   = useState(false)
  const [approveSubmitting, setApproveSubmitting] = useState(false)
  const [approveMsg, setApproveMsg]             = useState(null)
  // Mobile PDF preview
  const [pdfBlobUrl, setPdfBlobUrl]   = useState(null)
  const [showPdfPreview, setShowPdfPreview] = useState(false)
  const diagramRef     = useRef(null)
  const [clSelectedPos, setClSelectedPos] = useState(null)
  // Row PDF export: render the live diagram offscreen, then capture its SVG.
  const [pdfRow, setPdfRow] = useState(null)
  const pdfDiagramRef = useRef(null)

  useEffect(() => {
    if (!pdfRow) return
    let cancelled = false
    const t = setTimeout(async () => {
      const svgEl = pdfDiagramRef.current?.querySelector('svg')
      try { await exportInspectionDetailPdf(pdfRow, { svgEl }) }
      finally { if (!cancelled) setPdfRow(null) }
    }, 80)
    return () => { cancelled = true; clearTimeout(t) }
  }, [pdfRow])

  // Virtual scroll ref for the inspections table
  const tableParentRef = useRef(null)

  // PWA — Screen Wake Lock during inspection
  const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock()

  // Acquire wake lock when checklist tab is active with positions loaded
  useEffect(() => {
    if (activeTab === 'checklist' && clPositions.length > 0) {
      acquireWakeLock()
    } else {
      releaseWakeLock()
    }
    return () => releaseWakeLock()
  }, [activeTab, clPositions.length, acquireWakeLock, releaseWakeLock])

  // Sync offline queue when tab becomes active
  useEffect(() => {
    if (activeTab !== 'checklist') return
    async function syncAndCount() {
      if (navigator.onLine) await syncPendingInspections(supabase)
      const count = await getPendingCount()
      setPendingCount(count)
    }
    syncAndCount()
  }, [activeTab])

  // Master data from fleet
  const [masterSites, setMasterSites]   = useState([])
  const [masterAssets, setMasterAssets] = useState([])

  useEffect(() => {
    supabase.from('vehicle_fleet').select('site, asset_no, vehicle_type').then(({ data }) => {
      if (!data) return
      setMasterSites([...new Set(data.map(r => r.site).filter(Boolean))].sort())
      setMasterAssets(data.filter(r => r.asset_no).sort((a, b) => a.asset_no.localeCompare(b.asset_no)))
    })
  }, [])

  // Geolocation auto-site detection (best-effort) — declared after masterSites
  // so its dependency array is not evaluated before that state exists.
  const geoAttempted = useRef(false)
  useEffect(() => {
    if (activeTab !== 'checklist' || geoAttempted.current) return
    geoAttempted.current = true
    if (!navigator.geolocation || masterSites.length === 0) return
    navigator.geolocation.getCurrentPosition(
      () => { /* future: match to nearest site from geo coordinates */ },
      () => { /* permission denied — ignore */ },
      { timeout: 6000, maximumAge: 60000 }
    )
  }, [activeTab, masterSites])

  useEffect(() => {
    const name = profile?.full_name || profile?.username || ''
    if (name && !clInspector) setClInspector(name)
  }, [profile])

  // Deep-link: /inspections?asset=ASSET_NO — auto-load checklist for scanned vehicle QR
  useEffect(() => {
    const assetParam = searchParams.get('asset')
    if (!assetParam || authLoading) return
    setClAsset(assetParam)
    loadFleetInfo(assetParam)
    // Remove param from URL so refresh doesn't re-trigger
    setSearchParams({}, { replace: true })
  }, [searchParams, authLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    // Paginate past the 1000-row cap so the list AND its exports are complete.
    const { data } = await fetchAllPages((from, to) => {
      let q = supabase.from('inspections').select('*').order('scheduled_date', { ascending: false }).range(from, to)
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      if (profile?.role === 'Tyre Man' && profile?.id) q = q.eq('created_by', profile.id)
      return q
    }, { max: 100000 })
    const today = new Date().toISOString().split('T')[0]
    const enriched = (data || []).map(r => ({
      ...r,
      status: r.status !== 'Done' && r.status !== 'Cancelled' && r.scheduled_date < today
        ? 'Overdue' : r.status,
    }))
    setRows(enriched)
    setLoading(false)
  }

  useEffect(() => {
    if (authLoading) return
    load()
  }, [activeCountry, authLoading, isTyreMan])

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

  // Virtualizer for the inspections table
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => tableParentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  })

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
    setSaveError(null)
    const payload = { ...form, created_by: profile?.id ?? null }
    delete payload.id

    let error
    if (form.id) {
      ;({ error } = await supabase.from('inspections').update(payload).eq('id', form.id))
    } else {
      ;({ error } = await supabase.from('inspections').insert(payload))
    }
    if (error) {
      setSaveError(error.message || 'Save failed. If this persists, run MIGRATIONS_SAFE.sql to update the inspections table schema.')
    } else {
      setForm(null)
      await load()
    }
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

  async function loadFleetInfo(assetNo) {
    if (!assetNo.trim()) return
    setClLookingUp(true)
    const { data } = await supabase.from('vehicle_fleet').select('vehicle_type, asset_no, site').eq('asset_no', assetNo.trim()).maybeSingle()
    // Use DB vehicle_type if available, otherwise infer from asset number prefix
    const vehicleType = data?.vehicle_type || inferVehicleTypeFromAsset(assetNo)
    const fleetInfo = data || (vehicleType ? { asset_no: assetNo.trim(), vehicle_type: vehicleType, site: null } : null)
    if (fleetInfo) {
      setClFleetInfo(fleetInfo)
      const vtKey = normVT(vehicleType)
      const positions = TYRE_POSITIONS[vtKey] || DEFAULT_POSITIONS
      setClPositions(positions.map(pos => ({ position: pos, label: legacyPositionCode(vtKey, pos), pressure: '', condition: 'Good', treadDepth: '' })))
      if (fleetInfo.site && !clSite) setClSite(fleetInfo.site)
    } else {
      setClFleetInfo(null)
      setClPositions(DEFAULT_POSITIONS.map(pos => ({ position: pos, label: legacyPositionCode('', pos), pressure: '', condition: 'Good', treadDepth: '' })))
    }
    setClLookingUp(false)
  }

  async function saveChecklist() {
    if (!clAsset.trim() || clPositions.length === 0) return
    setClSaving(true)
    setClError(null)
    setClOffline(false)
    const payload = {
      title: `Daily Tyre Inspection — ${clSite || clAsset} — ${clDate}`,
      inspection_type: 'Routine',
      site: clSite,
      asset_no: clAsset.trim(),
      scheduled_date: clDate,
      status: clApprovalStatus === 'pending_approval' ? 'In Progress' : 'Done',
      completed_date: clDate,
      inspector: clInspector,
      tyre_conditions: clPositions,
      vehicle_type: clFleetInfo?.vehicle_type || (clPositions.length > 0 ? 'Pickup' : null),
      findings: clNotes || null,
      notes: clNotes,
      country: activeCountry !== 'All' ? activeCountry : null,
      created_by: profile?.id ?? null,
      // Extended fields
      odometer_km: clOdometer ? parseFloat(clOdometer) : null,
      hour_meter: clHourMeter ? parseFloat(clHourMeter) : null,
      photo_data: clPhotos.length > 0 ? clPhotos[0] : null, // primary photo (DB compat)
      inspector_signature: clSignature || null,
      approval_status: clApprovalStatus,
      approver_email: clApproverEmail || null,
    }

    // Vibrate on save attempt (success signal pattern)
    vibrate([50, 30, 50])

    const { data, error } = await supabase.from('inspections').insert(payload).select().single()
    if (error) {
      if (!navigator.onLine || error.message?.includes('fetch')) {
        // Offline — enqueue for later sync
        try {
          await enqueueInspection(payload)
          setClOffline(true)
          setClSaved({ ...payload, id: `offline-${Date.now()}`, asset_no: payload.asset_no, scheduled_date: payload.scheduled_date })
          const count = await getPendingCount()
          setPendingCount(count)
          vibrate([100, 50, 100, 50, 200])
        } catch {
          setClError('Failed to queue offline. Please try again.')
        }
      } else {
        setClError(error.message || 'Save failed — please try again.')
        vibrate(300)
      }
    } else {
      setClSaved(data)
      vibrate([80, 30, 80, 30, 200])
      await load()
    }
    setClSaving(false)
  }

  async function exportChecklistPdf(preview = false) {
    if (!clSaved) return
    const tyreData = clPositions.length > 0 ? clPositions
      : (clSaved.tyre_conditions || (() => { try { return JSON.parse(clSaved.findings || '[]') } catch { return [] } })())

    const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pw     = doc.internal.pageSize.width
    const ph     = doc.internal.pageSize.height
    const mx     = 14

    // ── Header band ────────────────────────────────────────────────────────────
    doc.setFillColor(21, 128, 61)
    doc.rect(0, 0, pw, 20, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text('TYREPULSE', mx, 9)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text('Daily Tyre Inspection Report', mx, 16)
    doc.text(
      `Generated: ${new Date().toLocaleDateString('en-GB')}`,
      pw - mx, 16, { align: 'right' }
    )

    // ── Asset info grid ─────────────────────────────────────────────────────────
    let y = 28
    const infoItems = [
      ['Asset No',       clAsset || clSaved.asset_no || 'n/a'],
      ['Vehicle Type',   clFleetInfo?.vehicle_type || clSaved.vehicle_type || 'n/a'],
      ['Site',           clSite || clSaved.site || 'n/a'],
      ['Inspector',      clInspector || clSaved.inspector || 'n/a'],
      ['Date',           clDate || clSaved.scheduled_date || 'n/a'],
      ['Tyre Count',     String(tyreData.length)],
      ['Odometer (km)',  clOdometer || clSaved.odometer_km || 'n/a'],
      ['Hour Meter',     clHourMeter || clSaved.hour_meter || 'n/a'],
    ]
    const colW = (pw - mx * 2) / 3
    infoItems.forEach(([label, value], i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      const ix  = mx + col * colW
      const iy  = y + row * 12
      doc.setFontSize(7)
      doc.setTextColor(107, 114, 128)
      doc.setFont('helvetica', 'normal')
      doc.text(label, ix, iy)
      doc.setFontSize(9)
      doc.setTextColor(31, 41, 55)
      doc.setFont('helvetica', 'bold')
      doc.text(String(value), ix, iy + 5)
    })
    const infoRows = Math.ceil(infoItems.length / 3)
    y += infoRows * 12 + 6

    // ── Vehicle diagram — capture actual SVG rendered in the DOM ───────────────
    const svgEl = diagramRef.current?.querySelector('svg')
    if (svgEl) {
      try {
        const svgStr  = new XMLSerializer().serializeToString(svgEl)
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
        const url     = URL.createObjectURL(svgBlob)
        await new Promise((resolve) => {
          const img    = new Image()
          img.onload   = () => {
            const scale   = 2
            const canvas  = document.createElement('canvas')
            const svgW    = svgEl.viewBox?.baseVal?.width  || svgEl.clientWidth  || 400
            const svgH    = svgEl.viewBox?.baseVal?.height || svgEl.clientHeight || 300
            canvas.width  = svgW * scale
            canvas.height = svgH * scale
            const ctx = canvas.getContext('2d')
            ctx.scale(scale, scale)
            ctx.fillStyle = '#0a1628'
            ctx.fillRect(0, 0, svgW, svgH)
            ctx.drawImage(img, 0, 0, svgW, svgH)
            URL.revokeObjectURL(url)
            const imgData = canvas.toDataURL('image/png')
            const diagW   = pw - mx * 2
            const diagH   = diagW * svgH / svgW
            doc.addImage(imgData, 'PNG', mx, y, diagW, diagH)
            y += diagH + 6
            resolve()
          }
          img.onerror = () => { URL.revokeObjectURL(url); resolve() }
          img.src = url
        })
      } catch (_) { /* fall through to table if SVG capture fails */ }
    }

    // Colour legend
    const legendY = y
    const legendItems = [
      { color: [22, 163, 74],  label: 'Good'    },
      { color: [202, 138, 4],  label: 'Wear'    },
      { color: [220, 38, 38],  label: 'Damage'  },
      { color: [55, 65, 81],   label: 'No data' },
    ]
    let lx = mx
    legendItems.forEach(({ color, label }) => {
      doc.setFillColor(...color)
      doc.circle(lx + 2, legendY, 2, 'F')
      doc.setTextColor(107, 114, 128)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(label, lx + 5.5, legendY + 1)
      lx += 26
    })

    y = legendY + 8

    // ── Tyre data table ─────────────────────────────────────────────────────────
    autoTable(doc, {
      startY: y,
      head: [['Position', 'Pressure (PSI)', 'Condition', 'Tread Depth (mm)']],
      body: tyreData.map(row => [
        row.position || 'n/a',
        row.pressure ? `${row.pressure} PSI` : 'n/a',
        row.condition || 'n/a',
        row.treadDepth ? `${row.treadDepth} mm` : 'n/a',
      ]),
      margin:      { left: mx, right: mx },
      theme:       'grid',
      styles:      { fontSize: 8, cellPadding: 2.5 },
      headStyles:  { fillColor: [21, 128, 61], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell(data) {
        if (data.section !== 'body' || data.column.index !== 2) return
        const cond = String(data.cell.raw)
        if (cond === 'Good')   { data.cell.styles.fillColor = [220, 252, 231]; data.cell.styles.textColor = [21, 128, 61]  }
        if (cond === 'Wear')   { data.cell.styles.fillColor = [254, 249, 195]; data.cell.styles.textColor = [161, 98, 7]   }
        if (cond === 'Damage') { data.cell.styles.fillColor = [254, 226, 226]; data.cell.styles.textColor = [185, 28, 28]  }
      },
    })

    // ── Notes ───────────────────────────────────────────────────────────────────
    let finalY = doc.lastAutoTable?.finalY ?? (y + 40)
    finalY += 8

    if (clNotes) {
      doc.setTextColor(31, 41, 55)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text('Notes:', mx, finalY)
      finalY += 5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      const lines = doc.splitTextToSize(clNotes, pw - mx * 2)
      doc.text(lines, mx, finalY)
      finalY += lines.length * 4.5 + 6
    }

    // ── Photos (if any) ─────────────────────────────────────────────────────────
    const photos = clPhotos.length > 0 ? clPhotos : (clSaved.photo_data ? [clSaved.photo_data] : [])
    if (photos.length > 0) {
      if (finalY + 60 > ph - 20) { doc.addPage(); finalY = 20 }
      doc.setTextColor(31, 41, 55)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text('Photos', mx, finalY)
      finalY += 5
      const photoW = 40
      const photoH = 30
      const photoCols = Math.floor((pw - mx * 2) / (photoW + 4))
      for (let pi = 0; pi < Math.min(photos.length, 6); pi++) {
        const col = pi % photoCols
        const row = Math.floor(pi / photoCols)
        const px = mx + col * (photoW + 4)
        const py = finalY + row * (photoH + 4)
        try {
          doc.addImage(photos[pi], 'JPEG', px, py, photoW, photoH)
          doc.setDrawColor(209, 213, 219)
          doc.setLineWidth(0.3)
          doc.rect(px, py, photoW, photoH)
        } catch { /* skip bad image */ }
      }
      const photoRows = Math.ceil(Math.min(photos.length, 6) / photoCols)
      finalY += photoRows * (photoH + 4) + 6
    }

    // ── Signature section ───────────────────────────────────────────────────────
    const sigH = 24
    const sigW = 70
    if (finalY + sigH + 20 > ph - 15) { doc.addPage(); finalY = 20 }
    finalY += 4
    doc.setTextColor(31, 41, 55)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Signatures', mx, finalY)
    finalY += 5

    const sig = clSignature || clSaved.inspector_signature
    if (sig) {
      // Inspector signature image
      doc.setDrawColor(209, 213, 219)
      doc.setLineWidth(0.3)
      doc.rect(mx, finalY, sigW, sigH)
      try { doc.addImage(sig, 'PNG', mx, finalY, sigW, sigH) } catch { /* skip */ }
      doc.setFontSize(7)
      doc.setTextColor(107, 114, 128)
      doc.setFont('helvetica', 'normal')
      doc.text(`Inspector: ${clInspector || clSaved.inspector || ''}`, mx, finalY + sigH + 4)
      doc.text(new Date().toLocaleDateString('en-GB'), mx + sigW - 1, finalY + sigH + 4, { align: 'right' })
    } else {
      // Blank line fallback
      doc.setDrawColor(156, 163, 175)
      doc.setLineWidth(0.5)
      doc.line(mx, finalY + sigH, mx + sigW, finalY + sigH)
      doc.setFontSize(7.5)
      doc.setTextColor(107, 114, 128)
      doc.setFont('helvetica', 'normal')
      doc.text('Inspector Signature', mx, finalY + sigH + 4)
    }

    // Approver signature box (blank pending)
    const approverX = mx + sigW + 15
    doc.setDrawColor(209, 213, 219)
    doc.setLineWidth(0.3)
    doc.rect(approverX, finalY, sigW, sigH)
    doc.setFontSize(8)
    doc.setTextColor(156, 163, 175)
    doc.text('Approver Signature', approverX + 2, finalY + 10)
    doc.setFontSize(7)
    doc.text(clApproverEmail ? `Sent to: ${clApproverEmail}` : 'Pending', approverX + 2, finalY + 16)
    doc.setFont('helvetica', 'normal')
    doc.text('Approved by / التوقيع', approverX, finalY + sigH + 4)

    finalY += sigH + 10

    // ── Footer on every page ────────────────────────────────────────────────────
    const totalPages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      doc.setFillColor(249, 250, 251)
      doc.rect(0, ph - 10, pw, 10, 'F')
      doc.setTextColor(156, 163, 175)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(
        `Confidential · For Internal Use Only  |  ${clDate || clSaved.scheduled_date || 'n/a'}  |  Inspector: ${clInspector || 'n/a'}  |  Asset: ${clAsset || clSaved.asset_no || 'n/a'}`,
        pw / 2, ph - 4, { align: 'center' }
      )
      doc.text(`${i} / ${totalPages}`, pw - mx, ph - 4, { align: 'right' })
    }

    if (preview) {
      const blob = doc.output('blob')
      const url = URL.createObjectURL(blob)
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(url)
      setShowPdfPreview(true)
    } else {
      doc.save(`TyrePulse_Checklist_${clAsset || clSaved.asset_no || 'report'}.pdf`)
    }
  }

  if (loading || authLoading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>

  const tabConfig = [
    { key: 'all',          label: 'All',          icon: null,            count: counts.all },
    { key: 'inspections',  label: 'Inspections',  icon: ClipboardList,   count: counts.inspections },
    { key: 'observations', label: 'Observations', icon: Eye,             count: counts.observations },
    { key: 'training',     label: 'Training',     icon: GraduationCap,   count: counts.training },
    { key: 'checklist',    label: 'Checklist',    icon: CheckSquare,     count: null },
  ]

  const defaultType = activeTab === 'observations' ? 'Site Observation'
    : activeTab === 'training' ? 'Safety Training'
    : 'Routine'

  // Shared grid style for virtual inspection rows
  const inspGridStyle = {
    display: 'grid',
    gridTemplateColumns: INSP_COL_WIDTHS.map(w => `${w}px`).join(' '),
    alignItems: 'center',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isTyreMan ? 'Daily Tyre Checklist' : 'Inspections & Observations'}
        subtitle={isTyreMan ? 'Record daily tyre inspections for your assigned vehicles' : 'Schedule inspections, record site observations and track training'}
        icon={ClipboardList}
        actions={isTyreMan ? null : (
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
              onClick={() => navigate('/data-intake?module=inspection')}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Upload size={15} /> Import via Data Intake Center
            </button>
            <button
              className="btn-primary text-sm"
              onClick={() => setForm({ ...EMPTY_FORM, inspection_type: defaultType })}
            >
              + Add Record
            </button>
          </div>
        )}
      />

      {!isTyreMan && (
        <p className="text-xs text-gray-500 -mt-3">
          Bulk-import inspections from Excel/CSV with Arabic/English header mapping, validation and duplicate detection via the Data Intake Center.
        </p>
      )}

      {/* Tabs — hidden for TyreMan (locked to checklist) */}
      {!isTyreMan && <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg w-fit flex-wrap">
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
      </div>}

      {/* Checklist tab content */}
      {activeTab === 'checklist' && (
        <div className="space-y-4">
          {clSaved ? (
            <div
              className="card"
              dir={lang === 'ar' ? 'rtl' : undefined}
              style={{ background: clOffline ? '#fffbeb' : undefined, borderColor: clOffline ? '#fde68a' : undefined }}
            >
              <div className="flex items-center gap-3 mb-4">
                {clOffline
                  ? <WifiOff size={20} style={{ color: '#d97706' }} />
                  : <CheckSquare size={20} className="text-green-400" />
                }
                <h3 className="text-lg font-semibold" style={{ color: clOffline ? '#92400e' : undefined }}>
                  {clOffline ? 'Saved Offline — Will Sync' : 'Checklist Saved'}
                </h3>
              </div>
              {clOffline && (
                <p className="text-sm mb-3 rounded-lg px-3 py-2" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                  No connection detected. Inspection queued and will sync automatically when you're back online.
                </p>
              )}
              <p className="text-gray-400 text-sm mb-4">
                Inspection for <span className="text-white font-mono">{clSaved.asset_no}</span> on {clSaved.scheduled_date}{clOffline ? ' is queued for upload.' : ' has been saved.'}
              </p>
              {/* Summary badges */}
              <div className="flex flex-wrap gap-2 mb-2">
                {clPositions.filter(p => p.condition === 'Good').length > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-700/40">
                    ✓ {clPositions.filter(p => p.condition === 'Good').length} Good
                  </span>
                )}
                {clPositions.filter(p => p.condition === 'Wear').length > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-yellow-900/30 text-yellow-400 border border-yellow-700/40">
                    ⚠ {clPositions.filter(p => p.condition === 'Wear').length} Wear
                  </span>
                )}
                {clPositions.filter(p => p.condition === 'Damage' || p.condition === 'Puncture').length > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-red-900/30 text-red-400 border border-red-700/40">
                    ✗ {clPositions.filter(p => p.condition === 'Damage' || p.condition === 'Puncture').length} Critical
                  </span>
                )}
                {clSignature && (
                  <span className="text-xs px-2 py-1 rounded-full bg-blue-900/30 text-blue-400 border border-blue-700/40">
                    ✍ Signed
                  </span>
                )}
                {clPhotos.length > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-purple-900/30 text-purple-400 border border-purple-700/40">
                    📷 {clPhotos.length} photo{clPhotos.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <div className="flex gap-3 flex-wrap">
                {!clOffline && (
                  <button onClick={() => exportChecklistPdf(false)} className="btn-secondary flex items-center gap-2 text-sm">
                    <FileText size={14} /> {CHECKLIST_LABELS[lang].export}
                  </button>
                )}
                {!clOffline && (
                  <button onClick={() => exportChecklistPdf(true)} className="btn-secondary flex items-center gap-2 text-sm">
                    <ExternalLink size={14} /> Preview PDF
                  </button>
                )}
                {!clOffline && navigator.share && (
                  <button
                    onClick={async () => {
                      await shareOrCopy({
                        title: `TyrePulse Inspection — ${clSaved.asset_no}`,
                        text: `Daily tyre inspection for ${clSaved.asset_no} on ${clSaved.scheduled_date} completed. ${clPositions.filter(p => p.condition === 'Puncture' || p.condition === 'Damage').length} critical tyre(s) flagged.`,
                      })
                    }}
                    className="btn-secondary flex items-center gap-2 text-sm"
                  >
                    <Share2 size={14} /> Share
                  </button>
                )}
                {!clOffline && (
                  <button
                    onClick={() => setShowApprovalForm(v => !v)}
                    className="btn-secondary flex items-center gap-2 text-sm"
                    style={{ borderColor: '#6366f1', color: '#818cf8' }}
                  >
                    <Send size={14} /> Send for Approval
                  </button>
                )}
                <button onClick={() => {
                  setClSaved(null); setClOffline(false); setClAsset(''); setClPositions([])
                  setClFleetInfo(null); setClNotes(''); setClOdometer(''); setClHourMeter('')
                  setClPhotos([]); setClSignature(null); setClApprovalStatus('done')
                  setClApproverEmail(''); setShowApprovalForm(false)
                  if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null) }
                  setShowPdfPreview(false)
                }}
                  className="btn-primary text-sm">
                  New Checklist
                </button>
              </div>

              {/* Approval workflow panel */}
              {showApprovalForm && !clOffline && (
                <div className="mt-3 p-4 rounded-xl" style={{ background: 'var(--panel-3)', border: '1px solid #4338ca' }}>
                  <h4 className="text-sm font-semibold text-indigo-300 mb-3 flex items-center gap-2">
                    <Send size={14} /> Send for Manager Approval
                  </h4>
                  <div className="space-y-3">
                    <div>
                      <label className="label text-indigo-300">Approver Email</label>
                      <input
                        type="email"
                        className="input"
                        placeholder="manager@company.com"
                        value={clApproverEmail}
                        onChange={e => setClApproverEmail(e.target.value)}
                        style={{ background: '#312e81', borderColor: '#4338ca', color: '#e0e7ff' }}
                      />
                    </div>
                    <p className="text-xs text-indigo-300/70">
                      The approver will receive a link to view this inspection and add their digital signature. Both signatures will appear in the final PDF.
                    </p>
                    <button
                      disabled={!clApproverEmail.trim() || clSendingEmail}
                      onClick={async () => {
                        if (!clSaved?.id) return
                        setClSendingEmail(true)
                        // Update DB status
                        await supabase.from('inspections').update({
                          approval_status: 'pending_approval',
                          approver_email: clApproverEmail,
                          status: 'In Progress',
                        }).eq('id', clSaved.id)
                        // Build approval link
                        const approvalLink = `${window.location.origin}/inspections?approve=${clSaved.id}`
                        // Send email via Edge Function
                        await supabase.functions.invoke('send-email', {
                          body: {
                            to: clApproverEmail,
                            subject: `Inspection Approval Required — Asset ${clSaved.asset_no || clAsset}`,
                            body: buildApprovalEmailHtml({
                              assetNo: clSaved.asset_no || clAsset,
                              inspector: clInspector || profile?.full_name || '',
                              date: clDate,
                              site: clSite,
                              odometer: clOdometer,
                              hourMeter: clHourMeter,
                              notes: clNotes,
                              approvalLink,
                              signature: clSignature,
                            }),
                          },
                        })
                        setClSendingEmail(false)
                        setClEmailSent(true)
                        setClApprovalStatus('pending_approval')
                        setShowApprovalForm(false)
                      }}
                      className="btn-primary text-sm w-full disabled:opacity-50"
                      style={{ background: '#4338ca' }}
                    >
                      {clSendingEmail
                        ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" /> Sending…</>
                        : <><Send size={13} className="inline mr-1" /> Send Approval Request</>
                      }
                    </button>
                  </div>
                </div>
              )}

              {clApprovalStatus === 'pending_approval' && !showApprovalForm && (
                <div className="mt-3 px-3 py-2 rounded-xl flex items-center gap-2 text-sm"
                  style={{ background: 'var(--panel-3)', border: '1px solid #4338ca', color: '#a5b4fc' }}>
                  <Send size={14} />
                  <span>
                    {clEmailSent ? '✓ Approval email sent to' : 'Awaiting approval from'}{' '}
                    <strong>{clApproverEmail}</strong>
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`card space-y-4${lang === 'ar' ? ' text-right' : ''}`}
              dir={lang === 'ar' ? 'rtl' : undefined}
            >
              {/* Offline queue banner */}
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
                  style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e' }}>
                  <WifiOff size={14} />
                  <span>
                    {pendingCount} offline inspection{pendingCount !== 1 ? 's' : ''} queued — will sync when connected.
                  </span>
                </div>
              )}

              {/* Card header with language toggle */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{CHECKLIST_LABELS[lang].title}</h3>
                <div className="flex gap-1 p-0.5 bg-gray-800 rounded-lg">
                  {['en', 'ar'].map(l => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                        lang === l
                          ? 'bg-green-600 text-white shadow'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {l === 'en' ? 'EN' : 'AR'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">{CHECKLIST_LABELS[lang].asset}</label>
                  {masterAssets.length > 0 ? (
                    <select
                      className="input"
                      value={clAsset}
                      onChange={e => {
                        setClAsset(e.target.value)
                        if (e.target.value) loadFleetInfo(e.target.value)
                      }}
                    >
                      <option value="">Select asset…</option>
                      {masterAssets.map(a => (
                        <option key={a.asset_no} value={a.asset_no}>
                          {a.asset_no}{a.vehicle_type ? ` — ${a.vehicle_type}` : ''}{a.site ? ` (${a.site})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input className="input flex-1" placeholder="e.g. CM-0123" value={clAsset}
                        onChange={e => setClAsset(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && loadFleetInfo(clAsset)} />
                      <button onClick={() => loadFleetInfo(clAsset)} disabled={clLookingUp || !clAsset.trim()}
                        className="btn-secondary px-3 text-sm disabled:opacity-50">
                        {clLookingUp ? '...' : 'Load'}
                      </button>
                    </div>
                  )}
                  {(clFleetInfo || (clAsset && inferVehicleTypeFromAsset(clAsset))) && (
                    <p className="text-xs text-green-400 mt-1">
                      {clFleetInfo?.vehicle_type || inferVehicleTypeFromAsset(clAsset)} · {(TYRE_POSITIONS[normVT(clFleetInfo?.vehicle_type || inferVehicleTypeFromAsset(clAsset))] || DEFAULT_POSITIONS).length} tyres
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">{CHECKLIST_LABELS[lang].site}</label>
                  {masterSites.length > 0 ? (
                    <select className="input" value={clSite} onChange={e => setClSite(e.target.value)}>
                      <option value="">Select site…</option>
                      {masterSites.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input className="input" placeholder="Site name" value={clSite}
                      onChange={e => setClSite(e.target.value)} list="cl-sites" />
                  )}
                  <datalist id="cl-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
                </div>
                <div>
                  <label className="label">{CHECKLIST_LABELS[lang].inspector}</label>
                  <input className="input" placeholder="Inspector name" value={clInspector}
                    onChange={e => setClInspector(e.target.value)} />
                </div>
                <div>
                  <label className="label">Date</label>
                  <input type="date" className="input" value={clDate} onChange={e => setClDate(e.target.value)} />
                </div>
              </div>

              {clPositions.length > 0 && (() => {
                const filledCount = clPositions.filter(p => p.pressure).length
                const unfilledPositions = clPositions.filter(p => !p.pressure)
                const allFilled = unfilledPositions.length === 0
                const posIdx = clPositions.findIndex(p => p.position === clSelectedPos)
                const selPos = posIdx >= 0 ? clPositions[posIdx] : null
                return (
                  <div className="space-y-3">
                    {/* SVG diagram — single source of truth, tap to fill */}
                    <div
                      ref={diagramRef}
                      className="rounded-2xl flex flex-col items-center py-4 px-2"
                      style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}
                    >
                      <p className="text-xs font-medium mb-3" style={{ color: '#6b7280' }}>Tap a tyre to fill details</p>
                      <VehicleTyreDiagram
                        vehicleType={clFleetInfo?.vehicle_type || inferVehicleTypeFromAsset(clAsset) || 'Pickup'}
                        positions={clPositions.map(p => ({
                          position: p.position,
                          risk_level: p.condition === 'Good' ? 'good'
                            : p.condition === 'Wear' ? 'warning'
                            : (p.condition === 'Damage' || p.condition === 'Puncture') ? 'critical'
                            : 'none',
                        }))}
                        onPositionClick={({ position }) => setClSelectedPos(position)}
                      />
                    </div>

                    {/* Position chips — tap any to jump, shows fill status */}
                    <div className="flex flex-wrap gap-1.5">
                      {clPositions.map(p => {
                        const has = !!p.pressure
                        const isActive = p.position === clSelectedPos
                        const isPuncture = p.condition === 'Puncture'
                        const isDmg = p.condition === 'Damage' || isPuncture
                        const isWear = p.condition === 'Wear'
                        const bg = isActive ? '#16a34a'
                          : has && isWear ? '#fefce8'
                          : has && isDmg  ? '#fef2f2'
                          : has ? '#f0fdf4'
                          : '#f9fafb'
                        const fg = isActive ? '#ffffff'
                          : has && isWear ? '#854d0e'
                          : has && isDmg  ? '#991b1b'
                          : has ? '#166534'
                          : '#9ca3af'
                        const bd = isActive ? '#16a34a'
                          : has && isWear ? '#fde047'
                          : has && isDmg  ? '#fca5a5'
                          : has ? '#86efac'
                          : '#e5e7eb'
                        return (
                          <button
                            key={p.position}
                            onClick={() => setClSelectedPos(p.position)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold transition-all active:scale-95"
                            style={{ background: bg, color: fg, border: `1.5px solid ${bd}` }}
                          >
                            {p.label || p.position}{has ? ' ✓' : ''}
                            {isPuncture && !isActive && <span className="ml-0.5 text-[9px]">🔴</span>}
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-xs px-0.5" style={{ color: allFilled ? '#16a34a' : '#9ca3af' }}>
                      {allFilled
                        ? `✓ All ${clPositions.length} tyres filled — ready to save`
                        : `${filledCount} of ${clPositions.length} filled · ${unfilledPositions.length} remaining`}
                    </p>

                    {/* Bottom sheet for selected position */}
                    {clSelectedPos && selPos && (
                      <PositionSheet
                        pos={selPos}
                        posIdx={posIdx}
                        total={clPositions.length}
                        isLast={posIdx === clPositions.length - 1}
                        unfilledCount={unfilledPositions.length}
                        allFilled={allFilled}
                        lang={lang}
                        onUpdate={(field, val) =>
                          setClPositions(ps => ps.map(p => p.position === clSelectedPos ? { ...p, [field]: val } : p))
                        }
                        onNext={() => {
                          const isOnLast = posIdx === clPositions.length - 1
                          if (isOnLast) {
                            // Re-check unfilled at call time (state may have just changed)
                            const stillUnfilled = clPositions.find((p, i) => i !== posIdx && !p.pressure)
                            if (stillUnfilled) { setClSelectedPos(stillUnfilled.position); return }
                            // All filled — close sheet
                            setClSelectedPos(null)
                            return
                          }
                          setClSelectedPos(clPositions[posIdx + 1].position)
                        }}
                        onPrev={() => { if (posIdx > 0) setClSelectedPos(clPositions[posIdx - 1].position) }}
                        onClose={() => setClSelectedPos(null)}
                      />
                    )}
                  </div>
                )
              })()}

              {clPositions.length === 0 && clAsset.trim() && (
                <p className="text-gray-500 text-sm text-center py-4">
                  {CHECKLIST_LABELS[lang].no_asset}
                </p>
              )}

              {/* Odometer + Hour Meter */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label flex items-center gap-1.5"><Gauge size={12} className="text-gray-400" /> Odometer (km)</label>
                  <input type="number" className="input" placeholder="e.g. 123456" min="0"
                    value={clOdometer} onChange={e => setClOdometer(e.target.value)} />
                </div>
                <div>
                  <label className="label flex items-center gap-1.5"><Clock size={12} className="text-gray-400" /> Hour Meter (hrs)</label>
                  <input type="number" className="input" placeholder="e.g. 4521" min="0"
                    value={clHourMeter} onChange={e => setClHourMeter(e.target.value)} />
                </div>
              </div>

              {/* Photo capture */}
              <div>
                <label className="label flex items-center gap-1.5"><Camera size={12} className="text-gray-400" /> Photos</label>
                <div className="flex gap-2 flex-wrap mb-2">
                  {clPhotos.map((src, i) => (
                    <div key={i} className="relative">
                      <img src={src} alt={`photo-${i}`}
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--hairline)' }} />
                      <button
                        onClick={() => setClPhotos(ps => ps.filter((_, j) => j !== i))}
                        style={{
                          position: 'absolute', top: -6, right: -6, width: 18, height: 18,
                          borderRadius: '50%', background: '#ef4444', border: 'none',
                          color:'var(--panel-ink)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >×</button>
                    </div>
                  ))}
                  {clPhotos.length < 6 && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                        style={{ background: '#0c4a6e', border: '1.5px solid #0369a1', color: '#7dd3fc' }}
                      >
                        <Camera size={13} /> Camera
                      </button>
                      <button
                        onClick={() => galleryInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold"
                        style={{ background: 'var(--panel-3)', border: '1.5px solid #4338ca', color: '#a5b4fc' }}
                      >
                        <ImageIcon size={13} /> Gallery
                      </button>
                    </div>
                  )}
                </div>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = ev => {
                      // Compress via canvas
                      const img = new Image()
                      img.onload = () => {
                        const MAX = 800
                        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
                        const canvas = document.createElement('canvas')
                        canvas.width = img.width * scale
                        canvas.height = img.height * scale
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
                        setClPhotos(ps => [...ps, canvas.toDataURL('image/jpeg', 0.75)])
                      }
                      img.src = ev.target.result
                    }
                    reader.readAsDataURL(file)
                    e.target.value = ''
                  }}
                />
                <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={e => {
                    Array.from(e.target.files || []).slice(0, 6 - clPhotos.length).forEach(file => {
                      const reader = new FileReader()
                      reader.onload = ev => {
                        const img = new Image()
                        img.onload = () => {
                          const MAX = 800
                          const scale = Math.min(1, MAX / Math.max(img.width, img.height))
                          const canvas = document.createElement('canvas')
                          canvas.width = img.width * scale
                          canvas.height = img.height * scale
                          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
                          setClPhotos(ps => [...ps, canvas.toDataURL('image/jpeg', 0.75)])
                        }
                        img.src = ev.target.result
                      }
                      reader.readAsDataURL(file)
                    })
                    e.target.value = ''
                  }}
                />
              </div>

              {/* Inspector Signature */}
              <div>
                <label className="label flex items-center gap-1.5"><PenLine size={12} className="text-gray-400" /> Inspector Signature</label>
                {clSignature ? (
                  <div className="flex items-center gap-3">
                    <img src={clSignature} alt="signature"
                      style={{ height: 56, maxWidth: 180, background: '#fff', borderRadius: 8, border: '1px solid var(--hairline)', padding: 4 }} />
                    <div>
                      <p className="text-xs text-green-400 font-semibold">✓ Signed — {clInspector}</p>
                      <button onClick={() => setClSignature(null)}
                        className="text-xs text-gray-500 hover:text-red-400 transition-colors mt-0.5">
                        Clear signature
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSignaturePad(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold w-full"
                    style={{ background: '#1a2e1a', border: '1.5px dashed #16a34a', color: '#4ade80' }}
                  >
                    <PenLine size={15} /> Tap to Sign
                  </button>
                )}
              </div>

              <div>
                <label className="label">{CHECKLIST_LABELS[lang].notes}</label>
                <textarea className="input h-20 resize-none" placeholder="General observations..."
                  value={clNotes} onChange={e => setClNotes(e.target.value)} />
              </div>

              {clError && (
                <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">
                  {clError}
                </div>
              )}
              {clPositions.length > 0 && clPositions.some(p => !p.pressure) && (
                <div className="p-3 rounded-xl flex items-center gap-2 text-sm"
                  style={{ background: '#fefce8', border: '1px solid #fde047', color: '#854d0e' }}>
                  <span>⚠️</span>
                  <span>
                    {clPositions.filter(p => !p.pressure).length} tyre{clPositions.filter(p => !p.pressure).length !== 1 ? 's' : ''} still need PSI — tap them on the diagram to fill.
                  </span>
                </div>
              )}
              <button
                onClick={saveChecklist}
                disabled={clSaving || !clAsset.trim() || clPositions.length === 0 || clPositions.some(p => !p.pressure)}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {clSaving ? 'Saving...' : CHECKLIST_LABELS[lang].save}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Signature Pad Modal */}
      {showSignaturePad && (
        <SignaturePad
          label="Inspector Signature"
          inspectorName={clInspector}
          employeeId={profile?.employee_id || ''}
          onSave={dataUrl => { setClSignature(dataUrl); setShowSignaturePad(false) }}
          onClose={() => setShowSignaturePad(false)}
        />
      )}

      {/* ── Approver Modal (opens when landing via ?approve=<id>) ── */}
      {showApproveModal && approveTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div style={{
            background: 'var(--panel)', border: '1px solid var(--hairline)', borderRadius: 20,
            width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
            padding: 24, boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color:'var(--panel-ink)' }}>Approve Inspection</div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                  Asset: <strong style={{ color: '#d1d5db' }}>{approveTarget.asset_no}</strong>
                  {approveTarget.site ? ` · ${approveTarget.site}` : ''}
                  {' · '}{approveTarget.inspection_date || approveTarget.scheduled_date}
                </div>
              </div>
              <button onClick={() => { setShowApproveModal(false); setSearchParams({}) }}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Details */}
            <div style={{ background: 'var(--panel-2)', borderRadius: 12, padding: 16, marginBottom: 16, fontSize: 13 }}>
              {[
                ['Inspector', approveTarget.inspector_name || approveTarget.inspector],
                ['Type', approveTarget.inspection_type],
                ['Odometer', approveTarget.odometer_km ? `${approveTarget.odometer_km} km` : null],
                ['Hour Meter', approveTarget.hour_meter ? `${approveTarget.hour_meter} hrs` : null],
                ['Notes', approveTarget.notes],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#6b7280', minWidth: 100 }}>{k}</span>
                  <span style={{ color: '#d1d5db', fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Inspector signature preview */}
            {approveTarget.inspector_signature && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 }}>Inspector Signature</div>
                <img src={approveTarget.inspector_signature} alt="Inspector signature"
                  style={{ maxWidth: 200, border: '1px solid var(--hairline)', borderRadius: 8 }} />
              </div>
            )}

            {/* Approver signature */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>Your Signature (Approver)</div>
              {approverSig ? (
                <div>
                  <img src={approverSig} alt="Approver signature"
                    style={{ maxWidth: 200, border: '1px solid var(--hairline)', borderRadius: 8 }} />
                  <button onClick={() => setApproverSig(null)}
                    style={{ display: 'block', marginTop: 6, fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>
                    Clear &amp; re-sign
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowApproverPad(true)}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 12,
                    border: '2px dashed var(--hairline)', background: 'var(--panel-2)',
                    color: '#9ca3af', fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <span>✍</span> Tap to add your approval signature
                </button>
              )}
            </div>

            {/* Status message */}
            {approveMsg && (
              <div style={{
                padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13,
                background: approveMsg.type === 'ok' ? 'rgba(22,163,74,0.15)' : 'rgba(239,68,68,0.15)',
                border: `1px solid ${approveMsg.type === 'ok' ? '#16a34a' : '#ef4444'}`,
                color: approveMsg.type === 'ok' ? '#4ade80' : '#f87171',
              }}>
                {approveMsg.text}
              </div>
            )}

            {/* Actions */}
            {approveTarget.approval_status !== 'approved' && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={async () => {
                    setApproveSubmitting(true)
                    await supabase.from('inspections').update({
                      approval_status: 'rejected',
                      approved_at: new Date().toISOString(),
                      approved_by: profile?.id,
                    }).eq('id', approveTarget.id)
                    setApproveMsg({ type: 'err', text: 'Inspection rejected.' })
                    setApproveSubmitting(false)
                  }}
                  disabled={approveSubmitting}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 10,
                    border: '1.5px solid #ef4444', background: 'transparent',
                    color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Reject
                </button>
                <button
                  onClick={async () => {
                    if (!approverSig) { setApproveMsg({ type: 'err', text: 'Please add your signature before approving.' }); return }
                    setApproveSubmitting(true)
                    await supabase.from('inspections').update({
                      approval_status: 'approved',
                      approver_signature: approverSig,
                      approved_at: new Date().toISOString(),
                      approved_by: profile?.id,
                    }).eq('id', approveTarget.id)
                    setApproveMsg({ type: 'ok', text: '✓ Inspection approved and signed.' })
                    setApproveSubmitting(false)
                    setApproveTarget(prev => ({ ...prev, approval_status: 'approved', approver_signature: approverSig }))
                  }}
                  disabled={approveSubmitting || !approverSig}
                  style={{
                    flex: 2, padding: '11px', borderRadius: 10, border: 'none',
                    background: approverSig ? '#16a34a' : '#374151',
                    color:'var(--panel-ink)', fontSize: 13, fontWeight: 700, cursor: approverSig ? 'pointer' : 'not-allowed',
                  }}
                >
                  {approveSubmitting ? 'Saving…' : '✓ Approve & Sign'}
                </button>
              </div>
            )}
            {approveTarget.approval_status === 'approved' && (
              <div style={{ textAlign: 'center', padding: '12px', borderRadius: 10, background: 'rgba(22,163,74,0.15)', border: '1px solid #16a34a', color: '#4ade80', fontWeight: 600 }}>
                ✓ This inspection has been approved
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approver Signature Pad */}
      {showApproverPad && (
        <SignaturePad
          label="Approver Signature"
          inspectorName={profile?.full_name || ''}
          employeeId={profile?.employee_id || ''}
          onSave={dataUrl => { setApproverSig(dataUrl); setShowApproverPad(false) }}
          onClose={() => setShowApproverPad(false)}
        />
      )}

      {/* Mobile PDF Preview Modal */}
      {showPdfPreview && pdfBlobUrl && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'var(--panel)', borderBottom: '1px solid var(--hairline)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color:'var(--panel-ink)' }}>
              Inspection Report — {clSaved?.asset_no}
            </span>
            <div className="flex gap-2">
              <a
                href={pdfBlobUrl}
                download={`TyrePulse_Checklist_${clSaved?.asset_no || 'report'}.pdf`}
                className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
              >
                <Download size={13} /> Download
              </a>
              <button
                onClick={() => setShowPdfPreview(false)}
                style={{ background: 'var(--hairline)', border: 'none', borderRadius: 8, color:'var(--panel-ink)', cursor: 'pointer', padding: '6px 10px' }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <iframe
            src={pdfBlobUrl}
            style={{ flex: 1, border: 'none', background: '#fff' }}
            title="Inspection PDF Preview"
          />
        </div>
      )}

      {/* Status filter pills, search, and table — hidden in checklist mode */}
      {activeTab !== 'checklist' && <>
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

      {/* Virtualised Table */}
      <div className="card overflow-x-auto p-0">
        {/* Sticky header */}
        <div
          className="text-left text-gray-400 border-b border-gray-800 bg-gray-900/60"
          style={{ minWidth: `${INSP_COL_WIDTHS.reduce((a, b) => a + b, 0)}px` }}
        >
          <div style={inspGridStyle} className="px-0">
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">Type</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">Title</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">Site</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">Asset</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">Date</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">Severity</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">Status</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">Inspector</div>
            <div className="pb-2 pt-3 px-3 text-xs font-semibold uppercase tracking-wider">Actions</div>
          </div>
        </div>

        {/* Virtual scroll container */}
        <div
          ref={tableParentRef}
          className="overflow-y-auto"
          style={{
            height: filtered.length === 0 ? 'auto' : '600px',
            minWidth: `${INSP_COL_WIDTHS.reduce((a, b) => a + b, 0)}px`,
          }}
        >
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-gray-500 text-sm">No records found</div>
          ) : (
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const r = filtered[virtualRow.index]
                const cfg    = STATUS_CONFIG[r.status] || STATUS_CONFIG.Scheduled
                const sevCfg = SEV_CONFIG[r.severity]  || SEV_CONFIG.Medium
                const isObs  = isObservationType(r.inspection_type)
                const isTrn  = isTrainingType(r.inspection_type)

                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                      height: `${virtualRow.size}px`,
                      ...inspGridStyle,
                    }}
                    className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors"
                  >
                    {/* Type */}
                    <div className="px-3 overflow-hidden">
                      <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${
                        isObs ? 'bg-purple-900/20 text-purple-400 border-purple-700/40'
                        : isTrn ? 'bg-blue-900/20 text-blue-400 border-blue-700/40'
                        : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}>
                        {r.inspection_type}
                      </span>
                    </div>

                    {/* Title */}
                    <div className="px-3 text-white font-medium text-sm truncate" title={r.title}>
                      {r.title}
                      {r.photo_data && <Camera className="inline w-3 h-3 ml-1 text-gray-500" title="Has photo" />}
                      {r.linked_action_id && <ClipboardList className="inline w-3 h-3 ml-1 text-yellow-400" title="Action raised" />}
                    </div>

                    {/* Site */}
                    <div className="px-3 text-gray-300 text-sm truncate">{r.site}</div>

                    {/* Asset */}
                    <div className="px-3 font-mono text-xs text-gray-400 truncate">{r.asset_no || '—'}</div>

                    {/* Date */}
                    <div className="px-3 text-gray-400 text-xs tabular-nums">{r.scheduled_date}</div>

                    {/* Severity */}
                    <div className="px-3">
                      {r.severity && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${sevCfg.bg} ${sevCfg.color} ${sevCfg.border}`}>
                          {r.severity}
                        </span>
                      )}
                    </div>

                    {/* Status */}
                    <div className="px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                        {r.status}
                      </span>
                    </div>

                    {/* Inspector */}
                    <div className="px-3 text-gray-400 text-xs truncate">{r.inspector || r.attendees || '—'}</div>

                    {/* Actions */}
                    <div className="px-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {r.status !== 'Done' && r.status !== 'Cancelled' && (
                          <button onClick={() => markDone(r.id)}
                            className="text-xs px-2 py-1 rounded bg-green-900/30 text-green-400 hover:bg-green-900/50 border border-green-700/50 transition-colors whitespace-nowrap">
                            ✓ Done
                          </button>
                        )}
                        {isObs && r.status === 'Done' && !r.linked_action_id && (
                          <button onClick={() => setRaisingAction(r)}
                            className="text-xs px-2 py-1 rounded bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40 border border-yellow-700/40 transition-colors whitespace-nowrap">
                            Raise Action
                          </button>
                        )}
                        {r.linked_action_id && (
                          <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-500 border border-gray-700 whitespace-nowrap">
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
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      </>}

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
          {saveError && (
            <div className="mt-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">
              {saveError}
            </div>
          )}
          <div className="flex gap-3 mt-4">
            <button onClick={() => { setForm(null); setSaveError(null) }} className="btn-secondary flex-1">Cancel</button>
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

      {/* Offscreen live diagram for row PDF export (captured as SVG) */}
      {pdfRow && (
        <div
          ref={pdfDiagramRef}
          aria-hidden
          style={{ position: 'fixed', left: -9999, top: 0, width: 360, opacity: 0, pointerEvents: 'none' }}
        >
          <VehicleTyreDiagram
            vehicleType={pdfRow.vehicle_type || inferVehicleTypeFromAsset(pdfRow.asset_no) || 'Pickup'}
            tyreData={pdfRow.tyre_conditions || {}}
            width={340}
          />
        </div>
      )}
    </div>
  )
}

function PositionSheet({ pos, posIdx, total, isLast, unfilledCount, allFilled, lang, onUpdate, onNext, onPrev, onClose }) {
  const L = CHECKLIST_LABELS[lang]
  const isPuncture = pos.condition === 'Puncture'
  const showPunctureAlert = isPuncture

  function handleConditionSelect(cond) {
    onUpdate('condition', cond)
    if (cond === 'Puncture' || cond === 'Damage') {
      vibrate([100, 50, 100, 50, 200]) // double buzz for critical
    } else {
      vibrate(40) // light tap for good/wear
    }
  }

  const nextLabel = isLast
    ? allFilled ? '✓ All Done' : `Fill ${unfilledCount} More →`
    : 'Next →'
  const nextBg = isLast && allFilled ? '#166534' : '#16a34a'

  return (
    <div className="fixed inset-0 z-50" style={{ touchAction: 'none' }}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl"
        style={{
          background: '#ffffff',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        }}
      >
        {/* drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full" style={{ background: '#e5e7eb' }} />
        </div>

        <div className="px-5 pt-2">
          {/* header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span
                className="text-base font-mono font-bold px-3 py-1.5 rounded-xl"
                style={{
                  background: isPuncture ? '#fef2f2' : '#f0fdf4',
                  color: isPuncture ? '#991b1b' : '#166534',
                  border: `1.5px solid ${isPuncture ? '#fca5a5' : '#86efac'}`,
                }}
              >
                {pos.label || pos.position}
              </span>
              <span className="text-sm font-medium" style={{ color: '#9ca3af' }}>
                {posIdx + 1} / {total}
                {unfilledCount > 0 && <span className="ml-2 text-xs" style={{ color: '#d97706' }}>· {unfilledCount} unfilled</span>}
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full"
              style={{ background: '#f3f4f6', color: '#6b7280' }}
            >
              <X size={15} />
            </button>
          </div>

          {/* puncture alert banner */}
          {showPunctureAlert && (
            <div className="mb-3 px-3 py-2.5 rounded-xl flex items-center gap-2 text-sm font-semibold"
              style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#991b1b' }}>
              🔴 Puncture detected — immediate action required
            </div>
          )}

          {/* condition */}
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2.5" style={{ color: '#9ca3af' }}>
            {L.condition}
          </p>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { cond: 'Good',     emoji: '✅', activeBg: '#f0fdf4', activeBorder: '#22c55e', activeText: '#166534', label: L.good     },
              { cond: 'Wear',     emoji: '⚠️', activeBg: '#fefce8', activeBorder: '#eab308', activeText: '#854d0e', label: L.wear     },
              { cond: 'Damage',   emoji: '❌', activeBg: '#fef2f2', activeBorder: '#ef4444', activeText: '#991b1b', label: L.damage   },
              { cond: 'Puncture', emoji: '🔴', activeBg: '#fff1f2', activeBorder: '#dc2626', activeText: '#7f1d1d', label: L.puncture },
            ].map(({ cond, emoji, activeBg, activeBorder, activeText, label }) => {
              const on = pos.condition === cond
              return (
                <button
                  key={cond}
                  onClick={() => handleConditionSelect(cond)}
                  className="py-3 rounded-2xl flex flex-col items-center gap-1.5 transition-all active:scale-95"
                  style={{
                    background:   on ? activeBg : '#f9fafb',
                    border:       `2px solid ${on ? activeBorder : '#e5e7eb'}`,
                    color:        on ? activeText : '#9ca3af',
                  }}
                >
                  <span className="text-xl leading-none">{emoji}</span>
                  <span className="text-[10px] font-bold">{label}</span>
                </button>
              )
            })}
          </div>

          {/* psi */}
          <div className="mb-5">
            <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block" style={{ color: '#9ca3af' }}>
              {L.pressure}
            </label>
            <input
              type="number"
              inputMode="numeric"
              placeholder="PSI"
              value={pos.pressure}
              onChange={e => onUpdate('pressure', e.target.value)}
              className="w-full px-3 py-3 rounded-xl text-sm font-semibold"
              style={{ background: '#f9fafb', border: '1.5px solid #e5e7eb', color: '#111827', outline: 'none' }}
              onFocus={e => { e.target.style.borderColor = '#22c55e'; e.target.style.boxShadow = '0 0 0 3px rgba(34,197,94,0.12)' }}
              onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none' }}
            />
          </div>
          {/* tread disabled — re-enable when data collection is ready
          <div className="mb-5">
            <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block" style={{ color: '#9ca3af' }}>
              {L.tread}
            </label>
            <input type="number" inputMode="decimal" placeholder="mm" value={pos.treadDepth}
              onChange={e => onUpdate('treadDepth', e.target.value)}
              className="w-full px-3 py-3 rounded-xl text-sm font-semibold"
              style={{ background: '#f9fafb', border: '1.5px solid #e5e7eb', color: '#111827', outline: 'none' }}
              onFocus={e => { e.target.style.borderColor = '#22c55e'; e.target.style.boxShadow = '0 0 0 3px rgba(34,197,94,0.12)' }}
              onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none' }}
            />
          </div> */}

          {/* navigation */}
          <div className="flex gap-2.5">
            {posIdx > 0 && (
              <button
                onClick={onPrev}
                className="flex-1 py-3 rounded-2xl text-sm font-bold"
                style={{ background: '#f3f4f6', color: '#374151', border: '1.5px solid #e5e7eb' }}
              >
                ← Prev
              </button>
            )}
            <button
              onClick={onNext}
              className="flex-[2] py-3 rounded-2xl text-sm font-bold text-white"
              style={{ background: nextBg }}
            >
              {nextLabel}
            </button>
          </div>
        </div>
      </div>
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
