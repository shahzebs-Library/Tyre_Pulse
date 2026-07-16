import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, BarChart3, BookMarked, Check, Database, FileSpreadsheet,
  FileText, FolderOpen, Layers, Pencil, Play, Plus, Save, SlidersHorizontal,
  Trash2, X,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'
import SectionTabs, { REPORTS_TABS } from '../components/ui/SectionTabs'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { captureChartOnPaper } from '../lib/chartCapture'
import {
  AGG_FNS, CHART_TYPES, DATASETS, DATASET_LIST, DEFAULT_LIMIT, KPI_FNS, KPI_FN_LABELS,
  LIST_OPS, MAX_CHART_BLOCKS, MAX_KPI_TILES, MAX_LIMIT,
  OPERATORS, OPERATOR_LABELS, RANGE_OPS, VALUELESS_OPS,
  applyAggregations, buildQuery, buildReportChartData, chartMetricOptions,
  computeKpiTiles, makeChartBlock, makeKpiTile, makeSavedReport, validateConfig,
} from '../lib/reportBuilder'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler,
)

// Dark-theme chart options (light ticks/labels) so the on-screen chart stays
// legible; the PDF capture flips these to paper ink via captureChartOnPaper.
const CHART_DARK_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1,
      titleColor: '#f9fafb', bodyColor: '#d1d5db',
    },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

/** Resolve Chart.js options for a report chart type (dark on-screen theme). */
function chartOptionsFor(type) {
  if (type === 'pie') {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } } },
    }
  }
  if (type === 'hbar') {
    return {
      ...CHART_DARK_BASE, indexAxis: 'y',
      plugins: { ...CHART_DARK_BASE.plugins, legend: { display: false } },
    }
  }
  if (type === 'bar') {
    return { ...CHART_DARK_BASE, plugins: { ...CHART_DARK_BASE.plugins, legend: { display: false } } }
  }
  return CHART_DARK_BASE // line
}
import {
  listReports, saveReport, deleteReport as deleteSavedReport,
  renameReport as renameSavedReport, reportSaveTarget,
} from '../lib/api/savedViews'

/**
 * Report Builder — self-service reporting. Users pick a dataset, choose and
 * order columns, add typed filters, sort/limit, optionally group + aggregate,
 * then run, save and export the report (Excel/PDF here, CSV via the table).
 *
 * Designed for the `/report-builder` route (wired by App.jsx/Layout.jsx).
 * RBAC: Admin/Manager/Director build + manage saved reports; other roles get a
 * read-only experience (run saved reports, export) — writes are additionally
 * enforced server-side by app_settings RLS.
 */

const BUILDER_ROLES = ['Admin', 'Manager', 'Director']
const LIMIT_OPTIONS = [100, 250, 500, 1000, 2500, MAX_LIMIT]

const EMPTY_FILTER = () => ({ col: '', op: '', value: '', value2: '' })

/** Human number formatting for a KPI tile value; honest N/A for null. */
function fmtKpi(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/** Derive a heading for a chart block (explicit title wins). */
function chartHeading(block, data) {
  if (block.title) return block.title
  return data ? `${data.seriesLabel} by ${data.groupLabel}` : 'Chart'
}

/** Load a data-URL image (for compositing chart PNGs into the PDF lead page). */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('image load failed'))
    im.src = src
  })
}

/** Rounded-rect path with a graceful fallback when ctx.roundRect is missing. */
function paperRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Compose the KPI tiles + every captured chart (already rendered on white paper)
 * into a single tall PNG that the shared exportToPdf path drops onto a lead page
 * above the data table. Returns null when there is nothing visual to include.
 * Pure canvas work; charts arrive as { block, data, img } with print-ready PNGs.
 */
