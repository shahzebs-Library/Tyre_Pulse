import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowLeft, BookOpen, CheckCircle2, FileSearch,
  FileText, Loader2, Search, Upload, X,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import { useSettings } from '../contexts/SettingsContext'
import { listAssets } from '../lib/api/assets'
import { findOemManualByHash, getOemPdfSignedUrl, listOemManuals, saveOemManual, searchOemEntries } from '../lib/api/oemPartsCatalog'
import { extractOemIdentity, extractOemPartsDocument } from '../lib/oemPartsExtractor'
import { toUserMessage } from '../lib/safeError'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const INPUT = 'input min-h-[44px] w-full'
const BUTTON = 'btn-secondary inline-flex min-h-[42px] items-center justify-center gap-2 px-3 text-sm'
const assetText = (asset) => [asset.asset_no, asset.fleet_number, asset.make, asset.model, asset.vehicle_type, asset.registration_no, asset.chassis_no, asset.serial_no, asset.engine_no, asset.site, asset.country].filter(Boolean).join(' ').toLowerCase()

function Field({ label, value, onChange, placeholder, required = false }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}{required ? ' *' : ''}</span><input required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={INPUT} /></label>
}

function OemPdfSheet({ pdfDoc, pageNo, title }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef(null)
  const hostRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    let task
    async function draw() {
      if (!pdfDoc || !canvasRef.current || !hostRef.current) return
      setBusy(true); setError('')
      try {
        const page = await pdfDoc.getPage(pageNo)
        const natural = page.getViewport({ scale: 1 })
        const scale = Math.min(1.5, Math.max(0.3, (hostRef.current.clientWidth - 32) / natural.width))
        const viewport = page.getViewport({ scale })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const canvas = canvasRef.current
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] })
        await task.promise
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException' && !cancelled) setError(toUserMessage(err, 'This PDF page could not be displayed.'))
      } finally { if (!cancelled) setBusy(false) }
    }
    draw()
    return () => { cancelled = true; task?.cancel() }
  }, [pdfDoc, pageNo])
  if (!pdfDoc) return null
  return <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-900">
    <div className="flex min-h-11 items-center justify-between gap-2 border-b border-white/10 px-3"><span className="truncate text-xs font-semibold text-white">{title} · PDF page {pageNo}</span>{busy && <Loader2 className="animate-spin text-yellow-400" size={14}/>}</div>
    <div ref={hostRef} className="min-h-0 flex-1 overflow-auto p-3"><div className="mx-auto grid min-h-full place-items-start justify-center"><canvas ref={canvasRef} className="max-w-none bg-white shadow-xl"/>{error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}</div></div>
  </div>
}

function PageCanvas({ pdfDoc, entry, onClose }) {
  if (!pdfDoc) return null
  const drawingPage = entry.illustration_pdf_page || null
  return <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950/95" role="dialog" aria-modal="true" aria-label="OEM illustration and indexed parts list">
    <div className="flex min-h-16 items-center justify-between gap-3 border-b border-white/10 px-4">
      <div className="min-w-0"><div className="truncate text-sm font-semibold text-white">{entry.manual?.manufacturer} {entry.manual?.model} · {entry.part_no}</div><div className="mt-0.5 truncate text-xs text-slate-400">Index {entry.index_no || entry.parent_index || '—'} · {entry.description}</div></div>
      <button className={BUTTON} onClick={onClose} aria-label="Close manual"><X size={17}/>Close</button>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 lg:grid-cols-2 lg:p-4">
      {drawingPage ? <OemPdfSheet pdfDoc={pdfDoc} pageNo={drawingPage} title={`Illustration ${entry.see_page || ''}`}/> : <div className="grid min-h-64 place-items-center rounded-xl border border-white/10 bg-slate-900 p-5 text-center text-sm text-slate-300">No printed drawing-page reference was found for this item. The source parts-list page is shown beside this panel.</div>}
      <OemPdfSheet pdfDoc={pdfDoc} pageNo={entry.source_pdf_page} title="Indexed parts list"/>
    </div>
  </div>
}

function searchableAssetResult(asset) {
  return `${asset.asset_no || asset.fleet_number || 'Asset'} · ${[asset.make, asset.model].filter(Boolean).join(' ')} · Chassis ${asset.chassis_no || asset.serial_no || 'not recorded'}`
}

