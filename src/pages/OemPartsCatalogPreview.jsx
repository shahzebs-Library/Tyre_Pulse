import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowLeft, BookOpen, CheckCircle2, FileSearch,
  Loader2, PackagePlus, Search, Upload, X,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { listAssets } from '../lib/api/assets'
import { deleteOemManual, lookupStockByPartNumbers, findOemManualByHash, getOemPdfSignedUrl, listOemManualEntries, listOemManuals, saveOemManual, searchOemEntries } from '../lib/api/oemPartsCatalog'
import { createPartsRequest, listOpenJobs } from '../lib/api/partsRequests'
import { extractOemIdentity, extractOemPartsDocument } from '../lib/oemPartsExtractor'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'
import OemReviewWorkspace from '../components/oemCatalog/OemReviewWorkspace'
import OemFigureTools from '../components/oemCatalog/OemFigureTools'
import OemReprocessPanel from '../components/oemCatalog/OemReprocessPanel'
import { listFigures, requireCatalogAdmin, saveFigures, saveReviewItems, NOT_PROVISIONED, REVIEW_PARTIAL } from '../lib/api/oemCatalogAdmin'
import { STANDARD_CATEGORIES } from '../lib/oemCatalog/taxonomy'
import { compatibility } from '../lib/oemCatalog/search'
import { rankResults } from '../lib/oemCatalog/search'
import { processExtraction, reviewQueueForStorage } from '../lib/oemCatalog/pipeline'
import OemCatalogViewer from '../components/oemCatalog/OemCatalogViewer'
import { entryGroupKey } from '../lib/oemCatalog/figureLinks'
import { importSaveCounts, importSavedNotice } from '../lib/oemCatalog/importSave'
import { normalizeIndex } from '../components/oemCatalog/OemFigure'
import { ExtractionPreviewTable, ImportReviewPanel, SearchResultsTable, SelectedPartsTable } from '../components/oemCatalog/OemTables'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const STANDARD_LABELS = Object.fromEntries(STANDARD_CATEGORIES.map(([c]) => [c, true]))
const INPUT = 'input min-h-[44px] w-full'
const BUTTON = 'btn-secondary inline-flex min-h-[42px] items-center justify-center gap-2 px-3 text-sm'
const assetText = (asset) => [asset.asset_no, asset.fleet_number, asset.make, asset.model, asset.vehicle_type, asset.registration_no, asset.chassis_no, asset.serial_no, asset.engine_no, asset.site, asset.country].filter(Boolean).join(' ').toLowerCase()

function Field({ label, value, onChange, placeholder, required = false }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}{required ? ' *' : ''}</span><input required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={INPUT} /></label>
}

const groupKeyOf = entryGroupKey

function searchableAssetResult(asset) {
  return `${asset.asset_no || asset.fleet_number || 'Asset'} · ${[asset.make, asset.model].filter(Boolean).join(' ')} · Chassis ${asset.chassis_no || asset.serial_no || 'not recorded'}`
}

function normalizeKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function normalizeManualForAsset(manual, asset) {
  if (!asset) return true
  const serial = normalizeKey(asset.chassis_no || asset.serial_no || '')
  const equipment = normalizeKey(manual.equipment_no)
  if (serial && equipment && serial === equipment) return true
  const makeMatches = !manual.manufacturer || !asset.make || normalizeKey(manual.manufacturer) === normalizeKey(asset.make)
  const manualModels = [manual.model, manual.model_code].map(normalizeKey).filter(Boolean)
  const assetModel = normalizeKey(asset.model)
  const modelMatches = !assetModel || manualModels.some((model) => model === assetModel || model.includes(assetModel) || assetModel.includes(model))
  if (!makeMatches || !modelMatches) return false
  if (manual.chassis_from && serial && serial < manual.chassis_from.toUpperCase()) return false
  if (manual.chassis_to && serial && serial > manual.chassis_to.toUpperCase()) return false
  return true
}

