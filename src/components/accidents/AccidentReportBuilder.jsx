/**
 * AccidentReportBuilder — a customizable, block-based report designer embedded in
 * the Accidents module. Compose a branded report from ordered blocks (cover/logo,
 * KPI rows, charts, rich text, detail tables, page breaks), see a live WYSIWYG
 * "paper" preview, export a pixel-faithful branded PDF (charts rasterised from the
 * live canvases, logo embedded), and save/load named layouts to the org
 * (accident_report_templates, V221) with an offline-safe local fallback.
 *
 * All data is live from the accident record set passed in — nothing fabricated.
 */
import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, LineElement, PointElement, Filler, Title, Tooltip, Legend,
} from 'chart.js'
import {
  Plus, Image as ImageIcon, BarChart3, Type, Table2, SeparatorHorizontal,
  Trash2, ChevronUp, ChevronDown, Copy, FileText, Save, FolderOpen, X,
  LayoutGrid, Loader2, Sparkles, GripVertical,
} from 'lucide-react'
import { analyzeClaims } from '../../lib/claimsAnalytics'
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from '../../lib/api/accidentReportTemplates'
import { formatCurrencyCompact } from '../../lib/formatters'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, LineElement, PointElement, Filler, Title, Tooltip, Legend)

// ── WYSIWYG paper theme — charts render dark-on-white so the on-screen preview
//    equals the exported PDF. ────────────────────────────────────────────────
const INK = '#0f172a', MUT = '#475569', GRID = 'rgba(15,23,42,0.08)'
const AXIS = { ticks: { color: MUT, font: { size: 11 } }, grid: { color: GRID } }
const OPT_BASE = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: AXIS, y: { ...AXIS, beginAtZero: true } } }
const OPT_H = { ...OPT_BASE, indexAxis: 'y' }
const OPT_STACK = { ...OPT_BASE, plugins: { legend: { display: true, labels: { color: MUT, font: { size: 10 } } }, tooltip: { enabled: false } }, scales: { x: { ...AXIS, stacked: true }, y: { ...AXIS, stacked: true } } }
const OPT_DOUGHNUT = { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { color: INK, boxWidth: 12, padding: 10, font: { size: 11 } } }, tooltip: { enabled: false } } }
const OPT_LINE = { ...OPT_BASE, elements: { line: { tension: 0.35 }, point: { radius: 2 } } }
const PALETTE = ['#ea580c', '#2563eb', '#16a34a', '#9333ea', '#dc2626', '#ca8a04', '#0891b2', '#64748b', '#db2777', '#4f46e5']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function last12() {
  const out = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }
  return out
}
const mKey = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const mLabel = (k) => { const [y, m] = k.split('-'); return `${MONTHS[(+m) - 1]} ${y.slice(2)}` }
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const canonSev = (s) => { const v = String(s || '').toLowerCase(); if (v.includes('total')) return 'Total Loss'; if (v.startsWith('maj')) return 'Major'; if (v.startsWith('min')) return 'Minor'; return s || 'Unspecified' }

