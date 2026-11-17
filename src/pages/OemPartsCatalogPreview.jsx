import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, FileSearch,
  FileText, Maximize2, Search, Upload, ZoomIn, ZoomOut, X,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import { useSettings } from '../contexts/SettingsContext'
import { listAssets } from '../lib/api/assets'
import { toUserMessage } from '../lib/safeError'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function pdfLines(items = []) {
  const lines = []
  for (const item of items) {
    if (!item?.str?.trim()) continue
    const y = Number(item.transform?.[5] || 0)
    const x = Number(item.transform?.[4] || 0)
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < 2.5)
    if (!line) {
      line = { y, items: [] }
      lines.push(line)
    }
    line.items.push({ x, width: Number(item.width || 0), text: item.str })
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const items = line.items.sort((a, b) => a.x - b.x)
      let text = ''
      let right = null
      for (const item of items) {
        const gap = right == null ? 0 : item.x - right
        text += (gap > 18 ? '   ' : gap > 5 ? '  ' : ' ') + item.text
        right = item.x + item.width
      }
      return text.trim()
    })
}

function extractParts(lines) {
  const header = lines.findIndex((line) => /INDEX\s+PART\s*NO\.?/i.test(line))
  if (header < 0) return []
  const rows = []
  let parentIndex = ''
  for (const line of lines.slice(header + 1)) {
    if (/^SY\d{3,}[A-Z0-9/-]*/i.test(line.trim())) break
    const match = line.match(/^\s*(?:(\d{1,3})\s+)?([A-Z0-9][A-Z0-9._/-]{6,})\s+(.+)$/)
    if (!match) continue
    const [, index = '', partNo, tail] = match
    if (!index && !parentIndex) continue
    if (index) parentIndex = index
    const fields = tail.split(/\s{2,}/).map((field) => field.trim()).filter(Boolean)
    let description = fields.shift() || tail.trim()
    let qty = ''
    let seePage = ''
    let remark = ''
    for (const field of fields) {
      if (/^\d+-\d+$/.test(field)) seePage = field
      else if (/^\d+(?:\.\d+)?$/.test(field) && !qty) qty = field
      else remark = [remark, field].filter(Boolean).join(' ')
    }
    // Some PDFs collapse the aligned columns to one space. Recover a trailing
    // quantity and printed page without changing the retained source wording.
    if (!qty) {
      const qtyMatch = description.match(/\s+(\d+(?:\.\d+)?)\s*$/)
      if (qtyMatch) {
        qty = qtyMatch[1]
        description = description.slice(0, qtyMatch.index).trim()
      }
    }
    if (!description) continue
    rows.push({
      key: index ? index + ':' + partNo : parentIndex + ':' + partNo,
      index: index || 'Alt.',
      parentIndex: index ? '' : parentIndex,
      partNo,
      description,
      qty: qty || '—',
      remark,
      seePage,
      source: line,
    })
  }
  return rows
}

function assetSearchText(asset) {
  return [
    asset.asset_no, asset.fleet_number, asset.make, asset.model, asset.vehicle_type,
    asset.registration_no, asset.chassis_no, asset.serial_no, asset.engine_no,
    asset.site, asset.country,
  ].filter(Boolean).join(' ').toLowerCase()
}

function FieldLabel({ children }) {
  return <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)] mb-1.5">{children}</span>
}

