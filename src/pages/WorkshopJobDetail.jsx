import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToPdf, exportToExcel, reportFileName, reportDateLabel } from '../lib/exportUtils'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  turnaroundHours, isOnTime, scheduleVarianceDays, costSplit, parseParts, partName,
  partsSummary, assetHistorySummary, formatHours, formatMoney, formatPct,
  partsExportRows, historyExportRows,
} from '../lib/workshopJobDetailAnalytics'
import { formatDate, formatDateTime } from '../lib/formatters'
import { SkeletonCards } from '../components/ui/Skeleton'
import EmptyState from '../components/EmptyState'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import {
  Wrench, ArrowLeft, AlertTriangle, FileText, Lock,
  BarChart2, DollarSign, Package, ShieldCheck, History, Download, RefreshCw,
} from 'lucide-react'

// ── Same field selection as the Workshop directory, so the detail page reads an
//    identical record shape (aliases: assigned_to, scheduled_date). `score` /
//    `quality_score` feed the QA approval routing context. ─────────────────────
const WO_SELECT =
  'id,work_order_no,asset_no,status,priority,work_type,site,assigned_to:technician_name,' +
  'labour_cost,parts_cost,total_cost,created_at,completed_at,scheduled_date:target_completion,' +
  'description,parts_used,country,score,quality_score'

const HISTORY_COLS = 'id,work_order_no,status,work_type,created_at,completed_at,total_cost'
const HISTORY_LIMIT = 200

function statusBadgeClass(status) {
  switch ((status || '').toLowerCase()) {
    case 'open':           return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'in progress':    return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'awaiting parts': return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    case 'completed':      return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'cancelled':      return 'bg-gray-500/20 text-[var(--text-muted)] border-gray-500/30'
    default:               return 'bg-gray-500/20 text-[var(--text-muted)] border-gray-500/30'
  }
}

