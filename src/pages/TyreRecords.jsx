/**
 * TyreRecords (route /tyres) - the tyre register, rebuilt on the shared page kit
 * to the owner's light reference design.
 *
 * Kept from the previous page, rule for rule: server-side paging with an exact
 * count, the debounced search box, the get_tyre_filter_options RPC for the site
 * and brand pickers (raw values so the exact `.eq()` still matches padded rows),
 * Excel and PDF export of the whole filtered set, add / edit with the country
 * rule (never a fabricated country), bulk edit, bulk export, bulk scrap through
 * scrap_tyre_by_serial, and bulk delete with a count check.
 *
 * Honest by construction: the KPI tiles are head-only server counts, never the
 * length of the page on screen. tyre_records carries three statuses (Active,
 * Removed, Scrapped) and no in-stock or in-repair status, so those two tiles
 * read N/A and say why. There is no pattern, temperature or installer column,
 * so none is shown. The detail panel reads the tyre passport bundle, the
 * running-life service and the odometer log; a history with no source says so.
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { tyreRecordFormSchema, RISK_LEVELS } from '../lib/validation/schemas'
import { FormField, FormSelect, FormDate, FormActions } from '../components/forms'
import * as tyreRecordsApi from '../lib/api/tyreRecords'
import { scrapTyreBySerial, getScrapPermissions } from '../lib/api/tyreExchange'
import { getPassportBundle } from '../lib/api/tyrePassport'
import { listTyreInspections } from '../lib/api/tyrePassportInspections'
import { getTyreRunningLife } from '../lib/api/tyreRunningLife'
import { shapeRow } from '../lib/tyreRunningLife'
import { buildPassport } from '../lib/tyrePassport'
import { movementRows, inspectionRowsForTyre, latestPressure } from '../lib/tyrePassportView'
import {
  statusMeta, conditionMeta, serialOf, positionOf, recordLifeKm, buildFleetMap, fleetFor,
  currentKmFor, lifeKmFor, cpkOf, averageLife, distinctOptions, activeFilterCount,
  latestInspectionByAsset, lifeUsage, matchRunningRow, kmTrend, installationRows,
  serviceRows, disposalRows, linkedAssets, costRows, currencyOf, photoUrls, STATUS_OPTIONS,
} from '../lib/tyreRecordsView'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { ALL_CATEGORY_LABELS } from '../lib/tyreClassifier'
import { formatCurrencyCompact } from '../lib/formatters'
import { useInvalidate } from '../hooks/useSupabaseQuery'
import { useBulkSelect } from '../hooks/useBulkSelect'
import CustomFieldsPanel from '../components/CustomFieldsPanel'
import {
  Database, CircleDot, Package, Wrench, Trash2, Gauge, Search, SlidersHorizontal,
  FileSpreadsheet, FileText, Plus, Eye, Edit2, MoreVertical, Layers, Truck,
  Recycle, ArrowLeftRight, ClipboardCheck, Link2, Receipt, Info, MapPin, X, AlertTriangle,
  Loader2, Download, Save, ExternalLink, ChevronDown,
} from 'lucide-react'
import DialogModal from '../components/ui/Modal'
import {
  PageHero, Kpi, Card, CardState, KitTable, Pager, VehicleThumb, useCard, fmtInt, fmtPct,
} from '../components/commandCenter/kit'
import { safeImageSrc } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'
import './TyreRecords.css'

// exportUtils pulls the PDF/Excel report engines (~41 kB gz) that most sessions
// never trigger, so it loads on first click instead of with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

const PAGE_SIZE = 25

/**
 * Country a NEW record inherits from the working context. On the All-countries
 * view there is no country to inherit, so the field opens BLANK and the user has
 * to choose one - a silent 'KSA' default would stamp a fabricated country (and
 * with it the currency and every cost report) onto a record nobody scoped.
 */
const defaultCountryFor = (active) => (active && active !== 'All' ? active : '')

// Plain literal, not a t() key: the locale files are outside this change, and a
// missing key would render the key itself on screen.
const COUNTRY_REQUIRED_HINT = 'Select a country. You are viewing all countries.'
const COUNTRY_PLACEHOLDER = 'Select a country'

const EMPTY_FORM = (defaultCost = 1200, country = '') => ({
  sr: '', issue_date: '', description: '', brand: '', serial_no: '',
  qty: 1, job_card: '', mis_number: '', asset_no: '', site: '', country,
  remarks: '', cost_per_tyre: defaultCost, risk_level: '', category: '',
  km_at_fitment: '', km_at_removal: '',
})

const EMPTY_BULK = { site: '', brand: '', cost_per_tyre: '', risk_level: '', category: '' }