// ── Chart catalog: key → { label, kind, build(ctx) => chartjs data } ──────────
const CHARTS = {
  severity: { label: 'Severity distribution', kind: 'doughnut', build: ({ records }) => byCount(records, (r) => canonSev(r.severity), { Minor: '#64748b', Major: '#ea580c', 'Total Loss': '#dc2626' }) },
  status: { label: 'Status distribution', kind: 'doughnut', build: ({ records }) => byCount(records, (r) => r.status || 'Reported') },
  fault: {
    label: 'Fault status (GCC)', kind: 'doughnut', build: ({ records }) => {
      const c = { Faulty: 0, 'Non-faulty': 0, 'Under review': 0, Unknown: 0 }
      records.forEach((r) => { const f = String(r.fault_status || '').toLowerCase(); if (/non[-\s]?fault/.test(f)) c['Non-faulty']++; else if (/review/.test(f)) c['Under review']++; else if (/fault/.test(f)) c.Faulty++; else c.Unknown++ })
      return doughnut(c, { Faulty: '#dc2626', 'Non-faulty': '#16a34a', 'Under review': '#ca8a04', Unknown: '#cbd5e1' })
    },
  },
  liability: {
    label: 'GCC liability split', kind: 'doughnut', build: ({ claims }) => {
      const l = claims.liability
      return { labels: ['0% not liable', '50% shared', '100% at fault', 'Unknown'], datasets: [{ data: [l[0].count, l[50].count, l[100].count, l.unknown.count], backgroundColor: ['#16a34a', '#ca8a04', '#dc2626', '#cbd5e1'], borderWidth: 0 }] }
    },
  },
  trend: {
    label: 'Incident trend (12 mo)', kind: 'line', build: ({ records }) => {
      const keys = last12(); const t = Object.fromEntries(keys.map((k) => [k, 0]))
      records.forEach((r) => { const k = mKey(r.incident_date); if (k && t[k] != null) t[k]++ })
      return { labels: keys.map(mLabel), datasets: [{ label: 'Incidents', data: keys.map((k) => t[k]), borderColor: '#ea580c', backgroundColor: 'rgba(234,88,12,0.18)', fill: true }] }
    },
  },
  topAssets: { label: 'Top assets by incidents', kind: 'bar-h', build: ({ records }) => rank(records, (r) => r.asset_no, null, 6, '#ea580c') },
  bySite: { label: 'Incidents by site', kind: 'bar-h', build: ({ records }) => rank(records, (r) => r.site, null, 8, '#2563eb') },
  sevMonthly: {
    label: 'Monthly severity (12 mo)', kind: 'bar-stack', build: ({ records }) => {
      const keys = last12(); const sev = ['Minor', 'Major', 'Total Loss']; const map = {}
      sev.forEach((s) => { map[s] = Object.fromEntries(keys.map((k) => [k, 0])) })
      records.forEach((r) => { const k = mKey(r.incident_date); const s = canonSev(r.severity); if (k && map[s] && map[s][k] != null) map[s][k]++ })
      const col = { Minor: '#94a3b8', Major: '#ea580c', 'Total Loss': '#dc2626' }
      return { labels: keys.map(mLabel), datasets: sev.map((s) => ({ label: s, data: keys.map((k) => map[s][k]), backgroundColor: col[s] })) }
    },
  },
  claimStatus: {
    label: 'Claim status', kind: 'doughnut', build: ({ claims }) => {
      const e = claims.byStatus
      return { labels: e.map((x) => x.label), datasets: [{ data: e.map((x) => x.count), backgroundColor: e.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }] }
    },
  },
  insurerValue: {
    label: 'Claim value by insurer', kind: 'bar-h', build: ({ claims, currency }) => {
      const e = claims.byInsurer
      return { labels: e.map((x) => x.label), datasets: [{ label: `Value (${currency})`, data: e.map((x) => Math.round(x.value)), backgroundColor: '#4f46e5', borderRadius: 3 }] }
    },
  },
  recovery: {
    label: 'Recovery funnel', kind: 'bar', build: ({ claims }) => ({ labels: ['Claimed', 'Approved', 'Recovered'], datasets: [{ data: [Math.round(claims.claimed), Math.round(claims.approved), Math.round(claims.recovered)], backgroundColor: ['#2563eb', '#9333ea', '#16a34a'], borderRadius: 3 }] }),
  },
  aging: {
    label: 'Open-claim ageing', kind: 'bar', build: ({ claims }) => ({ labels: ['0–30d', '31–60d', '61–90d', '90+d'], datasets: [{ data: [claims.aging['0-30'].count, claims.aging['31-60'].count, claims.aging['61-90'].count, claims.aging['90+'].count], backgroundColor: ['#16a34a', '#ca8a04', '#fb923c', '#dc2626'], borderRadius: 3 }] }),
  },
}