async function buildReportVisualImage(kpiTiles, chartEntries) {
  const tiles = Array.isArray(kpiTiles) ? kpiTiles : []
  const charts = Array.isArray(chartEntries) ? chartEntries : []
  if (!tiles.length && !charts.length) return null

  const W = 1600
  const PAD = 44
  const GAP = 24

  const tileCols = tiles.length ? Math.min(4, tiles.length) : 0
  const tileRows = tiles.length ? Math.ceil(tiles.length / tileCols) : 0
  const tileH = 128
  const tilesH = tileRows ? tileRows * tileH + (tileRows - 1) * GAP : 0

  const chartCols = charts.length > 1 ? 2 : (charts.length ? 1 : 0)
  const chartRowsN = charts.length ? Math.ceil(charts.length / chartCols) : 0
  const cellW = chartCols ? (W - 2 * PAD - (chartCols - 1) * GAP) / chartCols : 0
  const titleH = 40
  const cellH = chartCols ? Math.round(cellW * 0.6) + titleH : 0
  const chartsH = chartRowsN ? chartRowsN * cellH + (chartRowsN - 1) * GAP : 0

  const midGap = (tilesH && chartsH) ? GAP : 0
  const H = PAD * 2 + tilesH + midGap + chartsH

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  // KPI tiles
  if (tiles.length) {
    const tw = (W - 2 * PAD - (tileCols - 1) * GAP) / tileCols
    tiles.forEach((t, i) => {
      const c = i % tileCols
      const r = Math.floor(i / tileCols)
      const x = PAD + c * (tw + GAP)
      const y = PAD + r * (tileH + GAP)
      ctx.fillStyle = '#f8fafc'
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1.5
      paperRoundRect(ctx, x, y, tw, tileH, 12)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 42px Helvetica, Arial, sans-serif'
      ctx.fillText(fmtKpi(t.value), x + 22, y + 66, tw - 44)
      ctx.fillStyle = '#64748b'
      ctx.font = '22px Helvetica, Arial, sans-serif'
      ctx.fillText(String(t.label || ''), x + 22, y + 100, tw - 44)
    })
  }

  // Charts
  const chartsTop = PAD + tilesH + midGap
  charts.forEach((entry, i) => {
    const c = i % chartCols
    const r = Math.floor(i / chartCols)
    const x = PAD + c * (cellW + GAP)
    const y = chartsTop + r * (cellH + GAP)
    ctx.fillStyle = '#0f172a'
    ctx.font = 'bold 24px Helvetica, Arial, sans-serif'
    ctx.fillText(chartHeading(entry.block, entry.data), x, y + 26, cellW)
    const areaY = y + titleH
    const areaH = cellH - titleH
    const img = entry.img
    const scale = Math.min(cellW / img.width, areaH / img.height)
    const iw = img.width * scale
    const ih = img.height * scale
    ctx.drawImage(img, x + (cellW - iw) / 2, areaY + (areaH - ih) / 2, iw, ih)
  })

  return canvas.toDataURL('image/png')
}

function defaultColumnsFor(datasetKey) {
  const ds = DATASETS[datasetKey]
  return ds ? ds.columns.slice(0, 6).map(c => c.key) : []
}

/** UI filter row -> reportBuilder filter shape. Incomplete rows are dropped. */
function toConfigFilters(uiFilters) {
  return uiFilters
    .filter(f => f.col && f.op)
    .map(f => {
      if (VALUELESS_OPS.includes(f.op)) return { col: f.col, op: f.op }
      if (RANGE_OPS.includes(f.op)) return { col: f.col, op: f.op, value: [f.value, f.value2] }
      return { col: f.col, op: f.op, value: f.value }
    })
}

/** Saved config -> UI filter rows. */
function fromConfigFilters(filters = []) {
  return filters.map(f => ({
    col: f.col,
    op: f.op,
    value: RANGE_OPS.includes(f.op) ? (f.value?.[0] ?? '')
      : LIST_OPS.includes(f.op) ? (Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? ''))
      : String(f.value ?? ''),
    value2: RANGE_OPS.includes(f.op) ? (f.value?.[1] ?? '') : '',
  }))
}