async function sha256(file) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default function OemPartsCatalogPreview() {
  const { activeCountry } = useSettings()
  const { t } = useLanguage()
  const { profile, isSuperAdmin } = useAuth()
  // Convenience only: the database (RLS) and the service layer enforce the same rule.
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const canManage = profile?.role === 'Admin' || isSuperAdmin === true
  const [tab, setTab] = useState('browse')
  const [reviewManualId, setReviewManualId] = useState('')
  const [searchFilters, setSearchFilters] = useState({ manufacturer: '', compatibility: '', category: '' })
  const [manuals, setManuals] = useState([])
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [manualFilter, setManualFilter] = useState('all')
  const [assetQuery, setAssetQuery] = useState('')
  const [assetRows, setAssetRows] = useState([])
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [pdfError, setPdfError] = useState('')
  const [extractProgress, setExtractProgress] = useState(null)
  const [extraction, setExtraction] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')
  const basketKey = `oem-basket:${profile?.id || 'anon'}`
  const [selectedParts, setSelectedParts] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(`oem-basket:${profile?.id || 'anon'}`) || '[]') } catch { return [] }
  })
  const [basketStock, setBasketStock] = useState({})
  const [confirmClear, setConfirmClear] = useState(false)
  const [requestModalOpen, setRequestModalOpen] = useState(false)
  const [requestJobs, setRequestJobs] = useState([])
  const [requestJobsLoading, setRequestJobsLoading] = useState(false)
  const [requestSaving, setRequestSaving] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [requestForm, setRequestForm] = useState({ jobId: '', priority: 'medium', neededBy: '', notes: '' })
  const [browseManual, setBrowseManual] = useState(null)
  const [browseRows, setBrowseRows] = useState([])
  // Saved figures (oem_figures) for the open manual; empty means use the import snapshot.
  const [browseFigures, setBrowseFigures] = useState([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browsePdfDoc, setBrowsePdfDoc] = useState(null)
  const [browsePdfManualId, setBrowsePdfManualId] = useState(null)
  const [browseError, setBrowseError] = useState('')
  const [assemblyFilter, setAssemblyFilter] = useState('all')
  const [selectedIllustrationPage, setSelectedIllustrationPage] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState('')
  const [browseFilter, setBrowseFilter] = useState('')
  const [manualForm, setManualForm] = useState({ manufacturer: '', model: '', generation: '', modelYearFrom: '', modelYearTo: '', modelCode: '', equipmentNo: '', chassisFrom: '', chassisTo: '' })
  const fileRef = useRef(null)

  const refreshManuals = useCallback(async () => {
    setCatalogLoading(true)
    setPageError('')
    try { setManuals(await listOemManuals(activeCountry)) }
    catch (error) { setPageError(toUserMessage(error, 'Could not load the OEM master catalog.')) }
    finally { setCatalogLoading(false) }
  }, [activeCountry])
  useEffect(() => { refreshManuals() }, [refreshManuals])
  useEffect(() => {
    if (!requestModalOpen) return undefined
    let active = true
    setRequestJobsLoading(true)
    listOpenJobs({ country: activeCountry && activeCountry !== 'All' ? activeCountry : undefined })
      .then((jobs) => { if (active) setRequestJobs(jobs || []) })
      .catch((error) => { if (active) setRequestError(toUserMessage(error, 'Could not load open work orders.')) })
      .finally(() => { if (active) setRequestJobsLoading(false) })
    return () => { active = false }
  }, [requestModalOpen, activeCountry])
  useEffect(() => () => { if (pdfDoc) pdfDoc.destroy() }, [pdfDoc])
  useEffect(() => () => { if (browsePdfDoc) browsePdfDoc.destroy() }, [browsePdfDoc])

  const searchParts = useCallback(async () => {
    const term = query.trim()
    if (term.length < 2) { setEntries([]); setPageError(''); return }
    setLoading(true); setPageError('')
    try {
      const results = await searchOemEntries(term, { manualId: manualFilter === 'all' ? undefined : manualFilter, country: activeCountry, limit: 120 })
      setEntries(results)
    } catch (error) { setEntries([]); setPageError(toUserMessage(error, 'Part search failed.')) }
    finally { setLoading(false) }
  }, [query, manualFilter, activeCountry])
  useEffect(() => {
    const timer = setTimeout(searchParts, 250)
    return () => clearTimeout(timer)
  }, [searchParts])

  const matchingAssets = useMemo(() => {
    const needle = assetQuery.trim().toLowerCase()
    if (!needle) return []
    return assetRows.filter((asset) => assetText(asset).includes(needle)).slice(0, 8)
  }, [assetRows, assetQuery])
  const manualsForAsset = useMemo(() => selectedAsset ? manuals.filter((manual) => normalizeManualForAsset(manual, selectedAsset)) : manuals, [manuals, selectedAsset])
  const chassisManualMatches = useMemo(() => {
    const needle = normalizeKey(selectedAsset?.chassis_no || selectedAsset?.serial_no || assetQuery)
    if (!needle) return manuals
    return manuals.filter((manual) => [manual.equipment_no, manual.chassis_from, manual.chassis_to, manual.model, manual.model_code].some((value) => normalizeKey(value).includes(needle) || needle.includes(normalizeKey(value))))
  }, [manuals, assetQuery, selectedAsset])
  const browseManualOptions = useMemo(() => {
    if (selectedAsset) {
      const fit = manualsForAsset
      return fit.length ? fit : chassisManualMatches
    }
    return assetQuery.trim() ? chassisManualMatches : manuals
  }, [selectedAsset, manualsForAsset, chassisManualMatches, assetQuery, manuals])
  // ROOT CAUSE of "index 17 beside callouts 1 and 2": rows were grouped by illustration PAGE only, so
  // every parts table that shares a figure page was merged into one list. A group is now one parts
  // table (its assembly heading on that drawing page); continuation pages with the same heading merge.
  const illustrationGroups = useMemo(() => {
    const groups = new Map()
    for (const row of browseRows) {
      const page = row.illustration_pdf_page || null
      const key = groupKeyOf(row)
      if (!groups.has(key)) groups.set(key, { key, page, figureId: row.figure_id || null, rows: [], headings: new Set(), sourcePages: new Set(), printedPages: new Set() })
      const group = groups.get(key)
      group.rows.push(row)
      if (row.assembly_heading) group.headings.add(row.assembly_heading)
      if (row.source_pdf_page) group.sourcePages.add(row.source_pdf_page)
      if (row.printed_page) group.printedPages.add(row.printed_page)
    }
    return [...groups.values()].map((group) => ({
      ...group,
      headings: [...group.headings],
      sourcePages: [...group.sourcePages].sort((a, b) => a - b),
      printedPages: [...group.printedPages],
      label: [...group.headings][0] || (group.page ? `Illustration page ${group.page}` : 'Parts without a linked illustration'),
    })).sort((a, b) => (a.page || Number.MAX_SAFE_INTEGER) - (b.page || Number.MAX_SAFE_INTEGER) || (a.sourcePages[0] || 0) - (b.sourcePages[0] || 0))
  }, [browseRows])
  const assemblyCategories = useMemo(() => [...new Set(illustrationGroups.flatMap((group) => group.headings))].sort((a, b) => a.localeCompare(b)), [illustrationGroups])
  const filteredIllustrations = useMemo(() => illustrationGroups.filter((group) => {
    const categoryMatch = assemblyFilter === 'all' || group.headings.includes(assemblyFilter)
    const needle = browseFilter.trim().toLowerCase()
    const textMatch = !needle || [group.label, group.page, ...group.headings, ...group.printedPages].join(' ').toLowerCase().includes(needle)
    return categoryMatch && textMatch
  }), [illustrationGroups, assemblyFilter, browseFilter])
  const activeIllustration = useMemo(() => illustrationGroups.find((group) => group.key === selectedIllustrationPage) || null, [illustrationGroups, selectedIllustrationPage])
  const selectedIndexRows = useMemo(() => activeIllustration?.rows.filter((row) => normalizeIndex(row.index_no || row.parent_index) === normalizeIndex(selectedIndex)) || [], [activeIllustration, selectedIndex])

  const figuresByManual = useMemo(() => Object.fromEntries(manuals.map((m) => [m.id, m.import_summary?.figures || {}])), [manuals])
  const ranked = useMemo(() => rankResults(entries, query, { asset: selectedAsset, manuals, figuresByManual, filters: searchFilters }), [entries, query, selectedAsset, manuals, figuresByManual, searchFilters])
  // The basket survives figure, filter, tab and manual changes, and a reload of the tab.
  useEffect(() => {
    try {
      const slim = selectedParts.map((i) => ({ ...i, manual: { id: i.manual.id, manufacturer: i.manual.manufacturer, model: i.manual.model, generation: i.manual.generation, model_code: i.manual.model_code, model_year_from: i.manual.model_year_from, model_year_to: i.manual.model_year_to, chassis_from: i.manual.chassis_from, chassis_to: i.manual.chassis_to, equipment_no: i.manual.equipment_no, source_file_name: i.manual.source_file_name } }))
      sessionStorage.setItem(basketKey, JSON.stringify(slim))
    } catch { /* storage unavailable: the basket still works for this view */ }
  }, [selectedParts, basketKey])
  useEffect(() => {
    let live = true
    lookupStockByPartNumbers(selectedParts.map((i) => i.row.part_no)).then((s) => { if (live) setBasketStock(s) })
    return () => { live = false }
  }, [selectedParts])
  const selectedKeys = useMemo(() => new Set(selectedParts.map((item) => item.key)), [selectedParts])
  const pipeline = useMemo(() => (extraction ? processExtraction(extraction, { model: manualForm.model }) : null), [extraction, manualForm.model])
  const fitmentState = useMemo(() => {
    if (!selectedAsset || !browseManual) return 'unconfirmed'
    const serial = normalizeKey(selectedAsset.chassis_no || selectedAsset.serial_no)
    if (serial && serial === normalizeKey(browseManual.equipment_no)) return 'exact'
    return normalizeManualForAsset(browseManual, selectedAsset) ? 'model' : 'unconfirmed'
  }, [selectedAsset, browseManual])

  const openSourcePdf = async () => {
    if (!browseManual?.id) return
    try {
      const url = await getOemPdfSignedUrl(browseManual.id)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) { setBrowseError(toUserMessage(error, 'Could not open the stored OEM manual.')) }
  }

  const searchAssets = async () => {
    setAssetsLoading(true); setPageError('')
    try {
      const country = activeCountry && activeCountry !== 'All' ? activeCountry : undefined
      setAssetRows(await listAssets({ country }))
    } catch (error) { setPageError(toUserMessage(error, 'Fleet search failed.')) }
    finally { setAssetsLoading(false) }
  }

  const resetImport = () => {
    setPdfFile(null); setPdfDoc(null); setExtraction(null); setExtractProgress(null); setPdfError(''); setSaveError(''); setSaveNotice('')
    setManualForm({ manufacturer: '', model: '', generation: '', modelYearFrom: '', modelYearTo: '', modelCode: '', equipmentNo: '', chassisFrom: '', chassisTo: '' })
    if (fileRef.current) fileRef.current.value = ''
  }

  const selectPdf = async (file) => {
    if (!file) return
    resetImport()
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setPdfError(t('oemcatalog.import.errNotPdf')); return }
    if (file.size > 100 * 1024 * 1024) { setPdfError(t('oemcatalog.import.errTooBig')); return }
    setPdfFile(file); setPdfError(''); setExtractProgress({ pageNumber: 0, pageCount: 0, rowCount: 0 })
    try {
      const buffer = await file.arrayBuffer()
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
      setPdfDoc(doc)
      const identity = await extractOemIdentity(doc, file.name)
      const extracted = await extractOemPartsDocument(doc, setExtractProgress, { ops: pdfjsLib.OPS })
      setExtraction(extracted)
      setManualForm((form) => ({
        ...form,
        manufacturer: form.manufacturer || identity.manufacturer,
        model: form.model || identity.model,
        modelCode: form.modelCode || identity.modelCode,
        equipmentNo: form.equipmentNo || identity.equipmentNo || file.name.replace(/\.pdf$/i, ''),
      }))
    } catch (error) { setPdfError(toUserMessage(error, 'The PDF could not be read. It may be scanned or protected.')) }
  }

  const applyAssetFitment = (asset) => {
    setSelectedAsset(asset)
    setAssetQuery(searchableAssetResult(asset))
    setManualForm((form) => ({
      ...form,
      manufacturer: asset.make || form.manufacturer,
      model: asset.model || form.model,
    }))
  }

  const selectBrowseManual = async (manual) => {
    setBrowseManual(manual)
    setBrowseRows([]); setBrowsePdfDoc(null); setBrowsePdfManualId(null); setBrowseError('')
    setAssemblyFilter('all'); setBrowseFilter(''); setSelectedIllustrationPage(null); setSelectedIndex('')
    setBrowseLoading(true)
    try {
      setBrowseFigures([])
      const [rows, figureRows] = await Promise.all([
        listOemManualEntries(manual.id),
        // Figures are an enhancement: a failure falls back to the import snapshot, never blocks browsing.
        listFigures(manual.id).catch(() => []),
      ])
      setBrowseRows(rows)
      setBrowseFigures(figureRows)
      if (!rows.length) setBrowseError('This manual has no saved part rows yet. Re-import the source PDF or ask an administrator to check its import status.')
    } catch (error) { setBrowseError(toUserMessage(error, 'Could not load this manual’s illustration groups.')) }
    finally { setBrowseLoading(false) }
  }

  const openIllustration = async (group, manualOverride = null) => {
    const sourceManual = manualOverride || browseManual
    setSelectedIllustrationPage(group.key || groupKeyOf(group.rows[0]))
    setSelectedIndex(normalizeIndex(group.rows[0]?.index_no || group.rows[0]?.parent_index))
    setBrowseError('')
    if (!group.page || !sourceManual) return
    if (browsePdfDoc && browsePdfManualId === sourceManual.id) return
    setBrowsePdfDoc(null)
    try {
      const url = await getOemPdfSignedUrl(sourceManual.id)
      const doc = await pdfjsLib.getDocument({ url }).promise
      setBrowsePdfDoc(doc)
      setBrowsePdfManualId(sourceManual.id)
    } catch (error) { setBrowseError(toUserMessage(error, 'Could not open the saved source PDF.')) }
  }

  const saveCatalog = async (event) => {
    event.preventDefault()
    const counts = importSaveCounts(pipeline)
    if (!pdfFile || !counts.canSave) { setSaveError(t('oemcatalog.import.errNoRows')); return }
    if (!manualForm.manufacturer.trim() || !manualForm.model.trim()) { setSaveError(t('oemcatalog.import.errBrand')); return }
    setSaving(true); setSaveError(''); setSaveNotice('')
    try {
      await requireCatalogAdmin()
      const hash = await sha256(pdfFile)
      const existing = await findOemManualByHash(hash)
      // A manual saved without its PDF (storage refused it) may be imported again to add the PDF.
      const alreadyReady = existing && ['ready', 'needs_review'].includes(existing.extraction_status)
        && !existing.import_summary?.pdf_not_stored
      if (alreadyReady) {
        await refreshManuals()
        setPageError(`This exact PDF is already saved as ${existing.manufacturer} ${existing.model} (${existing.item_count.toLocaleString()} rows). Search it instead of uploading again.`)
        setTab('browse')
        return
      }
      // A retry of an existing manual keeps its own country, so the manual and its
      // already-saved parts stay in one scope whatever country is selected now.
      const country = existing ? (existing.country ?? null) : (activeCountry && activeCountry !== 'All' ? activeCountry : null)
      const saved = await saveOemManual({
        id: existing?.id || crypto.randomUUID(), resume: Boolean(existing), file: pdfFile, sha256: hash, country,
        manufacturer: manualForm.manufacturer, model: manualForm.model, modelCode: manualForm.modelCode,
        equipmentNo: manualForm.equipmentNo, chassisFrom: manualForm.chassisFrom, chassisTo: manualForm.chassisTo,
        pageCount: extraction.pageCount, rows: pipeline.publish,
        summary: {
          parsedPages: extraction.parsedPages,
          skippedPages: extraction.skippedPages,
          reviewPages: extraction.reviewPages,
          imageOnlyPages: extraction.imageOnlyPages,
          figures: pipeline.figures,
          pipeline: pipeline.summary,
          reviewQueue: reviewQueueForStorage(pipeline.review),
          reviewQueueTotal: pipeline.review.length,
          fitment: {
            generation: manualForm.generation.trim() || null,
            model_year_from: manualForm.modelYearFrom ? Number(manualForm.modelYearFrom) : null,
            model_year_to: manualForm.modelYearTo ? Number(manualForm.modelYearTo) : null,
          },
        },
      })
      let extra = ''
      try {
        await saveFigures(saved.id, pipeline.figures)
        const queued = await saveReviewItems(saved.id, pipeline.review)
        extra = queued ? ` ${t('oemcatalog.import.queueSaved', { count: queued })}` : ''
      } catch (error) {
        // A partial queue save carries its own plain counts (no database text), so show it as is.
        extra = error?.code === NOT_PROVISIONED ? ` ${t('oemcatalog.import.notProvisioned', { count: pipeline.review.length })}`
          : error?.code === REVIEW_PARTIAL ? ` ${error.message}` : ` ${toUserMessage(error, '')}`
      }
      await refreshManuals()
      const pdfNote = saved?.pdfStored === false
        ? ` The parts are saved and searchable, but the PDF (${saved.pdfSizeMb} MB) was refused by storage, so page pictures cannot be opened yet. An admin can raise the upload limit and import the same PDF again.`
        : ''
      setSaveNotice(`${importSavedNotice(saved, counts)}${extra}${pdfNote}`)
      setTab('browse')
    } catch (error) { setSaveError(toUserMessage(error, t('oemcatalog.import.errSave'))) }
    finally { setSaving(false) }
  }

  const browseFromPart = async (entry) => {
    const manual = manuals.find((item) => item.id === entry.manual_id) || entry.manual
    if (!manual?.id) {
      setPageError('The source OEM manual could not be found for this part.')
      return
    }
    setTab('browse'); setPageError('')
    try {
      if (browseManual?.id !== manual.id) await selectBrowseManual(manual)
      const group = { page: entry.illustration_pdf_page || null, rows: [entry] }
      await openIllustration(group, manual)
      setSelectedIndex(normalizeIndex(entry.index_no || entry.parent_index))
    } catch (error) { setBrowseError(toUserMessage(error, 'Could not open the interactive OEM illustration.')) }
  }

  const switchTab = (value) => { setTab(value); setPageError(''); setSaveError('') }

  const addPartToSelection = (row, manual = row?.manual || browseManual, illustration = activeIllustration) => {
    if (!row || !manual?.id) return
    const key = `${manual.id}:${row.id}`
    setSelectedParts((current) => {
      if (current.some((item) => item.key === key)) return current
      const sourceQty = Number(row.quantity)
      return [...current, {
        key,
        row,
        manual,
        figureLabel: illustration?.label || row.assembly_heading || 'Figure not linked',
        figurePage: row.illustration_pdf_page || illustration?.page || null,
        sourcePages: [row.source_pdf_page, row.printed_page, row.see_page].filter(Boolean),
        assetNo: selectedAsset?.asset_no || selectedAsset?.fleet_number || null,
        site: selectedAsset?.site || null,
        requestedQty: Number.isFinite(sourceQty) && sourceQty > 0 ? sourceQty : 1,
        fitment: compatibility(manual, selectedAsset),
      }]
    })
  }

  const updateRequestedQty = (key, value) => {
    const qty = Math.max(1, Number(value) || 1)
    setSelectedParts((current) => current.map((item) => item.key === key ? { ...item, requestedQty: qty } : item))
  }

  const submitSelectedParts = async (event) => {
    event.preventDefault()
    if (!selectedParts.length) return
    setRequestSaving(true)
    setRequestError('')
    let saved = 0
    try {
      const job = requestJobs.find((item) => item.id === requestForm.jobId)
      const jobAsset = String(job?.asset_no || '').trim().toLowerCase()
      const mismatched = selectedParts.some((item) => item.assetNo && jobAsset && item.assetNo.trim().toLowerCase() !== jobAsset)
      if (mismatched) {
        setRequestError('The selected work order belongs to a different asset. Choose the matching job or leave the job blank.')
        return
      }
      for (const item of selectedParts) {
        const row = item.row
        const manual = item.manual
        const notes = [
          requestForm.notes.trim(),
          `OEM part number: ${row.part_no || 'not recorded'}`,
          `OEM description: ${row.description || 'not recorded'}`,
          `Catalog: ${manual.manufacturer || ''} ${manual.model || ''}${manual.generation ? ` · ${manual.generation}` : ''}`.trim(),
          `Fitment recorded: ${[manual.model_code && `model code ${manual.model_code}`, (manual.model_year_from || manual.model_year_to) && `years ${manual.model_year_from || '—'}–${manual.model_year_to || '—'}`, manual.equipment_no && `equipment ${manual.equipment_no}`, (manual.chassis_from || manual.chassis_to) && `serial ${manual.chassis_from || '—'}–${manual.chassis_to || '—'}`].filter(Boolean).join(' · ') || 'not specified in catalog metadata'}`,
          `Assembly / figure: ${item.figureLabel}${item.figurePage ? ` · PDF page ${item.figurePage}` : ''}`,
          `Callout / index: ${row.index_no || row.parent_index || 'not recorded'}${row.parent_index ? ` · variant of ${row.parent_index}` : ''}`,
          `Source: ${manual.source_file_name || 'saved OEM manual'} · PDF list page ${row.source_pdf_page || 'not recorded'}${row.printed_page ? ` · printed page ${row.printed_page}` : ''}${row.see_page ? ` · see page ${row.see_page}` : ''}`,
        ].filter(Boolean).join('\n').slice(0, 4000)
        await createPartsRequest({
          job_id: job?.id || null,
          asset_no: item.assetNo || job?.asset_no || null,
          part_name: `${row.part_no || 'OEM part'} · ${row.description || 'Description not recorded'}`.slice(0, 200),
          qty: item.requestedQty,
          priority: requestForm.priority,
          needed_by: requestForm.neededBy || null,
          site: job?.site || item.site || null,
          notes,
          country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
        })
        saved += 1
        setSelectedParts((current) => current.filter((selected) => selected.key !== item.key))
      }
      setRequestModalOpen(false)
      setRequestForm({ jobId: '', priority: 'medium', neededBy: '', notes: '' })
      setSaveNotice(`${saved} OEM part ${saved === 1 ? 'request was' : 'requests were'} added to Parts Requests with catalog, figure, callout, and source details.`)
      setTab('selection')
    } catch (error) {
      setRequestError(`${saved} of ${selectedParts.length} requests were saved. The remaining parts are still selected. ${toUserMessage(error, 'Could not add the remaining OEM part requests.')}`)
    } finally {
      setRequestSaving(false)
    }
  }

  return <div className="oem-page space-y-5">
    <PageHeader title={t('oemcatalog.page.title')} subtitle={t('oemcatalog.page.subtitle')} icon={BookOpen} actions={<Link to="/parts-catalog" className={BUTTON}><ArrowLeft size={15}/>{t('oemcatalog.page.inventory')}</Link>} />

    <div className="flex flex-wrap gap-2 border-b border-[var(--input-border)] pb-3" role="tablist" aria-label={t('oempreview.sections')}>
      {[['browse',t('oemcatalog.tab.browse')],['partSearch',t('oemcatalog.tab.search')],['selection',t('oemcatalog.tab.selected', { count: selectedParts.length })],['manuals',t('oemcatalog.tab.manuals')],...(canManage ? [['review',t('oemcatalog.review.tab')],['import',t('oemcatalog.tab.import')]] : [])].map(([key,label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => switchTab(key)} className={`min-h-[40px] rounded-lg px-4 text-sm font-medium ${tab === key ? 'bg-[color-mix(in_srgb,var(--brand)_78%,#000)] text-white font-bold' : 'text-[var(--text-secondary)] hover:bg-[var(--panel-2)]'}`}>{label}</button>)}
    </div>

    {pageError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{pageError}</div>}
    {saveNotice && <div className="flex items-start gap-2 rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/10 p-3 text-sm text-[var(--oem-accent-text)]" role="status"><CheckCircle2 size={17} className="mt-0.5 shrink-0"/>{saveNotice}</div>}

    {tab === 'browse' && <div className="space-y-3">
      <Card className="space-y-3 !p-3">
        <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_auto_auto] lg:items-end">
          <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Find a fleet vehicle</span><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/><input value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} onFocus={() => { if (!assetRows.length) searchAssets() }} className={`${INPUT} pl-9`} placeholder="Chassis, VIN, equipment serial, fleet or asset number" aria-label="Find vehicle by chassis, VIN, serial, fleet or asset number"/></div></label>
          <button type="button" onClick={searchAssets} className={BUTTON} disabled={assetsLoading}><Search size={15}/>{assetsLoading ? 'Searching fleet…' : 'Search fleet'}</button>
          <button type="button" onClick={() => switchTab('manuals')} className={BUTTON}><BookOpen size={15}/>Browse by model / generation</button>
        </div>
        {selectedAsset ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/5 px-3 py-2"><div><div className="text-sm font-semibold text-[var(--text-primary)]">{searchableAssetResult(selectedAsset)}</div><div className="mt-0.5 text-[11px] text-[var(--text-muted)]">Asset selected. Catalog applicability is shown from the saved manual metadata.</div></div><button type="button" className="text-xs font-semibold text-[var(--oem-accent-text)]" onClick={() => { setSelectedAsset(null); setBrowseManual(null); setBrowseRows([]); setSelectedIllustrationPage(null); setBrowsePdfDoc(null); setBrowsePdfManualId(null) }}>Change vehicle</button></div> : matchingAssets.length > 0 ? <div className="overflow-hidden rounded-lg border border-[var(--input-border)]">{matchingAssets.map((asset) => <button type="button" key={asset.id} onClick={() => { applyAssetFitment(asset); setBrowseManual(null); setBrowseRows([]); setSelectedIllustrationPage(null); setBrowsePdfDoc(null); setBrowsePdfManualId(null) }} className="block min-h-10 w-full border-b border-[var(--input-border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--panel-2)]">{searchableAssetResult(asset)}</button>)}</div> : null}
        {browseManual && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--brand)]/25 bg-[var(--brand)]/5 px-3 py-2 text-xs"><span className="font-semibold text-[var(--text-primary)]">{browseManual.manufacturer} · {browseManual.model}{browseManual.generation ? ` · ${browseManual.generation}` : ''}</span><span className="text-[var(--text-muted)]">{browseManual.model_code ? `Model code ${browseManual.model_code} · ` : ''}{browseManual.equipment_no ? `Equipment ${browseManual.equipment_no} · ` : ''}{Number(browseManual.item_count || 0).toLocaleString()} saved rows</span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${selectedAsset && normalizeKey(browseManual.equipment_no) === normalizeKey(selectedAsset.chassis_no || selectedAsset.serial_no) ? 'bg-[var(--brand)]/15 text-[var(--oem-accent-text)]' : 'bg-amber-500/10 text-amber-300'}`}>{selectedAsset && normalizeKey(browseManual.equipment_no) === normalizeKey(selectedAsset.chassis_no || selectedAsset.serial_no) ? 'Equipment number match' : 'Confirm serial / generation applicability'}</span><button type="button" className="ml-auto text-[var(--oem-accent-text)]" onClick={() => { setBrowseManual(null); setBrowseRows([]); setBrowsePdfDoc(null); setBrowsePdfManualId(null); setSelectedIllustrationPage(null) }}>Choose another manual</button></div>}
      </Card>

      {!browseManual && <Card className="space-y-3 !p-3">
        <div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Choose a saved catalog</h2><p className="text-xs text-[var(--text-muted)]">{selectedAsset ? 'Matching manuals are prioritized. Confirm generation and serial range before ordering.' : 'Select a model and generation when you do not have a chassis number.'}</p></div><span className="text-xs text-[var(--text-muted)]">{browseManualOptions.length} manuals</span></div>
        {catalogLoading ? <div className="py-5 text-center text-sm text-[var(--text-muted)]"><Loader2 className="mx-auto animate-spin text-[var(--oem-accent-text)]"/></div> : browseManualOptions.length ? <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{browseManualOptions.map((manual) => <button type="button" key={manual.id} onClick={() => selectBrowseManual(manual)} className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] p-3 text-left transition hover:border-[var(--brand)]/50 hover:bg-[var(--brand)]/5"><div className="font-semibold text-[var(--text-primary)]">{manual.manufacturer} · {manual.model}{manual.generation ? ` · ${manual.generation}` : ''}</div><div className="mt-1 text-[11px] text-[var(--text-muted)]">{[manual.model_code && `Code ${manual.model_code}`, (manual.model_year_from || manual.model_year_to) && `Years ${manual.model_year_from || '—'}–${manual.model_year_to || '—'}`, manual.equipment_no && `Equipment ${manual.equipment_no}`].filter(Boolean).join(' · ') || manual.source_file_name}</div><div className="mt-2 flex items-center justify-between text-xs"><span className="text-[var(--text-secondary)]">{Number(manual.item_count || 0).toLocaleString()} saved rows</span><span className="font-semibold text-[var(--oem-accent-text)]">Open catalog →</span></div></button>)}</div> : <p className="rounded-lg border border-[var(--input-border)] p-4 text-sm text-[var(--text-muted)]">No saved catalog is available for this vehicle. Use Import catalog to upload an authorized OEM manual once.</p>}
      </Card>}

      {browseManual && <>
        <OemCatalogViewer
          manual={browseManual}
          manualOptions={browseManualOptions.some((m) => m.id === browseManual.id) ? browseManualOptions : [browseManual, ...browseManualOptions]}
          onChooseManual={(m) => m && selectBrowseManual(m)}
          asset={selectedAsset}
          fitment={fitmentState}
          groups={illustrationGroups}
          activeGroup={activeIllustration}
          onOpenGroup={openIllustration}
          pdfDoc={browsePdfDoc}
          allRows={browseRows}
          figureRows={browseFigures}
          selectedIndex={selectedIndex}
          onSelectIndex={setSelectedIndex}
          selectedKeys={selectedKeys}
          onAddRows={(list) => list.forEach((row) => addPartToSelection(row, browseManual, activeIllustration))}
          onRequestSelected={(list) => { list.forEach((row) => addPartToSelection(row, browseManual, activeIllustration)); setRequestError(''); setRequestModalOpen(true) }}
          onOpenSource={openSourcePdf}
          loading={browseLoading}
          error={browseError}
        />
      </>}
    </div>}

    {tab === 'selection' && <Card className="space-y-3 !p-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Selected OEM parts</h2><p className="text-xs text-[var(--text-muted)]">Collect parts across different assemblies and manuals. Source and figure details stay with each selected row.</p></div><div className="flex gap-2"><button type="button" disabled={!selectedParts.length} onClick={() => setConfirmClear(true)} className={`${BUTTON} disabled:opacity-50`}><X size={14}/>{t('oemcatalog.basket.clear')}</button><button type="button" disabled={!selectedParts.length} onClick={() => { setRequestError(''); setRequestModalOpen(true) }} className="btn-primary inline-flex min-h-[42px] items-center gap-2 px-3 text-sm disabled:opacity-50"><PackagePlus size={15}/>Add {selectedParts.length || ''} to Parts Requests</button></div></div>
      {selectedParts.length ? <SelectedPartsTable stock={basketStock} items={selectedParts} onQty={updateRequestedQty} onRemove={(key) => setSelectedParts((current) => current.filter((row) => row.key !== key))} /> : <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-[var(--input-border)] p-6 text-center"><div><PackagePlus size={28} className="mx-auto text-[var(--oem-accent-text)]"/><h3 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">No parts selected yet</h3><p className="mt-1 max-w-md text-xs text-[var(--text-muted)]">Browse an illustration, select “Add” beside each OEM row, then continue through other assemblies. Your list stays here while you browse.</p><button type="button" onClick={() => switchTab('browse')} className={`${BUTTON} mt-3`}>Browse catalogs</button></div></div>}
    </Card>}

    {tab === 'partSearch' && <div className="space-y-4">
      <Card className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Search part number or description</span><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/><input value={query} onChange={(e) => setQuery(e.target.value)} className={`${INPUT} pl-10`} placeholder="Enter a part number, assembly or description" aria-label="Search OEM parts"/></div></label>
          <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Manual / model</span><select value={manualFilter} onChange={(e) => setManualFilter(e.target.value)} className={INPUT}><option value="all">All saved manuals</option>{manuals.map((m) => <option key={m.id} value={m.id}>{m.manufacturer} · {m.model} · {m.equipment_no || m.model_code || m.source_file_name}</option>)}</select></label>
          <button type="button" onClick={searchAssets} className={BUTTON} disabled={assetsLoading}><Search size={15}/>{assetsLoading ? 'Loading fleet…' : 'Find vehicle by chassis'}</button>
        </div>
        {assetRows.length > 0 && <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
          <input value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} className={INPUT} placeholder="Type chassis / VIN / asset no." aria-label="Search fleet chassis and VIN"/>
          {selectedAsset ? <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/5 p-3"><span className="truncate text-sm text-[var(--text-primary)]">{searchableAssetResult(selectedAsset)}</span><button type="button" className="text-xs text-[var(--oem-accent-text)]" onClick={() => { setSelectedAsset(null); setAssetQuery('') }}>Clear</button></div> : matchingAssets.length > 0 ? <div className="overflow-hidden rounded-lg border border-[var(--input-border)]">{matchingAssets.map((asset) => <button type="button" key={asset.id} onClick={() => applyAssetFitment(asset)} className="block min-h-11 w-full border-b border-[var(--input-border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--panel-2)]">{searchableAssetResult(asset)}</button>)}</div> : <p className="self-center text-xs text-[var(--text-muted)]">No matching fleet vehicle. Enter another identifier.</p>}
        </div>}
        {selectedAsset && <p className="text-xs text-[var(--text-muted)]">{manualsForAsset.length ? `${manualsForAsset.length} manual${manualsForAsset.length === 1 ? '' : 's'} match this vehicle’s make and model.` : 'No saved manual matches this vehicle’s make and model yet.'}</p>}
      </Card>

      <div className="oem-filters" role="group" aria-label={t('oemcatalog.filters.title')}>
        <label>{t('oemcatalog.filters.manufacturer')}<select value={searchFilters.manufacturer} onChange={(e) => setSearchFilters((f) => ({ ...f, manufacturer: e.target.value }))}><option value="">{t('oemcatalog.filters.all')}</option>{[...new Set(manuals.map((m) => m.manufacturer).filter(Boolean))].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label>{t('oemcatalog.filters.compat')}<select value={searchFilters.compatibility} onChange={(e) => setSearchFilters((f) => ({ ...f, compatibility: e.target.value }))}><option value="">{t('oemcatalog.filters.all')}</option>{['confirmed', 'model', 'unverified', 'incompatible'].map((c) => <option key={c} value={c}>{t(`oemcatalog.compat.${c}`)}</option>)}</select></label>
        <label>{t('oemcatalog.filters.category')}<select value={searchFilters.category} onChange={(e) => setSearchFilters((f) => ({ ...f, category: e.target.value }))}><option value="">{t('oemcatalog.filters.all')}</option>{Object.keys(STANDARD_LABELS).map((c) => <option key={c} value={c}>{t(`oemcatalog.category.${c}`)}</option>)}</select></label>
      </div>
      <Card pad="none" className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--input-border)] px-4 py-3"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">OEM parts master</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{query.trim().length >= 2 ? `${entries.length} result${entries.length === 1 ? '' : 's'} shown` : `${manuals.reduce((sum, m) => sum + (m.item_count || 0), 0).toLocaleString()} searchable entries across ${manuals.length} manuals`}</p></div>{catalogLoading && <Loader2 size={17} className="animate-spin text-[var(--oem-accent-text)]"/>}</div>
        {loading ? <div className="grid min-h-40 place-items-center text-sm text-[var(--text-muted)]"><Loader2 className="animate-spin" size={20}/></div> : entries.length ? <SearchResultsTable entries={ranked} selectedKeys={selectedKeys} onView={browseFromPart} onAdd={(row) => addPartToSelection(row, row.manual, { label: row.assembly_heading || 'Figure not linked', page: row.illustration_pdf_page, rows: [row], sourcePages: [row.source_pdf_page] })} /> : <div className="grid min-h-48 place-items-center px-5 text-center"><div><FileSearch size={24} className="mx-auto text-[var(--text-muted)]"/><p className="mt-3 text-sm font-medium text-[var(--text-primary)]">{manuals.length ? 'Search by any part number to find it in the OEM manuals' : 'No OEM manuals saved yet'}</p><p className="mt-1 text-xs text-[var(--text-muted)]">Upload a PDF once. Tyre Pulse stores its parts rows and private source document for future searches.</p>{!manuals.length && <button type="button" onClick={() => switchTab('import')} className={`${BUTTON} mt-4`}><Upload size={15}/>Import first manual</button>}</div></div>}
      </Card>
    </div>}

    {tab === 'manuals' && <Card pad="none" className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--input-border)] px-4 py-3"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Saved OEM manuals</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Each PDF is stored once. Its extracted rows remain available in the master search.</p></div><button type="button" onClick={() => switchTab('import')} className={BUTTON}><Upload size={15}/>Import PDF</button></div>
      {catalogLoading ? <div className="grid min-h-40 place-items-center"><Loader2 className="animate-spin text-[var(--oem-accent-text)]"/></div> : manuals.length ? <div className="divide-y divide-[var(--input-border)]">{manuals.map((manual) => <div key={manual.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4"><div><div className="font-semibold text-[var(--text-primary)]">{manual.manufacturer} · {manual.model}{manual.generation ? ` · ${manual.generation}` : ''}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{[manual.model_code && `Model code ${manual.model_code}`, (manual.model_year_from || manual.model_year_to) && `Years ${manual.model_year_from || '—'}–${manual.model_year_to || '—'}`,manual.equipment_no && `Equipment ${manual.equipment_no}`,manual.chassis_from && `Chassis ${manual.chassis_from}${manual.chassis_to ? `–${manual.chassis_to}` : ''}`].filter(Boolean).join(' · ') || manual.source_file_name}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{manual.item_count.toLocaleString()} entries · {manual.page_count} PDF pages · {manual.extraction_status.replace('_',' ')}</div></div><div className="flex min-w-0 items-center gap-3"><span className="max-w-[280px] truncate text-xs text-[var(--text-muted)]">{manual.source_file_name}</span><button type="button" onClick={() => { switchTab('browse'); selectBrowseManual(manual) }} className={`${BUTTON} min-h-9 text-xs`}><BookOpen size={14}/>Browse this catalog</button>{canManage && <button type="button" onClick={() => setDeleteTarget(manual)} className={`${BUTTON} min-h-9 text-xs`}>{t('oemcatalog.manual.delete')}</button>}</div></div>)}</div> : <div className="p-8 text-center text-sm text-[var(--text-muted)]">No manuals imported.</div>}
    </Card>}

    <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title={t('oemcatalog.basket.clearTitle')} size="sm" footer={<div className="flex justify-end gap-2"><button type="button" className={BUTTON} onClick={() => setConfirmClear(false)}>{t('oemcatalog.basket.keep')}</button><button type="button" className="btn-primary min-h-[42px] px-3 text-sm" onClick={() => { setSelectedParts([]); setConfirmClear(false) }}>{t('oemcatalog.basket.clearYes', { count: selectedParts.length })}</button></div>}><p className="text-sm text-[var(--text-secondary)]">{t('oemcatalog.basket.clearBody')}</p></Modal>

    <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={t('oemcatalog.manual.deleteTitle')} size="sm" footer={<div className="flex justify-end gap-2"><button type="button" className={BUTTON} onClick={() => setDeleteTarget(null)}>{t('oemcatalog.basket.keep')}</button><button type="button" disabled={deleting} className="btn-primary min-h-[42px] px-3 text-sm" onClick={async () => { setDeleting(true); try { await deleteOemManual(deleteTarget.id); setDeleteTarget(null); await refreshManuals() } catch (e) { setDeleteTarget(null); setPageError(toUserMessage(e, t('oemcatalog.manual.deleteError'))) } finally { setDeleting(false) } }}>{t('oemcatalog.manual.deleteYes')}</button></div>}><p className="text-sm text-[var(--text-secondary)]">{t('oemcatalog.manual.deleteBody', { name: deleteTarget ? `${deleteTarget.manufacturer} ${deleteTarget.model}` : '' })}</p></Modal>

    {tab === 'review' && canManage && <div className="space-y-3">
      <label className="oem-field"><span>{t('oemcatalog.review.manual')}</span><select value={reviewManualId} onChange={(e) => setReviewManualId(e.target.value)}><option value="">-</option>{manuals.map((m) => <option key={m.id} value={m.id}>{m.manufacturer} {m.model}</option>)}</select></label>
      {reviewManualId && manuals.find((m) => m.id === reviewManualId) && <><OemReviewWorkspace key={reviewManualId} manual={manuals.find((m) => m.id === reviewManualId)} /><OemFigureTools key={`tools-${reviewManualId}`} manual={manuals.find((m) => m.id === reviewManualId)} /><OemReprocessPanel key={`rep-${reviewManualId}`} manual={manuals.find((m) => m.id === reviewManualId)} /></>}
    </div>}

    {tab === 'import' && canManage && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
      <Card className="space-y-4">
        <div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Upload and extract the OEM catalog</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Download a catalog you’re authorized to use, then select its PDF here. Tyre Pulse extracts the parts rows and saves the source PDF privately for its illustrations.</p></div>
        <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] p-3"><div className="text-xs font-semibold text-[var(--text-primary)]">Official catalog sources to check</div><p className="mt-1 text-[11px] text-[var(--text-muted)]">Availability and download rights vary by brand. Some portals show diagrams online but do not provide a downloadable full catalog.</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs"><a className="text-[var(--oem-accent-text)] underline" href="https://www.cat.com/en_US/support/maintenance/parts-reference-guides.html" target="_blank" rel="noreferrer">Cat free parts guides</a><a className="text-[var(--oem-accent-text)] underline" href="https://www.cat.com/sis2go" target="_blank" rel="noreferrer">Cat SIS2GO</a><a className="text-[var(--oem-accent-text)] underline" href="https://www.bobcat.com/na/en/parts-service/parts-catalog" target="_blank" rel="noreferrer">Bobcat official catalog</a><a className="text-[var(--oem-accent-text)] underline" href="https://www.hitachicm.com/global/en/products/parts-service/parts/selected-parts/" target="_blank" rel="noreferrer">Hitachi selected parts PDFs</a><a className="text-[var(--oem-accent-text)] underline" href="https://www.sanyglobal.com/mysany/" target="_blank" rel="noreferrer">SANY MySANY parts access</a></div></div>
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--brand)]/40 bg-[var(--brand)]/5 p-5 text-center hover:bg-[var(--brand)]/10"><input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => selectPdf(e.target.files?.[0])}/><Upload size={22} className="text-[var(--oem-accent-text)]"/><span className="mt-2 text-sm font-medium text-[var(--text-primary)]">{pdfFile?.name || 'Choose OEM PDF'}</span><span className="mt-1 text-xs text-[var(--text-muted)]">PDF up to 100 MB</span></label>
        {extractProgress && !extraction && <div className="rounded-lg border border-[var(--input-border)] p-3 text-sm text-[var(--text-secondary)]" role="status">{extractProgress.pageNumber === 0 ? 'Opening PDF…' : `Reading page ${extractProgress.pageNumber} of ${extractProgress.pageCount} · ${extractProgress.rowCount} rows found`}<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full bg-[var(--brand)] transition-all" style={{ width: `${extractProgress.pageCount ? Math.round(100 * extractProgress.pageNumber / extractProgress.pageCount) : 4}%` }}/></div></div>}
        {pdfError && <p className="text-sm text-red-300" role="alert">{pdfError}</p>}
        {extraction && <>
          <div className="grid grid-cols-3 gap-2"><div className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{extraction.rows.length.toLocaleString()}</div><div className="text-[11px] text-[var(--text-muted)]">Part and variant rows</div></div><div className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{extraction.parsedPages.length}</div><div className="text-[11px] text-[var(--text-muted)]">Parts-list pages</div></div><div className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{extraction.reviewPages.length}</div><div className="text-[11px] text-[var(--text-muted)]">Unparsed parts-table pages</div></div></div>
          {extraction.reviewPages.length > 0 && <p className="text-xs text-amber-300">Pages {extraction.reviewPages.join(', ')} contain parts-table headings but no extracted rows. Review those pages before saving to avoid missing entries.</p>}
          {extraction.imageOnlyPages.length > 0 && <p className="text-xs text-[var(--text-muted)]">{extraction.imageOnlyPages.length} image-only pages are retained in the source PDF. Check whether any are scanned parts lists.</p>}
          <ExtractionPreviewTable rows={pipeline.publish.slice(0, 8)} />
          <ImportReviewPanel result={pipeline} />
        </>}
      </Card>

      <Card className="space-y-4">
        <div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Identify model and fitment</h2><p className="mt-1 text-xs text-[var(--text-muted)]">These details let users find the right manual from a fleet vehicle or chassis number.</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="OEM brand" required value={manualForm.manufacturer} onChange={(v) => setManualForm((f) => ({ ...f, manufacturer: v }))} placeholder="For example, SANY"/><Field label="Model" required value={manualForm.model} onChange={(v) => setManualForm((f) => ({ ...f, model: v }))} placeholder="Model printed by OEM"/><Field label="Generation / series" value={manualForm.generation} onChange={(v) => setManualForm((f) => ({ ...f, generation: v }))} placeholder="For example, Gen 2 / Series B"/><Field label="Model code" value={manualForm.modelCode} onChange={(v) => setManualForm((f) => ({ ...f, modelCode: v }))} placeholder="OEM code / variant"/><Field label="Equipment / serial number" value={manualForm.equipmentNo} onChange={(v) => setManualForm((f) => ({ ...f, equipmentNo: v }))} placeholder="Manual number or chassis ID"/></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Model year from" value={manualForm.modelYearFrom} onChange={(v) => setManualForm((f) => ({ ...f, modelYearFrom: v.replace(/\D/g, '').slice(0, 4) }))} placeholder="Optional"/><Field label="Model year to" value={manualForm.modelYearTo} onChange={(v) => setManualForm((f) => ({ ...f, modelYearTo: v.replace(/\D/g, '').slice(0, 4) }))} placeholder="Optional"/></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Chassis / serial from" value={manualForm.chassisFrom} onChange={(v) => setManualForm((f) => ({ ...f, chassisFrom: v }))} placeholder="Optional range start"/><Field label="Chassis / serial to" value={manualForm.chassisTo} onChange={(v) => setManualForm((f) => ({ ...f, chassisTo: v }))} placeholder="Optional range end"/></div>
        <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] p-3"><div className="text-xs font-semibold text-[var(--text-primary)]">Match to a fleet vehicle</div><div className="mt-2 flex gap-2"><input value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} onFocus={() => { if (!assetRows.length) searchAssets() }} className={INPUT} placeholder="Search chassis, VIN, asset no."/><button type="button" className={BUTTON} onClick={searchAssets} disabled={assetsLoading}><Search size={14}/></button></div>{matchingAssets.length > 0 && <div className="mt-2 divide-y divide-[var(--input-border)] overflow-hidden rounded-lg border border-[var(--input-border)]">{matchingAssets.map((asset) => <button type="button" key={asset.id} className="block min-h-10 w-full px-3 py-2 text-left text-xs hover:bg-[var(--panel)]" onClick={() => applyAssetFitment(asset)}>{searchableAssetResult(asset)}</button>)}</div>}{selectedAsset && <p className="mt-2 text-xs text-[var(--oem-accent-text)]">Fitment linked to {selectedAsset.asset_no}. Brand and model filled from the live fleet register.</p>}</div>
        {saveError && <p className="text-sm text-red-300" role="alert">{saveError}</p>}
        <button type="button" className="btn-primary inline-flex min-h-11 w-full items-center justify-center gap-2" disabled={!extraction?.rows?.length || saving} onClick={saveCatalog}>{saving ? <><Loader2 size={16} className="animate-spin"/>Saving PDF and {extraction?.rows?.length.toLocaleString()} rows…</> : <><CheckCircle2 size={16}/>Save to OEM master catalog</>}</button>
        <p className="text-[11px] leading-5 text-[var(--text-muted)]">This adds searchable OEM reference records only. It does not add stock, prices or purchase quantities to the inventory catalog.</p>
      </Card>
    </div>}

    <Modal open={requestModalOpen} onClose={() => !requestSaving && setRequestModalOpen(false)} title={`Add ${selectedParts.length} OEM part${selectedParts.length === 1 ? '' : 's'} to Parts Requests`} size="lg" footer={<div className="flex justify-end gap-2"><button type="button" disabled={requestSaving} onClick={() => setRequestModalOpen(false)} className="btn-secondary min-h-10 px-4 text-sm">Cancel</button><button type="submit" form="oem-parts-request-form" disabled={requestSaving || !selectedParts.length} className="btn-primary inline-flex min-h-10 items-center gap-2 px-4 text-sm disabled:opacity-50">{requestSaving ? <Loader2 size={15} className="animate-spin"/> : <PackagePlus size={15}/>}Create part requests</button></div>}>
      <form id="oem-parts-request-form" onSubmit={submitSelectedParts} className="space-y-4">
        <p className="text-xs text-[var(--text-muted)]">Each selected OEM part becomes its own Parts Request row. Full catalog, figure, callout and source references are saved in the request notes. OEM reference data will not change stock or inventory.</p>
        <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] p-3"><div className="mb-2 text-xs font-semibold text-[var(--text-primary)]">Selected lines ({selectedParts.length})</div><div className="max-h-40 space-y-2 overflow-auto">{selectedParts.map((item) => <div key={item.key} className="flex items-start justify-between gap-3 text-xs"><span><b className="font-mono text-[var(--oem-accent-text)]">{item.row.part_no}</b><span className="ml-2 text-[var(--text-primary)]">{item.row.description}</span><span className="block text-[10px] text-[var(--text-muted)]">{item.manual.manufacturer} {item.manual.model} · {item.figureLabel} · index {item.row.index_no || item.row.parent_index || '—'}</span></span><span className="shrink-0 text-[var(--text-secondary)]">Qty {item.requestedQty}</span></div>)}</div></div>
        {requestError && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{requestError}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-[var(--text-muted)]"><span className="mb-1 block">Work order (optional)</span><select value={requestForm.jobId} onChange={(event) => setRequestForm((form) => ({ ...form, jobId: event.target.value }))} className={INPUT} disabled={requestJobsLoading}><option value="">{requestJobsLoading ? 'Loading open work orders…' : 'No work order / general request'}</option>{requestJobs.map((job) => <option key={job.id} value={job.id}>{[job.work_order_no || job.id.slice(0, 8), job.asset_no, job.description].filter(Boolean).join(' · ')}</option>)}</select></label>
          <label className="block text-xs text-[var(--text-muted)]"><span className="mb-1 block">Priority</span><select value={requestForm.priority} onChange={(event) => setRequestForm((form) => ({ ...form, priority: event.target.value }))} className={INPUT}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
          <label className="block text-xs text-[var(--text-muted)]"><span className="mb-1 block">Needed by (optional)</span><input type="date" value={requestForm.neededBy} onChange={(event) => setRequestForm((form) => ({ ...form, neededBy: event.target.value }))} className={INPUT}/></label>
          <label className="block text-xs text-[var(--text-muted)]"><span className="mb-1 block">Additional request note (optional)</span><input value={requestForm.notes} onChange={(event) => setRequestForm((form) => ({ ...form, notes: event.target.value }))} className={INPUT} placeholder="Reason or delivery note"/></label>
        </div>
      </form>
    </Modal>
  </div>
}