function byCount(records, keyFn, colorMap) {
  const c = {}; records.forEach((r) => { const k = keyFn(r) || 'Unspecified'; c[k] = (c[k] || 0) + 1 })
  return doughnut(c, colorMap)
}
function doughnut(counts, colorMap) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0)
  return { labels: entries.map(([k]) => k), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([k], i) => (colorMap && colorMap[k]) || PALETTE[i % PALETTE.length]), borderWidth: 0 }] }
}
function rank(records, keyFn, _c, n, color) {
  const c = {}; records.forEach((r) => { const k = keyFn(r); if (k) c[k] = (c[k] || 0) + 1 })
  const sorted = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n)
  return { labels: sorted.map(([k]) => k), datasets: [{ label: 'Incidents', data: sorted.map(([, v]) => v), backgroundColor: color, borderRadius: 3 }] }
}
const CHART_COMPONENT = { doughnut: Doughnut, line: Line, bar: Bar, 'bar-h': Bar, 'bar-stack': Bar }
const CHART_OPTS = { doughnut: OPT_DOUGHNUT, line: OPT_LINE, bar: OPT_BASE, 'bar-h': OPT_H, 'bar-stack': OPT_STACK }

// ── KPI catalog ───────────────────────────────────────────────────────────────
const KPIS = {
  total: { label: 'Total incidents', get: ({ records }) => records.length },
  open: { label: 'Open', get: ({ claims, records }) => records.filter((r) => !isClosedRow(r)).length },
  closed: { label: 'Closed', get: ({ records }) => records.filter(isClosedRow).length },
  repairCost: { label: 'Repair cost', money: true, get: ({ records }) => records.reduce((s, r) => s + N(r.repair_cost) + N(r.parts_cost), 0) },
  claimed: { label: 'Total claimed', money: true, get: ({ claims }) => claims.claimed },
  approved: { label: 'Approved', money: true, get: ({ claims }) => claims.approved },
  recovered: { label: 'Recovered', money: true, get: ({ claims }) => claims.recovered },
  netExposure: { label: 'Net exposure', money: true, get: ({ claims }) => claims.netExposure },
  recoveryRate: { label: 'Recovery rate', get: ({ claims }) => (claims.recoveryRate == null ? '—' : `${claims.recoveryRate}%`) },
  delayed: { label: 'Delayed claims', get: ({ claims }) => claims.delayed },
  deductible: { label: 'Deductible', money: true, get: ({ claims }) => claims.deductible },
  claimsCount: { label: 'Claims', get: ({ claims }) => claims.total },
}
function isClosedRow(r) {
  if (r.release_date) return true
  const b = `${r.status || ''} ${r.closure_status || ''} ${r.claim_status || ''}`.toLowerCase()
  return /clos|settl|paid|recovered|complete|resolved/.test(b)
}

// ── Detail-table columns ──────────────────────────────────────────────────────
const TABLE_COLS = {
  incident_date: 'Date', asset_no: 'Asset', site: 'Site', driver_name: 'Driver',
  severity: 'Severity', status: 'Status', fault_status: 'Fault', gcc_liability_ratio: 'GCC %',
  insurer: 'Insurer', claim_amount: 'Claimed', claim_approved_amount: 'Approved',
  recovered_amount: 'Recovered', repair_cost: 'Repair', expected_release_date: 'Expected release',
}

// ── Block defaults ────────────────────────────────────────────────────────────
let _seq = 0
const uid = () => `b${Date.now().toString(36)}${(_seq++).toString(36)}`
const BLOCK_DEFAULTS = {
  header: () => ({ logo: '', title: 'Accident & Claims Report', subtitle: '', showDate: true }),
  kpis: () => ({ items: ['total', 'open', 'repairCost', 'claimed', 'recovered', 'netExposure'] }),
  chart: () => ({ chart: 'severity', title: '', height: 240 }),
  text: () => ({ title: '', body: '' }),
  table: () => ({ title: 'Incident detail', columns: ['incident_date', 'asset_no', 'site', 'severity', 'status', 'claim_amount'], limit: 25 }),
  pagebreak: () => ({}),
}
const BLOCK_META = {
  header: { label: 'Header / Logo', icon: ImageIcon },
  kpis: { label: 'KPI row', icon: LayoutGrid },
  chart: { label: 'Chart', icon: BarChart3 },
  text: { label: 'Text', icon: Type },
  table: { label: 'Detail table', icon: Table2 },
  pagebreak: { label: 'Page break', icon: SeparatorHorizontal },
}
const STARTER = () => [
  { id: uid(), type: 'header', ...BLOCK_DEFAULTS.header() },
  { id: uid(), type: 'kpis', ...BLOCK_DEFAULTS.kpis() },
  { id: uid(), type: 'chart', ...BLOCK_DEFAULTS.chart(), chart: 'severity', title: 'Severity distribution' },
  { id: uid(), type: 'chart', ...BLOCK_DEFAULTS.chart(), chart: 'trend', title: 'Incident trend' },
  { id: uid(), type: 'table', ...BLOCK_DEFAULTS.table() },
]