const fmtKm = (v) => (v == null ? 'N/A' : `${fmtInt(Math.round(v))} km`)
const fmtDate = (d) => {
  if (!d) return 'N/A'
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const NA = <span className="cc-na">N/A</span>

export default function TyreRecords() {
  const { profile } = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const { t } = useLanguage()
  const invalidate = useInvalidate()

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [records, setRecords]         = useState([])
  const [total, setTotal]             = useState(0)
  const [page, setPage]               = useState(0)
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState('')
  const [sites, setSites]             = useState([])
  const [brands, setBrands]           = useState([])

  // Deep links (Scan Center, QR labels): /tyres?search=<serial> pre-filters.
  const [search, setSearch]           = useState(() => {
    try { return new URLSearchParams(window.location.search).get('search') || '' } catch { return '' }
  })
  // The term the QUERY runs on, 300 ms behind the box. Seeded from `search` so a
  // deep link (/tyres?search=<serial>) queries immediately rather than after a
  // needless empty read followed by the real one.
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [siteFilter, setSiteFilter]   = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [riskFilter, setRiskFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sizeFilter, setSizeFilter]   = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [showMore, setShowMore]       = useState(false)
  const [showBulk, setShowBulk]       = useState(false)
  const [kpiNonce, setKpiNonce]       = useState(0)

  const [selectedRec, setSelectedRec]     = useState(null)   // tyre shown in the detail panel
  const [detailRecord, setDetailRecord]   = useState(null)   // full-record dialog
  const [editRecord, setEditRecord]       = useState(null)
  const [showBulkEdit, setShowBulkEdit]   = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError]     = useState('')
  const [saving, setSaving]               = useState(false)
  const [scrapRows, setScrapRows]         = useState(null)   // rows awaiting scrap confirmation
  const [scrapReason, setScrapReason]     = useState('')
  const [scrapping, setScrapping]         = useState(false)
  const [formError, setFormError]         = useState('')
  const [bulkForm, setBulkForm]           = useState(EMPTY_BULK)
  const detailRef = useRef(null)

  // Add/Edit record form (react-hook-form + Zod). Values stay raw strings so
  // the saveRecord() payload coercion below is byte-identical to before.
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors: formErrors },
  } = useForm({
    resolver: zodResolver(tyreRecordFormSchema),
    defaultValues: EMPTY_FORM(),
  })

  // True only while the country is genuinely unchosen (the All-countries case),
  // which is when the field needs the hint rather than a quiet default.
  const countryUnset = !String(watch('country') || '').trim()

  // Bulk selection - driven by the current page's records
  const {
    selected, selectedRows, toggle, toggleAll, clear, isSelected, isAllSelected, count: bulkCount,
  } = useBulkSelect(records, 'id')

  // Every option filter the grid, the export and the KPI counts share.
  const optionFilters = useMemo(() => ({
    siteFilter, brandFilter, riskFilter, statusFilter, sizeFilter, positionFilter,
  }), [siteFilter, brandFilter, riskFilter, statusFilter, sizeFilter, positionFilter])

  // Monotonic request id: only the newest loadRecords() response is applied.
  const reqIdRef = useRef(0)

  useEffect(() => { loadFilters() }, [])
  // Debounce the search box. Typing straight into the load's dependencies fired
  // one `select('*', {count:'exact'})` PER KEYSTROKE, each a four-column
  // unanchored ILIKE plus an exact count that no index can serve. The page reset
  // only fires when the term actually changed, so landing on a restored
  // `?search=` keeps its page instead of snapping to the first.
  useEffect(() => {
    if (search === debouncedSearch) return
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(0) }, 300)
    return () => clearTimeout(timer)
  }, [search, debouncedSearch])
  // One RPC, already DISTINCT and sorted server-side. Two plain reads were
  // capped at 1000 rows and silently dropped sites and brands. Options are
  // byte-exact so the grid's `.eq()` still matches every row behind them.
  async function loadFilters() {
    try {
      const { sites: s, brands: b } = await tyreRecordsApi.listFilterOptions()
      setSites(s)
      setBrands(b)
    } catch {
      // A failed options read must not blank the grid: leave the pickers empty
      // rather than surfacing a filter list we know to be wrong.
      setSites([])
      setBrands([])
    }
  }

  const loadRecords = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    setLoadError('')
    try {
      const { data, count, error } = await tyreRecordsApi.listRecords({
        page, pageSize: PAGE_SIZE, search: debouncedSearch, ...optionFilters, country: activeCountry,
      })
      if (myReq !== reqIdRef.current) return   // a newer filter/page superseded this
      if (error) throw error
      setRecords(data ?? [])
      setTotal(count ?? 0)
      clear()
    } catch (e) {
      if (myReq === reqIdRef.current) { setRecords([]); setTotal(0); setLoadError(toUserMessage(e, 'Could not load tyre records.')) }
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)   // never leave the spinner stuck
    }
  }, [page, debouncedSearch, optionFilters, activeCountry, clear])

  useEffect(() => { loadRecords() }, [loadRecords])

  // KPI tiles: exact head-only counts under every filter except status (the
  // tiles ARE the status breakdown, so they must stay aimable).
  const kpiFilters = useMemo(() => ({ ...optionFilters, statusFilter: '', search: debouncedSearch }), [optionFilters, debouncedSearch])
  const counts = useCard(() => tyreRecordsApi.getRecordStatusCounts(kpiFilters, activeCountry), [kpiFilters, activeCountry, kpiNonce])
  const life = useCard(async () => {
    const res = await tyreRecordsApi.listRecordedLifeKm(kpiFilters, activeCountry)
    return { ...averageLife(res.values), truncated: res.truncated }
  }, [kpiFilters, activeCountry, kpiNonce])

  // Vehicle master and last inspection for the assets on THIS page only.
  const pageAssets = useMemo(() => [...new Set(records.map((r) => r.asset_no).filter(Boolean))], [records])
  const assetKey = pageAssets.join('|')
  const fleet = useCard(async () => buildFleetMap(await tyreRecordsApi.listFleetForAssets(pageAssets)), [assetKey])
  const insp = useCard(async () => latestInspectionByAsset(await tyreRecordsApi.listInspectionsForAssets(pageAssets, activeCountry)), [assetKey, activeCountry])

  // Size and position options are read on demand, when "More filters" opens.
  const sizePos = useCard(async () => {
    if (!showMore) return null
    const res = await tyreRecordsApi.listSizePositionOptions(activeCountry)
    return { sizes: distinctOptions(res.rows, 'size'), positions: distinctOptions(res.rows, 'position'), truncated: res.truncated }
  }, [showMore, activeCountry])

  // Keep a tyre in the detail panel: the first row until the user picks one.
  useEffect(() => {
    if (!records.length) return
    setSelectedRec((cur) => (cur && records.some((r) => r.id === cur.id) ? records.find((r) => r.id === cur.id) : (cur || records[0])))
  }, [records])

  const setFilter = (setter) => (v) => { setter(v); setPage(0) }
  const moreCount = (sizeFilter ? 1 : 0) + (positionFilter ? 1 : 0)
  const anyFilter = activeFilterCount(optionFilters) > 0 || !!debouncedSearch
  function clearFilters() {
    setSiteFilter(''); setBrandFilter(''); setRiskFilter(''); setStatusFilter('')
    setSizeFilter(''); setPositionFilter(''); setSearch(''); setPage(0)
  }

  function refreshAll() {
    loadRecords()
    loadFilters()
    setKpiNonce((n) => n + 1)
  }

  function openAdd() {
    // Cost is left blank so the user enters the ACTUAL cost - no settings default
    // is written into a record.
    reset(EMPTY_FORM('', defaultCountryFor(activeCountry)))
    setEditRecord({})
    setFormError('')
  }

  function openEdit(r) {
    reset({
      sr: r.sr ?? '', issue_date: r.issue_date ?? '', description: r.description ?? '',
      brand: r.brand ?? '', serial_no: r.serial_no ?? '', qty: r.qty ?? 1,
      job_card: r.job_card ?? '', mis_number: r.mis_number ?? '', asset_no: r.asset_no ?? '',
      site: r.site ?? '', country: r.country ?? 'KSA', remarks: r.remarks ?? '',
      cost_per_tyre: r.cost_per_tyre ?? '',
      risk_level: r.risk_level ?? '', category: r.category ?? '',
      km_at_fitment: r.km_at_fitment ?? '', km_at_removal: r.km_at_removal ?? '',
    })
    setEditRecord(r)
    setFormError('')
  }

  async function saveRecord(form) {
    // Never stamp a country the user did not choose: on the All-countries view the
    // field opens blank, so it has to be picked before the record can be saved.
    if (!String(form.country || '').trim()) {
      setFormError(COUNTRY_REQUIRED_HINT)
      return
    }
    setSaving(true)
    setFormError('')
    const payload = {
      ...form,
      // Empty date field must be null, not '' - Postgres rejects '' for type date
      // (22007), which broke editing/saving any record with no issue date.
      issue_date: form.issue_date || null,
      qty: +form.qty || 1,
      // Store the actual entered cost, or null when left blank - never a default.
      cost_per_tyre: form.cost_per_tyre !== '' && form.cost_per_tyre != null ? +form.cost_per_tyre : null,
      km_at_fitment: form.km_at_fitment !== '' ? +form.km_at_fitment : null,
      km_at_removal: form.km_at_removal !== '' ? +form.km_at_removal : null,
      country: form.country,
      region: profile?.region ?? 'KSA',
      uploaded_by: profile?.id,
    }
    const { error } = editRecord?.id
      ? await tyreRecordsApi.updateRecord(editRecord.id, payload)
      : await tyreRecordsApi.insertRecord(payload)

    if (error) { setFormError(toUserMessage(error)); setSaving(false); return }
    setEditRecord(null)
    refreshAll()
    setSaving(false)
  }

  async function saveBulkEdit(e) {
    e.preventDefault()
    setSaving(true)
    const patch = {}
    if (bulkForm.site)          patch.site          = bulkForm.site
    if (bulkForm.brand)         patch.brand         = bulkForm.brand
    if (bulkForm.cost_per_tyre) patch.cost_per_tyre = +bulkForm.cost_per_tyre
    if (bulkForm.risk_level)    patch.risk_level    = bulkForm.risk_level
    if (bulkForm.category)      patch.category      = bulkForm.category

    if (Object.keys(patch).length === 0) { setSaving(false); setShowBulkEdit(false); return }

    const ids = [...selected]
    const BATCH = 200
    for (let i = 0; i < ids.length; i += BATCH) {
      await tyreRecordsApi.updateRecordsByIds(ids.slice(i, i + BATCH), patch)
    }
    setShowBulkEdit(false)
    setBulkForm(EMPTY_BULK)
    clear()
    refreshAll()
    setSaving(false)
  }

  async function deleteSelected() {
    setSaving(true)
    setDeleteError('')
    const ids = [...selected]
    const BATCH = 200
    let deleted = 0
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH)
        // Count-verify each batch so a silent RLS/constraint failure surfaces
        // instead of the button appearing to do nothing.
        const { data, error } = await tyreRecordsApi.deleteRecordsByIds(chunk)
        if (error) throw error
        deleted += data?.length ?? 0
      }
      if (deleted === 0) {
        // Rows matched none deleted: almost always the delete RLS policy
        // (only Admin may delete tyre records).
        throw new Error(
          (profile?.role || '').toLowerCase() === 'admin'
            ? t('records.delete.errNoneDeleted')
            : t('records.delete.errNoPermission'),
        )
      }
      setShowDeleteConfirm(false)
      clear()
      refreshAll()
    } catch (e) {
      setDeleteError(toUserMessage(e, t('records.delete.errFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function handleBulkExport(rows) {
    const headers = ['Issue Date', 'Asset No', 'Serial No', 'Brand', 'Size', 'Position', 'Status', 'Site', 'MIS No', 'Job Card', 'Risk Level', 'Cost', 'Category', 'Remarks']
    const csv = [
      headers.join(','),
      ...rows.map(r => [
        r.issue_date ?? '', r.asset_no ?? '', r.serial_no ?? '', r.brand ?? '', r.size ?? '',
        r.position ?? '', r.status ?? '', r.site ?? '', r.mis_number ?? '', r.job_card ?? '',
        r.risk_level ?? '', r.cost_per_tyre ?? '', r.category ?? '', r.remarks ?? '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tyres_export_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    clear()
  }

  /**
   * Scrap goes through scrap_tyre_by_serial, which writes the scrap mark and the
   * status together and stamps the actor. A row with no serial cannot be marked
   * (the mark is keyed on the serial); those fall back to the plain status write
   * and are reported rather than silently left untraceable.
   */
  function handleBulkScrap(rows) {
    setScrapReason('')
    setScrapRows(rows)
  }

  async function confirmBulkScrap() {
    const rows = scrapRows || []
    if (!rows.length) { setScrapRows(null); return }
    setScrapping(true)
    try {
      await runBulkScrap(rows, scrapReason)
    } finally {
      setScrapping(false)
      setScrapRows(null)
    }
  }

  async function runBulkScrap(rows, reason) {
    const { canScrap } = await getScrapPermissions()
    if (!canScrap) {
      window.alert('You do not have permission to scrap a tyre. An admin can grant it in Access Control.')
      return
    }

    const serials = [...new Set(rows.map(r => String(r.serial_no || '').trim()).filter(Boolean))]
    const noSerial = rows.filter(r => !String(r.serial_no || '').trim())
    const failed = []

    // modest concurrency: one RPC per serial, but never a flood
    const POOL = 5
    for (let i = 0; i < serials.length; i += POOL) {
      const slice = serials.slice(i, i + POOL)
      const results = await Promise.allSettled(slice.map(s =>
        scrapTyreBySerial(s, { reason, country: rows.find(r => r.serial_no === s)?.country || null })))
      results.forEach((res, j) => { if (res.status === 'rejected') failed.push(slice[j]) })
    }

    // serial-less rows keep the old behaviour, because nothing else is possible
    if (noSerial.length) {
      const ids = noSerial.map(r => r.id)
      const BATCH = 200
      for (let i = 0; i < ids.length; i += BATCH) {
        await tyreRecordsApi.updateRecordsByIds(ids.slice(i, i + BATCH), { status: 'Scrapped' })
      }
    }

    if (failed.length || noSerial.length) {
      window.alert([
        failed.length ? `${failed.length} could not be scrapped: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '...' : ''}` : '',
        noSerial.length ? `${noSerial.length} row${noSerial.length === 1 ? '' : 's'} had no serial number, so they were marked scrapped without a traceable record.` : '',
      ].filter(Boolean).join('\n'))
    }

    invalidate(['tyres'])
    refreshAll()
    clear()
  }

  const EXPORT_COLS = [
    { key: 'issue_date',    header: 'Date',                  width: 22 },
    { key: 'asset_no',      header: 'Asset No',              width: 26 },
    { key: 'serial_no',     header: 'Serial No',             width: 30 },
    { key: 'brand',         header: 'Brand',                 width: 24 },
    { key: 'size',          header: 'Size',                  width: 24 },
    { key: 'position',      header: 'Position',              width: 18 },
    { key: 'status',        header: 'Status',                width: 18 },
    { key: 'site',          header: 'Site',                  width: 28 },
    { key: 'mis_number',    header: 'MIS No',                width: 24 },
    { key: 'job_card',      header: 'Job Card',              width: 24 },
    { key: 'category',      header: 'Category',              width: 30 },
    { key: 'risk_level',    header: 'Risk Level',            width: 20 },
    { key: 'cost_per_tyre', header: `Cost (${activeCurrency})`, width: 20 },
    { key: 'remarks_cleaned', header: 'Remarks',             width: 40 },
  ]

  async function fetchAll() {
    // The exported set must be the set on screen, so this uses the term the grid
    // is actually filtered by - not whatever is half-typed in the box.
    const { data, error, truncated } = await tyreRecordsApi.listAllRecords({
      search: debouncedSearch, ...optionFilters, country: activeCountry,
    })
    if (error) throw error
    if (truncated) throw new Error('Too many records to export completely. Narrow your filters.')
    return data ?? []
  }

  async function downloadRecords(kind) {
    if (exporting) return
    setExporting(true); setExportError('')
    try {
      const rows = await fetchAll()
      const exporter = await loadExportUtils()
      const name = 'TyrePulse_Records_' + new Date().toISOString().slice(0, 10)
      if (kind === 'excel') await exporter.exportToExcel(rows, EXPORT_COLS.map(c => c.key), EXPORT_COLS.map(c => c.header), name, 'Tyre Records')
      else await exporter.exportToPdf(rows, EXPORT_COLS, 'Tyre Records: ' + rows.length.toLocaleString() + ' records', name)
    } catch (err) { setExportError(toUserMessage(err, 'Could not download these records. Please retry.')) }
    finally { setExporting(false) }
  }

  function showInDetail(r) {
    setSelectedRec(r)
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const fleetMap = fleet.data
  const inspMap = insp.data

  const columns = [
    {
      key: 'sel', sortable: false,
      header: <input type="checkbox" aria-label="Select all tyres on this page" checked={isAllSelected} onChange={toggleAll} />,
      cell: (r) => <span onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select tyre ${serialOf(r) || r.asset_no || ''}`} checked={isSelected(r.id)} onChange={() => toggle(r.id)} /></span>,
    },
    { key: 'tyre', header: '', cell: () => <span className="tr-tyre-ico" aria-hidden="true"><CircleDot size={18} /></span> },
    {
      key: 'serial', header: 'Serial number',
      cell: (r) => serialOf(r)
        ? <button type="button" className="tr-serial" onClick={(e) => { e.stopPropagation(); showInDetail(r) }}>{serialOf(r)}</button>
        : NA,
    },
    { key: 'brand', header: 'Tyre brand', cell: (r) => r.brand?.trim() ? r.brand : NA },
    { key: 'size', header: 'Size', cell: (r) => r.size?.trim() ? r.size : NA },
    { key: 'position', header: 'Position', cell: (r) => positionOf(r) || NA },
    {
      key: 'vehicle', header: 'Vehicle / asset',
      cell: (r) => {
        if (!r.asset_no) return NA
        const f = fleetFor(fleetMap, r)
        return (
          <span className="cc-vehicle">
            <VehicleThumb row={f || { asset_no: r.asset_no, vehicle_type: r.vehicle_type }} size="sm" />
            <span><span className="cc-strong">{r.asset_no}</span><span className="tr-sub">{f?.vehicle_type || r.vehicle_type || r.site || ''}</span></span>
          </span>
        )
      },
    },
    {
      key: 'currentKm', header: 'Current km', align: 'right',
      cell: (r) => {
        const c = currentKmFor(r, fleetFor(fleetMap, r))
        return c.value == null ? NA : <span title={c.basis === 'vehicle' ? 'Vehicle odometer now' : 'Odometer at removal'}>{fmtInt(Math.round(c.value))}{c.basis === 'removal' && <span className="tr-sub">at removal</span>}</span>
      },
    },
    { key: 'life', header: 'Life (km)', align: 'right', cell: (r) => { const v = lifeKmFor(r, fleetFor(fleetMap, r)); return v == null ? NA : fmtInt(Math.round(v)) } },
    { key: 'condition', header: 'Condition', cell: (r) => { const c = conditionMeta(r.risk_level); return c ? <span className={`cc-pill ${c.tone}`}>{c.label}</span> : NA } },
    { key: 'status', header: 'Status', cell: (r) => { const s = statusMeta(r.status); return <span className={`cc-pill ${s.tone}`}>{s.label}</span> } },
    {
      key: 'lastInsp', header: 'Last inspection',
      cell: (r) => {
        if (String(r.status || '').toLowerCase() !== 'active') return NA
        const d = inspMap?.get(String(r.asset_no || '').trim().toUpperCase())
        return d ? <span title="Latest inspection of the vehicle this tyre is fitted to">{fmtDate(d)}</span> : NA
      },
    },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (r) => (
        <span className="tr-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="cc-icon-btn" aria-label="View tyre details" title="View details" onClick={() => showInDetail(r)}><Eye size={14} /></button>
          <button type="button" className="cc-icon-btn" aria-label="Edit tyre record" title="Edit" onClick={() => openEdit(r)}><Edit2 size={14} /></button>
          <button type="button" className="cc-icon-btn" aria-label="Full record and more actions" title="Full record" onClick={() => setDetailRecord(r)}><MoreVertical size={14} /></button>
        </span>
      ),
    },
  ]

  const c = counts.data
  const countNa = counts.error ? 'N/A' : undefined
  const lifeDisplay = life.error ? 'N/A' : (life.data?.avg == null ? 'N/A' : `${fmtInt(Math.round(life.data.avg))} km`)

  return (
    <div className="cc tr-page">
      <PageHero
        title="Tyre Records"
        lead="Maintain complete tyre lifecycle records including installation, movement, inspection, repair and disposal"
        imgLight="/dashboard/hero-tyres-light.webp"
        imgDark="/dashboard/hero-tyres-dark.webp"
      />

      <div className="tr-toolbar">
        {counts.error && <span className="tr-note" role="alert">Counts could not be loaded. <button type="button" className="cc-link cc-link-btn" onClick={counts.retry}>Retry</button></span>}
        <button type="button" className="cc-btn-primary" onClick={openAdd}><Plus size={15} aria-hidden="true" /> Add Tyre Record</button>
      </div>

      {exportError && (
        <div className="cc-card tr-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /><span>{exportError}</span>
          <button type="button" className="cc-icon-btn" onClick={() => setExportError('')} aria-label="Dismiss export error"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis">
        <Kpi icon={Database} tone="t-green" loading={counts.loading} display={countNa} value={c?.total} label="Total tyres"
          onClick={() => setFilter(setStatusFilter)('')}
          title={c ? `Every tyre record under the filters above, including ${fmtInt(c.removed)} removed. Click to show all statuses.` : 'Every tyre record under the filters above.'} />
        <Kpi icon={CircleDot} tone="t-blue" loading={counts.loading} display={countNa} value={c?.active} label="In use"
          onClick={() => setFilter(setStatusFilter)('Active')} title="Tyre records with status Active. Click to filter." />
        <Kpi icon={Package} tone="t-purple" display="N/A" label="In stock" to="/stock"
          title="Tyre records carry no in-stock status. Stock on hand is tracked in Stock Management." />
        <Kpi icon={Wrench} tone="t-amber" display="N/A" label="In repair"
          title="Tyre records carry no in-repair status, so this cannot be counted. Repairs appear in each tyre's repair history." />
        <Kpi icon={Trash2} tone="t-red" loading={counts.loading} display={countNa} value={c?.scrapped} label="Scrapped"
          onClick={() => setFilter(setStatusFilter)('Scrapped')} title="Tyre records with status Scrapped. Click to filter." />
        <Kpi icon={Gauge} tone="t-green" loading={life.loading} display={lifeDisplay} label="Average life"
          title={life.data?.n ? `Average recorded life across ${fmtInt(life.data.n)} tyres with a life on record${life.data.truncated ? ' (partial read)' : ''}. Status filter not applied.` : 'No tyre under these filters has a recorded life.'} />
      </div>

      <section className="cc-card tr-filters" aria-label="Filters">
        <div className="cc-filters">
          <label className="cc-field">
            <span>Site</span>
            <select className="cc-select" value={siteFilter} onChange={(e) => setFilter(setSiteFilter)(e.target.value)}>
              <option value="">{t('records.filters.allSites')}</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="cc-field">
            <span>Brand</span>
            <select className="cc-select" value={brandFilter} onChange={(e) => setFilter(setBrandFilter)(e.target.value)}>
              <option value="">{t('records.filters.allBrands')}</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="cc-field">
            <span>Condition</span>
            <select className="cc-select" value={riskFilter} onChange={(e) => setFilter(setRiskFilter)(e.target.value)}>
              <option value="">All conditions</option>
              {['Critical', 'High', 'Medium', 'Low'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="cc-field">
            <span>Status</span>
            <select className="cc-select" value={statusFilter} onChange={(e) => setFilter(setStatusFilter)(e.target.value)}>
              <option value="">All status</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusMeta(s).label}</option>)}
            </select>
          </label>
          <label className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" aria-label="Search tyre records" placeholder="Search by serial, asset, MIS or job card" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <button type="button" className="cc-btn-ghost" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
            <SlidersHorizontal size={15} aria-hidden="true" /> More filters{moreCount ? ` (${moreCount})` : ''}
          </button>
          <button type="button" className="cc-btn-ghost" disabled={exporting} onClick={() => downloadRecords('excel')}>
            {exporting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet size={15} aria-hidden="true" />} Export Excel
          </button>
          <button type="button" className="cc-btn-ghost" disabled={exporting} onClick={() => downloadRecords('pdf')}>
            <FileText size={15} aria-hidden="true" /> Export PDF
          </button>
          <button type="button" className="cc-btn-primary" aria-expanded={showBulk} onClick={() => setShowBulk((v) => !v)}>
            Bulk Actions <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>

        {showMore && (
          <div className="cc-filters tr-more">
            <label className="cc-field">
              <span>Size</span>
              <select className="cc-select" value={sizeFilter} disabled={sizePos.loading} onChange={(e) => setFilter(setSizeFilter)(e.target.value)}>
                <option value="">{sizePos.loading ? 'Loading sizes...' : 'All sizes'}</option>
                {(sizePos.data?.sizes || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="cc-field">
              <span>Position</span>
              <select className="cc-select" value={positionFilter} disabled={sizePos.loading} onChange={(e) => setFilter(setPositionFilter)(e.target.value)}>
                <option value="">{sizePos.loading ? 'Loading positions...' : 'All positions'}</option>
                {(sizePos.data?.positions || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {sizePos.error && <span className="tr-note" role="alert">Size and position options could not be loaded. <button type="button" className="cc-link cc-link-btn" onClick={sizePos.retry}>Retry</button></span>}
            {sizePos.data?.truncated && <span className="tr-note">Options read from the first 20,000 records.</span>}
            {anyFilter && <button type="button" className="cc-link cc-link-btn" onClick={clearFilters}><X size={13} aria-hidden="true" /> Clear filters</button>}
          </div>
        )}

        {showBulk && (
          <div className="cc-bulk">
            <span className="cc-bulk-count">{bulkCount ? `${fmtInt(bulkCount)} selected` : 'Select tyres in the table to act on them'}</span>
            <button type="button" className="cc-btn-ghost" disabled={!bulkCount} onClick={() => { setBulkForm(EMPTY_BULK); setShowBulkEdit(true) }}><Edit2 size={14} aria-hidden="true" /> {t('records.bulk.bulkEdit')}</button>
            <button type="button" className="cc-btn-ghost" disabled={!bulkCount} onClick={() => handleBulkExport(selectedRows)}><Download size={14} aria-hidden="true" /> {t('records.bulk.exportSelected')}</button>
            <button type="button" className="cc-btn-ghost" disabled={!bulkCount} onClick={() => handleBulkScrap(selectedRows)}><Recycle size={14} aria-hidden="true" /> {t('records.bulk.markScrapped')}</button>
            <button type="button" className="cc-btn-ghost tr-danger" disabled={!bulkCount} onClick={() => setShowDeleteConfirm(true)}><Trash2 size={14} aria-hidden="true" /> {t('records.bulk.delete')}</button>
            {bulkCount > 0 && <button type="button" className="cc-link cc-link-btn" onClick={clear}>Clear selection</button>}
          </div>
        )}
      </section>

      <section className="cc-card tr-register" aria-label="Tyre register">
        <div className="cc-card-head">
          <div>
            <h2 className="cc-card-title" aria-live="polite">Tyre register <span className="tr-count">({fmtInt(total)} records)</span></h2>
            {anyFilter && <p className="cc-card-sub">Filtered. The tiles above follow these filters except status.</p>}
          </div>
          {!showBulk && bulkCount > 0 && (
            <span className="tr-selinfo">{fmtInt(bulkCount)} selected <button type="button" className="cc-link cc-link-btn" onClick={() => setShowBulk(true)}>Actions</button></span>
          )}
        </div>
        {loading ? (
          <div style={{ display: 'grid', gap: 8 }}>{Array.from({ length: 8 }, (_, i) => <div key={i} className="cc-skel" style={{ height: 40 }} />)}</div>
        ) : loadError ? (
          <div className="cc-empty" role="alert"><div><b>Could not load tyre records</b><br />{loadError}<br /><button type="button" className="cc-btn" onClick={loadRecords}>Retry</button></div></div>
        ) : records.length === 0 ? (
          <div className="cc-empty">{anyFilter ? 'No tyre records match these filters. Clear a filter to widen the list.' : t('records.states.noRecords')}</div>
        ) : (
          <KitTable className="tr-table" manualPagination showPagination={false} enableSorting={false}
            pageIndex={page} pageSize={PAGE_SIZE} pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))} totalRows={total}
            getRowId={(r) => String(r.id)} onRowClick={showInDetail} rows={records} columns={columns} />
        )}
        {!loading && !loadError && total > 0 && (
          <Pager page={page} pageSize={PAGE_SIZE} total={total} noun="records" onPage={setPage} />
        )}
      </section>

      <div ref={detailRef}>
        {selectedRec
          ? <TyreDetail key={selectedRec.id} record={selectedRec} fleetRow={fleetFor(fleetMap, selectedRec)}
              vehicleInspection={inspMap?.get(String(selectedRec.asset_no || '').trim().toUpperCase()) || null}
              country={activeCountry} activeCurrency={activeCurrency}
              onEdit={() => openEdit(selectedRec)} onFull={() => setDetailRecord(selectedRec)} />
          : !loading && !loadError && records.length > 0 && <Card title="Tyre details"><div className="cc-empty">Select a tyre in the register to see its details.</div></Card>}
      </div>

      {/* Full record dialog (every stored field, custom fields, and actions) */}
      {detailRecord && (
        <Modal title={t('records.detail.title')} onClose={() => setDetailRecord(null)}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              [t('records.detail.assetNo'), detailRecord.asset_no], [t('records.detail.serialNo'), detailRecord.serial_no],
              [t('records.detail.brand'), detailRecord.brand], [t('records.detail.site'), detailRecord.site],
              [t('records.detail.issueDate'), detailRecord.issue_date], [t('records.detail.misNumber'), detailRecord.mis_number],
              [t('records.detail.jobCard'), detailRecord.job_card], [t('records.detail.qty'), detailRecord.qty],
              [t('records.detail.riskLevel'), detailRecord.risk_level], [t('records.detail.category'), detailRecord.category],
              [t('records.detail.cost'), detailRecord.cost_per_tyre ? formatCurrencyCompact(detailRecord.cost_per_tyre, currencyOf(detailRecord.country) || activeCurrency) : null],
              [t('records.detail.description'), detailRecord.description, true], [t('records.detail.remarks'), detailRecord.remarks, true],
            ].filter(([, v]) => v).map(([k, v, wide]) => (
              <div key={k} className={wide ? 'col-span-2' : ''}>
                <dt className="text-muted text-xs mb-0.5">{k}</dt>
                <dd className="font-medium" style={{ color: 'var(--text-primary)' }}>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <CustomFieldsPanel data={detailRecord.extra_fields} title={t('records.detail.customFields')} />
          </div>
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[var(--border-dim)]">
            <button onClick={() => { openEdit(detailRecord); setDetailRecord(null) }} className="btn-secondary flex items-center gap-2 text-sm">
              <Edit2 size={14} /> {t('records.detail.editRecord')}
            </button>
            {serialOf(detailRecord) && (
              <Link to={`/tyre-passport/${encodeURIComponent(serialOf(detailRecord))}`} className="btn-secondary flex items-center gap-2 text-sm">
                <ExternalLink size={14} /> Tyre passport
              </Link>
            )}
            {String(detailRecord.status || '').toLowerCase() !== 'scrapped' && (
              <button onClick={() => { const r = detailRecord; setDetailRecord(null); handleBulkScrap([r]) }} className="btn-secondary flex items-center gap-2 text-sm">
                <Recycle size={14} /> Scrap this tyre
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* Add / Edit modal */}
      {editRecord !== null && (
        <Modal title={editRecord.id ? t('records.form.editTitle') : t('records.form.newTitle')} onClose={() => setEditRecord(null)} busy={saving} wide>
          {formError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/25 text-red-300 rounded-xl px-4 py-2.5 mb-4 text-sm">
              <AlertTriangle size={14} className="shrink-0" /> {formError}
            </div>
          )}
          <form onSubmit={handleSubmit(saveRecord)} noValidate className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormDate label={t('records.form.issueDate')} error={formErrors.issue_date} {...register('issue_date')} />
              <FormField label={t('records.form.srRefNo')} error={formErrors.sr} {...register('sr')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('records.form.site')} list="site-list" placeholder={t('records.form.selectOrType')} error={formErrors.site} {...register('site')}>
                <datalist id="site-list">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </FormField>
              <FormField label={t('records.form.brand')} list="brand-list" placeholder={t('records.form.selectOrType')} error={formErrors.brand} {...register('brand')}>
                <datalist id="brand-list">{brands.map(b => <option key={b} value={b} />)}</datalist>
              </FormField>
            </div>
            <FormField label={t('records.form.description')} error={formErrors.description} {...register('description')} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label={t('records.form.assetNo')} required error={formErrors.asset_no} {...register('asset_no')} />
              <FormField label={t('records.form.serialNo')} error={formErrors.serial_no} {...register('serial_no')} />
              <FormField label={t('records.form.qty')} type="number" min={1} error={formErrors.qty} {...register('qty')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('records.form.misNumber')} error={formErrors.mis_number} {...register('mis_number')} />
              <FormField label={t('records.form.jobCard')} error={formErrors.job_card} {...register('job_card')} />
            </div>
            <FormField label={t('records.form.remarks')} multiline rows={2} error={formErrors.remarks} {...register('remarks')} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <FormSelect
                  label={t('records.form.country')}
                  required
                  placeholder={COUNTRY_PLACEHOLDER}
                  options={COUNTRIES}
                  error={formErrors.country}
                  {...register('country')}
                />
                {countryUnset && (
                  <p className="mt-1 text-xs text-amber-300">{COUNTRY_REQUIRED_HINT}</p>
                )}
              </div>
              <FormField label={t('records.form.kmAtFitment')} type="number" min={0} placeholder={t('records.form.optional')} error={formErrors.km_at_fitment} {...register('km_at_fitment')} />
              <FormField label={t('records.form.kmAtRemoval')} type="number" min={0} placeholder={t('records.form.optional')} error={formErrors.km_at_removal} {...register('km_at_removal')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label={t('records.form.cost')} type="number" min={0} step={100} error={formErrors.cost_per_tyre} {...register('cost_per_tyre')} />
              <FormSelect label={t('records.form.riskLevel')} placeholder={t('records.form.none')} options={RISK_LEVELS} error={formErrors.risk_level} {...register('risk_level')} />
              <FormSelect label={t('records.form.category')} placeholder={t('records.form.none')} options={ALL_CATEGORY_LABELS} error={formErrors.category} {...register('category')} />
            </div>
            <FormActions
              align="start"
              className="pt-2"
              saving={saving}
              onCancel={() => setEditRecord(null)}
              submitLabel={t('records.form.save')}
              savingLabel={t('records.form.saving')}
              cancelLabel={t('records.form.cancel')}
            />
          </form>
        </Modal>
      )}

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <Modal title={t('records.bulkEdit.title', { count: bulkCount })} onClose={() => setShowBulkEdit(false)} busy={saving}>
          <p className="text-sm text-muted mb-4">{t('records.bulkEdit.hint')}</p>
          <form onSubmit={saveBulkEdit} className="space-y-3">
            <div>
              <label className="label">{t('records.bulkEdit.changeSite')}</label>
              <input className="input" list="site-list-bulk" value={bulkForm.site} onChange={e => setBulkForm(f => ({ ...f, site: e.target.value }))} placeholder={t('records.bulkEdit.leaveBlankToKeep')} />
              <datalist id="site-list-bulk">{sites.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label className="label">{t('records.bulkEdit.changeBrand')}</label>
              <input className="input" list="brand-list-bulk" value={bulkForm.brand} onChange={e => setBulkForm(f => ({ ...f, brand: e.target.value }))} placeholder={t('records.bulkEdit.leaveBlankToKeep')} />
              <datalist id="brand-list-bulk">{brands.map(b => <option key={b} value={b} />)}</datalist>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label className="label">{t('records.bulkEdit.cost')}</label><input type="number" className="input" value={bulkForm.cost_per_tyre} onChange={e => setBulkForm(f => ({ ...f, cost_per_tyre: e.target.value }))} placeholder="-" min={0} /></div>
              <div>
                <label className="label">{t('records.bulkEdit.riskLevel')}</label>
                <select className="input" value={bulkForm.risk_level} onChange={e => setBulkForm(f => ({ ...f, risk_level: e.target.value }))}>
                  <option value="">{t('records.bulkEdit.keepExisting')}</option>
                  {['Critical', 'High', 'Medium', 'Low'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('records.bulkEdit.category')}</label>
                <select className="input" value={bulkForm.category} onChange={e => setBulkForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="">{t('records.bulkEdit.keepExisting')}</option>
                  {ALL_CATEGORY_LABELS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? t('records.bulkEdit.updating') : t('records.bulkEdit.update', { count: bulkCount })}
              </button>
              <button type="button" onClick={() => setShowBulkEdit(false)} className="btn-secondary">{t('records.form.cancel')}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <Modal title={t('records.delete.title')} onClose={() => { setShowDeleteConfirm(false); setDeleteError('') }} busy={saving}>
          <div className="flex gap-3 mb-5 p-4 rounded-xl bg-red-500/8 border border-red-500/20">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{t('records.delete.question', { count: bulkCount })}</p>
              <p className="text-muted text-sm mt-1">{t('records.delete.warning')}</p>
            </div>
          </div>
          {deleteError && (
            <div className="flex gap-2 mb-4 p-3 rounded-xl bg-red-900/30 border border-red-700 text-red-300 text-sm">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{deleteError}</span>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={deleteSelected} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {saving ? t('records.delete.deleting') : t('records.delete.confirm', { count: bulkCount })}
            </button>
            <button onClick={() => setShowDeleteConfirm(false)} disabled={saving} className="btn-secondary disabled:opacity-50">{t('records.form.cancel')}</button>
          </div>
        </Modal>
      )}

      {/* Scrap confirmation (reason recorded against each tyre) */}
      {scrapRows && (
        <Modal title="Scrap tyres" onClose={() => setScrapRows(null)} busy={scrapping}>
          <div className="flex gap-3 mb-4 p-4 rounded-xl bg-red-500/8 border border-red-500/20">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {t('records.bulk.scrapConfirm', { count: scrapRows.length })}
            </p>
          </div>
          <label htmlFor="bulk-scrap-reason" className="label">Reason for scrapping these tyres (recorded against each one)</label>
          <textarea
            id="bulk-scrap-reason"
            className="input"
            rows={2}
            value={scrapReason}
            onChange={e => setScrapReason(e.target.value)}
            disabled={scrapping}
          />
          <div className="flex gap-3 mt-4">
            <button onClick={confirmBulkScrap} disabled={scrapping} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
              {scrapping ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {scrapping ? 'Scrapping...' : `Scrap ${scrapRows.length}`}
            </button>
            <button onClick={() => setScrapRows(null)} disabled={scrapping} className="btn-secondary disabled:opacity-50">{t('records.form.cancel')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children, wide = false, busy = false }) {
  // Thin adapter over the shared dialog shell so every call site above keeps
  // its props. While a save or delete is running the dialog cannot be dismissed.
  return (
    <DialogModal open title={title} onClose={busy ? undefined : onClose} size={wide ? 'lg' : 'md'}>
      {children}
    </DialogModal>
  )
}

// ── Selected-tyre detail ─────────────────────────────────────────────────────

const DETAIL_TABS = [
  { key: 'details', label: 'Tyre details', icon: Info },
  { key: 'install', label: 'Installation history', icon: Layers },
  { key: 'movement', label: 'Movement history', icon: ArrowLeftRight },
  { key: 'inspection', label: 'Inspection history', icon: ClipboardCheck },
  { key: 'repair', label: 'Repair history', icon: Wrench },
  { key: 'retread', label: 'Retreading history', icon: Recycle },
  { key: 'disposal', label: 'Disposal history', icon: Trash2 },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'linked', label: 'Linked assets', icon: Link2 },
  { key: 'cost', label: 'Cost history', icon: Receipt },
]

function TyreDetail({ record, fleetRow, vehicleInspection, country, activeCurrency, onEdit, onFull }) {
  const [tab, setTab] = useState('details')
  const serial = serialOf(record)
  const active = String(record.status || '').toLowerCase() === 'active'

  // The passport bundle follows the serial across every vehicle. A record with
  // no serial can only speak for itself.
  const pass = useCard(async () => {
    if (!serial) {
      const p = buildPassport([record], {})
      return { passport: p, records: [record], unavailable: [], serialless: true }
    }
    const b = await getPassportBundle(serial, { country })
    return { passport: buildPassport(b.records, b), records: b.records, unavailable: b.unavailableSources || [], serialless: false }
  }, [record.id, serial, country])
  const passport = pass.data?.passport || null

  const run = useCard(async () => {
    if (!active || !record.asset_no) return null
    const res = await getTyreRunningLife({ country: record.country || country, asset: record.asset_no, maxAgeMs: 60000 })
    if (res?.ok === false) throw new Error(res.reason || 'Running life could not be loaded.')
    return matchRunningRow((res?.rows || []).map(shapeRow), record)
  }, [record.id, active, country])

  const odo = useCard(async () => {
    if (!record.asset_no) return []
    const since = record.fitment_date || record.issue_date || null
    const rows = await tyreRecordsApi.listOdometerSince(record.asset_no, since, record.country || country)
    return record.removal_date ? rows.filter((r) => String(r.reading_date) <= String(record.removal_date)) : rows
  }, [record.id, country])

  const inspections = useCard(async () => {
    if (!passport) return null
    const { rows, truncated } = await listTyreInspections(serial, passport.assets || [], { country })
    return { rows: inspectionRowsForTyre({ inspections: rows, journey: passport.journey, serial }), truncated }
  }, [record.id, passport, country])

  const usage = lifeUsage(record, run.data)
  const trend = kmTrend(odo.data || [], record.km_at_fitment)
  const status = statusMeta(record.status)
  const inspRows = inspections.data?.rows || []
  const lastInsp = inspRows[0] || null
  const pressure = passport ? latestPressure(passport, inspRows) : { value: null }
  const recCurrency = currencyOf(record.country) || (country && country !== 'All' ? activeCurrency : null)
  const cpk = cpkOf(record)
  const photos = photoUrls(record)

  // Condition waits on the passport (its inspection match needs the journey).
  const inspState = pass.error ? pass
    : (pass.loading || (!inspections.data && !inspections.error)) ? { loading: true, data: null } : inspections
  const tabBody = () => {
    if (tab === 'details') return null
    if (tab === 'documents') return <div className="cc-empty">No documents are stored against tyre records. Attach supplier or warranty papers in the tyre passport or warranty claims.</div>
    return (
      <CardState state={pass}>
        {passport ? <HistoryTab tab={tab} passport={passport} records={pass.data.records} inspections={inspections} currency={recCurrency} /> : <div className="cc-empty">No history found for this tyre.</div>}
      </CardState>
    )
  }

  return (
    <div className="tr-detail">
      <nav className="cc-card tr-menu" aria-label="Tyre detail sections">
        {DETAIL_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" className="tr-menu-item" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
        {serial && <Link className="tr-menu-link" to={`/tyre-passport/${encodeURIComponent(serial)}`}><ExternalLink size={13} aria-hidden="true" /> Open tyre passport</Link>}
      </nav>

      {tab !== 'details' ? (
        <Card title={DETAIL_TABS.find((d) => d.key === tab)?.label} sub={serial ? `Serial ${serial}` : 'This record has no serial, so only this record is shown.'} className="tr-panel">
          {pass.data?.unavailable?.length > 0 && <p className="tr-note">Not available right now: {pass.data.unavailable.join(', ')}.</p>}
          {tabBody()}
        </Card>
      ) : (
        <div className="tr-detail-grid">
          <Card title="Tyre details" className="tr-a-details" action={<button type="button" className="cc-link cc-link-btn" onClick={onEdit}><Edit2 size={13} aria-hidden="true" /> Edit</button>}>
            <div className="tr-details">
              <span className="tr-tyre-big" aria-hidden="true"><CircleDot size={56} /></span>
              <div className="tr-kv-head">
                <span className="tr-k">Serial number</span>
                <b className="tr-serial-big">{serial || 'Not recorded'}</b>
                <span className={`cc-pill ${status.tone}`}>{status.label}</span>
              </div>
              <dl className="tr-kv">
                <KV k="Brand" v={record.brand} />
                <KV k="Size" v={record.size} />
                <KV k="Description" v={record.description} />
                <KV k="Category" v={record.category} />
                <KV k="Purchase date" v={record.issue_date ? fmtDate(record.issue_date) : null} />
                <KV k="Purchase price" v={record.cost_per_tyre != null ? (recCurrency ? formatCurrencyCompact(record.cost_per_tyre, recCurrency) : fmtInt(record.cost_per_tyre)) : null} />
                <KV k="Cost per km" v={cpk != null ? cpk.toFixed(3) : null} />
                <KV k="MIS number" v={record.mis_number} />
                <KV k="Job card" v={record.job_card} />
                <KV k="Quantity" v={record.qty} />
              </dl>
            </div>
            <button type="button" className="cc-link cc-link-btn tr-full" onClick={onFull}>Full record and custom fields</button>
          </Card>

          <Card title="Photos" className="tr-a-photos">
            {photos.length ? (
              <div className="tr-photos">
                {photos.slice(0, 6).map((u, i) => { const src = safeImageSrc(u); return src ? <img key={i} src={src} alt={`Tyre photo ${i + 1}`} loading="lazy" /> : null })}
              </div>
            ) : <div className="cc-empty">No photos recorded for this tyre.</div>}
          </Card>

          <Card title="Life cycle and usage" className="tr-a-life" sub={usage.basis === 'running' ? 'Against the vehicle meter and this size\'s expected life' : usage.basis === 'finished' ? 'Recorded life of a finished tyre' : undefined}>
            <CardState state={run}>
              <div className="tr-usage">
                <div><span className="tr-k">{active ? 'Current km' : 'Km at removal'}</span><b>{fmtKm(usage.currentKm)}</b></div>
                <div><span className="tr-k">{active ? 'Km run' : 'Total life'}</span><b>{fmtKm(usage.runKm)}</b></div>
                <div><span className="tr-k">Expected life</span><b>{fmtKm(usage.totalLifeKm)}</b></div>
                <div><span className="tr-k">Used</span><b>{fmtPct(usage.usedPct)}</b></div>
                <div><span className="tr-k">Remaining</span><b>{fmtKm(usage.remainingKm)}</b></div>
              </div>
              {usage.usedPct != null && <div className="tr-bar" role="img" aria-label={`${Math.round(usage.usedPct)} percent of expected life used`}><span style={{ width: `${usage.usedPct}%` }} /></div>}
              {active && !run.data && <p className="tr-note">No running-life figures for this tyre (no current meter or no fitment reading).</p>}
              <p className="tr-k tr-trend-title">Km trend since fitment</p>
              <CardState state={odo} empty={trend.length < 2 ? 'Not enough odometer readings since fitment to draw a trend.' : null} lines={2}>
                <KmTrendChart points={trend} />
              </CardState>
            </CardState>
          </Card>

          <Card title="Condition assessment" className="tr-a-cond">
            <CardState state={inspState} lines={3}>
              <dl className="tr-kv tr-kv-1">
                <KV k="Last inspection" v={lastInsp ? fmtDate(lastInsp.date) : (vehicleInspection && active ? `${fmtDate(vehicleInspection)} (vehicle)` : null)} />
                <KV k="Tread depth" v={lastInsp?.tread != null ? `${lastInsp.tread} mm` : (record.tread_depth != null ? `${record.tread_depth} mm` : null)} />
                <KV k="Condition" v={lastInsp?.condition || record.risk_level} />
                <KV k="Pressure" v={pressure.value != null ? `${pressure.value} psi${pressure.source ? ` (${pressure.source.toLowerCase()})` : ''}` : null} />
                <KV k="Inspector" v={lastInsp?.inspector} />
                <KV k="Findings" v={lastInsp?.findings || record.findings} />
              </dl>
              {inspections.data?.truncated && <p className="tr-note">Inspection read was capped; older inspections may be missing.</p>}
            </CardState>
          </Card>

          <Card title="Location and assignment" className="tr-a-loc">
            <div className="tr-assign">
              {record.asset_no ? (
                <div className="cc-vehicle">
                  <VehicleThumb row={fleetRow || { asset_no: record.asset_no, vehicle_type: record.vehicle_type }} size="md" />
                  <div>
                    <span className="tr-k">{active ? 'Current vehicle / asset' : 'Last vehicle / asset'}</span>
                    <b className="tr-block">{record.asset_no}{fleetRow?.make ? ` (${fleetRow.make})` : ''}</b>
                    <span className="tr-sub">{fleetRow?.vehicle_type || record.vehicle_type || ''}</span>
                  </div>
                </div>
              ) : <div className="cc-empty">No vehicle recorded on this tyre.</div>}
              <dl className="tr-kv tr-kv-1">
                <KV k="Position" v={positionOf(record)} />
                <KV k="Site" v={record.site} />
                <KV k="Country" v={record.country} />
                <KV k="Installed date" v={record.fitment_date ? fmtDate(record.fitment_date) : null} />
                <KV k="Km at fitment" v={record.km_at_fitment != null ? fmtKm(Number(record.km_at_fitment)) : null} />
                {!active && <KV k="Removed" v={record.removal_date ? fmtDate(record.removal_date) : null} />}
                {!active && <KV k="Removal reason" v={record.removal_reason || record.reason_for_removal} />}
                <KV k="Source" v={record.data_source} />
                <KV k="Status" v={status.label} />
              </dl>
              {record.asset_no && <Link className="cc-link" to={`/asset-management/${encodeURIComponent(record.asset_no)}`}><Truck size={13} aria-hidden="true" /> Open vehicle</Link>}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function KV({ k, v }) {
  const empty = v == null || String(v).trim() === ''
  return (
    <div className="tr-kv-row">
      <dt>{k}</dt>
      <dd>{empty ? NA : v}</dd>
    </div>
  )
}

/** Small line chart of km run per month since fitment. Pure SVG, no fabricated points. */
function KmTrendChart({ points }) {
  const W = 360; const H = 120; const P = 22
  const max = Math.max(...points.map((p) => p.km), 1)
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1)
  const y = (v) => H - P - (v / max) * (H - 2 * P)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.km).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <div className="cc-chart tr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Km run since fitment, ${points.length} months, latest ${fmtInt(Math.round(last.km))} km`}>
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="var(--cc-inner-border)" />
        <path d={path} fill="none" stroke="var(--cc-green)" strokeWidth="2" />
        {points.map((p, i) => <circle key={p.month} cx={x(i)} cy={y(p.km)} r="2.6" fill="var(--cc-green)" />)}
        {points.map((p, i) => (i === 0 || i === points.length - 1 || points.length <= 8) && (
          <text key={`l${p.month}`} x={x(i)} y={H - 6} textAnchor="middle" className="cc-axis">{p.month.slice(5)}/{p.month.slice(2, 4)}</text>
        ))}
        <text x={x(points.length - 1)} y={y(last.km) - 7} textAnchor="end" className="cc-axis">{fmtInt(Math.round(last.km))} km</text>
      </svg>
    </div>
  )
}

function HistoryTab({ tab, passport, records, inspections, currency }) {
  if (tab === 'install') {
    const rows = installationRows(passport)
    return <HistTable rows={rows} empty="No fitments recorded." columns={[
      { key: 'date', header: 'Fitted', cell: (r) => fmtDate(r.date) },
      { key: 'asset_no', header: 'Vehicle / asset' },
      { key: 'position', header: 'Position' },
      { key: 'site', header: 'Site' },
      { key: 'km', header: 'Km at fitment', cell: (r) => (r.km == null ? NA : fmtInt(r.km)) },
      { key: 'status', header: 'Status', cell: (r) => { const s = statusMeta(r.status); return <span className={`cc-pill ${s.tone}`}>{s.label}</span> } },
    ]} />
  }
  if (tab === 'movement') {
    const rows = movementRows(passport.events)
    return <HistTable rows={rows} empty="No movements recorded." columns={[
      { key: 'date', header: 'Date', cell: (r) => fmtDate(r.date) },
      { key: 'action', header: 'Action', cell: (r) => <span className={`cc-pill ${r.action === 'Removed' ? 'muted' : r.action === 'Moved' ? 'info' : 'good'}`}>{r.action}{r.current ? ' (current)' : ''}</span> },
      { key: 'asset_no', header: 'Vehicle / asset' },
      { key: 'position', header: 'Position' },
      { key: 'odometer', header: 'Odometer', cell: (r) => (r.odometer == null ? NA : fmtInt(r.odometer)) },
      { key: 'reason', header: 'Reason' },
    ]} />
  }
  if (tab === 'inspection') {
    const svc = serviceRows(passport, ['inspection'])
    return (
      <CardState state={inspections}>
        <HistTable rows={inspections.data?.rows || []} empty={svc.length ? 'No inspection records name this tyre; see service inspections below.' : 'No inspection has recorded this tyre.'} columns={[
          { key: 'date', header: 'Date', cell: (r) => fmtDate(r.date) },
          { key: 'asset_no', header: 'Vehicle / asset' },
          { key: 'position', header: 'Position' },
          { key: 'tread', header: 'Tread (mm)', cell: (r) => (r.tread == null ? NA : r.tread) },
          { key: 'pressure', header: 'Pressure (psi)', cell: (r) => (r.pressure == null ? NA : r.pressure) },
          { key: 'condition', header: 'Condition' },
          { key: 'inspector', header: 'Inspector' },
        ]} />
        {svc.length > 0 && <ServiceTable rows={svc} currency={currency} />}
      </CardState>
    )
  }
  if (tab === 'repair') {
    const rows = serviceRows(passport, ['repair', 'puncture', 'inflation'])
    return rows.length ? <ServiceTable rows={rows} currency={currency} /> : <div className="cc-empty">No repair has been recorded against this tyre.</div>
  }
  if (tab === 'retread') {
    const svc = serviceRows(passport, ['retread'])
    const claims = passport.retreadClaims || []
    if (!svc.length && !claims.length) return <div className="cc-empty">This tyre has no retread record.</div>
    return (
      <>
        {svc.length > 0 && <ServiceTable rows={svc} currency={currency} />}
        {claims.length > 0 && <HistTable rows={claims} empty="" columns={[
          { key: 'claim_date', header: 'Date', cell: (r) => fmtDate(r.claim_date) },
          { key: 'claim_no', header: 'Claim' },
          { key: 'vendor', header: 'Vendor' },
          { key: 'reason', header: 'Reason' },
          { key: 'status', header: 'Status' },
        ]} />}
      </>
    )
  }
  if (tab === 'disposal') {
    const { rows, marks } = disposalRows(passport)
    if (!rows.length && !marks.length) return <div className="cc-empty">This tyre has not been removed or scrapped.</div>
    return (
      <>
        {marks.length > 0 && <p className="tr-note">Status marks on this serial: {marks.join(', ')}.</p>}
        <HistTable rows={rows} empty="No removal recorded." columns={[
          { key: 'date', header: 'Date', cell: (r) => fmtDate(r.date) },
          { key: 'asset_no', header: 'Vehicle / asset' },
          { key: 'position', header: 'Position' },
          { key: 'status', header: 'Status', cell: (r) => { const s = statusMeta(r.status); return <span className={`cc-pill ${s.tone}`}>{s.label}</span> } },
          { key: 'km', header: 'Odometer', cell: (r) => (r.km == null ? NA : fmtInt(r.km)) },
          { key: 'reason', header: 'Reason' },
        ]} />
      </>
    )
  }
  if (tab === 'linked') {
    const rows = linkedAssets(passport)
    return <HistTable rows={rows} empty="This tyre has not been linked to a vehicle." columns={[
      { key: 'asset_no', header: 'Vehicle / asset', cell: (r) => <Link className="cc-link" to={`/asset-management/${encodeURIComponent(r.asset_no)}`}>{r.asset_no}</Link> },
      { key: 'fitments', header: 'Fitments' },
      { key: 'first', header: 'First fitted', cell: (r) => fmtDate(r.first) },
      { key: 'last', header: 'Last fitted', cell: (r) => fmtDate(r.last) },
      { key: 'sites', header: 'Sites' },
    ]} />
  }
  if (tab === 'cost') {
    const rows = costRows(passport, records)
    return (
      <>
        <p className="tr-note">Prices as recorded on each tyre record and event. Fleet tyre spend is reported from the expense grid, so these lines are not totalled here.</p>
        <HistTable rows={rows} empty="No price or cost has been recorded for this tyre." columns={[
          { key: 'date', header: 'Date', cell: (r) => fmtDate(r.date) },
          { key: 'kind', header: 'Type' },
          { key: 'amount', header: 'Amount', cell: (r) => { const cur = currencyOf(r.country) || currency; return cur ? formatCurrencyCompact(r.amount, cur) : fmtInt(r.amount) } },
          { key: 'note', header: 'Vehicle / vendor' },
        ]} />
      </>
    )
  }
  return null
}

function ServiceTable({ rows, currency }) {
  return <HistTable rows={rows} empty="" columns={[
    { key: 'date', header: 'Date', cell: (r) => fmtDate(r.date) },
    { key: 'type', header: 'Event' },
    { key: 'asset_no', header: 'Vehicle / asset' },
    { key: 'tread', header: 'Tread (mm)', cell: (r) => (r.tread == null ? NA : r.tread) },
    { key: 'cost', header: 'Cost', cell: (r) => (r.cost == null ? NA : (currency ? formatCurrencyCompact(r.cost, currency) : fmtInt(r.cost))) },
    { key: 'technician', header: 'Technician' },
    { key: 'notes', header: 'Notes' },
  ]} />
}

function HistTable({ rows, columns, empty }) {
  if (!rows.length) return empty ? <div className="cc-empty">{empty}</div> : null
  return <KitTable compact rows={rows} columns={columns} getRowId={(r, i) => String(r.id ?? i)} empty={empty} />
}
