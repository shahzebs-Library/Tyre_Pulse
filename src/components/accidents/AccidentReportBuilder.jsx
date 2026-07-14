/**
 * AccidentReportBuilder — a customizable, block-based report designer embedded in
 * the Accidents module. Compose a branded report from ordered blocks (cover/logo,
 * KPI rows, charts, auto key-findings, rich text, detail tables, dividers, page
 * breaks), see a live WYSIWYG "paper" preview, export a pixel-faithful branded PDF,
 * start from the pre-built template library, and save/load named layouts to the org
 * (accident_report_templates, V221) with an offline-safe local fallback.
 *
 * Saved layouts are also schedulable from Scheduled Reports (report_type
 * `builder:<template-id>`), so any report designed here can be generated and
 * delivered on a cadence from anywhere in the app.
 *
 * Block/chart/KPI catalogs and the PDF renderer live in src/lib/accidentReport.js
 * and src/lib/accidentReportPdf.js (single source — do NOT duplicate them here).
 *
 * All pickers are true modal dialogs (fixed overlay), NOT in-card dropdowns —
 * the global `.card` style clips overflow, which used to hide the old menus.
 *
 * All data is live from the accident record set passed in — nothing fabricated.
 */
import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, Doughnut, Line, Radar, PolarArea } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, LineElement, PointElement, Filler, Title, Tooltip, Legend,
  RadialLinearScale, RadarController, PolarAreaController,
} from 'chart.js'
import {
  Plus, Image as ImageIcon, BarChart3, Type, Table2, SeparatorHorizontal,
  Trash2, ChevronUp, ChevronDown, Copy, FileText, Save, FolderOpen, X,
  LayoutGrid, Loader2, Sparkles, Settings2, Lightbulb, Minus, Search,
  LayoutTemplate, CalendarClock, CheckCircle, AlertCircle, Info, Palette, Scissors,
  FileSpreadsheet, Filter, ArrowUpDown, RotateCcw,
} from 'lucide-react'
import {
  CHARTS, KPIS, TABLE_COLS, BLOCK_TYPES, CHART_OPTS,
  REPORT_LIBRARY, STARTER, makeBlock, buildReportContext, buildInsights,
  fmtCell, cellValue, isChartEmpty, normalizeConfig, VALUE_LABELS_PLUGIN,
} from '../../lib/accidentReport'
// Palette catalog + styling helper live in the shared engine (accidentReport.js,
// authored alongside this file). Imported via namespace with safe fallbacks so a
// preview render never breaks if the engine build lands a moment later; once the
// engine exports are present they are always used verbatim (single source).
import * as AccidentReportLib from '../../lib/accidentReport'
import { useAuth } from '../../contexts/AuthContext'
import { renderAccidentReportPdf } from '../../lib/accidentReportPdf'
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from '../../lib/api/accidentReportTemplates'
import { formatCurrencyCompact } from '../../lib/formatters'
import { reportFileName, reportDateLabel, exportToExcel } from '../../lib/exportUtils'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement, LineElement, PointElement, Filler,
  RadialLinearScale, RadarController, PolarAreaController, Title, Tooltip, Legend,
)

const CHART_COMPONENT = {
  doughnut: Doughnut, line: Line, bar: Bar, 'bar-h': Bar, 'bar-stack': Bar,
  radar: Radar, polar: PolarArea, pareto: Bar, combo: Bar, waterfall: Bar,
}

// Palette catalog + chart-data styler resolved from the shared engine, with
// conservative fallbacks (identity styler, single default palette) that keep the
// preview alive if the engine export lands a moment after this component.
const PALETTES = AccidentReportLib.PALETTES || {
  default: ['#f97316', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#f59e0b'],
}
const styleChartData = typeof AccidentReportLib.styleChartData === 'function'
  ? AccidentReportLib.styleChartData
  : (data) => data

const PALETTE_LABELS = {
  default: 'Default', cool: 'Cool', warm: 'Warm', mono: 'Mono', contrast: 'Contrast', pastel: 'Pastel',
  forest: 'Forest (green)', slate: 'Slate (gray)', ocean: 'Ocean', sunset: 'Sunset', earth: 'Earth', vibrant: 'Vibrant',
}
// Ordered palette keys from the engine (all palettes, incl. the new green/gray sets);
// fall back to whatever PALETTES exposes so the picker still enumerates mid-race.
const PALETTE_KEYS = Array.isArray(AccidentReportLib.PALETTE_KEYS) && AccidentReportLib.PALETTE_KEYS.length
  ? AccidentReportLib.PALETTE_KEYS
  : Object.keys(PALETTES)
const titleCase = (k) => String(k || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const paletteLabel = (k) => PALETTE_LABELS[k] || titleCase(k)

// Border-width and data-label-size choices surfaced in the Advanced formatting panel.
const BORDER_WIDTHS = [1, 1.5, 2, 3]
const LABEL_SIZES = [9, 10, 11, 12, 14, 16]

// Merge chart.js options honoring the block's legend / gridline / data-label
// (colour+size) / border choices. Prefer the shared engine builder so preview ==
// PDF exactly; fall back to a faithful inline merge if the export lands late.
const chartOptionsFor = typeof AccidentReportLib.chartOptionsFor === 'function'
  ? AccidentReportLib.chartOptionsFor
  : (block = {}, baseOpts = {}) => {
      const plugins = { ...(baseOpts.plugins || {}) }
      plugins.valueLabels = {
        ...(plugins.valueLabels || {}),
        enabled: block.showLabels !== false,
        ...(block.labelColor ? { color: block.labelColor } : {}),
        ...(block.labelSize ? { size: block.labelSize } : {}),
      }
      plugins.legend = { ...(plugins.legend || {}), display: block.showLegend !== false }
      const opts = { ...baseOpts, plugins }
      if (baseOpts.scales && block.showGrid === false) {
        opts.scales = {}
        for (const [axis, cfg] of Object.entries(baseOpts.scales)) {
          opts.scales[axis] = { ...(cfg || {}), grid: { ...((cfg && cfg.grid) || {}), display: false } }
        }
      }
      return opts
    }

// Preview column width per chart-block width setting; non-chart + full charts take a whole row.
const BLOCK_GUTTER = 16 // px, matches the flex gap between blocks
const chartWidthStyle = (w) => {
  if (w === 'half') return { flexBasis: `calc(50% - ${BLOCK_GUTTER / 2}px)`, maxWidth: `calc(50% - ${BLOCK_GUTTER / 2}px)` }
  if (w === 'third') return { flexBasis: `calc(33.333% - ${(BLOCK_GUTTER * 2) / 3}px)`, maxWidth: `calc(33.333% - ${(BLOCK_GUTTER * 2) / 3}px)` }
  if (w === 'quarter') return { flexBasis: `calc(25% - ${(BLOCK_GUTTER * 3) / 4}px)`, maxWidth: `calc(25% - ${(BLOCK_GUTTER * 3) / 4}px)` }
  return { flexBasis: '100%', maxWidth: '100%' }
}
const CHART_WIDTHS = [['full', 'Full'], ['half', 'Half'], ['third', 'Third'], ['quarter', 'Quarter']]
// Compact preview heights so half/third/quarter charts read cleanly side by side.
const CHART_PREVIEW_HEIGHT = { full: 240, half: 200, third: 168, quarter: 150 }

// A4 page geometry (mm). The preview sheet is scaled to its rendered width, so one
// page's pixel height = (renderedWidthPx / pageWidthMm) * pageHeightMm — this makes
// the page-end guides self-adjust to any responsive width.
const A4 = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } }

// ── Detail-table advanced controls (filter / sort / density / Excel export) ──
// The select option catalog (TABLE_FILTER_OPTS), the filtered+sorted+capped row
// engine (tableRows) and the Excel matrix builder (tableExportMatrix) live in the
// shared engine (accidentReport.js). Resolve them from the namespace import with
// safe fallbacks so a mid-race build still previews and exports honestly.
const TABLE_FILTER_OPTS = AccidentReportLib.TABLE_FILTER_OPTS || { claims: [], status: [], severity: [], fault: [] }
const tableRowsFor = typeof AccidentReportLib.tableRows === 'function'
  ? AccidentReportLib.tableRows
  : (recs, block) => (Array.isArray(recs) ? recs : []).slice(0, Math.max(1, (block && block.limit) || 25))
const tableExportMatrixFor = typeof AccidentReportLib.tableExportMatrix === 'function'
  ? AccidentReportLib.tableExportMatrix
  : null
const FILTER_GROUPS = [['claims', 'Claims'], ['status', 'Status'], ['severity', 'Severity'], ['fault', 'Fault']]
// A filter value counts as active (worth showing in the caption) when it is set and
// is not one of the "show everything" sentinels the engine uses for its first option.
const isActiveFilterVal = (v) => v != null && v !== '' && v !== 'all' && v !== 'any'
const firstFilterOpt = (group) => (TABLE_FILTER_OPTS[group]?.[0]?.[0]) ?? ''
// Human-readable, ASCII summary of the active table filter for the preview caption.
const tableFilterLabel = (block) => {
  const f = (block && block.filter) || {}
  const parts = []
  for (const [group] of FILTER_GROUPS) {
    if (!isActiveFilterVal(f[group])) continue
    const opt = (TABLE_FILTER_OPTS[group] || []).find(([v]) => v === f[group])
    if (opt) parts.push(opt[1])
  }
  if (f.dateFrom || f.dateTo) parts.push(`${f.dateFrom || 'start'} to ${f.dateTo || 'now'}`)
  return parts.join(' | ')
}

const BLOCK_ICONS = {
  header: ImageIcon, kpis: LayoutGrid, chart: BarChart3, insights: Lightbulb,
  text: Type, table: Table2, divider: Minus, pagebreak: SeparatorHorizontal,
}

const LS_KEY = 'accidentReportBuilder.local.v1'

