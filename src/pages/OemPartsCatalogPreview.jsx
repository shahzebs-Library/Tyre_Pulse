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
import { findOemManualByHash, getOemPdfSignedUrl, listOemManualEntries, listOemManuals, saveOemManual, searchOemEntries } from '../lib/api/oemPartsCatalog'
import { createPartsRequest, listOpenJobs } from '../lib/api/partsRequests'
import { extractOemIdentity, extractOemPartsDocument } from '../lib/oemPartsExtractor'
import { toUserMessage } from '../lib/safeError'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const INPUT = 'input min-h-[44px] w-full'
const BUTTON = 'btn-secondary inline-flex min-h-[42px] items-center justify-center gap-2 px-3 text-sm'
const assetText = (asset) => [asset.asset_no, asset.fleet_number, asset.make, asset.model, asset.vehicle_type, asset.registration_no, asset.chassis_no, asset.serial_no, asset.engine_no, asset.site, asset.country].filter(Boolean).join(' ').toLowerCase()

function Field({ label, value, onChange, placeholder, required = false }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}{required ? ' *' : ''}</span><input required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={INPUT} /></label>
}

function OemIllustrationCanvas({ pdfDoc, pageNo, rows, selectedIndex, onSelectIndex }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [callouts, setCallouts] = useState([])
  const canvasRef = useRef(null)
  const hostRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    let task
    async function draw() {
      if (!pdfDoc || !canvasRef.current || !hostRef.current || !pageNo) return
      setBusy(true); setError(''); setCallouts([])
      try {
        const page = await pdfDoc.getPage(pageNo)
        const natural = page.getViewport({ scale: 1 })
        const scale = Math.min(1.8, Math.max(0.35, (hostRef.current.clientWidth - 32) / natural.width))
        const viewport = page.getViewport({ scale })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const canvas = canvasRef.current
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        setCanvasSize({ width: viewport.width, height: viewport.height })
        const text = await page.getTextContent()
        const usable = new Set(rows.map((row) => normalizeIndex(row.index_no || row.parent_index)).filter(Boolean))
        const markers = []
        for (const item of text.items || []) {
          const index = normalizeIndex(item.str)
          if (!index || !usable.has(index)) continue
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
          markers.push({ id: `${index}-${Math.round(x)}-${Math.round(y)}`, index, x, y })
        }
        if (!cancelled) setCallouts(markers)
        task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] })
        await task.promise
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) setError(toUserMessage(err, 'This illustration page could not be displayed.'))
      } finally { if (!cancelled) setBusy(false) }
    }
    draw()
    return () => { cancelled = true; task?.cancel() }
  }, [pdfDoc, pageNo, rows])
  if (!pdfDoc) return null
  return <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900">
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3"><span className="truncate text-xs font-semibold text-white">OEM illustration · PDF page {pageNo}</span><span className="text-[10px] text-amber-300">Text-detected callouts · verify against the source figure</span>{busy && <Loader2 className="animate-spin text-emerald-500" size={14}/>}</div>
    <div ref={hostRef} className="min-h-0 flex-1 overflow-auto p-3"><div className="relative mx-auto bg-white shadow-xl" style={{ width: canvasSize.width || '100%', height: canvasSize.height || 'auto' }}><canvas ref={canvasRef} className="block max-w-none"/>{callouts.map((marker) => <button key={marker.id} type="button" title={`Show parts for index ${marker.index}`} aria-label={`Show parts for index ${marker.index}`} onClick={() => onSelectIndex(marker.index)} className={`absolute z-10 grid h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 px-1 text-xs font-extrabold shadow-lg ${selectedIndex === marker.index ? 'border-white bg-emerald-500 text-white ring-2 ring-emerald-300' : 'border-slate-950 bg-emerald-400 text-slate-950 hover:scale-110'}`} style={{ left: marker.x, top: marker.y }}>{marker.index}</button>)}</div>{error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}{!busy && !error && callouts.length === 0 && <p className="mt-2 text-xs text-slate-400">The PDF does not expose clickable text callouts on this page. Choose the matching index from the parts list beside the drawing.</p>}</div>
  </div>
}

function searchableAssetResult(asset) {
  return `${asset.asset_no || asset.fleet_number || 'Asset'} · ${[asset.make, asset.model].filter(Boolean).join(' ')} · Chassis ${asset.chassis_no || asset.serial_no || 'not recorded'}`
}

function normalizeKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function normalizeIndex(value) {
  const raw = String(value || '').trim().replace(/[.)]$/, '')
  if (/^\d+$/.test(raw)) return String(Number(raw))
  return raw.toUpperCase()
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
  const [tab, setTab] = useState('browse')
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
  const [selectedParts, setSelectedParts] = useState([])
  const [requestModalOpen, setRequestModalOpen] = useState(false)
  const [requestJobs, setRequestJobs] = useState([])
  const [requestJobsLoading, setRequestJobsLoading] = useState(false)
  const [requestSaving, setRequestSaving] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [requestForm, setRequestForm] = useState({ jobId: '', priority: 'medium', neededBy: '', notes: '' })
  const [browseManual, setBrowseManual] = useState(null)
  const [browseRows, setBrowseRows] = useState([])
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
      const applicable = selectedAsset ? new Set(manuals.filter((manual) => normalizeManualForAsset(manual, selectedAsset)).map((manual) => manual.id)) : null
      setEntries(applicable ? results.filter((row) => applicable.has(row.manual_id)) : results)
    } catch (error) { setEntries([]); setPageError(toUserMessage(error, 'Part search failed.')) }
    finally { setLoading(false) }
  }, [query, manualFilter, activeCountry, selectedAsset, manuals])
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
  const illustrationGroups = useMemo(() => {
    const groups = new Map()
    for (const row of browseRows) {
      const page = row.illustration_pdf_page || null
      const key = page ? String(page) : 'unlinked'
      if (!groups.has(key)) groups.set(key, { page, rows: [], headings: new Set(), sourcePages: new Set(), printedPages: new Set() })
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
    })).sort((a, b) => (a.page || Number.MAX_SAFE_INTEGER) - (b.page || Number.MAX_SAFE_INTEGER))
  }, [browseRows])
  const assemblyCategories = useMemo(() => [...new Set(illustrationGroups.flatMap((group) => group.headings))].sort((a, b) => a.localeCompare(b)), [illustrationGroups])
  const filteredIllustrations = useMemo(() => illustrationGroups.filter((group) => {
    const categoryMatch = assemblyFilter === 'all' || group.headings.includes(assemblyFilter)
    const needle = browseFilter.trim().toLowerCase()
    const textMatch = !needle || [group.label, group.page, ...group.headings, ...group.printedPages].join(' ').toLowerCase().includes(needle)
    return categoryMatch && textMatch
  }), [illustrationGroups, assemblyFilter, browseFilter])
  const activeIllustration = useMemo(() => illustrationGroups.find((group) => group.page === selectedIllustrationPage) || illustrationGroups.find((group) => !group.page && selectedIllustrationPage === 'unlinked') || null, [illustrationGroups, selectedIllustrationPage])
  const selectedIndexRows = useMemo(() => activeIllustration?.rows.filter((row) => normalizeIndex(row.index_no || row.parent_index) === normalizeIndex(selectedIndex)) || [], [activeIllustration, selectedIndex])

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
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setPdfError('Select an OEM parts catalog PDF.'); return }
    if (file.size > 100 * 1024 * 1024) { setPdfError('This PDF is larger than the 100 MB catalog limit.'); return }
    setPdfFile(file); setPdfError(''); setExtractProgress({ pageNumber: 0, pageCount: 0, rowCount: 0 })
    try {
      const buffer = await file.arrayBuffer()
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
      setPdfDoc(doc)
      const identity = await extractOemIdentity(doc, file.name)
      const extracted = await extractOemPartsDocument(doc, setExtractProgress)
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
      const rows = await listOemManualEntries(manual.id)
      setBrowseRows(rows)
      if (!rows.length) setBrowseError('This manual has no saved part rows yet. Re-import the source PDF or ask an administrator to check its import status.')
    } catch (error) { setBrowseError(toUserMessage(error, 'Could not load this manual’s illustration groups.')) }
    finally { setBrowseLoading(false) }
  }

  const openIllustration = async (group, manualOverride = null) => {
    const sourceManual = manualOverride || browseManual
    setSelectedIllustrationPage(group.page || 'unlinked')
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
    if (!pdfFile || !extraction?.rows?.length) { setSaveError('This PDF has no parts rows to save. Review the source pages first.'); return }
    if (!manualForm.manufacturer.trim() || !manualForm.model.trim()) { setSaveError('Enter the OEM brand and model printed on the manual.'); return }
    setSaving(true); setSaveError(''); setSaveNotice('')
    try {
      const hash = await sha256(pdfFile)
      const existing = await findOemManualByHash(hash)
      const alreadyReady = existing && ['ready', 'needs_review'].includes(existing.extraction_status)
      if (alreadyReady) {
        await refreshManuals()
        setPageError(`This exact PDF is already saved as ${existing.manufacturer} ${existing.model} (${existing.item_count.toLocaleString()} rows). Search it instead of uploading again.`)
        setTab('browse')
        return
      }
      const country = activeCountry && activeCountry !== 'All' ? activeCountry : null
      const saved = await saveOemManual({
        id: existing?.id || crypto.randomUUID(), resume: Boolean(existing), file: pdfFile, sha256: hash, country,
        manufacturer: manualForm.manufacturer, model: manualForm.model, modelCode: manualForm.modelCode,
        equipmentNo: manualForm.equipmentNo, chassisFrom: manualForm.chassisFrom, chassisTo: manualForm.chassisTo,
        pageCount: extraction.pageCount, rows: extraction.rows,
        summary: {
          parsedPages: extraction.parsedPages,
          skippedPages: extraction.skippedPages,
          reviewPages: extraction.reviewPages,
          imageOnlyPages: extraction.imageOnlyPages,
          fitment: {
            generation: manualForm.generation.trim() || null,
            model_year_from: manualForm.modelYearFrom ? Number(manualForm.modelYearFrom) : null,
            model_year_to: manualForm.modelYearTo ? Number(manualForm.modelYearTo) : null,
          },
        },
      })
      await refreshManuals()
      setSaveNotice(`${saved.manufacturer} ${saved.model}: ${saved.item_count.toLocaleString()} parts and variants saved. The PDF is stored once for future lookups.`)
      setTab('browse')
    } catch (error) { setSaveError(toUserMessage(error, 'Could not save the OEM manual.')) }
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

  return <div className="space-y-5">
    <PageHeader title={t('oempreview.title')} subtitle={t('oempreview.subtitle')} icon={BookOpen} actions={<Link to="/parts-catalog" className={BUTTON}><ArrowLeft size={15}/>{t('oempreview.inventoryCatalog')}</Link>} />

    <div className="flex flex-wrap gap-2 border-b border-[var(--input-border)] pb-3" role="tablist" aria-label={t('oempreview.sections')}>
      {[['browse',t('oempreview.tabBrowse')],['partSearch',t('oempreview.tabPartSearch')],['selection',t('oempreview.tabSelection',{count:selectedParts.length})],['manuals',t('oempreview.tabManuals')],['import',t('oempreview.tabImport')]].map(([key,label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => switchTab(key)} className={`min-h-[40px] rounded-lg px-4 text-sm font-medium ${tab === key ? 'bg-emerald-500 text-slate-950' : 'text-[var(--text-secondary)] hover:bg-[var(--panel-2)]'}`}>{label}</button>)}
    </div>

    {pageError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{pageError}</div>}
    {saveNotice && <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200" role="status"><CheckCircle2 size={17} className="mt-0.5 shrink-0"/>{saveNotice}</div>}

    {tab === 'browse' && <div className="space-y-3">
      <Card className="space-y-3 !p-3">
        <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_auto_auto] lg:items-end">
          <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Find a fleet vehicle</span><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/><input value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} onFocus={() => { if (!assetRows.length) searchAssets() }} className={`${INPUT} pl-9`} placeholder="Chassis, VIN, equipment serial, fleet or asset number" aria-label="Find vehicle by chassis, VIN, serial, fleet or asset number"/></div></label>
          <button type="button" onClick={searchAssets} className={BUTTON} disabled={assetsLoading}><Search size={15}/>{assetsLoading ? 'Searching fleet…' : 'Search fleet'}</button>
          <button type="button" onClick={() => switchTab('manuals')} className={BUTTON}><BookOpen size={15}/>Browse by model / generation</button>
        </div>
        {selectedAsset ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2"><div><div className="text-sm font-semibold text-[var(--text-primary)]">{searchableAssetResult(selectedAsset)}</div><div className="mt-0.5 text-[11px] text-[var(--text-muted)]">Asset selected. Catalog applicability is shown from the saved manual metadata.</div></div><button type="button" className="text-xs font-semibold text-emerald-400" onClick={() => { setSelectedAsset(null); setBrowseManual(null); setBrowseRows([]); setSelectedIllustrationPage(null); setBrowsePdfDoc(null); setBrowsePdfManualId(null) }}>Change vehicle</button></div> : matchingAssets.length > 0 ? <div className="overflow-hidden rounded-lg border border-[var(--input-border)]">{matchingAssets.map((asset) => <button type="button" key={asset.id} onClick={() => { applyAssetFitment(asset); setBrowseManual(null); setBrowseRows([]); setSelectedIllustrationPage(null); setBrowsePdfDoc(null); setBrowsePdfManualId(null) }} className="block min-h-10 w-full border-b border-[var(--input-border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--panel-2)]">{searchableAssetResult(asset)}</button>)}</div> : null}
        {browseManual && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs"><span className="font-semibold text-[var(--text-primary)]">{browseManual.manufacturer} · {browseManual.model}{browseManual.generation ? ` · ${browseManual.generation}` : ''}</span><span className="text-[var(--text-muted)]">{browseManual.model_code ? `Model code ${browseManual.model_code} · ` : ''}{browseManual.equipment_no ? `Equipment ${browseManual.equipment_no} · ` : ''}{Number(browseManual.item_count || 0).toLocaleString()} saved rows</span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${selectedAsset && normalizeKey(browseManual.equipment_no) === normalizeKey(selectedAsset.chassis_no || selectedAsset.serial_no) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>{selectedAsset && normalizeKey(browseManual.equipment_no) === normalizeKey(selectedAsset.chassis_no || selectedAsset.serial_no) ? 'Equipment number match' : 'Confirm serial / generation applicability'}</span><button type="button" className="ml-auto text-emerald-400" onClick={() => { setBrowseManual(null); setBrowseRows([]); setBrowsePdfDoc(null); setBrowsePdfManualId(null); setSelectedIllustrationPage(null) }}>Choose another manual</button></div>}
      </Card>

      {!browseManual && <Card className="space-y-3 !p-3">
        <div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Choose a saved catalog</h2><p className="text-xs text-[var(--text-muted)]">{selectedAsset ? 'Matching manuals are prioritized. Confirm generation and serial range before ordering.' : 'Select a model and generation when you do not have a chassis number.'}</p></div><span className="text-xs text-[var(--text-muted)]">{browseManualOptions.length} manuals</span></div>
        {catalogLoading ? <div className="py-5 text-center text-sm text-[var(--text-muted)]"><Loader2 className="mx-auto animate-spin text-emerald-400"/></div> : browseManualOptions.length ? <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{browseManualOptions.map((manual) => <button type="button" key={manual.id} onClick={() => selectBrowseManual(manual)} className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] p-3 text-left transition hover:border-emerald-500/50 hover:bg-emerald-500/5"><div className="font-semibold text-[var(--text-primary)]">{manual.manufacturer} · {manual.model}{manual.generation ? ` · ${manual.generation}` : ''}</div><div className="mt-1 text-[11px] text-[var(--text-muted)]">{[manual.model_code && `Code ${manual.model_code}`, (manual.model_year_from || manual.model_year_to) && `Years ${manual.model_year_from || '—'}–${manual.model_year_to || '—'}`, manual.equipment_no && `Equipment ${manual.equipment_no}`].filter(Boolean).join(' · ') || manual.source_file_name}</div><div className="mt-2 flex items-center justify-between text-xs"><span className="text-[var(--text-secondary)]">{Number(manual.item_count || 0).toLocaleString()} saved rows</span><span className="font-semibold text-emerald-400">Open catalog →</span></div></button>)}</div> : <p className="rounded-lg border border-[var(--input-border)] p-4 text-sm text-[var(--text-muted)]">No saved catalog is available for this vehicle. Use Import catalog to upload an authorized OEM manual once.</p>}
      </Card>}

      {browseManual && <>
        {browseError && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{browseError}</p>}
        {browseLoading && <div className="rounded-lg border border-[var(--input-border)] p-5 text-center text-sm text-[var(--text-muted)]"><Loader2 className="mx-auto mb-2 animate-spin text-emerald-400"/>Loading catalog rows…</div>}
        {!browseLoading && browseRows.length > 0 && <div className="grid min-h-[68vh] gap-3 xl:grid-cols-[250px_minmax(0,1.15fr)_minmax(390px,0.95fr)]">
          <Card className="flex min-h-0 flex-col !p-3">
            <div className="mb-2"><h2 className="text-sm font-semibold text-[var(--text-primary)]">Assemblies & figures</h2><p className="text-[11px] text-[var(--text-muted)]">Choose a drawing to view its parts.</p></div>
            <label className="mb-2 block"><span className="sr-only">Filter assembly category</span><select aria-label="Filter assembly category" value={assemblyFilter} onChange={(e) => setAssemblyFilter(e.target.value)} className="min-h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--panel)] px-2 text-xs text-[var(--text-primary)]"><option value="all">All categories</option>{assemblyCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
            <label className="relative mb-2 block"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/><input value={browseFilter} onChange={(e) => setBrowseFilter(e.target.value)} className="min-h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--panel)] pl-8 pr-2 text-xs text-[var(--text-primary)]" placeholder="Find assembly or page" aria-label="Search assemblies and pages"/></label>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">{filteredIllustrations.map((group) => <button key={group.page || 'unlinked'} type="button" onClick={() => openIllustration(group)} aria-current={selectedIllustrationPage === (group.page || 'unlinked') ? 'true' : undefined} className={`block w-full rounded-lg border p-2.5 text-left transition ${selectedIllustrationPage === (group.page || 'unlinked') ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-transparent hover:border-[var(--input-border)] hover:bg-[var(--panel-2)]'}`}><span className="block text-xs font-semibold text-[var(--text-primary)]">{group.label}</span><span className="mt-1 block text-[10px] text-[var(--text-muted)]">{group.page ? `Figure PDF page ${group.page}` : 'No linked figure'} · {group.rows.length} rows</span><span className="block text-[10px] text-[var(--text-muted)]">List pages {group.sourcePages.join(', ') || 'not recorded'}</span></button>)}{!filteredIllustrations.length && <p className="p-3 text-xs text-[var(--text-muted)]">No assemblies match this filter.</p>}</div>
            <div className="mt-2 border-t border-[var(--input-border)] pt-2 text-[10px] text-[var(--text-muted)]">{browseRows.length.toLocaleString()} saved part rows · source manual retained privately</div>
          </Card>

          <section className="min-h-[68vh] min-w-0 overflow-hidden rounded-xl border border-[var(--input-border)] bg-[var(--panel)]">
            {activeIllustration ? <><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--input-border)] px-3 py-2.5"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">{activeIllustration.label}</h2><p className="text-[11px] text-[var(--text-muted)]">{activeIllustration.page ? `Illustration PDF page ${activeIllustration.page}` : 'Illustration not linked'} · parts list pages {activeIllustration.sourcePages.join(', ') || 'not recorded'}</p></div><span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-300">Callout mapping needs review</span></div>{activeIllustration.page && browsePdfDoc ? <div className="h-[60vh] min-h-[400px] p-2"><OemIllustrationCanvas pdfDoc={browsePdfDoc} pageNo={activeIllustration.page} rows={activeIllustration.rows} selectedIndex={selectedIndex} onSelectIndex={(value) => setSelectedIndex(normalizeIndex(value))}/></div> : activeIllustration.page ? <div className="grid h-[60vh] min-h-[400px] place-items-center text-sm text-[var(--text-muted)]"><Loader2 className="mr-2 inline animate-spin text-emerald-400"/>Opening illustration…</div> : <div className="grid h-[60vh] min-h-[400px] place-items-center p-6 text-center text-sm text-[var(--text-muted)]">No linked figure page is available for this group. Its extracted rows are shown in the parts panel. No drawing callouts are inferred.</div>}</> : <div className="grid h-full min-h-[60vh] place-items-center p-8 text-center"><div><BookOpen size={28} className="mx-auto text-emerald-400"/><h2 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">Choose an assembly</h2><p className="mt-1 max-w-xs text-xs text-[var(--text-muted)]">The source illustration and its linked parts will appear here together. It will not open a separate PDF window.</p></div></div>}
          </section>

          <Card className="flex min-h-[68vh] min-w-0 flex-col !p-3">
            <div className="flex items-start justify-between gap-2 border-b border-[var(--input-border)] pb-2"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Parts list</h2><p className="text-[11px] text-[var(--text-muted)]">{activeIllustration ? `${activeIllustration.rows.length} rows · select a row to sync the figure` : 'Select an illustration'}</p></div><button type="button" onClick={() => switchTab('selection')} className="shrink-0 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-400">Selected parts · {selectedParts.length}</button></div>
            {activeIllustration && <>
              <div className="my-2 rounded-lg bg-[var(--panel-2)] p-2 text-[11px] text-[var(--text-muted)]">{selectedIndexRows.length ? <><span className="font-semibold text-[var(--text-primary)]">Index {selectedIndex}</span> · {selectedIndexRows.length} linked part{selectedIndexRows.length === 1 ? '' : 's'}</> : 'Click a figure callout or a row below to inspect its linked parts.'}</div>
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--input-border)]"><table className="w-full min-w-[430px] text-left text-[11px]"><thead className="sticky top-0 bg-[var(--panel-2)] text-[var(--text-muted)]"><tr><th className="px-2 py-2">Index</th><th className="px-2 py-2">OEM part no. / description</th><th className="px-2 py-2">Qty</th><th className="px-2 py-2">Select</th></tr></thead><tbody>{activeIllustration.rows.map((row) => {const index=normalizeIndex(row.index_no || row.parent_index);const isSelected=index && selectedIndex === index;const inBasket=selectedParts.some((item) => item.key === `${browseManual.id}:${row.id}`);return <tr key={row.id} className={`border-t border-[var(--input-border)] ${isSelected ? 'bg-emerald-500/10' : ''}`}><td><button type="button" onClick={() => setSelectedIndex(index)} className="min-h-10 w-full px-2 text-left font-bold text-[var(--text-primary)]">{index || '—'}{row.parent_index && <span className="ml-1 text-[10px] text-[var(--text-muted)]">variant</span>}</button></td><td><button type="button" onClick={() => setSelectedIndex(index)} className="min-h-10 w-full px-2 py-1 text-left"><span className="block font-mono font-semibold text-emerald-400">{row.part_no}</span><span className="block text-[var(--text-primary)]">{row.description}</span>{row.remark && <span className="block text-[var(--text-muted)]">{row.remark}</span>}<span className="block text-[10px] text-[var(--text-muted)]">Source PDF p. {row.source_pdf_page} · printed p. {row.printed_page || '—'}</span></button></td><td className="px-2 text-[var(--text-primary)]">{row.quantity ?? '—'}</td><td className="px-2"><button type="button" disabled={inBasket} onClick={() => addPartToSelection(row, browseManual, activeIllustration)} className="min-h-8 whitespace-nowrap rounded-md border border-emerald-500/30 px-2 text-[10px] font-semibold text-emerald-400 disabled:cursor-default disabled:opacity-60">{inBasket ? 'Added' : '＋ Add'}</button></td></tr>})}</tbody></table></div>
            </>}
          </Card>
        </div>}
      </>}
    </div>}

    {tab === 'selection' && <Card className="space-y-3 !p-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Selected OEM parts</h2><p className="text-xs text-[var(--text-muted)]">Collect parts across different assemblies and manuals. Source and figure details stay with each selected row.</p></div><div className="flex gap-2"><button type="button" disabled={!selectedParts.length} onClick={() => setSelectedParts([])} className={`${BUTTON} disabled:opacity-50`}><X size={14}/>Clear list</button><button type="button" disabled={!selectedParts.length} onClick={() => { setRequestError(''); setRequestModalOpen(true) }} className="btn-primary inline-flex min-h-[42px] items-center gap-2 px-3 text-sm disabled:opacity-50"><PackagePlus size={15}/>Add {selectedParts.length || ''} to Parts Requests</button></div></div>
      {selectedParts.length ? <div className="overflow-auto rounded-lg border border-[var(--input-border)]"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="sticky top-0 bg-[var(--panel-2)] text-[var(--text-muted)]"><tr><th className="px-3 py-2">OEM part number and description</th><th className="px-3 py-2">Brand / model / generation</th><th className="px-3 py-2">Assembly / figure / index</th><th className="px-3 py-2">Source and fitment</th><th className="px-3 py-2">Request qty</th><th className="px-3 py-2">Remove</th></tr></thead><tbody>{selectedParts.map((item) => <tr key={item.key} className="border-t border-[var(--input-border)] align-top"><td className="px-3 py-3"><div className="font-mono font-semibold text-emerald-400">{item.row.part_no}</div><div className="mt-1 max-w-[280px] whitespace-normal text-[var(--text-primary)]">{item.row.description}</div>{item.row.remark && <div className="mt-1 text-[var(--text-muted)]">{item.row.remark}</div>}</td><td className="px-3 py-3 text-[var(--text-primary)]">{item.manual.manufacturer} · {item.manual.model}{item.manual.generation ? ` · ${item.manual.generation}` : ''}<div className="mt-1 text-[10px] text-[var(--text-muted)]">{item.manual.model_code || 'Generation/code not recorded'}</div></td><td className="px-3 py-3 text-[var(--text-primary)]">{item.figureLabel}<div className="mt-1 text-[10px] text-[var(--text-muted)]">Figure page {item.figurePage || 'not linked'} · index {item.row.index_no || item.row.parent_index || '—'}{item.row.parent_index ? ` · variant of ${item.row.parent_index}` : ''}</div></td><td className="px-3 py-3 text-[var(--text-primary)]">{item.manual.source_file_name || 'Saved OEM catalog'}<div className="mt-1 text-[10px] text-[var(--text-muted)]">{(item.manual.model_year_from || item.manual.model_year_to) ? `Model years ${item.manual.model_year_from || '—'}–${item.manual.model_year_to || '—'} · ` : ''}{(item.manual.chassis_from || item.manual.chassis_to) ? `Serial ${item.manual.chassis_from || '—'}–${item.manual.chassis_to || '—'} · ` : ''}List PDF p. {item.row.source_pdf_page || '—'} · printed p. {item.row.printed_page || '—'} · asset {item.assetNo || 'not linked'} · applicability needs source verification</div></td><td className="px-3 py-3"><label><span className="sr-only">Requested quantity for {item.row.part_no}</span><input aria-label={`Requested quantity for ${item.row.part_no}`} type="number" min="1" step="1" value={item.requestedQty} onChange={(event) => updateRequestedQty(item.key, event.target.value)} className="min-h-9 w-20 rounded-lg border border-[var(--input-border)] bg-[var(--panel)] px-2 text-[var(--text-primary)]"/></label><div className="mt-1 text-[10px] text-[var(--text-muted)]">OEM qty: {item.row.quantity ?? '—'}</div></td><td className="px-3 py-3"><button type="button" aria-label={`Remove ${item.row.part_no} from selected parts`} onClick={() => setSelectedParts((current) => current.filter((row) => row.key !== item.key))} className="grid min-h-9 min-w-9 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-300"><X size={15}/></button></td></tr>)}</tbody></table></div> : <div className="grid min-h-52 place-items-center rounded-lg border border-dashed border-[var(--input-border)] p-6 text-center"><div><PackagePlus size={28} className="mx-auto text-emerald-400"/><h3 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">No parts selected yet</h3><p className="mt-1 max-w-md text-xs text-[var(--text-muted)]">Browse an illustration, select “Add” beside each OEM row, then continue through other assemblies. Your list stays here while you browse.</p><button type="button" onClick={() => switchTab('browse')} className={`${BUTTON} mt-3`}>Browse catalogs</button></div></div>}
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
          {selectedAsset ? <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"><span className="truncate text-sm text-[var(--text-primary)]">{searchableAssetResult(selectedAsset)}</span><button type="button" className="text-xs text-emerald-400" onClick={() => { setSelectedAsset(null); setAssetQuery('') }}>Clear</button></div> : matchingAssets.length > 0 ? <div className="overflow-hidden rounded-lg border border-[var(--input-border)]">{matchingAssets.map((asset) => <button type="button" key={asset.id} onClick={() => applyAssetFitment(asset)} className="block min-h-11 w-full border-b border-[var(--input-border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--panel-2)]">{searchableAssetResult(asset)}</button>)}</div> : <p className="self-center text-xs text-[var(--text-muted)]">No matching fleet vehicle. Enter another identifier.</p>}
        </div>}
        {selectedAsset && <p className="text-xs text-[var(--text-muted)]">{manualsForAsset.length ? `${manualsForAsset.length} manual${manualsForAsset.length === 1 ? '' : 's'} match this vehicle’s make and model.` : 'No saved manual matches this vehicle’s make and model yet.'}</p>}
      </Card>

      <Card pad="none" className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--input-border)] px-4 py-3"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">OEM parts master</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{query.trim().length >= 2 ? `${entries.length} result${entries.length === 1 ? '' : 's'} shown` : `${manuals.reduce((sum, m) => sum + (m.item_count || 0), 0).toLocaleString()} searchable entries across ${manuals.length} manuals`}</p></div>{catalogLoading && <Loader2 size={17} className="animate-spin text-emerald-500"/>}</div>
        {loading ? <div className="grid min-h-40 place-items-center text-sm text-[var(--text-muted)]"><Loader2 className="animate-spin" size={20}/></div> : entries.length ? <div className="overflow-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-[var(--panel-2)] text-[var(--text-muted)]"><tr>{['OEM brand / model','Part number','Description / assembly','Index','Qty','PDF pages'].map((h) => <th key={h} className="px-3 py-3 font-semibold">{h}</th>)}<th className="px-3 py-3">Actions</th></tr></thead><tbody>{entries.map((row) => {const inBasket=selectedParts.some((item) => item.key === `${row.manual_id}:${row.id}`);return <tr key={row.id} className="border-t border-[var(--input-border)]"><td className="px-3 py-3"><div className="font-medium text-[var(--text-primary)]">{row.manual?.manufacturer} {row.manual?.model}</div><div className="mt-1 text-[var(--text-muted)]">{row.manual?.equipment_no || row.manual?.model_code || 'Equipment ID not recorded'}</div></td><td className="px-3 py-3 font-mono font-semibold text-emerald-400">{row.part_no}</td><td className="max-w-[380px] whitespace-normal px-3 py-3"><div className="text-[var(--text-primary)]">{row.description}</div>{row.assembly_heading && <div className="mt-1 text-[var(--text-muted)]">{row.assembly_heading}</div>}{row.remark && <div className="mt-1 text-[var(--text-muted)]">Variant: {row.remark}</div>}</td><td className="px-3 py-3 text-[var(--text-primary)]">{row.index_no || row.parent_index || '—'}{row.parent_index ? <span className="text-[var(--text-muted)]"> · variant</span> : ''}</td><td className="px-3 py-3 tabular-nums text-[var(--text-primary)]">{row.quantity ?? '—'}</td><td className="px-3 py-3 text-[var(--text-secondary)]">{row.illustration_pdf_page ? `Drawing ${row.illustration_pdf_page}` : `List ${row.source_pdf_page}`}{row.see_page ? ` · ${row.see_page}` : ''}</td><td className="px-3 py-3"><div className="flex gap-2"><button className={`${BUTTON} min-h-9 text-xs`} onClick={() => browseFromPart(row)}><Search size={14}/>{row.illustration_pdf_page ? 'View figure' : 'Show entry'}</button><button type="button" disabled={inBasket} onClick={() => addPartToSelection(row, row.manual, { label: row.assembly_heading || 'Figure not linked', page: row.illustration_pdf_page, rows: [row], sourcePages: [row.source_pdf_page] })} className="min-h-9 rounded-lg border border-emerald-500/30 px-2 text-xs font-semibold text-emerald-400 disabled:opacity-60">{inBasket ? 'Added' : '＋ Add'}</button></div></td></tr>})}</tbody></table></div> : <div className="grid min-h-48 place-items-center px-5 text-center"><div><FileSearch size={24} className="mx-auto text-[var(--text-muted)]"/><p className="mt-3 text-sm font-medium text-[var(--text-primary)]">{manuals.length ? 'Search by any part number to find it in the OEM manuals' : 'No OEM manuals saved yet'}</p><p className="mt-1 text-xs text-[var(--text-muted)]">Upload a PDF once. Tyre Pulse stores its parts rows and private source document for future searches.</p>{!manuals.length && <button type="button" onClick={() => switchTab('import')} className={`${BUTTON} mt-4`}><Upload size={15}/>Import first manual</button>}</div></div>}
      </Card>
    </div>}

    {tab === 'manuals' && <Card pad="none" className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--input-border)] px-4 py-3"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Saved OEM manuals</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Each PDF is stored once. Its extracted rows remain available in the master search.</p></div><button type="button" onClick={() => switchTab('import')} className={BUTTON}><Upload size={15}/>Import PDF</button></div>
      {catalogLoading ? <div className="grid min-h-40 place-items-center"><Loader2 className="animate-spin text-emerald-500"/></div> : manuals.length ? <div className="divide-y divide-[var(--input-border)]">{manuals.map((manual) => <div key={manual.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4"><div><div className="font-semibold text-[var(--text-primary)]">{manual.manufacturer} · {manual.model}{manual.generation ? ` · ${manual.generation}` : ''}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{[manual.model_code && `Model code ${manual.model_code}`, (manual.model_year_from || manual.model_year_to) && `Years ${manual.model_year_from || '—'}–${manual.model_year_to || '—'}`,manual.equipment_no && `Equipment ${manual.equipment_no}`,manual.chassis_from && `Chassis ${manual.chassis_from}${manual.chassis_to ? `–${manual.chassis_to}` : ''}`].filter(Boolean).join(' · ') || manual.source_file_name}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{manual.item_count.toLocaleString()} entries · {manual.page_count} PDF pages · {manual.extraction_status.replace('_',' ')}</div></div><div className="flex min-w-0 items-center gap-3"><span className="max-w-[280px] truncate text-xs text-[var(--text-muted)]">{manual.source_file_name}</span><button type="button" onClick={() => { switchTab('browse'); selectBrowseManual(manual) }} className={`${BUTTON} min-h-9 text-xs`}><BookOpen size={14}/>Browse this catalog</button></div></div>)}</div> : <div className="p-8 text-center text-sm text-[var(--text-muted)]">No manuals imported.</div>}
    </Card>}

    {tab === 'import' && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
      <Card className="space-y-4">
        <div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Upload and extract the OEM catalog</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Download a catalog you’re authorized to use, then select its PDF here. Tyre Pulse extracts the parts rows and saves the source PDF privately for its illustrations.</p></div>
        <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] p-3"><div className="text-xs font-semibold text-[var(--text-primary)]">Official catalog sources to check</div><p className="mt-1 text-[11px] text-[var(--text-muted)]">Availability and download rights vary by brand. Some portals show diagrams online but do not provide a downloadable full catalog.</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs"><a className="text-emerald-400 underline" href="https://www.cat.com/en_US/support/maintenance/parts-reference-guides.html" target="_blank" rel="noreferrer">Cat free parts guides</a><a className="text-emerald-400 underline" href="https://www.cat.com/sis2go" target="_blank" rel="noreferrer">Cat SIS2GO</a><a className="text-emerald-400 underline" href="https://www.bobcat.com/na/en/parts-service/parts-catalog" target="_blank" rel="noreferrer">Bobcat official catalog</a><a className="text-emerald-400 underline" href="https://www.hitachicm.com/global/en/products/parts-service/parts/selected-parts/" target="_blank" rel="noreferrer">Hitachi selected parts PDFs</a><a className="text-emerald-400 underline" href="https://www.sanyglobal.com/mysany/" target="_blank" rel="noreferrer">SANY MySANY parts access</a></div></div>
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 p-5 text-center hover:bg-emerald-500/10"><input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => selectPdf(e.target.files?.[0])}/><Upload size={22} className="text-emerald-400"/><span className="mt-2 text-sm font-medium text-[var(--text-primary)]">{pdfFile?.name || 'Choose OEM PDF'}</span><span className="mt-1 text-xs text-[var(--text-muted)]">PDF up to 100 MB</span></label>
        {extractProgress && !extraction && <div className="rounded-lg border border-[var(--input-border)] p-3 text-sm text-[var(--text-secondary)]" role="status">{extractProgress.pageNumber === 0 ? 'Opening PDF…' : `Reading page ${extractProgress.pageNumber} of ${extractProgress.pageCount} · ${extractProgress.rowCount} rows found`}<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${extractProgress.pageCount ? Math.round(100 * extractProgress.pageNumber / extractProgress.pageCount) : 4}%` }}/></div></div>}
        {pdfError && <p className="text-sm text-red-300" role="alert">{pdfError}</p>}
        {extraction && <>
          <div className="grid grid-cols-3 gap-2"><div className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{extraction.rows.length.toLocaleString()}</div><div className="text-[11px] text-[var(--text-muted)]">Part and variant rows</div></div><div className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{extraction.parsedPages.length}</div><div className="text-[11px] text-[var(--text-muted)]">Parts-list pages</div></div><div className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{extraction.reviewPages.length}</div><div className="text-[11px] text-[var(--text-muted)]">Unparsed parts-table pages</div></div></div>
          {extraction.reviewPages.length > 0 && <p className="text-xs text-amber-300">Pages {extraction.reviewPages.join(', ')} contain parts-table headings but no extracted rows. Review those pages before saving to avoid missing entries.</p>}
          {extraction.imageOnlyPages.length > 0 && <p className="text-xs text-[var(--text-muted)]">{extraction.imageOnlyPages.length} image-only pages are retained in the source PDF. Check whether any are scanned parts lists.</p>}
          <div className="overflow-auto rounded-lg border border-[var(--input-border)]"><table className="w-full min-w-[600px] text-left text-xs"><thead className="bg-[var(--panel-2)] text-[var(--text-muted)]"><tr><th className="px-3 py-2">PDF page</th><th className="px-3 py-2">Index</th><th className="px-3 py-2">Part number</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Qty</th></tr></thead><tbody>{extraction.rows.slice(0, 8).map((row, index) => <tr key={`${row.source_pdf_page}-${row.row_order}-${index}`} className="border-t border-[var(--input-border)]"><td className="px-3 py-2">{row.source_pdf_page}</td><td className="px-3 py-2">{row.index_no || '—'}</td><td className="px-3 py-2 font-mono text-emerald-400">{row.part_no}</td><td className="max-w-[240px] whitespace-normal px-3 py-2">{row.description}{row.remark ? ` · ${row.remark}` : ''}</td><td className="px-3 py-2">{row.quantity ?? '—'}</td></tr>)}</tbody></table></div>
        </>}
      </Card>

      <Card className="space-y-4">
        <div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Identify model and fitment</h2><p className="mt-1 text-xs text-[var(--text-muted)]">These details let users find the right manual from a fleet vehicle or chassis number.</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="OEM brand" required value={manualForm.manufacturer} onChange={(v) => setManualForm((f) => ({ ...f, manufacturer: v }))} placeholder="For example, SANY"/><Field label="Model" required value={manualForm.model} onChange={(v) => setManualForm((f) => ({ ...f, model: v }))} placeholder="Model printed by OEM"/><Field label="Generation / series" value={manualForm.generation} onChange={(v) => setManualForm((f) => ({ ...f, generation: v }))} placeholder="For example, Gen 2 / Series B"/><Field label="Model code" value={manualForm.modelCode} onChange={(v) => setManualForm((f) => ({ ...f, modelCode: v }))} placeholder="OEM code / variant"/><Field label="Equipment / serial number" value={manualForm.equipmentNo} onChange={(v) => setManualForm((f) => ({ ...f, equipmentNo: v }))} placeholder="Manual number or chassis ID"/></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Model year from" value={manualForm.modelYearFrom} onChange={(v) => setManualForm((f) => ({ ...f, modelYearFrom: v.replace(/\D/g, '').slice(0, 4) }))} placeholder="Optional"/><Field label="Model year to" value={manualForm.modelYearTo} onChange={(v) => setManualForm((f) => ({ ...f, modelYearTo: v.replace(/\D/g, '').slice(0, 4) }))} placeholder="Optional"/></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Chassis / serial from" value={manualForm.chassisFrom} onChange={(v) => setManualForm((f) => ({ ...f, chassisFrom: v }))} placeholder="Optional range start"/><Field label="Chassis / serial to" value={manualForm.chassisTo} onChange={(v) => setManualForm((f) => ({ ...f, chassisTo: v }))} placeholder="Optional range end"/></div>
        <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] p-3"><div className="text-xs font-semibold text-[var(--text-primary)]">Match to a fleet vehicle</div><div className="mt-2 flex gap-2"><input value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} onFocus={() => { if (!assetRows.length) searchAssets() }} className={INPUT} placeholder="Search chassis, VIN, asset no."/><button type="button" className={BUTTON} onClick={searchAssets} disabled={assetsLoading}><Search size={14}/></button></div>{matchingAssets.length > 0 && <div className="mt-2 divide-y divide-[var(--input-border)] overflow-hidden rounded-lg border border-[var(--input-border)]">{matchingAssets.map((asset) => <button type="button" key={asset.id} className="block min-h-10 w-full px-3 py-2 text-left text-xs hover:bg-[var(--panel)]" onClick={() => applyAssetFitment(asset)}>{searchableAssetResult(asset)}</button>)}</div>}{selectedAsset && <p className="mt-2 text-xs text-emerald-300">Fitment linked to {selectedAsset.asset_no}. Brand and model filled from the live fleet register.</p>}</div>
        {saveError && <p className="text-sm text-red-300" role="alert">{saveError}</p>}
        <button type="button" className="btn-primary inline-flex min-h-11 w-full items-center justify-center gap-2" disabled={!extraction?.rows?.length || saving} onClick={saveCatalog}>{saving ? <><Loader2 size={16} className="animate-spin"/>Saving PDF and {extraction?.rows?.length.toLocaleString()} rows…</> : <><CheckCircle2 size={16}/>Save to OEM master catalog</>}</button>
        <p className="text-[11px] leading-5 text-[var(--text-muted)]">This adds searchable OEM reference records only. It does not add stock, prices or purchase quantities to the inventory catalog.</p>
      </Card>
    </div>}

    <Modal open={requestModalOpen} onClose={() => !requestSaving && setRequestModalOpen(false)} title={`Add ${selectedParts.length} OEM part${selectedParts.length === 1 ? '' : 's'} to Parts Requests`} size="lg" footer={<div className="flex justify-end gap-2"><button type="button" disabled={requestSaving} onClick={() => setRequestModalOpen(false)} className="btn-secondary min-h-10 px-4 text-sm">Cancel</button><button type="submit" form="oem-parts-request-form" disabled={requestSaving || !selectedParts.length} className="btn-primary inline-flex min-h-10 items-center gap-2 px-4 text-sm disabled:opacity-50">{requestSaving ? <Loader2 size={15} className="animate-spin"/> : <PackagePlus size={15}/>}Create part requests</button></div>}>
      <form id="oem-parts-request-form" onSubmit={submitSelectedParts} className="space-y-4">
        <p className="text-xs text-[var(--text-muted)]">Each selected OEM part becomes its own Parts Request row. Full catalog, figure, callout and source references are saved in the request notes. OEM reference data will not change stock or inventory.</p>
        <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] p-3"><div className="mb-2 text-xs font-semibold text-[var(--text-primary)]">Selected lines ({selectedParts.length})</div><div className="max-h-40 space-y-2 overflow-auto">{selectedParts.map((item) => <div key={item.key} className="flex items-start justify-between gap-3 text-xs"><span><b className="font-mono text-emerald-400">{item.row.part_no}</b><span className="ml-2 text-[var(--text-primary)]">{item.row.description}</span><span className="block text-[10px] text-[var(--text-muted)]">{item.manual.manufacturer} {item.manual.model} · {item.figureLabel} · index {item.row.index_no || item.row.parent_index || '—'}</span></span><span className="shrink-0 text-[var(--text-secondary)]">Qty {item.requestedQty}</span></div>)}</div></div>
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