function normalizeManualForAsset(manual, asset) {
  if (!asset) return true
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
  if (!same(manual.manufacturer, asset.make) || !same(manual.model, asset.model)) return false
  const serial = String(asset.chassis_no || asset.serial_no || '').trim().toUpperCase()
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
  const [tab, setTab] = useState('lookup')
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
  const [viewer, setViewer] = useState(null)
  const [viewPdfDoc, setViewPdfDoc] = useState(null)
  const [manualForm, setManualForm] = useState({ manufacturer: '', model: '', modelCode: '', equipmentNo: '', chassisFrom: '', chassisTo: '' })
  const fileRef = useRef(null)

  const refreshManuals = useCallback(async () => {
    setCatalogLoading(true)
    setPageError('')
    try { setManuals(await listOemManuals(activeCountry)) }
    catch (error) { setPageError(toUserMessage(error, 'Could not load the OEM master catalog.')) }
    finally { setCatalogLoading(false) }
  }, [activeCountry])
  useEffect(() => { refreshManuals() }, [refreshManuals])
  useEffect(() => () => { if (pdfDoc) pdfDoc.destroy() }, [pdfDoc])
  useEffect(() => () => { if (viewPdfDoc) viewPdfDoc.destroy() }, [viewPdfDoc])

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
    setManualForm({ manufacturer: '', model: '', modelCode: '', equipmentNo: '', chassisFrom: '', chassisTo: '' })
    if (fileRef.current) fileRef.current.value = ''
  }

  const selectPdf = async (file) => {
    if (!file) return
    resetImport()
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setPdfError('Select an OEM parts catalog PDF.'); return }
    if (file.size > 50 * 1024 * 1024) { setPdfError('This PDF is larger than the 50 MB catalog limit.'); return }
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
        setTab('lookup')
        return
      }
      const country = activeCountry && activeCountry !== 'All' ? activeCountry : null
      const saved = await saveOemManual({
        id: existing?.id || crypto.randomUUID(), resume: Boolean(existing), file: pdfFile, sha256: hash, country,
        manufacturer: manualForm.manufacturer, model: manualForm.model, modelCode: manualForm.modelCode,
        equipmentNo: manualForm.equipmentNo, chassisFrom: manualForm.chassisFrom, chassisTo: manualForm.chassisTo,
        pageCount: extraction.pageCount, rows: extraction.rows,
        summary: { parsedPages: extraction.parsedPages, skippedPages: extraction.skippedPages, reviewPages: extraction.reviewPages, imageOnlyPages: extraction.imageOnlyPages },
      })
      await refreshManuals()
      setSaveNotice(`${saved.manufacturer} ${saved.model}: ${saved.item_count.toLocaleString()} parts and variants saved. The PDF is stored once for future lookups.`)
      setTab('lookup'); setManualFilter(saved.id); setQuery(extraction.rows[0]?.part_no || '')
    } catch (error) { setSaveError(toUserMessage(error, 'Could not save the OEM manual.')) }
    finally { setSaving(false) }
  }

  const openManual = async (entry) => {
    setViewer(entry); setViewPdfDoc(null)
    try {
      const url = await getOemPdfSignedUrl(entry.manual_id)
      const doc = await pdfjsLib.getDocument({ url }).promise
      setViewPdfDoc(doc)
    } catch (error) { setPageError(toUserMessage(error, 'Could not open this stored OEM manual.')); setViewer(null) }
  }

  const switchTab = (value) => { setTab(value); setPageError(''); setSaveError('') }

  return <div className="space-y-5">
    <PageHeader title="OEM Illustrated Parts Catalog" subtitle="Upload each OEM manual once, search its parts by number, and open the original illustration linked to the parts list." icon={BookOpen} actions={<Link to="/parts-catalog" className={BUTTON}><ArrowLeft size={15}/>Inventory catalog</Link>} />

    <div className="flex flex-wrap gap-2 border-b border-[var(--input-border)] pb-3" role="tablist" aria-label="OEM catalog sections">
      {[['lookup','Search master'],['manuals','Manuals'],['import','Import PDF']].map(([key,label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => switchTab(key)} className={`min-h-[40px] rounded-lg px-4 text-sm font-medium ${tab === key ? 'bg-yellow-400 text-slate-950' : 'text-[var(--text-secondary)] hover:bg-[var(--panel-2)]'}`}>{label}</button>)}
    </div>

    {pageError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{pageError}</div>}
    {saveNotice && <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200" role="status"><CheckCircle2 size={17} className="mt-0.5 shrink-0"/>{saveNotice}</div>}

    {tab === 'lookup' && <div className="space-y-4">
      <Card className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Search part number or description</span><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/><input value={query} onChange={(e) => setQuery(e.target.value)} className={`${INPUT} pl-10`} placeholder="Enter a part number, assembly or description" aria-label="Search OEM parts"/></div></label>
          <label className="block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Manual / model</span><select value={manualFilter} onChange={(e) => setManualFilter(e.target.value)} className={INPUT}><option value="all">All saved manuals</option>{manuals.map((m) => <option key={m.id} value={m.id}>{m.manufacturer} · {m.model} · {m.equipment_no || m.model_code || m.source_file_name}</option>)}</select></label>
          <button type="button" onClick={searchAssets} className={BUTTON} disabled={assetsLoading}><Search size={15}/>{assetsLoading ? 'Loading fleet…' : 'Find vehicle by chassis'}</button>
        </div>
        {assetRows.length > 0 && <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
          <input value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} className={INPUT} placeholder="Type chassis / VIN / asset no." aria-label="Search fleet chassis and VIN"/>
          {selectedAsset ? <div className="flex items-center justify-between gap-2 rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-3"><span className="truncate text-sm text-[var(--text-primary)]">{searchableAssetResult(selectedAsset)}</span><button type="button" className="text-xs text-yellow-300" onClick={() => { setSelectedAsset(null); setAssetQuery('') }}>Clear</button></div> : matchingAssets.length > 0 ? <div className="overflow-hidden rounded-lg border border-[var(--input-border)]">{matchingAssets.map((asset) => <button type="button" key={asset.id} onClick={() => applyAssetFitment(asset)} className="block min-h-11 w-full border-b border-[var(--input-border)] px-3 py-2 text-left text-sm last:border-0 hover:bg-[var(--panel-2)]">{searchableAssetResult(asset)}</button>)}</div> : <p className="self-center text-xs text-[var(--text-muted)]">No matching fleet vehicle. Enter another identifier.</p>}
        </div>}
        {selectedAsset && <p className="text-xs text-[var(--text-muted)]">{manualsForAsset.length ? `${manualsForAsset.length} manual${manualsForAsset.length === 1 ? '' : 's'} match this vehicle’s make and model.` : 'No saved manual matches this vehicle’s make and model yet.'}</p>}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--input-border)] px-4 py-3"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">OEM parts master</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{query.trim().length >= 2 ? `${entries.length} result${entries.length === 1 ? '' : 's'} shown` : `${manuals.reduce((sum, m) => sum + (m.item_count || 0), 0).toLocaleString()} searchable entries across ${manuals.length} manuals`}</p></div>{catalogLoading && <Loader2 size={17} className="animate-spin text-yellow-400"/>}</div>
        {loading ? <div className="grid min-h-40 place-items-center text-sm text-[var(--text-muted)]"><Loader2 className="animate-spin" size={20}/></div> : entries.length ? <div className="overflow-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-[var(--panel-2)] text-[var(--text-muted)]"><tr>{['OEM brand / model','Part number','Description / assembly','Index','Qty','PDF pages'].map((h) => <th key={h} className="px-3 py-3 font-semibold">{h}</th>)}<th className="px-3 py-3">Manual</th></tr></thead><tbody>{entries.map((row) => <tr key={row.id} className="border-t border-[var(--input-border)]"><td className="px-3 py-3"><div className="font-medium text-[var(--text-primary)]">{row.manual?.manufacturer} {row.manual?.model}</div><div className="mt-1 text-[var(--text-muted)]">{row.manual?.equipment_no || row.manual?.model_code || 'Equipment ID not recorded'}</div></td><td className="px-3 py-3 font-mono font-semibold text-yellow-300">{row.part_no}</td><td className="max-w-[380px] whitespace-normal px-3 py-3"><div className="text-[var(--text-primary)]">{row.description}</div>{row.assembly_heading && <div className="mt-1 text-[var(--text-muted)]">{row.assembly_heading}</div>}{row.remark && <div className="mt-1 text-[var(--text-muted)]">Variant: {row.remark}</div>}</td><td className="px-3 py-3 text-[var(--text-primary)]">{row.index_no || row.parent_index || '—'}{row.parent_index ? <span className="text-[var(--text-muted)]"> · variant</span> : ''}</td><td className="px-3 py-3 tabular-nums text-[var(--text-primary)]">{row.quantity ?? '—'}</td><td className="px-3 py-3 text-[var(--text-secondary)]">{row.illustration_pdf_page ? `Drawing ${row.illustration_pdf_page}` : `List ${row.source_pdf_page}`}{row.see_page ? ` · ${row.see_page}` : ''}</td><td className="px-3 py-3"><button className={`${BUTTON} min-h-9 text-xs`} onClick={() => openManual(row)}><FileText size={14}/>{row.illustration_pdf_page ? 'View illustration' : 'Open source page'}</button></td></tr>)}</tbody></table></div> : <div className="grid min-h-48 place-items-center px-5 text-center"><div><FileSearch size={24} className="mx-auto text-[var(--text-muted)]"/><p className="mt-3 text-sm font-medium text-[var(--text-primary)]">{manuals.length ? 'Search by any part number to find it in the OEM manuals' : 'No OEM manuals saved yet'}</p><p className="mt-1 text-xs text-[var(--text-muted)]">Upload a PDF once. Tyre Pulse stores its parts rows and private source document for future searches.</p>{!manuals.length && <button type="button" onClick={() => switchTab('import')} className={`${BUTTON} mt-4`}><Upload size={15}/>Import first manual</button>}</div></div>}
      </Card>
    </div>}

    {tab === 'manuals' && <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-[var(--input-border)] px-4 py-3"><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Saved OEM manuals</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Each PDF is stored once. Its extracted rows remain available in the master search.</p></div><button type="button" onClick={() => switchTab('import')} className={BUTTON}><Upload size={15}/>Import PDF</button></div>
      {catalogLoading ? <div className="grid min-h-40 place-items-center"><Loader2 className="animate-spin text-yellow-400"/></div> : manuals.length ? <div className="divide-y divide-[var(--input-border)]">{manuals.map((manual) => <div key={manual.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4"><div><div className="font-semibold text-[var(--text-primary)]">{manual.manufacturer} · {manual.model}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{[manual.model_code && `Model code ${manual.model_code}`,manual.equipment_no && `Equipment ${manual.equipment_no}`,manual.chassis_from && `Chassis ${manual.chassis_from}${manual.chassis_to ? `–${manual.chassis_to}` : ''}`].filter(Boolean).join(' · ') || manual.source_file_name}</div><div className="mt-1 text-xs text-[var(--text-muted)]">{manual.item_count.toLocaleString()} entries · {manual.page_count} PDF pages · {manual.extraction_status.replace('_',' ')}</div></div><span className="max-w-[280px] truncate text-xs text-[var(--text-muted)]">{manual.source_file_name}</span></div>)}</div> : <div className="p-8 text-center text-sm text-[var(--text-muted)]">No manuals imported.</div>}
    </Card>}

    {tab === 'import' && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
      <Card className="space-y-4">
        <div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Upload and extract the OEM catalog</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Choose the manual once. Tyre Pulse scans every PDF page, keeps all part and variant rows, and saves the original PDF privately for its illustrations.</p></div>
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-yellow-400/40 bg-yellow-400/5 p-5 text-center hover:bg-yellow-400/10"><input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => selectPdf(e.target.files?.[0])}/><Upload size={22} className="text-yellow-300"/><span className="mt-2 text-sm font-medium text-[var(--text-primary)]">{pdfFile?.name || 'Choose OEM PDF'}</span><span className="mt-1 text-xs text-[var(--text-muted)]">PDF up to 50 MB</span></label>
        {extractProgress && !extraction && <div className="rounded-lg border border-[var(--input-border)] p-3 text-sm text-[var(--text-secondary)]" role="status">{extractProgress.pageNumber === 0 ? 'Opening PDF…' : `Reading page ${extractProgress.pageNumber} of ${extractProgress.pageCount} · ${extractProgress.rowCount} rows found`}<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full bg-yellow-400 transition-all" style={{ width: `${extractProgress.pageCount ? Math.round(100 * extractProgress.pageNumber / extractProgress.pageCount) : 4}%` }}/></div></div>}
        {pdfError && <p className="text-sm text-red-300" role="alert">{pdfError}</p>}
        {extraction && <>
          <div className="grid grid-cols-3 gap-2"><div className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{extraction.rows.length.toLocaleString()}</div><div className="text-[11px] text-[var(--text-muted)]">Part and variant rows</div></div><div className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{extraction.parsedPages.length}</div><div className="text-[11px] text-[var(--text-muted)]">Parts-list pages</div></div><div className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-lg font-bold text-[var(--text-primary)]">{extraction.reviewPages.length}</div><div className="text-[11px] text-[var(--text-muted)]">Unparsed parts-table pages</div></div></div>
          {extraction.reviewPages.length > 0 && <p className="text-xs text-amber-300">Pages {extraction.reviewPages.join(', ')} contain parts-table headings but no extracted rows. Review those pages before saving to avoid missing entries.</p>}
          {extraction.imageOnlyPages.length > 0 && <p className="text-xs text-[var(--text-muted)]">{extraction.imageOnlyPages.length} image-only pages are retained in the source PDF. Check whether any are scanned parts lists.</p>}
          <div className="overflow-auto rounded-lg border border-[var(--input-border)]"><table className="w-full min-w-[600px] text-left text-xs"><thead className="bg-[var(--panel-2)] text-[var(--text-muted)]"><tr><th className="px-3 py-2">PDF page</th><th className="px-3 py-2">Index</th><th className="px-3 py-2">Part number</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Qty</th></tr></thead><tbody>{extraction.rows.slice(0, 8).map((row, index) => <tr key={`${row.source_pdf_page}-${row.row_order}-${index}`} className="border-t border-[var(--input-border)]"><td className="px-3 py-2">{row.source_pdf_page}</td><td className="px-3 py-2">{row.index_no || '—'}</td><td className="px-3 py-2 font-mono text-yellow-300">{row.part_no}</td><td className="max-w-[240px] whitespace-normal px-3 py-2">{row.description}{row.remark ? ` · ${row.remark}` : ''}</td><td className="px-3 py-2">{row.quantity ?? '—'}</td></tr>)}</tbody></table></div>
        </>}
      </Card>

      <Card className="space-y-4">
        <div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Identify model and fitment</h2><p className="mt-1 text-xs text-[var(--text-muted)]">These details let users find the right manual from a fleet vehicle or chassis number.</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="OEM brand" required value={manualForm.manufacturer} onChange={(v) => setManualForm((f) => ({ ...f, manufacturer: v }))} placeholder="For example, SANY"/><Field label="Model" required value={manualForm.model} onChange={(v) => setManualForm((f) => ({ ...f, model: v }))} placeholder="Model printed by OEM"/><Field label="Model code" value={manualForm.modelCode} onChange={(v) => setManualForm((f) => ({ ...f, modelCode: v }))} placeholder="Optional code"/><Field label="Equipment / serial number" value={manualForm.equipmentNo} onChange={(v) => setManualForm((f) => ({ ...f, equipmentNo: v }))} placeholder="Manual number or chassis ID"/></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Chassis / serial from" value={manualForm.chassisFrom} onChange={(v) => setManualForm((f) => ({ ...f, chassisFrom: v }))} placeholder="Optional range start"/><Field label="Chassis / serial to" value={manualForm.chassisTo} onChange={(v) => setManualForm((f) => ({ ...f, chassisTo: v }))} placeholder="Optional range end"/></div>
        <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] p-3"><div className="text-xs font-semibold text-[var(--text-primary)]">Match to a fleet vehicle</div><div className="mt-2 flex gap-2"><input value={assetQuery} onChange={(e) => setAssetQuery(e.target.value)} onFocus={() => { if (!assetRows.length) searchAssets() }} className={INPUT} placeholder="Search chassis, VIN, asset no."/><button type="button" className={BUTTON} onClick={searchAssets} disabled={assetsLoading}><Search size={14}/></button></div>{matchingAssets.length > 0 && <div className="mt-2 divide-y divide-[var(--input-border)] overflow-hidden rounded-lg border border-[var(--input-border)]">{matchingAssets.map((asset) => <button type="button" key={asset.id} className="block min-h-10 w-full px-3 py-2 text-left text-xs hover:bg-[var(--panel)]" onClick={() => applyAssetFitment(asset)}>{searchableAssetResult(asset)}</button>)}</div>}{selectedAsset && <p className="mt-2 text-xs text-emerald-300">Fitment linked to {selectedAsset.asset_no}. Brand and model filled from the live fleet register.</p>}</div>
        {saveError && <p className="text-sm text-red-300" role="alert">{saveError}</p>}
        <button type="button" className="btn-primary inline-flex min-h-11 w-full items-center justify-center gap-2" disabled={!extraction?.rows?.length || saving} onClick={saveCatalog}>{saving ? <><Loader2 size={16} className="animate-spin"/>Saving PDF and {extraction?.rows?.length.toLocaleString()} rows…</> : <><CheckCircle2 size={16}/>Save to OEM master catalog</>}</button>
        <p className="text-[11px] leading-5 text-[var(--text-muted)]">This adds searchable OEM reference records only. It does not add stock, prices or purchase quantities to the inventory catalog.</p>
      </Card>
    </div>}

    {viewer && viewPdfDoc && <PageCanvas pdfDoc={viewPdfDoc} entry={viewer} onClose={() => { setViewer(null); setViewPdfDoc(null) }}/>}
  </div>
}