export default function AccidentReportBuilder({ records = [], company = 'TyrePulse', currency = 'SAR' }) {
  const navigate = useNavigate()
  const { profile } = useAuth() || {}
  // Advanced chart formatting (data labels / borders / palettes) is an Admin and
  // Super Admin capability only; everyone else still sees the styled charts.
  const canFormat = profile?.is_super_admin === true || profile?.role === 'Admin'
  const claimsCtx = useMemo(() => buildReportContext(records, currency), [records, currency])
  const money = useCallback((v) => (v == null || v === '' ? 'N/A' : formatCurrencyCompact(v, currency)), [currency])

  const [blocks, setBlocks] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
      if (s?.blocks?.length) return normalizeConfig(s).blocks
    } catch { /* ignore */ }
    return STARTER()
  })
  const [orientation, setOrientation] = useState(() => {
    try { return normalizeConfig(JSON.parse(localStorage.getItem(LS_KEY) || 'null')).orientation } catch { return 'portrait' }
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState(null)
  const [lastAdded, setLastAdded] = useState(null)

  const [templates, setTemplates] = useState([])
  const [tplId, setTplId] = useState('')
  const [tplName, setTplName] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const chartRefs = useRef({})
  const endRef = useRef(null)
  const paperRef = useRef(null)
  // Estimated A4 page-break positions (px from the sheet top) drawn as guides so a
  // designer can see where "one page ends and another begins" before exporting.
  const [pageMarks, setPageMarks] = useState([])

  // Persist working draft locally so a refresh never loses layout work.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ blocks, orientation })) } catch { /* ignore */ }
  }, [blocks, orientation])

  useEffect(() => { listTemplates().then(setTemplates).catch(() => setTemplates([])) }, [])
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { if (!lastAdded) return undefined; const t = setTimeout(() => setLastAdded(null), 1800); return () => clearTimeout(t) }, [lastAdded])

  // Measure the rendered sheet and derive page-end guide positions. Re-runs on any
  // layout/size change (blocks, orientation, chart async paint, responsive width).
  useEffect(() => {
    const el = paperRef.current
    if (!el || !blocks.length) { setPageMarks([]); return undefined }
    const measure = () => {
      const width = el.clientWidth
      if (!width) return
      const geo = A4[orientation === 'landscape' ? 'landscape' : 'portrait']
      const pageH = (width / geo.w) * geo.h
      const total = el.scrollHeight
      if (!(pageH > 0) || total <= pageH) { setPageMarks([]); return }
      const marks = []
      for (let n = 1, y = pageH; y < total - 8 && n < 60; n += 1, y += pageH) marks.push({ n, y })
      setPageMarks(marks)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [blocks, orientation])

  // ── Block ops ───────────────────────────────────────────────────────────────
  const addBlock = (type) => {
    const b = makeBlock(type)
    setBlocks((prev) => [...prev, b])
    setPickerOpen(false)
    setDirty(true)
    setLastAdded(b.id)
    setToast({ t: 'ok', m: `${BLOCK_TYPES[type].label} block added.` })
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
  }
  const patchBlock = (id, patch) => { setBlocks((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x))); setDirty(true) }
  const removeBlock = (id) => { setBlocks((b) => b.filter((x) => x.id !== id)); setDirty(true) }
  const dupBlock = (id) => { setBlocks((b) => { const i = b.findIndex((x) => x.id === id); if (i < 0) return b; const copy = { ...b[i], id: makeBlock(b[i].type).id }; return [...b.slice(0, i + 1), copy, ...b.slice(i + 1)] }); setDirty(true) }
  const move = (id, dir) => { setBlocks((b) => { const i = b.findIndex((x) => x.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= b.length) return b; const n = [...b]; [n[i], n[j]] = [n[j], n[i]]; return n }); setDirty(true) }

  // ── Library / templates ─────────────────────────────────────────────────────
  const config = useMemo(() => ({ blocks, orientation }), [blocks, orientation])

  const applyLibraryLayout = (item) => {
    setBlocks(item.build())
    setOrientation(item.orientation || 'portrait')
    setTplId(''); setTplName(item.name); setDirty(true)
    setLibraryOpen(false)
    setToast({ t: 'ok', m: `“${item.name}” applied — save it to make it schedulable.` })
  }
  const loadTemplate = (row) => {
    const cfg = normalizeConfig(row.config)
    setBlocks(cfg.blocks); setOrientation(cfg.orientation)
    setTplId(row.id); setTplName(row.name); setDirty(false)
    setLibraryOpen(false)
    setToast({ t: 'ok', m: `Loaded “${row.name}”.` })
  }
  const removeTemplate = async (row) => {
    try {
      await deleteTemplate(row.id)
      setTemplates((ts) => ts.filter((x) => x.id !== row.id))
      if (tplId === row.id) { setTplId(''); setDirty(true) }
    } catch (e) { setToast({ t: 'err', m: e?.message || 'Delete failed.' }) }
  }
  const newTemplate = () => { setTplId(''); setTplName(''); setBlocks(STARTER()); setOrientation('portrait'); setDirty(false); setToast({ t: 'ok', m: 'Started a fresh layout.' }) }

  const saveTemplate = async () => {
    const name = (tplName || '').trim()
    if (!name) { setToast({ t: 'err', m: 'Give the layout a name first.' }); return }
    setSaving(true)
    try {
      if (tplId) {
        const row = await updateTemplate(tplId, { name, config })
        setTemplates((ts) => ts.map((x) => (x.id === row.id ? row : x)))
      } else {
        const row = await createTemplate({ name, config })
        setTemplates((ts) => [row, ...ts]); setTplId(row.id)
      }
      setDirty(false)
      setToast({ t: 'ok', m: `Layout “${name}” saved — you can now schedule it in Scheduled Reports.` })
    } catch (e) {
      setToast({ t: 'err', m: e?.message || 'Could not save layout (draft kept locally).' })
    } finally { setSaving(false) }
  }

  // ── PDF export (shared renderer; charts rasterised from the live canvases) ───
  const exportPdf = useCallback(async () => {
    setExporting(true)
    try {
      await renderAccidentReportPdf({
        config, records, company, currency,
        filename: reportFileName(company, 'Accident Report', reportDateLabel()),
        chartImageFor: (b) => chartRefs.current[b.id]?.toBase64Image?.('image/png', 1) || null,
      })
      setToast({ t: 'ok', m: 'PDF exported.' })
    } catch (e) {
      setToast({ t: 'err', m: e?.message || 'Export failed.' })
    } finally { setExporting(false) }
  }, [config, records, company, currency])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-[70] flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg border ${toast.t === 'ok' ? 'bg-green-500/15 border-green-500/40 text-green-300' : 'bg-red-500/15 border-red-500/40 text-red-300'}`}>
          {toast.t === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          <span className="max-w-sm">{toast.m}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="card !overflow-visible">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setPickerOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={15} /> Add block</button>
          <button onClick={() => setLibraryOpen(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <LayoutTemplate size={14} /> Library{templates.length ? ` (${templates.length})` : ''}
          </button>
          <button onClick={newTemplate} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Sparkles size={14} /> New</button>

          <div className="h-6 w-px bg-[var(--input-border)] mx-1 hidden sm:block" />

          <div className="flex items-center gap-2">
            <input value={tplName} onChange={(e) => { setTplName(e.target.value); setDirty(true) }} placeholder="Layout name…" className="input text-sm w-44" />
            <button onClick={saveTemplate} disabled={saving} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {tplId ? 'Update' : 'Save'}
            </button>
            {dirty && <span className="inline-flex items-center gap-1 text-[11px] text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Unsaved</span>}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex flex-col items-end">
              <select value={orientation} onChange={(e) => { setOrientation(e.target.value); setDirty(true) }} className="input text-sm" aria-label="Page orientation">
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
              <span className="text-[10px] text-[var(--text-muted)] mt-0.5 leading-none">
                A4 · {orientation === 'landscape' ? 'Landscape · 297×210mm' : 'Portrait · 210×297mm'}
              </span>
            </div>
            <button onClick={exportPdf} disabled={exporting || !blocks.length} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Export PDF
            </button>
          </div>
        </div>

        {/* Context ribbon */}
        <div className="mt-3 pt-3 border-t border-[var(--input-border)] flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5"><Info size={12} /> {records.length} incident{records.length === 1 ? '' : 's'} in scope (current Accidents filter set)</span>
          <span>{blocks.length} block{blocks.length === 1 ? '' : 's'}</span>
          {tplId && (
            <button onClick={() => navigate('/scheduled-reports')} className="inline-flex items-center gap-1.5 text-orange-400 hover:text-orange-300">
              <CalendarClock size={12} /> Schedule this report
            </button>
          )}
        </div>
      </div>

      {/* Builder + preview */}
      {blocks.length === 0 ? (
        <div className="card text-center py-14">
          <LayoutGrid size={34} className="mx-auto mb-3 text-[var(--text-muted)] opacity-60" />
          <p className="text-[var(--text-primary)] font-medium">Empty report</p>
          <p className="text-[var(--text-muted)] text-sm mt-1 mb-5">Add your first block, or start from a professional pack in the library.</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button onClick={() => setPickerOpen(true)} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={15} /> Add block</button>
            <button onClick={() => setLibraryOpen(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5"><LayoutTemplate size={14} /> Open library</button>
          </div>
        </div>
      ) : (
        <div className={`mx-auto w-full bg-white text-slate-800 rounded-xl shadow-2xl border border-black/10 transition-[max-width] duration-300 ease-in-out ${orientation === 'landscape' ? 'max-w-[1120px]' : 'max-w-[860px]'}`}>
          <div ref={paperRef} className="relative p-6 sm:p-8 flex flex-wrap items-stretch" style={{ gap: BLOCK_GUTTER }}>
            {blocks.map((b, i) => {
              const w = b.type === 'chart' ? (b.width || 'full') : 'full'
              return (
                <div key={b.id} style={{ ...chartWidthStyle(w), minWidth: 0 }}>
                  <BlockEditor
                    block={b} index={i} count={blocks.length} canFormat={canFormat}
                    ctx={claimsCtx} records={records} money={money} company={company}
                    chartRefs={chartRefs} highlight={lastAdded === b.id} orientation={orientation}
                    onPatch={patchBlock} onRemove={removeBlock} onDup={dupBlock} onMove={move}
                  />
                </div>
              )
            })}
            <div ref={endRef} style={{ flexBasis: '100%' }} />

            {/* Page-end guides — approximate A4 boundaries, non-interactive overlay */}
            {pageMarks.map((m) => (
              <div key={m.n} className="pointer-events-none absolute left-0 right-0 z-20 flex items-center gap-2 px-6 sm:px-8 -translate-y-1/2" style={{ top: m.y }}>
                <div className="flex-1 border-t-2 border-dashed border-rose-400/70" />
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-rose-600 bg-white px-2 py-0.5 rounded-full border border-rose-200 whitespace-nowrap shadow-sm">
                  <Scissors size={11} /> Page {m.n} ends | Page {m.n + 1}
                </span>
                <div className="flex-1 border-t-2 border-dashed border-rose-400/70" />
              </div>
            ))}
          </div>
        </div>
      )}

      {pickerOpen && <BlockPickerModal onPick={addBlock} onClose={() => setPickerOpen(false)} />}
      {libraryOpen && (
        <LibraryModal
          templates={templates}
          onApplyLibrary={applyLibraryLayout}
          onLoad={loadTemplate}
          onDelete={removeTemplate}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  )
}

/* ── Modal shell (fixed overlay — immune to the .card overflow clipping) ────── */
function ModalShell({ title, subtitle, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-[var(--surface-2,#111)] border border-[var(--border-bright,rgba(255,255,255,0.12))] rounded-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} shadow-2xl flex flex-col max-h-[88vh]`}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-[var(--input-border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--input-bg-hover)]" aria-label="Close"><X size={18} className="text-[var(--text-secondary)]" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
      </div>
    </div>
  )
}

