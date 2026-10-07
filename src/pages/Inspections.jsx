import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useFilterState } from '../hooks/useFilterState'
import useInspectionRegister from '../hooks/useInspectionRegister'
import { useScrollRestore } from '../hooks/useScrollRestore'
import { supabase } from '../lib/supabase'
import * as inspectionsApi from '../lib/api/inspections'
import * as correctiveActions from '../lib/api/correctiveActions'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportSheetsToExcel, exportToPdf, exportInspectionDetailPdf } from '../lib/exportUtils'
import { useTenant } from '../contexts/TenantContext'
import {
  Download, FileText, ClipboardList, Eye, GraduationCap, CheckSquare, X, Share2, ExternalLink,
  Trash2, AlertTriangle, ChevronDown, Plus, RefreshCw, PenLine,
} from 'lucide-react'
import SignaturePad from '../components/SignaturePad'
import StatusBadge from '../components/ui/StatusBadge'
import CustomFieldsPanel from '../components/CustomFieldsPanel'
import ApprovalReview from '../components/workflow/ApprovalReview'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import MultiSelectFilter from '../components/ui/MultiSelectFilter'
import EnterpriseTable from '../components/ui/EnterpriseTable'
// The shared dialog shell: focus trap, Escape, scroll lock, sized from the viewport.
import SharedModal from '../components/ui/Modal'
import { legacyPositionCode } from '../lib/tyrePositions'
import { LAYOUT_SLOTS, layoutSlotsFor, resolveLayoutKey, isTyrelessEquipment } from '../lib/vehicleTyreLayout'
import { useWakeLock, vibrate } from '../hooks/useWakeLock'
import { enqueueInspection, syncPendingInspections, getPendingCount } from '../lib/offlineQueue'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import * as userSignatureApi from '../lib/api/userSignature'
import { normaliseSignature } from '../lib/savedSignature'
import { canSignInspection } from '../lib/inspectionApproval'
import { resolveStorageUrl } from '../lib/storageRefs'
import { getTyreRunningLife } from '../lib/api/tyreRunningLife'
import { shapeRunningLife } from '../lib/tyreRunningLife'
import { buildAssetFlagMap, inspectionOverview, focusMatches, focusSummary, scopeInspections, vehicleTypesIn, SIGNOFF_FILTERS } from '../lib/inspectionTyreFlags'
import { positionLabelMap, affectedTyresSummary, affectedTyreRowsForExport } from '../lib/inspectionView'
import { tyreCompleteness, pendingCodes } from '../lib/tyreCompleteness'
import { listSites, siteRegionMap, regionForSite, regionsIn } from '../lib/api/sites'
import { trackingLink } from '../lib/tyreChangeTracking'
import { getDiagramBg } from '../lib/api/brandLogo'
import InspectionViewerDrawer from '../components/inspection/InspectionViewerDrawer'
import { vehiclePhoto } from '../lib/vehiclePhoto'
import InspectionDiagram from '../components/inspection/InspectionDiagram'
import { buildApprovalEmailHtml } from '../lib/inspectionApprovalEmail'
import { brandingForPdf, buildChecklistReportPdf, checklistReportFileName } from '../lib/inspectionChecklistReport'
import {
  toList, fromList, deriveRegisterRows, tabCounts, rowsForTab, registerKpis,
  dbInspectionType, inferVehicleTypeFromAsset, actionPriority,
} from '../lib/inspectionsAnalytics'
import OverviewSlide from '../components/inspections/OverviewSlide'
import InspectionSummaryModal from '../components/inspections/InspectionSummaryModal'
import ChecklistTab from '../components/inspections/ChecklistTab'
import InspectionFormModal from '../components/inspections/InspectionFormModal'
import RaiseActionModal from '../components/inspections/RaiseActionModal'
import InspectionWorkspace from '../components/inspections/InspectionWorkspace'
import { buildRegisterColumns } from '../components/inspections/inspectionRegisterColumns'

/**
 * INSPECTIONS REGISTER - inspections, site observations, training records and
 * the daily tyre checklist.
 *
 * This page used to be one 4,179-line file. It now keeps only what has to live
 * together - the register's scoping (filteredBase -> scoped -> filtered), the
 * writes, and the approval sign-off - and renders everything else from
 * src/components/inspections/. The pure rules live in lib/inspectionsAnalytics,
 * which is tested on its own.
 *
 * A multi-value filter survives in the URL as a comma-joined list; `toList` is
 * the ONLY place it is decoded (see lib/inspectionsAnalytics).
 */

/**
 * How long a running-life payload may be reused.
 *
 * get_tyre_running_life costs 832 ms of server time and 2.2 MB for KSA. The
 * page needs it once for its tyre-due flags; every row PDF exported in the next
 * couple of minutes can honestly reuse that same reading rather than paying for
 * it again. Short enough that a genuine tyre change shows up on the next visit.
 */
const RUNNING_LIFE_TTL_MS = 120000

// Wheel positions come from lib/vehicleTyreLayout - THE shared resolver the
// diagram itself uses.
const DEFAULT_POSITIONS = LAYOUT_SLOTS.Pickup

const EMPTY_FORM = {
  title: '', inspection_type: 'Routine', site: '', asset_no: '', tyre_serial: '',
  scheduled_date: '', status: 'Scheduled', findings: '', inspector: '', notes: '',
  attendees: '', severity: 'Medium', photo_data: null,
  vehicle_type: '', tyre_conditions: {},
}

/** One KPI tile of the register strip. N/A is printed for an unmeasurable value, never 0. */
function RegisterKpi({ label, value, sub, tone }) {
  return (
    <div className="card py-3 px-4 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-0.5" style={{ color: tone || 'var(--text-primary)' }}>
        {value == null ? 'N/A' : value}
      </p>
      {sub && <p className="text-[11px] text-[var(--text-dim)] truncate">{sub}</p>}
    </div>
  )
}

