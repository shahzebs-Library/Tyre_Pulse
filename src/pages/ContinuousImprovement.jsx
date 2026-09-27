import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, Download, FileText, TrendingUp, TrendingDown,
  ChevronDown, ChevronRight, CheckCircle, Clock, AlertTriangle,
  XCircle, DollarSign, BarChart2, Target, RefreshCw, Plus,
  Package, Wrench, Search, ShieldCheck, Star,
  ArrowUpRight, ArrowDownRight, Award, Activity, Info,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import * as ciApi from '../lib/api/continuousImprovement'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  fmt, fmtCur, monthLabel, filterByPeriod, computeMetrics, improvementScore as buildImprovementScore,
  buildOpportunities, cpkTrend, failureTrend, closeRateTrend, findTarget, kpiScorecard as buildKpiScorecard,
  actionStats as buildActionStats, filterActions, roiSummary as buildRoiSummary,
  actionExportRows, ACTION_EXPORT_COLS, ACTION_EXPORT_HEADERS, OVERDUE_ACTION_DAYS,
} from '../lib/continuousImprovementAnalytics'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIORITY_BADGE = {
  High:   'bg-red-900/50 text-red-300 border border-red-700/50',
  Medium: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
  Low:    'bg-blue-900/50 text-blue-300 border border-blue-700/50',
}

const STATUS_COLORS = {
  Open:         'bg-red-900/40 text-red-300 border border-red-700/50',
  'In Progress':'bg-yellow-900/40 text-yellow-300 border border-yellow-700/50',
  Closed:       'bg-green-900/40 text-green-300 border border-green-700/50',
  Overdue:      'bg-orange-900/40 text-orange-300 border border-orange-700/50',
}

const CATEGORY_META = {
  cost:        { label: 'Cost Reduction',      icon: DollarSign,  color: '#10b981', bg: 'from-green-900/20'  },
  reliability: { label: 'Reliability',          icon: ShieldCheck, color: '#3b82f6', bg: 'from-blue-900/20'   },
  process:     { label: 'Process',              icon: RefreshCw,   color: '#f59e0b', bg: 'from-yellow-900/20' },
  inspection:  { label: 'Inspection',           icon: Search,      color: '#8b5cf6', bg: 'from-purple-900/20' },
  maintenance: { label: 'Maintenance',          icon: Wrench,      color: '#ef4444', bg: 'from-red-900/20'    },
  procurement: { label: 'Procurement',          icon: Package,     color: '#06b6d4', bg: 'from-cyan-900/20'   },
}

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-secondary)', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      titleColor: 'var(--panel-ink)',
      bodyColor: 'var(--text-secondary)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Null-last sort for EnterpriseTable columns. */
function nullLastSort(rowA, rowB, id) {
  const a = rowA.getValue(id)
  const b = rowB.getValue(id)
  const ba = a == null || a === ''
  const bb = b == null || b === ''
  if (ba && bb) return 0
  if (ba) return 1
  if (bb) return -1
  return compareValues(a, b)
}

