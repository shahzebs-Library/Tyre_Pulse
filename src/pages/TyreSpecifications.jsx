/**
 * Tyre Specifications (route /tyre-specifications), rebuilt on the shared
 * Command Center kit to the owner's light reference design.
 *
 * Layout: hero, six KPI tiles, a filter bar, the specification register as a
 * card grid or a table, the selected rule's detail (six tabs), tread pattern and
 * technical drawing cards, and an "Add new tyre specification" rail form that
 * also edits and duplicates.
 *
 * Kept from the previous page, moved unchanged into src/components/tyreSpec:
 * Fleet compliance, Non-conformance (raise work order), Quick setup, Fitment
 * policy (PDF + size inventory), Value advisor (supplier quotes) and the audit
 * trail, plus the Excel export and compliance PDF.
 *
 * Data truth: a `tyre_specifications` row is an approved fitment rule for a
 * vehicle type and position. It stores sizes, brands, load index, speed
 * symbol, ply, pressure, tread and notes. Pattern, tube type, dual load,
 * weight, images, documents and an approval state are not stored, so they read
 * "Not recorded" or N/A. "Approved for fleet" and "Not approved" count FITTED
 * tyres that conform, or do not, to a rule.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ClipboardList, Tag, Ruler, Layers, CheckCircle2, AlertTriangle, Search, LayoutGrid, List,
  FileSpreadsheet, FileText, RefreshCw, Plus, X,
} from 'lucide-react'
import {
  Card, CardState, Kpi, PageHero, Pager, KitTable, Tabs, fmtInt,
} from '../components/commandCenter/kit'
import * as tyreSpecsApi from '../lib/api/tyreSpecs'
import { BRAND_META } from '../lib/tyreSpecCatalog'
import { buildPolicySections, renderTyreSpecPolicyPdf, buildSizeInventoryRows } from '../lib/tyreSpecPolicy'
import { normalizePosition } from '../lib/tyrePositions'
import * as procurementApi from '../lib/api/tyreProcurement'
import { recommend, LIFECYCLE_DEFAULTS } from '../lib/tyreValueAdvisor'
import * as engKpiApi from '../lib/api/engineeringKpi'
import { computeCpkByBrand, computeAvgTyreLife } from '../lib/kpiEngine'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { loadAutoTable } from '../lib/pdfEngine'
import {
  EMPTY_FILTERS, filterSpecs, filterScope, filterOptions, specUsage, specKpis, USAGE_STATUS, TYRE_TYPES,
  clampPage, pageSlice,
} from '../lib/tyreSpecView'
import {
  PAGE_SIZE, DOUGHNUT_COLORS, specToRow, rowToSpec, quoteToRow,
  DeleteConfirmModal, RaiseWorkOrderModal, QuoteFormModal, DeleteQuoteConfirmModal,
  complianceColumns, nonConformanceColumns,
} from '../components/tyreSpec/parts'
import {
  ComplianceTab, NonConformanceTab, QuickSetupTab, FitmentPolicyTab, ValueAdvisorTab, AuditTrailTab,
} from '../components/tyreSpec/WorkbenchTabs'
import SpecFormPanel from '../components/tyreSpec/SpecFormPanel'
import {
  SpecGrid, specTableColumns, SpecDetail, TreadPatternCard, TechnicalDrawingCard,
} from '../components/tyreSpec/SpecCatalog'
import './TyreSpecifications.css'

const uuidv4 = () => crypto.randomUUID()
const SPEC_PAGE_SIZES = [6, 12, 24, 48]

export default function TyreSpecifications() {
  const { profile, user } = useAuth()
  const { appSettings, activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const isAdmin = profile?.role === 'Admin'
  // Procurement is an elevated action; RLS also enforces this server-side.
  const canManageQuotes = ['Admin', 'Manager', 'Director'].includes(profile?.role)
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : null

  const [activeTab, setActiveTab] = useState('specs')
  const [specs, setSpecs] = useState([])
  const [loadingSpecs, setLoadingSpecs] = useState(true)
  const [specsError, setSpecsError] = useState('')
  const [savingSpec, setSavingSpec] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [actionError, setActionError] = useState('')
  const [tyreRecords, setTyreRecords] = useState([])
  const [fleetMaster, setFleetMaster] = useState([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [history, setHistory] = useState([])

  // Value Advisor: supplier quotes + realized fleet performance
  const [procurementOptions, setProcurementOptions] = useState([])
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [optionsError, setOptionsError] = useState('')
  const [kpiRecords, setKpiRecords] = useState([])
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [editingQuote, setEditingQuote] = useState(null)
  const [savingQuote, setSavingQuote] = useState(false)
  const [deletingQuote, setDeletingQuote] = useState(null)

  // library filters
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [view, setView] = useState('grid')
  const [specPage, setSpecPage] = useState(0)
  const [specPageSize, setSpecPageSize] = useState(12)
  const [selectedId, setSelectedId] = useState(null)

  // compliance filters / pagination
  const [compSearch, setCompSearch] = useState('')
  const [compSiteFilter, setCompSiteFilter] = useState('')
  const [compTypeFilter, setCompTypeFilter] = useState('')
  const [compStatusFilter, setCompStatusFilter] = useState('')
  const [compPage, setCompPage] = useState(0)

  // modals
  // The rail form edits `editingSpec` (null = a new specification). formKey
  // remounts it so Cancel and a finished save always start from a clean form.
  const [editingSpec, setEditingSpec] = useState(null)
  const [formKey, setFormKey] = useState(0)
  const [deletingSpec, setDeletingSpec] = useState(null)
  const [workOrderAsset, setWorkOrderAsset] = useState(null)

  // Fitment Policy PDF generation state
  const [policyBusy, setPolicyBusy] = useState(false)
  const [policyError, setPolicyError] = useState('')
  const [sizeSearch, setSizeSearch] = useState('')

  // ── In-session audit log (DB does not persist spec history) ──────────────────

  const logHistory = useCallback((action, specObj, changedField = null, oldVal = null, newVal = null) => {
    setHistory(prev => [...prev, {
      id: uuidv4(),
      date: new Date().toISOString(),
      action,
      user: profile?.email || 'Unknown',
      vehicle_type: specObj?.vehicle_type || '',
      position: specObj?.position || '',
      changed_field: changedField || '',
      old_value: oldVal != null ? String(oldVal) : '',
      new_value: newVal != null ? String(newVal) : '',
    }].slice(-100))
  }, [profile?.email])

  // ── Load specs from Supabase ─────────────────────────────────────────────────

  const fetchSpecs = useCallback(async () => {
    setLoadingSpecs(true)
    setSpecsError('')
    try {
      const { data, error } = await tyreSpecsApi.listSpecs({ country })
      if (error) throw error
      setSpecs((data ?? []).map(rowToSpec))
    } catch (e) {
      setSpecsError(toUserMessage(e, 'Failed to load specifications'))
      setSpecs([])
    } finally {
      setLoadingSpecs(false)
    }
  }, [country])

  // ── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchSpecs()
    fetchLiveData()
    fetchAdvisorData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry])

  async function fetchLiveData() {
    setLoadingRecords(true)
    try {
      const { data: tr } = await tyreSpecsApi.listComplianceTyreRecords({ country: activeCountry })
      setTyreRecords(tr ?? [])

      const { data: fm } = await tyreSpecsApi.getFleetMaster()
      setFleetMaster(fm ?? [])
    } catch {
      setTyreRecords([])
    } finally {
      setLoadingRecords(false)
    }
  }

  // ── Value Advisor data: supplier quotes + realized fleet CPK grounding ────────

  async function fetchAdvisorData() {
    setLoadingOptions(true)
    setOptionsError('')
    try {
      const { data: opts, error: optErr } = await procurementApi.listOptions({ country })
      if (optErr) throw optErr
      setProcurementOptions(opts ?? [])
    } catch (e) {
      setOptionsError(toUserMessage(e, 'Failed to load supplier quotes'))
      setProcurementOptions([])
    } finally {
      setLoadingOptions(false)
    }
    // Realized fleet performance is a best-effort grounding aid; the advisor still
    // ranks on spec-sheet economics when no history exists (honest "guidance").
    try {
      const { data: recs } = await engKpiApi.listKpiTyreRecords({ country, from: 0, to: 99999 })
      setKpiRecords(recs ?? [])
    } catch {
      setKpiRecords([])
    }
  }

  // ── Derive vehicle type from asset number prefix when fleet_master unavailable ─

  const deriveVehicleType = useCallback((assetNo) => {
    if (!assetNo) return null
    const fm = fleetMaster.find(f => f.asset_no === assetNo)
    if (fm?.vehicle_type) return fm.vehicle_type
    // prefix heuristics
    const prefix = String(assetNo).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
    const map = {
      MIX: 'Mixer', TIP: 'Tipper', RIG: 'Rigid Truck', SEM: 'Semi-Trailer',
      TAN: 'Tanker', FLT: 'Flat Bed', CRN: 'Crane', BUS: 'Bus', TRK: 'Rigid Truck',
    }
    for (const [k, v] of Object.entries(map)) {
      if (prefix.startsWith(k)) return v
    }
    return null
  }, [fleetMaster])

  // ── Compliance analysis ────────────────────────────────────────────────────────

  const complianceData = useMemo(() => {
    return tyreRecords.map(tr => {
      const vehicleType = deriveVehicleType(tr.asset_no)
      const position = normalizePosition(tr.position)
      const fm = fleetMaster.find(f => f.asset_no === tr.asset_no)
      const site = tr.site || fm?.site || ''

      const matchingSpec = specs.find(s =>
        s.vehicle_type === vehicleType &&
        (s.position === position || s.position === 'All Positions')
      )

      if (!vehicleType || !matchingSpec) {
        return { ...tr, vehicleType, site, specStatus: 'No Spec Defined', violations: [] }
      }

      const sizeOk = matchingSpec.approved_sizes.some(s => normalizeSize(s) === normalizeSize(tr.size))
      const brandOk = matchingSpec.approved_brands.some(b => b.toLowerCase() === (tr.brand || '').toLowerCase())

      const violations = []
      if (!sizeOk) violations.push(`Non-standard size: ${tr.size || 'Unknown'} (approved: ${matchingSpec.approved_sizes.join(', ')})`)
      if (!brandOk) violations.push(`Non-approved brand: ${tr.brand || 'Unknown'} (approved: ${matchingSpec.approved_brands.join(', ')})`)

      let specStatus
      if (violations.length === 0) specStatus = 'Approved'
      else if (violations.length >= 2) specStatus = 'Multiple Violations'
      else if (!sizeOk) specStatus = 'Non-Standard Size'
      else specStatus = 'Non-Approved Brand'

      return { ...tr, vehicleType, site, specStatus, violations, matchingSpec }
    })
  }, [tyreRecords, specs, fleetMaster, deriveVehicleType])

  // normalizePosition sourced from lib/tyrePositions (coded + free-text aware).

  function normalizeSize(size) {
    return (size || '').replace(/\s/g, '').toUpperCase()
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const total = complianceData.length
    const approved = complianceData.filter(r => r.specStatus === 'Approved').length
    const nonConforming = complianceData.filter(r => r.specStatus !== 'Approved' && r.specStatus !== 'No Spec Defined').length
    const vehicleTypesCovered = new Set(specs.map(s => s.vehicle_type)).size
    const complianceRate = total > 0 ? Math.round((approved / total) * 100) : 0
    return { total, approved, nonConforming, vehicleTypesCovered, complianceRate }
  }, [complianceData, specs])

  // ── Filtered library ──────────────────────────────────────────────────────────

  // In-service usage per rule (fitted tyres covered, conforming, out of spec).
  const usageBySpec = useMemo(() => specUsage(complianceData), [complianceData])

  const filteredSpecs = useMemo(() => filterSpecs(specs, filters, usageBySpec), [specs, filters, usageBySpec])

  // Plain-English description of the register filters, for the export.
  const specLibraryScope = useMemo(() => filterScope(filters), [filters])

  // ── Filtered compliance ────────────────────────────────────────────────────────

  const filteredCompliance = useMemo(() => {
    return complianceData.filter(r => {
      const matchSearch = !compSearch || r.asset_no?.toLowerCase().includes(compSearch.toLowerCase()) || r.vehicleType?.toLowerCase().includes(compSearch.toLowerCase())
      const matchSite = !compSiteFilter || r.site === compSiteFilter
      const matchType = !compTypeFilter || r.vehicleType === compTypeFilter
      const matchStatus = !compStatusFilter || r.specStatus === compStatusFilter
      return matchSearch && matchSite && matchType && matchStatus
    })
  }, [complianceData, compSearch, compSiteFilter, compTypeFilter, compStatusFilter])

  const compliancePage = useMemo(() => {
    return filteredCompliance.slice(compPage * PAGE_SIZE, (compPage + 1) * PAGE_SIZE)
  }, [filteredCompliance, compPage])

  const complianceTotalPages = Math.ceil(filteredCompliance.length / PAGE_SIZE)

  // ── Non-conformance grouped by asset ──────────────────────────────────────────

  const nonConformanceByAsset = useMemo(() => {
    const map = {}
    complianceData.filter(r => r.specStatus !== 'Approved' && r.specStatus !== 'No Spec Defined').forEach(r => {
      if (!map[r.asset_no]) {
        map[r.asset_no] = { asset_no: r.asset_no, site: r.site, vehicleType: r.vehicleType, violations: [], violationTypes: new Set() }
      }
      map[r.asset_no].violations.push(...r.violations)
      map[r.asset_no].violationTypes.add(r.specStatus)
    })
    return Object.values(map)
      .map(v => ({ ...v, violationTypes: [...v.violationTypes] }))
      .sort((a, b) => b.violations.length - a.violations.length)
  }, [complianceData])

  // ── Doughnut data ─────────────────────────────────────────────────────────────

  const doughnutData = useMemo(() => {
    const counts = {
      Approved: 0, 'Non-Standard Size': 0, 'Non-Approved Brand': 0, 'Multiple Violations': 0, 'No Spec Defined': 0,
    }
    complianceData.forEach(r => { if (counts[r.specStatus] !== undefined) counts[r.specStatus]++ })
    const labels = Object.keys(counts).filter(k => counts[k] > 0)
    return {
      labels,
      datasets: [{
        data: labels.map(l => counts[l]),
        backgroundColor: labels.map((l, i) => DOUGHNUT_COLORS[Object.keys(counts).indexOf(l)] + 'cc'),
        borderColor: labels.map((l, i) => DOUGHNUT_COLORS[Object.keys(counts).indexOf(l)]),
        borderWidth: 1,
      }],
    }
  }, [complianceData])

  // ── Site options for filter ────────────────────────────────────────────────────

  const siteOptions = useMemo(() => [...new Set(tyreRecords.map(r => r.site).filter(Boolean))].sort(), [tyreRecords])
  const typeOptions = useMemo(() => [...new Set(specs.map(s => s.vehicle_type).filter(Boolean))].sort(), [specs])

  // ── Value Advisor derivations ───────────────────────────────────────────────

  // Realized (historically achieved) CPK + tyre life per brand, from the canonical
  // engineering-KPI engines. Keyed by brand.toLowerCase() -> { avgCpk, avgLifeKm, count }.
  const realizedByBrand = useMemo(() => {
    const cpk = computeCpkByBrand(kpiRecords)                 // [{ brand, avgCpk, count }]
    const life = computeAvgTyreLife(kpiRecords).byBrand || [] // [{ brand, avgKm, count }]
    const map = {}
    cpk.forEach(c => {
      const key = String(c.brand || '').toLowerCase()
      if (!key || key === 'unknown') return
      map[key] = { avgCpk: c.avgCpk ?? null, avgLifeKm: null, count: c.count ?? 0 }
    })
    life.forEach(l => {
      const key = String(l.brand || '').toLowerCase()
      if (!key || key === 'unknown') return
      if (!map[key]) map[key] = { avgCpk: null, avgLifeKm: null, count: 0 }
      map[key].avgLifeKm = l.avgKm ?? null
      map[key].count = Math.max(map[key].count || 0, l.count ?? 0)
    })
    return map
  }, [kpiRecords])

  // Group quotes by approved fitment (vehicle_type | position).
  const advisorGroups = useMemo(() => {
    const map = {}
    procurementOptions.forEach(o => {
      const vt = o.vehicle_type || 'Unspecified'
      const pos = o.position || 'All Positions'
      const key = `${vt} | ${pos}`
      if (!map[key]) map[key] = { key, vehicle_type: vt, position: pos, options: [] }
      map[key].options.push(o)
    })
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key))
  }, [procurementOptions])

  // Run the value-advisor engine per fitment (lifecycle CPK ranking + rationale).
  const advisorRecs = useMemo(() => {
    const targetKm = LIFECYCLE_DEFAULTS.targetKm
    return advisorGroups.map(g => ({ ...g, rec: recommend(g.options, { realizedByBrand, targetKm }) }))
  }, [advisorGroups, realizedByBrand])

  // Approved brands for a fitment, from the matching spec (fallback to the brand
  // catalog when no spec restricts the fitment).
  const approvedBrandsFor = useCallback((vehicleType, position) => {
    const spec = specs.find(s => s.vehicle_type === vehicleType && (s.position === position || s.position === 'All Positions'))
    if (spec && spec.approved_brands?.length) return spec.approved_brands
    return Object.keys(BRAND_META)
  }, [specs])

  // ── CRUD operations ───────────────────────────────────────────────────────────

  async function handleSaveSpec(form) {
    setSavingSpec(true)
    setSaveError('')
    try {
      const existing = editingSpec?.id ? specs.find(s => s.id === editingSpec.id) : null
      if (existing) {
        const row = { ...specToRow(form, { country }), updated_at: new Date().toISOString() }
        const { error } = await tyreSpecsApi.updateSpec(existing.id, row)
        if (error) throw error
        logHistory('Edit', form, 'Spec Update', JSON.stringify(existing), JSON.stringify(form))
      } else {
        const row = specToRow(form, { country, createdBy: user?.id })
        const { error } = await tyreSpecsApi.insertSpec(row)
        if (error) throw error
        logHistory('Add', form)
      }
      await fetchSpecs()
      setEditingSpec(null)
      setFormKey(k => k + 1)
    } catch (e) {
      setSaveError(toUserMessage(e, 'Failed to save specification'))
    } finally {
      setSavingSpec(false)
    }
  }

  async function handleDeleteSpec() {
    const target = deletingSpec
    setActionError('')
    try {
      const { error } = await tyreSpecsApi.deleteSpec(target.id)
      if (error) throw error
      logHistory('Delete', target)
      await fetchSpecs()
    } catch (e) {
      setActionError(toUserMessage(e, 'Failed to delete specification'))
    } finally {
      setDeletingSpec(null)
    }
  }

  async function importQuickDefault(def) {
    const exists = specs.find(s => s.vehicle_type === def.vehicle_type && s.position === def.position)
    if (exists) return
    setActionError('')
    try {
      const row = specToRow(def, { country, createdBy: user?.id })
      const { error } = await tyreSpecsApi.insertSpec(row)
      if (error) throw error
      logHistory('Quick Setup Import', def)
      await fetchSpecs()
    } catch (e) {
      setActionError(toUserMessage(e, 'Failed to import default'))
    }
  }

  // ── Value Advisor: quote CRUD ─────────────────────────────────────────────────

  async function handleSaveQuote(form) {
    setSavingQuote(true)
    setOptionsError('')
    try {
      if (editingQuote?.id) {
        const row = { ...quoteToRow(form, { country }), updated_at: new Date().toISOString() }
        const { error } = await procurementApi.updateOption(editingQuote.id, row)
        if (error) throw error
      } else {
        const row = quoteToRow(form, { country, createdBy: user?.id })
        const { error } = await procurementApi.insertOption(row)
        if (error) throw error
      }
      await fetchAdvisorData()
      setShowQuoteModal(false)
      setEditingQuote(null)
    } catch (e) {
      setOptionsError(toUserMessage(e, 'Failed to save quote'))
    } finally {
      setSavingQuote(false)
    }
  }

  async function handleDeleteQuote() {
    const target = deletingQuote
    setOptionsError('')
    try {
      const { error } = await procurementApi.deleteOption(target.id)
      if (error) throw error
      await fetchAdvisorData()
    } catch (e) {
      setOptionsError(toUserMessage(e, 'Failed to delete quote'))
    } finally {
      setDeletingQuote(null)
    }
  }

  // ── Export the Value Advisor (quotes + computed econ) to Excel ────────────────

  async function exportAdvisorExcel() {
    const rows = []
    advisorRecs.forEach(g => {
      g.rec.ranked.forEach(e => {
        rows.push({
          'Fitment': g.key,
          'Brand': e.brand || '',
          'Supplier': e.supplier || '',
          'Size': e.size || '',
          'Unit Price': e.unit_price ?? '',
          'Currency': e.currency || g.rec.currency,
          'Expected Life (km)': e.expected_life_km ?? '',
          'Lifecycle km': e.lifecycleKm ?? '',
          'New CPK': e.newCpk ?? '',
          'Lifecycle CPK': e.lifecycleCpk ?? '',
          'Cost per 1000km': e.costPer1000Km ?? '',
          'Warranty %': e.warrantyCoverPct ?? '',
          'Realized CPK': e.realizedCpk ?? '',
          'Confidence': e.confidence || '',
          'Best Value': e.bestValue ? 'Yes' : '',
          'Best Deal': e.bestDeal ? 'Yes' : '',
          'Lowest CPK': e.lowestCpk ? 'Yes' : '',
          'Longest Life': e.longestLife ? 'Yes' : '',
        })
      })
    })
    if (rows.length === 0) return
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Value Advisor')
    XLSX.writeFile(wb, 'TyrePulse_Value_Advisor.xlsx')
  }

  // ── Export specs to Excel ─────────────────────────────────────────────────────

  // Exports the Spec Library as it is on screen. It used to map the whole
  // `specs` array while the library renders `filteredSpecs`, so a search or a
  // vehicle-type filter produced a workbook holding every specification. Its
  // neighbour in this same toolbar already exports the filtered compliance set.
  async function exportSpecsExcel() {
    const XLSX = await import('xlsx')
    const rows = filteredSpecs.map(s => ({
      'Vehicle Type': s.vehicle_type,
      'Position': s.position,
      'Approved Sizes': s.approved_sizes.join(', '),
      'Approved Brands': s.approved_brands.join(', '),
      'Min Load Index': s.min_load_index,
      'Min Speed Index': s.min_speed_index,
      'Ply Rating': s.ply_rating,
      'Recommended Pressure': s.recommended_pressure,
      'Min Tread Depth': s.min_tread_depth,
      'Notes': s.notes,
    }))
    const wb = XLSX.utils.book_new()
    // A workbook outlives the filter that produced it, so it names its scope.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Report': 'Tyre Specification Library',
      'Specifications included': filteredSpecs.length,
      'Specifications defined': specs.length,
      'Filters applied': specLibraryScope || 'None (whole library)',
    }]), 'Report Scope')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Tyre Specs')
    XLSX.writeFile(wb, 'TyrePulse_Specifications.xlsx')
  }

  // ── Export compliance PDF ─────────────────────────────────────────────────────

  // A landscape A4 page holds ~30 of these rows, so 500 is already ~17 pages.
  // Bounded because the whole document is built in memory and, on the email
  // path, base64-encoded into an attachment.
  const PDF_ROW_CAP = 500

  async function exportCompliancePdf() {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const title = 'Fleet Compliance Report'
    // The body is capped (see PDF_ROW_CAP below), so the subtitle has to say
    // when that bites. It used to print the full filtered count over a shorter
    // table - a 900-fitment filter produced a document headed "900 fitments
    // analysed" containing 500, which is the reader drawing a conclusion from
    // rows that are not there.
    const shown = Math.min(filteredCompliance.length, PDF_ROW_CAP)
    const subtitle = shown < filteredCompliance.length
      ? `${shown} of ${filteredCompliance.length} fitments shown, narrow the filters to include the rest`
      : `${filteredCompliance.length} fitments analysed`

    if (filteredCompliance.length === 0) {
      pdfHeader(doc, title, '0 fitments analysed', company, brand)
      pdfEmptyState(doc, 'No fitments match the selected filters', 'Adjust the filters and export again.')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save('TyrePulse_Compliance_Report.pdf')
      return
    }

    const statusColors = {
      Approved: [20, 83, 45],
      'Non-Standard Size': [124, 45, 18],
      'Non-Approved Brand': [113, 63, 18],
      'Multiple Violations': [127, 29, 29],
      'No Spec Defined': [75, 85, 99],
    }

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      margin: { left: 14, right: 14, top: 28 },
      head: [['Asset No', 'Vehicle Type', 'Position', 'Fitted Size', 'Fitted Brand', 'Site', 'Spec Status']],
      body: filteredCompliance.slice(0, PDF_ROW_CAP).map(r => [
        r.asset_no || '', r.vehicleType || 'Unknown', normalizePosition(r.position), r.size || '', r.brand || '', r.site || '', r.specStatus,
      ]),
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 32 }, 2: { cellWidth: 24 }, 3: { cellWidth: 32 }, 4: { cellWidth: 28 }, 5: { cellWidth: 28 }, 6: { cellWidth: 38 } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 6) {
          const color = statusColors[data.cell.raw]
          if (color) { data.cell.styles.fillColor = color; data.cell.styles.textColor = [255, 255, 255] }
        }
      },
      didDrawPage: () => pdfHeader(doc, title, subtitle, company, brand),
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save('TyrePulse_Compliance_Report.pdf')
  }

  // ── Fitment Policy (branded standard document) ─────────────────────────────────

  // Current fleet tyres, grouped by tyre size (works across every vehicle type,
  // position, site and country in scope - it groups on the tyre's own `size`
  // field rather than on vehicle-type derivation, which is often incomplete).
  const sizeInventory = useMemo(() => {
    try {
      return buildSizeInventoryRows({ complianceRows: complianceData, specs }) || []
    } catch {
      return []
    }
  }, [complianceData, specs])

  const filteredSizeInventory = useMemo(() => {
    const q = sizeSearch.trim().toLowerCase()
    if (!q) return sizeInventory
    return sizeInventory.filter(r =>
      r.size.toLowerCase().includes(q) ||
      r.brandsLabel.toLowerCase().includes(q) ||
      r.approvedBrandsLabel.toLowerCase().includes(q) ||
      r.vehicleTypesLabel.toLowerCase().includes(q)
    )
  }, [sizeInventory, sizeSearch])

  async function exportSizeInventoryExcel() {
    if (filteredSizeInventory.length === 0) return
    const XLSX = await import('xlsx')
    const rows = filteredSizeInventory.map(r => ({
      'Tyre Size': r.size,
      'Fitted Qty': r.count,
      'Brands In Use': r.brandsLabel,
      'Approved Brands': r.approvedBrandsLabel,
      'Ply Rating': r.plyRating,
      'Min Tread (mm)': r.minTreadDepth,
      'Load Index': r.minLoadIndex,
      'Speed Index': r.minSpeedIndex,
      'Recommended Pressure (PSI)': r.recommendedPressure,
      'Vehicle Types': r.vehicleTypesLabel,
      'Positions': r.positionsLabel,
      'Sites Fitted': r.sites.length,
      'Approved Fitment Standards Matched': r.specCount,
      'Approved (fitments)': r.compliance.approved,
      'Non-Standard Size (fitments)': r.compliance.nonStandardSize,
      'Non-Approved Brand (fitments)': r.compliance.nonApprovedBrand,
      'Multiple Violations (fitments)': r.compliance.multipleViolations,
      'No Spec Defined (fitments)': r.compliance.noSpec,
      'Brands Fitted But Not Approved': r.brandsFittedNotApproved.join(', '),
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Report': 'Current Fleet Tyre Inventory by Size',
      'Sizes included': filteredSizeInventory.length,
      'Sizes in fleet': sizeInventory.length,
      'Search applied': sizeSearch.trim() || 'None (whole fleet)',
      'Scope': country || 'All Countries',
    }]), 'Report Scope')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Tyre Size Inventory')
    XLSX.writeFile(wb, 'TyrePulse_Tyre_Size_Inventory.xlsx')
  }

  const policySections = useMemo(() => {
    try {
      return buildPolicySections({
        specs,
        complianceRows: complianceData,
        company,
        country,
        generatedBy: profile?.email,
        date: new Date(),
      }) || []
    } catch {
      return []
    }
  }, [specs, complianceData, company, country, profile?.email])

  async function downloadPolicyPdf() {
    setPolicyBusy(true)
    setPolicyError('')
    try {
      await renderTyreSpecPolicyPdf({
        specs,
        complianceRows: complianceData,
        company,
        branding,
        country,
        generatedBy: profile?.email,
        save: true,
      })
    } catch (e) {
      setPolicyError(toUserMessage(e, 'Failed to generate the policy PDF'))
    } finally {
      setPolicyBusy(false)
    }
  }

  // ── Register view model ──────────────────────────────────────────────────────

  const options = useMemo(() => filterOptions(specs), [specs])
  const figures = useMemo(() => specKpis(specs, loadingRecords ? null : kpis), [specs, kpis, loadingRecords])
  const safeSpecPage = clampPage(specPage, filteredSpecs.length, specPageSize)
  const pageRows = useMemo(() => pageSlice(filteredSpecs, safeSpecPage, specPageSize), [filteredSpecs, safeSpecPage, specPageSize])
  const selectedSpec = useMemo(
    () => filteredSpecs.find(s => s.id === selectedId) || pageRows[0] || null,
    [filteredSpecs, selectedId, pageRows],
  )
  const tableCols = useMemo(() => specTableColumns(usageBySpec), [usageBySpec])
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const setFilter = (key, value) => { setFilters(f => ({ ...f, [key]: value })); setSpecPage(0) }
  const startCreate = () => { setEditingSpec(null); setSaveError(''); setFormKey(k => k + 1) }
  const startEdit = (spec) => { setEditingSpec(spec); setSaveError(''); setFormKey(k => k + 1) }
  const startDuplicate = (spec) => {
    const { id: _id, created_at: _c, updated_at: _u, created_by: _b, ...rest } = spec
    setEditingSpec({ ...rest, notes: rest.notes ? `${rest.notes} (copy)` : '' })
    setSaveError('')
    setFormKey(k => k + 1)
  }

  // ── Table column models (shared EnterpriseTable shell) ──────────────────────
  const complianceCols = complianceColumns({ isAdmin, onRaiseWo: setWorkOrderAsset })
  const nonConformanceCols = nonConformanceColumns({ isAdmin, onRaiseWo: setWorkOrderAsset })
  const nonConformanceRanked = nonConformanceByAsset.map((a, i) => ({ ...a, rank: i + 1 }))
  const historyNewestFirst = [...history].reverse()

  // Everything the moved workbench tabs read, unchanged from the old page.
  const ctx = {
    advisorRecs, approvedBrandsFor, canManageQuotes, compPage, compSearch, compSiteFilter, compStatusFilter,
    compTypeFilter, complianceCols, complianceData, compliancePage, complianceTotalPages, doughnutData,
    downloadPolicyPdf, exportAdvisorExcel, exportSizeInventoryExcel, fetchAdvisorData, filteredCompliance,
    filteredSizeInventory, historyNewestFirst, importQuickDefault, isAdmin, loadingOptions, loadingRecords,
    nonConformanceByAsset, nonConformanceCols, nonConformanceRanked, optionsError, policyBusy, policyError,
    policySections, setCompPage, setCompSearch, setCompSiteFilter, setCompStatusFilter, setCompTypeFilter,
    setDeletingQuote, setEditingQuote, setOptionsError, setPolicyError, setShowQuoteModal, setSizeSearch,
    siteOptions, sizeInventory, sizeSearch, specs, typeOptions,
  }

  const TABS = [
    { key: 'specs', label: 'Specifications', count: specs.length },
    { key: 'compliance', label: 'Fleet compliance' },
    { key: 'violations', label: 'Non-conformance', count: nonConformanceByAsset.length || null, countTone: 'red' },
    { key: 'defaults', label: 'Quick setup' },
    { key: 'policy', label: 'Fitment policy' },
    { key: 'advisor', label: 'Value advisor' },
    { key: 'history', label: 'Audit trail' },
  ]

  const specsState = { loading: loadingSpecs, data: loadingSpecs ? null : specs, error: specsError || null, retry: fetchSpecs }
  const fittedTitle = 'Fitted tyres checked against the rule for their vehicle type and position'

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="cc ts-page">
      <PageHero
        title="Tyre Specifications"
        lead="Manage tyre specifications, brands, patterns, sizes, load/speed ratings and approved models for your fleet."
        imgLight="/dashboard/hero-tyres-light.webp"
        imgDark="/dashboard/hero-tyres-dark.webp"
      />

      <div className="ts-toolbar">
        <div className="ts-toolbar-actions">
          <button type="button" className="cc-btn-primary" onClick={() => { setActiveTab('specs'); startCreate() }}
            disabled={!isAdmin} title={!isAdmin ? 'Admin access required' : undefined}>
            <Plus size={15} aria-hidden="true" /> Add specification
          </button>
          <button type="button" className="cc-btn-ghost" onClick={exportSpecsExcel}
            title={specLibraryScope
              ? `Exports ${filteredSpecs.length} of ${specs.length} specifications, filtered by ${specLibraryScope}`
              : `Exports all ${specs.length} specifications`}>
            <FileSpreadsheet size={14} aria-hidden="true" /> Export
          </button>
          <button type="button" className="cc-btn-ghost" onClick={exportCompliancePdf}>
            <FileText size={14} aria-hidden="true" /> PDF report
          </button>
          <button type="button" className="cc-icon-btn" aria-label="Refresh" title="Refresh"
            onClick={() => { fetchSpecs(); fetchLiveData() }} disabled={loadingRecords || loadingSpecs}>
            <RefreshCw size={14} className={(loadingRecords || loadingSpecs) ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {actionError && (
        <div className="cc-card ts-banner" role="alert">
          <AlertTriangle size={15} aria-hidden="true" /><span>{actionError}</span>
          <button type="button" className="cc-icon-btn" aria-label="Dismiss" onClick={() => setActionError('')}><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis ts-kpis">
        <Kpi icon={ClipboardList} tone="t-green" value={figures.total} label="Total specifications" loading={loadingSpecs} />
        <Kpi icon={Tag} tone="t-blue" value={figures.brands} label="Brands" loading={loadingSpecs} title="Distinct approved brands across all rules" />
        <Kpi icon={Layers} tone="t-purple" display="N/A" label="Patterns" title="Tread pattern is not stored for a specification" />
        <Kpi icon={Ruler} tone="t-orange" value={figures.sizes} label="Sizes" loading={loadingSpecs} title="Distinct approved sizes across all rules" />
        <Kpi icon={CheckCircle2} tone="t-green" value={figures.approvedFitted} label="Approved for fleet (fitted tyres)"
          loading={loadingRecords} title={fittedTitle} onClick={() => { setActiveTab('compliance'); setCompStatusFilter('Approved') }} />
        <Kpi icon={AlertTriangle} tone="t-red" value={figures.notApprovedFitted} label="Not approved (fitted tyres)"
          loading={loadingRecords} danger={figures.notApprovedFitted > 0} title={fittedTitle} onClick={() => setActiveTab('violations')} />
      </div>

      <Tabs label="Tyre specification sections" value={activeTab} onChange={setActiveTab} tabs={TABS} />

      {activeTab === 'specs' && (
        <div className="ts-layout">
          <div className="ts-main">
            <Card>
              <div className="cc-filters">
                <label className="cc-field"><span>Brand</span>
                  <select className="cc-select" value={filters.brand} onChange={e => setFilter('brand', e.target.value)}>
                    <option value="">All brands</option>
                    {options.brands.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </label>
                <label className="cc-field"><span>Size</span>
                  <select className="cc-select" value={filters.size} onChange={e => setFilter('size', e.target.value)}>
                    <option value="">All sizes</option>
                    {options.sizes.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                </label>
                <label className="cc-field"><span>Tyre type</span>
                  <select className="cc-select" value={filters.tyreType} onChange={e => setFilter('tyreType', e.target.value)}>
                    <option value="">All tyre types</option>
                    {TYRE_TYPES.map(t => <option key={t} value={t} disabled={!options.tyreTypes.includes(t)}>{t}</option>)}
                  </select>
                </label>
                <label className="cc-field"><span>Application</span>
                  <select className="cc-select" value={filters.vehicleType} onChange={e => setFilter('vehicleType', e.target.value)}>
                    <option value="">All applications</option>
                    {options.vehicleTypes.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label className="cc-field"><span>Status in service</span>
                  <select className="cc-select" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
                    <option value="">All status</option>
                    {USAGE_STATUS.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </select>
                </label>
                <div className="cc-search">
                  <Search size={15} aria-hidden="true" />
                  <input value={filters.search} onChange={e => setFilter('search', e.target.value)}
                    placeholder="Search application, size, brand, ply..." aria-label="Search specifications" />
                </div>
                <div className="ts-view" role="group" aria-label="View">
                  <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={14} aria-hidden="true" /> Grid view</button>
                  <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}><List size={14} aria-hidden="true" /> Table view</button>
                </div>
              </div>
              <p className="ts-note">
                {activeFilterCount > 0
                  ? <>Showing {fmtInt(filteredSpecs.length)} of {fmtInt(specs.length)} rules. <button type="button" className="cc-link cc-link-btn" onClick={() => { setFilters(EMPTY_FILTERS); setSpecPage(0) }}>Clear filters</button></>
                  : 'Pattern is not stored for a specification, so there is no pattern filter. Status reflects the fitted tyres each rule covers.'}
              </p>
            </Card>

            <Card title="Specification register" sub={`${fmtInt(filteredSpecs.length)} rule${filteredSpecs.length === 1 ? '' : 's'}`}>
              <CardState
                state={specsState}
                lines={4}
                empty={!loadingSpecs && !specsError && filteredSpecs.length === 0 ? (
                  <div>
                    {specs.length === 0
                      ? 'No tyre specifications are defined yet. Add one on the right, or import industry defaults from Quick setup.'
                      : 'No specifications match the current filters.'}
                    {isAdmin && specs.length === 0 && (
                      <><br /><button type="button" className="cc-btn" onClick={() => setActiveTab('defaults')}>Open quick setup</button></>
                    )}
                  </div>
                ) : null}
              >
                {view === 'grid'
                  ? <SpecGrid rows={pageRows} usage={usageBySpec} selectedId={selectedSpec?.id} onSelect={setSelectedId} />
                  : (
                    <KitTable className="ts-table" manualPagination showPagination={false} enableSorting={false}
                      pageIndex={0} pageSize={specPageSize} pageCount={1} totalRows={pageRows.length}
                      getRowId={(r) => String(r.id)} onRowClick={(r) => r && setSelectedId(r.id)}
                      rows={pageRows} columns={tableCols} />
                  )}
                <Pager page={safeSpecPage} pageSize={specPageSize} total={filteredSpecs.length} noun="rules"
                  onPage={setSpecPage} onPageSize={(n) => { setSpecPageSize(n); setSpecPage(0) }} sizes={SPEC_PAGE_SIZES} />
              </CardState>
            </Card>

            {selectedSpec ? (
              <SpecDetail
                key={selectedSpec.id}
                spec={selectedSpec}
                usage={usageBySpec}
                history={history}
                isAdmin={isAdmin}
                onEdit={startEdit}
                onDuplicate={startDuplicate}
                onDelete={setDeletingSpec}
                onOpenPolicy={() => setActiveTab('policy')}
              />
            ) : (
              <Card title="Specification details"><div className="cc-empty">Select a specification to see its details.</div></Card>
            )}

            <div className="ts-two">
              <TreadPatternCard />
              <TechnicalDrawingCard spec={selectedSpec} />
            </div>
          </div>

          <aside className="ts-rail" aria-label="Specification form">
            <SpecFormPanel
              key={formKey}
              spec={editingSpec}
              isAdmin={isAdmin}
              saving={savingSpec}
              error={saveError}
              onSave={handleSaveSpec}
              onCancel={() => { setEditingSpec(null); setSaveError(''); setFormKey(k => k + 1) }}
            />
          </aside>
        </div>
      )}

      {activeTab !== 'specs' && (
        <div className="ts-workbench">
          {activeTab === 'compliance' && <ComplianceTab ctx={ctx} />}
          {activeTab === 'violations' && <NonConformanceTab ctx={ctx} />}
          {activeTab === 'defaults' && <QuickSetupTab ctx={ctx} />}
          {activeTab === 'policy' && <FitmentPolicyTab ctx={ctx} />}
          {activeTab === 'advisor' && <ValueAdvisorTab ctx={ctx} />}
          {activeTab === 'history' && <AuditTrailTab ctx={ctx} />}
        </div>
      )}

      {deletingSpec && (
        <DeleteConfirmModal
          spec={deletingSpec}
          onClose={() => setDeletingSpec(null)}
          onConfirm={handleDeleteSpec}
        />
      )}

      {workOrderAsset && (
        <RaiseWorkOrderModal
          asset={workOrderAsset}
          violations={workOrderAsset.violations}
          country={country}
          createdBy={user?.id}
          onClose={() => setWorkOrderAsset(null)}
        />
      )}

      {showQuoteModal && canManageQuotes && (
        <QuoteFormModal
          quote={editingQuote}
          onClose={() => { setShowQuoteModal(false); setEditingQuote(null) }}
          onSave={handleSaveQuote}
          saving={savingQuote}
        />
      )}

      {deletingQuote && (
        <DeleteQuoteConfirmModal
          quote={deletingQuote}
          onClose={() => setDeletingQuote(null)}
          onConfirm={handleDeleteQuote}
        />
      )}
    </div>
  )
}
