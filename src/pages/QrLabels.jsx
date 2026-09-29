/**
 * QrLabels (route /qr-labels) - QR label generator, rebuilt on the shared page
 * kit to the owner's light reference design.
 *
 * Labels are generated on demand from the tyre register (tyre_records) and the
 * fleet register (vehicle_fleet, split into vehicles and tyreless equipment).
 * Every batch made here (generated, printed, PDF, Excel, queued) is saved to
 * qr_print_jobs (codes only, never the image), so the print history survives
 * the tab. The print queue itself is still this tab only. There is no label
 * assignment or scan register, so those tabs are honest empty states and
 * counts that would need one read N/A.
 *
 * Kept from the previous page: paste or upload a list of codes (ambiguous codes
 * are never auto-selected), the size control that derives the A4 grid, serials
 * that wrap and are never cut, the company logo on each label with a wordmark
 * fallback, browser printing, the PDF sheet and the Excel of the details.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import QRCode from 'qrcode'
import { useSettings } from '../contexts/SettingsContext'
import { applyCountry } from '../lib/api/_client'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import {
  labelGrid, pageCount, fitLabelText, fitLogoBox, resolveLabelSize, clampCustomWidth, CUSTOM_WIDTH, LABEL_SIZES,
} from '../lib/qrLabelLayout'
import { parseCodes, codesFromRows, matchCodes, matchSummary, rowWhere } from '../lib/qrBulkMatch'
import { useAuth } from '../contexts/AuthContext'
import {
  QrCode, Printer, Download, Search, CircleDot, Truck, Factory, Check, X, AlertCircle, ClipboardList,
  Upload, FileSpreadsheet, ChevronDown, ChevronRight, RefreshCw, Tags, ListChecks, Minus, Plus,
  SlidersHorizontal, Trash2, FileText, Info, Eye, Lock, ListPlus, Bookmark, CircleSlash, Package,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import {
  Card, CardState, Kpi, PageHero, Pager, Tabs, KitTable, VehicleThumb, fmtInt, useCard,
} from '../components/commandCenter/kit'
import { labelCode, qrState, QR_STATE_OPTIONS } from '../lib/qrLabelsAnalytics'
import {
  ITEM_TYPES, itemTypeLabel, rowsForType, registerFor, filterOptions, filterRegister, rowStatus, fleetKind,
  SIZE_TABS, QR_LEVELS, LABEL_INFO, infoLabel, toEntry, expandCopies, clampCopies, COPIES,
  addToQueue, queueLabelCount, queueToPrint, BATCH_ACTIONS, makeBatch, formatBatchTime, buildQrKpis,
  PAGE_TABS, TAB_EMPTY, normalizeDesign, saveTemplate, cleanCustomText, splitFleet,
  toPrintJobRow, printJobTotals,
} from '../lib/qrLabelsView'
import { listPrintJobs, savePrintJob } from '../lib/qrLabelJobs'
import { loadPdf } from '../lib/pdfEngine'
import QrPrintSheet from '../components/qr/QrPrintSheet'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { getCompanyLogo } from '../lib/api/brandLogo'
import './QrLabels.css'

// Preview pixels per printed millimetre. The preview is a scaled picture of the
// real label, so choosing Large makes the preview AND the printed label bigger.
const PREVIEW_PX_PER_MM = 3.2

// Ceilings on the paged reads. Both sit well above the live table sizes
// (fleet ~1,617 assets, tyre_records ~11,132) so a normal load is complete; if
// either is ever exceeded the page SAYS SO rather than silently printing a
// partial label run.
const FLEET_ROW_CAP = 20000
const TYRE_ROW_CAP  = 40000

// Per-viewer conveniences only (a remembered design and named templates); the
// page renders correctly without them.
const DESIGN_KEY = 'tp.qrLabels.design.v1'
const TEMPLATES_KEY = 'tp.qrLabels.templates.v1'
function readStore(key, fallback) {
  try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function writeStore(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* private window: keep going */ }
}

const TYPE_ICON = { tyres: CircleDot, vehicles: Truck, equipment: Factory }