export default function ReportBuilder() {
  const reportMeta = useReportMeta('Custom Report')
  const { user, profile } = useAuth()
  const canBuild = BUILDER_ROLES.includes(profile?.role)

  // ── builder state ───────────────────────────────────────────────────────
  const [datasetKey, setDatasetKey] = useState('tyres')
  const [selectedCols, setSelectedCols] = useState(() => defaultColumnsFor('tyres'))
  const [filters, setFilters] = useState([])
  const [sortCol, setSortCol] = useState('')
  const [sortDir, setSortDir] = useState('desc')
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [groupBy, setGroupBy] = useState('')
  const [metrics, setMetrics] = useState([]) // [{ col, fn }]
  const [charts, setCharts] = useState([]) // [{ id, type, metric, title }] — empty = table only
  const [kpis, setKpis] = useState([]) // [{ id, fn, col }] — KPI summary tiles
  const chartRefs = useRef({}) // id -> live Chart.js instance (for PDF capture)

  // ── results state ───────────────────────────────────────────────────────
  const [rows, setRows] = useState([])
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState(null)
  const [hasRun, setHasRun] = useState(false)
  const [validationErrors, setValidationErrors] = useState([])

  // ── saved reports state ─────────────────────────────────────────────────
  const [saved, setSaved] = useState([])
  const [savedLoading, setSavedLoading] = useState(true)
  const [savedError, setSavedError] = useState(null)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDesc, setSaveDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameText, setRenameText] = useState('')
  const [activeReportName, setActiveReportName] = useState(null)
  const [exporting, setExporting] = useState(false)

  const dataset = DATASETS[datasetKey]
  const numericCols = useMemo(() => dataset.columns.filter(c => c.type === 'number'), [dataset])

  // ── current config ──────────────────────────────────────────────────────
  const config = useMemo(() => ({
    dataset: datasetKey,
    columns: selectedCols,
    filters: toConfigFilters(filters),
    sort: sortCol ? { col: sortCol, dir: sortDir } : null,
    limit,
    group: groupBy ? { by: groupBy, metrics } : null,
    charts: groupBy ? charts : [],
    kpis,
  }), [datasetKey, selectedCols, filters, sortCol, sortDir, limit, groupBy, metrics, charts, kpis])

  // ── load saved reports ──────────────────────────────────────────────────
  const loadSaved = useCallback(async () => {
    setSavedLoading(true)
    setSavedError(null)
    try {
      setSaved(await listReports())
    } catch (e) {
      setSavedError(e.message)
    } finally {
      setSavedLoading(false)
    }
  }, [])
  useEffect(() => { loadSaved() }, [loadSaved])

  // ── dataset change resets dependent state ───────────────────────────────
  function changeDataset(key) {
    setDatasetKey(key)
    setSelectedCols(defaultColumnsFor(key))
    setFilters([])
    setSortCol('')
    setSortDir('desc')
    setGroupBy('')
    setMetrics([])
    setCharts([])
    setKpis([])
    setRows([])
    setHasRun(false)
    setRunError(null)
    setValidationErrors([])
    setActiveReportName(null)
  }

  // ── column selection / ordering ─────────────────────────────────────────
  function toggleColumn(key) {
    setSelectedCols(prev => prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key])
  }
  function moveColumn(key, delta) {
    setSelectedCols(prev => {
      const i = prev.indexOf(key)
      const j = i + delta
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // ── run ─────────────────────────────────────────────────────────────────
  const runReport = useCallback(async () => {
    const check = validateConfig(config)
    if (!check.valid) { setValidationErrors(check.errors); return }
    setValidationErrors([])
    setRunning(true)
    setRunError(null)
    try {
      const { data, error } = await buildQuery(supabase, config)
      if (error) throw new Error(error.message || 'Query failed.')
      setRows(Array.isArray(data) ? data : [])
      setHasRun(true)
    } catch (e) {
      setRunError(e.message)
      setRows([])
      setHasRun(true)
    } finally {
      setRunning(false)
    }
  }, [config])

  // ── result shape (raw or aggregated) ────────────────────────────────────
  const aggregated = useMemo(
    () => (groupBy ? applyAggregations(rows, config) : null),
    [rows, config, groupBy],
  )
  const resultColumns = useMemo(() => {
    if (aggregated) return aggregated.columns
    return selectedCols
      .map(k => dataset.columns.find(c => c.key === k))
      .filter(Boolean)
  }, [aggregated, selectedCols, dataset])
  const resultRows = aggregated ? aggregated.rows : rows

  // ── chart data (grouped rows -> Chart.js data), one per chart block ─────────
  const metricOptions = useMemo(() => chartMetricOptions(aggregated), [aggregated])
  // Keep every chart block's metric valid as the available aggregates change.
  useEffect(() => {
    if (!metricOptions.length) return
    setCharts(prev => {
      let changed = false
      const next = prev.map(c => {
        if (metricOptions.some(o => o.key === c.metric)) return c
        changed = true
        return { ...c, metric: metricOptions[0].key }
      })
      return changed ? next : prev
    })
  }, [metricOptions])
  // Per-block chart data derived from the SAME aggregation. null data = no plot.
  const chartDatas = useMemo(
    () => (aggregated ? charts.map(block => ({
      block,
      data: buildReportChartData(aggregated, { type: block.type, metric: block.metric }),
    })) : []),
    [aggregated, charts],
  )

  // ── KPI summary tiles (over the raw queried rows) ───────────────────────────
  const kpiTiles = useMemo(() => computeKpiTiles(rows, config), [rows, config])

  const tableColumns = useMemo(() => resultColumns.map(c => ({
    accessorKey: c.key,
    header: c.label,
    meta: c.type === 'number' ? { align: 'right' } : undefined,
    cell: info => {
      const v = info.getValue()
      if (v == null || v === '') return <span className="text-muted">—</span>
      return String(v)
    },
  })), [resultColumns])

  // ── exports ─────────────────────────────────────────────────────────────
  const exportBase = (activeReportName || `${dataset.label} Report`).replace(/[^\w\- ]+/g, '').trim()
  const exportFile = `${exportBase.replace(/\s+/g, '_').toLowerCase() || 'custom_report'}_${new Date().toISOString().slice(0, 10)}`

  async function handleExportExcel() {
    if (!resultRows.length || exporting) return
    setExporting(true)
    try {
      await exportToExcel(
        resultRows,
        resultColumns.map(c => c.key),
        resultColumns.map(c => c.label),
        exportFile,
        'Report',
        { title: exportBase, meta: { Dataset: dataset.label, Rows: resultRows.length } },
      )
    } catch (e) {
      setRunError(e.message)
    } finally {
      setExporting(false)
    }
  }
  async function handleExportPdf() {
    if (!resultRows.length || exporting) return
    setExporting(true)
    try {
      // Capture every live chart on white paper, then composite them with the
      // KPI tiles into one lead image the shared PDF path renders above the table.
      const captured = []
      for (const cd of chartDatas) {
        if (!cd.data) continue
        const live = chartRefs.current[cd.block.id]
        if (!live) continue
        const url = captureChartOnPaper(live)
        if (!url) continue
        try { captured.push({ block: cd.block, data: cd.data, img: await loadImage(url) }) } catch { /* skip bad capture */ }
      }
      const leadImage = await buildReportVisualImage(kpiTiles, captured)
      const parts = []
      if (kpiTiles.length) parts.push(`${kpiTiles.length} KPI ${kpiTiles.length === 1 ? 'tile' : 'tiles'}`)
      if (captured.length) parts.push(`${captured.length} ${captured.length === 1 ? 'chart' : 'charts'}`)
      await exportToPdf(
        resultRows,
        resultColumns.map(c => ({ key: c.key, header: c.label })),
        exportBase,
        exportFile,
        'landscape',
        profile?.company_name || '',
        leadImage ? { leadImage, leadImageCaption: parts.join(' | ') } : {},
      )
    } catch (e) {
      setRunError(e.message)
    } finally {
      setExporting(false)
    }
  }

  // ── save / library actions ──────────────────────────────────────────────
  async function handleSave() {
    const check = validateConfig(config)
    if (!check.valid) { setSaveError(check.errors.join(' ')); return }
    if (!saveName.trim()) { setSaveError('Give the report a name.'); return }
    setSaving(true)
    setSaveError(null)
    try {
      const record = makeSavedReport({
        name: saveName,
        description: saveDesc,
        config: check.config,
        createdBy: profile?.id || user?.id || user?.email || null,
      })
      await saveReport(record, saved)
      setSaved([record, ...saved.filter(r => r.id !== record.id)])
      setActiveReportName(record.name)
      setShowSaveModal(false)
      setSaveName('')
      setSaveDesc('')
      // Non-blocking heads-up when this dataset can't live in the server-side
      // report table (module mismatch); the report is still saved to settings.
      const target = reportSaveTarget(check.config.dataset)
      if (!target.table && target.reason) setSavedError(target.reason)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function loadReport(r) {
    const cfg = r.config || {}
    if (!DATASETS[cfg.dataset]) return
    setDatasetKey(cfg.dataset)
    setSelectedCols(Array.isArray(cfg.columns) && cfg.columns.length ? cfg.columns : defaultColumnsFor(cfg.dataset))
    setFilters(fromConfigFilters(cfg.filters))
    setSortCol(cfg.sort?.col || '')
    setSortDir(cfg.sort?.dir === 'asc' ? 'asc' : 'desc')
    setLimit(cfg.limit || DEFAULT_LIMIT)
    setGroupBy(cfg.group?.by || '')
    setMetrics(Array.isArray(cfg.group?.metrics) ? cfg.group.metrics : [])
    // Charts: prefer the new `charts` array; fall back to a legacy single `chart`
    // so pre-existing saved reports keep their visualization. Guaranteed array.
    const loadedCharts = Array.isArray(cfg.charts) && cfg.charts.length
      ? cfg.charts.map(c => makeChartBlock(c))
      : (cfg.group?.by && cfg.chart?.type ? [makeChartBlock({ type: cfg.chart.type, metric: cfg.chart.metric })] : [])
    setCharts(cfg.group?.by ? loadedCharts : [])
    setKpis(Array.isArray(cfg.kpis) ? cfg.kpis.map(t => makeKpiTile(t)) : [])
    setRows([])
    setHasRun(false)
    setRunError(null)
    setValidationErrors([])
    setActiveReportName(r.name)
    setShowLibrary(false)
  }

  async function renameReport(id) {
    const name = renameText.trim()
    if (!name) { setRenamingId(null); return }
    try {
      const next = await renameSavedReport(id, name, saved)
      setSaved(next)
    } catch (e) {
      setSavedError(e.message)
    } finally {
      setRenamingId(null)
      setRenameText('')
    }
  }

  async function deleteReport(id) {
    try {
      await deleteSavedReport(id, saved)
      setSaved(saved.filter(r => r.id !== id))
    } catch (e) {
      setSavedError(e.message)
    }
  }

  // ── render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <SectionTabs tabs={REPORTS_TABS} />
      <PageHeader
        title="Report Builder"
        subtitle="Compose, save and export custom reports from any fleet dataset"
        icon={Layers}
        badge={activeReportName || undefined}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowLibrary(v => !v)}
              className="btn-secondary text-sm flex items-center gap-1.5"
            >
              <FolderOpen size={15} /> My reports ({saved.length})
            </button>
            {canBuild && (
              <button
                type="button"
                onClick={() => { setSaveError(null); setShowSaveModal(true) }}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                <Save size={15} /> Save
              </button>
            )}
            <button
              type="button"
              onClick={runReport}
              disabled={running}
              className="btn-primary text-sm flex items-center gap-1.5 text-white disabled:opacity-50"
            >
              <Play size={15} /> {running ? 'Running…' : 'Run report'}
            </button>
          </div>
        }
      />

      {/* Saved reports library */}
      {showLibrary && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <BookMarked size={15} className="text-[var(--accent)]" /> Saved reports
            </h2>
            <button type="button" onClick={() => setShowLibrary(false)} className="text-muted hover:text-[var(--text-primary)]" aria-label="Close saved reports">
              <X size={15} />
            </button>
          </div>
          {savedError && <p className="text-xs text-red-400 mb-2">{savedError}</p>}
          {savedLoading ? (
            <p className="text-sm text-muted py-4 text-center">Loading saved reports…</p>
          ) : saved.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">
              No saved reports yet.{canBuild ? ' Build one and press Save.' : ''}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-dim)]">
              {saved.map(r => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    {renamingId === r.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          className="input py-1 px-2 text-sm"
                          value={renameText}
                          onChange={e => setRenameText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') renameReport(r.id); if (e.key === 'Escape') setRenamingId(null) }}
                          autoFocus
                          aria-label="New report name"
                        />
                        <button type="button" onClick={() => renameReport(r.id)} className="btn-secondary py-1 px-2 text-xs" aria-label="Confirm rename">
                          <Check size={13} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.name}</p>
                        <p className="text-xs text-muted truncate">
                          {DATASETS[r.config?.dataset]?.label || r.config?.dataset}
                          {r.description ? ` · ${r.description}` : ''}
                          {r.updated_at ? ` · ${String(r.updated_at).slice(0, 10)}` : ''}
                        </p>
                      </>
                    )}
                  </div>
                  <button type="button" onClick={() => loadReport(r)} className="btn-secondary py-1 px-2.5 text-xs">
                    Load
                  </button>
                  {canBuild && (
                    <>
                      <button
                        type="button"
                        onClick={() => { setRenamingId(r.id); setRenameText(r.name) }}
                        className="text-muted hover:text-[var(--text-primary)]"
                        aria-label={`Rename ${r.name}`}
                        title="Rename"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteReport(r.id)}
                        className="text-muted hover:text-red-400"
                        aria-label={`Delete ${r.name}`}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!canBuild && (
        <div className="card py-3">
          <p className="text-sm text-[var(--text-secondary)]">
            Read-only access: you can load and run saved reports and export the results.
            Building and saving reports requires the Admin, Manager or Director role.
          </p>
        </div>
      )}

      {/* Three-panel builder */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Panel A — dataset + columns */}
        <div className={`card ${canBuild ? '' : 'opacity-60 pointer-events-none'}`}>
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
            <Database size={15} className="text-[var(--accent)]" /> Dataset &amp; columns
          </h2>
          <label className="block text-xs text-muted mb-1" htmlFor="rb-dataset">Dataset</label>
          <select
            id="rb-dataset"
            className="input w-full text-sm mb-4"
            value={datasetKey}
            onChange={e => changeDataset(e.target.value)}
          >
            {DATASET_LIST.map(ds => (
              <option key={ds.key} value={ds.key}>{ds.label}</option>
            ))}
          </select>

          <p className="text-xs text-muted mb-2">
            Columns: {selectedCols.length} of {dataset.columns.length} selected (order = report order)
          </p>
          <div className="max-h-80 overflow-y-auto pr-1 space-y-1">
            {/* Selected first, in report order, with reorder controls */}
            {selectedCols.map((key, i) => {
              const col = dataset.columns.find(c => c.key === key)
              if (!col) return null
              return (
                <div key={key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-2 border border-[var(--border-dim)]">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggleColumn(key)}
                    className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
                    aria-label={`Deselect ${col.label}`}
                  />
                  <span className="text-xs text-[var(--text-primary)] flex-1 truncate">{col.label}</span>
                  <span className="text-[10px] uppercase text-muted">{col.type}</span>
                  <button
                    type="button"
                    onClick={() => moveColumn(key, -1)}
                    disabled={i === 0}
                    className="text-muted hover:text-[var(--text-primary)] disabled:opacity-25"
                    aria-label={`Move ${col.label} up`}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveColumn(key, 1)}
                    disabled={i === selectedCols.length - 1}
                    className="text-muted hover:text-[var(--text-primary)] disabled:opacity-25"
                    aria-label={`Move ${col.label} down`}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              )
            })}
            {/* Unselected columns */}
            {dataset.columns.filter(c => !selectedCols.includes(c.key)).map(col => (
              <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => toggleColumn(col.key)}
                  className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
                  aria-label={`Select ${col.label}`}
                />
                <span className="text-xs text-[var(--text-secondary)] flex-1 truncate">{col.label}</span>
                <span className="text-[10px] uppercase text-muted">{col.type}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Panel B — filters, sort, limit, group */}
        <div className={`card lg:col-span-2 ${canBuild ? '' : 'opacity-60 pointer-events-none'}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <SlidersHorizontal size={15} className="text-[var(--accent)]" /> Filters &amp; shaping
            </h2>
            <button
              type="button"
              onClick={() => setFilters(prev => [...prev, EMPTY_FILTER()])}
              className="btn-secondary py-1 px-2.5 text-xs flex items-center gap-1"
            >
              <Plus size={13} /> Add filter
            </button>
          </div>

          {/* Filter rows */}
          {filters.length === 0 ? (
            <p className="text-xs text-muted mb-4">No filters. The report returns all rows up to the limit.</p>
          ) : (
            <div className="space-y-2 mb-4">
              {filters.map((f, i) => {
                const col = dataset.columns.find(c => c.key === f.col)
                const ops = col ? (OPERATORS[col.type] || OPERATORS.text) : []
                const inputType = col?.type === 'number' ? 'number' : col?.type === 'date' ? 'date' : 'text'
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select
                      className="input py-1.5 px-2 text-xs w-44"
                      value={f.col}
                      onChange={e => setFilters(prev => prev.map((x, j) => j === i ? { ...EMPTY_FILTER(), col: e.target.value } : x))}
                      aria-label="Filter column"
                    >
                      <option value="">Column…</option>
                      {dataset.columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <select
                      className="input py-1.5 px-2 text-xs w-40"
                      value={f.op}
                      onChange={e => setFilters(prev => prev.map((x, j) => j === i ? { ...x, op: e.target.value, value: '', value2: '' } : x))}
                      disabled={!col}
                      aria-label="Filter operator"
                    >
                      <option value="">Operator…</option>
                      {ops.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                    </select>
                    {f.op && !VALUELESS_OPS.includes(f.op) && (
                      <input
                        type={LIST_OPS.includes(f.op) ? 'text' : inputType}
                        className="input py-1.5 px-2 text-xs flex-1 min-w-32"
                        value={f.value}
                        placeholder={LIST_OPS.includes(f.op) ? 'value1, value2, …' : 'Value'}
                        onChange={e => setFilters(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                        aria-label="Filter value"
                      />
                    )}
                    {RANGE_OPS.includes(f.op) && (
                      <input
                        type={inputType}
                        className="input py-1.5 px-2 text-xs flex-1 min-w-32"
                        value={f.value2}
                        placeholder="and…"
                        onChange={e => setFilters(prev => prev.map((x, j) => j === i ? { ...x, value2: e.target.value } : x))}
                        aria-label="Filter upper value"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setFilters(prev => prev.filter((_, j) => j !== i))}
                      className="text-muted hover:text-red-400"
                      aria-label="Remove filter"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Sort / limit / group-by */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 pt-3 border-t border-[var(--border-dim)]">
            <div>
              <label className="block text-xs text-muted mb-1" htmlFor="rb-sort">Sort by</label>
              <select id="rb-sort" className="input w-full py-1.5 px-2 text-xs" value={sortCol} onChange={e => setSortCol(e.target.value)}>
                <option value="">Default ({dataset.defaultSort.col})</option>
                {dataset.columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1" htmlFor="rb-dir">Direction</label>
              <select id="rb-dir" className="input w-full py-1.5 px-2 text-xs" value={sortDir} onChange={e => setSortDir(e.target.value)}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1" htmlFor="rb-limit">Row limit</label>
              <select id="rb-limit" className="input w-full py-1.5 px-2 text-xs" value={limit} onChange={e => setLimit(Number(e.target.value))}>
                {LIMIT_OPTIONS.map(n => <option key={n} value={n}>{n.toLocaleString()}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1" htmlFor="rb-group">Group by (optional)</label>
              <select
                id="rb-group"
                className="input w-full py-1.5 px-2 text-xs"
                value={groupBy}
                onChange={e => { setGroupBy(e.target.value); if (!e.target.value) setMetrics([]) }}
              >
                <option value="">No grouping</option>
                {dataset.columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>

          {/* Aggregate metrics */}
          {groupBy && (
            <div className="mt-3 pt-3 border-t border-[var(--border-dim)]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted">Aggregates (count is always included)</p>
                <button
                  type="button"
                  onClick={() => numericCols.length && setMetrics(prev => [...prev, { col: numericCols[0].key, fn: 'sum' }])}
                  disabled={numericCols.length === 0}
                  className="btn-secondary py-1 px-2.5 text-xs flex items-center gap-1 disabled:opacity-40"
                >
                  <Plus size={13} /> Add metric
                </button>
              </div>
              {numericCols.length === 0 && (
                <p className="text-xs text-muted">This dataset has no numeric columns to aggregate.</p>
              )}
              <div className="space-y-2">
                {metrics.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      className="input py-1.5 px-2 text-xs w-28"
                      value={m.fn}
                      onChange={e => setMetrics(prev => prev.map((x, j) => j === i ? { ...x, fn: e.target.value } : x))}
                      aria-label="Aggregate function"
                    >
                      {AGG_FNS.map(fn => <option key={fn} value={fn}>{fn.toUpperCase()}</option>)}
                    </select>
                    <select
                      className="input py-1.5 px-2 text-xs flex-1"
                      value={m.col}
                      onChange={e => setMetrics(prev => prev.map((x, j) => j === i ? { ...x, col: e.target.value } : x))}
                      aria-label="Aggregate column"
                    >
                      {numericCols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => setMetrics(prev => prev.filter((_, j) => j !== i))}
                      className="text-muted hover:text-red-400"
                      aria-label="Remove metric"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Chart blocks — add as many as you need; all share this grouping */}
              <div className="mt-3 pt-3 border-t border-[var(--border-dim)]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={14} className="text-[var(--accent)]" />
                    <p className="text-xs text-muted">
                      Charts ({charts.length}/{MAX_CHART_BLOCKS}): each plots the grouped rows
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCharts(prev => prev.length >= MAX_CHART_BLOCKS ? prev : [
                      ...prev,
                      makeChartBlock({ metric: metricOptions[0]?.key || 'count' }),
                    ])}
                    disabled={charts.length >= MAX_CHART_BLOCKS}
                    className="btn-secondary py-1 px-2.5 text-xs flex items-center gap-1 disabled:opacity-40"
                  >
                    <Plus size={13} /> Add chart
                  </button>
                </div>
                {charts.length === 0 ? (
                  <p className="text-[11px] text-muted">No charts. Add one to visualize the grouped result.</p>
                ) : (
                  <div className="space-y-2">
                    {charts.map((block, i) => (
                      <div key={block.id} className="rounded-lg bg-surface-2 border border-[var(--border-dim)] p-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase text-muted w-10">#{i + 1}</span>
                          <input
                            className="input py-1.5 px-2 text-xs flex-1"
                            value={block.title}
                            placeholder="Chart title (optional)"
                            maxLength={120}
                            onChange={e => setCharts(prev => prev.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                            aria-label={`Chart ${i + 1} title`}
                          />
                          <button
                            type="button"
                            onClick={() => setCharts(prev => { const n = [...prev]; if (i > 0) [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n })}
                            disabled={i === 0}
                            className="text-muted hover:text-[var(--text-primary)] disabled:opacity-25"
                            aria-label={`Move chart ${i + 1} up`}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCharts(prev => { const n = [...prev]; if (i < n.length - 1) [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n })}
                            disabled={i === charts.length - 1}
                            className="text-muted hover:text-[var(--text-primary)] disabled:opacity-25"
                            aria-label={`Move chart ${i + 1} down`}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCharts(prev => prev.filter((_, j) => j !== i))}
                            className="text-muted hover:text-red-400"
                            aria-label={`Remove chart ${i + 1}`}
                          >
                            <X size={15} />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            className="input py-1.5 px-2 text-xs"
                            value={block.type}
                            onChange={e => setCharts(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                            aria-label={`Chart ${i + 1} type`}
                          >
                            {CHART_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                          </select>
                          <select
                            className="input py-1.5 px-2 text-xs disabled:opacity-40"
                            value={block.metric}
                            onChange={e => setCharts(prev => prev.map((x, j) => j === i ? { ...x, metric: e.target.value } : x))}
                            disabled={metricOptions.length === 0}
                            aria-label={`Chart ${i + 1} series`}
                          >
                            {(metricOptions.length ? metricOptions : [{ key: 'count', label: 'Count' }]).map(o => (
                              <option key={o.key} value={o.key}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {charts.length > 0 && !hasRun && (
                  <p className="text-[11px] text-muted mt-2">Run the report to render the charts.</p>
                )}
                {charts.length > 0 && hasRun && metricOptions.length === 0 && (
                  <p className="text-[11px] text-muted mt-2">Add a numeric aggregate above to plot a series other than Count.</p>
                )}
              </div>
            </div>
          )}

          {/* KPI summary tiles — computed over the queried rows (no grouping needed) */}
          <div className="mt-3 pt-3 border-t border-[var(--border-dim)]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-[var(--accent)]" />
                <p className="text-xs text-muted">Summary tiles ({kpis.length}/{MAX_KPI_TILES})</p>
              </div>
              <button
                type="button"
                onClick={() => setKpis(prev => prev.length >= MAX_KPI_TILES ? prev : [
                  ...prev,
                  prev.some(t => t.fn === 'count') && numericCols.length
                    ? makeKpiTile({ fn: 'sum', col: numericCols[0].key })
                    : makeKpiTile({ fn: 'count' }),
                ])}
                disabled={kpis.length >= MAX_KPI_TILES}
                className="btn-secondary py-1 px-2.5 text-xs flex items-center gap-1 disabled:opacity-40"
              >
                <Plus size={13} /> Add tile
              </button>
            </div>
            {kpis.length === 0 ? (
              <p className="text-[11px] text-muted">No tiles. Add a row count or a numeric sum/average to headline the report.</p>
            ) : (
              <div className="space-y-2">
                {kpis.map((tile, i) => (
                  <div key={tile.id} className="flex items-center gap-2">
                    <select
                      className="input py-1.5 px-2 text-xs w-32"
                      value={tile.fn}
                      onChange={e => setKpis(prev => prev.map((x, j) => {
                        if (j !== i) return x
                        const fn = e.target.value
                        return { ...x, fn, col: fn === 'count' ? null : (x.col || numericCols[0]?.key || null) }
                      }))}
                      aria-label={`Tile ${i + 1} function`}
                    >
                      {KPI_FNS.map(fn => <option key={fn} value={fn}>{KPI_FN_LABELS[fn]}</option>)}
                    </select>
                    <select
                      className="input py-1.5 px-2 text-xs flex-1 disabled:opacity-40"
                      value={tile.col || ''}
                      onChange={e => setKpis(prev => prev.map((x, j) => j === i ? { ...x, col: e.target.value } : x))}
                      disabled={tile.fn === 'count' || numericCols.length === 0}
                      aria-label={`Tile ${i + 1} column`}
                    >
                      {tile.fn === 'count'
                        ? <option value="">Row count</option>
                        : numericCols.length === 0
                          ? <option value="">No numeric columns</option>
                          : numericCols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => setKpis(prev => prev.filter((_, j) => j !== i))}
                      className="text-muted hover:text-red-400"
                      aria-label={`Remove tile ${i + 1}`}
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!groupBy && (
            <p className="text-[11px] text-muted mt-3 pt-3 border-t border-[var(--border-dim)] flex items-center gap-1.5">
              <BarChart3 size={13} /> Charts need a group by. Pick a Group by column to add and visualize charts.
            </p>
          )}

          {validationErrors.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              {validationErrors.map((e, i) => <p key={i} className="text-xs text-red-400">{e}</p>)}
            </div>
          )}
        </div>
      </div>

      {/* Panel C — results */}
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-muted">
            {hasRun && !running && !runError
              ? <>
                  {resultRows.length.toLocaleString()} {aggregated ? 'groups' : 'rows'}
                  {!aggregated && rows.length >= limit ? ` (limit ${limit.toLocaleString()} reached)` : ''}
                </>
              : 'Results'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!resultRows.length || exporting}
              className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5 disabled:opacity-40"
            >
              <FileSpreadsheet size={13} /> Excel
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={!resultRows.length || exporting}
              className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5 disabled:opacity-40"
            >
              <FileText size={13} /> PDF
            </button>
          </div>
        </div>

        {/* KPI summary tiles (over the queried rows) */}
        {hasRun && !running && !runError && kpiTiles.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpiTiles.map(t => (
              <div key={t.id} className="card py-3 px-4">
                <p className="text-lg font-semibold text-[var(--text-primary)] tabular-nums truncate" title={fmtKpi(t.value)}>
                  {fmtKpi(t.value)}
                </p>
                <p className="text-xs text-muted truncate" title={t.label}>{t.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Chart visualizations — one card per block, responsive grid */}
        {hasRun && !running && !runError && charts.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {chartDatas.map(({ block, data }) => (
              <div key={block.id} className="card">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 size={15} className="text-[var(--accent)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {chartHeading(block, data)}
                  </h3>
                </div>
                {data ? (
                  <>
                    <div className="h-64">
                      {block.type === 'line' ? (
                        <Line ref={inst => { if (inst) chartRefs.current[block.id] = inst; else delete chartRefs.current[block.id] }} data={data.data} options={chartOptionsFor(block.type)} />
                      ) : block.type === 'pie' ? (
                        <Doughnut ref={inst => { if (inst) chartRefs.current[block.id] = inst; else delete chartRefs.current[block.id] }} data={data.data} options={chartOptionsFor(block.type)} />
                      ) : (
                        <Bar ref={inst => { if (inst) chartRefs.current[block.id] = inst; else delete chartRefs.current[block.id] }} data={data.data} options={chartOptionsFor(block.type)} />
                      )}
                    </div>
                    {resultRows.length > 30 && (
                      <p className="text-[11px] text-muted mt-2">Showing the top 30 groups. The full set is in the table below.</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted py-8 text-center">
                    No chart data. Group by a column and add at least one numeric aggregate.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {!hasRun && !running ? (
          <div className="card flex flex-col items-center gap-3 py-14 text-center">
            <Play size={26} className="text-muted opacity-50" />
            <p className="text-sm text-[var(--text-secondary)] max-w-md">
              {canBuild
                ? 'Configure your report above, then press Run report to preview the results.'
                : 'Open My reports, load a saved report and press Run report to view it.'}
            </p>
          </div>
        ) : (
          <EnterpriseTable
            reportMeta={reportMeta}
            columns={tableColumns}
            data={resultRows}
            loading={running}
            error={runError}
            onRetry={runReport}
            emptyMessage="No records match this report. Adjust the filters and run again."
            exportFileName={exportFile}
            initialPageSize={25}
          />
        )}
      </div>

      {/* Save modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Save report">
          <div className="card w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Save report</h2>
              <button type="button" onClick={() => setShowSaveModal(false)} className="text-muted hover:text-[var(--text-primary)]" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <label className="block text-xs text-muted mb-1" htmlFor="rb-save-name">Name</label>
            <input
              id="rb-save-name"
              className="input w-full text-sm mb-3"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="e.g. Monthly tyre spend by site"
              maxLength={120}
              autoFocus
            />
            <label className="block text-xs text-muted mb-1" htmlFor="rb-save-desc">Description (optional)</label>
            <textarea
              id="rb-save-desc"
              className="input w-full text-sm mb-3"
              rows={2}
              value={saveDesc}
              onChange={e => setSaveDesc(e.target.value)}
              maxLength={500}
            />
            {saveError && <p className="text-xs text-red-400 mb-3">{saveError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowSaveModal(false)} className="btn-secondary text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn-primary text-sm text-white disabled:opacity-50 flex items-center gap-1.5"
              >
                <Save size={14} /> {saving ? 'Saving…' : 'Save report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