export default function OemPartsCatalogPreview() {
  const { activeCountry } = useSettings()
  const [assets, setAssets] = useState([])
  const [assetsLoading, setAssetsLoading] = useState(true)
  const [assetsError, setAssetsError] = useState('')
  const [assetSearch, setAssetSearch] = useState('')
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [pdfError, setPdfError] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [figurePage, setFigurePage] = useState(1)
  const [listPage, setListPage] = useState(2)
  const [pageRows, setPageRows] = useState([])
  const [selectedPartKey, setSelectedPartKey] = useState('')
  const [markers, setMarkers] = useState([])
  const [zoom, setZoom] = useState(1)
  const viewerRef = useRef(null)
  const [fitWidth, setFitWidth] = useState(0)
  const [listPageError, setListPageError] = useState('')
  const fileInputRef = useRef(null)
  const canvasRef = useRef(null)
  const drawingRef = useRef(null)
  const renderTaskRef = useRef(null)
  const pdfUrl = useMemo(() => pdfFile ? URL.createObjectURL(pdfFile) : '', [pdfFile])

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true)
    setAssetsError('')
    try {
      const country = activeCountry && activeCountry !== 'All' ? activeCountry : undefined
      const result = await listAssets({ country })
      setAssets(Array.isArray(result) ? result : [])
    } catch (error) {
      setAssetsError(toUserMessage(error, 'Fleet assets could not be loaded.'))
    } finally {
      setAssetsLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { loadAssets() }, [loadAssets])
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  useEffect(() => {
    if (!pdfFile) {
      setPdfDoc(null)
      setFigurePage(1)
      setListPage(2)
      setPageRows([])
      return
    }
    let cancelled = false
    let loadedDoc
    setPdfLoading(true)
    setPdfError('')
    setPdfDoc(null)
    setMarkers([])
    setPageRows([])
    setSelectedPartKey('')
    pdfFile.arrayBuffer()
      .then((buffer) => pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise)
      .then((doc) => {
        loadedDoc = doc
        if (cancelled) { doc.destroy(); return }
        setPdfDoc(doc)
        setFigurePage(1)
        setListPage(Math.min(2, doc.numPages))
      })
      .catch((error) => {
        if (!cancelled) setPdfError(toUserMessage(error, 'This PDF could not be opened. Try another PDF.'))
      })
      .finally(() => { if (!cancelled) setPdfLoading(false) })
    return () => {
      cancelled = true
      if (loadedDoc) loadedDoc.destroy()
    }
  }, [pdfFile])

  useEffect(() => {
    const node = viewerRef.current
    if (!node) return undefined
    const observer = new ResizeObserver((entries) => setFitWidth(entries[0]?.contentRect?.width || 0))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function renderPage() {
      if (!pdfDoc || !canvasRef.current || !fitWidth || figurePage < 1 || figurePage > pdfDoc.numPages) return
      try {
        renderTaskRef.current?.cancel()
        const page = await pdfDoc.getPage(figurePage)
        if (cancelled) return
        const baseViewport = page.getViewport({ scale: 1 })
        const nextScale = Math.max(0.25, Math.min(2, fitWidth / baseViewport.width)) * zoom
        const viewport = page.getViewport({ scale: nextScale })
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)
        const canvas = canvasRef.current
        const context = canvas.getContext('2d', { alpha: false })
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = viewport.width + 'px'
        canvas.style.height = viewport.height + 'px'
        const task = page.render({ canvasContext: context, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] })
        renderTaskRef.current = task
        await task.promise
      } catch (error) {
        if (error?.name !== 'RenderingCancelledException' && !cancelled) setPdfError(toUserMessage(error, 'This PDF page could not be rendered.'))
      }
    }
    renderPage()
    return () => { cancelled = true; renderTaskRef.current?.cancel() }
  }, [pdfDoc, figurePage, zoom, fitWidth])

  useEffect(() => {
    let cancelled = false
    async function readListPage() {
      if (!pdfDoc) { setPageRows([]); setListPageError(''); return }
      if (!Number.isInteger(listPage) || listPage < 1 || listPage > pdfDoc.numPages) {
        setPageRows([])
        setListPageError('Enter a PDF page number within this document.')
        return
      }
      setListPageError('')
      try {
        const page = await pdfDoc.getPage(listPage)
        const content = await page.getTextContent()
        const lines = pdfLines(content.items)
        const rows = extractParts(lines)
        if (cancelled) return
        setPageRows(rows)
        setSelectedPartKey('')
        if (!rows.length) setListPageError('No indexed parts table was detected on this page. Choose the OEM parts-list page that matches the diagram.')
      } catch (error) {
        if (!cancelled) {
          setPageRows([])
          setListPageError(toUserMessage(error, 'Could not read text from this page.'))
        }
      }
    }
    readListPage()
    return () => { cancelled = true }
  }, [pdfDoc, listPage])

  const matchingAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase()
    if (!query) return []
    return assets.filter((asset) => assetSearchText(asset).includes(query)).slice(0, 8)
  }, [assets, assetSearch])

  const selectedPart = pageRows.find((row) => row.key === selectedPartKey)
  const currentMarkers = markers.filter((marker) => pageRows.some((row) => row.key === marker.key))
  const displayManufacturer = selectedAsset?.make || selectedAsset?.vehicle_type || 'Select a fleet asset'
  const displayModel = selectedAsset?.model || selectedAsset?.vehicle_type || 'Model not recorded'

  const chooseFile = (file) => {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Choose a PDF parts manual.')
      return
    }
    setPdfError('')
    setPdfFile(file)
    setZoom(1)
  }

  const movePage = (kind, delta) => {
    if (!pdfDoc) return
    const setter = kind === 'figure' ? setFigurePage : setListPage
    const current = kind === 'figure' ? figurePage : listPage
    setter(Math.max(1, Math.min(pdfDoc.numPages, Number(current || 1) + delta)))
  }

  const markCallout = (event) => {
    if (!selectedPart) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const x = Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100))
    const y = Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100))
    setMarkers((current) => [
      ...current.filter((marker) => marker.key !== selectedPart.key),
      { key: selectedPart.key, index: selectedPart.index, x, y },
    ])
  }

  const clearFile = () => {
    setPdfFile(null)
    setPdfDoc(null)
    setPdfError('')
    setMarkers([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="OEM Illustrated Parts Preview"
        subtitle="Preview how a machine-specific parts manual can appear beside its indexed parts list."
        icon={BookOpen}
        actions={
          <Link to="/parts-catalog" className="btn-secondary inline-flex min-h-[44px] items-center gap-2 text-sm">
            <ArrowLeft size={15} aria-hidden="true" /> Parts catalog
          </Link>
        }
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Find a fleet machine</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Search the live fleet register by asset number, chassis/VIN, serial number, registration, make or model.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
            <FileSearch size={14} aria-hidden="true" /> Preview only · no records saved
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(280px,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <FieldLabel>Search asset / chassis / VIN</FieldLabel>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input
                value={assetSearch}
                onChange={(event) => { setAssetSearch(event.target.value); setSelectedAsset(null) }}
                className="input min-h-[46px] w-full pl-10"
                placeholder="Type a chassis number, VIN or asset no."
                aria-label="Search fleet by chassis, VIN, serial, registration, make or model"
              />
            </div>
          </div>
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] px-3 py-2.5">
            <FieldLabel>Brand / make</FieldLabel>
            <div className="truncate text-sm font-medium text-[var(--text-primary)]">{displayManufacturer}</div>
          </div>
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] px-3 py-2.5">
            <FieldLabel>Model</FieldLabel>
            <div className="truncate text-sm font-medium text-[var(--text-primary)]">{displayModel}</div>
          </div>
          <div className="rounded-lg border border-[var(--input-border)] bg-[var(--panel-2)] px-3 py-2.5">
            <FieldLabel>Chassis / VIN</FieldLabel>
            <div className="truncate font-mono text-sm text-[var(--text-primary)]">{selectedAsset?.chassis_no || selectedAsset?.serial_no || 'Not recorded'}</div>
          </div>
        </div>

        {assetsLoading && <p className="text-xs text-[var(--text-muted)]" role="status">Loading fleet register…</p>}
        {assetsError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
            <span>{assetsError}</span>
            <button type="button" className="btn-secondary min-h-[40px] text-xs" onClick={loadAssets}>Retry fleet search</button>
          </div>
        )}
        {!assetsLoading && !assetsError && assetSearch.trim() && (
          <div className="overflow-hidden rounded-lg border border-[var(--input-border)]">
            {matchingAssets.length ? matchingAssets.map((asset) => (
              <button
                type="button"
                key={asset.id}
                onClick={() => { setSelectedAsset(asset); setAssetSearch(asset.asset_no || '') }}
                className="flex min-h-[52px] w-full flex-wrap items-center justify-between gap-2 border-b border-[var(--input-border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--panel-2)]"
              >
                <span>
                  <span className="block text-sm font-medium text-[var(--text-primary)]">{asset.make || asset.vehicle_type || 'Unknown make'} {asset.model || ''}</span>
                  <span className="block font-mono text-xs text-[var(--text-muted)]">{asset.asset_no} · {asset.chassis_no || asset.serial_no || asset.registration_no || 'No chassis / VIN recorded'} · {asset.site || asset.country || 'Site not recorded'}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-amber-400"><CheckCircle2 size={14} aria-hidden="true" /> Select</span>
              </button>
            )) : <p className="px-3 py-3 text-sm text-[var(--text-muted)]">No matching fleet asset found. Check the number or confirm that the machine exists in the fleet register.</p>}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(430px,1fr)]">
        <Card pad="none" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--input-border)] bg-[var(--panel-2)] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">OEM illustration</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{pdfFile ? pdfFile.name : 'Original PDF page · kept in this browser session'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className="btn-secondary min-h-[40px] px-3" onClick={() => setZoom((value) => Math.max(0.5, value - 0.2))} disabled={!pdfDoc} aria-label="Zoom out"><ZoomOut size={15} /></button>
              <button type="button" className="btn-secondary min-h-[40px] px-3" onClick={() => setZoom((value) => Math.min(2.5, value + 0.2))} disabled={!pdfDoc} aria-label="Zoom in"><ZoomIn size={15} /></button>
              <button type="button" className="btn-secondary min-h-[40px] px-3" onClick={() => setZoom(1)} disabled={!pdfDoc}>Fit</button>
              <button type="button" className="btn-secondary min-h-[40px] px-3" onClick={() => viewerRef.current?.requestFullscreen?.()} disabled={!pdfDoc} aria-label="View drawing fullscreen"><Maximize2 size={15} /></button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-b border-[var(--input-border)] px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">Diagram PDF page</span>
              <button type="button" className="btn-secondary min-h-[36px] px-2" onClick={() => movePage('figure', -1)} disabled={!pdfDoc || figurePage <= 1} aria-label="Previous diagram page"><ChevronLeft size={15} /></button>
              <input className="input h-9 w-16 text-center text-sm" type="number" min="1" max={pdfDoc?.numPages || 1} value={figurePage} disabled={!pdfDoc} onChange={(event) => setFigurePage(Number(event.target.value))} aria-label="Diagram PDF page number" />
              <span className="text-xs text-[var(--text-muted)]">of {pdfDoc?.numPages || '—'}</span>
              <button type="button" className="btn-secondary min-h-[36px] px-2" onClick={() => movePage('figure', 1)} disabled={!pdfDoc || figurePage >= pdfDoc.numPages} aria-label="Next diagram page"><ChevronRight size={15} /></button>
            </div>
            {pdfDoc && <span className="text-xs text-[var(--text-muted)]">Click a selected part’s callout location to mark it for review.</span>}
          </div>
          <div ref={viewerRef} className="max-h-[72vh] overflow-auto bg-[#1d232b] p-3 sm:p-5">
            <div ref={drawingRef} onClick={markCallout} className={`relative mx-auto w-fit ${selectedPart ? 'cursor-crosshair' : ''}`}>
              {pdfDoc ? (
                <>
                  <canvas ref={canvasRef} className="block mx-auto max-w-full bg-white shadow-lg" />
                  {currentMarkers.map((marker) => (
                    <button
                      key={marker.key}
                      type="button"
                      title={`Index ${marker.index}: click to remove marker`}
                      onClick={(event) => { event.stopPropagation(); setMarkers((current) => current.filter((item) => item.key !== marker.key)) }}
                      className={`absolute z-10 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white font-bold text-black shadow-lg ${marker.key === selectedPartKey ? 'bg-yellow-300 ring-4 ring-yellow-300/40' : 'bg-yellow-400'}`}
                      style={{ left: marker.x + '%', top: marker.y + '%' }}
                    >{marker.index}</button>
                  ))}
                </>
              ) : (
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-[360px] w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/20 bg-white/5 px-6 text-center hover:border-yellow-400/60 hover:bg-white/10">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-400 text-slate-950"><Upload size={25} aria-hidden="true" /></span>
                  <span className="text-base font-semibold text-white">Load an OEM parts PDF</span>
                  <span className="max-w-md text-sm text-slate-300">The manual is opened locally for this preview. Select a drawing page and its matching parts-list page.</span>
                  <span className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-slate-950">Choose PDF</span>
                </button>
              )}
              {pdfLoading && <div className="absolute inset-0 grid place-items-center bg-slate-950/50 text-sm text-white" role="status">Opening PDF…</div>}
            </div>
          </div>
          {pdfError && <p className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{pdfError}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--input-border)] px-4 py-3">
            <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} aria-label="Upload OEM parts PDF" />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary inline-flex min-h-[42px] items-center gap-2 text-sm"><Upload size={15} /> {pdfFile ? 'Replace manual' : 'Choose manual'}</button>
              {pdfFile && <button type="button" onClick={clearFile} className="btn-secondary inline-flex min-h-[42px] items-center gap-2 text-sm"><X size={15} /> Close manual</button>}
            </div>
            {pdfFile && pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[42px] items-center gap-2 text-sm text-amber-400 hover:text-amber-300"><FileText size={15} /> Open original PDF</a>}
          </div>
        </Card>

        <Card pad="none" className="overflow-hidden">
          <div className="border-b border-[var(--input-border)] bg-[var(--panel-2)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Indexed parts list</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">Choose the matching list page. Rows are read from the loaded PDF and are not saved.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--input-border)] px-4 py-3">
            <label htmlFor="oem-list-page" className="text-xs text-[var(--text-muted)]">Parts-list PDF page</label>
            <button type="button" className="btn-secondary min-h-[36px] px-2" onClick={() => movePage('list', -1)} disabled={!pdfDoc || listPage <= 1} aria-label="Previous parts list page"><ChevronLeft size={15} /></button>
            <input id="oem-list-page" className="input h-9 w-16 text-center text-sm" type="number" min="1" max={pdfDoc?.numPages || 1} value={listPage} disabled={!pdfDoc} onChange={(event) => setListPage(Number(event.target.value))} aria-label="Parts list PDF page number" />
            <span className="text-xs text-[var(--text-muted)]">of {pdfDoc?.numPages || '—'}</span>
            <button type="button" className="btn-secondary min-h-[36px] px-2" onClick={() => movePage('list', 1)} disabled={!pdfDoc || listPage >= pdfDoc.numPages} aria-label="Next parts list page"><ChevronRight size={15} /></button>
          </div>
          {listPageError && <p className="mx-4 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200" role="status">{listPageError}</p>}
          <div className="max-h-[58vh] overflow-auto">
            {pageRows.length ? (
              <table className="w-full min-w-[540px] border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-[var(--panel-2)] text-[var(--text-muted)]">
                  <tr><th className="px-3 py-3">Index</th><th className="px-3 py-3">Part number</th><th className="px-3 py-3">Description</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3">Remark</th></tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.key} className={`border-t border-[var(--input-border)] ${row.key === selectedPartKey ? 'bg-yellow-400/20' : 'hover:bg-[var(--panel-2)]'}`}>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => setSelectedPartKey((current) => current === row.key ? '' : row.key)} className={`min-w-8 rounded px-2 py-1 font-bold ${row.key === selectedPartKey ? 'bg-yellow-400 text-slate-950' : 'text-[var(--text-primary)]'}`} aria-label={`Select index ${row.index}, part ${row.partNo}`}>{row.index}</button>
                      </td>
                      <td className="px-3 py-3 font-mono text-[var(--text-primary)]">{row.partNo}</td>
                      <td className="max-w-[240px] whitespace-normal px-3 py-3 text-[var(--text-secondary)]">{row.description}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-[var(--text-primary)]">{row.qty}</td>
                      <td className="max-w-[130px] whitespace-normal px-3 py-3 text-[var(--text-muted)]">{row.remark || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="grid min-h-[260px] place-items-center px-6 text-center">
                <div>
                  <FileSearch size={24} className="mx-auto text-[var(--text-muted)]" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">{pdfDoc ? 'No parts table detected on this page' : 'Upload a manual to preview its parts list'}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{pdfDoc ? 'Try the next or previous PDF page until the OEM index table is found.' : 'The viewer will use the original PDF as the source.'}</p>
                </div>
              </div>
            )}
          </div>
          {selectedPart && (
            <div className="border-t border-[var(--input-border)] bg-yellow-400/10 p-4">
              <p className="text-xs font-semibold text-yellow-300">Selected index {selectedPart.index}</p>
              <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{selectedPart.partNo} · {selectedPart.description}</p>
              <p className="mt-2 text-xs text-[var(--text-muted)]">Click the matching number on the drawing to place a reviewed callout marker. Markers remain local to this preview.</p>
            </div>
          )}
          <div className="border-t border-[var(--input-border)] px-4 py-3 text-xs text-[var(--text-muted)]">
            {selectedAsset
              ? `Asset selected: ${selectedAsset.asset_no} · ${selectedAsset.site || selectedAsset.country || 'Site not recorded'}`
              : 'Select a fleet asset to confirm its make, model and chassis identity before matching a manual.'}
          </div>
        </Card>
      </div>

      <Card className="flex flex-wrap items-start gap-3 border border-amber-500/25 bg-amber-500/5">
        <FileSearch size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Preview workflow</p>
          <p className="mt-1 max-w-5xl text-xs leading-5 text-[var(--text-muted)]">Search a real fleet asset by chassis/VIN or another identifier, load its OEM PDF, choose the illustration and matching parts-list pages, then select a row and mark its callout for review. This screen does not save manuals, extracted parts, fitment rules, callout coordinates or inventory changes.</p>
        </div>
      </Card>
    </div>
  )
}