/* ── Rich “Add block” picker ─────────────────────────────────────────────────── */
function BlockPickerModal({ onPick, onClose }) {
  return (
    <ModalShell title="Add a block" subtitle="Blocks stack top-to-bottom and print exactly as previewed." onClose={onClose} wide>
      <div className="grid sm:grid-cols-2 gap-3">
        {Object.entries(BLOCK_TYPES).map(([type, meta]) => {
          const Icon = BLOCK_ICONS[type] || LayoutGrid
          return (
            <button
              key={type} onClick={() => onPick(type)}
              className="text-left p-4 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] hover:border-orange-500/50 transition-colors group"
            >
              <span className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-lg bg-orange-500/10 text-orange-400 flex items-center justify-center flex-shrink-0 group-hover:bg-orange-500/20"><Icon size={17} /></span>
                <span className="font-medium text-sm text-[var(--text-primary)]">{meta.label}</span>
              </span>
              <span className="block text-xs text-[var(--text-muted)] mt-2 leading-relaxed">{meta.description}</span>
            </button>
          )
        })}
      </div>
    </ModalShell>
  )
}

/* ── Library: pre-built packs + saved org layouts ───────────────────────────── */
function LibraryModal({ templates, onApplyLibrary, onLoad, onDelete, onClose }) {
  const [tab, setTab] = useState('prebuilt')
  const [q, setQ] = useState('')
  const filtered = templates.filter((t) => !q || (t.name || '').toLowerCase().includes(q.toLowerCase()))
  return (
    <ModalShell title="Report library" subtitle="Start from a professional pack, or reload a saved layout. Saved layouts can be scheduled from Scheduled Reports." onClose={onClose} wide>
      <div className="flex items-center gap-2 mb-4">
        {[['prebuilt', `Template packs (${REPORT_LIBRARY.length})`], ['saved', `My saved layouts (${templates.length})`]].map(([k, label]) => (
          <button
            key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${tab === k ? 'bg-orange-500 border-orange-500 text-white' : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'prebuilt' && (
        <div className="grid sm:grid-cols-2 gap-3">
          {REPORT_LIBRARY.map((item) => (
            <div key={item.key} className="p-4 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] flex flex-col">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center flex-shrink-0"><LayoutTemplate size={17} /></span>
                <div>
                  <p className="font-medium text-sm text-[var(--text-primary)]">{item.name}</p>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{item.build().length} blocks · {item.orientation}</p>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed flex-1">{item.description}</p>
              <button onClick={() => onApplyLibrary(item)} className="btn-primary text-xs mt-3 self-start inline-flex items-center gap-1.5"><Plus size={13} /> Use this layout</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'saved' && (
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search saved layouts…" className="input text-sm w-full pl-9" />
          </div>
          {filtered.length === 0 ? (
            <div className="text-center py-10">
              <FolderOpen size={28} className="mx-auto mb-2 text-[var(--text-muted)] opacity-60" />
              <p className="text-sm text-[var(--text-secondary)]">{templates.length === 0 ? 'No saved layouts yet.' : 'No layouts match the search.'}</p>
              {templates.length === 0 && <p className="text-xs text-[var(--text-muted)] mt-1">Design a report, name it, and press Save — it lands here and in Scheduled Reports.</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((row) => (
                <div key={row.id} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)]">
                  <span className="w-8 h-8 rounded-lg bg-green-500/10 text-green-400 flex items-center justify-center flex-shrink-0"><FileText size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{row.name}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {(normalizeConfig(row.config).blocks || []).length} blocks
                      {row.updated_at ? ` · updated ${String(row.updated_at).slice(0, 10)}` : ''}
                    </p>
                  </div>
                  <button onClick={() => onLoad(row)} className="btn-secondary text-xs">Load</button>
                  <button onClick={() => onDelete(row)} className="p-1.5 rounded text-[var(--text-muted)] hover:text-red-400" title="Delete layout"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ModalShell>
  )
}

/* ── Per-block editor + WYSIWYG preview ──────────────────────────────────────── */
function BlockEditor({ block: b, index, count, ctx, records, money, company, chartRefs, highlight, orientation, canFormat, onPatch, onRemove, onDup, onMove }) {
  const [openCfg, setOpenCfg] = useState(false)
  const meta = BLOCK_TYPES[b.type] || { label: b.type }
  const Icon = BLOCK_ICONS[b.type] || LayoutGrid

  return (
    <div className={`group relative rounded-lg ring-1 transition-shadow ${highlight ? 'ring-orange-400' : 'ring-transparent hover:ring-slate-200'}`}>
      {/* Block toolbar (hover) */}
      <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200 inline-flex items-center gap-1"><Icon size={11} /> {meta.label}</span>
        <IconBtn title="Configure" active={openCfg} onClick={() => setOpenCfg((v) => !v)}><Settings2 size={13} /></IconBtn>
        <IconBtn title="Move up" disabled={index === 0} onClick={() => onMove(b.id, -1)}><ChevronUp size={13} /></IconBtn>
        <IconBtn title="Move down" disabled={index === count - 1} onClick={() => onMove(b.id, 1)}><ChevronDown size={13} /></IconBtn>
        <IconBtn title="Duplicate" onClick={() => onDup(b.id)}><Copy size={13} /></IconBtn>
        <IconBtn title="Remove" danger onClick={() => onRemove(b.id)}><Trash2 size={13} /></IconBtn>
      </div>

      {openCfg && <BlockConfig block={b} onPatch={onPatch} canFormat={canFormat} records={records} money={money} />}

      <BlockPreview block={b} ctx={ctx} records={records} money={money} company={company} chartRefs={chartRefs} orientation={orientation} />
    </div>
  )
}

function IconBtn({ children, onClick, title, danger, disabled, active }) {
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`p-1 rounded border disabled:opacity-30 ${active ? 'bg-orange-50 border-orange-300 text-orange-600' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'} ${danger ? 'hover:text-red-600 hover:border-red-300' : ''}`}>
      {children}
    </button>
  )
}

function Field({ label, children }) { return <label className="block"><span className="block text-[11px] font-medium text-slate-500 mb-1">{label}</span>{children}</label> }
const INP = 'w-full rounded-md border border-slate-300 bg-white text-slate-800 text-sm px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400/40 focus:border-orange-400'

function ColorField({ value, fallback, onChange, resetLabel = 'Auto' }) {
  const isDefault = value == null || value === ''
  return (
    <div className="flex items-center gap-2">
      <input
        type="color" value={value || fallback} onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 rounded border border-slate-300 bg-white p-0.5 cursor-pointer"
      />
      <button
        type="button" onClick={() => onChange(null)}
        className={`text-xs px-2 py-1 rounded border ${isDefault ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'}`}
      >{resetLabel}</button>
    </div>
  )
}

function BlockConfig({ block: b, onPatch, canFormat, records = [], money }) {
  const set = (patch) => onPatch(b.id, patch)
  const [advOpen, setAdvOpen] = useState(false)
  return (
    <div className="mb-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
      {b.type === 'header' && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Title"><input className={INP} value={b.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Subtitle"><input className={INP} value={b.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
          <Field label="Logo"><input type="file" accept="image/*" className="text-xs text-slate-600" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = (ev) => set({ logo: ev.target.result }); rd.readAsDataURL(f) }} /></Field>
          <label className="flex items-center gap-2 mt-5 text-sm text-slate-600"><input type="checkbox" checked={!!b.showDate} onChange={(e) => set({ showDate: e.target.checked })} /> Show generation date</label>
        </div>
      )}
      {b.type === 'kpis' && (
        <div>
          <p className="text-[11px] font-medium text-slate-500 mb-2">KPIs to show</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(KPIS).map(([k, def]) => { const on = (b.items || []).includes(k); return (
              <button key={k} onClick={() => set({ items: on ? b.items.filter((x) => x !== k) : [...(b.items || []), k] })} className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'}`}>{def.label}</button>
            ) })}
          </div>
        </div>
      )}
      {b.type === 'chart' && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Chart"><select className={INP} value={b.chart} onChange={(e) => set({ chart: e.target.value })}>{Object.entries(CHARTS).map(([k, def]) => <option key={k} value={k}>{def.label}</option>)}</select></Field>
          <Field label="Title (optional)"><input className={INP} value={b.title} onChange={(e) => set({ title: e.target.value })} placeholder={CHARTS[b.chart]?.label} /></Field>
          <Field label="Width">
            <div className="flex rounded-md border border-slate-300 overflow-hidden">
              {CHART_WIDTHS.map(([val, label]) => { const on = (b.width || 'full') === val; return (
                <button
                  key={val} type="button" onClick={() => set({ width: val })}
                  className={`flex-1 text-xs py-1.5 font-medium transition-colors ${on ? 'bg-orange-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'} ${val !== 'full' ? 'border-l border-slate-300' : ''}`}
                >{label}</button>
              ) })}
            </div>
            <span className="block text-[11px] text-slate-400 mt-1">Half, third and quarter widths pack 2, 3 or 4 charts side by side per row.</span>
          </Field>
          {CHARTS[b.chart]?.description && <p className="text-[11px] text-slate-400 sm:col-span-2">{CHARTS[b.chart].description}</p>}

          {canFormat && (
            <div className="sm:col-span-2 mt-1 pt-3 border-t border-slate-200">
              <button
                type="button" onClick={() => setAdvOpen((v) => !v)}
                className="flex w-full items-center gap-1.5 text-left"
                aria-expanded={advOpen}
              >
                <Palette size={13} className="text-orange-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Advanced formatting (Admin only)</span>
                {advOpen ? <ChevronUp size={14} className="ml-auto text-slate-400" /> : <ChevronDown size={14} className="ml-auto text-slate-400" />}
              </button>

              {advOpen && (
                <div className="mt-3 space-y-4">
                  {/* Toggles: data labels, borders, legend, gridlines */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={b.showLabels !== false} onChange={(e) => set({ showLabels: e.target.checked })} /> Data labels
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={!!b.showBorders} onChange={(e) => set({ showBorders: e.target.checked })} /> Borders
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={b.showLegend !== false} onChange={(e) => set({ showLegend: e.target.checked })} /> Legend
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={b.showGrid !== false} onChange={(e) => set({ showGrid: e.target.checked })} /> Gridlines
                    </label>
                  </div>

                  {/* Data-label colour + size (only when labels are on) */}
                  {b.showLabels !== false && (
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label="Label colour">
                        <ColorField value={b.labelColor} fallback="#334155" onChange={(v) => set({ labelColor: v })} />
                      </Field>
                      <Field label="Label size">
                        <select className={INP} value={b.labelSize || 11} onChange={(e) => set({ labelSize: +e.target.value })}>
                          {LABEL_SIZES.map((s) => <option key={s} value={s}>{s} px</option>)}
                        </select>
                      </Field>
                    </div>
                  )}

                  {/* Border colour + width (only when borders are on) */}
                  {b.showBorders && (
                    <div className="grid sm:grid-cols-2 gap-3">
                      <Field label="Border colour">
                        <ColorField value={b.borderColor} fallback="#334155" onChange={(v) => set({ borderColor: v })} resetLabel="Palette default" />
                      </Field>
                      <Field label="Border width">
                        <select className={INP} value={b.borderWidth || 1.5} onChange={(e) => set({ borderWidth: +e.target.value })}>
                          {BORDER_WIDTHS.map((w) => <option key={w} value={w}>{w} px</option>)}
                        </select>
                      </Field>
                    </div>
                  )}

                  {/* Palette picker — every engine palette (incl. green Forest / gray Slate) */}
                  <div>
                    <p className="text-[11px] font-medium text-slate-500 mb-1.5">Colour palette</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {PALETTE_KEYS.map((key) => {
                        const colors = PALETTES[key] || []
                        const on = (b.palette || 'default') === key
                        return (
                          <button
                            key={key} type="button" onClick={() => set({ palette: key })}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-left transition-colors ${on ? 'border-orange-400 bg-orange-50 ring-1 ring-orange-300' : 'border-slate-300 bg-white hover:border-slate-400'}`}
                          >
                            <span className="flex items-center gap-0.5">
                              {(Array.isArray(colors) ? colors : []).slice(0, 6).map((c, i) => (
                                <span key={i} className="w-3 h-3 rounded-sm border border-black/10" style={{ background: c }} />
                              ))}
                            </span>
                            <span className={`text-xs font-medium ${on ? 'text-orange-700' : 'text-slate-600'}`}>{paletteLabel(key)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {b.type === 'insights' && (
        <Field label="Heading"><input className={INP} value={b.title} onChange={(e) => set({ title: e.target.value })} placeholder="Key findings" /></Field>
      )}
      {b.type === 'text' && (
        <div className="space-y-2">
          <Field label="Heading (optional)"><input className={INP} value={b.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Body"><textarea rows={4} className={INP} value={b.body} onChange={(e) => set({ body: e.target.value })} placeholder="Commentary, findings, recommendations…" /></Field>
        </div>
      )}
      {b.type === 'table' && (
        <TableBlockConfig b={b} set={set} records={records} money={money} />
      )}
      {b.type === 'divider' && (
        <Field label="Section label (optional)"><input className={INP} value={b.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Claims performance" /></Field>
      )}
      {b.type === 'pagebreak' && <p className="text-xs text-slate-500">Forces the following blocks onto a new PDF page.</p>}
    </div>
  )
}

/* ── Detail-table config: columns + max rows + filters + sort + density + Excel ── */
function TableBlockConfig({ b, set, records = [], money }) {
  const chosenCols = (b.columns || []).filter((c) => TABLE_COLS[c])
  const filter = b.filter || {}
  const sort = b.sort || {}

  const setFilter = (key, val) => set({ filter: { ...filter, [key]: val } })
  const resetFilters = () => set({
    filter: {
      claims: firstFilterOpt('claims'), status: firstFilterOpt('status'),
      severity: firstFilterOpt('severity'), fault: firstFilterOpt('fault'),
      dateFrom: '', dateTo: '',
    },
  })
  const filtersActive = FILTER_GROUPS.some(([g]) => isActiveFilterVal(filter[g])) || filter.dateFrom || filter.dateTo

  // Export the CURRENTLY FILTERED/SORTED/CAPPED rows to Excel. Prefer the shared
  // engine matrix builder; fall back to the chosen columns over the filtered rows
  // so an export still works honestly if the engine export lands a moment later.
  const exportExcel = () => {
    if (!chosenCols.length) return
    let matrix
    if (tableExportMatrixFor) {
      matrix = tableExportMatrixFor(records, b, money)
    } else {
      const rows = tableRowsFor(records, b).map((r) => {
        const o = {}
        chosenCols.forEach((c) => { o[c] = fmtCell(c, cellValue(c, r), money) })
        return o
      })
      matrix = { headers: chosenCols.map((c) => TABLE_COLS[c]), colKeys: chosenCols, rows }
    }
    if (!matrix?.rows?.length || !matrix?.colKeys?.length) return
    const fname = reportFileName('TyrePulse', b.title || 'Detail table', reportDateLabel())
    exportToExcel(matrix.rows, matrix.colKeys, matrix.headers, fname)
  }

  const previewCount = tableRowsFor(records, b).length

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Title"><input className={INP} value={b.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Max rows"><input type="number" min="1" max="200" className={INP} value={b.limit} onChange={(e) => set({ limit: Math.max(1, Math.min(200, +e.target.value || 25)) })} /></Field>
      </div>

      <div>
        <p className="text-[11px] font-medium text-slate-500 mb-2">Columns</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(TABLE_COLS).map(([k, label]) => { const on = (b.columns || []).includes(k); return (
            <button key={k} onClick={() => set({ columns: on ? b.columns.filter((x) => x !== k) : [...(b.columns || []), k] })} className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'}`}>{label}</button>
          ) })}
        </div>
      </div>

      {/* Filters — narrow the printed rows (e.g. only open cases / open claims) */}
      <div className="pt-3 border-t border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Filter size={13} className="text-blue-500" /> Filters</span>
          {filtersActive && (
            <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800">
              <RotateCcw size={12} /> Reset
            </button>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {FILTER_GROUPS.map(([group, label]) => {
            const opts = TABLE_FILTER_OPTS[group] || []
            if (!opts.length) return null
            return (
              <Field key={group} label={label}>
                <select className={INP} value={filter[group] ?? firstFilterOpt(group)} onChange={(e) => setFilter(group, e.target.value)}>
                  {opts.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
                </select>
              </Field>
            )
          })}
          <Field label="Date from"><input type="date" className={INP} value={filter.dateFrom || ''} onChange={(e) => setFilter('dateFrom', e.target.value)} /></Field>
          <Field label="Date to"><input type="date" className={INP} value={filter.dateTo || ''} onChange={(e) => setFilter('dateTo', e.target.value)} /></Field>
        </div>
      </div>

      {/* Sort — order the printed rows by any chosen column */}
      <div className="pt-3 border-t border-slate-200">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2"><ArrowUpDown size={13} className="text-blue-500" /> Sort</span>
        <div className="grid sm:grid-cols-2 gap-3 items-end">
          <Field label="Sort by column">
            <select className={INP} value={sort.col || ''} onChange={(e) => set({ sort: { ...sort, col: e.target.value } })}>
              <option value="">Default order</option>
              {chosenCols.map((c) => <option key={c} value={c}>{TABLE_COLS[c]}</option>)}
            </select>
          </Field>
          <div className="flex rounded-md border border-slate-300 overflow-hidden">
            {[['asc', 'Ascending'], ['desc', 'Descending']].map(([val, lbl]) => { const on = (sort.dir || 'asc') === val; return (
              <button
                key={val} type="button" disabled={!sort.col} onClick={() => set({ sort: { ...sort, dir: val } })}
                className={`flex-1 text-xs py-1.5 font-medium transition-colors disabled:opacity-40 ${on ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'} ${val !== 'asc' ? 'border-l border-slate-300' : ''}`}
              >{lbl}</button>
            ) })}
          </div>
        </div>
      </div>

      {/* Density — printed row height */}
      <div className="pt-3 border-t border-slate-200">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Density</span>
        <div className="flex rounded-md border border-slate-300 overflow-hidden max-w-xs">
          {[['normal', 'Normal'], ['compact', 'Compact']].map(([val, lbl]) => { const on = (b.density || 'normal') === val; return (
            <button
              key={val} type="button" onClick={() => set({ density: val })}
              className={`flex-1 text-xs py-1.5 font-medium transition-colors ${on ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'} ${val !== 'normal' ? 'border-l border-slate-300' : ''}`}
            >{lbl}</button>
          ) })}
        </div>
      </div>

      {/* Excel export of exactly the filtered/sorted rows shown in the preview */}
      <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-2">
        <button
          type="button" onClick={exportExcel} disabled={!chosenCols.length || !previewCount}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          <FileSpreadsheet size={14} /> Export Excel
        </button>
        <span className="text-[11px] text-slate-500">Downloads the {previewCount} filtered row{previewCount === 1 ? '' : 's'} shown below.</span>
      </div>
    </div>
  )
}

function BlockPreview({ block: b, ctx, records, money, company, chartRefs, orientation = 'portrait' }) {
  const landscape = orientation === 'landscape'
  if (b.type === 'header') {
    const stamp = new Date().toISOString().slice(0, 10)
    return (
      <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
        {b.logo ? <img src={b.logo} alt="logo" className="h-14 w-auto object-contain" /> : <div className="h-14 w-14 rounded bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-slate-300"><ImageIcon size={20} /></div>}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{b.title || 'Report'}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{[b.subtitle, company, b.showDate ? `Generated ${stamp}` : ''].filter(Boolean).join('  |  ') || 'Accident & claims report'}</p>
        </div>
      </div>
    )
  }
  if (b.type === 'kpis') {
    const items = (b.items || []).filter((k) => KPIS[k])
    if (!items.length) return <Placeholder>No KPIs selected — configure this block.</Placeholder>
    return (
      <div className={`grid gap-3 ${landscape ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3'}`}>
        {items.map((k) => { const def = KPIS[k]; const raw = def.get(ctx); return (
          <div key={k} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
            <p className="text-lg font-bold text-slate-900 leading-tight">{def.money ? money(raw) : String(raw)}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">{def.label}</p>
          </div>
        ) })}
      </div>
    )
  }
  if (b.type === 'chart') {
    const def = CHARTS[b.chart]
    if (!def) return <Placeholder>Unknown chart.</Placeholder>
    // Style the data by the block's palette + border choice, and honor the
    // data-labels toggle — identical to the exported PDF so preview matches print.
    const data = styleChartData(def.build(ctx), b)
    const Comp = CHART_COMPONENT[def.kind]
    const baseOpts = CHART_OPTS[def.kind] || {}
    // Options come from the shared builder so legend / gridlines / data-label
    // colour+size / borders render in the preview exactly as the PDF prints them.
    const opts = chartOptionsFor(b, baseOpts)
    const width = b.width || 'full'
    const baseH = b.height || CHART_PREVIEW_HEIGHT[width] || 240
    return (
      <div>
        {(b.title || def.label) && <p className="text-sm font-semibold text-slate-800 mb-2">{b.title || def.label}</p>}
        <div style={{ height: Math.round(baseH * (landscape ? 0.85 : 1)) }} className="relative transition-[height] duration-300">
          {isChartEmpty(data) ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">No data for this chart yet</div>
            : <Comp ref={(el) => { chartRefs.current[b.id] = el }} data={data} options={opts} plugins={[VALUE_LABELS_PLUGIN]} />}
        </div>
      </div>
    )
  }
  if (b.type === 'insights') {
    const lines = buildInsights(ctx)
    return (
      <div>
        <h3 className="text-base font-bold text-slate-900 mb-2">{b.title || 'Key findings'}</h3>
        {lines.length === 0 ? (
          <p className="text-sm text-slate-400">No incidents in scope — findings appear automatically once there is data.</p>
        ) : (
          <ul className="space-y-1.5">
            {lines.map((ln, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700 leading-relaxed">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />{ln}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  if (b.type === 'text') {
    return (
      <div>
        {b.title && <h3 className="text-base font-bold text-slate-900 mb-1">{b.title}</h3>}
        <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{b.body || <span className="text-slate-400">Empty text block — add commentary in its config.</span>}</p>
      </div>
    )
  }
  if (b.type === 'table') {
    const cols = (b.columns || []).filter((c) => TABLE_COLS[c])
    if (!cols.length) return <Placeholder>No columns selected.</Placeholder>
    // Filtered + sorted + capped rows from the shared engine (same set the PDF and
    // Excel export use), so the preview shows exactly what will be printed/downloaded.
    const rows = tableRowsFor(records, b)
    const compact = b.density === 'compact'
    const thPad = compact ? 'px-2 py-1' : 'px-2.5 py-2'
    const tdPad = compact ? 'px-2 py-0.5' : 'px-2.5 py-1.5'
    const total = records.length
    const filterLabel = tableFilterLabel(b)
    const showCaption = rows.length < total || !!filterLabel
    return (
      <div>
        {b.title && <p className="text-sm font-semibold text-slate-800 mb-2">{b.title}</p>}
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-800 text-white">{cols.map((c) => <th key={c} className={`text-left font-semibold whitespace-nowrap ${thPad}`}>{TABLE_COLS[c]}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={cols.length} className="px-2.5 py-6 text-center text-slate-400">No incidents match the current filter.</td></tr>
                : rows.map((r, i) => (
                  <tr key={r.id || i} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>{cols.map((c) => <td key={c} className={`text-slate-700 whitespace-nowrap ${tdPad}`}>{fmtCell(c, cellValue(c, r), money)}</td>)}</tr>
                ))}
            </tbody>
          </table>
        </div>
        {showCaption && <p className="text-[11px] text-slate-400 mt-1">Showing {rows.length} of {total} incidents{filterLabel ? ` | ${filterLabel}` : ''}</p>}
      </div>
    )
  }
  if (b.type === 'divider') {
    return (
      <div className="flex items-center gap-3 py-1">
        {b.label && <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">{b.label}</span>}
        <div className="flex-1 border-t border-slate-300" />
      </div>
    )
  }
  if (b.type === 'pagebreak') return (
    <div className="flex items-center gap-2 py-1 text-amber-600">
      <div className="flex-1 border-t-2 border-dashed border-amber-400" />
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider bg-amber-50 border border-amber-300 rounded-full px-2 py-0.5 whitespace-nowrap">
        <SeparatorHorizontal size={11} /> Manual page break | new page starts here
      </span>
      <div className="flex-1 border-t-2 border-dashed border-amber-400" />
    </div>
  )
  return null
}

function Placeholder({ children }) { return <div className="rounded-lg bg-slate-50 border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">{children}</div> }