function scoreColor(score) {
  if (score == null) return 'text-[var(--text-muted)]'
  if (score >= 75) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function scoreBg(score) {
  if (score == null) return 'border-[var(--input-border)]'
  if (score >= 75) return 'border-green-700/50 bg-green-950/20'
  if (score >= 50) return 'border-yellow-700/50 bg-yellow-950/10'
  return 'border-red-700/50 bg-red-950/20'
}

// ── Opportunity row component ─────────────────────────────────────────────────

function OpportunityRow({ opp, onCreateAction, alreadyCreated, creating }) {
  const { activeCurrency } = useSettings()
  const [expanded, setExpanded] = useState(false)
  const ImpactIcon = opp.saving > 0 ? ArrowDownRight : ArrowUpRight

  return (
    <motion.div
      layout
      className="border border-[var(--input-border)] rounded-lg overflow-hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        className="w-full flex flex-wrap items-center gap-3 px-4 py-3 min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] bg-[var(--surface-1)] hover:bg-[var(--input-bg)]/60 transition-colors text-left"
      >
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${PRIORITY_BADGE[opp.priority] ?? PRIORITY_BADGE.Medium}`}>
          {opp.priority}
        </span>
        <span className="flex-1 text-sm text-[var(--text-secondary)]">{opp.title}</span>
        {opp.saving === null && (
          <span className="text-xs text-[var(--text-dim)]">Saving not measurable</span>
        )}
        {opp.saving > 0 && (
          <span className="flex items-center gap-1 text-xs text-green-400 font-medium">
            <ImpactIcon size={12} />
            Est. {fmtCur(opp.saving, opp.currency ?? activeCurrency)} / yr
          </span>
        )}
        {opp.impactPct > 0 && (
          <span className="text-xs text-emerald-400 font-medium ml-2">{fmt(opp.impactPct, 1)}% improvement</span>
        )}
        {expanded ? <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" /> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 bg-[var(--input-bg)]/60 border-t border-[var(--input-border)] space-y-3">
              <p className="text-sm text-[var(--text-muted)]">{opp.description}</p>
              {opp.details && (
                <ul className="space-y-1">
                  {opp.details.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
                      <span className="text-[var(--text-dim)] mt-0.5" aria-hidden="true">-</span>
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-3 pt-1">
                {alreadyCreated ? (
                  <span className="flex items-center gap-1 text-xs text-green-400">
                    <CheckCircle size={12} /> Action already created
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onCreateAction(opp)}
                    disabled={creating}
                    className="flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                  >
                    {creating ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                    Create Corrective Action
                  </button>
                )}
                {opp.site && (
                  <span className="text-xs text-[var(--text-dim)]">Site: {opp.site}</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Category accordion ────────────────────────────────────────────────────────

function CategoryAccordion({ categoryKey, opportunities, onCreateAction, createdTitles, creatingKey }) {
  const [open, setOpen] = useState(true)
  const meta = CATEGORY_META[categoryKey]
  const Icon = meta.icon

  return (
    <div className={`bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] hover:bg-[var(--input-bg)]/40 transition-colors"
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: `${meta.color}20` }}>
          <Icon size={14} style={{ color: meta.color }} />
        </span>
        <span className="font-semibold text-sm text-[var(--text-secondary)]">{meta.label} Opportunities</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">{opportunities.length} found</span>
          {open ? <ChevronDown size={14} className="text-[var(--text-muted)]" /> : <ChevronRight size={14} className="text-[var(--text-muted)]" />}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2 border-t border-[var(--input-border)]">
              {opportunities.length === 0 ? (
                <p className="text-xs text-[var(--text-dim)] py-3 text-center">No improvement opportunities detected, performing well in this area.</p>
              ) : (
                opportunities.map((opp, i) => (
                  <OpportunityRow
                    key={opp.key ?? i}
                    opp={opp}
                    onCreateAction={onCreateAction}
                    alreadyCreated={createdTitles.has(opp.title)}
                    creating={creatingKey === opp.key}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium
        ${type === 'success' ? 'bg-green-950 border-green-700 text-green-300' : 'bg-red-950 border-red-700 text-red-300'}`}
    >
      {type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
      {message}
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContinuousImprovement() {
  const { activeCurrency, activeCountry } = useSettings()

  const [records, setRecords]     = useState([])
  const [actions, setActions]     = useState([])
  const [inspections, setInspections] = useState([])
  const [targets, setTargets]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [creatingKey, setCreatingKey] = useState(null)
  const [toast, setToast]         = useState(null)
  const [period, setPeriod]       = useState('6mo')
  const [closingId, setClosingId] = useState(null)

  // ── Load data ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [recRes, actRes, insRes, tgtRes] = await Promise.all([
        ciApi.listImprovementTyreRecords({ country: activeCountry }),
        ciApi.listImprovementActions({ country: activeCountry }),
        ciApi.listImprovementInspections({ country: activeCountry }),
        ciApi.listImprovementKpiTargets(),
      ])

      setRecords(recRes.data ?? [])
      setActions(actRes.data ?? [])
      setInspections(insRes.data ?? [])
      setTargets(tgtRes.data ?? [])
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load data'))
    }
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Derived (pure engine: continuousImprovementAnalytics) ─────────────────
  // The period picker scopes the KPIs and the opportunity finder; the score and
  // the progress charts always read the rolling 12 months so a trend is visible.
  const [computedAt, setComputedAt] = useState(() => new Date())
  useEffect(() => { if (!loading) setComputedAt(new Date()) }, [loading])
  const periodRecords = useMemo(() => filterByPeriod(records, period, computedAt), [records, period, computedAt])
  const metrics = useMemo(() => computeMetrics(periodRecords, inspections, actions), [periodRecords, inspections, actions])
  const scoreMetrics = useMemo(() => computeMetrics(records, inspections, actions), [records, inspections, actions])
  const improvementScore = useMemo(() => buildImprovementScore(records, scoreMetrics, computedAt), [records, scoreMetrics, computedAt])
  const opportunities = useMemo(
    () => buildOpportunities({ records: periodRecords, actions, inspections, metrics, currency: activeCurrency, now: computedAt }),
    [periodRecords, actions, inspections, metrics, activeCurrency, computedAt],
  )

  // ── Action tracking ───────────────────────────────────────────────────────────

  const createdTitles = useMemo(() => new Set(actions.map(a => a.title)), [actions])

  const handleCreateAction = useCallback(async (opp) => {
    setCreatingKey(opp.key)
    try {
      const { error: insErr } = await ciApi.insertCorrectiveAction({
        title: opp.title,
        description: opp.description ?? '',
        site: opp.site ?? 'All',
        priority: opp.priority,
        status: 'Open',
        due_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      })
      if (insErr) throw insErr
      setToast({ message: 'Corrective action created successfully', type: 'success' })
      // Refresh actions
      const { data } = await ciApi.listCorrectiveActionsRefresh()
      setActions(data ?? [])
    } catch (e) {
      setToast({ message: toUserMessage(e, 'Failed to create action'), type: 'error' })
    }
    setCreatingKey(null)
  }, [])

  const handleCloseAction = useCallback(async (id) => {
    setClosingId(id)
    try {
      await ciApi.closeCorrectiveAction(id, {
        status: 'Closed',
        resolved_at: new Date().toISOString(),
      })
      setActions(prev => prev.map(a => a.id === id ? { ...a, status: 'Closed', resolved_at: new Date().toISOString() } : a))
      setToast({ message: 'Action closed successfully', type: 'success' })
    } catch (e) {
      setToast({ message: toUserMessage(e, 'Failed to close action'), type: 'error' })
    }
    setClosingId(null)
  }, [])

  // ── Monthly trend charts ──────────────────────────────────────────────────────

  const cpkTrendData = useMemo(() => {
    const tr = cpkTrend(records, computedAt)
    const target = findTarget(targets, 'target_cpk', 'max_cpk')
    const datasets = [{
      label: 'Avg CPK', data: tr.values, borderColor: colorAt(0), backgroundColor: withAlpha(colorAt(0), 0.12),
      fill: true, tension: 0.4, spanGaps: true, pointRadius: 3,
    }]
    if (target != null) datasets.push({ label: 'CPK Target', data: tr.keys.map(() => target), borderColor: '#10b981', borderDash: [5, 4], fill: false, pointRadius: 0, tension: 0 })
    return { labels: tr.keys.map(monthLabel), datasets }
  }, [records, targets, computedAt])

  const failureRateTrendData = useMemo(() => {
    const tr = failureTrend(records, computedAt)
    const target = findTarget(targets, 'max_failure_rate', 'failure_rate_target')
    const datasets = [{
      label: 'Failure Rate %', data: tr.values, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.12)',
      fill: true, tension: 0.4, spanGaps: true, pointRadius: 3,
    }]
    if (target != null) datasets.push({ label: 'Target', data: tr.keys.map(() => target), borderColor: '#10b981', borderDash: [5, 4], fill: false, pointRadius: 0, tension: 0 })
    return { labels: tr.keys.map(monthLabel), datasets }
  }, [records, targets, computedAt])

  const actionCloseTrend = useMemo(() => {
    const tr = closeRateTrend(actions, computedAt)
    return {
      labels: tr.keys.map(monthLabel),
      datasets: [{
        label: 'Close Rate %', data: tr.values, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.15)',
        fill: true, tension: 0.4, spanGaps: true, pointRadius: 3,
      }],
    }
  }, [actions, computedAt])

  const kpiScorecard = useMemo(() => {
    const format = (kind, v) => (kind === 'cpk' ? fmt(v, 4) : kind === 'pct' ? (v == null ? 'N/A' : `${fmt(v, 1)}%`) : fmtCur(v, activeCurrency))
    return buildKpiScorecard(metrics, targets).map((k) => ({ ...k, fmt: (v) => format(k.kind, v) }))
  }, [metrics, targets, activeCurrency])

  const kpiBarData = useMemo(() => {
    const rows = kpiScorecard.filter((k) => k.current != null)
    if (!rows.length) return null
    return {
      labels: rows.map((k) => k.label),
      datasets: [
        {
          label: 'Current',
          data: rows.map((k) => k.current),
          backgroundColor: rows.map((k) => (k.status === 'Met' ? 'rgba(16,185,129,0.7)' : k.status === 'Close' ? 'rgba(245,158,11,0.7)' : 'rgba(239,68,68,0.7)')),
          borderRadius: 4,
        },
        {
          label: 'Target', data: rows.map((k) => k.target),
          backgroundColor: 'var(--text-muted)', borderColor: 'var(--text-muted)', borderWidth: 1, borderRadius: 4,
        },
      ],
    }
  }, [kpiScorecard])

  const actionStats = useMemo(() => buildActionStats(actions, computedAt), [actions, computedAt])
  const [actionStatus, setActionStatus] = useState('all')
  const [actionPriority, setActionPriority] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const actionRows = useMemo(
    () => filterActions(actionStats.openTable, { status: actionStatus, priority: actionPriority, overdueOnly }),
    [actionStats, actionStatus, actionPriority, overdueOnly],
  )
  const roiSummary = useMemo(() => buildRoiSummary(actions, actionStats, metrics, opportunities), [actions, actionStats, metrics, opportunities])

  const actionColumns = useMemo(() => [
    { id: 'title', header: 'Title', accessorFn: (a) => a.title, size: 260, sortingFn: nullLastSort,
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)] line-clamp-2">{getValue() || 'N/A'}</span> },
    { id: 'site', header: 'Site', accessorFn: (a) => a.site ?? null, size: 110, sortingFn: nullLastSort, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'priority', header: 'Priority', accessorFn: (a) => ({ High: 0, Medium: 1, Low: 2 }[a.priority] ?? 1), size: 100,
      meta: { exportValue: (a) => a.priority },
      cell: ({ row }) => (
        <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${PRIORITY_BADGE[row.original.priority] ?? PRIORITY_BADGE.Medium}`}>{row.original.priority || 'N/A'}</span>
      ) },
    { id: 'days_open', header: 'Days Open', accessorFn: (a) => a.days_open, size: 110, sortingFn: nullLastSort, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={`tabular-nums font-medium ${row.original.overdue ? 'text-orange-400' : 'text-[var(--text-muted)]'}`}>
          {row.original.days_open == null ? 'N/A' : `${row.original.days_open}d`}
          {row.original.overdue && <span className="ml-1 text-[10px] text-orange-500">OVERDUE</span>}
        </span>
      ) },
    { id: 'status', header: 'Status', accessorFn: (a) => a.status, size: 110,
      cell: ({ getValue }) => <span className={`px-1.5 py-0.5 rounded text-[11px] ${STATUS_COLORS[getValue()] ?? STATUS_COLORS.Open}`}>{getValue() || 'N/A'}</span> },
    { id: 'action', header: 'Action', enableSorting: false, size: 100, meta: { export: false },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => handleCloseAction(row.original.id)}
          disabled={closingId === row.original.id}
          aria-label={`Close action: ${row.original.title}`}
          className="px-3 min-h-[36px] rounded bg-green-800/50 hover:bg-green-700/50 text-green-300 text-xs transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          {closingId === row.original.id ? 'Closing' : 'Close'}
        </button>
      ) },
  ], [closingId, handleCloseAction])

  const scorecardColumns = useMemo(() => [
    { id: 'label', header: 'Metric', accessorFn: (k) => k.label },
    { id: 'current', header: 'Current', accessorFn: (k) => k.current, sortingFn: nullLastSort, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-mono">{row.original.fmt(row.original.current)}</span> },
    { id: 'target', header: 'Target', accessorFn: (k) => k.target, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-mono text-[var(--text-muted)]">{row.original.fmt(row.original.target)}</span> },
    { id: 'gap', header: 'Gap', accessorFn: (k) => k.gap, sortingFn: nullLastSort, meta: { align: 'right' },
      cell: ({ row }) => {
        const k = row.original
        return (
          <span className={`font-mono text-xs ${k.status === 'Met' ? 'text-green-400' : k.status === 'Close' ? 'text-yellow-400' : k.status === 'No data' ? 'text-[var(--text-muted)]' : 'text-red-400'}`}>
            {k.gap != null ? (k.gap >= 0 ? '+' : '') + k.fmt(k.gap) : 'N/A'}
          </span>
        )
      } },
    { id: 'status', header: 'Status', accessorFn: (k) => k.status, meta: { align: 'right' },
      cell: ({ getValue }) => (
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
          getValue() === 'Met' ? 'bg-green-900/50 text-green-300 border border-green-700/50'
            : getValue() === 'Close' ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50'
              : getValue() === 'No data' ? 'bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--input-border)]'
                : 'bg-red-900/50 text-red-300 border border-red-700/50'
        }`}>{getValue()}</span>
      ) },
  ], [])

  // ── Exports ───────────────────────────────────────────────────────────────────

  const handleExcelExport = useCallback(() => {
    if (!actionStats.all.length) return
    exportToExcel(
      actionExportRows(actionStats.all),
      ACTION_EXPORT_COLS,
      ACTION_EXPORT_HEADERS,
      reportFileName('TyrePulse Continuous Improvement Actions', reportDateLabel()),
      'Actions',
    )
  }, [actionStats])

  const handlePdfExport = useCallback(() => {
    if (!actionStats.all.length) return
    const cols = ['title', 'site', 'priority', 'status', 'days_open', 'overdue']
    exportToPdf(
      actionExportRows(actionStats.all),
      cols.map((k) => ({ key: k, header: ACTION_EXPORT_HEADERS[ACTION_EXPORT_COLS.indexOf(k)] })),
      'Continuous Improvement Report: Corrective Actions',
      reportFileName('TyrePulse Continuous Improvement', reportDateLabel()),
      'landscape',
    )
  }, [actionStats])

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={32} className="text-blue-400 animate-spin" />
          <p className="text-[var(--text-muted)] text-sm">Loading continuous improvement data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-4 text-center" role="alert">
        <XCircle size={36} className="text-red-400" aria-hidden="true" />
        <p className="text-red-400 font-medium">{error}</p>
        <p className="text-xs text-[var(--text-muted)] max-w-sm">The improvement data could not be loaded, so no score or opportunity is shown rather than a misleading zero.</p>
        <button type="button" onClick={load} className="btn-primary min-h-[44px] px-4 inline-flex items-center gap-2">
          <RefreshCw size={14} aria-hidden="true" /> Retry
        </button>
      </div>
    )
  }

  const totalOpps = Object.values(opportunities).reduce((s, arr) => s + arr.length, 0)
  const noData = !records.length && !actions.length && !inspections.length

  return (
    <div className="text-[var(--text-secondary)] space-y-6">

      {/* ── Header ── */}
      <PageHeader
        title="Continuous Improvement"
        subtitle="Systematic identification and tracking of cost reduction, reliability, and process improvement opportunities"
        icon={Zap}
        actions={<>
          <SegmentedControl
            ariaLabel="period"
            size="sm"
            value={period}
            onChange={setPeriod}
            options={[
              { value: '3mo', label: 'Last 3 Mo' },
              { value: '6mo', label: 'Last 6 Mo' },
              { value: '1yr', label: 'Last 12 Mo' },
            ]}
          />
          <button
            type="button"
            onClick={handleExcelExport}
            disabled={!actionStats.all.length}
            className="disabled:opacity-50 min-h-[44px] flex items-center gap-1.5 px-3 rounded-lg bg-green-700 hover:bg-green-600 text-white text-xs font-medium transition-colors"
          >
            <Download size={13} /> Excel
          </button>
          <button
            type="button"
            onClick={handlePdfExport}
            disabled={!actionStats.all.length}
            className="disabled:opacity-50 min-h-[44px] flex items-center gap-1.5 px-3 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors"
          >
            <FileText size={13} /> PDF
          </button>
        </>}
      />

      {noData && (
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-6 text-center">
          <Info size={22} className="text-[var(--text-dim)] mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)] font-medium">No tyre, inspection or corrective action records yet</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Scores and opportunities appear once data is recorded for this country.</p>
        </div>
      )}

      {/* ── Section 2: Improvement Score ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className={`bg-[var(--surface-1)] border rounded-xl p-5 ${scoreBg(improvementScore.total)}`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          {/* Main score */}
          <div className="flex flex-col items-center lg:items-start gap-1 min-w-[140px]">
            <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wider">Improvement Programme Score</p>
            <div className="flex items-end gap-2">
              <span className={`text-6xl font-black tabular-nums ${scoreColor(improvementScore.total)}`}>
                {improvementScore.total ?? 'N/A'}
              </span>
              <span className="text-[var(--text-dim)] text-xl mb-2">/100</span>
            </div>
            {improvementScore.total != null && improvementScore.measured < 4 && (
              <span className="text-[11px] text-[var(--text-dim)]">Scaled over {improvementScore.measured} of 4 measurable components</span>
            )}
            {improvementScore.delta != null && (
              <span className={`flex items-center gap-1 text-xs font-medium ${improvementScore.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {improvementScore.delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {improvementScore.delta >= 0 ? '+' : ''}{improvementScore.delta} vs last month
              </span>
            )}
          </div>

          {/* Component breakdown */}
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Cost Improvement',    pts: improvementScore.costPts,  max: 25, color: '#10b981' },
              { label: 'Reliability',          pts: improvementScore.relPts,   max: 25, color: '#3b82f6' },
              { label: 'Insp. Compliance',     pts: improvementScore.inspPts,  max: 25, color: '#8b5cf6' },
              { label: 'Action Close Rate',    pts: improvementScore.closePts, max: 25, color: '#f59e0b' },
            ].map(item => (
              <div key={item.label} className="bg-[var(--input-bg)]/60 rounded-lg p-3">
                <p className="text-xs text-[var(--text-muted)] mb-1">{item.label}</p>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-bold" style={{ color: item.pts == null ? 'var(--text-muted)' : item.color }}>{item.pts ?? 'N/A'}</span>
                  <span className="text-xs text-[var(--text-dim)]">/{item.max}</span>
                </div>
                <div className="h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${((item.pts ?? 0) / item.max) * 100}%`, background: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Section 7: ROI Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Actions Raised',    value: fmt(roiSummary.totalRaised),              icon: Activity,      color: 'text-blue-400',   desc: 'All time' },
          { label: 'Actions Closed',          value: fmt(roiSummary.totalClosed),              icon: CheckCircle,   color: 'text-green-400',  desc: metrics.closeRate == null ? 'No actions raised' : `${fmt(metrics.closeRate, 0)}% close rate` },
          { label: 'Est. Cost Avoidance',     value: fmtCur(roiSummary.costAvoidance, activeCurrency), icon: DollarSign, color: 'text-emerald-400', desc: 'From closed critical actions' },
          { label: 'Open Action Backlog Risk',value: fmtCur(roiSummary.backlogRisk, activeCurrency),  icon: AlertTriangle,color: 'text-orange-400', desc: 'Open critical actions' },
        ].map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={15} className={card.color} />
                <span className="text-xs text-[var(--text-muted)]">{card.label}</span>
              </div>
              <p className={`text-xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
              <p className="text-xs text-[var(--text-dim)] mt-0.5">{card.desc}</p>
            </div>
          )
        })}
      </div>

      {roiSummary.totalSaving > 0 && (
        <div className="bg-emerald-950/30 border border-emerald-700/40 rounded-xl p-4 flex items-center gap-3">
          <Award size={18} className="text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300">
            <span className="font-semibold">{totalOpps} improvement opportunities identified</span> with a combined estimated annual saving potential of{' '}
            <span className="font-bold">{fmtCur(roiSummary.totalSaving, activeCurrency)}</span>
            {roiSummary.unpricedOpportunities > 0 ? ` (${roiSummary.unpricedOpportunities} further opportunities could not be priced from measured data)` : ''}.
          </p>
        </div>
      )}

      {/* ── Section 3: Opportunity Finder ── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <Star size={14} className="text-yellow-400" />
          Improvement Opportunity Finder
          <span className="text-xs text-[var(--text-dim)] font-normal">- auto-generated from fleet data</span>
          <span className="ml-auto text-xs text-[var(--text-muted)]">{totalOpps} opportunities across 6 categories</span>
        </h2>
        <div className="space-y-3">
          {Object.keys(CATEGORY_META).map(cat => (
            <CategoryAccordion
              key={cat}
              categoryKey={cat}
              opportunities={opportunities[cat] ?? []}
              onCreateAction={handleCreateAction}
              createdTitles={createdTitles}
              creatingKey={creatingKey}
            />
          ))}
        </div>
      </div>

      {/* ── Section 4: Progress Tracking Charts ── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <BarChart2 size={14} className="text-blue-400" />
          Progress Tracking - Last 12 Months
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">CPK Trend vs Target</p>
            <div className="h-52">
              {cpkTrendData.datasets[0].data.some(v => v != null) ? (
                <Line
                  data={cpkTrendData}
                  options={{
                    ...CHART_BASE,
                    scales: {
                      ...CHART_BASE.scales,
                      y: { ...CHART_BASE.scales.y, title: { display: true, text: 'CPK', color: 'var(--text-muted)', font: { size: 10 } } },
                    },
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">Insufficient CPK data for trend</div>
              )}
            </div>
          </div>

          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">Failure Rate Trend vs Target</p>
            <div className="h-52">
              {failureRateTrendData.datasets[0].data.some(v => v != null) ? (
                <Line
                  data={failureRateTrendData}
                  options={{
                    ...CHART_BASE,
                    scales: {
                      ...CHART_BASE.scales,
                      y: { ...CHART_BASE.scales.y, title: { display: true, text: 'Failure %', color: 'var(--text-muted)', font: { size: 10 } } },
                    },
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">Insufficient failure rate data</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 5: Corrective Action Programme ── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <Wrench size={14} className="text-orange-400" />
          Corrective Action Programme
        </h2>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Open',        count: actionStats.open.length,       color: 'text-red-400',    icon: AlertTriangle },
            { label: 'In Progress', count: actionStats.inProgress.length, color: 'text-yellow-400', icon: Clock },
            { label: 'Closed',      count: actionStats.closed.length,     color: 'text-green-400',  icon: CheckCircle },
            { label: 'Overdue',     count: actionStats.overdue.length,    color: 'text-orange-400', icon: XCircle },
          ].map(s => {
            const Icon = s.icon
            return (
              <div key={s.label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3 flex items-center gap-3">
                <Icon size={18} className={s.color} />
                <div>
                  <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.count}</p>
                  <p className="text-xs text-[var(--text-muted)]">{s.label}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Close rate trend + open actions table */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 lg:col-span-2">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">Action Close Rate Trend</p>
            <div className="h-44">
              {actionCloseTrend.datasets[0].data.some(v => v != null) ? (
                <Line
                  data={actionCloseTrend}
                  options={{
                    ...CHART_BASE,
                    scales: {
                      ...CHART_BASE.scales,
                      y: {
                        ...CHART_BASE.scales.y,
                        min: 0, max: 100,
                        ticks: { ...CHART_BASE.scales.y.ticks, callback: v => `${v}%` },
                      },
                    },
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No action data available</div>
              )}
            </div>
          </div>

          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 lg:col-span-3 overflow-hidden">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">
              Open & Overdue Actions
              <span className="ml-2 text-[var(--text-dim)] font-normal">({actionStats.openTable.length} total)</span>
            </p>
            {actionStats.openTable.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-36 gap-2 text-[var(--text-dim)]">
                <CheckCircle size={24} className="text-green-600" aria-hidden="true" />
                <p className="text-sm">{actions.length ? 'All corrective actions are closed' : 'No corrective actions raised yet'}</p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-3">
                  <select aria-label="Filter by status" value={actionStatus} onChange={(e) => setActionStatus(e.target.value)}
                    className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 min-h-[44px] text-xs text-[var(--text-secondary)]">
                    <option value="all">All statuses</option>
                    <option value="Open">Open</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Overdue">Overdue status</option>
                  </select>
                  <select aria-label="Filter by priority" value={actionPriority} onChange={(e) => setActionPriority(e.target.value)}
                    className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 min-h-[44px] text-xs text-[var(--text-secondary)]">
                    <option value="all">All priorities</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                  <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] min-h-[44px] cursor-pointer">
                    <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
                    Over {OVERDUE_ACTION_DAYS} days only
                  </label>
                </div>
                <EnterpriseTable
                  columns={actionColumns}
                  data={actionRows}
                  getRowId={(a) => String(a.id)}
                  enableColumnFilters={false}
                  enableExport={false}
                  searchPlaceholder="Search actions"
                  initialPageSize={25}
                  emptyMessage="No open actions match these filters"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 6: KPI vs Target Scorecard ── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <Target size={14} className="text-purple-400" />
          KPI vs Target Scorecard
          {kpiScorecard.length === 0 && (
            <span className="ml-2 text-xs text-[var(--text-dim)] font-normal">- configure targets in KPI Scorecard settings</span>
          )}
        </h2>

        {kpiScorecard.length === 0 ? (
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-8 text-center">
            <Info size={24} className="text-[var(--text-dim)] mx-auto mb-2" />
            <p className="text-[var(--text-muted)] text-sm">No KPI targets configured.</p>
            <p className="text-[var(--text-dim)] text-xs mt-1">Set targets in the KPI Scorecard page to enable gap analysis.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Table */}
            <div className="lg:col-span-3 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3 min-w-0">
              <EnterpriseTable
                columns={scorecardColumns}
                data={kpiScorecard}
                getRowId={(k) => k.metric}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableColumnVisibility={false}
                enableExport={false}
                initialPageSize={25}
                emptyMessage="No KPI targets configured"
              />
            </div>

            {/* Bar chart */}
            <div className="lg:col-span-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
              <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">Actual vs Target (Normalised)</p>
              <div className="h-52">
                {kpiBarData ? (
                  <Bar
                    data={kpiBarData}
                    options={{
                      ...CHART_BASE,
                      scales: {
                        x: { ...CHART_BASE.scales.x, ticks: { ...CHART_BASE.scales.x.ticks, font: { size: 9 } } },
                        y: { ...CHART_BASE.scales.y },
                      },
                      plugins: {
                        ...CHART_BASE.plugins,
                        legend: { labels: { color: 'var(--text-secondary)', font: { size: 10 }, boxWidth: 10 } },
                      },
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No target data</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Improvement score legend ── */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
        <p className="text-xs font-semibold text-[var(--text-muted)] mb-3 flex items-center gap-2">
          <Info size={13} /> Score Methodology
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-[var(--text-muted)]">
          <div className="flex gap-2"><span className="text-green-400 font-semibold">75+</span> - Excellent: sustain & extend programme</div>
          <div className="flex gap-2"><span className="text-yellow-400 font-semibold">50-74</span> - Progressing: intensify action tracking</div>
          <div className="flex gap-2"><span className="text-red-400 font-semibold">&lt;50</span> - Critical: immediate escalation required</div>
          <div className="flex gap-2"><span className="text-[var(--text-muted)] font-semibold">Score</span> = Cost (25) + Reliability (25) + Compliance (25) + Close Rate (25)</div>
        </div>
      </div>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
