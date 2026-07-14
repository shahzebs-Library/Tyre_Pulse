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
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, LineElement, PointElement, Filler, Title, Tooltip, Legend,
} from 'chart.js'
import {
  Plus, Image as ImageIcon, BarChart3, Type, Table2, SeparatorHorizontal,
  Trash2, ChevronUp, ChevronDown, Copy, FileText, Save, FolderOpen, X,
  LayoutGrid, Loader2, Sparkles, Settings2, Lightbulb, Minus, Search,
  LayoutTemplate, CalendarClock, CheckCircle, AlertCircle, Info,
} from 'lucide-react'
import {
  CHARTS, KPIS, TABLE_COLS, BLOCK_TYPES, CHART_OPTS,
  REPORT_LIBRARY, STARTER, makeBlock, buildReportContext, buildInsights,
  fmtCell, isChartEmpty, normalizeConfig,
} from '../../lib/accidentReport'
import { renderAccidentReportPdf } from '../../lib/accidentReportPdf'
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from '../../lib/api/accidentReportTemplates'
import { formatCurrencyCompact } from '../../lib/formatters'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, LineElement, PointElement, Filler, Title, Tooltip, Legend)

const CHART_COMPONENT = { doughnut: Doughnut, line: Line, bar: Bar, 'bar-h': Bar, 'bar-stack': Bar }

const BLOCK_ICONS = {
  header: ImageIcon, kpis: LayoutGrid, chart: BarChart3, insights: Lightbulb,
  text: Type, table: Table2, divider: Minus, pagebreak: SeparatorHorizontal,
}

const LS_KEY = 'accidentReportBuilder.local.v1'

export default function AccidentReportBuilder({ records = [], company = 'TyrePulse', currency = 'SAR' }) {
  const navigate = useNavigate()
  const claimsCtx = useMemo(() => buildReportContext(records, currency), [records, currency])
  const money = useCallback((v) => (v == null || v === '' ? '—' : formatCurrencyCompact(v, currency)), [currency])

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

  // Persist working draft locally so a refresh never loses layout work.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ blocks, orientation })) } catch { /* ignore */ }
  }, [blocks, orientation])

  useEffect(() => { listTemplates().then(setTemplates).catch(() => setTemplates([])) }, [])
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { if (!lastAdded) return undefined; const t = setTimeout(() => setLastAdded(null), 1800); return () => clearTimeout(t) }, [lastAdded])

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
          <div className="p-6 sm:p-8 space-y-5">
            {blocks.map((b, i) => (
              <BlockEditor
                key={b.id} block={b} index={i} count={blocks.length}
                ctx={claimsCtx} records={records} money={money} company={company}
                chartRefs={chartRefs} highlight={lastAdded === b.id} orientation={orientation}
                onPatch={patchBlock} onRemove={removeBlock} onDup={dupBlock} onMove={move}
              />
            ))}
            <div ref={endRef} />
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
function BlockEditor({ block: b, index, count, ctx, records, money, company, chartRefs, highlight, orientation, onPatch, onRemove, onDup, onMove }) {
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

      {openCfg && <BlockConfig block={b} onPatch={onPatch} />}

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

function BlockConfig({ block: b, onPatch }) {
  const set = (patch) => onPatch(b.id, patch)
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
          {CHARTS[b.chart]?.description && <p className="text-[11px] text-slate-400 sm:col-span-2">{CHARTS[b.chart].description}</p>}
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
        <div className="space-y-2">
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
        </div>
      )}
      {b.type === 'divider' && (
        <Field label="Section label (optional)"><input className={INP} value={b.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Claims performance" /></Field>
      )}
      {b.type === 'pagebreak' && <p className="text-xs text-slate-500">Forces the following blocks onto a new PDF page.</p>}
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
          <p className="text-sm text-slate-500 mt-0.5">{[b.subtitle, company, b.showDate ? `Generated ${stamp}` : ''].filter(Boolean).join('  ·  ') || 'Accident & claims report'}</p>
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
    const data = def.build(ctx)
    const Comp = CHART_COMPONENT[def.kind]
    const opts = CHART_OPTS[def.kind]
    return (
      <div>
        {(b.title || def.label) && <p className="text-sm font-semibold text-slate-800 mb-2">{b.title || def.label}</p>}
        <div style={{ height: Math.round((b.height || 240) * (landscape ? 0.85 : 1)) }} className="relative transition-[height] duration-300">
          {isChartEmpty(data) ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">No data for this chart yet</div>
            : <Comp ref={(el) => { chartRefs.current[b.id] = el }} data={data} options={opts} />}
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
    const rows = records.slice(0, Math.max(1, b.limit || 25))
    return (
      <div>
        {b.title && <p className="text-sm font-semibold text-slate-800 mb-2">{b.title}</p>}
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-800 text-white">{cols.map((c) => <th key={c} className="text-left font-semibold px-2.5 py-2 whitespace-nowrap">{TABLE_COLS[c]}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={cols.length} className="px-2.5 py-6 text-center text-slate-400">No incidents in range.</td></tr>
                : rows.map((r, i) => (
                  <tr key={r.id || i} className={i % 2 ? 'bg-slate-50' : 'bg-white'}>{cols.map((c) => <td key={c} className="px-2.5 py-1.5 text-slate-700 whitespace-nowrap">{fmtCell(c, r[c], money)}</td>)}</tr>
                ))}
            </tbody>
          </table>
        </div>
        {records.length > (b.limit || 25) && <p className="text-[11px] text-slate-400 mt-1">Showing {b.limit || 25} of {records.length} incidents.</p>}
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
  if (b.type === 'pagebreak') return <div className="flex items-center gap-2 text-slate-300"><div className="flex-1 border-t border-dashed border-slate-300" /><span className="text-[10px] uppercase tracking-wider">Page break</span><div className="flex-1 border-t border-dashed border-slate-300" /></div>
  return null
}

function Placeholder({ children }) { return <div className="rounded-lg bg-slate-50 border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">{children}</div> }