// ── QR generation helper ──────────────────────────────────────────────────────
async function makeQR(value, level = 'M') {
  return QRCode.toDataURL(value, {
    width: 400, margin: 1, errorCorrectionLevel: level,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

// Fetch the company logo to a data URL, ONCE, for embedding in the PDF. A signed
// storage URL cannot be handed straight to jsPDF (it does not fetch), and doing
// it per label would be N network round trips. Never throws: a blocked, slow or
// missing logo leaves the label falling back to the wordmark rather than losing
// the sheet. Mirrors the checklist PDF's own logo path.
async function fetchLogoDataUrl(url) {
  if (!url || typeof url !== 'string') return null
  if (/^data:image\//i.test(url)) return url
  if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return null
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctrl && typeof setTimeout === 'function' ? setTimeout(() => ctrl.abort(), 12000) : null
    let res
    try { res = await fetch(url, { mode: 'cors', signal: ctrl ? ctrl.signal : undefined }) }
    finally { if (timer && typeof clearTimeout === 'function') clearTimeout(timer) }
    if (!res || !res.ok) return null
    const blob = await res.blob()
    if (!blob.type || !blob.type.startsWith('image/') || blob.size > 8000000) return null
    return await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch { return null }
}

/** Header strip of one label: the company logo, the wordmark, or nothing. */
function LabelHeader({ showLogo, companyLogo, logoUrl, className, style, imgStyle }) {
  if (!showLogo) return null
  return (
    <div className={className} style={style}>
      {companyLogo && logoUrl
        ? <img src={logoUrl} alt="" crossOrigin="anonymous" style={imgStyle} />
        : <span>TYRE PULSE</span>}
    </div>
  )
}

export default function QrLabels() {
  const { profile } = useAuth()
  const { activeCountry } = useSettings()
  const loadId = useRef(0)

  // ── Page state ─────────────────────────────────────────────────────────────
  const [tab,        setTab]        = useState('generate')
  const [type,       setType]       = useState('tyres')  // 'tyres' | 'vehicles' | 'equipment'
  const register = registerFor(type)                      // 'tyres' | 'fleet'
  // The label-text helpers speak 'tyres' | 'assets'.
  const mode = type === 'tyres' ? 'tyres' : 'assets'
  const [data,       setData]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [selected,   setSelected]   = useState(new Set())
  const [search,     setSearch]     = useState('')
  const [filterSite, setFilterSite] = useState('all')
  const [filterQr,   setFilterQr]   = useState('all')
  const [filterMaker, setFilterMaker] = useState('all')
  const [filterSize, setFilterSize] = useState('all')
  const [moreFilters, setMoreFilters] = useState(false)
  const [page,       setPage]       = useState(0)
  const [pageSize,   setPageSize]   = useState(25)
  const [qrImages,   setQrImages]   = useState({})       // { id: dataURL }
  const [truncated,  setTruncated]  = useState(false)
  const [generating, setGenerating] = useState(false)
  const [exporting,  setExporting]  = useState(false)
  const [notice,     setNotice]     = useState(null)
  // Bulk intake: paste or upload a list of identifiers and get their labels.
  const [bulkOpen,   setBulkOpen]   = useState(false)
  const [bulkText,   setBulkText]   = useState('')
  const [bulkBusy,   setBulkBusy]   = useState(false)
  const [bulkError,  setBulkError]  = useState(null)
  const [bulkResult, setBulkResult] = useState(null)
  const [logoUrl,    setLogoUrl]    = useState('')       // company logo, live URL for the preview
  // Label design, remembered on this device.
  const [design,     setDesign]     = useState(() => normalizeDesign(readStore(DESIGN_KEY, null)))
  const [templates,  setTemplates]  = useState(() => (Array.isArray(readStore(TEMPLATES_KEY, [])) ? readStore(TEMPLATES_KEY, []) : []))
  const [templateName, setTemplateName] = useState('')
  // This session only: the print queue and the batches made on this page.
  const [queue,      setQueue]      = useState(() => new Map())
  const [queueOpen,  setQueueOpen]  = useState(false)
  const [batches,    setBatches]    = useState([])
  const [viewBatch,  setViewBatch]  = useState(null)
  const [sessionLabels, setSessionLabels] = useState(0)
  const [exportMenu, setExportMenu] = useState(false)
  const [printEntries, setPrintEntries] = useState(null)
  const [previewQr,  setPreviewQr]  = useState(null)
  const batchSeq = useRef(0)
  const fileRef      = useRef(null)
  const exportRef    = useRef(null)

  const labelSize = design.size
  const info = design.info
  const copies = design.copies
  const sizeOpts = useMemo(() => ({ customW: design.customW }), [design.customW])
  const companyLogo = info.logo && design.logo === 'company'

  function setDesignPart(patch) {
    setDesign((d) => normalizeDesign({ ...d, ...patch }))
  }
  useEffect(() => { writeStore(DESIGN_KEY, design) }, [design])
  useEffect(() => { writeStore(TEMPLATES_KEY, templates) }, [templates])

  // The company logo is org-wide and rarely changes - load it once, not per
  // export. '' means no logo is set, and the label falls back to the wordmark.
  useEffect(() => {
    let live = true
    getCompanyLogo().then((u) => { if (live) setLogoUrl(typeof u === 'string' ? u : '') }).catch(() => {})
    return () => { live = false }
  }, [])

  // Headline counts: each tile reads its own register, so a failed count shows
  // N/A on its own tile instead of taking the page down.
  // Saved print history (qr_print_jobs). A failed read shows error + Retry.
  const savedJobs = useCard(() => listPrintJobs({ country: activeCountry }), [activeCountry])
  // Batch numbers carry on from today's saved runs so two tabs never both print QR-...-001.
  const todayPrefix = `QR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-`
  const todaysSaved = (savedJobs.data || []).reduce((m, j) => {
    if (!String(j.batchNo || '').startsWith(todayPrefix)) return m
    const n = Number(String(j.batchNo).slice(todayPrefix.length)) || 0
    return Math.max(m, n)
  }, 0)

  const counts = useCard(async () => {
    const [tyreRes, fleetRes] = await Promise.all([
      applyCountry(supabase.from('tyre_records').select('id', { count: 'exact', head: true }), activeCountry),
      fetchAllPages(
        (from, to) => applyCountry(supabase.from('vehicle_fleet').select('id, vehicle_type'), activeCountry)
          .not('asset_no', 'is', null).order('asset_no').order('id').range(from, to),
        { max: FLEET_ROW_CAP },
      ),
    ])
    if (tyreRes.error) throw tyreRes.error
    if (fleetRes.error) throw fleetRes.error
    return { tyres: tyreRes.count ?? null, fleet: fleetRes.data || [] }
  }, [activeCountry])

  const loadData = useCallback(async () => {
    const request = ++loadId.current
    const countryQuery = (table, columns) => applyCountry(supabase.from(table).select(columns), activeCountry)
    setData([])
    setLoading(true)
    setError(null)
    try {
      if (register === 'tyres') {
        // serial_number is a DEAD legacy column - empty on all tyre rows;
        // serial_no is the canonical one. Aliased so the label helpers keep
        // reading `serial_number` unchanged.
        //
        // Paged: the server caps EVERY response at 1000 rows whatever a
        // .limit() says, and tyre_records is past 11,000. `id` is the unique
        // paging tiebreak (asset_no repeats across a vehicle's tyres).
        const { data: rows, error: qErr, truncated } = await fetchAllPages(
          (from, to) => countryQuery('tyre_records', 'id, serial_number:serial_no, brand, site, country, asset_no, risk_level, size, position:tyre_position')
            .order('asset_no').order('id')
            .range(from, to),
          { max: TYRE_ROW_CAP },
        )
        if (request !== loadId.current) return
        if (qErr) throw qErr
        setData(rows || [])
        setTruncated(truncated)
      } else {
        // Paged for the same reason: the fleet is past 1,600 assets. asset_no
        // is unique per COUNTRY, not globally, so `id` is the tiebreak.
        const { data: rows, error: qErr, truncated } = await fetchAllPages(
          (from, to) => countryQuery('vehicle_fleet', 'id, asset_no, vehicle_type, site, country, status, ops_status, make, model, model_year, registration_no, fleet_number, chassis_no, engine_no, capacity, current_km')
            .not('asset_no', 'is', null)
            .order('asset_no').order('id')
            .range(from, to),
          { max: FLEET_ROW_CAP },
        )
        if (request !== loadId.current) return
        if (qErr) throw qErr
        setData(rows || [])
        setTruncated(truncated)
      }
    } catch (err) {
      if (request !== loadId.current) return
      setError(toUserMessage(err, 'Could not load records.'))
      setData([]); setTruncated(false)
    } finally {
      if (request === loadId.current) setLoading(false)
    }
  }, [register, activeCountry])

  useEffect(() => {
    setSelected(new Set())
    setQrImages({})
    setSearch('')
    setFilterSite('all'); setFilterQr('all'); setFilterMaker('all'); setFilterSize('all')
    setTruncated(false)
    setBulkText(''); setBulkResult(null); setBulkError(null)
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate the current request on cleanup.
    return () => { loadId.current++ }
  }, [loadData])

  // Picking a tile starts a fresh selection: a selection that spans item types
  // would print labels the table is no longer showing.
  function chooseType(next) {
    if (next === type) return
    setType(next)
    setSelected(new Set())
    setSearch(''); setFilterSite('all'); setFilterQr('all'); setFilterMaker('all'); setFilterSize('all')
    setPage(0)
    setBulkResult(null); setBulkError(null)
  }

  const typeRows = useMemo(() => rowsForType(data, type), [data, type])
  const options = useMemo(() => filterOptions(typeRows, type), [typeRows, type])
  const filtered = useMemo(
    () => filterRegister(typeRows, { type, search, site: filterSite, qr: filterQr, maker: filterMaker, size: filterSize }, { selected, qrImages }),
    [typeRows, type, search, filterSite, filterQr, filterMaker, filterSize, selected, qrImages],
  )
  useEffect(() => { setPage(0) }, [type, search, filterSite, filterQr, filterMaker, filterSize, pageSize])
  const pageTotal = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageTotal - 1)
  const pageRows = useMemo(() => filtered.slice(safePage * pageSize, safePage * pageSize + pageSize), [filtered, safePage, pageSize])

  function getLabel(item) { return labelCode(item, mode) }
  const entryFor = useCallback((item) => toEntry(item, type, {
    code: labelCode(item, mode), qr: qrImages[item.id], info, customText: design.customText,
  }), [type, mode, qrImages, info, design.customText])

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected(prev =>
      prev.size === filtered.length && filtered.length > 0
        ? new Set()
        : new Set(filtered.map(r => r.id))
    )
  }

  const byName = profile?.full_name || profile?.username || 'You'
  function recordBatch(action, entries, labels) {
    if (!entries.length) return
    batchSeq.current += 1
    const b = makeBatch({ seq: batchSeq.current + todaysSaved, type: entries[0]?.type || type, items: new Set(entries.map((e) => e.key)).size, labels: labels ?? entries.length, action, by: byName })
    setBatches((prev) => [{ ...b, entries }, ...prev].slice(0, 50))
    // Best-effort save: a failed save never blocks the print, it just says so.
    savePrintJob(toPrintJobRow(b, entries, { country: activeCountry, labelSize: design.size === 'custom' ? `custom ${design.customW} mm` : design.size }))
      .then((saved) => {
        if (!saved) return
        setBatches((prev) => prev.map((x) => (x.id === b.id ? { ...x, savedId: saved.id } : x)))
        savedJobs.retry()
      })
      .catch(() => setNotice({ tone: 'warn', text: 'The labels were made, but this run could not be saved to the print history.' }))
  }

  // `items` lets the bulk intake generate exactly what it just matched without
  // waiting for `selected` to land in state - a setState is not readable in the
  // same tick, so a bulk paste that generated off `filtered.filter(selected)`
  // would produce nothing on the first press.
  async function handleGenerate(items) {
    const list = items || filtered.filter(r => selected.has(r.id))
    if (!list.length) return
    setGenerating(true)
    const results = {}
    await Promise.all(list.map(async item => {
      const val = getLabel(item)
      if (val) {
        try { results[item.id] = await makeQR(val, design.qrLevel) } catch { /* skip */ }
      }
    }))
    setQrImages(prev => ({ ...prev, ...results }))
    const made = list.filter((r) => results[r.id])
    setSessionLabels((n) => n + made.length)
    recordBatch('generated', made.map((r) => toEntry(r, type, { code: getLabel(r), qr: results[r.id], info, customText: design.customText })))
    setGenerating(false)
  }

  // Reprint a saved batch: its codes are matched against the list on screen and
  // the QR images made again (the history stores codes, never images).
  async function reprintSaved(batch) {
    const want = new Set((batch.entries || []).map((e) => e.val))
    const rows = data.filter((r) => want.has(getLabel(r)))
    if (!rows.length) {
      setNotice({ tone: 'warn', text: `None of these codes are in the list on screen. Switch the item type to ${itemTypeLabel(batch.type)} and try again.` })
      setViewBatch(null)
      return
    }
    setGenerating(true)
    try {
      const made = []
      for (const r of rows) {
        const code = getLabel(r)
        try { made.push(toEntry(r, type, { code, qr: await makeQR(code, design.qrLevel), info, customText: design.customText })) } catch { /* skip one bad code */ }
      }
      setViewBatch(null)
      if (made.length) handlePrint(expandCopies(made, copies))
      if (made.length < want.size) setNotice({ tone: 'warn', text: `${want.size - made.length} of ${want.size} codes from that batch were not found in the list on screen and were left out.` })
    } finally {
      setGenerating(false)
    }
  }

  // A new error-correction level makes every generated code stale.
  function setQrLevel(level) {
    setDesignPart({ qrLevel: level })
    setQrImages({})
  }

  // ── Bulk intake ────────────────────────────────────────────────────────────
  // Paste a column of asset codes (or tyre serials) and get their labels. The
  // match runs against the WHOLE loaded register, not the filtered view, so a
  // code is never reported missing merely because a site filter was left on;
  // the filters are then cleared so every match is actually visible below.
  async function runBulk(codes) {
    setBulkError(null)
    const result = matchCodes(codes, data, { getCode: getLabel })
    setBulkResult(result)
    // Cleared unconditionally: the preview grid and both exports read the
    // FILTERED set, so a match left behind a site filter would be selected and
    // generated and then quietly missing from the printed sheet.
    setSearch(''); setFilterSite('all'); setFilterQr('all'); setFilterMaker('all'); setFilterSize('all')
    if (result.ids.length) {
      setSelected(prev => new Set([...prev, ...result.ids]))
      const rows = result.matched.map(m => m.row)
      // The fleet register holds vehicles AND equipment; show the kind most of
      // the matches belong to, and name the rest so none goes unprinted.
      if (register === 'fleet') {
        const split = splitFleet(rows)
        const main = split.equipment.length > split.vehicles.length ? 'equipment' : 'vehicles'
        if (main !== type) setType(main)
        const other = main === 'vehicles' ? split.equipment.length : split.vehicles.length
        setNotice(other > 0
          ? { tone: 'warn', text: `${other} matched ${other === 1 ? 'code is' : 'codes are'} ${main === 'vehicles' ? 'equipment' : 'vehicles'}. Switch the item type to print ${other === 1 ? 'it' : 'them'} too.` }
          : null)
      }
      await handleGenerate(rows)
    }
  }

  async function handleBulkPaste() {
    const { codes } = parseCodes(bulkText)
    if (!codes.length) { setBulkResult(null); setBulkError('Nothing to look up. Paste or upload a list of codes first.'); return }
    setBulkBusy(true)
    try { await runBulk(codes) }
    finally { setBulkBusy(false) }
  }

  async function handleBulkFile(e) {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setBulkBusy(true)
    setBulkError(null)
    try {
      // Raw sheet read, NOT the header-detecting parser: a file that is just a
      // column of codes has no header row, and guessing one would silently eat
      // the first code.
      const { parseWorkbookRaw } = await import('../lib/import/parseWorkbook')
      // parseWorkbookRaw returns { sheets: [{ name, aoa }] }, not a bare array.
      const { sheets } = await parseWorkbookRaw(file, { fileName: file.name })
      const aoa = (sheets || []).flatMap(sh => sh.aoa || [])
      const { codes } = codesFromRows(aoa)
      setBulkText(codes.join('\n'))
      if (!codes.length) { setBulkResult(null); setBulkError('That file had no readable codes in it.'); return }
      await runBulk(codes)
    } catch (err) {
      setBulkError(toUserMessage(err, 'Could not read that file. A CSV, Excel sheet or plain text list works.'))
    } finally {
      setBulkBusy(false)
    }
  }

  // ── Selection -> printable labels ──────────────────────────────────────────
  const selectedItems = filtered.filter(r => selected.has(r.id))
  const readyItems    = selectedItems.filter(r => qrImages[r.id])
  const pendingItems  = selectedItems.filter(r => !qrImages[r.id])
  const readyEntries  = useMemo(() => readyItems.map(entryFor), [readyItems, entryFor])
  const printTotal    = readyEntries.length * copies
  const grid          = labelGrid(labelSize, sizeOpts)
  const sheets        = pageCount(printTotal, labelSize, sizeOpts)
  const printList     = printEntries || expandCopies(readyEntries, copies)

  // Print through the browser. A list (the queue, a past batch) replaces the
  // selection for this one run, then the print area returns to the selection.
  function handlePrint(list) {
    const entries = list || expandCopies(readyEntries, copies)
    if (!entries.length) return
    setPrintEntries(entries)
    recordBatch('printed', entries, entries.length)
    setTimeout(() => { try { window.print() } catch { /* no print dialog here */ } }, 60)
  }
  useEffect(() => {
    const done = () => setPrintEntries(null)
    window.addEventListener('afterprint', done)
    return () => window.removeEventListener('afterprint', done)
  }, [])

  async function exportPDF(list) {
    const readyItems = list || expandCopies(filtered.filter(r => selected.has(r.id) && qrImages[r.id]).map(entryFor), copies)
    if (!readyItems.length) return
    setExporting(true)
    try {
      const { jsPDF } = await loadPdf()

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      // The grid is DERIVED from the label size the user chose, so a Small label
      // gets 20 to a sheet and a Large one never runs off the page width.
      const g = labelGrid(labelSize, sizeOpts)

      // Load the logo ONCE for the whole run, and measure it once. A missing or
      // blocked logo leaves `logo` null and the header falls back to the wordmark -
      // the sheet is never lost for the sake of an image.
      let logo = null
      if (companyLogo) {
        const logoData = await fetchLogoDataUrl(logoUrl)
        if (logoData) {
          let props = null
          try { props = doc.getImageProperties ? doc.getImageProperties(logoData) : null } catch { props = null }
          const fmt = /png/i.test(logoData.slice(0, 40)) || props?.fileType === 'PNG' ? 'PNG'
            : /webp/i.test(logoData.slice(0, 40)) ? 'WEBP' : 'JPEG'
          logo = { data: logoData, w: props?.width || 0, h: props?.height || 0, fmt }
        }
      }
      // jsPDF's own measurement, handed to the pure fitter.
      const measure = (text, size) => {
        doc.setFontSize(size)
        return doc.getTextWidth(text)
      }
      const textW = g.w - 4   // 2 mm of quiet margin each side

      readyItems.forEach((item, idx) => {
        const pagePos = idx % g.perPage
        const col     = pagePos % g.cols
        const row     = Math.floor(pagePos / g.cols)

        if (idx > 0 && pagePos === 0) doc.addPage()

        const x   = g.marginX + col * (g.w + g.gap)
        const y   = g.marginY + row * (g.h + g.gap)
        const val = item.val

        // ── Card: white face, soft green border ─────────────────────────────
        doc.setFillColor(255, 255, 255)
        doc.setDrawColor(22, 163, 74)
        doc.setLineWidth(0.4)
        doc.roundedRect(x, y, g.w, g.h, 2.2, 2.2, 'FD')

        // ── Header: the LOGO carries the brand, not a text name ──────────────
        // The logo sits on the white face with a thin green rule beneath it; only
        // when no logo is set does the wordmark stand in. Turned off, the label
        // gives the room to the QR code.
        const headH = info.logo ? 7 : 1
        if (info.logo) {
          if (logo) {
            const box = fitLogoBox(logo.w, logo.h, g.w - 6, headH - 1.5)
            try {
              doc.addImage(logo.data, logo.fmt, x + 3 + box.dx, y + 1.2 + box.dy, box.w, box.h, undefined, 'FAST')
            } catch { /* a bad frame must not lose the label */ }
          } else {
            doc.setTextColor(22, 163, 74)
            doc.setFontSize(6)
            doc.setFont('helvetica', 'bold')
            doc.text('TYRE PULSE', x + g.w / 2, y + 4.6, { align: 'center' })
          }
          doc.setDrawColor(22, 163, 74)
          doc.setLineWidth(0.35)
          doc.line(x + 2.5, y + headH + 0.5, x + g.w - 2.5, y + headH + 0.5)
        }

        // ── Identifier, fitted ───────────────────────────────────────────────
        // WRAPPED, NEVER TRUNCATED. A cut serial is not a shorter serial, it is a
        // different one, so it shrinks, then breaks across two lines.
        doc.setTextColor(0, 0, 0)
        doc.setFont('helvetica', 'bold')
        const fitVal = fitLabelText(measure, val, textW, { startSize: 7.5, minSize: 4.5, mode: 'wrap', maxLines: 2 })
        const subFits = (item.lines || []).map((l) => fitLabelText(measure, l, textW, { startSize: 5.5, minSize: 4, mode: 'clip', maxLines: 1 }))
          .filter((f) => f.lines.length)

        // Lay out from the bottom up so any number of lines sits clear of the border.
        const lineH = (f) => f.size * 0.42 + 1.2
        const subH = subFits.reduce((s, f) => s + lineH(f), 0)
        const baseY = y + g.h - 2.5 - subH
        doc.setFontSize(fitVal.size)
        fitVal.lines.forEach((line, i) => {
          const dy = (fitVal.lines.length - 1 - i) * (fitVal.size * 0.42)
          doc.text(line, x + g.w / 2, baseY - dy, { align: 'center' })
        })

        // ── QR code, filling what the text leaves ────────────────────────────
        const qrTop = y + headH + 2
        const qrRoom = Math.max(6, baseY - (fitVal.lines.length - 1) * (fitVal.size * 0.42) - 3 - qrTop)
        const qrSize = Math.max(6, Math.min(g.w - 10, qrRoom))
        doc.addImage(item.qr, 'PNG', x + (g.w - qrSize) / 2, qrTop, qrSize, qrSize)

        // ── Detail lines ─────────────────────────────────────────────────────
        let ly = baseY
        subFits.forEach((f) => {
          ly += lineH(f)
          doc.setFontSize(f.size)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(100, 100, 100)
          doc.text(f.lines[0], x + g.w / 2, ly, { align: 'center' })
        })
      })

      doc.save(`${reportFileName('TyrePulse QR Labels', itemTypeLabel(readyItems[0]?.type || type), reportDateLabel())}.pdf`)
      recordBatch('pdf', readyItems, readyItems.length)
    } catch (err) {
      setNotice({ tone: 'bad', text: toUserMessage(err, 'Could not build the label PDF.') })
    } finally {
      setExporting(false)
    }
  }

  // The details behind the labels, so a printed run comes with a sheet naming
  // what each code is. Exports the SELECTED rows - the same set the labels
  // cover - so the two files can never describe different vehicles.
  const EXCEL_COLS = mode === 'tyres'
    ? [
      ['serial_number', 'Serial No'], ['asset_no', 'Asset Code'], ['position', 'Position'],
      ['brand', 'Brand'], ['size', 'Size'], ['site', 'Site'], ['country', 'Country'],
      ['risk_level', 'Risk Level'], ['qr', 'QR Generated'],
    ]
    : [
      ['asset_no', 'Asset Code'], ['vehicle_type', 'Vehicle Type'], ['make', 'Make'],
      ['model', 'Model'], ['model_year', 'Model Year'], ['registration_no', 'Registration No'],
      ['fleet_number', 'Fleet No'], ['chassis_no', 'Chassis No'], ['engine_no', 'Engine No'],
      ['capacity', 'Capacity'], ['current_km', 'Current KM'], ['site', 'Site'],
      ['country', 'Country'], ['status', 'Status'], ['ops_status', 'Operational Status'],
      ['qr', 'QR Generated'],
    ]

  async function exportExcel() {
    const items = filtered.filter(r => selected.has(r.id))
    if (!items.length) return
    setExporting(true)
    try {
      const rows = items.map(r => ({ ...r, qr: qrImages[r.id] ? 'Yes' : 'No' }))
      await exportToExcel(
        rows,
        EXCEL_COLS.map(([k]) => k),
        EXCEL_COLS.map(([, h]) => h),
        reportFileName('TyrePulse QR', `${itemTypeLabel(type)} Details`, reportDateLabel()),
        itemTypeLabel(type).slice(0, 30),
        { title: `${itemTypeLabel(type)} label details` },
      )
      recordBatch('excel', items.map(entryFor), items.length)
    } catch (err) {
      setError(toUserMessage(err, 'Could not build the spreadsheet.'))
    } finally {
      setExporting(false)
    }
  }

  function queueSelection(items) {
    const list = (items || readyItems).map(entryFor)
    const { queue: next, added } = addToQueue(queue, list, copies)
    setQueue(next)
    if (added) recordBatch('queued', list, list.length * copies)
    setNotice({ tone: 'good', text: added ? `${added} ${added === 1 ? 'label' : 'labels'} added to the print queue.` : 'Those labels are already in the print queue.' })
  }

  // Close the export menu on an outside click or Escape.
  useEffect(() => {
    if (!exportMenu) return undefined
    const onDown = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportMenu(false) }
    const onKey = (e) => { if (e.key === 'Escape') setExportMenu(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [exportMenu])

  // ── Live preview: the first selected label, else the first row on screen ──
  const previewRow = readyItems[0] || selectedItems[0] || filtered[0] || null
  const previewCode = previewRow ? getLabel(previewRow) : ''
  useEffect(() => {
    let live = true
    if (!previewRow || !previewCode) { setPreviewQr(null); return undefined }
    if (qrImages[previewRow.id]) { setPreviewQr(qrImages[previewRow.id]); return undefined }
    makeQR(previewCode, design.qrLevel).then((u) => { if (live) setPreviewQr(u) }).catch(() => { if (live) setPreviewQr(null) })
    return () => { live = false }
  }, [previewRow, previewCode, qrImages, design.qrLevel])
  const previewEntry = previewRow ? toEntry(previewRow, type, { code: previewCode, qr: previewQr, info, customText: design.customText }) : null

  // EnterpriseTable speaks { [rowId]: true }; the page keeps a Set of real ids
  // (qrImages is keyed by them), so translate at the boundary only.
  const idByKey = useMemo(() => {
    const m = new Map()
    for (const r of data) m.set(String(r.id), r.id)
    return m
  }, [data])
  const rowSelection = useMemo(() => {
    const o = {}
    for (const id of selected) o[String(id)] = true
    return o
  }, [selected])
  const onRowSelectionChange = useCallback((next) => {
    const obj = typeof next === 'function' ? next(rowSelection) : next
    setSelected(new Set(Object.keys(obj || {}).filter(k => obj[k]).map(k => (idByKey.has(k) ? idByKey.get(k) : k))))
  }, [idByKey, rowSelection])

  const tyres = type === 'tyres'
  const columns = [
    {
      key: 'code', header: tyres ? 'Tyre ID' : 'Asset ID', sortable: false,
      cell: (r) => {
        const noSerial = tyres && !r.serial_number
        return (
          <span className="ql-code">
            {getLabel(r) || 'N/A'}
            {noSerial && <span className="ql-hint">No serial, uses asset code</span>}
          </span>
        )
      },
    },
    {
      key: 'vehicle', header: 'Vehicle / asset', sortable: false,
      cell: (r) => (tyres
        ? <span>{r.asset_no || <span className="cc-na">N/A</span>}{r.position && <span className="cc-sub">{r.position}</span>}</span>
        : (
          <span className="cc-vehicle">
            <VehicleThumb row={r} size="sm" />
            <span>{r.asset_no}<span className="cc-sub">{r.vehicle_type || 'Type not recorded'}</span></span>
          </span>
        )),
    },
    {
      key: 'make', header: tyres ? 'Brand' : 'Make / model', sortable: false,
      cell: (r) => (tyres ? r.brand : [r.make, r.model].filter(Boolean).join(' ')) || <span className="cc-na">N/A</span>,
    },
    { key: 'size', header: tyres ? 'Size' : 'Capacity', sortable: false, cell: (r) => (tyres ? r.size : r.capacity) || <span className="cc-na">N/A</span> },
    {
      key: 'serial', header: tyres ? 'Serial no' : 'Plate / chassis', sortable: false,
      cell: (r) => (tyres ? r.serial_number : (r.registration_no || r.chassis_no)) || <span className="cc-na">N/A</span>,
    },
    { key: 'site', header: 'Current location', sortable: false, cell: (r) => r.site || <span className="cc-na">N/A</span> },
    {
      key: 'status', header: 'Status', sortable: false,
      cell: (r) => { const s = rowStatus(r, type); return s ? <span className={`cc-pill ${s.tone}`}>{s.label}</span> : <span className="cc-na">N/A</span> },
    },
    {
      key: 'qr', header: 'QR', sortable: false,
      cell: (r) => {
        const st = qrState(r, selected, qrImages)
        if (st === 'ready') return <span className="cc-pill good"><Check size={11} aria-hidden="true" /> Ready</span>
        if (st === 'pending') return <span className="cc-pill warn">Pending</span>
        return <span className="cc-na">Not selected</span>
      },
    },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, sortable: false,
      cell: (r) => (
        <span className="ql-row-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
          <button type="button" className="cc-icon-btn" aria-label={`Generate QR for ${getLabel(r)}`} title="Generate QR"
            onClick={async () => { setSelected(prev => new Set([...prev, r.id])); await handleGenerate([r]) }}>
            <QrCode size={14} />
          </button>
          <button type="button" className="cc-icon-btn" aria-label={`Add ${getLabel(r)} to the print queue`} title={qrImages[r.id] ? 'Add to print queue' : 'Generate the QR first'}
            disabled={!qrImages[r.id]} onClick={() => queueSelection([r])}>
            <ListPlus size={14} />
          </button>
        </span>
      ),
    },
  ]

  const kpis = buildQrKpis({ tyres: counts.data?.tyres ?? null, fleet: counts.data?.fleet ?? null, sessionLabels })
  const kpiLoading = counts.loading && !counts.data
  const kpiDisplay = (v) => (counts.error || v == null ? 'N/A' : fmtInt(v))
  const queueCount = queueLabelCount(queue)
  const dim = Math.round(grid.w * PREVIEW_PX_PER_MM)
  const previewW = Math.min(dim, 230)
  const sizeInfo = resolveLabelSize(labelSize, design.customW)

  // History = this tab's batches (they still hold the QR images for Print again)
  // plus every saved batch not already shown from this tab.
  const sessionSavedIds = new Set(batches.map((b) => b.savedId).filter(Boolean))
  const history = [...batches, ...(savedJobs.data || []).filter((j) => !sessionSavedIds.has(j.id))]
  const totals = printJobTotals(savedJobs.data)
  const tabs = PAGE_TABS.map((t) => ({ ...t, count: t.key === 'prints' && history.length ? history.length : undefined }))

  return (
    <>
      {/* ── Print sheet (portal to <body>, same A4 grid as the PDF) ─────────── */}
      <QrPrintSheet entries={printList} grid={grid} showLogo={info.logo} logoUrl={companyLogo ? logoUrl : ''} />

      {/* ── Page ─────────────────────────────────────────────────────────────── */}
      <div className="cc ql-page">
        <div className="ql-hero-wrap">
          <PageHero
            hello={<nav aria-label="Breadcrumb" className="ql-crumb">Fleet &amp; Assets <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">QR Labels</span></nav>}
            title="QR Labels"
            lead="Generate and manage QR labels for tyres, vehicles and assets. Print, track and assign QR codes for easy identification in the field."
            imgLight="/dashboard/hero-assets-light.webp"
            imgDark="/dashboard/hero-assets-dark.webp"
          />
          <div className="ql-hero-actions">
            <button type="button" className="cc-btn-ghost" onClick={() => setQueueOpen(true)}>
              <Printer size={15} aria-hidden="true" /> Print Queue ({fmtInt(queueCount)})
            </button>
            <button type="button" className="cc-btn-ghost" onClick={() => setTab('settings')}>
              <Tags size={15} aria-hidden="true" /> Label Templates
            </button>
          </div>
        </div>

        {notice && (
          <div className={`cc-card ql-banner ${notice.tone}`} role="status">
            <Info size={16} aria-hidden="true" />
            <p>{notice.text}</p>
            <button type="button" className="cc-icon-btn" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={14} /></button>
          </div>
        )}

        <div className="cc-kpis">
          {totals
            ? <Kpi icon={QrCode} tone="t-green" display={fmtInt(totals.generated)} label="Labels generated"
                title={`From the saved print history: ${fmtInt(totals.printed)} sent to printer, ${fmtInt(totals.exported)} exported to PDF`} onClick={() => setTab('prints')} />
            : <Kpi icon={QrCode} tone="t-green" loading={savedJobs.loading} display={fmtInt(kpis.generated)} label="Labels generated this session"
                title="The saved print history could not be read, so this counts this browser tab only." />}
          <Kpi icon={CircleDot} tone="t-blue" loading={kpiLoading} display={kpiDisplay(kpis.tyres)} label="Tyres to label"
            title="Tyre records in the register that a label can be made for" onClick={() => chooseType('tyres')} />
          <Kpi icon={Truck} tone="t-purple" loading={kpiLoading} display={kpiDisplay(kpis.vehicles)} label="Vehicles to label"
            title="Fleet records that carry tyres" onClick={() => chooseType('vehicles')} />
          <Kpi icon={Factory} tone="t-orange" loading={kpiLoading} display={kpiDisplay(kpis.equipment)} label="Assets / equipment to label"
            title="Tyreless fleet records such as generators and plants" onClick={() => chooseType('equipment')} />
          <Kpi icon={ListChecks} tone="t-amber" display="N/A" label="Active QR codes"
            title="Not measured: no record is kept of which labels are stuck on an item in the field." />
          <Kpi icon={CircleSlash} tone="t-red" display="N/A" label="Unassigned labels"
            title="Not measured: labels are generated for a specific item, so none is issued unassigned." />
        </div>
        {counts.error && (
          <p className="ql-note" role="alert">Register counts could not be loaded. <button type="button" className="cc-link cc-link-btn" onClick={counts.retry}>Try again</button></p>
        )}

        <Card className="ql-tabs-card">
          <Tabs tabs={tabs} value={tab} onChange={setTab} label="QR label sections" variant="line" />
        </Card>

        {tab === 'generate' && (
          <div className="ql-layout">
            <div className="ql-col">
              {/* 1. Select item type */}
              <Card title={<><span className="ql-step">1</span> Select item type</>}>
                <div className="ql-types" role="radiogroup" aria-label="Item type">
                  {ITEM_TYPES.map((t) => {
                    const Icon = TYPE_ICON[t.key]
                    return (
                      <button key={t.key} type="button" role="radio" aria-checked={type === t.key}
                        className={`ql-type ${type === t.key ? 'on' : ''}`} onClick={() => chooseType(t.key)}>
                        <span className="ql-type-icon"><Icon size={22} aria-hidden="true" /></span>
                        <b>{t.label}</b>
                        <small>{t.sub}</small>
                        {type === t.key && <Check size={15} className="ql-type-check" aria-hidden="true" />}
                      </button>
                    )
                  })}
                </div>
              </Card>

              {/* 2. Filter & select items */}
              <Card
                title={<><span className="ql-step">2</span> Filter &amp; select items</>}
                sub={loading ? 'Loading the register...' : `${fmtInt(filtered.length)} of ${fmtInt(typeRows.length)} ${itemTypeLabel(type).toLowerCase()} shown, ${fmtInt(selected.size)} selected`}
                action={
                  <button type="button" className="cc-btn-ghost" onClick={() => setBulkOpen(o => !o)} aria-expanded={bulkOpen}>
                    <ClipboardList size={14} aria-hidden="true" /> {mode === 'tyres' ? 'Paste serials' : 'Paste asset codes'}
                  </button>
                }
              >
                {/* ── Bulk intake: paste a list of codes, get their labels ─────── */}
                {bulkOpen && (
                  <div className="ql-bulk">
                    <p className="ql-bulk-lead">
                      {mode === 'tyres'
                        ? 'Paste tyre serials one per line, or upload a file. Labels are generated for the ones found.'
                        : 'Paste asset codes like TM360 one per line, or upload a file. Labels are generated automatically.'}
                    </p>
                    <textarea
                      aria-label={mode === 'tyres' ? 'Tyre serials, one per line' : 'Asset codes, one per line'}
                      className="ql-textarea"
                      placeholder={mode === 'tyres' ? 'EP060420711\nYMA55312\n...' : 'TM360\nMP093\nBH021\n...'}
                      value={bulkText}
                      onChange={e => setBulkText(e.target.value)}
                      spellCheck={false}
                    />
                    <div className="ql-bulk-actions">
                      <button type="button" onClick={handleBulkPaste} disabled={bulkBusy} className="cc-btn-primary">
                        {bulkBusy
                          ? <><RefreshCw size={13} className="animate-spin" aria-hidden="true" /> Matching...</>
                          : <><QrCode size={13} aria-hidden="true" /> Find and generate</>}
                      </button>
                      <button type="button" onClick={() => fileRef.current?.click()} disabled={bulkBusy} className="cc-btn-ghost">
                        <Upload size={13} aria-hidden="true" /> Upload a file
                      </button>
                      <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" onChange={handleBulkFile} className="hidden" aria-label="Upload a list of codes" />
                      {(bulkText || bulkResult) && (
                        <button type="button" onClick={() => { setBulkText(''); setBulkResult(null); setBulkError(null) }} className="cc-link cc-link-btn">
                          <X size={12} aria-hidden="true" /> Clear list
                        </button>
                      )}
                      <span className="ql-muted">A CSV, Excel sheet or plain list all work. Every cell is read.</span>
                    </div>

                    {bulkError && <p className="ql-err"><AlertCircle size={12} aria-hidden="true" /> {bulkError}</p>}

                    {bulkResult && (
                      <div className="ql-bulk-result">
                        <p className={bulkResult.counts.matched ? 'ql-good' : 'ql-warn'}>
                          {matchSummary(bulkResult, mode === 'tyres' ? 'serial' : 'asset code')}
                          {bulkResult.counts.matched > 0 && ' Labels generated and selected below.'}
                        </p>

                        {/* Not in the register: named, never quietly dropped. */}
                        {bulkResult.unmatched.length > 0 && (
                          <div className="ql-box warn">
                            <b>Not found ({bulkResult.unmatched.length})</b>
                            <p className="ql-mono">{bulkResult.unmatched.join('  ')}</p>
                            <p>
                              These are not in the register you can see. Check the spelling, or the record may sit in another country.
                              {truncated && ' This page also stopped short of the full register, so some may simply not be loaded.'}
                            </p>
                          </div>
                        )}

                        {/* Two machines can share a code, so the person picks. */}
                        {bulkResult.ambiguous.length > 0 && (
                          <div className="ql-box info">
                            <b>Found in more than one place ({bulkResult.ambiguous.length})</b>
                            <p>The same code exists on more than one record, and they are usually different machines. Nothing was selected for these. Pick the right one.</p>
                            {bulkResult.ambiguous.map(({ code, rows }) => (
                              <div key={code} className="ql-amb">
                                <p className="ql-mono">{code}</p>
                                <div className="ql-amb-rows">
                                  {rows.map(r => (
                                    <button
                                      type="button"
                                      key={r.id}
                                      aria-pressed={selected.has(r.id)}
                                      onClick={async () => {
                                        if (register === 'fleet' && fleetKind(r) !== type) setType(fleetKind(r))
                                        setSelected(prev => new Set([...prev, r.id]))
                                        await handleGenerate([r])
                                      }}
                                      className="cc-btn-ghost ql-amb-btn"
                                    >
                                      {selected.has(r.id) && <Check size={11} aria-hidden="true" />}
                                      {rowWhere(r)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="cc-filters ql-filters">
                  <label className="cc-field">
                    <span>Site</span>
                    <select className="cc-select" value={filterSite} onChange={e => setFilterSite(e.target.value)}>
                      <option value="all">All sites</option>
                      {options.sites.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="cc-field">
                    <span>{tyres ? 'Manufacturer' : 'Make'}</span>
                    <select className="cc-select" value={filterMaker} onChange={e => setFilterMaker(e.target.value)}>
                      <option value="all">All</option>
                      {options.makers.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="cc-field">
                    <span>{tyres ? 'Size' : 'Type'}</span>
                    <select className="cc-select" value={filterSize} onChange={e => setFilterSize(e.target.value)}>
                      <option value="all">All</option>
                      {options.sizes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <div className="cc-search">
                    <Search size={15} aria-hidden="true" />
                    <input
                      aria-label={tyres ? 'Search tyres' : 'Search vehicles and assets'}
                      placeholder={tyres ? 'Search serial, brand, asset, site...' : 'Search asset, type, make, site...'}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                  <button type="button" className="cc-btn-ghost" aria-expanded={moreFilters} onClick={() => setMoreFilters(v => !v)}>
                    <SlidersHorizontal size={14} aria-hidden="true" /> More Filters
                  </button>
                </div>
                {moreFilters && (
                  <div className="cc-filters ql-filters ql-more">
                    <label className="cc-field">
                      <span>QR status</span>
                      <select className="cc-select" value={filterQr} onChange={e => setFilterQr(e.target.value)}>
                        <option value="all">Any QR status</option>
                        {QR_STATE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </label>
                    <button type="button" className="cc-btn-ghost" onClick={() => { setSearch(''); setFilterSite('all'); setFilterQr('all'); setFilterMaker('all'); setFilterSize('all') }}>
                      <X size={13} aria-hidden="true" /> Clear filters
                    </button>
                  </div>
                )}

                <div className="cc-bulk">
                  <button type="button" onClick={toggleAll} className="cc-btn-ghost" disabled={!filtered.length}>
                    {selected.size === filtered.length && filtered.length > 0 ? 'Deselect all' : `Select all (${fmtInt(filtered.length)})`}
                  </button>
                  {selected.size > 0 && <span className="cc-bulk-count">{fmtInt(selected.size)} selected</span>}
                  {selected.size > 0 && <button type="button" className="cc-link cc-link-btn" onClick={() => setSelected(new Set())}>Clear selection</button>}
                </div>

                {/* A partial read must never masquerade as the whole register - the
                    count on Select all is otherwise indistinguishable from a total. */}
                {truncated && (
                  <p className="ql-box warn" role="status">
                    Showing the first {data.length.toLocaleString()} records only. Narrow by site or search to reach the rest.
                  </p>
                )}

                <KitTable
                  className="ql-table"
                  columns={columns}
                  rows={pageRows}
                  getRowId={(r) => String(r.id)}
                  loading={loading}
                  error={error}
                  onRetry={loadData}
                  enableRowSelection
                  rowSelection={rowSelection}
                  onRowSelectionChange={onRowSelectionChange}
                  onRowClick={(r) => toggleSelect(r.id)}
                  manualPagination
                  showPagination={false}
                  enableSorting={false}
                  pageIndex={safePage}
                  pageSize={pageSize}
                  pageCount={pageTotal}
                  totalRows={filtered.length}
                  empty={typeRows.length === 0 ? `No ${itemTypeLabel(type).toLowerCase()} in this register yet.` : 'No records match these filters.'}
                />
                {!loading && !error && filtered.length > 0 && (
                  <Pager page={safePage} pageSize={pageSize} total={filtered.length} noun={itemTypeLabel(type).toLowerCase()}
                    onPage={setPage} onPageSize={setPageSize} sizes={[10, 25, 50, 100]} />
                )}
              </Card>

              {/* 4. Generate & print */}
              <Card title={<><span className="ql-step">4</span> Generate &amp; print</>}>
                <div className="ql-gen">
                  <div className="ql-gen-stat">
                    <span>Selected items</span>
                    <b>{fmtInt(selectedItems.length)}</b>
                    <small>{fmtInt(readyItems.length)} with a QR ready{pendingItems.length ? `, ${fmtInt(pendingItems.length)} to generate` : ''}</small>
                  </div>
                  <div className="ql-gen-stat">
                    <span>Copies per label</span>
                    <div className="ql-stepper">
                      <button type="button" aria-label="Fewer copies" disabled={copies <= COPIES.min} onClick={() => setDesignPart({ copies: copies - 1 })}><Minus size={14} /></button>
                      <input aria-label="Copies per label" inputMode="numeric" value={copies}
                        onChange={(e) => setDesignPart({ copies: clampCopies(e.target.value) })} />
                      <button type="button" aria-label="More copies" disabled={copies >= COPIES.max} onClick={() => setDesignPart({ copies: copies + 1 })}><Plus size={14} /></button>
                    </div>
                  </div>
                  <div className="ql-gen-stat">
                    <span>Total labels to print</span>
                    <b>{fmtInt(printTotal)}</b>
                    <small>{sheets > 0 ? `${sheets} A4 ${sheets === 1 ? 'sheet' : 'sheets'}, ${grid.cols} x ${grid.rows} per sheet` : 'Generate QR codes to print'}</small>
                  </div>
                </div>
                <div className="ql-gen-actions">
                  <button type="button" onClick={() => handleGenerate()} disabled={generating || pendingItems.length === 0} className="cc-btn-primary">
                    {generating
                      ? <><RefreshCw size={14} className="animate-spin" aria-hidden="true" /> Generating...</>
                      : <><QrCode size={14} aria-hidden="true" /> Generate Labels{pendingItems.length ? ` (${pendingItems.length})` : ''}</>}
                  </button>
                  <button type="button" className="cc-btn-ghost" disabled={readyItems.length === 0} onClick={() => queueSelection()}>
                    <ListPlus size={14} aria-hidden="true" /> Add to Print Queue
                  </button>
                  <button type="button" className="cc-btn-ghost" disabled={readyItems.length === 0} onClick={() => handlePrint()}>
                    <Printer size={14} aria-hidden="true" /> Print
                  </button>
                  <div className="ql-menu" ref={exportRef}>
                    <button type="button" className="cc-btn-ghost" aria-haspopup="menu" aria-expanded={exportMenu}
                      disabled={selectedItems.length === 0 || exporting} onClick={() => setExportMenu(v => !v)}>
                      <Download size={14} aria-hidden="true" /> {exporting ? 'Exporting...' : 'Export QR Data'} <ChevronDown size={13} aria-hidden="true" />
                    </button>
                    {exportMenu && (
                      <div className="ql-menu-list" role="menu">
                        <button type="button" role="menuitem" disabled={readyItems.length === 0} onClick={() => { setExportMenu(false); exportPDF() }}>
                          <FileText size={14} aria-hidden="true" /> Label sheet (PDF){readyItems.length ? ` (${printTotal})` : ''}
                        </button>
                        <button type="button" role="menuitem" onClick={() => { setExportMenu(false); exportExcel() }}>
                          <FileSpreadsheet size={14} aria-hidden="true" /> Details (Excel) ({selectedItems.length})
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {readyItems.length === 0 && selectedItems.length > 0 && (
                  <p className="ql-note">Press Generate Labels to make the QR codes before printing or adding to the queue.</p>
                )}
              </Card>
            </div>

            <div className="ql-col ql-rail">
              {/* 3. Label design & preview */}
              <Card title={<><span className="ql-step">3</span> Label design &amp; preview</>}>
                <Tabs tabs={SIZE_TABS} value={labelSize} onChange={(k) => setDesignPart({ size: k })} label="Label size" />
                {labelSize === 'custom' && (
                  <label className="cc-field ql-custom-w">
                    <span>Custom width (mm, {CUSTOM_WIDTH.min} to {CUSTOM_WIDTH.max})</span>
                    <input type="number" min={CUSTOM_WIDTH.min} max={CUSTOM_WIDTH.max} value={design.customW}
                      onChange={(e) => setDesignPart({ customW: e.target.value })}
                      onBlur={(e) => setDesignPart({ customW: clampCustomWidth(e.target.value) })} />
                  </label>
                )}

                <div className="ql-preview">
                  {previewEntry ? (
                    <div className="ql-label" style={{ width: previewW }}>
                      <LabelHeader showLogo={info.logo} companyLogo={companyLogo} logoUrl={logoUrl} className="ql-label-head"
                        imgStyle={{ maxHeight: '80%', maxWidth: '86%', objectFit: 'contain', display: 'block' }} />
                      <div className="ql-label-qr">
                        {previewEntry.qr
                          ? <img src={previewEntry.qr} alt={`QR code preview for ${previewEntry.val}`} style={{ width: previewW - 24, height: previewW - 24 }} />
                          : <div className="cc-skel" style={{ width: previewW - 24, height: previewW - 24 }} />}
                      </div>
                      <div className="ql-label-text">
                        {/* NOT truncated: the printed label keeps the whole identifier, so a
                            preview ending in "..." would show something the sheet does not print. */}
                        <p className="ql-label-code">{previewEntry.val}</p>
                        {previewEntry.lines.map((l) => <p key={l} className="ql-label-sub">{l}</p>)}
                      </div>
                    </div>
                  ) : (
                    <div className="cc-empty">{loading ? 'Loading a record to preview...' : 'No record to preview. Choose an item type with records.'}</div>
                  )}
                  <p className="ql-muted">
                    {sizeInfo.label} label, {grid.w} x {grid.h} mm, {grid.perPage} per A4 sheet.
                    {previewRow && !readyItems[0] ? ' Preview only: press Generate Labels to make the printable code.' : ''}
                  </p>
                </div>

                <div className="ql-info">
                  <h3>Label information</h3>
                  {LABEL_INFO.map((f) => {
                    const locked = !!f.locked
                    const unavailable = !!f.unavailable
                    const on = locked ? true : unavailable ? false : !!info[f.key]
                    return (
                      <label key={f.key} className={`ql-toggle ${locked || unavailable ? 'dim' : ''}`} title={unavailable ? f.unavailable : locked ? 'Always printed: a label without it identifies nothing.' : undefined}>
                        <input type="checkbox" checked={on} disabled={locked || unavailable}
                          onChange={(e) => setDesignPart({ info: { ...info, [f.key]: e.target.checked } })} />
                        <span className="ql-switch" aria-hidden="true" />
                        <span>{infoLabel(f.key, type)}</span>
                        {locked && <Lock size={12} aria-hidden="true" />}
                        {unavailable && <small>Not available</small>}
                      </label>
                    )
                  })}
                  {info.custom && (
                    <label className="cc-field">
                      <span>Custom text</span>
                      <input className="ql-input" maxLength={40} value={design.customText}
                        onChange={(e) => setDesign((d) => ({ ...d, customText: e.target.value }))}
                        onBlur={(e) => setDesignPart({ customText: cleanCustomText(e.target.value) })}
                        placeholder="For example: Property of the fleet" />
                    </label>
                  )}
                </div>

                <div className="ql-selects">
                  <label className="cc-field">
                    <span>Logo</span>
                    <select className="cc-select" value={design.logo} disabled={!info.logo} onChange={(e) => setDesignPart({ logo: e.target.value })}>
                      <option value="company">Company logo{logoUrl ? '' : ' (not set, wordmark used)'}</option>
                      <option value="wordmark">Tyre Pulse wordmark</option>
                    </select>
                  </label>
                  <label className="cc-field">
                    <span>Label size (mm)</span>
                    <select className="cc-select" value={labelSize} onChange={(e) => setDesignPart({ size: e.target.value })}>
                      {Object.values(LABEL_SIZES).map((s) => <option key={s.key} value={s.key}>{s.w} mm ({s.label})</option>)}
                      <option value="custom">Custom ({clampCustomWidth(design.customW)} mm)</option>
                    </select>
                  </label>
                  <div className="cc-field">
                    <span>Label material</span>
                    <p className="ql-readout">Chosen on your printer. Not stored here.</p>
                  </div>
                  <label className="cc-field">
                    <span>QR code type</span>
                    <select className="cc-select" value={design.qrLevel} onChange={(e) => setQrLevel(e.target.value)}>
                      {QR_LEVELS.map((l) => <option key={l.key} value={l.key}>Error correction {l.label}</option>)}
                    </select>
                  </label>
                </div>
              </Card>

              {/* Recent generated labels (this session) */}
              <Card title="Recent generated labels" sub="Saved print history for everyone in your company."
                action={history.length > 0 && <button type="button" className="cc-link cc-link-btn" onClick={() => setTab('prints')}>View all</button>}>
                <BatchTable batches={history.slice(0, 6)} state={savedJobs} onView={setViewBatch} compact empty="No labels generated yet." />
              </Card>
            </div>

            {/* Generated labels, as they will print */}
            {readyEntries.length > 0 && (
              <Card className="ql-wide" title={`Generated labels (${fmtInt(readyEntries.length)})`}
                sub={`${grid.w} mm labels, ${grid.cols} x ${grid.rows} per A4 sheet${sheets > 0 ? `, ${sheets} ${sheets === 1 ? 'sheet' : 'sheets'} to print with ${copies} ${copies === 1 ? 'copy' : 'copies'} each` : ''}`}>
                <div className="ql-grid">
                  {readyEntries.map((e) => (
                    <div key={e.key} className="ql-label" style={{ width: Math.min(dim, 200) }}>
                      <LabelHeader showLogo={info.logo} companyLogo={companyLogo} logoUrl={logoUrl} className="ql-label-head"
                        imgStyle={{ maxHeight: '80%', maxWidth: '86%', objectFit: 'contain', display: 'block' }} />
                      <div className="ql-label-qr"><img src={e.qr} alt={e.val} style={{ width: Math.min(dim, 200) - 20, height: Math.min(dim, 200) - 20 }} /></div>
                      <div className="ql-label-text">
                        <p className="ql-label-code">{e.val}</p>
                        {e.lines.map((l) => <p key={l} className="ql-label-sub">{l}</p>)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <details className="cc-card ql-wide ql-howto">
              <summary><Info size={14} aria-hidden="true" /> How to use</summary>
              <ol>
                <li>Choose Tyres, Vehicles or Assets / Equipment.</li>
                <li>Already have a list? Use {mode === 'tyres' ? 'Paste serials' : 'Paste asset codes'}, paste it or upload the file, and the labels are found and generated for you. Anything not in the register is named rather than skipped.</li>
                <li>Otherwise tick the rows you want, or use Select all, then press Generate Labels.</li>
                <li>Print opens the browser print dialog. Export QR Data gives the label sheet as a PDF ({grid.cols} x {grid.rows} = {grid.perPage} labels per A4 sheet at this size) or the details as a spreadsheet, so a printed run comes with a list naming every code.</li>
                <li>Cut and stick labels onto the tyre, the windscreen or the chassis plate, then scan them with the Tyre Pulse scanner to open the record.</li>
                <li>Labels carry your company logo across the top.{logoUrl ? ' It is loaded from your report branding.' : ' Set one in the console under Report Colors and it appears here automatically.'}</li>
              </ol>
            </details>
          </div>
        )}

        {['inventory', 'assigned', 'scans'].includes(tab) && (
          <Card title={PAGE_TABS.find((t) => t.key === tab)?.label}>
            <div className="cc-empty ql-tab-empty">
              <div>
                <Package size={28} aria-hidden="true" />
                <b>{TAB_EMPTY[tab].title}</b>
                <p>{TAB_EMPTY[tab].body}</p>
                <button type="button" className="cc-btn" onClick={() => setTab('generate')}>Generate labels</button>
              </div>
            </div>
          </Card>
        )}

        {tab === 'prints' && (
          <Card title="Print history" sub="Every label run, print and export made on this page, saved for your company. Codes only; QR images are made again when you reprint."
            action={<button type="button" className="cc-btn-ghost" onClick={savedJobs.retry}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>}>
            <BatchTable batches={history} state={savedJobs} onView={setViewBatch} empty={TAB_EMPTY.prints.body} />
          </Card>
        )}

        {tab === 'settings' && (
          <div className="ql-settings">
            <Card title="Label templates" sub="Saved in this browser on this device.">
              <form className="ql-tpl-form" onSubmit={(e) => { e.preventDefault(); setTemplates((t) => saveTemplate(t, templateName, design)); setTemplateName('') }}>
                <label className="cc-field">
                  <span>Save the current design as</span>
                  <input className="ql-input" maxLength={40} value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" />
                </label>
                <button type="submit" className="cc-btn-primary" disabled={!templateName.trim()}><Bookmark size={14} aria-hidden="true" /> Save template</button>
              </form>
              {templates.length === 0
                ? <div className="cc-empty">No templates yet. Set up a design, name it and save it here.</div>
                : (
                  <ul className="ql-tpl-list">
                    {templates.map((t) => {
                      const d = normalizeDesign(t.design)
                      const sz = resolveLabelSize(d.size, d.customW)
                      return (
                        <li key={t.name}>
                          <div><b>{t.name}</b><small>{sz.label}, {sz.w} mm, {d.copies} {d.copies === 1 ? 'copy' : 'copies'}, error correction {d.qrLevel}</small></div>
                          <button type="button" className="cc-btn" onClick={() => { setDesign(d); setQrImages({}); setTab('generate') }}>Apply</button>
                          <button type="button" className="cc-icon-btn" aria-label={`Delete template ${t.name}`} onClick={() => setTemplates((list) => list.filter((x) => x.name !== t.name))}><Trash2 size={14} /></button>
                        </li>
                      )
                    })}
                  </ul>
                )}
            </Card>
            <Card title="Branding and defaults">
              <ul className="ql-facts">
                <li><b>Company logo</b><span>{logoUrl ? 'Set, loaded from your report branding.' : 'Not set. Labels use the Tyre Pulse wordmark. Set one in the console under Report Colors.'}</span></li>
                <li><b>Your label design</b><span>Remembered in this browser on this device.</span></li>
                <li><b>Print history</b><span>Saved for your company: batch number, type, codes, who made it and when.</span></li>
                <li><b>Print queue</b><span>Kept in this browser tab only and cleared when it closes.</span></li>
              </ul>
              <button type="button" className="cc-btn-ghost" onClick={() => { setDesign(normalizeDesign(null)); setQrImages({}) }}>
                <RefreshCw size={14} aria-hidden="true" /> Reset design to defaults
              </button>
            </Card>
          </div>
        )}
      </div>

      {/* ── Print queue (this session) ───────────────────────────────────────── */}
      <Modal open={queueOpen} onClose={() => setQueueOpen(false)} size="lg" title={`Print queue (${fmtInt(queueCount)} labels)`}
        subtitle="Kept in this browser tab only. Printed at the current label size."
        footer={
          <>
            <button type="button" className="cc-btn-ghost" disabled={!queue.size} onClick={() => setQueue(new Map())}><Trash2 size={14} aria-hidden="true" /> Clear queue</button>
            <button type="button" className="cc-btn-ghost" disabled={!queue.size || exporting} onClick={() => exportPDF(queueToPrint(queue))}><FileText size={14} aria-hidden="true" /> Export PDF</button>
            <button type="button" className="cc-btn-primary" disabled={!queue.size} onClick={() => { setQueueOpen(false); handlePrint(queueToPrint(queue)) }}><Printer size={14} aria-hidden="true" /> Print queue</button>
          </>
        }>
        {queue.size === 0
          ? <div className="cc-empty">The queue is empty. Generate labels, then use Add to Print Queue.</div>
          : (
            <ul className="ql-queue">
              {[...queue.values()].map((e) => (
                <li key={e.key}>
                  {e.qr && <img src={e.qr} alt="" />}
                  <div><b className="ql-mono">{e.val}</b><small>{itemTypeLabel(e.type)}{e.lines.length ? `, ${e.lines.join(', ')}` : ''}</small></div>
                  <span className="cc-pill muted">{e.copies} {e.copies === 1 ? 'copy' : 'copies'}</span>
                  <button type="button" className="cc-icon-btn" aria-label={`Remove ${e.val} from the queue`}
                    onClick={() => setQueue((q) => { const n = new Map(q); n.delete(e.key); return n })}><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
      </Modal>

      {/* ── One batch ────────────────────────────────────────────────────────── */}
      <Modal open={!!viewBatch} onClose={() => setViewBatch(null)} size="md" title={viewBatch ? `Batch ${viewBatch.batchNo}` : ''}
        subtitle={viewBatch ? `${BATCH_ACTIONS[viewBatch.action]?.label || viewBatch.action}, ${formatBatchTime(viewBatch.at)}` : ''}
        footer={viewBatch && (viewBatch.entries?.some((e) => e.qr)
          ? (
            <button type="button" className="cc-btn-primary" onClick={() => { const list = viewBatch.entries.filter((e) => e.qr); setViewBatch(null); handlePrint(list) }}>
              <Printer size={14} aria-hidden="true" /> Print again
            </button>
          )
          : viewBatch.entries?.length > 0 && (
            <button type="button" className="cc-btn-primary" disabled={generating} onClick={() => reprintSaved(viewBatch)}>
              <Printer size={14} aria-hidden="true" /> Make QR codes and print
            </button>
          ))}>
        {viewBatch && (
          <ul className="ql-queue">
            {[...new Map((viewBatch.entries || []).map((e) => [e.key, e])).values()].map((e) => (
              <li key={e.key}>
                {e.qr && <img src={e.qr} alt="" />}
                <div><b className="ql-mono">{e.val || 'N/A'}</b><small>{e.lines.join(', ') || itemTypeLabel(e.type)}</small></div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  )
}

function BatchTable({ batches, onView, compact = false, empty, state }) {
  const cols = [
    { key: 'batchNo', header: 'Batch no', cell: (b) => <span className="ql-mono">{b.batchNo}</span> },
    { key: 'type', header: 'Type', cell: (b) => itemTypeLabel(b.type) },
    { key: 'labels', header: 'Items', cell: (b) => fmtInt(b.items) },
    { key: 'by', header: 'Generated by', cell: (b) => b.by },
    { key: 'at', header: 'Date / time', cell: (b) => formatBatchTime(b.at) },
    { key: 'status', header: 'Status', cell: (b) => { const a = BATCH_ACTIONS[b.action]; return <span className={`cc-pill ${a?.tone || 'muted'}`}>{a?.label || b.action}</span> } },
    { key: 'view', header: <span className="sr-only">View</span>, sortable: false,
      cell: (b) => <button type="button" className="cc-icon-btn" aria-label={`View batch ${b.batchNo}`} onClick={() => onView(b)}><Eye size={14} /></button> },
  ]
  return (
    <CardState state={{ loading: !batches.length && !!state?.loading, data: batches, error: !batches.length ? state?.error || null : null, retry: state?.retry }} empty={batches.length ? null : empty}>
      <KitTable compact={compact} columns={cols} rows={batches} getRowId={(b) => b.id} className="ql-batches" empty={empty} />
    </CardState>
  )
}