const LS_KEY = 'accidentReportBuilder.local.v1'

export default function AccidentReportBuilder({ records = [], company = 'TyrePulse', currency = 'SAR', branding = null }) {
  const claims = useMemo(() => analyzeClaims(records), [records])
  const ctx = useMemo(() => ({ records, claims, currency }), [records, claims, currency])
  const money = useCallback((v) => (v == null || v === '' ? '—' : formatCurrencyCompact(v, currency)), [currency])

  const [blocks, setBlocks] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (s?.blocks?.length) return s.blocks } catch { /* ignore */ }
    return STARTER()
  })
  const [orientation, setOrientation] = useState('portrait')
  const [addOpen, setAddOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState(null)

  const [templates, setTemplates] = useState([])
  const [tplId, setTplId] = useState('')
  const [tplName, setTplName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadOpen, setLoadOpen] = useState(false)

  const chartRefs = useRef({})

  // Persist working draft locally so a refresh never loses layout work.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ blocks, orientation })) } catch { /* ignore */ }
  }, [blocks, orientation])

  useEffect(() => { listTemplates().then(setTemplates).catch(() => setTemplates([])) }, [])
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  // ── Block ops ───────────────────────────────────────────────────────────────
  const addBlock = (type) => { setBlocks((b) => [...b, { id: uid(), type, ...BLOCK_DEFAULTS[type]() }]); setAddOpen(false) }
  const patchBlock = (id, patch) => setBlocks((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const removeBlock = (id) => setBlocks((b) => b.filter((x) => x.id !== id))
  const dupBlock = (id) => setBlocks((b) => { const i = b.findIndex((x) => x.id === id); if (i < 0) return b; const copy = { ...b[i], id: uid() }; return [...b.slice(0, i + 1), copy, ...b.slice(i + 1)] })
  const move = (id, dir) => setBlocks((b) => { const i = b.findIndex((x) => x.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= b.length) return b; const n = [...b]; [n[i], n[j]] = [n[j], n[i]]; return n })

  // ── Templates ─────────────────────────────────────────────────────────────
  const config = useMemo(() => ({ blocks, orientation }), [blocks, orientation])
  const applyConfig = (cfg) => { if (cfg?.blocks) setBlocks(cfg.blocks); if (cfg?.orientation) setOrientation(cfg.orientation) }

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
      setToast({ t: 'ok', m: `Layout “${name}” saved.` })
    } catch (e) {
      setToast({ t: 'err', m: e?.message || 'Could not save layout (saved locally instead).' })
    } finally { setSaving(false) }
  }
  const loadTemplate = (row) => { applyConfig(row.config); setTplId(row.id); setTplName(row.name); setLoadOpen(false); setToast({ t: 'ok', m: `Loaded “${row.name}”.` }) }
  const removeTemplate = async (row) => { try { await deleteTemplate(row.id); setTemplates((ts) => ts.filter((x) => x.id !== row.id)); if (tplId === row.id) { setTplId(''); setTplName('') } } catch (e) { setToast({ t: 'err', m: e?.message || 'Delete failed.' }) } }
  const newTemplate = () => { setTplId(''); setTplName(''); setBlocks(STARTER()); setToast({ t: 'ok', m: 'Started a fresh layout.' }) }

  // ── PDF export (charts rasterised from live canvases) ─────────────────────────
  const exportPdf = useCallback(async () => {
    setExporting(true)
    try {
      const [{ default: JsPDF }, auto] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
      const autoTable = auto.default
      const doc = new JsPDF({ orientation, unit: 'mm', format: 'a4' })
      const PW = doc.internal.pageSize.width, PH = doc.internal.pageSize.height
      const MX = 14
      let y = 16

      const ensure = (h) => { if (y + h > PH - 14) { doc.addPage(); y = 16 } }
      const stamp = new Date().toISOString().slice(0, 10)

      for (const b of blocks) {
        if (b.type === 'pagebreak') { doc.addPage(); y = 16; continue }

        if (b.type === 'header') {
          if (b.logo) { try { doc.addImage(b.logo, 'PNG', MX, y, 22, 22, undefined, 'FAST') } catch { /* ignore */ } }
          const tx = b.logo ? MX + 28 : MX
          doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
          doc.text(b.title || 'Report', tx, y + 8)
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(71, 85, 105)
          const sub = [b.subtitle, company, b.showDate ? `Generated ${stamp}` : ''].filter(Boolean).join('  ·  ')
          if (sub) doc.text(sub, tx, y + 15)
          y += 26
          doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.4); doc.line(MX, y, PW - MX, y); y += 6
          continue
        }

        if (b.type === 'kpis') {
          const items = (b.items || []).filter((k) => KPIS[k])
          if (!items.length) continue
          const perRow = orientation === 'landscape' ? 6 : 3
          const gap = 3, cw = (PW - MX * 2 - gap * (perRow - 1)) / perRow, ch = 20
          items.forEach((k, i) => {
            const col = i % perRow
            if (col === 0) ensure(ch + gap)
            const x = MX + col * (cw + gap)
            const cy = y
            const def = KPIS[k]; const raw = def.get(ctx); const val = def.money ? money(raw) : String(raw)
            doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3)
            doc.roundedRect(x, cy, cw, ch, 1.5, 1.5, 'FD')
            doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
            doc.text(val, x + 3, cy + 9)
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139)
            doc.text(def.label.toUpperCase(), x + 3, cy + 15)
            if (col === perRow - 1 || i === items.length - 1) y += ch + gap
          })
          y += 2
          continue
        }

        if (b.type === 'chart') {
          const inst = chartRefs.current[b.id]
          const img = inst?.toBase64Image?.('image/png', 1)
          const cw = PW - MX * 2
          const ch = Math.min(orientation === 'landscape' ? 95 : 80, (b.height || 240) * 0.32)
          ensure(ch + 10)
          if (b.title) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 23, 42); doc.text(b.title, MX, y + 4); y += 6 }
          if (img) { try { doc.addImage(img, 'PNG', MX, y, cw, ch, undefined, 'FAST') } catch { /* ignore */ } }
          else { doc.setFontSize(9); doc.setTextColor(148, 163, 184); doc.text('(chart unavailable)', MX, y + 6) }
          y += ch + 6
          continue
        }

        if (b.type === 'text') {
          ensure(16)
          if (b.title) { doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42); doc.text(b.title, MX, y + 4); y += 6 }
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(51, 65, 85)
          const lines = doc.splitTextToSize(b.body || '', PW - MX * 2)
          lines.forEach((ln) => { ensure(6); doc.text(ln, MX, y + 4); y += 5.2 })
          y += 4
          continue
        }

        if (b.type === 'table') {
          const cols = (b.columns || []).filter((c) => TABLE_COLS[c])
          if (!cols.length) continue
          const rows = records.slice(0, Math.max(1, b.limit || 25)).map((r) => cols.map((c) => fmtCell(c, r[c], money)))
          if (b.title) { ensure(8); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42); doc.text(b.title, MX, y + 4); y += 6 }
          autoTable(doc, {
            startY: y, margin: { left: MX, right: MX }, theme: 'grid',
            head: [cols.map((c) => TABLE_COLS[c])],
            body: rows.length ? rows : [cols.map(() => '—')],
            styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, textColor: [51, 65, 85], lineColor: [226, 232, 240], lineWidth: 0.1 },
            headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
            alternateRowStyles: { fillColor: [248, 250, 252] },
          })
          y = doc.lastAutoTable.finalY + 6
          continue
        }
      }

      // Footer page numbers
      const pages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= pages; p++) {
        doc.setPage(p); doc.setFontSize(8); doc.setTextColor(148, 163, 184)
        doc.text(`${company}  ·  Accident Report`, MX, PH - 8)
        doc.text(`Page ${p} / ${pages}`, PW - MX, PH - 8, { align: 'right' })
      }
      doc.save(`Accident_Report_${stamp}.pdf`)
      setToast({ t: 'ok', m: 'PDF exported.' })
    } catch (e) {
      setToast({ t: 'err', m: e?.message || 'Export failed.' })
    } finally { setExporting(false) }
  }, [blocks, orientation, ctx, records, company, money])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg border ${toast.t === 'ok' ? 'bg-green-500/15 border-green-500/40 text-green-300' : 'bg-red-500/15 border-red-500/40 text-red-300'}`}>{toast.m}</div>
      )}

      {/* Toolbar */}
      <div className="card flex flex-wrap items-center gap-2">
        <div className="relative">
          <button onClick={() => setAddOpen((v) => !v)} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={15} /> Add block</button>
          {addOpen && (
            <div className="absolute z-40 top-full left-0 mt-1 w-52 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg shadow-xl overflow-hidden">
              {Object.entries(BLOCK_META).map(([type, m]) => { const Icon = m.icon; return (
                <button key={type} onClick={() => addBlock(type)} className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--input-bg-hover)] hover:text-[var(--text-primary)] inline-flex items-center gap-2"><Icon size={15} /> {m.label}</button>
              ) })}
            </div>
          )}
        </div>

        <div className="h-6 w-px bg-[var(--input-border)] mx-1" />

        <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Layout name…" className="input text-sm w-40" />
        <button onClick={saveTemplate} disabled={saving} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {tplId ? 'Update' : 'Save'}</button>
        <div className="relative">
          <button onClick={() => setLoadOpen((v) => !v)} className="btn-secondary text-sm inline-flex items-center gap-1.5"><FolderOpen size={14} /> Load{templates.length ? ` (${templates.length})` : ''}</button>
          {loadOpen && (
            <div className="absolute z-40 top-full left-0 mt-1 w-64 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg shadow-xl overflow-hidden max-h-64 overflow-y-auto">
              {templates.length === 0 ? <p className="px-3 py-3 text-xs text-[var(--text-muted)]">No saved layouts yet.</p> : templates.map((row) => (
                <div key={row.id} className="flex items-center gap-1 px-2 py-1.5 hover:bg-[var(--input-bg-hover)]">
                  <button onClick={() => loadTemplate(row)} className="flex-1 text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate">{row.name}</button>
                  <button onClick={() => removeTemplate(row)} className="p-1 text-[var(--text-muted)] hover:text-red-400" title="Delete layout"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={newTemplate} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Sparkles size={14} /> New</button>

        <div className="ml-auto flex items-center gap-2">
          <select value={orientation} onChange={(e) => setOrientation(e.target.value)} className="input text-sm">
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
          <button onClick={exportPdf} disabled={exporting || !blocks.length} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">{exporting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Export PDF</button>
        </div>
      </div>

      {/* Builder + preview */}
      {blocks.length === 0 ? (
        <div className="card text-center py-16">
          <LayoutGrid size={34} className="mx-auto mb-3 text-[var(--text-muted)] opacity-60" />
          <p className="text-[var(--text-primary)] font-medium">Empty report</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">Use “Add block” to drop in a header, KPIs, charts, text or a detail table.</p>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-[860px] bg-white text-slate-800 rounded-xl shadow-2xl border border-black/10 overflow-hidden">
          <div className="p-6 sm:p-8 space-y-5">
            {blocks.map((b, i) => (
              <BlockEditor
                key={b.id} block={b} index={i} count={blocks.length}
                ctx={ctx} records={records} money={money}
                chartRefs={chartRefs}
                onPatch={patchBlock} onRemove={removeBlock} onDup={dupBlock} onMove={move}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Per-block editor + WYSIWYG preview ────────────────────────────────────────
function BlockEditor({ block: b, index, count, ctx, records, money, chartRefs, onPatch, onRemove, onDup, onMove }) {
  const [openCfg, setOpenCfg] = useState(false)
  const Meta = BLOCK_META[b.type] || { label: b.type, icon: LayoutGrid }
  const Icon = Meta.icon

  return (
    <div className="group relative rounded-lg ring-1 ring-transparent hover:ring-slate-200 transition-shadow">
      {/* Block toolbar (hover) */}
      <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200 inline-flex items-center gap-1"><Icon size={11} /> {Meta.label}</span>
        <IconBtn title="Configure" onClick={() => setOpenCfg((v) => !v)}><GripVertical size={13} /></IconBtn>
        <IconBtn title="Move up" disabled={index === 0} onClick={() => onMove(b.id, -1)}><ChevronUp size={13} /></IconBtn>
        <IconBtn title="Move down" disabled={index === count - 1} onClick={() => onMove(b.id, 1)}><ChevronDown size={13} /></IconBtn>
        <IconBtn title="Duplicate" onClick={() => onDup(b.id)}><Copy size={13} /></IconBtn>
        <IconBtn title="Remove" danger onClick={() => onRemove(b.id)}><Trash2 size={13} /></IconBtn>
      </div>

      {openCfg && <BlockConfig block={b} onPatch={onPatch} />}

      <BlockPreview block={b} ctx={ctx} records={records} money={money} chartRefs={chartRefs} />
    </div>
  )
}

function IconBtn({ children, onClick, title, danger, disabled }) {
  return <button title={title} disabled={disabled} onClick={onClick} className={`p-1 rounded bg-white border border-slate-200 text-slate-500 hover:text-slate-800 disabled:opacity-30 ${danger ? 'hover:text-red-600 hover:border-red-300' : ''}`}>{children}</button>
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
        </div>
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
      {b.type === 'pagebreak' && <p className="text-xs text-slate-500">Forces the following blocks onto a new PDF page.</p>}
    </div>
  )
}

function BlockPreview({ block: b, ctx, records, money, chartRefs }) {
  if (b.type === 'header') {
    const stamp = new Date().toISOString().slice(0, 10)
    return (
      <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
        {b.logo ? <img src={b.logo} alt="logo" className="h-14 w-auto object-contain" /> : <div className="h-14 w-14 rounded bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-slate-300"><ImageIcon size={20} /></div>}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{b.title || 'Report'}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{[b.subtitle, ctx.company, b.showDate ? `Generated ${stamp}` : ''].filter(Boolean).join('  ·  ') || 'Accident & claims report'}</p>
        </div>
      </div>
    )
  }
  if (b.type === 'kpis') {
    const items = (b.items || []).filter((k) => KPIS[k])
    if (!items.length) return <Placeholder>No KPIs selected — configure this block.</Placeholder>
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
    const empty = !data.labels?.length || data.datasets?.[0]?.data?.every((v) => !v)
    return (
      <div>
        {(b.title || def.label) && <p className="text-sm font-semibold text-slate-800 mb-2">{b.title || def.label}</p>}
        <div style={{ height: b.height || 240 }} className="relative">
          {empty ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">No data for this chart yet</div>
            : <Comp ref={(el) => { chartRefs.current[b.id] = el }} data={data} options={opts} />}
        </div>
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
  if (b.type === 'pagebreak') return <div className="flex items-center gap-2 text-slate-300"><div className="flex-1 border-t border-dashed border-slate-300" /><span className="text-[10px] uppercase tracking-wider">Page break</span><div className="flex-1 border-t border-dashed border-slate-300" /></div>
  return null
}

function Placeholder({ children }) { return <div className="rounded-lg bg-slate-50 border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">{children}</div> }

function fmtCell(col, v, money) {
  if (v == null || v === '') return '—'
  if (['claim_amount', 'claim_approved_amount', 'recovered_amount', 'repair_cost'].includes(col)) return money(v)
  if (col === 'gcc_liability_ratio') return `${Number(v)}%`
  if (col === 'incident_date' || col === 'expected_release_date') return String(v).slice(0, 10)
  return String(v)
}