function priorityBadgeClass(priority) {
  switch ((priority || '').toLowerCase()) {
    case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 'high':     return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    case 'medium':   return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'low':      return 'bg-gray-500/20 text-[var(--text-muted)] border-gray-500/30'
    default:         return 'bg-gray-500/20 text-[var(--text-muted)] border-gray-500/30'
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function WorkshopJobDetail() {
  const { jobId } = useParams()
  const id = decodeURIComponent(jobId || '')
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { activeCurrency, activeCountry } = useSettings()

  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  // Approval-engine gate — while this work order's QA sign-off workflow is active
  // (pending/in_review/returned) or locked (approved), its strongest per-record
  // action (the Job Card export) is disabled so an in-approval job can't be
  // exported out from under the workflow. Server RLS remains the real boundary;
  // this is the client-side convenience guard. Resets when the record changes.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [id])

  const load = useCallback(async () => {
    if (!id) { setLoading(false); setJob(null); return }
    setLoading(true)
    setError(null)
    try {
      // Fetch by id first; fall back to human-readable work_order_no so links
      // built from either identifier resolve. Country scope keeps the detail
      // page consistent with the directory's active-country filter.
      const scoped = activeCountry && activeCountry !== 'All' ? activeCountry : null
      let q = supabase.from('work_orders').select(WO_SELECT).limit(1)
      q = /^[0-9a-f-]{16,}$/i.test(id) ? q.eq('id', id) : q.eq('work_order_no', id)
      if (scoped) q = q.eq('country', scoped)
      const { data, error: err } = await q.maybeSingle()
      if (err) { setError(toUserMessage(err, 'Could not load the job.')); setJob(null) }
      else setJob(data || null)
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the job.'))
      setJob(null)
    } finally {
      setLoading(false)
    }
  }, [id, activeCountry])

  useEffect(() => { load() }, [load])
  useEffect(() => { setActiveTab('overview') }, [id])

  // Other work orders on the same asset: one bounded, single-asset read.
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState(null)
  const loadHistory = useCallback(async () => {
    if (!job?.asset_no) { setHistory([]); setHistoryError(null); return }
    setHistory(null); setHistoryError(null)
    try {
      let q = supabase.from('work_orders').select(HISTORY_COLS).eq('asset_no', job.asset_no)
      if (job.country) q = q.eq('country', job.country)
      const { data, error: err } = await q
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_LIMIT)
      if (err) throw err
      setHistory(data || [])
    } catch (e) {
      setHistory([])
      setHistoryError(toUserMessage(e, 'Could not load this asset\'s job history.'))
    }
  }, [job?.asset_no, job?.country])
  useEffect(() => { if (job) loadHistory() }, [job, loadHistory])

  const parts = useMemo(() => parseParts(job), [job])
  const ta = useMemo(() => turnaroundHours(job), [job])
  const ot = useMemo(() => isOnTime(job), [job])
  const variance = useMemo(() => scheduleVarianceDays(job), [job])
  const split = useMemo(() => costSplit(job), [job])
  const partSum = useMemo(() => partsSummary(parts, job), [parts, job])
  const assetSum = useMemo(() => (history && !historyError ? assetHistorySummary(history, job) : null), [history, historyError, job])
  const historyRows = useMemo(() => (history || []).filter((h) => h.id !== job?.id), [history, job])

  const partsColumns = useMemo(() => [
    { id: 'line', header: '#', accessorFn: (r) => r._i + 1, size: 60, meta: { align: 'right' } },
    { id: 'part', header: 'Part', accessorFn: (r) => partName(r, r._i), size: 280 },
    { id: 'qty', header: 'Qty', accessorFn: (r) => (r.qty == null ? -1 : Number(r.qty)), size: 80, meta: { align: 'right' }, cell: ({ row }) => (row.original.qty == null ? 'N/A' : row.original.qty) },
    { id: 'cost', header: 'Cost', accessorFn: (r) => (r.cost == null ? -1 : Number(r.cost)), size: 120, meta: { align: 'right' }, cell: ({ row }) => formatMoney(row.original.cost, activeCurrency) },
  ], [activeCurrency])

  const historyColumns = useMemo(() => [
    { id: 'wo', header: 'Work order', accessorFn: (r) => r.work_order_no || r.id, size: 160, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.work_order_no || row.original.id}</span> },
    { id: 'created', header: 'Created', accessorFn: (r) => r.created_at || '', size: 120, cell: ({ row }) => (row.original.created_at ? formatDate(row.original.created_at) : 'N/A') },
    { id: 'completed', header: 'Completed', accessorFn: (r) => r.completed_at || '', size: 120, cell: ({ row }) => (row.original.completed_at ? formatDate(row.original.completed_at) : 'N/A') },
    { id: 'status', header: 'Status', accessorFn: (r) => r.status || '', size: 120, cell: ({ row }) => <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadgeClass(row.original.status)}`}>{row.original.status || 'N/A'}</span> },
    { id: 'type', header: 'Work type', accessorFn: (r) => r.work_type || 'N/A', size: 140 },
    { id: 'ta', header: 'Turnaround', accessorFn: (r) => turnaroundHours(r) ?? -1, size: 110, meta: { align: 'right' }, cell: ({ row }) => formatHours(turnaroundHours(row.original)) },
    { id: 'cost', header: 'Total cost', accessorFn: (r) => (r.total_cost == null ? -1 : Number(r.total_cost)), size: 120, meta: { align: 'right' }, cell: ({ row }) => formatMoney(row.original.total_cost, activeCurrency) },
  ], [activeCurrency])

  const exportParts = useCallback(() => {
    if (!job) return
    exportToExcel(partsExportRows(parts), ['line', 'part', 'qty', 'cost'], ['#', 'Part', 'Qty', 'Cost'],
      reportFileName('TyrePulse Job Parts', job.work_order_no ?? job.id, reportDateLabel()))
  }, [job, parts])

  const exportHistory = useCallback(() => {
    if (!job) return
    exportToExcel(historyExportRows(historyRows),
      ['work_order_no', 'created', 'completed', 'status', 'work_type', 'turnaround', 'total_cost'],
      ['Work order', 'Created', 'Completed', 'Status', 'Work type', 'Turnaround', 'Total cost'],
      reportFileName('TyrePulse Asset Job History', job.asset_no, reportDateLabel()))
  }, [job, historyRows])

  const handleExportJobCard = useCallback(() => {
    if (!job || wfLocked) return
    exportToPdf(
      [{
        work_order_no: job.work_order_no ?? job.id,
        asset_no: job.asset_no ?? '',
        site: job.site ?? '',
        work_type: job.work_type ?? '',
        priority: job.priority ?? '',
        status: job.status ?? '',
        assigned_to: job.assigned_to ?? '',
        created_at: job.created_at ? formatDateTime(job.created_at) : '',
        scheduled_date: job.scheduled_date ? formatDate(job.scheduled_date) : '',
        completed_at: job.completed_at ? formatDateTime(job.completed_at) : '',
        labour_cost: job.labour_cost ?? 0,
        parts_cost: job.parts_cost ?? 0,
        total_cost: job.total_cost ?? 0,
      }],
      [
        { key: 'work_order_no', header: 'WO No' },
        { key: 'asset_no', header: 'Asset' },
        { key: 'site', header: 'Site' },
        { key: 'work_type', header: 'Work Type' },
        { key: 'priority', header: 'Priority' },
        { key: 'status', header: 'Status' },
        { key: 'assigned_to', header: 'Assigned To' },
        { key: 'created_at', header: 'Created' },
        { key: 'scheduled_date', header: 'Scheduled' },
        { key: 'completed_at', header: 'Completed' },
        { key: 'labour_cost', header: 'Labour Cost' },
        { key: 'parts_cost', header: 'Parts Cost' },
        { key: 'total_cost', header: 'Total Cost' },
      ],
      `Workshop Job Card: ${job.work_order_no ?? job.id}`,
      reportFileName('TyrePulse Workshop Job Card', job.work_order_no ?? job.id),
      'landscape',
    )
  }, [job, wfLocked])

  const backBtn = (
    <button
      type="button"
      onClick={() => navigate('/workshop')}
      className="inline-flex items-center gap-1.5 px-3 min-h-[44px] bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm rounded-lg transition-colors"
    >
      <ArrowLeft size={14} /> {t('workshop.detail.back')}
    </button>
  )

  // ── States: loading / error / not-found ────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        {backBtn}
        <SkeletonCards count={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        {backBtn}
        <div className="flex items-center justify-center h-64">
          <div className="text-center" role="alert">
            <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" aria-hidden="true" />
            <p className="text-red-400 font-medium">{t('workshop.detail.loadFailed')}</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button type="button" onClick={load} className="mt-3 px-4 min-h-[44px] bg-blue-600 rounded-lg text-sm text-white hover:bg-blue-500">
              {t('workshop.detail.retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="space-y-4">
        {backBtn}
        <EmptyState
          icon={Wrench}
          title={t('workshop.detail.notFoundTitle')}
          description={t('workshop.detail.notFoundDesc', { id })}
        />
      </div>
    )
  }

  const coreFields = [
    { label: t('workshop.detail.fields.asset'), value: job.asset_no },
    { label: t('workshop.detail.fields.site'), value: job.site },
    { label: t('workshop.detail.fields.workType'), value: job.work_type },
    { label: t('workshop.detail.fields.assignedTo'), value: job.assigned_to },
    { label: t('workshop.detail.fields.created'), value: job.created_at ? formatDateTime(job.created_at) : 'N/A' },
    { label: t('workshop.detail.fields.scheduled'), value: job.scheduled_date ? formatDate(job.scheduled_date) : 'N/A' },
    { label: t('workshop.detail.fields.completed'), value: job.completed_at ? formatDateTime(job.completed_at) : 'N/A' },
    { label: t('workshop.detail.fields.turnaround'), value: formatHours(ta) },
  ]

  const TABS = [
    { id: 'overview', label: t('workshop.detail.tabs.overview'), icon: BarChart2 },
    { id: 'costs', label: t('workshop.detail.tabs.costs'), icon: DollarSign },
    { id: 'parts', label: t('workshop.detail.tabs.parts'), icon: Package },
    { id: 'history', label: 'Asset history', icon: History },
    { id: 'approval', label: t('workshop.detail.tabs.approval'), icon: ShieldCheck },
  ]

  const total = split.total || 0
  const labourPct = split.labourPct
  const partsPct = split.partsPct
  const varianceText = variance == null ? 'N/A' : variance === 0 ? 'On the day' : variance > 0 ? `${variance} d late` : `${-variance} d early`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          {backBtn}
          <div>
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{t('workshop.detail.eyebrow')}</p>
            <h1 className="text-lg font-bold text-[var(--text-primary)] mt-0.5 flex items-center gap-2">
              <Wrench className="w-5 h-5 text-blue-400" />
              {job.work_order_no || job.id}
            </h1>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExportJobCard}
          disabled={wfLocked}
          title={wfLocked ? t('workshop.detail.export.locked') : t('workshop.detail.export.tooltip')}
          className="inline-flex items-center gap-1.5 px-4 min-h-[44px] bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
        >
          {wfLocked ? <Lock size={14} /> : <FileText size={14} />} {t('workshop.detail.export.jobCard')}
        </button>
      </div>

      {/* Status & Priority */}
      <div className="flex gap-2 flex-wrap">
        {job.status && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusBadgeClass(job.status)}`}>{job.status}</span>
        )}
        {job.priority && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${priorityBadgeClass(job.priority)}`}>{job.priority}</span>
        )}
        {ot != null && (
          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${ot ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
            {ot ? t('workshop.detail.onTime') : t('workshop.detail.late')}
          </span>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: 'Turnaround', value: formatHours(ta), sub: job.completed_at ? 'Created to completed' : 'Job not completed yet' },
          { label: 'Against target', value: varianceText, sub: job.scheduled_date ? `Target ${formatDate(job.scheduled_date)}` : 'No target date set' },
          { label: 'Total cost', value: formatMoney(split.total, activeCurrency), sub: split.total ? `Labour ${formatPct(split.labourPct)}` : 'No cost recorded' },
          { label: 'Parts cost share', value: formatPct(split.partsPct), sub: formatMoney(split.parts, activeCurrency) },
          { label: 'Parts lines', value: partSum.lines, sub: partSum.lines ? `${partSum.costed} priced, ${partSum.unpriced} unpriced` : 'No parts recorded' },
          {
            label: 'Asset jobs, 12 months',
            value: assetSum ? assetSum.jobs12m : (historyError ? 'N/A' : '...'),
            sub: assetSum ? (assetSum.repeatWithin30 > 0 ? `${assetSum.repeatWithin30} other job within 30 days before` : 'No repeat within 30 days') : (historyError ? 'History unavailable' : 'Loading history'),
          },
        ].map((k) => (
          <div key={k.label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">{k.label}</p>
            <p className="text-lg font-bold text-[var(--text-primary)] tabular-nums mt-1 truncate">{k.value}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate" title={k.sub}>{k.sub}</p>
          </div>
        ))}
      </div>

      {wfLocked && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2">
          <Lock size={12} />
          {t('workshop.detail.approval.locked')}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 w-fit max-w-full flex-wrap" role="tablist" aria-label="Job detail sections">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 min-h-[44px] rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
            }`}
          >
            <tab.icon className="w-4 h-4" aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Overview */}
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {coreFields.map(({ label, value }) => (
                <div key={label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg p-3">
                  <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
                  <p className="text-sm text-[var(--text-primary)] font-medium">{value || 'N/A'}</p>
                </div>
              ))}
            </div>

            {job.description && (
              <div>
                <h3 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">{t('workshop.detail.description')}</h3>
                <p className="text-sm text-[var(--text-secondary)] bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg p-4 leading-relaxed">
                  {job.description}
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* Costs */}
        {activeTab === 'costs' && (
          <motion.div
            key="costs"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <h3 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('workshop.detail.cost.heading')}</h3>
            <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              {[
                { label: t('workshop.detail.cost.labour'), value: job.labour_cost, color: 'bg-blue-500' },
                { label: t('workshop.detail.cost.parts'), value: job.parts_cost, color: 'bg-purple-500' },
                { label: t('workshop.detail.cost.total'), value: job.total_cost, color: 'bg-green-500', bold: true },
              ].map(({ label, value, color, bold }) => (
                <div key={label} className={`flex items-center justify-between px-4 py-3 ${bold ? 'border-t border-[var(--input-border)]' : ''}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${color}`} />
                    <span className={`text-sm ${bold ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'}`}>{label}</span>
                  </div>
                  <span className={`text-sm font-medium ${bold ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                    {formatMoney(value, activeCurrency)}
                  </span>
                </div>
              ))}
            </div>
            {total > 0 && (
              <div className="mt-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg p-3">
                <div className="flex gap-1 h-3 rounded overflow-hidden">
                  <div className="bg-blue-500 rounded-l" style={{ width: `${((job.labour_cost || 0) / total) * 100}%` }} />
                  <div className="bg-purple-500 rounded-r" style={{ width: `${((job.parts_cost || 0) / total) * 100}%` }} />
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-[var(--text-muted)]">
                  <span>{t('workshop.detail.cost.labourShare', { pct: formatPct(labourPct) })}</span>
                  <span>{t('workshop.detail.cost.partsShare', { pct: formatPct(partsPct) })}</span>
                </div>
                {split.other > 0 && (
                  <p className="text-xs text-[var(--text-muted)] mt-1">Other charges not split into labour or parts: {formatMoney(split.other, activeCurrency)}</p>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* Parts */}
        {activeTab === 'parts' && (
          <motion.div
            key="parts"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <h3 className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">{t('workshop.detail.parts.heading')}</h3>
            {parts.length === 0 ? (
              <EmptyState icon={Package} compact description={t('workshop.detail.parts.empty')} />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                  <span>{partSum.lines} lines, total qty {partSum.qty}</span>
                  <span>Priced lines total {formatMoney(partSum.lineCost, activeCurrency)}</span>
                  {partSum.reconcileGap != null && Math.abs(partSum.reconcileGap) >= 1 && (
                    <span className="text-amber-400">Recorded parts cost differs from the lines by {formatMoney(Math.abs(partSum.reconcileGap), activeCurrency)}</span>
                  )}
                  <button type="button" onClick={exportParts} className="ml-auto btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px] px-3">
                    <Download size={13} aria-hidden="true" /> Excel
                  </button>
                </div>
                <EnterpriseTable
                  columns={partsColumns}
                  data={parts.map((p, i) => ({ ...p, _i: i }))}
                  getRowId={(r) => String(r._i)}
                  enableGlobalFilter
                  searchPlaceholder="Search parts"
                  enableColumnFilters={false}
                  enableExport={false}
                  initialPageSize={25}
                  emptyMessage={t('workshop.detail.parts.empty')}
                />
              </div>
            )}
          </motion.div>
        )}

        {/* Asset history: the other work orders on this asset. */}
        {activeTab === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="space-y-3"
          >
            <h3 className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Other work orders on {job.asset_no || 'this asset'}</h3>
            {!job.asset_no ? (
              <EmptyState icon={History} compact description="This job carries no asset number, so there is no history to compare." />
            ) : historyError ? (
              <div role="alert" className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-6 text-center space-y-2">
                <AlertTriangle size={24} className="mx-auto text-red-400" aria-hidden="true" />
                <p className="text-sm text-[var(--text-primary)]">{historyError}</p>
                <button type="button" onClick={loadHistory} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] px-3">
                  <RefreshCw size={13} aria-hidden="true" /> Retry
                </button>
              </div>
            ) : (
              <>
                {assetSum && (
                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                    <span>{assetSum.otherJobs} other jobs</span>
                    <span>12 month cost {formatMoney(assetSum.cost12m, activeCurrency)}</span>
                    <span>Average turnaround {formatHours(assetSum.avgTurnaroundHours)}</span>
                    <span>{assetSum.priorJob ? `Previous job ${assetSum.priorJob}, ${assetSum.daysSincePrior} days before` : 'No earlier job on record'}</span>
                    {history && history.length >= HISTORY_LIMIT && <span className="text-amber-400">Newest {HISTORY_LIMIT} jobs shown</span>}
                    <button type="button" onClick={exportHistory} disabled={!historyRows.length} className="ml-auto btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px] px-3 disabled:opacity-40">
                      <Download size={13} aria-hidden="true" /> Excel
                    </button>
                  </div>
                )}
                <EnterpriseTable
                  columns={historyColumns}
                  data={historyRows}
                  loading={history === null}
                  getRowId={(r) => String(r.id)}
                  enableGlobalFilter
                  searchPlaceholder="Search work orders"
                  enableColumnFilters={false}
                  enableExport={false}
                  initialPageSize={25}
                  onRowClick={(r) => navigate(`/workshop/${encodeURIComponent(r.id)}`)}
                  emptyMessage="No other work orders on this asset."
                />
              </>
            )}
          </motion.div>
        )}

        {/* QA Approval — Approval & Workflow Engine.
            A workshop job / quality-inspection sign-off warrants approval before
            the job card is exported downstream. Smart rules may route high-cost
            or overdue jobs to a manager. Mirrors WorkOrders / Retread wiring. */}
        {activeTab === 'approval' && (
          <motion.div
            key="approval"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <EntityApprovalPanel
              entityType="workshop_qa"
              entityId={job.id}
              entityLabel={job.work_order_no || job.asset_no || job.id}
              context={{
                score: job.score ?? job.quality_score,
                status: job.status,
                workshop: job.site,
                work_type: job.work_type,
                total_cost: Number(job.total_cost) || 0,
                site: job.site,
              }}
              onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
              title={t('workshop.detail.approval.title')}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