export default function Inspections() {
  const { profile, loading: authLoading, isSuperAdmin } = useAuth()
  const { activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const { t } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const isTyreMan = profile?.role === 'Tyre Man'
  const isAdmin = isSuperAdmin || (profile?.role || '').toLowerCase() === 'admin'
  /**
   * WHO MAY SIGN OFF AN INSPECTION.
   *
   * The page had NO gate at all: anyone who could open the approval modal could sign
   * and approve. This one MIRRORS the server's rule rather than inventing a second
   * idea of who may approve - `decide_inspection_approval` refuses anyone outside
   * Admin / Manager / Director / Maintenance Supervisor, and that RPC is now the only
   * write path, so it is the real boundary.
   *
   * The set is deliberately the SAME shape on both sides: a screen that refuses
   * someone the server allows is just as broken as one that offers a control the
   * server will reject. It is therefore read from `canSignInspection`, the one
   * mirror of the RPC's own role list, rather than assembled here.
   *
   * THE LIST THAT USED TO SIT HERE WAS WRONG IN BOTH DIRECTIONS, and the comment
   * describing it was stale: it reused ANALYTICS_ROLES (Admin/Manager/Director)
   * plus Maintenance Supervisor, none of which the RPC has admitted since V600,
   * while omitting PMV Manager and both area-manager roles, which it does. A
   * per-user 'approve' capability is no longer consulted either - the RPC is a
   * bare role test, so a grant could only ever produce a button that fails.
   */
  const canApproveInspection = canSignInspection(profile?.role, { isSuperAdmin })
  const { rows: inspectionRows, loading, error: loadError, reload: load } = useInspectionRegister({
    country: activeCountry,
    actorId: profile?.id,
    role: profile?.role,
    createdBy: profile?.role === 'Tyre Man' && profile?.id ? profile.id : undefined,
    enabled: !authLoading,
  })
  const rows = useMemo(() => deriveRegisterRows(inspectionRows), [inspectionRows])
  // Multi-select bulk delete (Admin only)
  const [selectedIds, setSelectedIds]     = useState(() => new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [summaryOpen, setSummaryOpen]     = useState(false)
  const [bulkError, setBulkError]         = useState('')
  const [bulkBusy, setBulkBusy]           = useState(false)
  // A read that FAILED and a register that is genuinely empty are opposite facts.
  // fetchAllPages' error used to be discarded, so a permission or network failure
  // rendered as 0 inspections with every tile confidently reading 0.
  const [form, setForm]         = useState(null)
  // Approval-engine lock for the record open in the edit modal. Set from
  // <EntityApprovalPanel/> onStateChange; while true the record is mid-approval
  // (pending/in_review/returned) or approved, so edits/saves are blocked.
  const [wfLocked, setWfLocked] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [saveError, setSaveError] = useState(null)
  // The register's filters live in the URL (useFilterState) so they SURVIVE
  // drilling out to the tyre-change tracking page and pressing Back, and so a
  // filtered view can be shared. The keys are deliberately distinct from the
  // page's existing deep-link params (`asset`, `approve`), which useFilterState
  // leaves untouched.
  const [filters, setFilter, , , setFilters] = useFilterState({
    search: '', status: 'all', site: 'all', region: 'all', inspector: 'all',
    vehicleType: 'all',
    // Sign-off: all | unsigned | not_approved | approved_unsigned (SIGNOFF_FILTERS).
    signoff: 'all',
    from: '', to: '',
    // Which overview tile the register is drilled into ('all' = none). URL-borne with
    // the rest, so a focused view survives Back from the tracking page and can be shared.
    focus: 'all',
  })
  const filterStatus = filters.status
  const filterSite = filters.site
  // Region is not a column on an inspection - it is read from the site
  // register, so it stays recorded in one place. See siteRegionMap.
  const filterRegion = filters.region
  const filterInspector = filters.inspector
  // Vehicle type IS a column on the inspection (100% populated on the live table),
  // so unlike region it needs no resolver.
  const filterVehicleType = filters.vehicleType
  const filterSignoff = filters.signoff || 'all'
  // Which overview tile the register is drilled into, if any.
  const filterFocus = filters.focus
  const [siteRows, setSiteRows]         = useState([])
  // The advanced filters collapse behind one toggle, the same as the accident
  // register: a row of eight controls above a table is read as clutter, and the
  // two people use every day (search and status) stay out here. It opens on
  // arrival when a restored URL already carries one of the collapsed filters -
  // a filter that is applied but hidden reads as a wrong result, not a filter.
  const [showFilters, setShowFilters]   = useState(
    () => filters.site !== 'all' || filters.region !== 'all'
      || filters.inspector !== 'all' || filters.vehicleType !== 'all'
      || (filters.signoff && filters.signoff !== 'all')
      || !!filters.from || !!filters.to,
  )
  // Client-side date range on the register (scheduled_date, falling back to
  // completed_date, then created_at). Empty = existing behavior.
  const filterFrom = filters.from
  const filterTo = filters.to
  // Tyre-change flags: per-asset overdue/due-soon tyres from the running-life
  // calc. null = not loaded (still checking, or the read failed).
  const [flagMap, setFlagMap]           = useState(null)
  /**
   * THREE OUTCOMES THAT MUST NEVER LOOK ALIKE: we are still checking, we could
   * not look, and we looked and no tyre is due. The card used to render one
   * line ("Tyre life data unavailable") for the first two and could not say the
   * third at all, so a clean fleet and a broken read were the same screen.
   */
  const [flagStatus, setFlagStatus]     = useState('loading') // loading | ok | error
  const [flagError, setFlagError]       = useState('')
  const [flagReload, setFlagReload]     = useState(0)
  const search = filters.search
  const [deleteId, setDeleteId]         = useState(null)
  const [activeTab, setActiveTab]       = useState('all')
  const registerTopRef = useRef(null)
  // Lock TyreMan to checklist tab; switch to checklist if asset param present
  useEffect(() => {
    if (isTyreMan || searchParams.get('asset')) setActiveTab('checklist')
  }, [isTyreMan, searchParams])

  // Approver landing: ?approve=<inspection_id>
  useEffect(() => {
    const approveId = searchParams.get('approve')
    if (!approveId || authLoading) return
    inspectionsApi.getInspectionForPage(approveId)
      .then(data => {
        if (data) { setApproveTarget(data); setShowApproveModal(true) }
      })
      .catch(() => { /* silent - invalid/inaccessible approve link */ })
  }, [searchParams, authLoading])
  // Drops only the consumed approve key, leaving the register's own filter
  // params in place.
  const clearApproveParam = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('approve')
      return next
    }, { replace: true })
  }, [setSearchParams])
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
  // Where the mark in the pad came from, so the screen can SAY it is the saved
  // one. A signature that simply appeared, unexplained, is indistinguishable
  // from the app signing on the approver's behalf.
  const [approverSigSource, setApproverSigSource] = useState('none')
  const [savedSig, setSavedSig]                 = useState(null)
  const [showApproverPad, setShowApproverPad]   = useState(false)
  const [approveSubmitting, setApproveSubmitting] = useState(false)

  const [approveMsg, setApproveMsg]             = useState(null)
  // Reason for returning an inspection. The RPC files it in inspection_audit_log,
  // which this screen does not read, so it is also echoed onto the record itself.
  const [approveNote, setApproveNote]           = useState('')

  /**
   * PRE-FILL THE APPROVER'S OWN SAVED SIGNATURE (V601).
   *
   * 379 inspections have been signed off on this system and every one of those
   * marks was drawn from scratch on the spot. The saved one is loaded when the
   * approve modal opens on a record that is still waiting, so the approver looks
   * at it instead of redrawing it.
   *
   * IT DOES NOT APPROVE ANYTHING. The mark is only placed in the pad; it is
   * rendered on screen, labelled as the saved one, and the approve button still
   * has to be pressed. An already-approved record is skipped entirely - offering
   * a fresh signature over a decision that is already made is exactly what the
   * modal above refuses to do.
   */
  useEffect(() => {
    if (!showApproveModal || !approveTarget) return undefined
    if (approveTarget.approval_status === 'approved') return undefined
    if (!canApproveInspection) return undefined
    let cancelled = false
    userSignatureApi.getMySignature().then((value) => {
      if (cancelled) return
      const v = normaliseSignature(value)
      if (!v) return
      setSavedSig(v)
      // Never overwrite a mark the person has just drawn in this session, and
      // never relabel one that is already accounted for.
      setApproverSig((cur) => (cur || v))
      setApproverSigSource((cur) => (cur === 'none' ? 'saved' : cur))
    })
    return () => { cancelled = true }
  }, [showApproveModal, approveTarget, canApproveInspection])
  // Mobile PDF preview
  const [pdfBlobUrl, setPdfBlobUrl]   = useState(null)
  const [showPdfPreview, setShowPdfPreview] = useState(false)
  const diagramRef     = useRef(null)
  // Offscreen copy of the SAME diagram, always mounted once a checklist is saved,
  // so the PDF report can capture it even though the on-screen form (and its
  // diagram) is replaced by the saved-confirmation view.
  const checklistPdfDiagramRef = useRef(null)
  const [clSelectedPos, setClSelectedPos] = useState(null)
  // Row PDF export: render the live diagram offscreen, then capture its SVG.
  const [pdfRow, setPdfRow] = useState(null)
  const pdfDiagramRef = useRef(null)
  // Read a record in place. Holds an id, not a row: the drawer loads the full
  // record (signatures included, which the register list no longer carries).
  const [viewId, setViewId] = useState(null)
  // The report's QR code lands here: ?view=<inspection_id> opens that record
  // (RLS still decides whether the reader may see it).
  useEffect(() => {
    const id = searchParams.get('view')
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setViewId(id)
  }, [searchParams])
  const [pdfBusyId, setPdfBusyId] = useState(null)
  const [pdfError, setPdfError] = useState('')
  // An export failure is reported on its own line, not through the approval modal's message slot.
  const [exportError, setExportError] = useState('')

  /**
   * Export one inspection's report.
   *
   * Takes the id, not the list row, because the register list deliberately
   * omits the signature columns and this report prints both signatures. Fetching
   * the one row here is what keeps them off the list read.
   */
  const exportRowPdf = useCallback(async (rowOrId) => {
    const id = typeof rowOrId === 'string' ? rowOrId : rowOrId?.id
    if (!id || pdfBusyId) return
    setPdfBusyId(id); setPdfError('')
    try {
      const full = await inspectionsApi.getInspectionForPage(id)
      if (!full) throw new Error('The inspection is no longer available. Refresh the register and retry.')
      setPdfRow(full)
    } catch (err) {
      setPdfError(toUserMessage(err, 'Could not load the full inspection. Retry the download.'))
      setPdfBusyId(null)
    }
  }, [pdfBusyId])

  useEffect(() => {
    if (!pdfRow) return
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        // Photos captured during the inspection: per-position tp-storage refs
        // (mobile) + the row-level photo, resolved to signed URLs. Best-effort -
        // an unresolvable photo is skipped, never a blocked report.
        const photoRefs = []
        // The SAME labels the on-screen photo grid prints (positionLabelMap),
        // so the downloaded copy and the record on screen cannot name one wheel
        // two different ways.
        const pdfPosLabels = positionLabelMap(pdfRow)
        for (const [pos, d] of Object.entries(pdfRow.tyre_conditions || {})) {
          const ref = d && typeof d === 'object' ? (d.photo_url || d.photo_uri) : null
          if (ref) photoRefs.push({ label: pdfPosLabels[pos] || pos, ref })
        }
        if (pdfRow.photo_data) photoRefs.push({ label: 'Inspection photo', ref: pdfRow.photo_data })
        const photos = (await Promise.all(photoRefs.map(async (p) => {
          try { const url = await resolveStorageUrl(p.ref); return url ? { label: p.label, url } : null }
          catch { return null }
        }))).filter(Boolean)

        // Expected life for this asset's fitted tyres (best-effort). Asked for
        // BY ASSET (V526) - this used to pull all 3,595 rows / 2.2 MB on every
        // single row export just to filter down to that asset's dozen.
        // With no asset on the record there is nothing to look up, so we do not
        // ask (an empty asset would read as "no filter" and pull the fleet).
        let lifeRows = []
        if (pdfRow.asset_no) {
          try {
            const payload = await getTyreRunningLife({
              country: pdfRow.country, maxAgeMs: RUNNING_LIFE_TTL_MS, asset: pdfRow.asset_no,
            })
            lifeRows = shapeRunningLife(payload).rows
          } catch { lifeRows = [] }
        }

        // The ACTUAL app diagram (colored per condition + PSI marked), rendered
        // offscreen below - captured so the report embeds the same SVG the
        // operator sees. Falls back to the programmatic map when absent.
        const svgEl = pdfDiagramRef.current?.querySelector('svg[data-tyre-map]') || null
        const diagramBg = (await getDiagramBg().catch(() => '')) || '#000000'
        await exportInspectionDetailPdf(pdfRow, {
          branding: await brandingForPdf(branding), company, photos, lifeRows, svgEl, diagramBg,
          vehiclePhotoUrl: vehiclePhoto(pdfRow),
        })
      } catch (err) { if (!cancelled) setPdfError(toUserMessage(err, 'Could not create the inspection PDF. Retry the download.')) }
      finally { if (!cancelled) { setPdfRow(null); setPdfBusyId(null) } }
    }, 80)
    return () => { cancelled = true; clearTimeout(t) }
  }, [pdfRow, branding, company])

  // PWA - Screen Wake Lock during inspection
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

  // Country-scoped, and PAGED inside the service: the unpaged read stopped at
  // PostgREST's 1000-row cap while the fleet holds 1,617, so the tail of the
  // fleet was simply absent from this picker with nothing to say so.
  //
  // Fetched ONLY for the checklist tab, which is the only thing that uses it
  // (the asset datalist and the site select). It used to run on every mount of
  // the page, so opening the register pulled the whole fleet - 1,617 rows over
  // two paged round trips - to populate a picker that was not on screen.
  const fleetLoaded = useRef(null)
  useEffect(() => {
    if (activeTab !== 'checklist') return
    if (fleetLoaded.current === activeCountry) return
    fleetLoaded.current = activeCountry
    inspectionsApi.listInspectionVehicles({ country: activeCountry }).then(data => {
      if (!data) return
      setMasterSites([...new Set(data.map(r => r.site).filter(Boolean))].sort())
      setMasterAssets(data.filter(r => r.asset_no).sort((a, b) => a.asset_no.localeCompare(b.asset_no)))
    }).catch(() => { /* silent - master data best-effort */ })
  }, [activeCountry, activeTab])

  // Geolocation auto-site detection (best-effort) - declared after masterSites
  // so its dependency array is not evaluated before that state exists.
  const geoAttempted = useRef(false)
  useEffect(() => {
    if (activeTab !== 'checklist' || geoAttempted.current) return
    geoAttempted.current = true
    if (!navigator.geolocation || masterSites.length === 0) return
    navigator.geolocation.getCurrentPosition(
      () => { /* future: match to nearest site from geo coordinates */ },
      () => { /* permission denied - ignore */ },
      { timeout: 6000, maximumAge: 60000 }
    )
  }, [activeTab, masterSites])

  useEffect(() => {
    const name = profile?.full_name || profile?.username || ''
    if (name) setClInspector(current => current || name)
  }, [profile])

  // Best-effort: the register must still open when the site list cannot be
  // read. With no sites the region control simply does not render, rather than
  // offering a filter that can never match anything.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    listSites({ country: activeCountry })
      .then((r) => { if (!cancelled) setSiteRows(Array.isArray(r) ? r : []) })
      .catch(() => { if (!cancelled) setSiteRows([]) })
    return () => { cancelled = true }
  }, [activeCountry, authLoading])

  // Best-effort running-life fetch (never blocks the page): builds the
  // per-asset tyre-due flag map used by the slides, row chips and banners.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    // dueOnly: the flag map KEEPS ONLY overdue/due-soon rows, so asking for the
    // whole set and throwing the rest away was a 7.7x over-fetch on every page
    // load (KSA: 465 rows kept of 3,595 pulled, 285 kB instead of 2.2 MB).
    setFlagStatus('loading'); setFlagError('')
    getTyreRunningLife({ country: activeCountry, maxAgeMs: RUNNING_LIFE_TTL_MS, dueOnly: true }).then((payload) => {
      if (cancelled) return
      const shaped = shapeRunningLife(payload)
      if (!shaped.ok) {
        setFlagMap(null)
        setFlagStatus('error')
        setFlagError(payload?.reason || '')
        return
      }
      // An empty map here is a MEASUREMENT, not a gap: we asked the server for
      // every due tyre and it returned none.
      setFlagMap(buildAssetFlagMap(shaped.rows))
      setFlagStatus('ok')
    }).catch((e) => {
      if (cancelled) return
      setFlagMap(null); setFlagStatus('error'); setFlagError(toUserMessage(e))
    })
    return () => { cancelled = true }
  }, [activeCountry, authLoading, flagReload])

  const sites = useMemo(() => [...new Set(rows.map(r => r.site).filter(Boolean))].sort(), [rows])
  const regionMap = useMemo(() => siteRegionMap(siteRows), [siteRows])
  // Only the regions the sites ON SCREEN actually belong to. Listing every
  // region in the register would offer choices that return nothing.
  const regions = useMemo(() => regionsIn(regionMap, sites), [regionMap, sites])
  const inspectors = useMemo(
    () => [...new Set(rows.map(r => r.inspector).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const tabFiltered = useMemo(() => rowsForTab(rows, activeTab), [rows, activeTab])

  /**
   * THE ROWS EVERY FILTER EXCEPT THE STATUS PILLS AND THE TILE DRILL-DOWN LEAVES.
   *
   * Split out because each of the three surfaces above the table has to hold its OWN
   * dimension out, or it reports a number nobody can act on:
   *   - the status pills must count as if their own status were not applied, else
   *     picking "Done" prints (0) on every other pill and there is no way back;
   *   - the overview tiles must not apply the drill-down they themselves set, else
   *     clicking "Approved" zeroes "Pending approval" and the tiles stop being a
   *     summary the moment you use them.
   * Everything else - region, site, inspector, dates, search - narrows all three.
   */
  const filteredBase = useMemo(
    () => scopeInspections(
      tabFiltered,
      {
        // DECODED here, not passed raw. The URL holds "TR-MIXER,PUMPS"; handing
        // that string to the predicate would compare it as ONE value and match
        // nothing, with no error to show for it.
        site: toList(filterSite), region: toList(filterRegion),
        inspector: toList(filterInspector), vehicleType: toList(filterVehicleType),
        from: filterFrom, to: filterTo, search, signoff: filterSignoff,
      },
      // Region lives on the site register, not on the inspection, so the resolver is
      // injected and the rule itself stays a pure, tested function.
      { regionOf: (site) => regionForSite(regionMap, site) },
    ),
    [tabFiltered, filterSite, filterRegion, filterInspector, filterVehicleType,
      regionMap, filterFrom, filterTo, search, filterSignoff],
  )

  // Only the machine classes the loaded inspections actually cover. The fleet
  // register knows 23 types where inspections have only ever used 9, and offering
  // the other 14 would be 14 choices that return nothing.
  const vehicleTypes = useMemo(() => vehicleTypesIn(tabFiltered), [tabFiltered])

  /**
   * WHAT THE OVERVIEW TILES COUNT: every filter the table applies except the tile
   * drill-down. Before this the tiles were computed over `tabFiltered` with only the
   * date window, so a register showing "195 of 407 shown" for one region still printed
   * 407 inspections done above it - two numbers answering different questions in the
   * same viewport, which is the confusion being fixed.
   */
  const scoped = useMemo(
    () => (filterStatus === 'all' ? filteredBase : filteredBase.filter(x => x.status === filterStatus)),
    [filteredBase, filterStatus],
  )

  const filtered = useMemo(() => {
    let r = scoped
    // The overview drill-down runs LAST, over the rows the other filters left, so a
    // focused tile narrows what is on screen rather than replacing it.
    if (filterFocus && filterFocus !== 'all') r = r.filter(x => focusMatches(x, filterFocus, flagMap || {}))
    return r
  }, [scoped, filterFocus, flagMap])

  // Vehicles with tyres due ACROSS THE COUNTRY (the flag map is not limited to
  // the inspections on screen). Lets the card tell "nothing is due anywhere"
  // apart from "nothing is due on the vehicles you are looking at".
  const dueAssetCount = useMemo(() => (flagMap ? Object.keys(flagMap).length : 0), [flagMap])

  /**
   * Is the register showing a NARROWED set? Drives the "these figures cover N of M"
   * caption on the tiles. The tile drill-down is excluded on purpose: it is set FROM
   * the tiles and already has its own banner under the search box.
   */
  const scopeActive = filterStatus !== 'all' || filterSite !== 'all' || filterRegion !== 'all'
    || filterInspector !== 'all' || filterVehicleType !== 'all' || filterSignoff !== 'all'
    || !!filterFrom || !!filterTo || !!search

  // Tile numbers over the SAME rows the table is showing (minus the drill-down).
  // `scoped` has already had the date window applied by the register's own rule, so
  // no second window is passed - one date test, one answer.
  const overview = useMemo(
    () => inspectionOverview(scoped, flagMap || {}),
    [scoped, flagMap]
  )

  // What the focused view is showing, in the TILE'S OWN UNIT. Three of the tiles count
  // tyres or vehicles rather than inspections, so the row count is legitimately smaller
  // than the tile and the banner says so instead of leaving it looking like lost rows.
  const focusInfo = useMemo(
    () => (filterFocus && filterFocus !== 'all'
      ? focusSummary(filtered, filterFocus, flagMap || {})
      : null),
    [filtered, filterFocus, flagMap]
  )

  const counts = useMemo(() => tabCounts(rows), [rows])
  // Status / completion headline over the SAME rows the tiles count.
  const kpis = useMemo(() => registerKpis(scoped), [scoped])

  /**
   * Status pill counts, over every OTHER filter (including the tile drill-down) but
   * NOT the status filter itself - so each pill states exactly how many rows clicking
   * it would show. Counting these over the already-status-filtered list made every
   * pill except the selected one read (0), which reads as "there is nothing there".
   */
  const statusCounts = useMemo(() => {
    const base = (filterFocus && filterFocus !== 'all')
      ? filteredBase.filter(x => focusMatches(x, filterFocus, flagMap || {}))
      : filteredBase
    const c = { all: base.length, Scheduled: 0, 'In Progress': 0, Done: 0, Overdue: 0, Cancelled: 0 }
    base.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    return c
  }, [filteredBase, filterFocus, flagMap])

  /**
   * THE REGISTER IS READ ONE PAGE AT A TIME, by EnterpriseTable.
   *
   * The table is handed `filtered` - the FULL filtered set - and pages and
   * sorts it itself. Nothing above the table (tiles, pill counts, the "N of M
   * shown" caption) or either export reads a page, so a headline never quietly
   * becomes a per-page number. The table is re-keyed on the filter signature
   * so a narrowed result always opens on its first page.
   */
  const registerKey = [activeTab, filterStatus, filterSite, filterRegion, filterInspector,
    filterVehicleType, filterSignoff, filterFrom, filterTo, search, filterFocus].join('|')

  // Puts the register back where it was scrolled to when the user returns from
  // the tyre-change tracking page. The table now scrolls with the page, so the
  // shell's own scrolling ancestor is what is saved and restored.
  const registerRef = useScrollRestore('inspections', !loading && filtered.length > 0)

  const registerColumns = useMemo(() => buildRegisterColumns({
    t,
    flagMap,
    pdfBusyId,
    onView: (r) => setViewId(r.id),
    onMarkDone: (r) => markDone(r.id),
    onRaiseAction: (r) => setRaisingAction(r),
    onEdit: (r) => setForm({ ...r, tyre_conditions: r.tyre_conditions ?? {} }),
    onExportPdf: (r) => exportRowPdf(r),
    onDelete: (r) => setDeleteId(r.id),
  // markDone is a stable function declaration over `load`; the rest are listed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [t, flagMap, pdfBusyId, exportRowPdf])

  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setForm(f => ({ ...f, photo_data: ev.target.result }))
    reader.readAsDataURL(file)
  }

  // Reset the approval lock whenever a different record is opened in the modal;
  // <EntityApprovalPanel/> re-reports the true state via onStateChange on mount.
  useEffect(() => { setWfLocked(false) }, [form?.id])

  // A note and a drawn signature belong to ONE decision. Carrying either across to the
  // next record would attach one person's signature to another inspection.
  useEffect(() => {
    setApproveNote('')
    setApproverSig(null)
    setApproveMsg(null)
  }, [approveTarget?.id])

  /**
   * Re-read the decided inspection from the server instead of echoing what we hoped was
   * written. The RPC derives the approver, the timestamp and the lock, so the only
   * honest way to show them is to ask. `optimistic` is a fallback for the case where the
   * re-read itself fails - the decision is already committed, and showing the previous
   * state would be a lie in the other direction.
   */
  const refreshApproveTarget = useCallback(async (optimistic = null) => {
    try {
      const fresh = await inspectionsApi.getInspectionForPage(approveTarget?.id)
      if (fresh) { setApproveTarget(fresh); return }
    } catch { /* fall through to the optimistic shape below */ }
    if (optimistic) setApproveTarget(prev => (prev ? { ...prev, ...optimistic } : prev))
  }, [approveTarget?.id])

  async function save() {
    if (wfLocked) return
    if (!form.title?.trim()) return
    if (!form.site?.trim()) return
    if (!form.scheduled_date) return
    setSaving(true)
    setSaveError(null)
    const displayType = form.inspection_type
    // Send ONLY real, writable columns. Spreading the whole `form` used to leak
    // read-only / generated columns from a loaded edit row into the insert or
    // update, which failed with a raw "column not compatible" database error.
    const WRITABLE_COLS = [
      'title', 'inspection_type', 'site', 'asset_no', 'tyre_serial', 'scheduled_date',
      'completed_date', 'inspection_date', 'status', 'findings', 'inspector', 'notes',
      'attendees', 'severity', 'photo_data', 'vehicle_type', 'tyre_conditions',
      'odometer_km', 'hour_meter', 'pressure_reading', 'approval_status', 'region',
    ]
    const base = {}
    for (const k of WRITABLE_COLS) if (form[k] !== undefined) base[k] = form[k]
    const payload = {
      ...base,
      created_by: profile?.id ?? null,
      // Persist a CHECK-valid inspection_type; carry the true display type
      // (observation/training) in custom_data so it round-trips on read.
      inspection_type: dbInspectionType(displayType),
      custom_data: { ...(form.custom_data || {}), record_type: displayType },
    }

    try {
      if (form.id) {
        await inspectionsApi.patchInspection(form.id, payload)
      } else {
        await inspectionsApi.insertInspection(payload)
      }
      setForm(null)
      await load()
    } catch (error) {
      setSaveError(toUserMessage(error, 'Could not save the inspection. Please check the required fields and try again.'))
    }
    setSaving(false)
  }

  async function markDone(id) {
    try {
      await inspectionsApi.patchInspection(id, {
        status: 'Done',
        completed_date: new Date().toISOString().split('T')[0],
      })
    } catch { /* mirror prior fire-and-forget: proceed to reload regardless */ }
    await load()
  }

  async function confirmDelete() {
    try {
      await inspectionsApi.deleteInspection(deleteId)
    } catch { /* mirror prior fire-and-forget: proceed to reload regardless */ }
    setDeleteId(null)
    await load()
  }

  // ── Multi-select bulk delete (Admin only) ─────────────────────────────────────
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  // Every row the FILTERS left, not just the page on screen - the delete button
  // then states the real count, so a bulk delete can never be larger than it reads.
  const pageIds = filtered.map(r => r.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id))
  const rowSelection = useMemo(
    () => Object.fromEntries([...selectedIds].map((id) => [String(id), true])),
    [selectedIds],
  )
  const onRowSelectionChange = useCallback((next) => {
    const byKey = new Map(filtered.map((r) => [String(r.id), r.id]))
    setSelectedIds(new Set(Object.keys(next).filter((k) => next[k]).map((k) => byKey.get(k) ?? k)))
  }, [filtered])
  function toggleSelectPage() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allPageSelected) pageIds.forEach(id => next.delete(id))
      else pageIds.forEach(id => next.add(id))
      return next
    })
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
          .from('inspections').delete().in('id', chunk).select('id')
        if (error) throw error
        deleted += data?.length ?? 0
      }
      if (deleted === 0) {
        throw new Error('No rows were deleted. You may not have permission (Admin only) or they were already removed.')
      }
      setBulkDeleteOpen(false)
      setSelectedIds(new Set())
      await load()
    } catch (e) {
      setBulkError(toUserMessage(e, 'Bulk delete failed. Please try again.'))
    } finally {
      setBulkBusy(false)
    }
  }

  async function raiseAction(row, actionTitle) {
    try {
      const data = await correctiveActions.createCorrectiveAction({
        title: actionTitle || `Action from: ${row.title}`,
        description: row.findings || row.notes || '',
        site: row.site,
        asset_no: row.asset_no || null,
        priority: actionPriority(row.severity),
        status: 'Open',
        // NOTE: corrective_actions has no `source` column — sending it 400s the insert.
        created_by: profile?.id ?? null,
      })
      if (data?.id) {
        await inspectionsApi.patchInspection(row.id, { linked_action_id: data.id })
        await load()
      }
    } catch { /* mirror prior guard: on failure, no link + no reload */ }
    setRaisingAction(null)
  }

  const loadFleetInfo = useCallback(async (assetNo) => {
    if (!assetNo.trim()) return
    setClLookingUp(true)
    // Country-scoped: the same asset code in another country is a different
    // machine (V376), so its type and site must not seed this inspection.
    const data = await inspectionsApi.findVehicleByAsset(assetNo.trim(), activeCountry).catch(() => null)
    // Use DB vehicle_type if available, otherwise infer from asset number prefix
    const vehicleType = data?.vehicle_type || inferVehicleTypeFromAsset(assetNo)
    const fleetInfo = data || (vehicleType ? { asset_no: assetNo.trim(), vehicle_type: vehicleType, site: null } : null)
    if (fleetInfo) {
      const vtKey = resolveLayoutKey(vehicleType, assetNo.trim())
      // Save the same resolved class used to collect the wheel readings, so
      // the inspection viewer and PDF cannot select a different layout later.
      setClFleetInfo({ ...fleetInfo, vehicle_type: isTyrelessEquipment(vehicleType) ? vehicleType : vtKey })
      // Tyreless equipment returns [], so the checklist offers no wheels at all
      // rather than inventing them.
      const positions = layoutSlotsFor(vehicleType, assetNo.trim())
      setClPositions(positions.map(pos => ({ position: pos, label: legacyPositionCode(vtKey, pos), pressure: '', condition: 'Good', treadDepth: '' })))
      if (fleetInfo.site) setClSite(current => current || fleetInfo.site)
    } else {
      setClFleetInfo(null)
      setClPositions(DEFAULT_POSITIONS.map(pos => ({ position: pos, label: legacyPositionCode('', pos), pressure: '', condition: 'Good', treadDepth: '' })))
    }
    setClLookingUp(false)
  }, [activeCountry])

  // Deep-link: /inspections?asset=ASSET_NO - auto-load checklist for scanned vehicle QR
  useEffect(() => {
    const assetParam = searchParams.get('asset')
    if (!assetParam || authLoading) return
    setClAsset(assetParam)
    loadFleetInfo(assetParam)
    // Remove the consumed param so a refresh does not re-trigger. Only that one
    // key is dropped: the register's filters now live in the query string too,
    // and clearing the whole string would wipe them.
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('asset')
      return next
    }, { replace: true })
  }, [searchParams, authLoading, loadFleetInfo, setSearchParams])

  /**
   * Which wheels are still outstanding on the checklist tab.
   *
   * This form has ALWAYS demanded a pressure on every seeded position, and that
   * rule stays as the floor - it is stricter than the engine's default and
   * relaxing it here would be a regression. The engine is layered ON TOP of it,
   * never in place of it, so it can only ever find MORE outstanding wheels: a
   * position the layout says the machine carries but that never made it into
   * the seeded array at all. That is the case the pressure rule cannot see,
   * because a slot that is absent has no pressure to be missing.
   *
   * `requirePressure` is on because on this surface a pressure IS the evidence.
   */
  const clCompleteness = useMemo(
    () => tyreCompleteness(
      clFleetInfo?.vehicle_type || inferVehicleTypeFromAsset(clAsset),
      clAsset,
      clPositions,
      { requirePressure: true },
    ),
    [clFleetInfo?.vehicle_type, clAsset, clPositions],
  )
  // The floor: every seeded position needs a pressure. Kept verbatim so an
  // unknown vehicle type - where the engine honestly declines to judge - can
  // never make this form easier to submit than it was before.
  const clMissingPressure = clPositions.filter((p) => !p.pressure)
  const clPendingNames = pendingCodes(clCompleteness)
  const clTyresIncomplete = clMissingPressure.length > 0 || !clCompleteness.ok

  async function saveChecklist() {
    if (!clAsset.trim() || clPositions.length === 0) return
    if (clTyresIncomplete) {
      setClError(
        clPendingNames.length > 0
          ? `${clCompleteness.summary} Still to record: ${clPendingNames.join(', ')}.`
          : t('inspections.form.psiWarning', { count: clMissingPressure.length }),
      )
      return
    }
    setClSaving(true)
    setClError(null)
    setClOffline(false)
    const payload = {
      title: `Daily Tyre Inspection: ${clSite || clAsset}, ${clDate}`,
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

    try {
      const data = await inspectionsApi.insertInspectionReturning(payload)
      setClSaved(data)
      vibrate([80, 30, 80, 30, 200])
      await load()
    } catch (error) {
      if (!navigator.onLine || error?.message?.includes('fetch')) {
        // Offline - enqueue for later sync
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
        setClError(toUserMessage(error, 'Save failed. Please try again.'))
        vibrate(300)
      }
    }
    setClSaving(false)
  }

  async function exportChecklistPdf(preview = false) {
    if (!clSaved) return
    setClError(null)
    try {
      const doc = await buildChecklistReportPdf({
        saved: clSaved,
        asset: clAsset,
        fleetInfo: clFleetInfo,
        site: clSite,
        inspector: clInspector,
        odometer: clOdometer,
        hourMeter: clHourMeter,
        notes: clNotes,
        photos: clPhotos,
        signature: clSignature,
        approverEmail: clApproverEmail,
        country: activeCountry,
        // The shared inspection viewer's diagram from the saved record.
        svgEl: checklistPdfDiagramRef.current?.querySelector('svg[data-tyre-map]') || null,
        branding,
        company,
      })
      if (preview) {
        const url = URL.createObjectURL(doc.output('blob'))
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
        setPdfBlobUrl(url)
        setShowPdfPreview(true)
      } else {
        doc.save(checklistReportFileName(clAsset || clSaved.asset_no))
      }
    } catch (err) {
      setClError(toUserMessage(err, 'Could not create the checklist report. Try again.'))
    }
  }

  function resetChecklist() {
    setClSaved(null); setClOffline(false); setClAsset(''); setClPositions([])
    setClFleetInfo(null); setClNotes(''); setClOdometer(''); setClHourMeter('')
    setClPhotos([]); setClSignature(null); setClApprovalStatus('done')
    setClApproverEmail(''); setShowApprovalForm(false); setClError(null)
    if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); setPdfBlobUrl(null) }
    setShowPdfPreview(false)
  }

  async function sendChecklistForApproval() {
    if (!clSaved?.id) return
    setClSendingEmail(true)
    // Update DB status
    try {
      await inspectionsApi.patchInspection(clSaved.id, {
        approval_status: 'pending_approval',
        approver_email: clApproverEmail,
        status: 'In Progress',
      })
    } catch { /* mirror prior fire-and-forget: proceed to send email regardless */ }
    const approvalLink = `${window.location.origin}/inspections?approve=${clSaved.id}`
    // Send email via Edge Function
    await supabase.functions.invoke('send-email', {
      body: {
        to: clApproverEmail,
        subject: `Inspection Approval Required: Asset ${clSaved.asset_no || clAsset}`,
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
  }

  if (loading || authLoading) return <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">{t('common.loading')}</div>

  const tabConfig = [
    { key: 'all',          label: t('inspections.tabs.all'),          icon: null,            count: counts.all },
    { key: 'inspections',  label: t('inspections.tabs.inspections'),  icon: ClipboardList,   count: counts.inspections },
    { key: 'observations', label: t('inspections.tabs.observations'), icon: Eye,             count: counts.observations },
    { key: 'training',     label: t('inspections.tabs.training'),     icon: GraduationCap,   count: counts.training },
    { key: 'checklist',    label: t('inspections.tabs.checklist'),    icon: CheckSquare,     count: null },
  ]

  const defaultType = activeTab === 'observations' ? 'Site Observation'
    : activeTab === 'training' ? 'Safety Training'
    : 'Routine'

  /**
   * The register's Excel button used to export only the inspection header
   * fields - nothing said WHICH tyre was marked, so a reader could not tell a
   * clean inspection from one with a punctured or damaged wheel without
   * opening every row. Now two sheets: the inspection list itself (with a new
   * "Affected Tyres" summary column) and a "Tyre Findings" sheet carrying one
   * row per tyre marked as anything other than Good - position, condition and
   * whatever pressure/tread/notes were recorded against it.
   */
  async function exportInspectionsExcel() {
    try {
      const tyreRows = affectedTyreRowsForExport(filtered)
      await exportSheetsToExcel([
        {
          name: 'Inspections',
          rows: filtered.map((r) => ({ ...r, affected_tyres: affectedTyresSummary(r) || 'None' })),
          columns: ['inspection_type', 'title', 'site', 'asset_no', 'scheduled_date', 'status', 'severity', 'inspector', 'attendees', 'affected_tyres', 'findings'],
          headers: ['Type', 'Title', 'Site', 'Asset No', 'Date', 'Status', 'Severity', 'Inspector', 'Attendees', 'Affected Tyres', 'Findings'],
          note: 'Every inspection in the current filter. "Affected Tyres" summarises any tyre marked as anything other than Good.',
        },
        {
          name: 'Tyre Findings',
          rows: tyreRows,
          columns: ['inspection_date', 'inspection_type', 'asset_no', 'site', 'vehicle_type', 'inspector', 'position', 'condition', 'severity', 'pressure_psi', 'tread_mm', 'notes'],
          headers: ['Date', 'Type', 'Asset No', 'Site', 'Vehicle Type', 'Inspector', 'Position', 'Condition', 'Severity', 'Pressure (PSI)', 'Tread (mm)', 'Notes'],
          note: 'One row per tyre marked as anything other than Good - Damaged, Puncture, Worn, Flat, Wear and similar - so it can be filtered and actioned directly.',
          emptyNote: 'No tyre in this selection was marked as anything other than Good.',
        },
      ], 'TyrePulse_Inspections', {
        title: 'Inspections & Tyre Findings',
        meta: { 'Affected tyres found': tyreRows.length },
      })
    } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // The mockup workspace replaces the plain header on the register views. The
  // checklist capture keeps its focused header (and the Tyre Man stays there).
  const showWorkspace = !isTyreMan && activeTab !== 'checklist'
  async function openApproveFor(row) {
    try {
      const data = await inspectionsApi.getInspectionForPage(row.id)
      if (data) { setApproveTarget(data); setShowApproveModal(true) }
    } catch (e) { setExportError(toUserMessage(e, 'Could not open this inspection for sign-off.')) }
  }
  const headerActions = (
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={exportInspectionsExcel}
              disabled={filtered.length === 0}
              title={filtered.length === 0 ? 'Nothing to export under these filters' : undefined}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[40px] disabled:opacity-50"
            >
              <Download size={14}/> {t('inspections.actions.excel')}
            </button>
            <button
              onClick={async () => { try { await exportToPdf(
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
              ) } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) } }}
              type="button"
              disabled={filtered.length === 0}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 min-h-[40px] disabled:opacity-50"
            >
              <FileText size={14}/> {t('inspections.actions.pdf')}
            </button>
            <button
              type="button"
              className="btn-primary text-sm min-h-[40px] inline-flex items-center gap-1.5"
              onClick={() => setForm({ ...EMPTY_FORM, inspection_type: defaultType })}
            >
              <Plus size={14} aria-hidden /> {t('inspections.actions.addRecord')}
            </button>
          </div>
  )

  return (
    <div className="space-y-6">
      {pdfError && <p role="alert" className="card text-red-500">{pdfError}</p>}
      {exportError && (
        <div role="alert" className="card flex items-center justify-between gap-3 text-sm text-red-500">
          <span>{exportError}</span>
          <button type="button" onClick={() => setExportError('')} aria-label="Dismiss export error" className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center"><X size={14} /></button>
        </div>
      )}
      {showWorkspace ? (
        <InspectionWorkspace
          rows={scoped}
          allRows={rows}
          loading={loading}
          error={loadError}
          onRetry={load}
          flagMap={flagStatus === 'ok' ? (flagMap || {}) : null}
          actions={headerActions}
          sites={sites}
          from={filterFrom}
          to={filterTo}
          site={toList(filterSite).length === 1 ? toList(filterSite)[0] : 'all'}
          onFilter={(k, v) => setFilter(k, v)}
          onView={(r) => setViewId(r.id)}
          onPdf={(r) => exportRowPdf(r)}
          onRaiseAction={(r) => setRaisingAction(r)}
          onEdit={(r) => setForm({ ...r, tyre_conditions: r.tyre_conditions ?? {} })}
          onApprove={canApproveInspection ? openApproveFor : null}
          onObservations={() => { setActiveTab('observations'); registerTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
          onAddObservation={() => setForm({ ...EMPTY_FORM, inspection_type: 'Site Observation' })}
        />
      ) : (
        <PageHeader
          title={isTyreMan ? t('inspections.titleTyreMan') : t('inspections.title')}
          subtitle={isTyreMan ? t('inspections.subtitleTyreMan') : t('inspections.subtitle')}
          icon={ClipboardList}
          actions={isTyreMan ? null : headerActions}
        />
      )}
      <div ref={registerTopRef} />

      {/* Tabs - hidden for TyreMan (locked to checklist) */}
      {showWorkspace && (
        <div className="flex items-end justify-between gap-3 flex-wrap pt-2">
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Full register</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Every inspection, observation and training record, with filters, bulk actions and exports.</p>
          </div>
        </div>
      )}
      {!isTyreMan && <div role="tablist" aria-label="Register views" className="flex gap-1 p-1 bg-[var(--surface-2)] rounded-lg w-fit max-w-full overflow-x-auto flex-wrap">
        {tabConfig.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 min-h-[40px] py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === key
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {Icon && <Icon className="w-4 h-4" aria-hidden />}
            {label}
            {count != null && (
              <span className={`px-1.5 py-0.5 rounded-full text-xs tabular-nums ${activeTab === key ? 'bg-green-500/20 text-green-600' : 'bg-[var(--surface-3)] text-[var(--text-muted)]'}`}>
                {loadError ? 'N/A' : count}
              </span>
            )}
          </button>
        ))}
      </div>}

      {/* Checklist tab content */}
      {activeTab === 'checklist' && (
        <ChecklistTab
          lang={lang} setLang={setLang}
          clSaved={clSaved} clOffline={clOffline}
          clAsset={clAsset} setClAsset={setClAsset}
          clSite={clSite} setClSite={setClSite}
          clDate={clDate} setClDate={setClDate}
          clInspector={clInspector} setClInspector={setClInspector}
          clFleetInfo={clFleetInfo}
          clPositions={clPositions} setClPositions={setClPositions}
          clNotes={clNotes} setClNotes={setClNotes}
          clOdometer={clOdometer} setClOdometer={setClOdometer}
          clHourMeter={clHourMeter} setClHourMeter={setClHourMeter}
          clPhotos={clPhotos} setClPhotos={setClPhotos}
          clSignature={clSignature} setClSignature={setClSignature}
          clError={clError} clSaving={clSaving} clLookingUp={clLookingUp}
          clSelectedPos={clSelectedPos} setClSelectedPos={setClSelectedPos}
          clApproverEmail={clApproverEmail} setClApproverEmail={setClApproverEmail}
          clApprovalStatus={clApprovalStatus} clEmailSent={clEmailSent} clSendingEmail={clSendingEmail}
          showApprovalForm={showApprovalForm} setShowApprovalForm={setShowApprovalForm}
          /* The ONE gate value: the Save button and saveChecklist read the same
             clTyresIncomplete, computed above from the pressure floor OR the
             completeness engine. */
          clTyresIncomplete={clTyresIncomplete}
          clMissingPressure={clMissingPressure}
          clPendingNames={clPendingNames}
          pendingCount={pendingCount}
          masterAssets={masterAssets} masterSites={masterSites} sites={sites}
          flagMap={flagMap}
          diagramRef={diagramRef}
          cameraInputRef={cameraInputRef} galleryInputRef={galleryInputRef}
          loadFleetInfo={loadFleetInfo}
          saveChecklist={saveChecklist}
          exportChecklistPdf={exportChecklistPdf}
          onNewChecklist={resetChecklist}
          onSendForApproval={sendChecklistForApproval}
          onOpenSignaturePad={() => setShowSignaturePad(true)}
          onPhotoError={(e) => setClError(toUserMessage(e, 'Could not read that photo. Try another one.'))}
        />
      )}

      {/* Signature Pad Modal */}
      {showSignaturePad && (
        <SignaturePad
          label={t('inspections.form.inspectorSignature')}
          inspectorName={clInspector}
          employeeId={profile?.employee_id || ''}
          onSave={dataUrl => { setClSignature(dataUrl); setShowSignaturePad(false) }}
          onClose={() => setShowSignaturePad(false)}
        />
      )}

      {/* ── Approver Modal (opens when landing via ?approve=<id>) ── */}
      {showApproveModal && approveTarget && (
        <ApprovalReview key={approveTarget.id} entityType="inspection" entityId={approveTarget.id}
          title={approveTarget.title || approveTarget.asset_no}
          onClose={() => { setShowApproveModal(false); clearApproveParam() }}
          onActed={() => { refreshApproveTarget(); load() }}
          legacy={
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
                <div style={{ fontSize: 16, fontWeight: 700, color:'var(--panel-ink)' }}>{t('inspections.approve.title')}</div>
                <div style={{ fontSize: 12, color: 'var(--panel-ink-3)', marginTop: 2 }}>
                  {t('inspections.approve.asset')} <strong style={{ color: 'var(--panel-ink-2)' }}>{approveTarget.asset_no}</strong>
                  {approveTarget.site ? ` · ${approveTarget.site}` : ''}
                  {' · '}{approveTarget.inspection_date || approveTarget.scheduled_date}
                </div>
                {approveTarget.approval_status && (
                  <div style={{ marginTop: 8 }}>
                    <StatusBadge status={approveTarget.approval_status} label={String(approveTarget.approval_status).replace(/_/g, ' ')} size={26} />
                  </div>
                )}
              </div>
              <button type="button" aria-label="Close approval" onClick={() => { setShowApproveModal(false); clearApproveParam() }}
                style={{ background: 'none', border: 'none', color: 'var(--panel-ink-3)', cursor: 'pointer', minWidth: 44, minHeight: 44 }}>
                <X size={20} />
              </button>
            </div>

            {/* Details */}
            <div style={{ background: 'var(--panel-2)', borderRadius: 12, padding: 16, marginBottom: 16, fontSize: 13 }}>
              {[
                [t('inspections.approve.fields.inspector'), approveTarget.inspector_name || approveTarget.inspector],
                [t('inspections.approve.fields.type'), approveTarget.inspection_type],
                [t('inspections.approve.fields.odometer'), approveTarget.odometer_km ? `${approveTarget.odometer_km} km` : null],
                [t('inspections.approve.fields.hourMeter'), approveTarget.hour_meter ? `${approveTarget.hour_meter} hrs` : null],
                [t('inspections.approve.fields.notes'), approveTarget.notes],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: 'var(--panel-ink-4)', minWidth: 100 }}>{k}</span>
                  <span style={{ color: 'var(--panel-ink-2)', fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Additional imported fields */}
            <div style={{ marginBottom: 16 }}>
              <CustomFieldsPanel data={approveTarget.custom_data} title={t('inspections.approve.additionalFields')} />
            </div>

            {/* Inspector signature preview */}
            {approveTarget.inspector_signature && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-ink-4)', textTransform: 'uppercase', marginBottom: 6 }}>{t('inspections.form.inspectorSignature')}</div>
                <img src={approveTarget.inspector_signature} alt="Inspector signature"
                  style={{ maxWidth: 200, border: '1px solid var(--hairline)', borderRadius: 8 }} />
              </div>
            )}

            {/* Approver signature.

                Three distinct states, and they must not be collapsed:
                  - ALREADY APPROVED  -> show the signature that was stored and when.
                    Offering a blank pad on a signed-off record invites a second
                    signature over a decision that is already made.
                  - MAY SIGN          -> the pad, required before Approve enables.
                  - MAY NOT SIGN      -> say who can, rather than a dead control. */}
            {approveTarget.approval_status === 'approved' ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-ink-4)', textTransform: 'uppercase', marginBottom: 8 }}>{t('inspections.approve.approverSignature')}</div>
                {approveTarget.approver_signature ? (
                  <img src={approveTarget.approver_signature} alt="Approver signature"
                    style={{ maxWidth: 200, border: '1px solid var(--hairline)', borderRadius: 8 }} />
                ) : (
                  /* Approved before a signature was required. Stated, never implied. */
                  <div style={{ fontSize: 12, color: 'var(--panel-ink-3)' }}>No signature was recorded with this approval.</div>
                )}
                <div style={{ fontSize: 11, color: 'var(--panel-ink-3)', marginTop: 6 }}>
                  {approveTarget.approved_at
                    ? `Signed off on ${formatDate(approveTarget.approved_at)}`
                    : 'Sign-off date not recorded'}
                  {approveTarget.approved_by && profile?.id && approveTarget.approved_by === profile.id ? ' by you' : ''}
                </div>
              </div>
            ) : !canApproveInspection ? (
              <div style={{
                marginBottom: 16, padding: '12px 14px', borderRadius: 10,
                background: 'var(--panel-2)', border: '1px solid var(--hairline)',
                fontSize: 12, color: 'var(--panel-ink-3)',
              }}>
                You can read this inspection, but signing it off is limited to Admin, Manager,
                Director and Maintenance Supervisor. Ask one of them to sign it, or ask an admin
                to grant you approve access to Inspections.
              </div>
            ) : (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-ink-4)', textTransform: 'uppercase', marginBottom: 8 }}>{t('inspections.approve.yourSignature')}</div>
              {approverSig ? (
                <div>
                  <img src={approverSig} alt="Approver signature"
                    style={{ maxWidth: 200, border: '1px solid var(--hairline)', borderRadius: 8 }} />
                  {/* WHERE THIS MARK CAME FROM, said out loud. A signature that
                      appeared on its own reads as the app signing for you. */}
                  {approverSigSource === 'saved' && (
                    <div style={{ fontSize: 11, color: 'var(--panel-ink-3)', marginTop: 6 }}>
                      {t('signature.field.savedInUse')}
                    </div>
                  )}
                  <button onClick={() => { setApproverSig(null); setApproverSigSource('none') }}
                    style={{ display: 'block', marginTop: 6, fontSize: 11, color: 'var(--panel-ink-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    {approverSigSource === 'saved'
                      ? t('signature.field.drawNew')
                      : t('inspections.approve.clearResign')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowApproverPad(true)}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 12,
                    border: '2px dashed var(--hairline)', background: 'var(--panel-2)',
                    color: 'var(--panel-ink-3)', fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <PenLine size={15} aria-hidden /> {t('inspections.approve.tapToSign')}
                </button>
              )}
              {/* Read-only, because the server derives the approver from the session.
                  An editable name box here would promise something the write ignores. */}
              <p style={{ fontSize: 11, color: 'var(--panel-ink-4)', marginTop: 8 }}>
                Signing as <strong style={{ color: 'var(--panel-ink-3)' }}>{profile?.full_name || profile?.username || 'your account'}</strong>.
                A signature is required to approve. It is stored on the inspection record.
              </p>
              <label style={{ display: 'block', marginTop: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-ink-4)', textTransform: 'uppercase' }}>
                  Reason (required to return, optional to approve)
                </span>
                <textarea
                  value={approveNote}
                  onChange={e => setApproveNote(e.target.value)}
                  rows={2}
                  placeholder="Why is this being returned, or anything the record should carry"
                  style={{
                    width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 8,
                    background: 'var(--panel-2)', border: '1px solid var(--hairline)',
                    color: 'var(--panel-ink-2)', fontSize: 12, resize: 'vertical',
                  }}
                />
              </label>
            </div>
            )}

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

            {/* Actions.

                Only offered to someone who may sign (see canApproveInspection). Both
                writes now REPORT A FAILURE instead of swallowing it: telling an approver
                a record is approved when the update was refused is worse than the missing
                signature this whole change is about. */}
            {approveTarget.approval_status !== 'approved' && canApproveInspection && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={async () => {
                    setApproveSubmitting(true)
                    try {
                      await inspectionsApi.decideInspectionApproval(approveTarget.id, {
                        approved: false,
                        note: approveNote,
                      })
                      setApproveMsg({ type: 'err', text: t('inspections.approve.msgRejected') })
                      await refreshApproveTarget({ approval_status: 'rejected' })
                      // Best-effort ONLY: the RPC files the reason in the audit log, which
                      // this screen does not read, so the inspector gets a visible reason
                      // on the record itself. The decision is already committed, so a
                      // failure here must never be reported as a failed rejection.
                      if (approveNote.trim()) {
                        inspectionsApi.patchInspection(approveTarget.id, {
                          notes: [approveTarget.notes, `Returned for rework: ${approveNote.trim()}`]
                            .filter(Boolean).join('\n'),
                        }).catch(() => {})
                      }
                      load()
                    } catch (err) {
                      if (err?.alreadyDecided) await refreshApproveTarget()
                      setApproveMsg({ type: 'err', text: toUserMessage(err, 'Could not record the rejection. Nothing was saved.') })
                    }
                    setApproveSubmitting(false)
                  }}
                  disabled={approveSubmitting || !approveNote.trim()}
                  title={approveNote.trim() ? undefined : 'Give a reason before returning this inspection'}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 10,
                    border: `1.5px solid ${approveNote.trim() ? '#ef4444' : 'var(--hairline)'}`,
                    background: 'transparent',
                    color: approveNote.trim() ? '#dc2626' : 'var(--panel-ink-4)',
                    fontSize: 13, fontWeight: 600,
                    cursor: approveNote.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  {t('inspections.approve.reject')}
                </button>
                <button
                  onClick={async () => {
                    if (!approverSig) { setApproveMsg({ type: 'err', text: t('inspections.approve.msgNeedSignature') }); return }
                    setApproveSubmitting(true)
                    try {
                      // The approver, the timestamp and the lock are all derived
                      // SERVER-side; the only thing this screen supplies is the drawn
                      // signature and an optional note.
                      await inspectionsApi.decideInspectionApproval(approveTarget.id, {
                        approved: true,
                        signature: approverSig,
                        note: approveNote,
                      })
                      setApproveMsg({ type: 'ok', text: t('inspections.approve.msgApproved') })
                      // Re-read rather than echo a guess: what was stored is what the
                      // server decided, including who it attributed the sign-off to.
                      await refreshApproveTarget({ approval_status: 'approved', approver_signature: approverSig })
                      load()
                    } catch (err) {
                      if (err?.alreadyDecided) await refreshApproveTarget()
                      setApproveMsg({ type: 'err', text: toUserMessage(err, 'Could not save the approval. The inspection is unchanged.') })
                    }
                    setApproveSubmitting(false)
                  }}
                  disabled={approveSubmitting || !approverSig}
                  style={{
                    flex: 2, padding: '11px', borderRadius: 10, border: 'none',
                    background: approverSig ? '#16a34a' : 'var(--hairline)',
                    color:'var(--panel-ink)', fontSize: 13, fontWeight: 700, cursor: approverSig ? 'pointer' : 'not-allowed',
                  }}
                >
                  {approveSubmitting ? t('common.saving') : t('inspections.approve.approveSign')}
                </button>
              </div>
            )}
            {approveTarget.approval_status === 'approved' && (
              <div style={{ textAlign: 'center', padding: '12px', borderRadius: 10, background: 'rgba(22,163,74,0.15)', border: '1px solid #16a34a', color: '#16a34a', fontWeight: 600 }}>
                {t('inspections.approve.alreadyApproved')}
              </div>
            )}
          </div>
        </div>
        } />
      )}

      {/* Approver Signature Pad. Gated as well as its button: a pad that opens for
          someone who cannot approve would collect a signature nothing can store. */}
      {showApproverPad && canApproveInspection && (
        <SignaturePad
          label={t('inspections.approve.approverSignature')}
          inspectorName={profile?.full_name || ''}
          employeeId={profile?.employee_id || ''}
          onSave={dataUrl => {
            setApproverSig(dataUrl)
            setApproverSigSource('drawn')
            setShowApproverPad(false)
            // Remember the FIRST mark a person draws - that is the moment the
            // owner described. Someone who already has a saved signature is
            // deliberately left alone: a one-off signature for one record must
            // not silently replace the mark they chose. Replacing it is done on
            // purpose, from Settings.
            if (!savedSig) {
              userSignatureApi.saveMySignature(dataUrl)
                .then((v) => setSavedSig(v))
                .catch(() => {}) // the drawn mark is still attached; only remembering it failed
            }
          }}
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
              {t('inspections.pdfPreview.title')} - {clSaved?.asset_no}
            </span>
            <div className="flex gap-2">
              <a
                href={pdfBlobUrl}
                download={`TyrePulse_Checklist_${clSaved?.asset_no || 'report'}.pdf`}
                className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
              >
                <Download size={13} /> {t('inspections.pdfPreview.download')}
              </a>
              <button
                type="button"
                aria-label="Close PDF preview"
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

      {/* Status filter pills, search, and table - hidden in checklist mode */}
      {activeTab !== 'checklist' && <>
      {/* Overview slides: two compact cards with the big clear numbers.

          EVERY figure here is computed over `scoped` - the same rows the table below is
          showing, minus the tile drill-down. The caption states that in words, because a
          scoped number sitting next to an unscoped one is unreadable either way round. */}
      {(() => {
        // "We could not look" is not "there is nothing". While the read has failed the
        // tiles refuse to state a count at all rather than print a confident 0.
        const unreadable = !!loadError
        const num = (v) => (unreadable ? null : v)
        const scopeCaption = unreadable
          ? 'Could not read the inspections, so these figures are not a count.'
          : scopeActive
            ? `Covers the ${scoped.length} ${scoped.length === 1 ? 'inspection' : 'inspections'} matching your filters, of ${tabFiltered.length} in total.`
            : null
        return (
        <>
        {/* Register KPI strip: status and completion over the SAME rows the tiles
            and the table count. N/A while the read has failed, never 0. */}
        {!showWorkspace && <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" aria-label="Register summary">
          <RegisterKpi label="Records" value={num(kpis.total)} sub={scopeActive ? 'Matching your filters' : 'In this view'} />
          <RegisterKpi label="Open" value={num(kpis.open)} sub="Scheduled, in progress or overdue" />
          <RegisterKpi label="Overdue" value={num(kpis.Overdue)} tone={!unreadable && kpis.Overdue > 0 ? '#b91c1c' : undefined}
            sub={unreadable || kpis.overdueRate == null ? 'Rate N/A' : `${kpis.overdueRate}% of records`} />
          <RegisterKpi label="Completed" value={num(kpis.Done)}
            sub={unreadable || kpis.completionRate == null ? 'Rate N/A' : `${kpis.completionRate}% completion`} />
          <RegisterKpi label="High or critical" value={num(kpis.highSeverity)} tone={!unreadable && kpis.highSeverity > 0 ? '#b45309' : undefined} sub="By recorded severity" />
          <RegisterKpi label="Actions raised" value={num(kpis.withAction)} sub="Linked corrective actions" />
        </div>}
        <div className="flex flex-wrap gap-4">
          <OverviewSlide
            title="Inspections"
            caption={scopeCaption}
            activeFocus={filterFocus}
            onFocus={(k) => setFilter('focus', k)}
            items={[
              // No focus key on these two: "inspections done" IS the unfocused view, and
              // "vehicles inspected" is a distinct count with no row subset behind it.
              ['Inspections done', num(overview.inspectionsDone)],
              ['Vehicles inspected', num(overview.vehiclesInspected)],
              ['Approved', num(overview.approved), false, 'approved'],
              ['Pending approval', num(overview.pendingApproval), false, 'pending'],
            ]}
          />
          {flagStatus === 'loading' ? (
            <div className="card flex-1 min-w-[260px]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Tyre change flags</p>
              <p className="text-sm text-[var(--text-secondary)]">Checking tyre life...</p>
            </div>
          ) : flagStatus === 'error' ? (
            /* "We could not look" - never dressed up as a count of zero. */
            <div className="card flex-1 min-w-[260px]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Tyre change flags</p>
              <p className="text-sm text-[var(--text-secondary)]">Could not load tyre life data, so no tyre is flagged here.</p>
              {flagError && <p className="mt-1 text-xs text-[var(--text-dim)]">{flagError}</p>}
              <button
                type="button"
                onClick={() => setFlagReload((n) => n + 1)}
                className="mt-2 px-3 min-h-[40px] py-1.5 rounded-md inline-flex items-center gap-1.5 border border-[var(--border-subtle)] text-xs"
                style={{ color: 'var(--text-primary)' }}
              >
                <RefreshCw size={12} aria-hidden /> Retry
              </button>
            </div>
          ) : unreadable ? (
            /* The flag feed loaded, but the inspections it is joined to did not, so
               there is no honest set of vehicles to report against. */
            <div className="card flex-1 min-w-[260px]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Tyre change flags</p>
              <p className="text-sm text-[var(--text-secondary)]">Could not read the inspections, so no vehicle can be counted here.</p>
            </div>
          ) : !overview.vehiclesWithTyresDue ? (
            /* We looked, and nothing is flagged HERE. The two reasons for that
               are different facts, so they are said differently: no tyre is due
               anywhere in this country, versus none is due on the vehicles
               these inspections cover. */
            <div className="card flex-1 min-w-[260px]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Tyre change flags</p>
              <p className="text-sm text-[var(--text-secondary)]">
                {dueAssetCount === 0
                  ? `No tyre is currently due${activeCountry && activeCountry !== 'All' ? ` in ${activeCountry}` : ''}. Nothing is past its expected life or close to it.`
                  : `No tyre is due on the vehicles in the ${scopeActive ? 'filtered ' : ''}inspections on screen. ${dueAssetCount} ${dueAssetCount === 1 ? 'vehicle in this country has' : 'vehicles in this country have'} tyres due.`}
              </p>
              <p className="mt-2 text-xs text-[var(--text-dim)]">
                Damaged found in these inspections: {overview.damagedFound}
              </p>
              {dueAssetCount > 0 && (
                <Link
                  to={trackingLink()}
                  className="mt-2 inline-flex items-center gap-1 text-xs underline"
                  style={{ color: 'var(--text-primary)' }}
                >
                  See those vehicles and whether the tyres were replaced
                  <ExternalLink size={12} />
                </Link>
              )}
            </div>
          ) : (
            <OverviewSlide
              title="Tyre change flags"
              /* These four narrow with the filters, but not in the same UNIT as the
                 filters: they count tyres on the VEHICLES the filtered inspections
                 cover. A tyre is flagged by its life today, so the date range picks
                 which inspections (and therefore which vehicles) are looked at - it
                 does not put a date on the flag itself. Said plainly rather than left
                 for the reader to assume either way. */
              /* The caption names BOTH sources, because these four tiles do not
                 all come from the same place and saying "state today" over all of
                 them was not true. The first three read the tyre's life TODAY from
                 the flag map. "Damaged found" is what inspectors RECORDED on the
                 sheets in range - and it counts distinct tyres, not how many times
                 damage was written down, so it is in the same unit as the rest. */
              caption={scopeActive
                ? `Covers the ${overview.vehiclesInspected} ${overview.vehiclesInspected === 1 ? 'vehicle' : 'vehicles'} in the filtered inspections. Due and past-life read the tyre's life today; damaged is what these inspections recorded. Both count distinct tyres.`
                : "Covers the vehicles in these inspections. Due and past-life read the tyre's life today; damaged is what these inspections recorded. Both count distinct tyres."}
              activeFocus={filterFocus}
              onFocus={(k) => setFilter('focus', k)}
              items={[
                ['Vehicles with tyres due', overview.vehiclesWithTyresDue, true, 'tyres_due'],
                ['Tyres past life', overview.tyresOverdue, true, 'overdue'],
                ['Tyres due soon', overview.tyresDueSoon, true, 'due_soon'],
                ['Damaged found', overview.damagedFound, true, 'damaged'],
              ]}
              /* A count you cannot act on is just a number. This opens the
                 tracked list: which tyre, on which vehicle, and whether the
                 change actually happened. */
              footer={(
                <Link
                  to={trackingLink()}
                  className="inline-flex items-center gap-1 text-xs underline"
                  style={{ color: 'var(--text-primary)' }}
                >
                  See the flagged tyres and whether they were replaced
                  <ExternalLink size={12} />
                </Link>
              )}
            />
          )}
          <button
            type="button"
            onClick={() => setSummaryOpen(true)}
            className="self-start min-h-[44px] px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-xs font-medium flex items-center gap-1.5"
            style={{ color: 'var(--text-primary)', background: 'var(--surface-2)' }}
          >
            <Share2 size={13} aria-hidden /> Share summary
          </button>
        </div>
        </>
        )
      })()}
      {summaryOpen && (
        <InspectionSummaryModal
          rows={rows}
          flagMap={flagMap || {}}
          defaultFrom={filterFrom}
          defaultTo={filterTo}
          /* Seeded from the register, so the summary opens on what the reader
             had narrowed to. It was previously handed every row and only the
             dates, so a shared PDF could describe the whole country while the
             screen behind it showed one region. */
          defaultRegion={toList(filterRegion)}
          defaultSite={toList(filterSite)}
          defaultVehicleType={toList(filterVehicleType)}
          defaultInspector={toList(filterInspector)}
          regionOptions={regions}
          regionOf={(s) => regionForSite(regionMap, s)}
          country={activeCountry}
          company={company}
          branding={branding}
          onClose={() => setSummaryOpen(false)}
        />
      )}
      {/* Read one inspection in place: the recorded readings, meters, photos
          and signatures, without a page load or a downloaded file. */}
      <InspectionViewerDrawer
        inspectionId={viewId}
        onClose={() => setViewId(null)}
        onEdit={(row) => {
          setViewId(null)
          setForm({ ...row, tyre_conditions: row.tyre_conditions ?? {} })
        }}
        onDownload={(row) => exportRowPdf(row)}
        downloading={Boolean(pdfBusyId)}
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {[['all', t('inspections.filters.status.all'), 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'],
          ['Overdue', t('inspections.filters.status.overdue'), 'bg-red-900/30 text-red-400 border-red-700/50'],
          ['Scheduled', t('inspections.filters.status.scheduled'), 'bg-blue-900/30 text-blue-400 border-blue-700/50'],
          ['In Progress', t('inspections.filters.status.inProgress'), 'bg-yellow-900/30 text-yellow-400 border-yellow-700/50'],
          ['Done', t('inspections.filters.status.done'), 'bg-green-900/30 text-green-400 border-green-700/50'],
        ].map(([val, label, cls]) => (
          <button
            key={val}
            type="button"
            aria-pressed={filterStatus === val}
            onClick={() => setFilter('status', val)}
            className={`px-3 min-h-[36px] py-1.5 rounded-full text-xs font-medium border transition-all ${cls} ${filterStatus === val ? 'ring-2 ring-white/20' : 'opacity-70 hover:opacity-100'}`}
          >
            {label} ({statusCounts[val] ?? 0})
          </button>
        ))}
      </div>

      {/* Filters - search stays out, everything else collapses behind one
          toggle. Same shape as the accident register, so a person who has
          learned one register has learned both. */}
      {(() => {
        const advanced = [
          filterSite !== 'all', filterRegion !== 'all', filterInspector !== 'all',
          filterVehicleType !== 'all', filterSignoff !== 'all', !!filterFrom, !!filterTo,
        ].filter(Boolean).length
        // The tile drill-down counts as active too, so Clear reaches it. A filter the
        // user cannot see and cannot clear is the worst kind - it just looks like
        // missing data. It is deliberately NOT in the `advanced` tally, because it is
        // set from the tiles rather than from inside the Filters panel.
        const focusActive = !!filterFocus && filterFocus !== 'all'
        const anyActive = advanced > 0 || !!search || focusActive
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="Search inspections" className="input flex-1 min-w-48" placeholder={t('inspections.filters.searchPlaceholder')}
                value={search} onChange={e => setFilter('search', e.target.value)} />
              <button
                type="button"
                onClick={() => setShowFilters(v => !v)}
                aria-expanded={showFilters}
                aria-controls="insp-advanced-filters"
                className={`px-3 min-h-[40px] py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                  showFilters || advanced > 0
                    ? 'bg-[var(--input-bg)] text-[var(--text-primary)] border-[var(--input-border)]'
                    : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)] hover:text-[var(--text-primary)]'
                }`}
                title="Show or hide the advanced filters"
              >
                Filters{advanced > 0 ? ` (${advanced})` : ''}
                <ChevronDown size={13} aria-hidden className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
              </button>
              {anyActive && (
                <button
                  onClick={() => {
                    setFilters({
                      search: '', site: 'all', region: 'all',
                      inspector: 'all', vehicleType: 'all', signoff: 'all', from: '', to: '', focus: 'all',
                    })
                  }}
                  type="button"
                  className="text-xs min-h-[40px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 flex items-center gap-1"
                >
                  <X size={12} aria-hidden /> Clear
                </button>
              )}
              <span className="text-xs text-[var(--text-muted)] ml-auto self-center whitespace-nowrap">
                {filtered.length}{filtered.length !== tabFiltered.length ? ` of ${tabFiltered.length}` : ''} shown
              </span>
            </div>

            {/* Drilled into a tile: say WHAT is on screen, in the tile's own unit.
                Three of the tiles count tyres or vehicles rather than inspections, so
                the row count is legitimately smaller than the number that was clicked -
                stating the relationship stops that reading as lost rows. */}
            {focusInfo && (
              <div
                className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}
                role="status"
              >
                <span style={{ color: 'var(--text-primary)' }}>
                  Showing <strong>{focusInfo.rows}</strong> {focusInfo.rows === 1 ? 'inspection' : 'inspections'}
                  {focusInfo.units != null && (
                    <> covering <strong>{focusInfo.units}</strong>{' '}
                      {focusInfo.measures === 'vehicles'
                        ? (focusInfo.units === 1 ? 'vehicle' : 'vehicles')
                        : (focusInfo.units === 1 ? 'tyre' : 'tyres')}</>
                  )}
                  {' '}&middot; {focusInfo.label}
                </span>
                <button
                  type="button"
                  onClick={() => setFilter('focus', 'all')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                >
                  <X size={12} /> Show all inspections
                </button>
              </div>
            )}

            {showFilters && (
              <div id="insp-advanced-filters" className="flex flex-wrap gap-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3">
                {/* Region renders only when the site register actually places
                    these sites in one. An empty dropdown is a control that can
                    only ever return nothing. */}
                {/* All four are MULTI-select: a fleet question is rarely about one
                    site or one machine class. "Mixers and pumps at Diriyah and
                    NHC" was previously four separate passes, each of which had to
                    be read and remembered separately. */}
                {regions.length > 0 && (
                  <MultiSelectFilter
                    className="w-44" label="Region" allLabel="All regions"
                    options={regions}
                    value={toList(filterRegion)}
                    onChange={(next) => setFilter('region', fromList(next))}
                  />
                )}
                <MultiSelectFilter
                  className="w-48" label="Site" allLabel={t('inspections.filters.allSites')}
                  options={sites}
                  value={toList(filterSite)}
                  onChange={(next) => setFilter('site', fromList(next))}
                />
                {/* Vehicle type: the pump-versus-mixer split. Rendered only when
                    the loaded rows carry more than one, since a control with a
                    single choice is not a filter. */}
                {vehicleTypes.length > 1 && (
                  <MultiSelectFilter
                    className="w-48" label="Vehicle type" allLabel="All vehicle types"
                    options={vehicleTypes}
                    value={toList(filterVehicleType)}
                    onChange={(next) => setFilter('vehicleType', fromList(next))}
                  />
                )}
                {inspectors.length > 0 && (
                  <MultiSelectFilter
                    className="w-48" label="Inspector" allLabel="All inspectors"
                    options={inspectors}
                    value={toList(filterInspector)}
                    onChange={(next) => setFilter('inspector', fromList(next))}
                  />
                )}
                <select
                  aria-label={t('inspections.filters.signoff.label')}
                  className="input text-sm w-56"
                  value={filterSignoff}
                  onChange={e => setFilter('signoff', e.target.value)}
                >
                  {SIGNOFF_FILTERS.map(o => <option key={o.key} value={o.key}>{t(o.labelKey)}</option>)}
                </select>
                <DateField className="text-sm w-40" value={filterFrom} onChange={v => setFilter('from', v)} placeholder="From date" ariaLabel="From date" />
                <DateField className="text-sm w-40" value={filterTo} onChange={v => setFilter('to', v)} placeholder="To date" ariaLabel="To date" min={filterFrom || undefined} />
              </div>
            )}
          </div>
        )
      })()}

      {/* Bulk selection bar (Admin only) */}
      {isAdmin && selectedIds.size > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 border rounded-xl px-4 py-2.5" style={{ borderColor: 'rgba(37,99,235,0.4)', background: 'rgba(37,99,235,0.08)' }}>
          <span className="text-sm text-[var(--text-primary)]">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            {!allPageSelected && (
              <button type="button" onClick={toggleSelectPage} className="text-xs min-h-[36px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 py-1 underline">
                Select all {filtered.length} filtered
              </button>
            )}
            <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs min-h-[36px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 py-1">Clear</button>
            <button type="button" onClick={() => { setBulkError(''); setBulkDeleteOpen(true) }}
              className="flex items-center gap-1.5 px-3 min-h-[36px] py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">
              <Trash2 size={14} /> Delete {selectedIds.size}
            </button>
          </div>
        </div>
      )}

      {/* The register. EnterpriseTable pages and sorts the FULL filtered set;
          the row opens the record in place. */}
      <div ref={registerRef}>
        <EnterpriseTable
          key={registerKey}
          columns={registerColumns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          error={loadError ? toUserMessage(loadError, 'Could not load the inspections.') : null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          enableRowSelection={isAdmin}
          rowSelection={isAdmin ? rowSelection : undefined}
          onRowSelectionChange={isAdmin ? onRowSelectionChange : undefined}
          onRowClick={(r) => setViewId(r.id)}
          pageSizeOptions={[25, 50, 100]}
          initialPageSize={50}
          stickyFirstColumn
          emptyMessage={scopeActive || (filterFocus && filterFocus !== 'all')
            ? 'No records match these filters. Clear the filters to see every record.'
            : t('inspections.states.noRecords')}
        />
      </div>
      </>}

      {/* Add / Edit Modal */}
      {form !== null && (
        <InspectionFormModal
          form={form}
          setForm={setForm}
          sites={sites}
          flagMap={flagMap}
          selectedTyre={selectedTyre}
          setSelectedTyre={setSelectedTyre}
          wfLocked={wfLocked}
          setWfLocked={setWfLocked}
          saving={saving}
          saveError={saveError}
          onSave={save}
          onClose={() => { setForm(null); setSaveError(null) }}
          fileRef={fileRef}
          onPhotoChange={handlePhotoChange}
        />
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
        <SharedModal
          open
          size="sm"
          onClose={() => setDeleteId(null)}
          title={t('inspections.deleteModal.title')}
          footer={(
            <div className="flex gap-3 w-full">
              <button type="button" onClick={() => setDeleteId(null)} className="btn-secondary flex-1 min-h-[44px]">{t('common.cancel')}</button>
              <button type="button" onClick={confirmDelete} className="flex-1 min-h-[44px] px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700">{t('common.delete')}</button>
            </div>
          )}
        >
          <p className="text-[var(--text-secondary)] text-sm">{t('inspections.deleteModal.warning')}</p>
        </SharedModal>
      )}

      {/* Bulk delete confirm (Admin only) */}
      {bulkDeleteOpen && (
        <SharedModal
          open
          size="sm"
          onClose={() => { if (!bulkBusy) { setBulkDeleteOpen(false); setBulkError('') } }}
          closeOnBackdrop={!bulkBusy}
          title={`Delete ${selectedIds.size} record${selectedIds.size !== 1 ? 's' : ''}?`}
          footer={(
            <div className="flex gap-3 w-full">
              <button type="button" onClick={() => { setBulkDeleteOpen(false); setBulkError('') }} disabled={bulkBusy} className="btn-secondary flex-1 min-h-[44px]">Cancel</button>
              <button type="button" onClick={confirmBulkDelete} disabled={bulkBusy}
                className="flex-1 min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
                <Trash2 size={14} aria-hidden /> {bulkBusy ? 'Deleting...' : `Delete ${selectedIds.size}`}
              </button>
            </div>
          )}
        >
          <div className="flex gap-3">
            <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" aria-hidden />
            <p className="text-[var(--text-secondary)] text-sm">This permanently removes the selected inspection records. This cannot be undone.</p>
          </div>
          {bulkError && (
            <p role="alert" className="text-sm mt-4 rounded-lg p-2.5 border" style={{ background: 'rgba(220,38,38,0.08)', borderColor: 'rgba(220,38,38,0.4)', color: '#dc2626' }}>{bulkError}</p>
          )}
        </SharedModal>
      )}

      {/* Offscreen live diagram for row PDF export (captured as SVG) */}
      {pdfRow && (
        <div
          ref={pdfDiagramRef}
          aria-hidden
          style={{ position: 'fixed', left: -9999, top: 0, width: 360, opacity: 0, pointerEvents: 'none' }}
        >
          <InspectionDiagram
            inspection={pdfRow}
            showReadings={false}
            width={340}
          />
        </div>
      )}

      {/* Offscreen copy of the checklist diagram for the "Daily Tyre Inspection
          Report" PDF — always mounted once saved (the on-screen form diagram is
          replaced by the saved-confirmation view), so the report always embeds
          the SAME diagram the operator saw. */}
      {clSaved && (
        <div
          ref={checklistPdfDiagramRef}
          aria-hidden
          style={{ position: 'fixed', left: -9999, top: 0, width: 360, opacity: 0, pointerEvents: 'none' }}
        >
          <InspectionDiagram
            inspection={{ ...clSaved, tyre_conditions: clSaved.tyre_conditions ?? clSaved.findings }}
            showReadings={false}
            width={340}
          />
        </div>
      )}
    </div>
  )
}
